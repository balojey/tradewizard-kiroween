/**
 * Admin authentication and authorization.
 *
 * Source of truth for "is this person an admin" is Cognito group membership.
 * There is deliberately no `is_admin` column and no database lookup in the
 * authorizer: a stale RDS connection must never be the reason an admin request
 * succeeds or fails.
 *
 * Flow:
 *   1. `admin-authorizer` (Lambda) calls `resolveAdminIdentity(token)`.
 *   2. The result is placed on `event.requestContext.authorizer` by API Gateway.
 *   3. Handlers call `requireRole(event, 'support')` before doing any work.
 *
 * The handler-side check is not redundant: the authorizer answers "is this an
 * admin at all", while `requireRole` answers "may this admin perform THIS
 * action". Never trust a role claimed by the client.
 *
 * See docs/admin-portal-architecture.md §6.
 */

import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export type AdminRole = 'analyst' | 'support' | 'admin' | 'owner';

/** Higher rank may do everything a lower rank may do. */
export const ROLE_RANK: Record<AdminRole, number> = {
  analyst: 10,
  support: 20,
  admin: 30,
  owner: 40,
};

/** Cognito group name → role. Anything not listed grants nothing. */
export const ROLE_GROUPS: Record<string, AdminRole> = {
  'tw-analyst': 'analyst',
  'tw-support': 'support',
  'tw-admin': 'admin',
  'tw-owner': 'owner',
};

/** Reverse of ROLE_GROUPS: the Cognito group that confers a role. */
export function groupForRole(role: AdminRole): string {
  const entry = Object.entries(ROLE_GROUPS).find(([, value]) => value === role);
  if (!entry) {
    throw new Error(`No Cognito group maps to role "${role}"`);
  }
  return entry[0];
}

export type AdminAuthErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'MFA_REQUIRED'
  | 'REAUTH_REQUIRED';

export class AdminAuthError extends Error {
  constructor(
    public readonly code: AdminAuthErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AdminAuthError';
  }
}

export interface AdminIdentity {
  /** Cognito sub — stable identifier for audit rows. */
  sub: string;
  email: string;
  role: AdminRole;
  roleRank: number;
  /** True when the token was issued after an MFA challenge (or MFA is off). */
  mfa: boolean;
  /** Epoch seconds of the authentication event, for freshness checks. */
  authTime: number;
}

interface AuthorizerContext {
  sub?: string;
  email?: string;
  role?: string;
  roleRank?: string | number;
  mfa?: string | boolean;
  authTime?: string | number;
}

interface AdminApiEvent {
  requestContext?: {
    authorizer?: AuthorizerContext;
  };
}

interface CognitoIdTokenPayload {
  sub?: string;
  email?: string;
  token_use?: string;
  auth_time?: number;
  'cognito:groups'?: string[] | string;
}

const MFA_CACHE_TTL_MS = 5 * 60 * 1000;

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;
const mfaCache = new Map<string, { configured: boolean; expiresAt: number }>();
const cognitoClient = new CognitoIdentityProviderClient({});

/** Test seam: drop cached verifier and MFA lookups. */
export function resetAdminAuthCachesForTests(): void {
  verifier = null;
  mfaCache.clear();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new AdminAuthError('UNAUTHORIZED', `${name} environment variable is not set`);
  }
  return value;
}

function getVerifier(): ReturnType<typeof CognitoJwtVerifier.create> {
  if (verifier) return verifier;

  verifier = CognitoJwtVerifier.create({
    userPoolId: requireEnv('USER_POOL_ID'),
    clientId: requireEnv('ADMIN_CLIENT_ID'),
    tokenUse: 'id',
  });

  return verifier;
}

/**
 * Pull the token out of an `Authorization` header. API Gateway passes the raw
 * header value to a REQUEST authorizer, so the "Bearer " prefix is expected.
 */
export function extractBearerToken(header?: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** Normalise the `cognito:groups` claim, which is an array in ID tokens. */
export function groupsFromClaim(claim: string[] | string | undefined): string[] {
  if (!claim) return [];
  if (Array.isArray(claim)) return claim;
  return claim
    .split(/[,\s]+/)
    .map((group) => group.trim())
    .filter(Boolean);
}

/** Highest-ranked role among the groups; null when none match. */
export function roleFromGroups(groups: string[]): AdminRole | null {
  let best: AdminRole | null = null;

  for (const group of groups) {
    const role = ROLE_GROUPS[group];
    if (!role) continue;
    if (!best || ROLE_RANK[role] > ROLE_RANK[best]) {
      best = role;
    }
  }

  return best;
}

function mfaRequired(): boolean {
  return process.env.ADMIN_REQUIRE_MFA === 'true';
}

/**
 * Whether the account has a TOTP factor configured.
 *
 * Cognito has no per-group MFA policy, so this is the only way to enforce a
 * second factor for admins on a pool where MFA is optional. Cached per sub
 * because it costs a Cognito API call.
 */
/**
 * Cognito returns factor names uppercased (`SOFTWARE_TOKEN_MFA`). Compare
 * case-insensitively so a future casing change cannot silently lock every admin
 * out — this exact mismatch already did once.
 */
function hasSoftwareToken(factors: readonly string[] | undefined): boolean {
  return (factors ?? []).some(
    (factor) => factor.toUpperCase() === "SOFTWARE_TOKEN_MFA"
  );
}

async function isMfaConfigured(sub: string): Promise<boolean> {
  const cached = mfaCache.get(sub);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.configured;
  }

  let response: { UserStatus?: string; UserMFASettingList?: string[] };

  try {
    response = await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: requireEnv('USER_POOL_ID'),
        Username: sub,
      })
    );
  } catch (error) {
    // Fail closed: we cannot prove a second factor exists, so refuse the token.
    throw new AdminAuthError(
      'UNAUTHORIZED',
      `Unable to verify MFA state: ${(error as Error).message}`
    );
  }

  const configured =
    response.UserStatus === 'CONFIRMED' && hasSoftwareToken(response.UserMFASettingList);

  if (!configured) {
    // A denial without the Cognito view is undebuggable. Log the lookup, not
    // the account: sub prefix is enough to correlate with an audit row.
    console.warn(
      JSON.stringify({
        metric: 'AdminMfaLookupMiss',
        subPrefix: sub.slice(0, 8),
        status: response.UserStatus,
        factors: response.UserMFASettingList ?? [],
      })
    );
  }

  // Negative results expire quickly so a freshly enrolled factor takes effect
  // without waiting for a container to recycle.
  const ttl = configured ? MFA_CACHE_TTL_MS : 60_000;
  mfaCache.set(sub, { configured, expiresAt: Date.now() + ttl });
  return configured;
}

