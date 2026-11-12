# Audit Chain Integrity — Requirements

**Status:** Implemented (Phases 1–2). Phase 3 (HMAC anchor) deliberately not built.
**Plan:** `docs/plans/warden-audit-integrity.md`
**Architecture:** `docs/admin-portal-architecture.md` §7.3, §8.3, §11

## Problem

`admin_audit_log` is append-only by trigger, but a database-level actor could
still rewrite a row, and a reader had no way to tell. The portal could show
"every action is recorded" without being able to show that the record was intact.

## Requirements

### R1 — Every row commits to its predecessor

- Each row carries `prev_hash` (the previous row's `row_hash`, null only for the
  first row ever) and `row_hash`.
- `row_hash = sha256(canonical row)`, where the canonical row covers: `id`,
  `actorSub`, `actorEmail`, `actorRole`, `action`, `targetType`, `targetId`,
  `reason`, `before`, `createdAt`, `prevHash`, `hashVersion`.
- Canonical JSON is deterministic: sorted keys, no whitespace, `null` preserved.
- `hash_version` is stored so the algorithm can evolve; verification refuses a
  version it does not know rather than guessing.

### R2 — The completion state is separately committed

- `completion_hash = sha256(canonical({ rowHash, status, after, error, completedAt }))`.
- A terminal row carries both `completion_hash` and `completed_at`.
- A pending row carries neither.

### R3 — Writes are serialised

- `writeAuditLog` runs in its own transaction: advisory lock →
  `SELECT head` → compute → insert → commit.
- Two concurrent mutations cannot read the same head, so they cannot fork.
- A unique partial index on `row_hash` is the backstop.
- If the chain write fails, the mutation fails. No unauditable action runs.

### R4 — Verification is a read, and a finding is not an error

- `GET /admin/audit/verify?from=&to=&limit=` (minimum role `analyst`).
- Defaults to the last 1,000 rows, maximum 5,000; reports the range checked.
- Returns `200` with `valid: false`, `firstBrokenId` and `firstBrokenReason`
  when the chain is broken. A broken chain never pages someone as a 5xx.
- Verified rows are checked for: stored hash present, known hash version, row
  hash matches, link to the previous row, and completion hash (or absence).

### R5 — The portal must not overstate integrity

- The badge reads "Not verified" until a verification response says otherwise.
- A result is keyed to the window it was run against; changing filters or paging
  drops back to "Not verified".
- Row detail shows `row_hash`, `prev_hash`, `completion_hash`, `hash_version`.
- Export includes the hashes, capped at 5,000 rows with an explicit truncation
  notice.

### R6 — Existing rows are sealed idempotently

- `infra/scripts/backfill-audit-chain.ts` processes only rows with
  `row_hash IS NULL` unless `--force` is passed.
- It disables the immutability trigger only inside the update transaction.
- It verifies the whole chain on exit and exits non-zero when verification
  fails, so a broken chain cannot pass silently in a deploy log.
- Legacy terminal rows use `created_at` as `completed_at`: the original schema
  never recorded the completion time, and inventing a precise one would be worse
  than an upper bound. Documented, not hidden.

### R7 — System rows use the same writer

The hourly maintenance job inserts `user.plan.override.expire` rows. It now goes
through the shared chained writer; a raw insert would have no hash and would
break verification at that point.

## Non-goals

- **HMAC anchor** (§8 of the plan). It changes the threat model from "tamper
  evident against application and database accidents" to "against a database
  actor who cannot read Secrets Manager". Worth doing later with its own
  key-rotation runbook; not built here.
- **Detecting edits to unhashed metadata** (`ip`, `user_agent`, `request_id`,
  `idempotency_key`). These are trigger-immutable but outside the hash. Recorded
  as a known limit in the architecture doc rather than implied away.
- **Preventing deletion by a database superuser.** The chain detects it (the
  link breaks); the trigger only stops accidental and application-level deletes.
