/**
 * Support inbox routes (portal).
 *
 * Operating rules (docs/support-tickets-plan.md §4.4, §7):
 * - claiming is conditional, so two operators cannot both hold a ticket;
 * - a reply to someone else's ticket is refused unless the caller is admin+,
 *   because a customer must not receive two contradictory answers;
 * - the reply transaction locks the ticket row, re-reads it, and only then
 *   sends, so simultaneous replies serialise;
 * - status/priority/assignment changes require a reason and are audited;
 *   replies are audited by authorship (a reason prompt there would be theatre);
 * - bookkeeping changes never email the customer.
 */

import { withAudit } from '../lib/audit';
import { withClient } from '../lib/db';
import { parsePagination } from '../lib/pagination';
import { HttpError, json } from '../lib/responses';
import {
  parseBody,
  supportReplySchema,
  supportUpdateSchema,
} from '../lib/validation';
import type { AdminRoute, RouteContext } from '../lib/router';
import {
  ROLE_RANK,
  type AdminIdentity,
} from '../../shared/admin-auth';
import { getSettingSync, warmSettings } from '../../shared/settings';
import {
  sendSupportReply,
  sendSupportResolved,
} from '../../shared/support-email';
import { issueThreadToken } from '../../shared/support-tickets';
import * as queries from '../queries/support';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUSES = new Set(['open', 'pending', 'resolved', 'closed']);
const TOPICS = new Set(['analysis', 'portfolio', 'billing', 'login', 'data', 'other']);
const DEFAULT_SLA_HOURS = 24;

function ticketId(params: Record<string, string>): string {
  const id = params.id;
  if (!id || !UUID_PATTERN.test(id)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid ticket id');
  }
  return id;
}

async function slaHours(): Promise<number> {
  await warmSettings(['support_first_response_target_hours']);

  const raw = Number(getSettingSync('support_first_response_target_hours'));
  return Number.isFinite(raw) && raw > 0 && raw <= 168 ? raw : DEFAULT_SLA_HOURS;
}

function canOverride(identity: AdminIdentity): boolean {
  return ROLE_RANK[identity.role] >= ROLE_RANK.admin;
}

function emailIdempotencyKey(ref: string, messageId: string): string {
  return `support-reply-${ref}-${messageId}`;
}

