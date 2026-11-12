/**
 * Runtime settings.
 *
 * Two rules make this trustworthy:
 *
 * 1. **Every setting has a consumer in the same change.** A switch that stores a
 *    value nobody reads is worse than no switch, because it looks like control.
 * 2. **A missing or unreadable row never changes behaviour.** Each read falls
 *    back to the declared default, and a database error is logged and ignored.
 *
 * Reads are cached for 60 seconds per container, so a product path does not pay
 * a database round trip per request.
 */

import type { Client } from 'pg';
import { getConnectionString } from './db';

export interface SettingDefinition {
  key: string;
  type: 'boolean' | 'string';
  defaultValue: boolean | string;
  description: string;
  /** What reads this, so the UI can be honest about the blast radius. */
  consumer: string;
  /** When present, the only values a caller may store. */
  allowed?: string[];
}

export const SETTINGS: Record<string, SettingDefinition> = {
  analysis_paused: {
    key: 'analysis_paused',
    type: 'boolean',
    defaultValue: false,
    description: 'Stop accepting new analysis requests. Existing schedules keep running.',
    consumer: 'analysis-request',
  },
  ai_provider: {
    key: 'ai_provider',
    type: 'string',
    defaultValue: '',
    description:
      'Override the AI provider without redeploying. Empty follows AI_PROVIDER from the deployment.',
    consumer: 'ai-provider',
    allowed: ['', 'bedrock', 'nebius'],
  },
  pm_activations_paused: {
    key: 'pm_activations_paused',
    type: 'boolean',
    defaultValue: false,
    description:
      'Refuse new portfolio-manager activations. Existing sessions keep trading unless the kill switch is used.',
    consumer: 'portfolio-activation',
  },
  support_first_response_target_hours: {
    key: 'support_first_response_target_hours',
    type: 'string',
    defaultValue: '24',
    description:
      'Target hours to first reply. Drives the overdue flag in the support inbox.',
    consumer: 'admin support inbox',
    allowed: ['4', '8', '12', '24', '48', '72'],
  },
  newsletter_enabled: {
    key: 'newsletter_enabled',
    type: 'boolean',
    defaultValue: true,
    description:
      'Offer the newsletter: hides the sign-in prompt and refuses new opt-ins. Unsubscribing always works.',
    consumer: 'newsletter-api',
  },
  support_enabled: {
    key: 'support_enabled',
    type: 'boolean',
    defaultValue: true,
    description:
      'Accept new support requests from the product. When off, the form hides and the endpoint returns 503.',
    consumer: 'support-api',
  },
  analysis_pause_message: {
    key: 'analysis_pause_message',
    type: 'string',
    defaultValue:
      'Analysis is temporarily paused while we perform maintenance. Please try again shortly.',
    description: 'Shown to users when analysis is paused.',
    consumer: 'analysis-request',
  },
  // ─── Warden Copilot ─────────────────────────────────────────────────────────
  // The copilot is read-only by construction (it has no mutation route and no
  // tool loop), but it still spends money, so it gets its own kill switch.
  // Turning this off hides the UI panels and makes the API answer 503.
  copilot_enabled: {
    key: 'copilot_enabled',
    type: 'boolean',
    defaultValue: true,
    description:
      'Offer the read-only Warden Copilot. When off, the portal hides every Ask Warden panel and the API refuses requests.',
    consumer: 'admin-api (copilot routes) + admin-copilot',
  },
  copilot_daily_limit: {
    key: 'copilot_daily_limit',
    type: 'string',
    defaultValue: '100',
    description:
      'Maximum copilot requests per operator per UTC day. Raise cautiously: every request is one model call.',
    consumer: 'admin-api (copilot routes)',
    allowed: ['25', '50', '100', '200', '500'],
  },
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

/**
 * Synchronous read of an already-warmed setting.
 *
 * Model factories are synchronous, so they cannot await a database read. The
 * lambda warms the cache at invocation start; until then (and if warming fails)
 * this returns the declared default, which means "follow the deployment".
 */
export function getSettingSync(key: string): boolean | string {
  const definition = SETTINGS[key];
  if (!definition) {
    throw new Error(`Unknown setting: ${key}`);
  }

  const cached = cache.get(key);
  return cached ? (cached.value as boolean | string) : definition.defaultValue;
}

/** Populate the cache for synchronous consumers. Never throws. */
export async function warmSettings(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await getSetting(key);
      } catch (error) {
        console.error(`Settings: warm-up failed for "${key}"`, error);
      }
    })
  );
}

/** Test seam. */
export function resetSettingsCacheForTests(): void {
  cache.clear();
}

function coerce(definition: SettingDefinition, raw: unknown): boolean | string {
  if (definition.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') return raw === 'true';
    return definition.defaultValue;
  }

  if (typeof raw === 'string') return raw;
  return definition.defaultValue;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const { Client: PgClient } = await import('pg');
  const connectionString = await getConnectionString();
  const client = new PgClient({ connectionString, ssl: { rejectUnauthorized: false } });

  await client.connect();

  try {
    await client.query(`SET statement_timeout = 3000`);
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Read one setting, falling back to its default on any failure. */
export async function getSetting(key: string): Promise<boolean | string> {
  const definition = SETTINGS[key];
  if (!definition) {
    throw new Error(`Unknown setting: ${key}`);
  }

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as boolean | string;
  }

  try {
    const row = await withClient(async (client) => {
      const result = await client.query(
        'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
        [key]
      );
      return result.rows[0]?.value;
    });

    const value = row === undefined || row === null ? definition.defaultValue : coerce(definition, row);
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    // Never let a settings read break the product path.
    console.error(`Settings: failed to read "${key}"; using the default`, error);
    return definition.defaultValue;
  }
}

export interface SettingRow extends SettingDefinition {
  value: boolean | string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export async function listSettings(): Promise<SettingRow[]> {
  const rows = await withClient(async (client) => {
    const result = await client.query(
      `SELECT key, value, updated_by AS "updatedBy", updated_at AS "updatedAt" FROM system_settings`
    );
    return result.rows as Array<{
      key: string;
      value: unknown;
      updatedBy: string | null;
      updatedAt: string | null;
    }>;
  });

  return Object.values(SETTINGS).map((definition) => {
    const stored = rows.find((row) => row.key === definition.key);

    return {
      ...definition,
      value: stored ? coerce(definition, stored.value) : definition.defaultValue,
      updatedAt: stored?.updatedAt ?? null,
      updatedBy: stored?.updatedBy ?? null,
    };
  });
}

export async function setSetting(
  client: Client,
  key: string,
  value: boolean | string,
  actorEmail: string
): Promise<void> {
  await client.query(
    `
    INSERT INTO system_settings (key, value, description, updated_by, updated_at)
    VALUES ($1, $2::jsonb, $3, $4, now())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    `,
    [key, JSON.stringify(value), SETTINGS[key]?.description ?? null, actorEmail]
  );

  // Other containers converge within the cache TTL; this one immediately.
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}
