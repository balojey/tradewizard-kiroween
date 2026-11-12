# Warden Copilot — Tasks

**Status key:** [x] done, [~] done with follow-up, [ ] not done.

## Phase 1 — Incident Copilot

- [x] `admin-copilot` Lambda with read-only IAM (DB secret read, analysis bucket
      read, Bedrock invoke, no writes)
- [x] Read-only Postgres helper (`lib/db.ts`, 6 s statement timeout)
- [x] Role scoping (`lib/scope.ts`) reusing `AdminRole`
- [x] Audit retrieval (full-text + exact filters, LIMIT 50, 7-day max window)
- [x] Metrics retrieval (last hour + last 24 h)
- [x] Context builder with record/char budget
- [x] Prompt builder with delimited, JSON-encoded records
- [x] Citation validation + confidence downgrade
- [x] One model call, 20 s timeout, single retry, token cap
- [x] `POST /admin/copilot/incident` (analyst) + `GET /admin/copilot/status`
- [x] Audit page panel with "last hour", "settings this week", "build a timeline"
- [x] Audit `id` deep link so a citation opens the exact row
- [x] Unit + route tests

## Phase 2 — Support Copilot

- [x] Ticket + 30-message thread + requester plan/status retrieval
- [x] Summary and draft-reply prompt modes
- [x] `POST /admin/copilot/support` (support)
- [x] Ticket page panel; draft lands in the existing composer
- [x] Injection fixture test (ticket text cannot produce an action)

## Phase 3 — Risk Brief + Analysis/Session Explainer

- [x] Blast-radius retrieval (sessions, capital, recent admin actions)
- [x] Settings-by-action retrieval (admin+ only)
- [x] Static runbook citations
- [x] Analysis retrieval from S3 `detail/` with 14 per-agent citation records
- [x] `POST /admin/copilot/analysis` (analyst)
- [x] Session retrieval (10 trades / 10 decisions) + `POST /admin/copilot/session`
      (support) + linked analysis
- [x] `POST /admin/copilot/risk-brief` (admin)
- [x] "Review context" panel in terminate and kill-switch dialogs
- [x] Analysis detail and session detail panels

## Phase 4 — Hardening

- [x] `copilot_enabled` kill switch (UI hidden + 503)
- [x] `copilot_daily_limit` (per actor, UTC day)
- [x] 10 requests/minute per actor; 429 with retry hint
- [x] Cost log line (latency, tokens, estimated cost) — no question content
- [x] Prompt-injection tests
- [x] Architecture §18, progress log, runbook §7.11
- [x] Steering updates (`tech.md`, `structure.md`)
- [ ] Real dev-data question + support draft + NO_TRADE explanation recorded
      (needs a deployed stack with Bedrock access)
- [ ] Demo recording

## Follow-ups (deliberately out of scope)

- [ ] `admin_copilot_queries` usage table (today: CloudWatch only)
- [ ] Price-accurate cost accounting per model (today: approximate env rates)
- [ ] Streaming answers (today: one request/response)
- [ ] Cross-record entity resolution (today: deterministic tables only)
