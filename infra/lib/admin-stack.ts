import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { EnvironmentConfig, resourceName } from './config';

export interface AdminStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  userPool: cognito.IUserPool;
  /** App client admins sign in with (password + TOTP). */
  adminClientId: string;
  dbSecret: secretsmanager.ISecret;
  dbEndpoint: string;
  /** Analysis payload bucket; the portal presigns GETs into it. */
  analysisBucket: s3.IBucket;
  /** Queues and connection table for the ops health view. */
  analysisQueue: sqs.IQueue;
  deadLetterQueue: sqs.IQueue;
  connectionsTable: dynamodb.ITable;
  dedupCacheTable: dynamodb.ITable;
  rateLimitTable: dynamodb.ITable;
  /** Alarm topic owned by the monitoring stack; optional so the stack can synth alone. */
  alarmTopic?: sns.ITopic;
}

/**
 * Admin stack: the management portal's API surface.
 *
 * Deliberately separate from the product API so it can have its own throttling,
 * CORS allowlist, access logs, and (later) WAF, without touching the customer
 * path. The rule "routes live in the stack that owns the Lambdas" still holds:
 * everything admin lives here.
 *
 * Contents:
 * - `admin-authorizer` — REQUEST authorizer: token → role → MFA → context
 * - `admin-api` — single routed Lambda behind it
 * - `AdminAuthDenied` metric filter + alarm
 *
 * See docs/admin-portal-architecture.md §7 and §10.
 */
export class AdminStack extends cdk.Stack {
  public readonly restApi: apigateway.RestApi;
  public readonly adminApiHandler: lambdaNode.NodejsFunction;
  public readonly authorizerHandler: lambdaNode.NodejsFunction;

