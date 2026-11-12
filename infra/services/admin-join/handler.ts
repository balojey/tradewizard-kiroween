/**
 * Public join API.
 *
 * The only unauthenticated surface in the Warden, kept deliberately small and
 * separate from `admin-api`:
 *
 *   POST /join/lookup    { token }              → role + link state
 *   POST /join/register  { token, email }       → creates a dedicated admin account
 *
 * Why a separate Lambda (docs/warden-invite-links-plan.md §2.8):
 * - the authenticated router keeps its property that every route declares a
 *   minimum role, so the RBAC matrix test stays meaningful;
 * - this function gets a tiny IAM policy (create user, set temp password, add
 *   group) and cannot read the portal's data;
 * - a flood here cannot exhaust the portal API's concurrency.
 *
 * What it never does: read members, move money, touch S3, log a token, or expose
 * an address that the caller did not type.
 */

import { z } from 'zod';
import { withClient } from '../admin-api/lib/db';
import { completeAudit, writeSystemAuditLog } from '../admin-api/lib/audit';
import { HttpError, errorResponse, json } from '../admin-api/lib/responses';
import { parseBody } from '../admin-api/lib/validation';
import type { AdminApiEvent, ApiResponse } from '../admin-api/lib/types';
import { AdminEmailError, toAdminEmail } from '../shared/admin-email';
import { groupForRole } from '../shared/admin-roles';
import { sendAdminInvitation } from '../shared/admin-invite-email';
import {
  findInviteLinkByTokenHash,
  recordInviteRedemption,
  releaseInviteUse,
  reserveInviteUse,
} from '../shared/invite-links';
import {
  hashInviteToken,
  inviteLinkStatus,
  looksLikeInviteToken,
} from '../shared/invite-token';
import { addToGroup, createInvitedAdmin, findUserByEmail } from './lib/cognito';
import { enforceLookupRateLimit, enforceRegisterRateLimit } from './lib/rate-limit';
import { generateTemporaryPassword } from '../shared/temp-password';

const lookupSchema = z.object({
  token: z.string().trim().min(1).max(200),
});

const registerSchema = z.object({
  token: z.string().trim().min(1).max(200),
  email: z.string().trim().min(3).max(254),
  fullName: z.string().trim().min(1).max(100).optional(),
});

/** Internal signal: the account exists but the invitation could not be sent. */
class InvitationDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvitationDeliveryError';
  }
}

function notFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', 'That invitation link is not valid.');
}

function inactive(status: string): HttpError {
  const message =
    status === 'revoked'
      ? 'That invitation link was revoked. Ask the owner for a new one.'
      : status === 'expired'
        ? 'That invitation link has expired. Ask the owner for a new one.'
        : 'That invitation link has already been used up. Ask the owner for a new one.';

  return new HttpError(409, 'CONFLICT', message, { status });
}

export async function handler(event: AdminApiEvent): Promise<ApiResponse> {
  try {
    if (event.httpMethod === 'POST' && event.path === '/join/lookup') {
      return await lookup(event);
    }

    if (event.httpMethod === 'POST' && event.path === '/join/register') {
      return await register(event);
    }

    return errorResponse(event, 404, 'NOT_FOUND', 'Unknown join route');
  } catch (error) {
    return toErrorResponse(event, error);
  }
}

async function lookup(event: AdminApiEvent): Promise<ApiResponse> {
  const input = parseBody(lookupSchema, event.body);

  // A malformed token cannot name a link; answering 404 avoids a database trip
  // and keeps the response identical to an unknown well-formed token.
  if (!looksLikeInviteToken(input.token)) {
    throw notFound();
  }

  await enforceLookupRateLimit(event);

  const link = await withClient((client) =>
    findInviteLinkByTokenHash(client, hashInviteToken(input.token))
  );

  if (!link) throw notFound();

  return json(event, 200, {
    status: inviteLinkStatus(link),
    role: link.role,
    expiresAt: link.expiresAt,
    remainingUses: Math.max(link.maxUses - link.useCount, 0),
  });
}

