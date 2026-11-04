/**
 * Caller identity for the public support routes.
 *
 * The submit and thread routes are declared `AuthorizationType.NONE` at API
 * Gateway, because an anonymous requester has no token and a signed-in one must
 * still be identifiable. A bearer token is therefore verified *here* against the
 * user pool — never decoded and trusted.
 */

import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface BearerIdentity {
  sub: string;
  email?: string;
}

interface SupportApiEvent {
  headers?: Record<string, string | undefined>;
  requestContext?: {
    authorizer?: { claims?: Record<string, string> | null } | null;
  };
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

function getVerifier(): ReturnType<typeof CognitoJwtVerifier.create> {
  if (verifier) return verifier;

  verifier = CognitoJwtVerifier.create({
    userPoolId: requireEnv('USER_POOL_ID'),
    tokenUse: 'id',
    clientId: requireEnv('FRONTEND_CLIENT_ID'),
  });

  return verifier;
}

/** Test seam: drop the cached verifier. */
export function resetAuthCacheForTests(): void {
  verifier = null;
}

/**
 * Verify a bearer token when one is present.
 *
 * Invalid tokens are treated as anonymous rather than rejected: a stale token in
 * localStorage must not stop someone from asking for help, and the requester's
 * email still identifies them for the thread.
 */
export async function readBearerIdentity(
  event: SupportApiEvent
): Promise<BearerIdentity | null> {
  const header = event.headers?.Authorization ?? event.headers?.authorization;
  if (!header) return null;

  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const payload = await getVerifier().verify(token);
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    return { sub: payload.sub, email };
  } catch {
    return null;
  }
}

/**
 * Cognito authorizer claim, for routes that require authentication at the
 * gateway (`GET /support/tickets`).
 */
export function authorizerSub(event: SupportApiEvent): string | null {
  return event.requestContext?.authorizer?.claims?.sub ?? null;
}
