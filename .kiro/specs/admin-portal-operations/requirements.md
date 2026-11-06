# Requirements Document

## Introduction

The management portal's second layer is its operational control surface: the mutations and workflows that let an operator stop trading, manage sessions and accounts, change runtime configuration, handle customer support, and send the newsletter. Every one of these actions touches production money, customer access, or outbound email, so the safety envelope is part of the feature, not an afterthought.

This spec builds on `.kiro/specs/admin-portal-foundation/`. That spec defines the package boundary, authentication, roles, audit spine, admin API, and read surfaces. This spec defines what the portal is allowed to change, and the invariants that make each change reviewable.

## Glossary

- **Mutation envelope**: The common requirements for every write: role, fresh auth, reason, audit, idempotency, and explicit confirmation.
- **Kill switch**: The fail-closed control that stops a user's trading, or all trading, and exits positions.
- **Session**: An autonomous Portfolio Manager session with a persona, capital envelope, and market.
- **Runtime setting**: A database-backed configuration value read by a named product service without a redeploy.
- **Requeue**: Re-dispatch a market's analysis after clearing the in-flight state.
- **Suppression**: An address that must not receive newsletter mail after a bounce or complaint.
- **SLA**: The first-response target used to flag overdue support tickets.

## Requirements

### Requirement 1: Common mutation envelope

**User Story:** As a platform owner, I want every write to follow the same safety contract, so that no mutation can become an unaudited back door.

#### Acceptance Criteria

1. EVERY mutation SHALL declare a minimum role and SHALL call `requireRole` before parsing the body.
2. EVERY destructive mutation SHALL require fresh authentication and SHALL return `403 REAUTH_REQUIRED` when `auth_time` is older than 10 minutes.
3. EVERY mutation SHALL require a reason of at least 8 characters and SHALL persist it to the audit log.
4. EVERY mutation SHALL write an audit row before the side effect and SHALL finish as `succeeded` or `failed`.
5. WHEN the client supplies an idempotency key, THE Admin API SHALL make a retry replay rather than repeat the side effect.
6. THE UI SHALL require an explicit confirmation for destructive actions and SHALL NOT use optimistic updates.
7. THE Admin API SHALL return the server-confirmed state and SHALL surface failures without hiding the audit row.

### Requirement 2: Kill switch

**User Story:** As an operator, I want to stop a user's trading immediately and predictably, so that a bad market or a runaway session cannot keep losing money while I investigate.

#### Acceptance Criteria

1. THE Portal SHALL offer a per-user kill switch; a platform-wide halt is explicitly out of scope for v1 because it requires the risk engine to iterate every user's sessions.
2. THE Kill switch SHALL be two-phase: a synchronous halt that writes the state every trading path checks, followed by an asynchronous exit dispatch to the risk engine.
3. THE Kill switch SHALL require fresh authentication, a reason, and a minimum role of `admin`.
4. WHEN the kill switch is activated, THE Admin API SHALL write the kill-switch state before returning, so new entries are blocked even if the exit dispatch fails.
5. WHEN the halt is committed, THE Admin API SHALL dispatch `halt_sessions` to the risk engine as an asynchronous invocation to cancel pending orders and exit open positions.
6. THE Admin API SHALL return `202` with `halted`, `activatedAt`, `exitsDispatched`, and an operator-facing note.
7. IF the exit dispatch fails, THE halt SHALL remain in place, the response SHALL say the exit dispatch failed, and the operator SHALL be able to retry or exit manually.
8. THE Kill switch SHALL be available from the user detail page and the session detail page.
9. THE Portal SHALL show the current kill-switch state and SHALL allow an explicit reset with a reason.
10. A kill-switch drill SHALL pass against a live dev session before the route is enabled in production.

### Requirement 3: Portfolio session controls

**User Story:** As a support or operations engineer, I want to pause, resume, or terminate one session without touching the rest, so that I can contain a single bad actor.

#### Acceptance Criteria

1. THE Session detail page SHALL show persona, market, capital, status, trades, decisions, P&L, and guardrail state.
2. THE Portal SHALL allow `support` and above to pause and resume a session with a reason.
3. THE Portal SHALL allow `admin` and above to terminate a session with a reason.
4. WHEN a session is paused, THE Portfolio Manager SHALL stop opening new positions and SHALL leave existing exits and guards active.
5. WHEN a session is terminated, THE backend SHALL cancel pending orders, exit the open position, and mark the session terminated with a reason.
6. THE Session page SHALL include the kill switch so an operator does not have to navigate away during an incident.
7. THE Portal SHALL NOT call the Polymarket CLOB or hold signing keys; it delegates execution to the existing portfolio services.

### Requirement 4: User and account operations

**User Story:** As a support engineer, I want to resolve account and credit issues without a database session, so that customers get help quickly and every change is recorded.

#### Acceptance Criteria

1. THE User detail page SHALL support granting credits, with amount and reason, and SHALL audit the change.
2. THE User detail page SHALL support a plan override with expiry and reason, and SHALL show the override to support.
3. THE User detail page SHALL support suspension and reactivation, with a reason.
4. THE User detail page SHALL support support notes visible to portal staff.
5. THE Portal SHALL NOT edit customer PII beyond status, plan, credits, and notes.
6. WHEN a credit or plan mutation is retried, THE Admin API SHALL NOT double-apply it.

### Requirement 5: Portal membership and roles

**User Story:** As an owner, I want to manage who can operate the portal, so that access is deliberate and revocable.

#### Acceptance Criteria

