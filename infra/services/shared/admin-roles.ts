/**
 * The admin role model, with no AWS dependencies.
 *
 * Extracted from `admin-auth.ts` so the public join Lambda can map a role to its
 * Cognito group without bundling `aws-jwt-verify` and the authorizer's Cognito
 * client. `admin-auth.ts` re-exports everything here, so existing imports keep
 * working and there is still one definition.
 *
 * Cognito group membership is the only grant of admin capability
 * (docs/admin-portal-architecture.md §6.2).
 */

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
