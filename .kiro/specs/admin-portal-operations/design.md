# Design Document

## Overview

The operational layer is a set of mutations on top of the read-only foundation. Five properties hold across all of them:

1. **One envelope** - role, fresh auth, reason, audit, idempotency, confirmation.
2. **One authority** - the Admin API calls shared backend modules; the portal never reimplements business logic.
3. **One direction** - the portal asks the backend to act. It never holds wallet keys, signs transactions, or calls the CLOB.
4. **Fail closed** - a partial failure stops the action and leaves a visible record rather than silently continuing.
5. **Measured** - every control has a test for its state transition, and privileged actions are verified against a live dev environment before production.

## Mutation pipeline

```
Request
  │
  ├─ requireRole(event, minimum)
  ├─ requireFreshAuth (destructive actions)
  ├─ Zod parse body / query
  ├─ reason length >= 8
  ├─ idempotency key? claim (actor, action, key)
  ├─ INSERT admin_audit_log (status = pending)
  ├─ perform the shared-module action
  ├─ UPDATE audit (succeeded | failed, before/after, error)
  └─ return typed response with request id
```

A crash between the insert and the side effect leaves a `pending` row. That is intentional: an operator can see that something was attempted. The alternative - writing the audit after the side effect - can lose the record entirely.

### Error contract

| Status | Meaning |
|--------|---------|
| `401` | No valid authorizer context |
| `403` | Role too low |
| `403 REAUTH_REQUIRED` | `auth_time` older than 10 minutes |
| `409` | State conflict such as `LAST_OWNER` or an already-claimed ticket |
| `422` | Validation failure |
| `503` | A runtime setting is blocking the feature |
| `5xx` | Unexpected; alarmed |

## Kill switch

The kill switch is a per-user, two-phase control. A platform-wide halt is explicitly out of scope for v1: it requires the risk engine to iterate every user's sessions, which deserves its own reviewed change.

```
POST /admin/portfolio/kill-switch { userId, reason }
  → requireRole(admin) + fresh auth + reason
  → phase 1: activateUser(userId) writes DynamoDB kill-switch state
             (synchronous; every trading path checks it)
  → phase 2: invoke risk-engine { action: 'halt_sessions', userId, reason }
             as an asynchronous Event invocation
  → audit portfolio.kill_switch.activate
  → 202 { halted, activatedAt, exitsDispatched, note }

DELETE /admin/portfolio/kill-switch { userId, reason }
  → resetUser(userId)
  → audit portfolio.kill_switch.reset
```

State lives in the rate-limit DynamoDB table as `kill_switch#{userId}`. The executor and risk engine read it before placing orders.

Failure semantics are deliberate:

- If phase 1 fails, the request fails; the API never reports a halt that did not happen.
- If phase 2 fails, the halt still stands and the response says the exit dispatch failed. The operator can retry or exit manually. The audit row records the dispatch outcome.

The UI presents an explicit confirmation dialog and shows the returned dispatch state. It is available from the user detail page and the session detail page, so an incident does not require navigation. Reset is explicit and audited.

## Portfolio session controls

`routes/portfolio-mutations.ts` owns pause, resume, and terminate:

| Action | Minimum role | Backend effect |
|--------|--------------|----------------|
| Pause | `support` | Stop new entries; leave exits and guards active |
| Resume | `support` | Allow entries again; no state reset |
| Terminate | `admin` | Cancel pending orders, exit the open position, mark terminated with reason |

The portal reads session detail from `queries/portfolio.ts` and delegates execution to `shared/portfolio-orders.ts` and the lifecycle services. It never calls the CLOB directly. The session page includes trade and decision history plus the kill switch.

## User and account operations

`routes/user-mutations.ts` exposes:

- **Credits** - grant with amount and reason; uses the same ledger path as the product.
- **Plan override** - plan, expiry, reason; stored in `admin_plan_overrides`, survives renewals, visible to support.
- **Status** - suspend or reactivate with a reason; suspending pauses open sessions and leaves positions alone.
- **Notes** - support-only context stored in `admin_user_notes`.

The portal does not edit PII beyond status, plan, credits, and notes. A retried credit mutation is protected by the audit idempotency key, so a double click cannot double-credit.

## Portal membership

Membership is owner-only and Cognito-backed:

```
Add existing user:
  POST /admin/admins/{sub}/role { group, action: add|remove }
  → requireRole(owner) + fresh auth + reason
  → AdminAddUserToGroup / AdminRemoveUserFromGroup
  → audit

Invite unknown address:
  POST /admin/admins { email, role, invite: true, reason }
  → AdminCreateUser (temporary password email)
  → add group
  → audit invited: true
```

The invite path is opt-in so a mistyped address cannot silently create a stranger. The invitee chooses their own password on first sign-in, then enrols TOTP. The portal never sets a password. Removing a member revokes access immediately. The last-owner check runs inside a transaction and returns `409 LAST_OWNER`.

## Runtime settings

Settings live in `system_settings` and are declared in `infra/services/shared/settings.ts`:

| Key | Type | Consumer | Effect |
|-----|------|----------|--------|
| `analysis_paused` | boolean | `analysis-request` | Refuse new requests; schedules continue |
| `analysis_pause_message` | string | `analysis-request` | User-facing maintenance message |
| `ai_provider` | string | `ai-provider` | `bedrock`, `nebius`, or empty = deployed default |
| `pm_activations_paused` | boolean | `portfolio-activation` | Refuse new sessions; existing sessions continue |
| `support_enabled` | boolean | `support-api` | Refuse new tickets; unsubscribe still works |
| `support_first_response_target_hours` | string | admin support inbox | SLA and overdue flags |
| `newsletter_enabled` | boolean | `newsletter-api` | Hide prompt and refuse opt-ins; unsubscribe always works |

