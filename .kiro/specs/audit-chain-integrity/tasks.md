# Audit Chain Integrity — Tasks

**Status:** Phases 1–2 complete. Phase 3 (HMAC) not started, by decision.

## Phase 1 — Schema and hashing

- [x] `admin_audit_log` gains `prev_hash`, `row_hash`, `completion_hash`,
      `hash_version`, `completed_at` (idempotent `ALTER ... IF NOT EXISTS`)
- [x] Unique partial index on `row_hash`, chain-order index on `(created_at, id)`
- [x] Trigger covers INSERT/UPDATE/DELETE; hashes are immutable after insert;
      the completion transition is the only permitted update
- [x] `services/shared/audit-chain.ts`: `canonicalJson`, `computeRowHash`,
      `computeCompletionHash`, `insertChainedAuditRow` (advisory lock)
- [x] `services/admin-api/lib/audit.ts`: `writeAuditLog` / `completeAudit` use
      the chain; `completeAudit` refuses a row without `row_hash`
- [x] `services/shared/plan-overrides.ts`: system expiry rows go through the
      chained writer instead of a raw INSERT
- [x] `scripts/backfill-audit-chain.ts`: idempotent, `--dry-run`, `--force`
      (dev only), verifies on exit
- [x] Unit tests for canonical form and hash stability
- [x] Integration tests (gated on `AUDIT_TEST_DATABASE_URL`) for concurrency,
      completion, tamper detection and trigger enforcement

## Phase 2 — Verification and UI

- [x] `GET /admin/audit/verify` (analyst, 1,000 default / 5,000 max, 200 on break)
- [x] `GET /admin/audit/export` (analyst, 5,000 cap + truncation flag)
- [x] Hashes returned by `GET /admin/audit`
- [x] Audit page: verified / broken / not verified badge, Verify chain button,
      result notice with range and head
- [x] Row detail dialog with `row_hash`, `prev_hash`, `completion_hash`,
      `hash_version` and before/after payloads
- [x] Filters: actor, action, target type, status, from, to
- [x] Export JSON and CSV including hashes
- [x] Empty state: "No audit rows yet."
- [x] `npm run typecheck` and `npm run lint` clean

## Phase 3 — Hardening (not started)

- [ ] HMAC-SHA256 anchor with `tw-{env}-audit-hmac-key` in Secrets Manager
- [ ] Seed a demo chain for screenshots (only against real rows)
- [ ] Runbook security-checklist review after the HMAC decision

## Verification evidence collected (2026-11-12, dev)

- [x] `npm run build`, `npm test`, `npm run synth:dev` green in `infra/`
- [x] Dev database has the five chain columns and the trigger
- [x] Deploy-time backfill sealed all 47 pre-existing rows
      (`backfill-audit-chain.ts --dry-run` → `chain verified: 47 row(s)`)
- [x] Tamper drill on a throwaway database on the same RDS instance:
      3 rows seeded through the real writer verify; one trigger-disabled edit
      makes the script exit 1 naming that row (`row_hash_mismatch`); `--force`
      reseals and verifies
- [x] 5 DB-gated integration tests pass against that scratch database,
      including two concurrent writers producing one chain
- [ ] Portal click-through: **Verify chain** shows **Chain verified** over the
      dev log, and a fresh mutation shows `row_hash` + `completion_hash` in the
      row dialog

The scratch database was dropped afterwards; dev was read-only throughout
(no dev audit row was edited or resealed).
