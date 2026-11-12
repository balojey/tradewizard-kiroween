import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  AUDIT_HASH_VERSION,
  computeCompletionHash,
  computeRowHash,
  insertChainedAuditRow,
  planChainSeal,
  type SealableAuditRow,
} from './audit-chain';

const BASE = {
  actorSub: 'sub-1',
  actorEmail: 'ops@example.com',
  actorRole: 'admin',
  action: 'user.credits.grant',
  targetType: 'user',
  targetId: '725c2005-b3f4-46f3-94ad-083a75593c02',
  reason: 'goodwill credit for outage',
  before: { balance: 100 },
};

function row(overrides: Partial<SealableAuditRow> = {}): SealableAuditRow {
  return {
    ...BASE,
    id: '00000000-0000-0000-0000-00000000a001',
    createdAt: '2026-11-02T10:00:00.000Z',
    prevHash: null,
    hashVersion: AUDIT_HASH_VERSION,
    rowHash: null,
    status: 'pending',
    after: null,
    error: null,
    completedAt: null,
    ...overrides,
  };
}

function sealed(row: SealableAuditRow): SealableAuditRow {
  return { ...row, rowHash: computeRowHash(row) };
}

describe('insertChainedAuditRow', () => {
  const insert = {
    actorSub: 'sub-1',
    actorEmail: 'ops@example.com',
    actorRole: 'admin' as const,
    action: 'user.note.create',
    targetType: 'user',
    targetId: '725c2005-b3f4-46f3-94ad-083a75593c02',
    reason: 'testing the write order',
    status: 'pending' as const,
  };

  function fakeClient(options: { failOn?: string } = {}) {
    const calls: string[] = [];

    const client = {
      query: async (sql: string) => {
        const normalised = sql.replace(/\s+/g, ' ').trim();
        calls.push(normalised);

        if (options.failOn && normalised.includes(options.failOn)) {
          throw new Error('simulated failure');
        }

        return { rows: [] };
      },
    } as unknown as Client;

    return { client, calls };
  }

  it('takes the lock before reading the head, in its own transaction', async () => {
    const { client, calls } = fakeClient();

    const result = await insertChainedAuditRow(client, insert);

    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toContain(`pg_advisory_xact_lock(hashtext('admin_audit_log_chain'))`);
    expect(calls[2]).toContain('SELECT row_hash AS "rowHash"');
    expect(calls[3]).toContain('INSERT INTO admin_audit_log');
    expect(calls[4]).toBe('COMMIT');

    expect(result.rowHash).toHaveLength(64);
    expect(result.createdAt).toMatch(/\.\d{3}Z$/);
  });

  it('joins a caller transaction without opening or committing one', async () => {
    const { client, calls } = fakeClient();

    await insertChainedAuditRow(client, insert, { inTransaction: true });

    expect(calls).not.toContain('BEGIN');
    expect(calls).not.toContain('COMMIT');
    expect(calls[0]).toContain('pg_advisory_xact_lock');
  });

  it('rolls back its own transaction and rethrows when the insert fails', async () => {
    const { client, calls } = fakeClient({ failOn: 'INSERT INTO admin_audit_log' });

    await expect(insertChainedAuditRow(client, insert)).rejects.toThrow('simulated failure');
    expect(calls).toContain('ROLLBACK');
  });
});

describe('planChainSeal', () => {
  it('does nothing when every row is already sealed', () => {
    const rows = [sealed(row())];

    expect(planChainSeal(rows)).toEqual([]);
  });

  it('seals only the unsealed rows and chains from the nearest stored hash', () => {
    const genesis = sealed(row());
    const middle = row({
      id: '00000000-0000-0000-0000-00000000a002',
      createdAt: '2026-11-02T10:00:01.000Z',
    });
    const last = sealed(
      row({
        id: '00000000-0000-0000-0000-00000000a003',
        createdAt: '2026-11-02T10:00:02.000Z',
        prevHash: 'placeholder',
      })
    );

    const updates = planChainSeal([genesis, middle, last]);

    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe(middle.id);
    expect(updates[0].prevHash).toBe(genesis.rowHash);
    expect(updates[0].completionHash).toBeNull();
    expect(updates[0].completedAt).toBeNull();
  });

  it('recomputes terminal completion commitments from stored state', () => {
    const terminal = row({
      status: 'succeeded',
      after: { amount: 10 },
      completedAt: '2026-11-02T10:00:05.000Z',
    });

    const [update] = planChainSeal([terminal]);

    expect(update.completedAt).toBe('2026-11-02T10:00:05.000Z');
    expect(update.completionHash).toBe(
      computeCompletionHash({
        rowHash: update.rowHash,
        status: 'succeeded',
        after: { amount: 10 },
        error: null,
        completedAt: '2026-11-02T10:00:05.000Z',
      })
    );
  });

  it('uses created_at as the completion time for a legacy terminal row', () => {
    const legacy = row({ status: 'failed', error: 'boom', completedAt: null });

    const [update] = planChainSeal([legacy]);

    expect(update.completedAt).toBe(legacy.createdAt);
    expect(update.completionHash).not.toBeNull();
  });

  it('is idempotent: resealing a valid chain produces the same hashes', () => {
    const genesis = sealed(row());
    const second = sealed(
      row({
        id: '00000000-0000-0000-0000-00000000a002',
        createdAt: '2026-11-02T10:00:01.000Z',
        prevHash: genesis.rowHash,
        status: 'succeeded',
        after: { ok: true },
        completedAt: '2026-11-02T10:00:02.000Z',
      })
    );

    const forced = planChainSeal([genesis, second], { force: true });

    expect(forced).toHaveLength(2);
    expect(forced[0].rowHash).toBe(genesis.rowHash);
    expect(forced[1].rowHash).toBe(second.rowHash);
  });

  it('refuses to skip the chain: every planned row links to the one before it', () => {
    const rows = Array.from({ length: 4 }, (_, index) =>
      row({
        id: `00000000-0000-0000-0000-00000000a10${index}`,
        createdAt: `2026-11-02T10:00:0${index}.000Z`,
      })
    );

    const updates = planChainSeal(rows);

    expect(updates).toHaveLength(4);
    expect(updates[0].prevHash).toBeNull();

    for (let index = 1; index < updates.length; index += 1) {
      expect(updates[index].prevHash).toBe(updates[index - 1].rowHash);
    }

    // The planned hash is the hash of the chained values, not of the unlinked row.
    expect(updates[1].rowHash).not.toBe(computeRowHash(rows[1]));
  });
});