/**
 * Verify an ID token and resolve the admin identity.
 *
 * Throws `AdminAuthError`:
 * - UNAUTHORIZED: invalid/expired token, wrong audience, missing claims
 * - FORBIDDEN: valid token but no admin group
 * - MFA_REQUIRED: admin group but no TOTP factor when ADMIN_REQUIRE_MFA=true
 */
export interface ResolveOptions {
  /**
   * Enforce the configured MFA policy. The authorizer turns this off for the
   * single enrolment path, so a password-only admin can set up a factor; the
   * reported `mfa` value stays truthful either way.
   */
  enforceMfa?: boolean;
}

export async function resolveAdminIdentity(
  token: string,
  options: ResolveOptions = {}
): Promise<AdminIdentity> {
  let payload: CognitoIdTokenPayload;

  try {
    payload = (await getVerifier().verify(token)) as CognitoIdTokenPayload;
  } catch (error) {
    throw new AdminAuthError(
      'UNAUTHORIZED',
      `Token verification failed: ${(error as Error).message}`
    );
  }

  if (!payload.sub) {
    throw new AdminAuthError('UNAUTHORIZED', 'Token is missing a subject');
  }

  const email = payload.email;
  if (!email) {
    throw new AdminAuthError('UNAUTHORIZED', 'Token is missing an email claim');
  }

  const role = roleFromGroups(groupsFromClaim(payload['cognito:groups']));
  if (!role) {
    throw new AdminAuthError('FORBIDDEN', 'Account is not a member of any admin group');
  }

  // Always read the real factor state: callers (and the enrolment route) need
  // to know the truth, not whether the policy is satisfied.
  const configured = await isMfaConfigured(payload.sub);
  const enforce = options.enforceMfa ?? true;

  if (enforce && mfaRequired() && !configured) {
    throw new AdminAuthError(
      'MFA_REQUIRED',
      'Admin accounts must have a TOTP factor configured'
    );
  }

  return {
    sub: payload.sub,
    email,
    role,
    roleRank: ROLE_RANK[role],
    mfa: configured,
    authTime: typeof payload.auth_time === 'number' ? payload.auth_time : 0,
  };
}

/**
 * Read the identity the authorizer attached to the request.
 * Throws UNAUTHORIZED when the request did not pass through the authorizer.
 */
export function getAdminIdentity(event: AdminApiEvent): AdminIdentity {
  const context = event.requestContext?.authorizer;

  if (!context?.sub || !context.role) {
    throw new AdminAuthError(
      'UNAUTHORIZED',
      'Request was not authorized by the admin authorizer'
    );
  }

  const role = context.role as AdminRole;
  if (!(role in ROLE_RANK)) {
    throw new AdminAuthError('UNAUTHORIZED', `Unknown role "${context.role}"`);
  }

  return {
    sub: context.sub,
    email: context.email ?? '',
    role,
    roleRank: ROLE_RANK[role],
    mfa: context.mfa === true || context.mfa === 'true',
    authTime: Number(context.authTime ?? 0),
  };
}

/**
 * Require a recent authentication event for destructive actions.
 *
 * A one-hour token is fine for reading; it is not fine for halting someone's
 * trading or changing who can administer the portal. Re-authenticating means the
 * person is present, not just that a token is still valid.
 */
export function requireFreshAuth(
  identity: AdminIdentity,
  maxAgeSeconds = 600
): void {
  const age = Math.floor(Date.now() / 1000) - identity.authTime;

  if (!identity.authTime || age > maxAgeSeconds) {
    throw new AdminAuthError(
      'REAUTH_REQUIRED',
      `This action requires signing in again (last authentication ${
        identity.authTime ? `${Math.floor(age / 60)} minutes ago` : 'unknown'
      }).`
    );
  }
}

/**
 * Assert the caller holds at least `minimum`. This is the first statement of
 * every admin route.
 */
export function requireRole(event: AdminApiEvent, minimum: AdminRole): AdminIdentity {
  const identity = getAdminIdentity(event);

  if (identity.roleRank < ROLE_RANK[minimum]) {
    throw new AdminAuthError(
      'FORBIDDEN',
      `Requires role "${minimum}" or higher (you are "${identity.role}")`
    );
  }

  return identity;
}
