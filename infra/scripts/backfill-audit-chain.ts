#!/usr/bin/env node
/**
 * Backfill the audit hash chain.
 *
 * Every row in `admin_audit_log` must commit to the row before it. Rows written
 * before the chain existed have `row_hash IS NULL` and verification fails on the
 * first of them, so they are sealed here, oldest first.
 *
 * Safety:
 * - Idempotent. With no flags, only rows whose `row_hash` is null are touched,
 *   so a second run is a no-op.
 * - `--force` recomputes the whole chain in order. That **re-seals tampered
 *   rows**, which is exactly what you want on a scratch database and exactly
 *   what you must not do on one whose integrity you are trying to prove.
 * - The immutability trigger is disabled only inside the update transaction and
 *   re-enabled before commit; `--dry-run` never writes and never disables it.
 * - The run ends with a verification pass. A non-zero exit means the chain is
 *   still broken and the output names the row.
 *
 * Legacy completion times: the original schema did not record when a row
 * completed, so backfilled terminal rows use `created_at` as `completed_at`.
 * That is an upper bound on "how long it was pending", not a fabrication of a
 * precise time — new rows record the real one.
 *
 * Usage:
 *   npx tsx scripts/backfill-audit-chain.ts --dry-run
 *   npx tsx scripts/backfill-audit-chain.ts
 *   npx tsx scripts/backfill-audit-chain.ts --force   # dev only
 *
 * Connection: `DATABASE_URL`, or the libpq `PG*` variables (PGHOST, PGPORT,
 * PGDATABASE, PGUSER, PGPASSWORD) that `deploy.sh` parses out of the RDS
 * credentials secret.
 *
 * See docs/admin-portal-architecture.md §8.3 and the runbook §4.
 */

import { Client } from 'pg';
import {
  AUDIT_HASH_VERSION,
  planChainSeal,
  type SealableAuditRow,
} from '../services/shared/audit-chain';
import { verifyAuditChain, type VerificationRow } from '../services/admin-api/lib/audit-chain';

interface Args {
  dryRun: boolean;
  force: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, force: false, quiet: false };

  for (const arg of argv) {
    switch (arg) {
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) fail(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage(): void {
  console.log(`
Seal the admin audit hash chain.

  --dry-run   Report what would change without writing anything
  --force     Recompute every row from the start (re-seals tampered rows; dev only)
  --quiet     Only print warnings and the final verdict
`);
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** RDS needs TLS from a laptop; a local Postgres does not. */
function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function makeClient(): Client {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    return new Client({
      connectionString,
      ssl: /localhost|127\.0\.0\.1/.test(connectionString)
        ? undefined
        : { rejectUnauthorized: false },
    });
  }

  // node-postgres reads PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD itself.
  return new Client({
    ssl: isLocalHost(process.env.PGHOST) ? undefined : { rejectUnauthorized: false },
  });
}

interface StoredRow {
  id: string;
  actorSub: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string;
  status: 'pending' | 'succeeded' | 'failed';
  before: unknown;
  after: unknown;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
  prevHash: string | null;
  rowHash: string | null;
  completionHash: string | null;
  hashVersion: number;
}

const SELECT_COLUMNS = `
  id,
  actor_sub       AS "actorSub",
  actor_email     AS "actorEmail",
  actor_role      AS "actorRole",
  action,
  target_type     AS "targetType",
  target_id       AS "targetId",
  reason,
  status,
  before,
  after,
  error,
  created_at      AS "createdAt",
  completed_at    AS "completedAt",
  prev_hash       AS "prevHash",
  row_hash        AS "rowHash",
  completion_hash AS "completionHash",
  hash_version    AS "hashVersion"
`;

function toSealableRow(row: StoredRow): SealableAuditRow {
  return {
    id: row.id,
    actorSub: row.actorSub,
    actorEmail: row.actorEmail,
    actorRole: row.actorRole,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    before: row.before ?? null,
    createdAt: row.createdAt.toISOString(),
    prevHash: row.prevHash,
    rowHash: row.rowHash,
    hashVersion: row.hashVersion ?? AUDIT_HASH_VERSION,
    status: row.status,
    after: row.after ?? null,
    error: row.error,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

function toVerificationRow(row: StoredRow): VerificationRow {
  return {
    ...toSealableRow(row),
    completionHash: row.completionHash,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const log = (message: string) => {
    if (!args.quiet) console.log(message);
  };

  const client = makeClient();
  await client.connect();

  try {
    await client.query(`SET lock_timeout = '10s'`);

    const result = await client.query<StoredRow>(
      `SELECT ${SELECT_COLUMNS} FROM admin_audit_log ORDER BY created_at, id`
    );

    const rows = result.rows;
    log(`audit rows: ${rows.length}`);

    // `planChainSeal` is pure, so "what would this run change" is testable
    // rather than something you discover by reading the diff afterwards.
    const updates = planChainSeal(rows.map(toSealableRow), { force: args.force });

    log(`rows to seal: ${updates.length}${args.force ? ' (--force: full recompute)' : ''}`);

    if (updates.length === 0) {
      log('nothing to do');
    } else if (args.dryRun) {
      for (const update of updates.slice(0, 10)) {
        log(`  would seal ${update.id} → ${update.rowHash.slice(0, 16)}…`);
      }
      if (updates.length > 10) log(`  … and ${updates.length - 10} more`);
      log('--dry-run: no writes');
    } else {
      await client.query('BEGIN');

      try {
        await client.query('ALTER TABLE admin_audit_log DISABLE TRIGGER admin_audit_log_immutable');

        for (const update of updates) {
          await client.query(
            `
            UPDATE admin_audit_log
            SET prev_hash = $2,
                row_hash = $3,
                completion_hash = $4,
                completed_at = $5::timestamptz,
                hash_version = $6
            WHERE id = $1
            `,
            [
              update.id,
              update.prevHash,
              update.rowHash,
              update.completionHash,
              update.completedAt,
              AUDIT_HASH_VERSION,
            ]
          );
        }

        await client.query('ALTER TABLE admin_audit_log ENABLE TRIGGER admin_audit_log_immutable');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }

      log(`sealed ${updates.length} row(s)`);
    }

    // Verify from a fresh read: this is the same code path the API uses, so a
    // green result here is the same claim the portal will make.
    const verifyResult = await client.query<StoredRow>(
      `SELECT ${SELECT_COLUMNS} FROM admin_audit_log ORDER BY created_at, id`
    );

    const verification = verifyAuditChain(verifyResult.rows.map(toVerificationRow), {
      coversGenesis: true,
    });

    if (verification.valid) {
      log(`\n✓ chain verified: ${verification.checked} row(s), head ${verification.head ?? '(empty)'}`);
      return;
    }

    console.error(
      `\n✗ chain is broken at ${verification.firstBrokenId} (${verification.firstBrokenReason})`
    );
    console.error(
      '  A row written between the schema change and this backfill leaves a seam, and an\n' +
        '  edited row is a finding rather than something to overwrite. Investigate first;\n' +
        '  --force re-seals the chain and destroys the evidence of tampering.\n'
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('\n✗ Backfill failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
