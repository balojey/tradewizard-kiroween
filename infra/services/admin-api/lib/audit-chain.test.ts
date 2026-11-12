import { describe, expect, it } from 'vitest';
import {
  AUDIT_HASH_VERSION,
  canonicalAuditRow,
  canonicalJson,
  computeCompletionHash,
  computeRowHash,
  verifyAuditChain,
  type AuditChainRow,
  type VerificationRow,
} from './audit-chain';

/**
 * Fixed fixture. The golden canonical string and hash below are the contract:
 * if either changes, every stored chain hash stops verifying, so the change has
 * to be a deliberate `hash_version` bump.
 */
const ROW: AuditChainRow = {
  id: '0b0d0e2a-5f5c-4a3e-9a4b-1f2c3d4e5f60',
  actorSub: 'sub-1',
  actorEmail: 'ops@example.com',
  actorRole: 'admin',
  action: 'user.credits.grant',
  targetType: 'user',
  targetId: '725c2005-b3f4-46f3-94ad-083a75593c02',
  reason: 'goodwill credit for outage',
  before: { balance: 100, plan: 'pro' },
  createdAt: '2026-11-02T10:00:00.000Z',
  prevHash: null,
  hashVersion: 1,
};

const ROW_CANONICAL =
  '{"action":"user.credits.grant","actorEmail":"ops@example.com","actorRole":"admin","actorSub":"sub-1","before":{"balance":100,"plan":"pro"},"createdAt":"2026-11-02T10:00:00.000Z","hashVersion":1,"id":"0b0d0e2a-5f5c-4a3e-9a4b-1f2c3d4e5f60","prevHash":null,"reason":"goodwill credit for outage","targetId":"725c2005-b3f4-46f3-94ad-083a75593c02","targetType":"user"}';

const ROW_HASH = '0360047a783c1156be7b50baae9d279749f08a3a7d42d7d5ede6c09081c04c28';

function pendingRow(overrides: Partial<VerificationRow> = {}): VerificationRow {
  const row = {
    ...ROW,
    status: 'pending',
    after: null,
    error: null,
    completionHash: null,
    completedAt: null,
    ...overrides,
  } as VerificationRow;

  row.rowHash = overrides.rowHash === undefined ? computeRowHash(row) : overrides.rowHash;
  return row;
}

function completedRow(prevHash: string, overrides: Partial<VerificationRow> = {}): VerificationRow {
  const row = pendingRow({
    prevHash,
    createdAt: '2026-11-02T10:00:01.000Z',
    status: 'succeeded',
    after: { amount: 10, balanceAfter: 110 },
    completedAt: '2026-11-02T10:00:02.000Z',
    ...overrides,
  });

  if (overrides.completionHash === undefined && row.status !== 'pending') {
    row.completionHash = computeCompletionHash({
      rowHash: row.rowHash as string,
      status: row.status,
      after: row.after,
      error: row.error,
      completedAt: row.completedAt as string,
    });
  }

  return row;
}

