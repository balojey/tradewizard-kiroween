/**
 * Postgres client for the copilot.
 *
 * Read-only by construction, not by grant: this Lambda uses the same database
 * credentials as the rest of the portal (the deployment has one application
 * user), so the guarantee comes from what is in this package — one `withClient`
 * and only SELECT helpers, with no mutation function anywhere in the bundle.
 * A dedicated read-only DB role is a worthwhile future hardening step; until
 * then, do not add a write helper here.
 *
 * The statement timeout is deliberately tighter than the admin API's: an
 * unbounded copilot query is a bug, not a slow page.
 */

import type { Client } from 'pg';
import { getConnectionString } from '../../shared/db';

const STATEMENT_TIMEOUT_MS = 6_000;

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const { Client: PgClient } = await import('pg');
  const connectionString = await getConnectionString();

  const client = new PgClient({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}
