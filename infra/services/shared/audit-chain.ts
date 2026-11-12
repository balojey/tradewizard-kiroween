/**
 * Audit hash chain — canonical form and writers, shared by every component that
 * appends to `admin_audit_log`.
 *
 * The chain makes the audit log tamper-evident: each row commits to the hash of
 * the row before it, so editing any hashed field breaks the chain at that row
 * and verification can name it.
 *
 * Two writers exist today: `admin-api` (operator actions) and the hourly
 * maintenance job (`services/shared/plan-overrides.ts`, system expiries). Both
 * must insert through {@link insertChainedAuditRow}; a row written any other way
 * has no chain hash and verification fails at that row. That is deliberate — an
 * unauditable row must be impossible to create silently.
 *
 * See docs/admin-portal-architecture.md §8.3 and §11.
 */

import { createHash, randomUUID } from 'crypto';
import type { Client } from 'pg';

/** Bumped only when the canonical form changes; verification refuses unknown versions. */
export const AUDIT_HASH_VERSION = 1;

/**
 * Advisory lock held for the duration of the insert transaction. Any writer
 * must take it before reading the head, otherwise two concurrent inserts read
 * the same head and fork the chain. The unique index on `row_hash` is the
 * backstop, but the lock is what makes the common path correct.
 */
export const AUDIT_CHAIN_LOCK_SQL = `pg_advisory_xact_lock(hashtext('admin_audit_log_chain'))`;

/** The immutable fields covered by `row_hash`. */
export interface AuditChainRow {
  id: string;
  actorSub: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string;
  before: unknown;
  /** ISO-8601 with millisecond precision — exactly what is stored. */
  createdAt: string;
  prevHash: string | null;
  hashVersion: number;
}

/**
 * Sorted keys, no whitespace, `null` preserved.
 *
 * Deterministic across Postgres round-trips: `jsonb` reorders keys and drops
 * no values, and both sides of the comparison pass through this function, so
 * only the *values* have to survive the round-trip.
 *
 * `undefined` becomes `null` rather than being dropped, because a dropped key
 * would make the hashed shape differ from the stored shape. Anything that has
 * no JSON representation throws instead of hashing something ambiguous.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'bigint':
      return JSON.stringify(value.toString());
    default:
      break;
  }

  if (value instanceof Date) return JSON.stringify(value.toISOString());

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(',')}}`;
  }

  throw new TypeError(`Cannot canonicalise a ${typeof value} for the audit hash`);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** The exact bytes committed to by `row_hash`. */
export function canonicalAuditRow(row: AuditChainRow): string {
  return canonicalJson({
    id: row.id,
    actorSub: row.actorSub,
    actorEmail: row.actorEmail,
    actorRole: row.actorRole,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    before: row.before,
    createdAt: row.createdAt,
    prevHash: row.prevHash,
    hashVersion: row.hashVersion,
  });
}

export function computeRowHash(row: AuditChainRow): string {
  return sha256Hex(canonicalAuditRow(row));
}

/**
 * Terminal state gets its own hash: the row hash is fixed at write time, so the
 * completion fields need a separate commitment or flipping a status would go
 * unnoticed.
 */
export function computeCompletionHash(input: {
  rowHash: string;
  status: 'succeeded' | 'failed';
  after: unknown;
  error: string | null;
  completedAt: string;
}): string {
  return sha256Hex(
    canonicalJson({
      rowHash: input.rowHash,
      status: input.status,
      after: input.after,
      error: input.error,
      completedAt: input.completedAt,
    })
  );
}

export interface ChainedAuditInsert {
  /** Generated when omitted; the hash covers it, so the caller never chooses it after the fact. */
  id?: string;
  actorSub: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string;
  /** New rows are usually `pending`; maintenance rows may be born terminal. */
  status: 'pending' | 'succeeded' | 'failed';
  before?: unknown;
  after?: unknown;
  error?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
}

export interface ChainedAuditRow {
  id: string;
  createdAt: string;
  rowHash: string;
}

/**
 * Insert one row at the head of the chain.
 *
 * By default this runs in its own transaction, so the audit row commits
 * independently of the work it describes. Callers that already hold a
 * transaction (the plan-override grant, which commits the row and the override
 * together) pass `{ inTransaction: true }`; the advisory lock then lives until
 * their commit, which is strictly stronger.
 *
 * Holding the advisory lock across the head read and the insert is what
 * serialises concurrent writers.
 */
