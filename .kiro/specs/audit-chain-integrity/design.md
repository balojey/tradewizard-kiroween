# Audit Chain Integrity — Design

## Components

```
infra/
├── sql/001-schema.sql                      # columns, indexes, trigger (INSERT/UPDATE/DELETE)
├── services/shared/audit-chain.ts          # canonical form, hashes, chained insert
├── services/admin-api/lib/audit-chain.ts   # admin-facing re-exports + chain verifier
├── services/admin-api/lib/audit.ts         # writeAuditLog / completeAudit / withAudit
├── services/admin-api/queries/audit.ts     # list, chain window, genesis probe
├── services/admin-api/routes/audit.ts      # GET /admin/audit, /verify, /export
├── services/shared/plan-overrides.ts       # system rows through the same writer
└── scripts/backfill-audit-chain.ts         # idempotent seal + verify
```

`tradewizard-admin/`
- `types/admin.ts` — `AuditEntry` hashes, `AuditVerification`, `AuditExport`
- `hooks/useAudit.ts` — filters, verify mutation, export fetch
- `components/audit/AuditView.tsx` — badge, verify, detail dialog, export

## Canonical form

`canonicalJson` is a hand-written serialiser, not `JSON.stringify` of an object
literal: it sorts keys at every level, emits no whitespace, maps `undefined` to
`null`, and throws on values with no JSON representation rather than hashing
something ambiguous. `JSON.stringify` would silently drop `undefined` keys,
which would make the hashed shape differ from the stored `jsonb` shape.

```
row_hash        = sha256(canonicalJson({ id, actorSub, actorEmail, actorRole,
                                         action, targetType, targetId, reason,
                                         before, createdAt, prevHash, hashVersion }))
completion_hash = sha256(canonicalJson({ rowHash, status, after, error, completedAt }))
```

Hashes are stored as lowercase hex. The API prefixes `sha256:` only when
reporting a head, so the stored value never carries presentation.

### The timestamp trap

`created_at` is hashed, so the value hashed must be byte-identical to the value
stored. Postgres `now()` is microsecond-precision; `Date.toISOString()` is
millisecond. Hashing the Node clock while letting the database default the
column breaks every row immediately. Therefore the writer:

1. generates the id (`randomUUID`) in Node,
2. computes the timestamp in Node with millisecond precision,
3. inserts both explicitly (`$::timestamptz` round-trips milliseconds exactly).

The writer also bumps the timestamp by 1 ms when the head is at or after `now()`,
so clock skew between Lambda instances cannot place a new row before the head
and make `(created_at, id)` disagree with the link order.

## Write path

```
BEGIN
  SELECT pg_advisory_xact_lock(hashtext('admin_audit_log_chain'))
  SELECT row_hash, created_at FROM admin_audit_log ORDER BY created_at DESC, id DESC LIMIT 1
  INSERT ... prev_hash, row_hash, completion_hash (terminal system rows only)
COMMIT
```

The advisory lock is transaction-scoped: it is released on commit or rollback,
so a crashed writer cannot strand it. `writeAuditLog` therefore requires a client
that is not already inside a transaction; every caller satisfies that today
(they open their own `BEGIN` *after* the audit row commits, preserving "the audit
row commits before the side effect").

`completeAudit` reads `row_hash`, computes the completion commitment with a
Node-side `completed_at`, and updates only `status/after/error/completion_hash/
completed_at` where `status = 'pending'`. A missing `row_hash` throws: better a
500 on a broken deployment than an unverifiable completion.

## Trigger

`admin_audit_log_immutable` fires on INSERT, UPDATE and DELETE.

| Operation | Permitted |
|---|---|
| INSERT | `row_hash` + `hash_version` present; pending rows without completion fields, or terminal rows with both |
| UPDATE | only `pending → succeeded/failed`, setting `completion_hash` + `completed_at` once; every other column must be unchanged |
| DELETE | never |

Making the hash columns part of the UPDATE deny-list is what stops a
"helpful" backfill from re-sealing a row without going through the script.

## Verification

Reading the window newest-first with a `LIMIT` is what makes "the last N rows"
cheap; the rows are reversed in memory and walked oldest-first.

```
first row:  prev_hash must be null only when no earlier row exists (genesis probe)
then:       prev_hash === previous.row_hash
always:     hash_version known, row_hash === computeRowHash(row)
terminal:   completion_hash === computeCompletionHash(...)
pending:    completion_hash === null && completed_at === null
```

The genesis probe is a single indexed lookup: `(created_at, id) < (first)`. When
it finds a row, the window starts mid-chain and the first link is simply
unverifiable — reported as `coversGenesis: false`, not as a break.

## Backfill

Sequence per run (default mode):

1. Read every row ascending.
2. For each row with `row_hash IS NULL`, compute the hash chained from the
   previous row's hash (stored or newly computed).
3. In one transaction: disable the trigger, update the rows, re-enable, commit.
4. Re-read and verify with the same code path as the API; exit non-zero if broken.

`--force` recomputes every row. That re-seals tampered rows, which is correct on
a scratch database and destructive as evidence anywhere else, so it is documented
as a dev-only reset.

## Bounds and failure modes

| Concern | Decision |
|---|---|
| Long verification | default 1,000, max 5,000, range reported in the response |
| Forks | advisory lock (primary), unique `row_hash` index (backstop) |
| Clock skew | 1 ms monotonic bump at insert |
| Chain write failure | mutation fails; the error surfaces as a 5xx |
| Missing backfill | `completeAudit` refuses; verification reports `missing_row_hash` |
| Unknown algorithm version | verification reports `unsupported_hash_version` |

## Testing

- Unit (`lib/audit-chain.test.ts`): golden canonical string and hash, per-field
  sensitivity, completion sensitivity, every verifier outcome.
- Handler (`handler.test.ts`): role matrix rows for both new routes, verified and
  broken responses, limit clamping, filter passthrough, export truncation, hashes
  present in the list response.
- Integration (`lib/audit.integration.test.ts`, gated on
  `AUDIT_TEST_DATABASE_URL`): real concurrent writers produce one chain, a
  completion verifies, a trigger-disabled edit is detected at the right row, the
  trigger rejects edits and deletes, and an unsealed row cannot be completed.
- UI: `tsc --noEmit` and `next lint` only; the repo has no admin test runner.
