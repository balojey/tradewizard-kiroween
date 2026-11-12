/**
 * Chain integration tests — real Postgres, real advisory lock, real trigger.
 *
 * These are gated: they need `AUDIT_TEST_DATABASE_URL` pointing at a **scratch**
 * database with `001-schema.sql` applied. They are not part of the default
 * `npm test` run because the repo has no database in CI, and pointing them at a
 * shared database would litter an append-only table with test rows.
 *
 *   AUDIT_TEST_DATABASE_URL=postgres://localhost/tw_audit_test npm test
 *
 * The suite cleans up after itself with the trigger disabled, which is the only
 * way to remove a row from an append-only table — the same escape hatch the
 * backfill script uses.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { writeAuditLog, completeAudit } from './audit';
import { verifyAuditChain, type VerificationRow } from './audit-chain';
import { computeRowHash } from '../../shared/audit-chain';
import type { AdminIdentity } from '../../shared/admin-auth';

const CONNECTION = process.env.AUDIT_TEST_DATABASE_URL;
const describeDb = CONNECTION ? describe : describe.skip;

const ACTOR: AdminIdentity = {
  sub: 'integration-test-sub',
  email: 'integration@example.com',
  role: 'admin',
} as AdminIdentity;

let client: Client;
const createdIds: string[] = [];

async function readRow(id: string): Promise<VerificationRow> {
  const result = await client.query(
    `
    SELECT
      id, actor_sub AS "actorSub", actor_email AS "actorEmail", actor_role AS "actorRole",
      action, target_type AS "targetType", target_id AS "targetId", reason, status,
      before, after, error, created_at AS "createdAt", completed_at AS "completedAt",
      prev_hash AS "prevHash", row_hash AS "rowHash", completion_hash AS "completionHash",
      hash_version AS "hashVersion"
    FROM admin_audit_log
    WHERE id = $1
    `,
    [id]
  );

  const row = result.rows[0];
  if (!row) throw new Error(`audit row ${id} disappeared`);

  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    hashVersion: Number(row.hashVersion),
  } as VerificationRow;
}

async function withTriggerDisabled<T>(fn: () => Promise<T>): Promise<T> {
  await client.query('ALTER TABLE admin_audit_log DISABLE TRIGGER admin_audit_log_immutable');
  try {
    return await fn();
  } finally {
    await client.query('ALTER TABLE admin_audit_log ENABLE TRIGGER admin_audit_log_immutable');
  }
}

describeDb('audit chain (database)', () => {
  beforeAll(async () => {
    client = new Client({
      connectionString: CONNECTION,
      ssl: /localhost|127\.0\.0\.1/.test(CONNECTION as string)
        ? undefined
        : { rejectUnauthorized: false },
    });
    await client.connect();
  });

  afterAll(async () => {
    if (!client) return;

    if (createdIds.length > 0) {
      await withTriggerDisabled(() =>
        client.query('DELETE FROM admin_audit_log WHERE id = ANY($1::uuid[])', [createdIds])
      ).catch(() => undefined);
    }

    await client.end().catch(() => undefined);
  });

  it('serialises two concurrent writers into one chain', async () => {
    const second = new Client({
      connectionString: CONNECTION,
      ssl: /localhost|127\.0\.0\.1/.test(CONNECTION as string)
        ? undefined
        : { rejectUnauthorized: false },
    });
    await second.connect();

    try {
      // Two connections, so the advisory lock is doing the work rather than the
      // single-client ordering. Without the lock both would read the same head.
      const [firstId, concurrentId] = await Promise.all([
        writeAuditLog(client, {
          actor: ACTOR,
          action: 'integration.concurrent',
          targetType: 'user',
          targetId: '00000000-0000-0000-0000-00000000c001',
          reason: 'first concurrent writer in the integration test',
        }),
        writeAuditLog(second, {
          actor: ACTOR,
          action: 'integration.concurrent',
          targetType: 'user',
          targetId: '00000000-0000-0000-0000-00000000c002',
          reason: 'second concurrent writer in the integration test',
        }),
      ]);

      createdIds.push(firstId, concurrentId);

      const rows = await Promise.all([readRow(firstId), readRow(concurrentId)]);
      const ordered = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      expect(ordered).toHaveLength(2);
      expect(ordered[0].rowHash).toBeTruthy();
      expect(ordered[1].prevHash).toBe(ordered[0].rowHash);
      expect(ordered[0].prevHash).not.toBe(ordered[1].prevHash);

      for (const row of ordered) {
        expect(computeRowHash(row)).toBe(row.rowHash);
      }
    } finally {
      await second.end().catch(() => undefined);
    }
  });

  it('completes a row with a verifiable completion hash', async () => {
    const id = await writeAuditLog(client, {
      actor: ACTOR,
      action: 'integration.complete',
      targetType: 'user',
      targetId: '00000000-0000-0000-0000-00000000c003',
      reason: 'completion hash integration test',
    });
    createdIds.push(id);

    await completeAudit(client, id, { status: 'succeeded', after: { credited: 10 } });

    const row = await readRow(id);
    expect(row.status).toBe('succeeded');
    expect(row.completionHash).toHaveLength(64);
    expect(row.completedAt).toBeTruthy();

    const second = await writeAuditLog(client, {
      actor: ACTOR,
      action: 'integration.complete',
      targetType: 'user',
      targetId: '00000000-0000-0000-0000-00000000c004',
      reason: 'second row so the pair can be verified',
    });
    createdIds.push(second);

    const pair = [row, await readRow(second)];
    // coversGenesis is false: the first row of the pair links to rows this
    // suite did not create, which is normal for a bounded window.
    expect(verifyAuditChain(pair, { coversGenesis: false }).valid).toBe(true);
  });

  it('reports the first broken row after a deliberate edit', async () => {
    const firstId = await writeAuditLog(client, {
      actor: ACTOR,
      action: 'integration.tamper',
      targetType: 'user',
      targetId: '00000000-0000-0000-0000-00000000c005',
      reason: 'row that stays intact in the tamper test',
    });
    const secondId = await writeAuditLog(client, {
      actor: ACTOR,
      action: 'integration.tamper',
      targetType: 'user',
      targetId: '00000000-0000-0000-0000-00000000c006',
      reason: 'row that gets edited directly in the database',
    });
    createdIds.push(firstId, secondId);

    // The trigger forbids this. Disabling it is what a database-level actor
    // would have to do, and it is exactly the case the chain must expose.
    await withTriggerDisabled(() =>
      client.query(`UPDATE admin_audit_log SET reason = 'edited after the fact' WHERE id = $1`, [
        secondId,
      ])
    );

    const pair = [await readRow(firstId), await readRow(secondId)];
    const result = verifyAuditChain(pair, { coversGenesis: false });

    expect(result.valid).toBe(false);
    expect(result.firstBrokenId).toBe(secondId);
    expect(result.firstBrokenReason).toBe('row_hash_mismatch');
  });

  it('refuses to rewrite a finalised row', async () => {
    const id = await writeAuditLog(client, {
      actor: ACTOR,
      action: 'integration.immutable',
      targetType: 'user',
      targetId: '00000000-0000-0000-0000-00000000c007',
      reason: 'proving the trigger rejects an edit',
    });
    createdIds.push(id);
    await completeAudit(client, id, { status: 'succeeded' });

    await expect(
      client.query('UPDATE admin_audit_log SET status = $2 WHERE id = $1', [id, 'failed'])
    ).rejects.toThrow(/already final/);

    await expect(
      client.query('DELETE FROM admin_audit_log WHERE id = $1', [id])
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to complete a row that has no chain hash', async () => {
    const id = '00000000-0000-0000-0000-0000000c0009';

    await withTriggerDisabled(() =>
      client.query(
        `
        INSERT INTO admin_audit_log (
          id, actor_sub, actor_email, actor_role, action, target_type, target_id,
          reason, status
        ) VALUES ($1, 'system', 'system', 'system', 'integration.legacy', 'user', $2,
                  'a row written before the chain existed', 'pending')
        `,
        [id, '00000000-0000-0000-0000-00000000c009']
      )
    );
    createdIds.push(id);

    await expect(completeAudit(client, id, { status: 'succeeded' })).rejects.toThrow(
      /no row_hash/
    );
  });
});
