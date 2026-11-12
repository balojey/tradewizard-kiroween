/**
 * Audit chain — the admin API's view of the shared hashing module, plus the
 * chain verifier.
 *
 * The canonical form and the insert helper live in `services/shared/audit-chain`
 * because the hourly maintenance job appends system rows too; duplicating the
 * hash algorithm in two services would be a fork waiting to happen. They are
 * re-exported here so the admin API (and its tests) import from one path.
 *
 * See docs/admin-portal-architecture.md §8.3 and §11.
 */

import {
  AUDIT_HASH_VERSION,
  canonicalAuditRow,
  canonicalJson,
  computeCompletionHash,
  computeRowHash,
  sha256Hex,
} from '../../shared/audit-chain';
import type { AuditChainRow } from '../../shared/audit-chain';

export {
  AUDIT_HASH_VERSION,
  canonicalAuditRow,
  canonicalJson,
  computeCompletionHash,
  computeRowHash,
  sha256Hex,
};
export type { AuditChainRow };

/** A row as read back for verification, including its completion state. */
export interface VerificationRow extends AuditChainRow {
  /** The stored hash; null means the row predates the chain or the backfill. */
  rowHash: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  after: unknown;
  error: string | null;
  completionHash: string | null;
  completedAt: string | null;
}

export type BrokenReason =
  | 'missing_row_hash'
  | 'unsupported_hash_version'
  | 'row_hash_mismatch'
  | 'prev_hash_mismatch'
  | 'chain_start_mismatch'
  | 'unexpected_completion'
  | 'missing_completion'
  | 'completion_hash_mismatch';

export interface ChainVerification {
  valid: boolean;
  checked: number;
  /** `sha256:<hex>` of the last row checked. */
  head: string | null;
  firstBrokenId: string | null;
  firstBrokenReason: BrokenReason | null;
  /** True when the window starts at the first row ever written. */
  coversGenesis: boolean;
}

/**
 * Recompute the chain over `rows` (ascending `(created_at, id)` order).
 *
 * Returns the first broken row rather than throwing: a broken chain is a
 * finding, not a server error. `coversGenesis` says whether the first row is
 * the actual start of the log — only then must its `prev_hash` be null.
 */
export function verifyAuditChain(
  rows: VerificationRow[],
  options: { coversGenesis: boolean }
): ChainVerification {
  let previousHash: string | null = null;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];

    const broken = (reason: BrokenReason): ChainVerification => ({
      valid: false,
      checked: rows.length,
      head: rows[rows.length - 1]?.rowHash ? `sha256:${rows[rows.length - 1].rowHash}` : null,
      firstBrokenId: row.id,
      firstBrokenReason: reason,
      coversGenesis: options.coversGenesis,
    });

    if (!row.rowHash) return broken('missing_row_hash');
    if (row.hashVersion !== AUDIT_HASH_VERSION) return broken('unsupported_hash_version');
    if (computeRowHash(row) !== row.rowHash) return broken('row_hash_mismatch');

    if (index === 0) {
      if (options.coversGenesis && row.prevHash !== null) return broken('chain_start_mismatch');
    } else if (row.prevHash !== previousHash) {
      return broken('prev_hash_mismatch');
    }

    if (row.status === 'pending') {
      if (row.completionHash !== null || row.completedAt !== null) {
        return broken('unexpected_completion');
      }
    } else {
      if (!row.completionHash || !row.completedAt) return broken('missing_completion');

      const recomputed = computeCompletionHash({
        rowHash: row.rowHash,
        status: row.status,
        after: row.after,
        error: row.error,
        completedAt: row.completedAt,
      });

      if (recomputed !== row.completionHash) return broken('completion_hash_mismatch');
    }

    previousHash = row.rowHash;
  }

  const last = rows[rows.length - 1];

  return {
    valid: true,
    checked: rows.length,
    head: last ? `sha256:${last.rowHash}` : null,
    firstBrokenId: null,
    firstBrokenReason: null,
    coversGenesis: options.coversGenesis,
  };
}