1. THE Members page SHALL be visible to `owner` only.
2. THE Portal SHALL support adding an existing Cognito user to an admin group and SHALL support inviting an unknown address with `AdminCreateUser`.
3. AN invitee SHALL choose their own password on first sign-in and SHALL enrol a TOTP factor before using the portal.
4. THE Portal SHALL NEVER set or display a password.
5. THE Portal SHALL support changing a member's role and SHALL audit the change.
6. THE Portal SHALL revoke access immediately when a member is removed.
7. THE Admin API SHALL refuse to remove the last remaining owner with `409 LAST_OWNER`.
8. THE UI SHALL explain that portal accounts must be dedicated identities.

### Requirement 6: Runtime settings

**User Story:** As an owner, I want to change operational behavior without a deploy, so that I can pause a broken surface or switch a provider during an incident.

#### Acceptance Criteria

1. EVERY runtime setting SHALL have a named consumer in the same change that introduces it.
2. THE Settings page SHALL show each key, its value, its default, its consumer, and its last update metadata.
3. THE Portal SHALL support `analysis_paused`, `analysis_pause_message`, `ai_provider`, `pm_activations_paused`, `support_enabled`, `support_first_response_target_hours`, and `newsletter_enabled`.
4. WHEN `analysis_paused` is true, THE product SHALL reject new analysis requests with a maintenance message and SHALL leave existing schedules running.
5. WHEN `pm_activations_paused` is true, THE product SHALL refuse new Portfolio Manager sessions and SHALL leave existing sessions trading unless the kill switch is used.
6. WHEN `ai_provider` is set, THE AI provider factory SHALL use the override without a redeploy; an empty value SHALL follow the deployed `AI_PROVIDER`.
7. A missing or unreadable setting row SHALL fall back to the declared default and SHALL NOT change behavior.
8. Settings SHALL be cached for 60 seconds per container, and synchronous consumers SHALL read a warmed cache.
9. Settings writes SHALL require `owner`, fresh authentication, and a reason, and SHALL be audited.

### Requirement 7: Analysis operations

**User Story:** As an operations engineer, I want to requeue, invalidate, or refund an analysis, so that a stuck or wrong result can be recovered without manual SQL.

#### Acceptance Criteria

1. THE Analyses page SHALL support cache invalidation, refund every recipient, and requeue a market's analysis.
2. Requeue SHALL clear the in-flight state atomically so a concurrent request cannot create a duplicate execution.
3. Refund SHALL credit every recipient recorded in `analysis_deliveries`, not just the requesting user.
4. Cache invalidation SHALL require `admin` and a reason.
5. THE Analysis detail SHALL show the recommendation, no-trade reason, agent signals, quality scores, and the full payload.
6. Payload viewing SHALL use a short-lived presigned S3 URL.
7. THE Portal SHALL show live-vs-shadow consensus performance and the no-trade reason breakdown.

### Requirement 8: Customer support inbox

**User Story:** As a support agent, I want to handle customer tickets in one place with the product context attached, so that I can answer once and see the same thread the customer sees.

#### Acceptance Criteria

1. THE Support inbox SHALL list tickets with status, topic, requester, age, assignee, and SLA/overdue state.
2. THE Ticket detail SHALL show the customer-visible thread, the context snapshot, internal notes, and the recorded page path.
3. THE Portal SHALL support claim, release, reply, status change, and resolution.
4. A reply SHALL take a row lock, SHALL refuse another operator's ticket unless the caller is `admin` or above, and SHALL claim on first reply.
5. Replies SHALL email the customer through `shared/support-email.ts`, rotate the thread token, and suppress a second email inside 60 seconds.
6. Internal notes SHALL never be emailed.
7. THE Context panel SHALL open the market in the product app and the analysis record in a dialog.
8. THE Hourly housekeeping worker SHALL release claims idle for 8 hours and close tickets resolved 7 days ago.

### Requirement 9: Newsletter operations

**User Story:** As an owner, I want to compose, preview, test, and send the newsletter from the portal, so that editorial mail ships without a separate tool.

#### Acceptance Criteria

1. THE Portal SHALL list campaigns with draft, sending, sent, and cancelled state.
2. THE Composer SHALL support typed templates (`market_brief`, `product_update`) and SHALL validate content with Zod before preview or send.
3. THE Preview SHALL use the production renderer inside a sandboxed iframe.
4. THE Portal SHALL support a test send to the operator before a real send.
5. SENDING SHALL require `owner`, fresh authentication, a reason, and an explicit confirmation.
6. THE Send claim SHALL be idempotent so a retried click cannot send twice.
7. THE Sender SHALL snapshot the audience, render per recipient, send in paced batches, and stop after a 5% failure ratio.
8. THE Subscribers page SHALL show status, source, join date, account link, and suppression reason, with search and filters.
9. THE Portal SHALL show campaign delivery counts and failures.
10. Marketing mail SHALL remain separate from transactional email.

### Requirement 10: Security and verification

**User Story:** As a platform owner, I want the operational controls to be testable, so that an incident does not depend on an untested button.

#### Acceptance Criteria

1. EVERY mutation route SHALL appear in the RBAC matrix with its minimum role.
2. EVERY mutation SHALL be covered by a handler test for success, forbidden, validation, and audit behavior.
3. THE Kill switch, session controls, settings, support, and newsletter SHALL have focused tests for their state transitions.
4. THE Portal SHALL typecheck and lint cleanly, and the `admin-typecheck` Kiro hook SHALL run on save.
5. THE Production rollout SHALL verify each privileged action against a live dev environment before enabling it for production.
6. THE Security checklist in `docs/admin-portal-architecture.md` §12 SHALL be updated with the operational controls.
7. THE Portal SHALL NOT expose a generic SQL, shell, or arbitrary Lambda invocation surface.
8. WHEN a mutation cannot complete, THE Portal SHALL leave a visible failed audit row and SHALL NOT silently report success.