export async function insertChainedAuditRow(
  client: Client,
  input: ChainedAuditInsert,
  options: { inTransaction?: boolean } = {}
): Promise<ChainedAuditRow> {
  const id = input.id ?? randomUUID();
  const ownTransaction = !options.inTransaction;

  if (ownTransaction) await client.query('BEGIN');

  try {
    await client.query(`SELECT ${AUDIT_CHAIN_LOCK_SQL}`);

    const head = await client.query<{ rowHash: string | null; createdAt: Date | string }>(
      `
      SELECT row_hash AS "rowHash", created_at AS "createdAt"
      FROM admin_audit_log
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      `
    );

    const createdAt = nextChainTimestamp(head.rows[0]?.createdAt);
    const prevHash = head.rows[0]?.rowHash ?? null;

    const rowHash = computeRowHash({
      id,
      actorSub: input.actorSub,
      actorEmail: input.actorEmail,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      before: input.before ?? null,
      createdAt,
      prevHash,
      hashVersion: AUDIT_HASH_VERSION,
    });

    const terminal = input.status !== 'pending';
    const after = input.after ?? null;
    const error = input.error ?? null;
    const completedAt = terminal ? createdAt : null;

    const completionHash = terminal
      ? computeCompletionHash({
          rowHash,
          status: input.status as 'succeeded' | 'failed',
          after,
          error,
          completedAt: createdAt,
        })
      : null;

    await client.query(
      `
      INSERT INTO admin_audit_log (
        id, actor_sub, actor_email, actor_role, action, target_type, target_id,
        reason, status, before, after, error, ip, user_agent, request_id,
        idempotency_key, created_at, prev_hash, row_hash, completion_hash,
        hash_version, completed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12,
        $13, $14, $15, $16, $17::timestamptz, $18, $19, $20, $21, $22::timestamptz
      )
      `,
      [
        id,
        input.actorSub,
        input.actorEmail,
        input.actorRole,
        input.action,
        input.targetType,
        input.targetId,
        input.reason,
        input.status,
        input.before === undefined || input.before === null ? null : canonicalJson(input.before),
        input.after === undefined || input.after === null ? null : canonicalJson(input.after),
        error,
        input.ip ?? null,
        input.userAgent ?? null,
        input.requestId ?? null,
        input.idempotencyKey ?? null,
        createdAt,
        prevHash,
        rowHash,
        completionHash,
        AUDIT_HASH_VERSION,
        completedAt,
      ]
    );

    if (ownTransaction) await client.query('COMMIT');

    return { id, createdAt, rowHash };
  } catch (error) {
    if (ownTransaction) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/**
 * The chain is ordered by `(created_at, id)`, so a new row must sort after the
 * head. Clock skew between Lambda instances could otherwise place it earlier
 * and make the chain read out of order; bumping one millisecond keeps the
 * ordering total without losing precision.
 */
function nextChainTimestamp(headCreatedAt: Date | string | undefined): string {
  const now = Date.now();

  if (!headCreatedAt) return new Date(now).toISOString();

  const headMs =
    headCreatedAt instanceof Date ? headCreatedAt.getTime() : new Date(headCreatedAt).getTime();

  if (!Number.isFinite(headMs)) return new Date(now).toISOString();

  return new Date(headMs >= now ? headMs + 1 : now).toISOString();
}

/** A row as read back by the backfill, with its stored hashes. */
export interface SealableAuditRow extends AuditChainRow {
  rowHash: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  after: unknown;
  error: string | null;
  completedAt: string | null;
}

export interface ChainSealUpdate {
  id: string;
  prevHash: string | null;
  rowHash: string;
  completionHash: string | null;
  completedAt: string | null;
}

/**
 * Decide which rows the backfill must write, oldest first.
 *
 * Pure on purpose: "what would this run change" is the question that decides
 * whether it is safe to run, so it is a unit test rather than something you
 * discover from a diff of the audit log.
 *
 * Default: only rows without a hash are sealed, chained from the nearest stored
 * hash. `force`: recompute every row, which re-seals tampered rows — a scratch
 * database operation, never an evidence-preserving one.
 */
export function planChainSeal(
  rows: SealableAuditRow[],
  options: { force?: boolean } = {}
): ChainSealUpdate[] {
  const updates: ChainSealUpdate[] = [];
  let previousHash: string | null = null;

  for (const row of rows) {
    if (!options.force && row.rowHash) {
      previousHash = row.rowHash;
      continue;
    }

    const hashVersion = row.hashVersion || AUDIT_HASH_VERSION;

    const rowHash = computeRowHash({
      id: row.id,
      actorSub: row.actorSub,
      actorEmail: row.actorEmail,
      actorRole: row.actorRole,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
      before: row.before ?? null,
      createdAt: row.createdAt,
      prevHash: previousHash,
      hashVersion,
    });

    // A terminal row needs a completion commitment. The original schema never
    // recorded when a row completed, so `created_at` is the only honest upper
    // bound for a legacy row; new rows record the real time.
    const completedAt = row.status === 'pending' ? null : (row.completedAt ?? row.createdAt);

    const completionHash =
      row.status === 'pending'
        ? null
        : computeCompletionHash({
            rowHash,
            status: row.status,
            after: row.after ?? null,
            error: row.error ?? null,
            completedAt: completedAt as string,
          });

    updates.push({ id: row.id, prevHash: previousHash, rowHash, completionHash, completedAt });
    previousHash = rowHash;
  }

  return updates;
}
