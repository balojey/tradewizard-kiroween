import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  AdminAuthError,
  ROLE_GROUPS,
  ROLE_RANK,
  extractBearerToken,
  groupForRole,
  requireFreshAuth,
  requireRole,
  roleFromGroups,
  type AdminIdentity,
  type AdminRole,
} from './admin-auth';

/**
 * Property-based tests for the admin authorization surface.
 *
 * These are the invariants a randomized test can prove better than examples:
 * role ranking is total and order-independent, `requireRole` is exactly the
 * rank comparison, fresh-auth is a strict age window, and bearer extraction is
 * a round-trip.
 */

const ROLES = ['analyst', 'support', 'admin', 'owner'] as const;
const roleArb = fc.constantFrom<AdminRole>(...ROLES);
const knownGroupArb = fc.constantFrom(...Object.keys(ROLE_GROUPS));
const unknownGroupArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/).filter(
  (group) => !(group in ROLE_GROUPS)
);
const groupArb = fc.oneof(knownGroupArb, unknownGroupArb);

function identityFor(role: AdminRole, authTime: number): AdminIdentity {
  return {
    sub: 'sub-property',
    email: 'property@example.com',
    role,
    roleRank: ROLE_RANK[role],
    mfa: true,
    authTime,
  };
}

function eventFor(role: AdminRole): Parameters<typeof requireRole>[0] {
  return {
    requestContext: {
      authorizer: {
        sub: 'sub-property',
        email: 'property@example.com',
        role,
        roleRank: ROLE_RANK[role],
        mfa: true,
        authTime: Math.floor(Date.now() / 1000),
      },
    },
  } as Parameters<typeof requireRole>[0];
}

describe('admin authorization (property-based)', () => {
  it('roleFromGroups always returns the highest-ranked known group', () => {
    fc.assert(
      fc.property(fc.array(groupArb, { maxLength: 30 }), (groups) => {
        const knownRoles = groups
          .map((group) => ROLE_GROUPS[group])
          .filter((role): role is AdminRole => Boolean(role));
        const result = roleFromGroups(groups);

        if (knownRoles.length === 0) return result === null;

        return (
          result !== null &&
          ROLE_RANK[result] === Math.max(...knownRoles.map((role) => ROLE_RANK[role]))
        );
      }),
      { numRuns: 200 }
    );
  });

  it('roleFromGroups is order-independent', () => {
    fc.assert(
      fc.property(fc.array(groupArb, { maxLength: 30 }), (groups) => {
        const reversed = [...groups].reverse();
        return roleFromGroups(groups) === roleFromGroups(reversed);
      }),
      { numRuns: 200 }
    );
  });

  it('unknown groups never change the resolved role', () => {
    fc.assert(
      fc.property(
        fc.array(knownGroupArb, { maxLength: 10 }),
        fc.array(unknownGroupArb, { maxLength: 10 }),
        (known, unknown) => {
          return roleFromGroups(known) === roleFromGroups([...known, ...unknown]);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('groupForRole round-trips through ROLE_GROUPS', () => {
    fc.assert(
      fc.property(roleArb, (role) => ROLE_GROUPS[groupForRole(role)] === role),
      { numRuns: 100 }
    );
  });

  it('requireRole passes exactly when the caller rank is at least the minimum', () => {
    fc.assert(
      fc.property(roleArb, roleArb, (caller, minimum) => {
        const allowed = ROLE_RANK[caller] >= ROLE_RANK[minimum];

        if (allowed) {
          return requireRole(eventFor(caller), minimum).role === caller;
        }

        try {
          requireRole(eventFor(caller), minimum);
          return false;
        } catch (error) {
          return error instanceof AdminAuthError && error.code === 'FORBIDDEN';
        }
      }),
      { numRuns: 200 }
    );
  });

  it('requireFreshAuth accepts exactly ages inside the window', () => {
    fc.assert(
      fc.property(roleArb, fc.integer({ min: 0, max: 600 }), (role, age) => {
        const now = Math.floor(Date.now() / 1000);
        expect(() => requireFreshAuth(identityFor(role, now - age))).not.toThrow();
        return true;
      }),
      { numRuns: 200 }
    );
  });

  it('requireFreshAuth rejects ages outside the window with REAUTH_REQUIRED', () => {
    fc.assert(
      fc.property(
        roleArb,
        fc.integer({ min: 601, max: 86_400 }),
        (role, age) => {
          const now = Math.floor(Date.now() / 1000);
          try {
            requireFreshAuth(identityFor(role, now - age));
            return false;
          } catch (error) {
            return error instanceof AdminAuthError && error.code === 'REAUTH_REQUIRED';
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('requireFreshAuth rejects an unknown authentication time', () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        try {
          requireFreshAuth(identityFor(role, 0));
          return false;
        } catch (error) {
          return error instanceof AdminAuthError && error.code === 'REAUTH_REQUIRED';
        }
      }),
      { numRuns: 100 }
    );
  });

  it('extracts any non-whitespace bearer token as a round-trip', () => {
    const tokenArb = fc.stringMatching(/^[A-Za-z0-9._~+/-]{1,80}$/);

    fc.assert(
      fc.property(tokenArb, (token) => {
        return extractBearerToken(`Bearer ${token}`) === token;
      }),
      { numRuns: 300 }
    );
  });

  it('accepts the Bearer prefix case-insensitively and trims surrounding space', () => {
    const tokenArb = fc.stringMatching(/^[A-Za-z0-9._~+/-]{1,80}$/);

    fc.assert(
      fc.property(tokenArb, (token) => {
        const header = `  bEaReR   ${token}  `;
        return extractBearerToken(header) === token;
      }),
      { numRuns: 200 }
    );
  });
});