Reads are cached for 60 seconds per container. Synchronous consumers (`ai-provider`) call `warmSettings()` at invocation start and read `getSettingSync()`; without a warm cache they fall back to the declared default. A missing or unreadable row never changes behavior. Writes are owner-only, fresh-auth, reason-required, and audited.

## Analysis operations

`routes/analyses.ts` supports:

- **Cache invalidation** - clear the cached result for a market, with a reason.
- **Refund all recipients** - credit every row in `analysis_deliveries`, not just the requester.
- **Requeue** - clear the in-flight marker atomically, then dispatch a new request. The atomic clear is what prevents a concurrent request from creating a duplicate execution.

The detail view shows the recommendation, no-trade reason, agent signals, quality scores, and payload. Payloads come from a short-lived presigned S3 URL. Quality analytics show no-trade reason breakdown and live-vs-shadow performance.

## Customer support inbox

The portal is the support queue; there is no inbound email in v1.

```
Customer submits in product or /help
  → support-api creates ticket + context snapshot
  → tokenised thread link emailed
  → admin inbox (claim → reply → resolve)
  → customer replies in the same tokenised thread
```

Portal routes:

- `GET /admin/support/summary`, `GET /admin/support/tickets`, `GET /admin/support/tickets/{ref}`
- `POST …/claim`, `POST …/release`, `POST …/reply`, `POST …/status`
- All require `support` or above; claim is a conditional update.

Reply safety:

- `FOR UPDATE` on the ticket row.
- Another operator's ticket is refused unless the caller is `admin` or above.
- First reply claims the ticket.
- A customer email is suppressed inside 60 seconds.
- Internal notes never email.
- Resolving emails a linkless notice.

`support-housekeeping` runs hourly: releases claims idle 8 hours and closes tickets resolved 7 days ago. Tokens live in `support_thread_tokens`; rotation issues a new token and all unexpired tokens keep working until expiry.

## Newsletter operations

Newsletter is a separate marketing channel, deliberately isolated from transactional email.

```
Portal composer
  → typed template (market_brief | product_update)
  → shared renderer preview in a sandboxed iframe
  → draft → test send → owner send
  → claim campaign (idempotent)
  → snapshot audience
  → newsletter-send batches (50 per invocation, paced)
  → per-recipient render + unsubscribe token
  → delivery rows transition to a terminal state
```

Safety:

- Send is owner-only, fresh-auth, reason-required, and confirmed.
- `unique (campaign_id, email)` plus status transitions make a retry safe.
- A systemic failure stops the campaign at a 5% failure ratio instead of burning the list.
- Bounce/complaint webhooks verify the Svix signature over the raw body before parsing.
- Permanent bounces and complaints create a suppression; opens and clicks are ignored by design.
- Marketing consent is explicit; unsubscribe always works, even when the feature is disabled.

## Security and failure behavior

- The portal holds no wallet keys, no CLOB client, and no signing path.
- Every destructive action requires fresh auth and a reason.
- IAM is scoped per handler; the newsletter sender can be invoked only by the admin API.
- The audit table is append-only at the database layer.
- A failed mutation leaves a failed audit row and returns an explicit error; it never reports success.
- The PWA caches only content-hashed assets; admin data and navigations are never cached.

## Testing

- Handler tests cover success, forbidden, validation, audit, and idempotent replay for every mutation.
- Focused tests cover kill-switch state, session transitions, settings fallback and cache behavior, support claim/reply concurrency, newsletter send idempotency, and webhook signature rejection.
- The RBAC matrix test ensures no write route succeeds below its declared minimum role.
- `infra` and `tradewizard-admin` typecheck; `admin-typecheck` runs on save through Kiro.
- Privileged actions are verified against live dev before production; the progress log records what was verified live versus only compiled.

## Kiro traceability

This spec and its companion were written with Kiro's requirements → design → tasks workflow. The implementation is constrained by:

- `.kiro/steering/product.md` - product truth and the support/newsletter surfaces.
- `.kiro/steering/structure.md` - package boundaries; portal code stays in `tradewizard-admin/` and `admin-api`.
- `.kiro/steering/tech.md` - shared modules and the deterministic analysis rules the portal must not bypass.
- `.kiro/steering/kiroween.md` - submission constraints and honest claims.
- `.kiro/hooks/admin-typecheck.json` - typecheck the portal after TypeScript edits.
- `.kiro/hooks/analysis-gate-guard.json` - protect deterministic analysis stages when a portal change touches them.
- `.kiro/hooks/spec-task-followthrough.json` - close tasks, run affected tests, reconcile docs.

## Risks and mitigations

- **Kill switch under partial failure** - fail closed, terminate sessions anyway, flag un-exited positions, notify the user.
- **Double-send / double-credit** - audit idempotency keys and unique delivery constraints.
- **Support concurrency** - conditional claim, row locks, and ownership checks.
- **Settings drift** - every setting must name a consumer; missing rows fall back to defaults.
- **Requeue races** - clear the in-flight marker atomically before dispatch.
- **Operator error** - explicit confirmation, reasons, fresh auth, and a visible audit trail.
