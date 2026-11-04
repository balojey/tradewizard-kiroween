import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from './config';

export interface AuthStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  dbSecret?: secretsmanager.ISecret;
  dbEndpoint?: string;
}

/**
 * Auth stack: Amazon Cognito user pool with passwordless (Magic Link) support.
 *
 * Configures:
 * - User pool with email-based sign-in
 * - Custom auth flow for Magic Link integration
 * - App client for frontend
 * - App client for backend (server-side)
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly backendClient: cognito.UserPoolClient;
  public readonly adminClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;
    const isProd = config.envName === 'production';

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: resourceName(config.envName, 'user-pool'),
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        fullname: {
          required: false,
          mutable: true,
        },
      },
      customAttributes: {
        plan: new cognito.StringAttribute({ mutable: true }),
        creditsRemaining: new cognito.NumberAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      // TOTP must be enrollable in every environment, otherwise the admin MFA
      // gate (authorizer + ADMIN_REQUIRE_MFA) cannot be exercised before prod.
      // `OPTIONAL` means customers are never forced to enrol; admins are, by
      // the admin authorizer.
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      email: cognito.UserPoolEmail.withCognito(),
      deletionProtection: config.deletionProtection,
    });

    // Frontend app client (public, PKCE flow)
    this.userPoolClient = new cognito.UserPoolClient(this, 'FrontendClient', {
      userPool: this.userPool,
      userPoolClientName: resourceName(config.envName, 'frontend-client'),
      authFlows: {
        userSrp: true,
        custom: true, // Required for Magic Link custom auth
        adminUserPassword: true, // Required for Magic→Cognito sync via AdminInitiateAuth
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: isProd
          ? ['https://tradewizard.live/auth/callback']
          : ['http://localhost:3000/auth/callback', 'https://dev.tradewizard.live/auth/callback'],
        logoutUrls: isProd
          ? ['https://tradewizard.live']
          : ['http://localhost:3000', 'https://dev.tradewizard.live'],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // Backend app client (confidential, for server-side operations)
    this.backendClient = new cognito.UserPoolClient(this, 'BackendClient', {
      userPool: this.userPool,
      userPoolClientName: resourceName(config.envName, 'backend-client'),
      generateSecret: true,
      authFlows: {
        adminUserPassword: true,
        custom: true,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ─── Admin Portal: app client + role groups ────────────────────────────────
    //
    // The management portal signs admins in with email + password + TOTP,
    // directly against Cognito (no proxy through our servers). Magic link stays
    // the customer path; admin accounts are few and need a real second factor.
    //
    // USER_PASSWORD_AUTH is enabled only on this client. It is not SRP, but the
    // password never touches TradeWizard infrastructure — it goes over TLS to
    // Cognito. See docs/admin-portal-architecture.md D7.
    this.adminClient = new cognito.UserPoolClient(this, 'AdminClient', {
      userPool: this.userPool,
      userPoolClientName: resourceName(config.envName, 'admin-client'),
      authFlows: {
        userPassword: true,
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      // A portal session is meant to survive a working day and a browser
      // restart. The ID/access tokens stay short (1 hour, silently refreshed);
      // only the refresh token is long-lived, and sign-out revokes it.
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // Role groups. Membership is the only grant of admin capability — there is
    // no is_admin column anywhere. Precedence is informational (lowest wins in
    // the Cognito console); authorization uses ROLE_RANK in shared/admin-auth.
    const adminGroups = [
      { name: 'tw-owner', precedence: 1 },
      { name: 'tw-admin', precedence: 2 },
      { name: 'tw-support', precedence: 3 },
      { name: 'tw-analyst', precedence: 4 },
    ] as const;

    for (const group of adminGroups) {
      this.userPool.addGroup(`AdminGroup${group.name}`, {
        groupName: group.name,
        precedence: group.precedence,
      });
    }

    // ─── Post-Confirmation Lambda (User Provisioning) ──────────────────────────
    // Creates user + free subscription in RDS when a new user confirms their account.
    // Defined here (same stack as user pool) to avoid cross-stack circular dependencies.

    if (props.dbSecret && props.dbEndpoint) {
      const postConfirmationHandler = new lambdaNode.NodejsFunction(this, 'PostConfirmationHandler', {
        functionName: resourceName(config.envName, 'post-confirmation'),
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: 'services/post-confirmation/handler.ts',
        handler: 'handler',
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: {
          ENVIRONMENT: config.envName,
          DB_SECRET_ARN: props.dbSecret.secretArn,
          DB_HOST: props.dbEndpoint,
          DB_NAME: 'tradewizard',
        },
        bundling: {
          minify: isProd,
          sourceMap: !isProd,
        },
        description: 'Creates user + free subscription in RDS on Cognito sign-up confirmation',
      });

      props.dbSecret.grantRead(postConfirmationHandler);

      this.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationHandler);
    }

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: resourceName(config.envName, 'user-pool-id'),
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      exportName: resourceName(config.envName, 'user-pool-arn'),
    });

    new cdk.CfnOutput(this, 'FrontendClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: resourceName(config.envName, 'frontend-client-id'),
    });

    new cdk.CfnOutput(this, 'BackendClientId', {
      value: this.backendClient.userPoolClientId,
      exportName: resourceName(config.envName, 'backend-client-id'),
    });

    new cdk.CfnOutput(this, 'AdminClientId', {
      value: this.adminClient.userPoolClientId,
      exportName: resourceName(config.envName, 'admin-client-id'),
      description: 'Cognito app client used by the management portal (password + TOTP)',
    });
  }
}
