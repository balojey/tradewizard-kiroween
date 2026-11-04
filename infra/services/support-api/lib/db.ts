/**
 * Short-lived Postgres client for one support request.
 *
 * One connection per invocation: support volume is low, and a statement timeout
 * keeps a bad query from pinning a connection or degrading the product database.
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
