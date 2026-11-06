# Requirements Document

## Introduction

The TradeWizard Management Portal is a separate internal Next.js application backed by a dedicated `admin-api` Lambda and `admin-authorizer`. It exists so operators can observe and control the production pipeline without using the AWS console, and so every privileged action is role-gated, reason-required, and auditable.

This spec covers the portal foundation: package isolation, authentication, authorization, the append-only audit spine, the admin API contract, read-only visibility across the business, and the UI shell. It is the first of two portal specs; `.kiro/specs/admin-portal-operations/` covers the mutations and controls built on top of this foundation.

The binding architecture is `docs/admin-portal-architecture.md`. When this spec and that document disagree, the architecture document wins and both are corrected in the same change.

## Glossary

- **Admin portal**: The `tradewizard-admin/` Next.js application, deployed separately from the customer product.
- **Admin API**: The `admin-api` Lambda behind its own REST API and Cognito authorizer.
- **Admin authorizer**: The `admin-authorizer` Lambda that verifies the ID token, computes the role, and enforces the MFA gate.
- **Role**: One of `analyst`, `support`, `admin`, or `owner`, ordered by rank.
- **Fresh authentication**: A token whose `auth_time` is within 10 minutes, required for destructive actions.
- **Audit event**: An append-only row in `admin_audit_log` describing who did what, to which target, and why.
- **Read path**: A portal surface that only reads business data.
- **Analysis pool**: The market-level deduplication and scheduling state behind analysis execution.
- **Rollup**: Pre-computed daily business metrics in `admin_metrics_daily`, refreshed by `admin-metrics-rollup`.

## Requirements

### Requirement 1: Isolated internal application

**User Story:** As a platform owner, I want the portal to be a separate application from the customer product, so that admin code and data can never leak into the public bundle.

#### Acceptance Criteria

1. THE Admin portal SHALL be implemented in `tradewizard-admin/` as a Next.js 16 App Router package with its own `package.json`.
2. THE Admin portal SHALL deploy as a separate Amplify application rooted at `tradewizard-admin/`.
3. THE Admin portal SHALL NOT be linked from the customer product or its navigation.
4. THE Admin portal SHALL NOT import code from `tradewizard-frontend/`; shared contracts are duplicated deliberately.
5. THE Admin portal SHALL NOT contain wallet, Magic SDK, Polymarket client, order-placement, or on-chain signing code.
6. THE Admin portal SHALL request `X-Robots-Tag: noindex, nofollow, noarchive` and SHALL serve `robots.txt` with `Disallow: /`.
7. THE Admin portal SHALL render a `noindex, nofollow` meta tag from its root layout.
8. THE Root `amplify.yml` SHALL support multiple `appRoot` entries so the product and portal build independently.

### Requirement 2: Authentication and sessions

**User Story:** As an operator, I want a strong, dedicated sign-in so that portal access is not equivalent to a customer account.

#### Acceptance Criteria

1. THE Admin portal SHALL authenticate with email, password, and TOTP against a dedicated Cognito app client using `USER_PASSWORD_AUTH`.
2. THE Admin portal SHALL require admin accounts to be dedicated identities and SHALL document that reusing a customer address breaks their magic-link login.
3. WHEN an admin has no TOTP factor, THE Admin portal SHALL offer self-service enrolment with a QR code and SHALL complete `AssociateSoftwareToken` → `VerifySoftwareToken` → `SetUserMFAPreference`.
4. THE Admin authorizer SHALL require a TOTP factor when `ADMIN_REQUIRE_MFA=true`, except on `/admin/bootstrap/*`, where a valid token and admin group are still required.
5. THE Admin portal SHALL keep the session in `localStorage` with a 30-day Cognito refresh token, silently refresh the 1-hour ID token, and write a non-credential `tw_admin_session` cookie only as a route-guard marker.
6. WHEN a portal session is absent or expired, THE route guard SHALL redirect to `/login` with a `next` parameter.
7. WHEN a destructive action is attempted with a token older than 10 minutes, THE Admin API SHALL return `403 REAUTH_REQUIRED`, and the UI SHALL offer a sign-in-again path that returns to the same page.
8. THE Admin portal SHALL support immediate revocation of a portal member's group access by an owner.

### Requirement 3: Role-based authorization

**User Story:** As a platform owner, I want every portal capability to have a minimum role enforced by the backend, so that hiding a button is never the security boundary.

#### Acceptance Criteria

1. THE Admin API SHALL support four roles with ranks `analyst=10`, `support=20`, `admin=30`, and `owner=40`.
2. WHEN an identity belongs to multiple groups, THE Admin authorizer SHALL assign the highest rank.
3. THE Admin API SHALL call `requireRole(event, minimumRole)` as the first statement of every route handler.
4. THE Admin API SHALL recompute `roleRank` from the role and SHALL ignore any client-supplied rank.
5. IF a caller lacks the minimum role, THEN THE Admin API SHALL return `403 FORBIDDEN`.
6. IF a request did not pass through the authorizer, THEN THE Admin API SHALL return `401 UNAUTHORIZED`.
7. THE Admin portal SHALL hide navigation and actions the current role cannot perform, and SHALL treat that as presentation only.
8. THE Admin API SHALL refuse to remove the last remaining owner with `409 LAST_OWNER`, enforced inside a transaction.
9. THE Admin authorizer SHALL emit an `AdminAuthDenied` metric on every denial without logging the token.

### Requirement 4: Append-only audit spine

**User Story:** As an operator or auditor, I want a permanent record of every mutation, so that any state change can be reconstructed and attributed.

#### Acceptance Criteria

