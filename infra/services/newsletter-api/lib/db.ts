/**
 * Short-lived Postgres client for one newsletter request.
 *
 * Same shape as the other product services: one connection per invocation, with
 * a statement timeout so a bad query cannot pin the database.
 */

import type { Client } from 'pg';
import { getConnectionString } from '../../shared/db';

const STATEMENT_TIMEOUT_MS = 8_000;

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