  constructor(scope: Construct, id: string, props: AdminStackProps) {
    super(scope, id, props);

    const {
      config,
      userPool,
      adminClientId,
      dbSecret,
      dbEndpoint,
      analysisBucket,
      analysisQueue,
      deadLetterQueue,
      connectionsTable,
      dedupCacheTable,
      rateLimitTable,
      alarmTopic,
    } = props;
    const isProd = config.envName === 'production';

    const allowedOrigins = (
      process.env.ADMIN_ALLOWED_ORIGINS ??
      (isProd ? 'https://admin.tradewizard.live' : 'http://localhost:3001')
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    const requireMfa = process.env.ADMIN_REQUIRE_MFA ?? 'true';

    // ─── Authorizer ───────────────────────────────────────────────────────────

    const authorizerLogGroup = new logs.LogGroup(this, 'AdminAuthorizerLogs', {
      logGroupName: `/aws/lambda/${resourceName(config.envName, 'admin-authorizer')}`,
      retention: isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.authorizerHandler = new lambdaNode.NodejsFunction(this, 'AdminAuthorizerHandler', {
      functionName: resourceName(config.envName, 'admin-authorizer'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/admin-authorizer/handler.ts',
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      logGroup: authorizerLogGroup,
      environment: {
        ENVIRONMENT: config.envName,
        USER_POOL_ID: userPool.userPoolId,
        ADMIN_CLIENT_ID: adminClientId,
        ADMIN_REQUIRE_MFA: requireMfa,
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Verifies admin ID tokens, resolves role, enforces MFA',
    });

    this.authorizerHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminGetUser'],
        resources: [userPool.userPoolArn],
      })
    );


    // ─── API Lambda ───────────────────────────────────────────────────────────

    // Reserved concurrency is opt-in. Accounts with a small concurrency quota
    // reject any reservation that would leave fewer than 10 unreserved
    // executions, which fails the deploy. The API Gateway throttle (below) is
    // the primary guard; set ADMIN_API_RESERVED_CONCURRENCY only on accounts
    // that can spare it.
    const reservedConcurrency = Number(process.env.ADMIN_API_RESERVED_CONCURRENCY ?? '0');

    this.adminApiHandler = new lambdaNode.NodejsFunction(this, 'AdminApiHandler', {
      functionName: resourceName(config.envName, 'admin-api'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/admin-api/handler.ts',
      handler: 'handler',
      timeout: cdk.Duration.seconds(29),
      memorySize: 1024,
      ...(reservedConcurrency > 0
        ? { reservedConcurrentExecutions: reservedConcurrency }
        : {}),
      environment: {
        ENVIRONMENT: config.envName,
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        DB_NAME: 'tradewizard',
        ANALYSIS_BUCKET: analysisBucket.bucketName,
        ANALYSIS_QUEUE_URL: analysisQueue.queueUrl,
        DLQ_URL: deadLetterQueue.queueUrl,
        CONNECTIONS_TABLE: connectionsTable.tableName,
        DEDUP_CACHE_TABLE: dedupCacheTable.tableName,
        RATE_LIMIT_TABLE: rateLimitTable.tableName,
        RISK_ENGINE_FUNCTION_NAME: resourceName(config.envName, 'portfolio-risk-engine'),
        USER_POOL_ID: userPool.userPoolId,
        // Function names the ops view reads metrics for. Explicit so the view
        // reflects the deployed naming, not a guess made at runtime.
        OPS_LAMBDA_NAMES: [
          'analysis-lambda',
          'analysis-orchestrator',
          'analysis-request',
          'portfolio-trade-executor',
          'portfolio-risk-engine',
          'portfolio-position-guard',
          'admin-api',
        ]
          .map((name) => resourceName(config.envName, name))
          .join(','),
        ADMIN_ALLOWED_ORIGINS: allowedOrigins.join(','),
      },
      bundling: {
        minify: isProd,
        sourceMap: !isProd,
      },
      description: 'Management portal API: users, analyses, portfolio, ops, audit',
    });

    dbSecret.grantRead(this.adminApiHandler);

    // Membership management: admin-api reads and mutates Cognito groups.
    this.adminApiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminListGroupsForUser',
          'cognito-idp:AdminAddUserToGroup',
          'cognito-idp:AdminRemoveUserFromGroup',
          'cognito-idp:AdminUserGlobalSignOut',
          'cognito-idp:ListUsersInGroup',
          'cognito-idp:ListUsers',
        ],
        resources: [userPool.userPoolArn],
      })
    );

    // Read-only: the portal presigns GETs for analysis payloads (D6). It never
    // writes to the bucket.
    analysisBucket.grantRead(this.adminApiHandler);

    // The kill-switch state lives in the rate-limit table; resuming a session
    // must check it (read-only here — halting goes through the risk engine).
    rateLimitTable.grantReadData(this.adminApiHandler);

