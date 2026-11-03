/**
 * Cognito password + TOTP sign-in, called directly from the browser.
 *
 * The password goes over TLS to Cognito and never touches TradeWizard
 * infrastructure. The admin app client is the only client with
 * USER_PASSWORD_AUTH enabled (`infra/lib/auth-stack.ts`).
 *
 * See docs/admin-portal-architecture.md D7 and the runbook §1.
 */

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { AdminTokens } from "./session";

const REGION = process.env.NEXT_PUBLIC_COGNITO_REGION ?? "us-east-1";
const CLIENT_ID = process.env.NEXT_PUBLIC_ADMIN_CLIENT_ID ?? "";

let client: CognitoIdentityProviderClient | null = null;

function getClient(): CognitoIdentityProviderClient {
  if (!CLIENT_ID) {
    throw new Error("NEXT_PUBLIC_ADMIN_CLIENT_ID is not configured");
  }
  if (!client) {
    client = new CognitoIdentityProviderClient({ region: REGION });
  }
  return client;
}

export type SignInResult =
  | { kind: "tokens"; tokens: AdminTokens }
  | { kind: "mfa"; session: string }
  /** Invited account: Cognito requires the person to choose their own password. */
  | { kind: "newPassword"; session: string };

interface AuthenticationResult {
  IdToken?: string;
  AccessToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}

function toTokens(result: AuthenticationResult, fallbackRefresh?: string): AdminTokens {
  const refreshToken = result.RefreshToken ?? fallbackRefresh;

  if (!result.IdToken || !result.AccessToken || !refreshToken) {
    throw new Error("Cognito returned an incomplete token set");
  }

  return {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken,
    expiresAt: Date.now() + (result.ExpiresIn ?? 3600) * 1000,
  };
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const response = await getClient().send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    })
  );

  // An invited admin signs in with the temporary password Cognito emailed, and
  // must replace it before anything else happens.
  if (response.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    if (!response.Session) {
      throw new Error("Cognito returned a password challenge without a session");
    }
    return { kind: "newPassword", session: response.Session };
  }

  if (response.ChallengeName === "SOFTWARE_TOKEN_MFA") {
    if (!response.Session) {
      throw new Error("Cognito returned an MFA challenge without a session");
    }
    return { kind: "mfa", session: response.Session };
  }

  if (response.ChallengeName) {
    throw new Error(`Unsupported authentication challenge: ${response.ChallengeName}`);
  }

  return { kind: "tokens", tokens: toTokens(response.AuthenticationResult ?? {}) };
}

/**
 * Answer the NEW_PASSWORD_REQUIRED challenge with a password the person chooses.
 *
 * Cognito may follow this with another challenge (MFA) or with tokens; both are
 * handled so the caller does not need to know the pool's policy.
 */
export async function completeNewPassword(
  email: string,
  newPassword: string,
  session: string
): Promise<SignInResult> {
  const response = await getClient().send(
    new RespondToAuthChallengeCommand({
      ClientId: CLIENT_ID,
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: session,
      ChallengeResponses: {
        USERNAME: email,
        NEW_PASSWORD: newPassword,
      },
    })
  );

  if (response.ChallengeName === "SOFTWARE_TOKEN_MFA") {
    if (!response.Session) {
      throw new Error("Cognito returned an MFA challenge without a session");
    }
    return { kind: "mfa", session: response.Session };
  }

  if (response.ChallengeName) {
    throw new Error(`Unsupported authentication challenge: ${response.ChallengeName}`);
  }

  if (!response.AuthenticationResult) {
    throw new Error("Password change did not return tokens");
  }

  return { kind: "tokens", tokens: toTokens(response.AuthenticationResult) };
}

export async function completeMfa(
  email: string,
  code: string,
  session: string
): Promise<AdminTokens> {
  const response = await getClient().send(
    new RespondToAuthChallengeCommand({
      ClientId: CLIENT_ID,
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      Session: session,
      ChallengeResponses: {
        USERNAME: email,
        SOFTWARE_TOKEN_MFA_CODE: code,
      },
    })
  );

  if (!response.AuthenticationResult) {
    throw new Error("MFA verification did not return tokens");
  }

  return toTokens(response.AuthenticationResult);
}

export async function refreshSession(refreshToken: string): Promise<AdminTokens> {
  const response = await getClient().send(
    new InitiateAuthCommand({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    })
  );

  return toTokens(response.AuthenticationResult ?? {}, refreshToken);
}

/**
 * Convert a Cognito/SDK error into something an admin operator can act on.
 * Deliberately generic for credential failures: never reveal whether an email
 * exists.
 */
export function describeAuthError(error: unknown): string {
  const name = (error as { name?: string })?.name ?? "";
  const message = (error as { message?: string })?.message ?? "";

  switch (name) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return "Incorrect email or password.";
    case "UserNotConfirmedException":
      return "This account has not been confirmed yet.";
    case "PasswordResetRequiredException":
      return "A password reset is required. Ask an owner to reset it in Cognito.";
    case "CodeMismatchException":
      return "That code is not valid. Codes change every 30 seconds — try the current one.";
    case "ExpiredCodeException":
      return "That code has expired. Start the sign-in again.";
    case "TooManyRequestsException":
    case "LimitExceededException":
      return "Too many attempts. Wait a minute and try again.";
    case "SoftwareTokenMFANotFoundException":
      return "This account has no TOTP factor. Enrol one first (runbook §1.3).";
    case "InvalidPasswordException":
      return "Password must be at least 8 characters and include upper case, lower case and a number.";
    case "InvalidParameterException":
      return message || "Cognito rejected the request.";
    default:
      return message || "Sign-in failed. Try again.";
  }
}