describe('canonical JSON', () => {
  it('sorts keys recursively and emits no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: true, y: null }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[2,{"y":null,"z":true}]},"b":1}'
    );
  });

  it('preserves null and treats undefined as null', () => {
    expect(canonicalJson({ a: null, b: undefined })).toBe('{"a":null,"b":null}');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('escapes strings and keeps arrays ordered', () => {
    expect(canonicalJson(['b', 'a', 'quote"'])).toBe('["b","a","quote\\""]');
  });

  it('is stable across key insertion order', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

describe('canonical audit row', () => {
  it('matches the golden canonical string', () => {
    expect(canonicalAuditRow(ROW)).toBe(ROW_CANONICAL);
  });

  it('matches the golden row hash', () => {
    expect(computeRowHash(ROW)).toBe(ROW_HASH);
    expect(ROW_HASH).toHaveLength(64);
  });

  it('changes when any hashed field changes', () => {
    const mutations: Array<Partial<AuditChainRow>> = [
      { id: '0b0d0e2a-5f5c-4a3e-9a4b-1f2c3d4e5f61' },
      { actorSub: 'sub-2' },
      { actorEmail: 'other@example.com' },
      { actorRole: 'support' },
      { action: 'user.credits.refund' },
      { targetType: 'analysis' },
      { targetId: null },
      { reason: 'goodwill credit for an outage' },
      { before: { balance: 100, plan: 'elite' } },
      { before: null },
      { createdAt: '2026-11-02T10:00:00.001Z' },
      { prevHash: 'a'.repeat(64) },
      { hashVersion: 2 },
    ];

    for (const mutation of mutations) {
      expect(computeRowHash({ ...ROW, ...mutation })).not.toBe(ROW_HASH);
    }
  });

  it('does not hash fields outside the declared immutable set', () => {
    // status/after/error/ip/user_agent/request_id are excluded by design; the
    // completion hash covers the terminal state instead.
    const row = { ...ROW, status: 'succeeded', after: { x: 1 }, error: 'boom' } as AuditChainRow;
    expect(computeRowHash(row)).toBe(ROW_HASH);
  });
});

describe('completion hash', () => {
  const base = {
    rowHash: ROW_HASH,
    status: 'succeeded' as const,
    after: { amount: 10 } as unknown,
    error: null,
    completedAt: '2026-11-02T10:00:02.000Z',
  };

  it('matches the stored shape', () => {
    expect(computeCompletionHash(base)).toHaveLength(64);
  });

  it('changes when status, after, error or completion time changes', () => {
    const expected = computeCompletionHash(base);

    expect(computeCompletionHash({ ...base, status: 'failed' })).not.toBe(expected);
    expect(computeCompletionHash({ ...base, after: { amount: 11 } })).not.toBe(expected);
    expect(computeCompletionHash({ ...base, error: 'boom' })).not.toBe(expected);
    expect(computeCompletionHash({ ...base, completedAt: '2026-11-02T10:00:03.000Z' })).not.toBe(
      expected
    );
    expect(computeCompletionHash({ ...base, rowHash: 'b'.repeat(64) })).not.toBe(expected);
  });
});

describe('verifyAuditChain', () => {
  it('accepts a valid genesis + completion', () => {
    const genesis = pendingRow();
    const second = completedRow(genesis.rowHash as string);

    const result = verifyAuditChain([genesis, second], { coversGenesis: true });

    expect(result).toMatchObject({
      valid: true,
      checked: 2,
      firstBrokenId: null,
      firstBrokenReason: null,
      coversGenesis: true,
      head: `sha256:${second.rowHash}`,
    });
  });

  it('accepts an empty chain', () => {
    expect(verifyAuditChain([], { coversGenesis: true })).toMatchObject({
      valid: true,
      checked: 0,
      head: null,
    });
  });

  it('names the row whose hashed field was edited', () => {
    const genesis = pendingRow();
    const second = completedRow(genesis.rowHash as string);
    // Edit the reason directly in the database; the stored hash stays.
    const tampered: VerificationRow = { ...second, reason: 'a different reason entirely' };

    const result = verifyAuditChain([genesis, tampered], { coversGenesis: true });

    expect(result.valid).toBe(false);
    expect(result.firstBrokenId).toBe(second.id);
    expect(result.firstBrokenReason).toBe('row_hash_mismatch');
  });

  it('detects a fork where prev_hash points somewhere else', () => {
    const genesis = pendingRow();
    // A row that hashed a different predecessor: self-consistent but not linked.
    const forked = completedRow('c'.repeat(64));

    const result = verifyAuditChain([genesis, forked], { coversGenesis: true });

    expect(result.valid).toBe(false);
    expect(result.firstBrokenReason).toBe('prev_hash_mismatch');
  });

  it('detects a flipped status through the completion hash', () => {
    const genesis = pendingRow();
    const second = completedRow(genesis.rowHash as string);
    const flipped: VerificationRow = { ...second, status: 'failed' };

    const result = verifyAuditChain([genesis, flipped], { coversGenesis: true });

    expect(result.valid).toBe(false);
    expect(result.firstBrokenReason).toBe('completion_hash_mismatch');
  });

  it('detects an edited completion payload', () => {
    const genesis = pendingRow();
    const second = completedRow(genesis.rowHash as string);
    const edited: VerificationRow = { ...second, after: { amount: 1000, balanceAfter: 1100 } };

    expect(verifyAuditChain([genesis, edited], { coversGenesis: true }).firstBrokenReason).toBe(
      'completion_hash_mismatch'
    );
  });

  it('rejects a pending row that carries completion fields', () => {
    const genesis = pendingRow();
    const second = pendingRow({
      prevHash: genesis.rowHash as string,
      createdAt: '2026-11-02T10:00:01.000Z',
      completionHash: 'd'.repeat(64),
      completedAt: '2026-11-02T10:00:02.000Z',
    });

    expect(verifyAuditChain([genesis, second], { coversGenesis: true }).firstBrokenReason).toBe(
      'unexpected_completion'
    );
  });

  it('rejects a terminal row with no completion hash', () => {
    const genesis = pendingRow();
    const second = completedRow(genesis.rowHash as string, { completionHash: null });

    expect(verifyAuditChain([genesis, second], { coversGenesis: true }).firstBrokenReason).toBe(
      'missing_completion'
    );
  });

  it('rejects a row written before the backfill', () => {
    const unsealed: VerificationRow = { ...pendingRow(), rowHash: null };

    expect(verifyAuditChain([unsealed], { coversGenesis: true }).firstBrokenReason).toBe(
      'missing_row_hash'
    );
  });

  it('refuses an unknown hash version rather than guessing', () => {
    const future = pendingRow({ hashVersion: 2 });

    expect(verifyAuditChain([future], { coversGenesis: true }).firstBrokenReason).toBe(
      'unsupported_hash_version'
    );
    expect(AUDIT_HASH_VERSION).toBe(1);
  });

  it('requires genesis to start with a null prev_hash only when the window covers it', () => {
    const genesis = pendingRow();
    const second = completedRow(genesis.rowHash as string);

    // Window that starts mid-chain: the first row's prev_hash is unverifiable
    // here, which is normal and must not be reported as a break.
    expect(verifyAuditChain([second], { coversGenesis: false }).valid).toBe(true);

    const withDanglingGenesis = pendingRow({ prevHash: 'e'.repeat(64) });
    expect(
      verifyAuditChain([withDanglingGenesis], { coversGenesis: true }).firstBrokenReason
    ).toBe('chain_start_mismatch');
  });
});