1. THE Admin API SHALL write an audit row for every mutation before returning a response.
2. THE `admin_audit_log` table SHALL be append-only; database triggers SHALL reject `UPDATE` and `DELETE`.
3. THE Admin API SHALL require a reason of at least 8 characters for every mutation.
4. AN audit event SHALL record actor sub, actor email, actor role, action, target type, target id, reason, status, request id, IP, user agent, before state, after state, and creation time.
5. THE Admin API SHALL transition the audit row from `pending` to `succeeded` or `failed`, and SHALL store the error on failure.
6. WHEN an idempotency key is supplied, THE Admin API SHALL enforce one attempt per `(actor_sub, action, idempotency_key)` and replay rather than repeat the side effect.
7. THE Audit viewer SHALL filter by actor, action, target type, target id, and date range.
8. Audit actions SHALL follow the `domain.entity.verb` naming convention, for example `user.credits.grant`.

### Requirement 5: Dedicated admin API

**User Story:** As a developer, I want one narrow, typed API for the portal, so that the admin surface cannot drift from the product contracts.

#### Acceptance Criteria

1. THE Admin API SHALL be a separate REST API defined in `admin-stack.ts` with a Cognito authorizer.
2. THE Admin API SHALL expose routes under `/admin/*` and SHALL use consistent JSON error envelopes.
3. THE Admin API SHALL validate every body and query with Zod schemas before touching the database.
4. THE Admin API SHALL use cursor pagination for list endpoints and SHALL bound every page size.
5. THE Admin API SHALL call shared backend modules for credits, notifications, kill-switch state, and support logic instead of reimplementing them.
6. THE Admin API SHALL use scoped IAM grants per handler and SHALL avoid wildcard resources where a narrower grant is possible.
7. THE Admin API SHALL reject cross-origin requests outside the configured `ADMIN_ALLOWED_ORIGINS` allowlist.
8. THE Admin API SHALL include the request id in logs and error responses for correlation.

### Requirement 6: Read-only business visibility

**User Story:** As a support engineer, I want to answer "what happened to this user, analysis, session, or payment?" without opening the AWS console.

#### Acceptance Criteria

1. THE Overview page SHALL show signups, analyses, revenue, active PM sessions, realized P&L, and error trends for 24h, 7d, and 30d.
2. THE Users surface SHALL list and search accounts and show detail, credits, analyses, sessions, payments, notes, plan, and status.
3. THE Analyses surface SHALL list and filter by market, user, recommendation, outcome, no-trade reason, and date, and SHALL show a full payload from a presigned S3 URL.
4. THE Analyses surface SHALL show quality analytics including no-trade reason breakdown and live-vs-shadow performance.
5. THE Portfolio surface SHALL show cross-user sessions, exposure, trades, decisions, and P&L.
6. THE Billing surface SHALL show payments, renewals, trial state, and subscription detail; reconciliation is read-only and out of scope.
7. THE Agents surface SHALL show the accuracy leaderboard, calibration, and cost per analysis.
8. THE Ops surface SHALL show queue depth and age, DLQ depth, Lambda health, alarm state, and database health.
9. THE Markets surface SHALL show analysis-pool state, schedules, and stuck executions.
10. THE Audit surface SHALL show the append-only event log with filters.
11. Read queries SHALL be bounded and indexed, and SHALL NOT run unbounded aggregates over `analysis_deliveries`, `agent_memory`, or `analysis_results`.
12. Analysis payloads SHALL be served as short-lived presigned S3 URLs, never proxied through the Lambda response body.

### Requirement 7: UI shell and design system

**User Story:** As an operator, I want a dense, consistent control surface that is fast to scan and hard to misread.

#### Acceptance Criteria

1. THE Navigation SHALL be grouped by operator question: Monitor, Customers, Intelligence, Trading, Growth, and Governance.
2. THE Navigation SHALL expose readiness and minimum role per item, and SHALL highlight the longest matching route.
3. THE UI SHALL use the shared `Page`, `Panel`, `Stat`, `Dialog`, `Button`, `Input`, `Badge`, `Notice`, `Tabs`, and `DataTable` primitives.
4. THE UI SHALL NOT use optimistic updates for mutations; it SHALL show the server-confirmed state.
5. THE UI SHALL provide explicit loading, empty, and error states for every data surface.
6. THE UI SHALL be usable on a phone, including a mobile jump list, and SHALL keep native device scale on iOS.
7. Detail pages SHALL deep-link from list rows and SHALL preserve filters in the URL.
8. THE Portal SHALL be installable as a PWA with a manifest and icons, and SHALL register the service worker in production only.

### Requirement 8: Security, observability, and verification

**User Story:** As a platform owner, I want the portal's security posture to be checkable, so that a release does not quietly weaken it.

#### Acceptance Criteria

1. THE Admin bundle SHALL contain no secrets, tokens, or privileged endpoints beyond the public Cognito identifiers required at build time.
2. THE Service worker SHALL cache content-hashed static assets only and SHALL never cache navigations, API responses, RSC payloads, or presigned S3 URLs.
3. THE Admin stack SHALL alarm on authorizer denials, API 5xx responses, and metrics-rollup failures.
4. THE `admin-metrics-rollup` Lambda SHALL refresh `admin_metrics_daily` hourly so the dashboard does not aggregate OLTP tables per request.
5. THE Portal SHALL pass the security checklist in `docs/admin-portal-architecture.md` §12 before production.
6. THE Admin API SHALL have handler tests for authentication, role enforcement, validation, audit, and idempotency.
7. THE Admin portal SHALL typecheck with `npx tsc --noEmit` and SHALL be covered by the `admin-typecheck` Kiro hook.