export const supportRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/support/summary',
    minimumRole: 'support',
    handler: async ({ event }: RouteContext) => {
      const hours = await slaHours();
      const counts = await withClient((client) => queries.summaryCounts(client, hours));

      return json(event, 200, { ...counts, slaHours: hours });
    },
  },

  {
    method: 'GET',
    path: '/admin/support/tickets',
    minimumRole: 'support',
    handler: async ({ event, identity }: RouteContext) => {
      const params = event.queryStringParameters ?? {};
      const status = params.status && STATUSES.has(params.status) ? params.status : undefined;
      const topic = params.topic && TOPICS.has(params.topic) ? params.topic : undefined;

      const assignee = params.assignee ?? 'all';
      const unassignedOnly = assignee === 'unassigned';
      const assigneeSub = assignee === 'me' ? identity.sub : undefined;

      const hours = await slaHours();

      const page = await withClient((client) =>
        queries.listTickets(
          client,
          {
            status,
            topic,
            unassignedOnly,
            assigneeSub,
            q: params.q?.trim() || undefined,
          },
          parsePagination(params),
          hours
        )
      );

      return json(event, 200, page.items, { nextCursor: page.nextCursor });
    },
  },

  {
    method: 'GET',
    path: '/admin/support/tickets/{id}',
    minimumRole: 'support',
    handler: async ({ event, params }: RouteContext) => {
      const id = ticketId(params);

      const payload = await withClient(async (client) => {
        const ticket = await queries.getTicketById(client, id);
        if (!ticket) throw new HttpError(404, 'NOT_FOUND', 'Ticket not found');

        const [messages, requester] = await Promise.all([
          queries.listMessages(client, id),
          queries.requesterInfo(client, ticket.userId, ticket.requesterEmail),
        ]);

        return {
          ticket,
          messages,
          requester,
          canReply: ticket.status !== 'closed',
        };
      });

      return json(event, 200, payload);
    },
  },

  {
    method: 'POST',
    path: '/admin/support/tickets/{id}/claim',
    minimumRole: 'support',
    handler: async ({ event, identity, params }: RouteContext) => {
      const id = ticketId(params);

      return withClient(async (client) => {
        const claimed = await withAudit(
          client,
          {
            actor: identity,
            action: 'support.ticket.claim',
            targetType: 'support_ticket',
            targetId: id,
            reason: 'Claiming the ticket for triage',
            ip: event.requestContext?.identity?.sourceIp ?? null,
            requestId: event.requestContext?.requestId ?? null,
          },
          async () => {
            const won = await queries.claimTicket(client, id, identity.sub);
            if (!won) {
              const current = await queries.getTicketById(client, id);
              throw new HttpError(
                409,
                'ALREADY_CLAIMED',
                current?.assignedAdminSub === identity.sub
                  ? 'You already hold this ticket'
                  : 'Another operator has this ticket',
                { assignedAdminSub: current?.assignedAdminSub ?? null }
              );
            }

            return { result: { assignedAdminSub: identity.sub }, after: { assignedAdminSub: identity.sub } };
          }
        );

        return json(event, 200, claimed);
      });
    },
  },

  {
    method: 'POST',
    path: '/admin/support/tickets/{id}/release',
    minimumRole: 'support',
    handler: async ({ event, identity, params }: RouteContext) => {
      const id = ticketId(params);
      const force = canOverride(identity);

      return withClient(async (client) => {
        await withAudit(
          client,
          {
            actor: identity,
            action: 'support.ticket.release',
            targetType: 'support_ticket',
            targetId: id,
            reason: force ? 'Admin released the ticket' : 'Releasing my ticket',
            ip: event.requestContext?.identity?.sourceIp ?? null,
            requestId: event.requestContext?.requestId ?? null,
          },
          async () => {
            const released = await queries.releaseTicket(client, id, identity.sub, force);
            if (!released) {
              throw new HttpError(
                409,
                'NOT_YOURS',
                'This ticket is assigned to someone else'
              );
            }

            return { result: null, after: { assignedAdminSub: null } };
          }
        );

        return json(event, 200, { assignedAdminSub: null });
      });
    },
  },

  {
    method: 'POST',
    path: '/admin/support/tickets/{id}/messages',
    minimumRole: 'support',
    handler: async ({ event, identity, params }: RouteContext) => {
      const id = ticketId(params);
      const input = parseBody(supportReplySchema, event.body);

      // The row lock makes "check assignment, insert, maybe rotate token" atomic
      // with respect to another operator doing the same thing.
      const staged = await withClient(async (client) => {
        const ticket = await queries.lockTicket(client, id);
        if (!ticket) throw new HttpError(404, 'NOT_FOUND', 'Ticket not found');

        if (ticket.status === 'closed') {
          throw new HttpError(
            409,
            'TICKET_CLOSED',
            'This ticket is closed. Reopen it before replying.'
          );
        }

        if (
          ticket.assignedAdminSub &&
          ticket.assignedAdminSub !== identity.sub &&
          !canOverride(identity)
        ) {
          throw new HttpError(
            409,
            'NOT_YOURS',
            'Another operator holds this ticket. Claim or reassign it first.',
            { assignedAdminSub: ticket.assignedAdminSub }
          );
        }

        const isInternal = input.internal === true;

        // Anti-burst: a second reply inside a minute is stored but not emailed,
        // so fixing a typo does not send two messages. When suppressed we also
        // do not rotate the token — the customer's existing link must keep
        // working, since they received no new one.
        const recentlyNotified =
          ticket.lastCustomerNotifiedAt !== null &&
          Date.now() - new Date(ticket.lastCustomerNotifiedAt).getTime() < 60_000;

        const suppressEmail = isInternal || recentlyNotified;

        // Replies are audited by authorship — the message row records who
        // wrote it, and the audit row records that a reply was sent at all.
        const written = await withAudit(
          client,
          {
            actor: identity,
            action: isInternal ? 'support.ticket.note' : 'support.ticket.reply',
            targetType: 'support_ticket',
            targetId: id,
            reason: isInternal
              ? 'Added an internal note'
              : 'Replied to the customer',
            ip: event.requestContext?.identity?.sourceIp ?? null,
            requestId: event.requestContext?.requestId ?? null,
          },
          async () => {
            const message = await queries.insertAdminMessage(client, {
              ticketId: id,
              adminSub: identity.sub,
              adminEmail: identity.email,
              body: input.body,
              internal: isInternal,
              requestId: input.requestId ?? null,
            });

            // Additive: earlier emails keep working, so a customer who scrolls
            // back to the first one is not punished for it.
            const token = suppressEmail ? null : await issueThreadToken(client, id);

            if (!ticket.assignedAdminSub) {
              // Claim on first reply: an unassigned ticket belongs to whoever
              // answered it.
              await queries.claimTicket(client, id, identity.sub);
            }

            return {
              result: { message, token },
              after: { messageId: message.id, internal: isInternal },
            };
          }
        );

        return {
          ticket,
          message: written.message,
          token: written.token,
          suppressEmail,
          isInternal,
        };
      });

      let emailSent = false;
      if (staged.token) {
        try {
          await sendSupportReply({
            to: staged.ticket.requesterEmail,
            ref: staged.ticket.ref,
            token: staged.token,
            subject: staged.ticket.subject,
            body: input.body,
            idempotencyKey: emailIdempotencyKey(staged.ticket.ref, staged.message.id),
          });
          emailSent = true;
        } catch (error) {
          console.error('Support reply email failed', {
            ref: staged.ticket.ref,
            error: (error as Error).message,
          });
        }
      }

      await withClient((client) =>
        queries.recordReply(client, {
          ticketId: id,
          internal: staged.isInternal,
          emailed: emailSent,
        })
      );

      return json(event, 201, {
        message: staged.message,
        emailSent,
        suppressed: staged.suppressEmail && !staged.isInternal,
        internal: staged.isInternal,
      });
    },
  },

  {
    method: 'PUT',
    path: '/admin/support/tickets/{id}',
    minimumRole: 'support',
    handler: async ({ event, identity, params }: RouteContext) => {
      const id = ticketId(params);
      const input = parseBody(supportUpdateSchema, event.body);

      if (input.assignedAdminSub !== undefined && !canOverride(identity)) {
        throw new HttpError(
          403,
          'FORBIDDEN',
          'Only admins can reassign a ticket'
        );
      }

      const updated = await withClient(async (client) => {
        const before = await queries.getTicketById(client, id);
        if (!before) throw new HttpError(404, 'NOT_FOUND', 'Ticket not found');

        return withAudit(
          client,
          {
            actor: identity,
            action: 'support.ticket.update',
            targetType: 'support_ticket',
            targetId: id,
            reason: input.reason,
            before: {
              status: before.status,
              priority: before.priority,
              assignedAdminSub: before.assignedAdminSub,
            },
            ip: event.requestContext?.identity?.sourceIp ?? null,
            requestId: event.requestContext?.requestId ?? null,
          },
          async () => {
            await queries.updateTicket(client, id, {
              status: input.status,
              priority: input.priority,
            });

            if (input.assignedAdminSub !== undefined) {
              await queries.assignTicket(client, id, input.assignedAdminSub);
            }

            return {
              result: {
                status: input.status ?? before.status,
                priority: input.priority ?? before.priority,
                assignedAdminSub:
                  input.assignedAdminSub === undefined
                    ? before.assignedAdminSub
                    : input.assignedAdminSub,
              },
              after: {
                status: input.status ?? before.status,
                priority: input.priority ?? before.priority,
                assignedAdminSub:
                  input.assignedAdminSub === undefined
                    ? before.assignedAdminSub
                    : input.assignedAdminSub,
              },
            };
          }
        );
      });

      let resolvedEmailSent = false;
      if (input.status === 'resolved') {
        const final = await withClient((client) => queries.getTicketById(client, id));

        if (final) {
          try {
            await sendSupportResolved({
              to: final.requesterEmail,
              ref: final.ref,
              subject: final.subject,
            });
            resolvedEmailSent = true;
          } catch (error) {
            console.error('Support resolved email failed', {
              ticketId: id,
              error: (error as Error).message,
            });
          }
        }
      }

      return json(event, 200, { ...updated, resolvedEmailSent });
    },
  },
];
