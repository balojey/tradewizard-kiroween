/**
 * Support housekeeping — hourly.
 *
 * Two jobs, both idempotent single statements:
 * 1. release claims that have gone quiet, so a ticket is never invisible work;
 * 2. close tickets that were resolved a week ago, so the inbox does not become
 *    an archive of stale rows nobody will reopen.
 *
 * No email is sent: closure is bookkeeping, and the resolution notice already
 * carried its own email. See docs/support-tickets-plan.md §4.4.
 */

import { Client } from 'pg';
import { getConnectionString } from '../shared/db';

const STALE_CLAIM_HOURS = 8;
const AUTO_CLOSE_DAYS = 7;

export async function handler(): Promise<{
  released: number;
  closed: number;
  tokensPurged: number;
}> {
  const client = new Client({
    connectionString: await getConnectionString(),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query('SET statement_timeout = 15000');

    const released = await client.query(
      `
      UPDATE support_tickets
         SET assigned_admin_sub = NULL,
             assigned_at = NULL,
             updated_at = now()
       WHERE assigned_admin_sub IS NOT NULL
         AND last_message_at < now() - ($1 || ' hours')::interval
      RETURNING ref
      `,
      [String(STALE_CLAIM_HOURS)]
    );

    const closed = await client.query(
      `
      UPDATE support_tickets
         SET status = 'closed',
             closed_at = now(),
             updated_at = now()
       WHERE status = 'resolved'
         AND resolved_at IS NOT NULL
         AND resolved_at < now() - ($1 || ' days')::interval
      RETURNING ref
      `,
      [String(AUTO_CLOSE_DAYS)]
    );

    // Expired links are dead weight; keep a week for forensics, then drop them.
    const purged = await client.query(
      `DELETE FROM support_thread_tokens WHERE expires_at < now() - interval '7 days'`
    );

    const result = {
      released: released.rowCount ?? 0,
      closed: closed.rowCount ?? 0,
      tokensPurged: purged.rowCount ?? 0,
    };

    console.log(
      JSON.stringify({
        metric: 'SupportHousekeeping',
        ...result,
        releasedRefs: released.rows.map((row) => row.ref),
        closedRefs: closed.rows.map((row) => row.ref),
      })
    );

    return result;
  } finally {
    await client.end().catch(() => undefined);
  }
}
