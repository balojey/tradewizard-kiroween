/**
 * Runtime settings endpoints (owner only).
 *
 * The GET surfaces each setting's consumer, so the UI can show the blast radius
 * next to the switch rather than pretending settings are inert.
 */

import { z } from 'zod';
import { withAudit } from '../lib/audit';
import { withClient } from '../lib/db';
import { HttpError, json } from '../lib/responses';
import type { AdminRoute, RouteContext } from '../lib/router';
import { requireFreshAuth } from '../../shared/admin-auth';
import { listSettings, setSetting, SETTINGS } from '../../shared/settings';

const updateSchema = z.object({
  value: z.union([z.boolean(), z.string().trim().max(500)]),
  reason: z.string().trim().min(8, 'Reason must be at least 8 characters').max(500),
});

export const settingsRoutes: AdminRoute[] = [
  {
    method: 'GET',
    path: '/admin/settings',
    minimumRole: 'admin',
    handler: async ({ event }: RouteContext) => {
      return json(event, 200, await listSettings());
    },
  },
  {
    method: 'PUT',
    path: '/admin/settings/{key}',
    minimumRole: 'owner',
    handler: async ({ event, identity, params }: RouteContext) => {
      requireFreshAuth(identity);

      const key = params.key;
      const definition = key ? SETTINGS[key] : undefined;
      if (!definition) {
        throw new HttpError(404, 'NOT_FOUND', `Unknown setting: ${key ?? '(none)'}`);
      }

      let body: { value: boolean | string; reason: string };
      try {
        body = updateSchema.parse(JSON.parse(event.body ?? '{}'));
      } catch (error) {
        const first = (error as { issues?: Array<{ message: string }> }).issues?.[0];
        throw new HttpError(400, 'BAD_REQUEST', first?.message ?? 'Invalid request body');
      }

      // Type-check against the declared definition; a string in a boolean slot
      // would be coerced silently otherwise.
      if (typeof body.value !== definition.type) {
        throw new HttpError(400, 'BAD_REQUEST', `"${key}" expects a ${definition.type}`);
      }

      if (definition.allowed && !definition.allowed.includes(String(body.value))) {
        throw new HttpError(
          400,
          'BAD_REQUEST',
          `"${key}" must be one of: ${definition.allowed.map((value) => `"${value}"`).join(', ')}`
        );
      }

      return withClient(async (client) => {
        const existing = (await listSettings()).find((row) => row.key === key);

        const result = await withAudit(
          client,
          {
            actor: identity,
            action: 'settings.update',
            targetType: 'setting',
            targetId: key,
            reason: body.reason,
            before: { value: existing?.value ?? definition.defaultValue },
            requestId: event.requestContext?.requestId ?? null,
            ip: event.requestContext?.identity?.sourceIp ?? null,
          },
          async () => {
            await setSetting(client, key, body.value, identity.email);
            return {
              result: { key, value: body.value, consumer: definition.consumer },
              after: { value: body.value },
            };
          }
        );

        return json(event, 200, result);
      });
    },
  },
];