    // The kill switch dispatches the slow exit to the risk engine. Scoped to
    // that one function ARN — no wildcard invoke.
    this.adminApiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [
          // `resource` + `resourceName` are joined with "/" by formatArn, which
          // produces function/name — not a valid Lambda ARN. Build the resource
          // segment explicitly.
          cdk.Stack.of(this).formatArn({
            service: 'lambda',
            resource: `function:${resourceName(config.envName, 'portfolio-risk-engine')}`,
          }),
        ],
      })
    );

    // The kill-switch state is written here, so the table is read/write.
    rateLimitTable.grantReadWriteData(this.adminApiHandler);

    // Cache invalidation deletes dedup entries; it never writes to the table.
    dedupCacheTable.grantReadWriteData(this.adminApiHandler);

    // Ops health: queue depth/age and CloudWatch metrics/alarms. Read-only.
    this.adminApiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['sqs:GetQueueAttributes'],
        resources: [analysisQueue.queueArn, deadLetterQueue.queueArn],
      })
    );
    this.adminApiHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:GetMetricData', 'cloudwatch:DescribeAlarms'],
        // CloudWatch metric APIs do not support resource-level permissions.
        resources: ['*'],
      })
    );

    // ─── REST API ─────────────────────────────────────────────────────────────

    const accessLogGroup = new logs.LogGroup(this, 'AdminApiAccessLogs', {
      logGroupName: `/aws/apigateway/${resourceName(config.envName, 'admin-api')}/access`,
      retention: isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    this.restApi = new apigateway.RestApi(this, 'AdminRestApi', {
      restApiName: resourceName(config.envName, 'admin-api'),
      description: `TradeWizard ${config.envName} management portal API`,
      deployOptions: {
        stageName: isProd ? 'v1' : 'dev',
        throttlingRateLimit: isProd ? 20 : 10,
        throttlingBurstLimit: isProd ? 40 : 20,
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        tracingEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'Idempotency-Key',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: false,
        maxAge: cdk.Duration.minutes(10),
      },
      // The account-level CloudWatch role is configured by compute-stack; a
      // second stack managing the same account setting causes drift.
      cloudWatchRole: false,
      endpointTypes: [apigateway.EndpointType.REGIONAL],
    });

    const gatewayResponseHeaders = {
      'Access-Control-Allow-Origin': `'${allowedOrigins[0]}'`,
      'Access-Control-Allow-Headers': "'Content-Type,Authorization,Idempotency-Key'",
      'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
    };

    // Gateway responses bypass the Lambda, so their body shape is defined here.
    // `$context.error.messageString` arrives already quoted for authorizer
    // rejections, which produces invalid JSON when interpolated inside quotes —
    // use a static envelope instead and keep only the request id dynamic.
    const gatewayResponseBodies: Record<string, string> = {
      UNAUTHORIZED: JSON.stringify({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        requestId: '$context.requestId',
      }),
      ACCESS_DENIED: JSON.stringify({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission for this action',
        },
        requestId: '$context.requestId',
      }),
      DEFAULT_4XX: JSON.stringify({
        error: { code: 'BAD_REQUEST', message: 'Request could not be processed' },
        requestId: '$context.requestId',
      }),
      DEFAULT_5XX: JSON.stringify({
        error: { code: 'INTERNAL', message: 'Internal server error' },
        requestId: '$context.requestId',
      }),
    };

    for (const type of [
      apigateway.ResponseType.UNAUTHORIZED,
      apigateway.ResponseType.ACCESS_DENIED,
      apigateway.ResponseType.DEFAULT_4XX,
      apigateway.ResponseType.DEFAULT_5XX,
    ]) {
      this.restApi.addGatewayResponse(`${type.responseType}GatewayResponse`, {
        type,
        responseHeaders: gatewayResponseHeaders,
        templates: {
          'application/json': gatewayResponseBodies[type.responseType],
        },
      });
    }

    // API Gateway serves gateway responses from the deployment snapshot, and
    // CDK's deployment hash does not include them. Bump this suffix whenever the
    // bodies above change, or the stage keeps serving the previous version.
    this.restApi.latestDeployment?.addToLogicalId('gateway-responses-v2');

    const authorizer = new apigateway.RequestAuthorizer(this, 'AdminRequestAuthorizer', {
      authorizerName: resourceName(config.envName, 'admin-auth'),
      handler: this.authorizerHandler,
      identitySources: [apigateway.IdentitySource.header('Authorization')],
      // Our own caches handle cost; API Gateway caching would let a revoked
      // role keep working until the TTL expired.
      resultsCacheTtl: cdk.Duration.seconds(0),
    });

    const integration = new apigateway.LambdaIntegration(this.adminApiHandler, {
      proxy: true,
    });

    const authOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    };

    // ─── Routes ───────────────────────────────────────────────────────────────
    //
    // A single greedy proxy resource, NOT one method per endpoint.
    //
    // API Gateway invokes a Lambda through a resource policy, and Lambda caps
    // that policy at 20 KB. CDK creates one permission per (path, method), so an
    // explicit route table stops deploying at roughly 25 routes — the admin API
    // crossed that line while adding this slice. Routing therefore lives in the
    // Lambda (`services/admin-api/lib/router.ts`), which also means adding a
    // route no longer requires an API Gateway change.
    //
    // Trade-off: unknown paths reach the Lambda and get our 404 envelope instead
    // of a gateway-generated one. That is a better error anyway.
    const admin = this.restApi.root.addResource('admin');
    const adminProxy = admin.addResource('{proxy+}');

    // CORS preflight is already applied to every resource by
    // `defaultCorsPreflightOptions` on the RestApi.

    adminProxy.addMethod('ANY', integration, authOptions);

    // ─── Metrics rollup ───────────────────────────────────────────────────────
    //
    // The overview reads pre-computed daily rows, never live aggregates over the
    // product tables. Hourly so "today" stays fresh; every run recomputes today
    // and yesterday idempotently.
    const rollupHandler = new lambdaNode.NodejsFunction(this, 'AdminMetricsRollupHandler', {
      functionName: resourceName(config.envName, 'admin-metrics-rollup'),
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'services/admin-metrics-rollup/handler.ts',
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.envName,
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_HOST: dbEndpoint,
        DB_NAME: 'tradewizard',
      },
      bundling: { minify: isProd, sourceMap: !isProd },
      description: 'Computes admin_metrics_daily rows for today and yesterday',
    });

    dbSecret.grantRead(rollupHandler);

    new events.Rule(this, 'AdminMetricsRollupSchedule', {
      ruleName: resourceName(config.envName, 'admin-metrics-rollup'),
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new targets.LambdaFunction(rollupHandler)],
      description: 'Hourly management portal metrics rollup',
    });

    // ─── Denial metric + alarm ────────────────────────────────────────────────

    new logs.MetricFilter(this, 'AdminAuthDeniedFilter', {
      logGroup: authorizerLogGroup,
      filterPattern: logs.FilterPattern.literal('"AdminAuthDenied"'),
      metricNamespace: 'TradeWizard/Admin',
      metricName: 'AdminAuthDenied',
      defaultValue: 0,
    });

    const denialAlarm = new cloudwatch.Alarm(this, 'AdminAuthDeniedAlarm', {
      alarmName: resourceName(config.envName, 'admin-auth-denied'),
      alarmDescription:
        'Admin API rejected requests: wrong group, missing MFA, or invalid tokens',
      metric: new cloudwatch.Metric({
        namespace: 'TradeWizard/Admin',
        metricName: 'AdminAuthDenied',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    if (alarmTopic) {
      denialAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));
    }

    // 5xx on the admin API means the portal is failing, not that someone typed a
    // bad id — those return 4xx and are excluded by the Errors metric's nature.
    const apiErrorAlarm = new cloudwatch.Alarm(this, 'AdminApiErrorAlarm', {
      alarmName: resourceName(config.envName, 'admin-api-errors'),
      alarmDescription: 'Management portal API is returning 5xx responses',
      metric: this.adminApiHandler.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    if (alarmTopic) {
      apiErrorAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));
    }

    // A silent rollup means the dashboard quietly lies. Alarm on its failures.
    const rollupErrorAlarm = new cloudwatch.Alarm(this, 'AdminRollupErrorAlarm', {
      alarmName: resourceName(config.envName, 'admin-rollup-errors'),
      alarmDescription: 'Hourly admin metrics rollup is failing',
      metric: rollupHandler.metricErrors({ period: cdk.Duration.minutes(60) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    if (alarmTopic) {
      rollupErrorAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));
    }

    // ─── Outputs ──────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, 'AdminApiUrl', {
      value: this.restApi.url,
      exportName: resourceName(config.envName, 'admin-api-url'),
      description: 'Base URL for the management portal API (NEXT_PUBLIC_ADMIN_API_BASE_URL)',
    });

    new cdk.CfnOutput(this, 'AdminApiDeniedAlarmName', {
      value: denialAlarm.alarmName,
      exportName: resourceName(config.envName, 'admin-auth-denied-alarm'),
    });
  }
}
