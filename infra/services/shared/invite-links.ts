/**
 * Invite-link persistence.
 *
 * Shared by the owner routes (`admin-api`) and the public join Lambda
 * (`admin-join`) so there is exactly one implementation of "reserve a use" and
 * one definition of a link's columns. Cognito groups remain the source of truth
 * for membership; these tables record only how someone got in.
 */

import type { Client } from 'pg';
import type { AdminRole } from './admin-roles';

export interface InviteLinkRecord {
  id: string;
  role: AdminRole;
  createdBySub: string;
  createdByEmail: string;
  reason: string;
  expiresAt: Date;
  maxUses: number;
  useCount: number;
  revokedAt: Date | null;
  revokedBy: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  /** Populated by listInviteLinks only; a subquery, never a second round trip. */
  redemptionCount?: number;
}

export interface InviteRedemptionRecord {
  id: string;
  linkId: string;
  cognitoSub: string;
  email: string;
  createdAt: Date;
}

export interface CreateInviteLinkInput {
  id: string;
  tokenHash: string;
  role: AdminRole;
  createdBySub: string;
  createdByEmail: string;
  reason: string;
  expiresAt: Date;
  maxUses: number;
}

const LINK_COLUMNS = `
  id,
  role,
  created_by_sub AS "createdBySub",
  created_by_email AS "createdByEmail",
  reason,
  expires_at AS "expiresAt",
  max_uses AS "maxUses",
  use_count AS "useCount",
  revoked_at AS "revokedAt",
  revoked_by AS "revokedBy",
  last_used_at AS "lastUsedAt",
  created_at AS "createdAt"
`;

export async function createInviteLink(
  client: Client,
  input: CreateInviteLinkInput
): Promise<InviteLinkRecord> {
  const result = await client.query<InviteLinkRecord>(
    `
    INSERT INTO admin_invite_links
      (id, token_hash, role, created_by_sub, created_by_email, reason, expires_at, max_uses)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING ${LINK_COLUMNS}
    `,
    [
      input.id,
      input.tokenHash,
      input.role,
      input.createdBySub,
      input.createdByEmail,
      input.reason,
      input.expiresAt,
      input.maxUses,
    ]
  );

  return result.rows[0];
}

/** Links are few and operator-created; the bound keeps the response predictable. */
export async function listInviteLinks(client: Client): Promise<InviteLinkRecord[]> {
  const result = await client.query<InviteLinkRecord>(
    `
    SELECT ${LINK_COLUMNS},
           (SELECT count(*) FROM admin_invite_redemptions r WHERE r.link_id = l.id)::int
             AS "redemptionCount"
    FROM admin_invite_links l
    ORDER BY created_at DESC
    LIMIT 200
    `
  );

  return result.rows;
}

export async function findInviteLinkById(
  client: Client,
  id: string
): Promise<InviteLinkRecord | null> {
  const result = await client.query<InviteLinkRecord>(
    `SELECT ${LINK_COLUMNS} FROM admin_invite_links WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function findInviteLinkByTokenHash(
  client: Client,
  tokenHash: string
): Promise<InviteLinkRecord | null> {
  const result = await client.query<InviteLinkRecord>(
    `SELECT ${LINK_COLUMNS} FROM admin_invite_links WHERE token_hash = $1`,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}

/**
 * Mark revoked. Returns null when the link is missing or was already revoked, so
 * the caller can distinguish 404 from 409 without a second query.
 */
export async function revokeInviteLink(
  client: Client,
  id: string,
  revokedBy: string
): Promise<InviteLinkRecord | null> {
  const result = await client.query<InviteLinkRecord>(
    `
    UPDATE admin_invite_links
    SET revoked_at = now(), revoked_by = $2
    WHERE id = $1 AND revoked_at IS NULL
    RETURNING ${LINK_COLUMNS}
    `,
    [id, revokedBy]
  );

  return result.rows[0] ?? null;
}

/**
 * Atomically claim one use.
 *
 * The condition is evaluated by Postgres, so two concurrent registrations
 * cannot both take the last slot. Returns null when the link is unknown,
 * revoked, expired, or full — the caller re-reads it to say which.
 */
export async function reserveInviteUse(
  client: Client,
  id: string
): Promise<InviteLinkRecord | null> {
  const result = await client.query<InviteLinkRecord>(
    `
    UPDATE admin_invite_links
    SET use_count = use_count + 1, last_used_at = now()
    WHERE id = $1
      AND revoked_at IS NULL
      AND expires_at > now()
      AND use_count < max_uses
    RETURNING ${LINK_COLUMNS}
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

/**
 * Give back a use after a failed registration. Never below zero, so a double
 * compensation cannot fabricate capacity.
 */
export async function releaseInviteUse(client: Client, id: string): Promise<void> {
  await client.query(
    `UPDATE admin_invite_links SET use_count = GREATEST(use_count - 1, 0) WHERE id = $1`,
    [id]
  );
}

export async function recordInviteRedemption(
  client: Client,
  input: { linkId: string; cognitoSub: string; email: string }
): Promise<void> {
  await client.query(
    `
    INSERT INTO admin_invite_redemptions (link_id, cognito_sub, email)
    VALUES ($1, $2, $3)
    ON CONFLICT (cognito_sub) DO NOTHING
    `,
    [input.linkId, input.cognitoSub, input.email]
  );
}

export async function listInviteRedemptions(
  client: Client,
  linkId: string
): Promise<InviteRedemptionRecord[]> {
  const result = await client.query<InviteRedemptionRecord>(
    `
    SELECT id, link_id AS "linkId", cognito_sub AS "cognitoSub", email,
           created_at AS "createdAt"
    FROM admin_invite_redemptions
    WHERE link_id = $1
    ORDER BY created_at DESC
    LIMIT 200
    `,
    [linkId]
  );

  return result.rows;
}