async function register(event: AdminApiEvent): Promise<ApiResponse> {
  const input = parseBody(registerSchema, event.body);

  if (!looksLikeInviteToken(input.token)) {
    throw notFound();
  }

  let alias: ReturnType<typeof toAdminEmail>;
  try {
    alias = toAdminEmail(input.email);
  } catch (error) {
    if (error instanceof AdminEmailError) {
      throw new HttpError(400, 'BAD_REQUEST', error.message);
    }
    throw error;
  }

  return withClient(async (client) => {
    const link = await findInviteLinkByTokenHash(client, hashInviteToken(input.token));
    if (!link) throw notFound();

    const status = inviteLinkStatus(link);
    if (status !== 'active') throw inactive(status);

    await enforceRegisterRateLimit(event, link.id);

    const existing = await findUserByEmail(alias.adminEmail);
    if (existing) {
      throw new HttpError(
        409,
        'CONFLICT',
        'An account already exists for that address. Sign in instead, or ask the owner to resend the invitation.',
        { adminEmail: alias.adminEmail }
      );
    }

    // Evidence before side effects: an account that exists without an audit row
    // is exactly the situation the portal must never be in (§7.3).
    const auditId = await writeSystemAuditLog(client, {
      actorSub: `invite-link:${link.id}`,
      actorEmail: alias.adminEmail,
      action: 'admin.member.self_register',
      targetType: 'invite_link',
      targetId: link.id,
      reason: `Registered through invite link ${link.id} (${link.role})`,
      before: { role: link.role, email: alias.adminEmail, aliasChanged: alias.changed },
      ip: event.requestContext?.identity?.sourceIp ?? null,
      requestId: event.requestContext?.requestId ?? null,
    });

    let auditCompleted = false;
    let reserved = false;
    let accountCreated = false;

    const finish = async (
      completion: { status: 'succeeded' | 'failed'; after?: Record<string, unknown> | null; error?: string | null }
    ) => {
      await completeAudit(client, auditId, completion);
      auditCompleted = true;
    };

    try {
      reserved = Boolean(await reserveInviteUse(client, link.id));

      if (!reserved) {
        // Lost the race for the last slot, or it was revoked between the read
        // and the update. Re-read so the invitee sees the real reason.
        const current = await findInviteLinkByTokenHash(client, hashInviteToken(input.token));
        throw inactive(current ? inviteLinkStatus(current) : 'expired');
      }

      const temporaryPassword = generateTemporaryPassword();

      const created = await createInvitedAdmin({
        email: alias.adminEmail,
        temporaryPassword,
        fullName: input.fullName,
      });
      accountCreated = true;

      await addToGroup(created.sub, groupForRole(link.role));

      await recordInviteRedemption(client, {
        linkId: link.id,
        cognitoSub: created.sub,
        email: alias.adminEmail,
      });

      try {
        await sendAdminInvitation({
          to: alias.adminEmail,
          role: link.role,
          temporaryPassword,
          expiresAt: link.expiresAt,
          idempotencyKey: `warden-invite-${created.sub}`,
        });
      } catch (firstError) {
        console.error('Invitation email failed; retrying once', {
          sub: created.sub,
          error: (firstError as Error).message,
        });

        try {
          await sendAdminInvitation({
            to: alias.adminEmail,
            role: link.role,
            temporaryPassword,
            expiresAt: link.expiresAt,
            idempotencyKey: `warden-invite-${created.sub}`,
          });
        } catch (secondError) {
          throw new InvitationDeliveryError((secondError as Error).message);
        }
      }

      await finish({
        status: 'succeeded',
        after: {
          sub: created.sub,
          email: alias.adminEmail,
          role: link.role,
          emailSent: true,
        },
      });

      return json(event, 201, {
        adminEmail: alias.adminEmail,
        role: link.role,
        status: 'invited',
      });
    } catch (error) {
      // The account exists, so the use is genuinely consumed: releasing it would
      // let the same slot mint a second account. A delivery failure is reported
      // as such and recovered by an owner.
      if (!accountCreated && reserved) {
        await releaseInviteUse(client, link.id).catch((releaseError: unknown) => {
          console.error('Could not release invite use', {
            linkId: link.id,
            error: (releaseError as Error).message,
          });
        });
      }

      if (!auditCompleted) {
        await finish({
          status: 'failed',
          after: accountCreated
            ? { email: alias.adminEmail, role: link.role, accountCreated: true }
            : null,
          error: (error as Error).message,
        });
      }

      if (error instanceof InvitationDeliveryError) {
        return errorResponse(
          event,
          502,
          'UPSTREAM_FAILED',
          'Your account was created, but the invitation email could not be sent. Ask the owner to resend it.',
          { adminEmail: alias.adminEmail, accountCreated: true, emailSent: false }
        );
      }

      throw error;
    }
  });
}

function toErrorResponse(event: AdminApiEvent, error: unknown): ApiResponse {
  if (error instanceof AdminEmailError) {
    return errorResponse(event, 400, 'BAD_REQUEST', error.message);
  }

  if (error instanceof HttpError) {
    return errorResponse(event, error.statusCode, error.code, error.message, error.details);
  }

  // Never leak internals; always leave a diagnostic in CloudWatch. Tokens and
  // passwords are never part of this shape.
  console.error(
    JSON.stringify({
      metric: 'AdminJoinError',
      path: event.path,
      method: event.httpMethod,
      requestId: event.requestContext?.requestId,
      error: (error as Error).message,
      stack: (error as Error).stack,
    })
  );

  return errorResponse(event, 500, 'INTERNAL', 'Something went wrong. Try again.');
}
