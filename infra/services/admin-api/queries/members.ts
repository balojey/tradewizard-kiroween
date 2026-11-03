/**
 * Admin membership, backed by Cognito groups.
 *
 * Cognito is the source of truth (docs/admin-portal-architecture.md D3), so this
 * module is a thin, typed wrapper: no membership state is mirrored in Postgres.
 * That means the portal and the authorizer can never disagree about who is an
 * admin.
 */

import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminUserGlobalSignOutCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { ROLE_GROUPS, ROLE_RANK, type AdminRole } from '../../shared/admin-auth';

const cognito = new CognitoIdentityProviderClient({});

function poolId(): string {
  const id = process.env.USER_POOL_ID;
  if (!id) throw new Error('USER_POOL_ID is not configured');
  return id;
}

export interface Member {
  sub: string;
  email: string;
  cognitoStatus: string;
  role: AdminRole;
  roleRank: number;
  groups: string[];
}

interface CognitoUserShape {
  Attributes?: Array<{ Name?: string; Value?: string }>;
  Username?: string;
  Enabled?: boolean;
  UserStatus?: string;
}

function attribute(user: CognitoUserShape, name: string): string | null {
  return user.Attributes?.find((a) => a.Name === name)?.Value ?? null;
}

/** Every member of an admin group, following pagination. */
export async function listGroupMembers(group: string): Promise<CognitoUserShape[]> {
  const users: CognitoUserShape[] = [];
  let token: string | undefined;

  do {
    const response = await cognito.send(
      new ListUsersInGroupCommand({
        UserPoolId: poolId(),
        GroupName: group,
        Limit: 60,
        NextToken: token,
      })
    );

    users.push(...(response.Users ?? []));
    token = response.NextToken;
  } while (token);

  return users;
}

export async function listMembers(): Promise<Member[]> {
  const bySub = new Map<string, Member>();

  for (const [group, role] of Object.entries(ROLE_GROUPS)) {
    const users = await listGroupMembers(group);

    for (const user of users) {
      const sub = attribute(user, 'sub') ?? user.Username ?? '';
      if (!sub) continue;

      const existing = bySub.get(sub);
      if (existing) {
        existing.groups.push(group);
        if (ROLE_RANK[role] > existing.roleRank) {
          existing.role = role;
          existing.roleRank = ROLE_RANK[role];
        }
        continue;
      }

      bySub.set(sub, {
        sub,
        email: attribute(user, 'email') ?? '(no email)',
        cognitoStatus: user.UserStatus ?? 'UNKNOWN',
        role,
        roleRank: ROLE_RANK[role],
        groups: [group],
      });
    }
  }

  return [...bySub.values()].sort(
    (a, b) => b.roleRank - a.roleRank || a.email.localeCompare(b.email)
  );
}

/** Resolve a Cognito user by email. Returns null when nobody matches. */
export async function findUserByEmail(
  email: string
): Promise<{ sub: string; email: string; status: string } | null> {
  // The filter is a Cognito expression, so strip characters that could break it.
  const safe = email.replace(/["\\]/g, '').trim();
  if (!safe) return null;

  const response = await cognito.send(
    new ListUsersCommand({
      UserPoolId: poolId(),
      Filter: `email = "${safe}"`,
      Limit: 5,
    })
  );

  const match = (response.Users ?? []).find(
    (user) => attribute(user, 'email')?.toLowerCase() === email.toLowerCase()
  );

  if (!match) return null;

  return {
    sub: attribute(match, 'sub') ?? match.Username ?? '',
    email: attribute(match, 'email') ?? email,
    status: match.UserStatus ?? 'UNKNOWN',
  };
}

/**
 * Create the Cognito user and let Cognito email the invitation.
 *
 * Cognito generates a temporary password and sends it with the pool's configured
 * sender; the person must choose their own password at first sign-in
 * (`NEW_PASSWORD_REQUIRED`). The portal never sees or sets a password, which is
 * what keeps a dedicated admin account safe for the product's magic-link path.
 */
export async function createInvitedUser(
  email: string
): Promise<{ sub: string; status: string }> {
  const created = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: poolId(),
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
      // Do NOT suppress the message: the invitation *is* the delivery.
      DesiredDeliveryMediums: ['EMAIL'],
    })
  );

  return {
    sub: attribute(created.User ?? {}, 'sub') ?? created.User?.Username ?? '',
    status: created.User?.UserStatus ?? 'FORCE_CHANGE_PASSWORD',
  };
}

export async function getGroupsForUser(sub: string): Promise<string[]> {
  const response = await cognito.send(
    new AdminGetUserCommand({ UserPoolId: poolId(), Username: sub })
  );

  // AdminGetUser does not return groups; use the explicit call.
  void response;

  const groups = await cognito.send(
    new AdminListGroupsForUserCommand({ UserPoolId: poolId(), Username: sub })
  );

  return (groups.Groups ?? []).map((group) => group.GroupName ?? '').filter(Boolean);
}

export async function addToGroup(sub: string, group: string): Promise<void> {
  await cognito.send(
    new AdminAddUserToGroupCommand({ UserPoolId: poolId(), Username: sub, GroupName: group })
  );
}

export async function removeFromGroup(sub: string, group: string): Promise<void> {
  await cognito.send(
    new AdminRemoveUserFromGroupCommand({ UserPoolId: poolId(), Username: sub, GroupName: group })
  );
}

/**
 * Invalidate the user's refresh tokens.
 *
 * Group membership is baked into issued tokens, so without this a demoted or
 * removed member keeps their old privileges until the token expires (up to an
 * hour). Signing out forces re-authentication against current groups.
 */
export async function globalSignOut(sub: string): Promise<void> {
  try {
    await cognito.send(
      new AdminUserGlobalSignOutCommand({ UserPoolId: poolId(), Username: sub })
    );
  } catch (error) {
    // Do not fail the membership change because the sign-out did: the role
    // change is the security-relevant part, and this is best effort.
    console.error(`Global sign-out failed for ${sub}:`, error);
  }
}

/** How many owners exist — used to refuse removing the last one. */
export async function countOwners(): Promise<number> {
  return (await listGroupMembers('tw-owner')).length;
}
