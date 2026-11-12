/**
 * Runtime settings retrieval.
 *
 * Settings are the shortest path from "read something" to "change behaviour",
 * so only admin+ may retrieve them, the list is capped at seven keys, and the
 * record carries the declared consumer so an answer can name the blast radius.
 *
 * See docs/plans/warden-ai-copilot.md §5 and §9.
 */

import type { Client } from 'pg';
import { SETTINGS } from '../../shared/settings';
import type { RetrievedRecord } from '../types';

export const SETTING_LIMIT = 7;

export async function retrieveSettings(
  client: Client,
  options: { keys?: string[]; limit?: number }
): Promise<RetrievedRecord[]> {
  const requested = (options.keys ?? []).filter((key) => key in SETTINGS);
  const keys = (requested.length > 0 ? requested : Object.keys(SETTINGS)).slice(
    0,
    Math.min(options.limit ?? SETTING_LIMIT, SETTING_LIMIT)
  );

  if (keys.length === 0) return [];

  const result = await client.query<{
    key: string;
    value: unknown;
    updatedBy: string | null;
    updatedAt: Date | string | null;
  }>(
    `
    SELECT key, value, updated_by AS "updatedBy", updated_at AS "updatedAt"
    FROM system_settings
    WHERE key = ANY($1::text[])
    ORDER BY key
    LIMIT $2
    `,
    [keys, keys.length]
  );

  const stored = new Map(result.rows.map((row) => [row.key, row]));

  return keys.map((key): RetrievedRecord => {
    const definition = SETTINGS[key];
    const row = stored.get(key);

    return {
      type: 'setting',
      id: key,
      label: `Setting: ${key}`,
      url: '/settings',
      data: {
        key,
        value: row && row.value !== null ? row.value : definition.defaultValue,
        defaultValue: definition.defaultValue,
        type: definition.type,
        description: definition.description,
        consumer: definition.consumer,
        updatedBy: row?.updatedBy ?? null,
        updatedAt: row?.updatedAt ? iso(row.updatedAt) : null,
        // A stored value is a real change; a missing row means "the default is
        // in force", which is a different fact and matters in an incident.
        source: row ? 'stored' : 'default',
      },
    };
  });
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
