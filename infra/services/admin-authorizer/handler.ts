/**
 * Admin API authorizer (API Gateway REQUEST authorizer).
 *
 * Verifies the Cognito ID token, resolves the caller's admin role, enforces the
 * MFA requirement, and hands the role to the downstream Lambda via authorizer
 * context. A valid token without an admin group is *denied* (403) rather than
 * rejected as unauthenticated (401) — the distinction matters when debugging.
 *
 * Anything that fails verification throws `Unauthorized`, which API Gateway
 * maps to 401. Any denial emits an `AdminAuthDenied` log marker that a metric
 * filter turns into a CloudWatch metric (alarmed in admin-stack).
 *
 * See docs/admin-portal-architecture.md §6.3.
 */

import {
  AdminAuthError,
  extractBearerToken,
  resolveAdminIdentity,
} from '../shared/admin-auth';

interface AuthorizerEvent {
  type?: string;
  authorizationToken?: string;
  methodArn: string;
  headers?: Record<string, string | undefined>;
}

interface PolicyStatement {
  Action: string;
  Effect: 'Allow' | 'Deny';
  Resource: string;
}

interface AuthorizerResult {
  principalId: string;
  policyDocument: {
    Version: string;
    Statement: PolicyStatement[];
  };
  context: Record<string, string | number | boolean>;
}

function buildResult(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context: Record<string, string | number | boolean>
): AuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }],
    },
    context,
  };
}

function logDenial(reason: string, details: Record<string, unknown>): void {
  // `metric` is matched by a CloudWatch metric filter in admin-stack.
  console.warn(
    JSON.stringify({
      metric: 'AdminAuthDenied',
      reason,
      ...details,
    })
  );
}

export async function handler(event: AuthorizerEvent): Promise<AuthorizerResult> {
  // A REQUEST authorizer receives the raw identity-source value, but accept the
  // header map too so the function is testable and resilient to config drift.
  const token =
    extractBearerToken(event.authorizationToken) ??
    extractBearerToken(event.headers?.Authorization ?? event.headers?.authorization);

  if (!token) {
    logDenial('missing_token', { methodArn: event.methodArn });
    throw new Error('Unauthorized');
  }

  // The one path an MFA-less admin may reach: enrolling their factor. It is
  // still fully authorized (valid token + admin group); only the MFA assertion
  // is deferred, and the route verifies the factor server-side before recording
  // anything.
  const isBootstrapPath = /\/admin\/bootstrap\//.test(event.methodArn);

  try {
    const identity = await resolveAdminIdentity(token, { enforceMfa: !isBootstrapPath });

    return buildResult(identity.sub, 'Allow', event.methodArn, {
      sub: identity.sub,
      email: identity.email,
      role: identity.role,
      roleRank: identity.roleRank,
      mfa: identity.mfa,
      authTime: identity.authTime,
    });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      logDenial(error.code.toLowerCase(), {
        methodArn: event.methodArn,
        detail: error.message,
      });
      // Invalid credentials: let API Gateway answer 401.
      if (error.code === 'UNAUTHORIZED') {
        throw new Error('Unauthorized');
      }

      // Authenticated but not permitted (no group, or MFA missing): 403.
      return buildResult('anonymous', 'Deny', event.methodArn, {
        reason: error.code,
      });
    }

    // Unexpected failure must never fail open.
    logDenial('unexpected_error', {
      methodArn: event.methodArn,
      detail: (error as Error).message,
    });
    throw new Error('Unauthorized');
  }
}
