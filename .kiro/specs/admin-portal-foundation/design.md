# Design Document

## Overview

The management portal is a separate control plane for a production prediction-market platform. It has three hard boundaries:

1. **Package boundary** - `tradewizard-admin/` is a separate Next.js app and never enters the customer bundle.
2. **Authorization boundary** - Cognito groups feed a request authorizer, and every handler re-checks the minimum role in code.
3. **Audit boundary** - every mutation writes to an append-only table before the response leaves the Lambda.

The portal is deliberately read-first. Phase 1 shipped every read surface before any mutation existed, because the read surfaces are the tools an operator needs to diagnose a bad write.

## Architecture

```
Operator browser
  │  Cognito email + password + TOTP (dedicated admin client)
  ▼
tradewizard-admin/  (Next.js 16, Amplify)
  │  ID token + refresh token in localStorage
  │  non-credential tw_admin_session cookie for the route guard
  ▼
admin-api  (API Gateway REST + Cognito REQUEST authorizer)
  │  admin-authorizer: verify ID token, groups → role, MFA gate
  │  requireRole(event, minimum) at the top of every route
  ▼
shared modules ── Amazon RDS for PostgreSQL (business data, audit, settings)
                ── S3 (analysis payloads, presigned)
                ── DynamoDB (kill switch, rate limits)
                ── CloudWatch (health, alarms)
                ── Lambda invoke (support/newsletter workers)
```

### Package layout

```
tradewizard-admin/
├── app/
│   ├── (app)/{overview,ops,users,billing,support,analyses,markets,agents,portfolio,newsletter,audit,members,settings}
│   ├── login/
│   ├── manifest.ts, robots.ts, layout.tsx
├── components/{ui,shell,data,domain,auth,users,analyses,portfolio,support,newsletter,pwa}
├── providers/AdminAuthProvider.tsx
├── hooks/use*.ts
├── lib/{admin-api,cognito,session,format,product-url}.ts
└── proxy.ts                      # presence-only route guard

infra/
├── lib/admin-stack.ts            # API, Lambdas, Cognito client, alarms
├── services/admin-api/           # router, routes, queries, lib
├── services/admin-authorizer/    # id-token verification + role + MFA
├── services/admin-metrics-rollup/
└── services/shared/admin-auth.ts # getAdminIdentity / requireRole / requireFreshAuth
```

## Authentication

The admin client is separate from the customer client. Sign-in is `USER_PASSWORD_AUTH`, then TOTP. Admin identities must be dedicated; reusing a customer address breaks their product magic-link login.

Sessions use the refresh token as the durable credential:

- Refresh token lifetime: 30 days.
- ID token lifetime: 1 hour, silently refreshed.
- Storage: `localStorage` with the `tw_admin_session` key.
- Cookie: `tw_admin_session` is a presence marker only. It contains no token, so a forged cookie can render an empty shell but cannot call the API.
- Route guard: `proxy.ts` checks whether a session marker exists and redirects to `/login?next=...`. It never authorizes.
- Legacy migration: a session found in `sessionStorage` is moved to `localStorage` and removed from `sessionStorage`.

### MFA bootstrap

`ADMIN_REQUIRE_MFA=true` makes the authorizer deny a token without a TOTP factor. The only exception is `/admin/bootstrap/*`, which still requires a valid token and an admin group. The flow is:

```
login → 403 MFA_REQUIRED
      → GET /admin/bootstrap/status { mfa: false }
      → AssociateSoftwareToken → QR code
      → VerifySoftwareToken → SetUserMFAPreference
      → POST /admin/bootstrap/mfa-enrolled
      → authorizer reads Cognito and confirms the factor exists
      → /admin/me 200, audit row admin.mfa.enrolled
```

The status endpoint exists because API Gateway replaces the authorizer's error body with a generic 403, so the client cannot read `MFA_REQUIRED` from the rejection itself.

### Fresh authentication

Destructive actions call `requireFreshAuth(event, 10 minutes)`. Cognito refresh tokens do not reset `auth_time`, so a real re-login is the only path. The UI renders `ReauthNotice` with a **Sign in again** button that signs out and returns to the same page.

## Authorization

| Role | Rank | Capability |
|------|------|------------|
| `analyst` | 10 | Read-only aggregates, analyses, agent performance |
| `support` | 20 | Read all; credits, notes, resend, pause/resume sessions |
| `admin` | 30 | All mutations except settings and role changes |
| `owner` | 40 | Everything, including settings and role changes |

- Group membership is read from `cognito:groups`; the highest rank wins.
- `requireRole(event, minimum)` is the first statement of every handler.
- The UI's `hasRole` copy is presentation only.
- The last owner cannot be removed; the check runs inside a transaction and returns `409 LAST_OWNER`.
- A denial increments `AdminAuthDenied` and logs the reason, never the token.

## Audit design

`admin_audit_log` is the governance record:

| Column | Purpose |
|--------|---------|
| `actor_sub`, `actor_email`, `actor_role` | Who |
| `action` | `domain.entity.verb`, for example `user.credits.grant` |
| `target_type`, `target_id` | What |
| `reason` | Why; at least 8 characters |
| `status` | `pending` → `succeeded` / `failed` |
| `idempotency_key` | One attempt per actor + action + key |
| `request_id`, `ip`, `user_agent` | Correlation and forensics |
| `before`, `after` | JSONB state snapshots |
| `created_at` | When |

Triggers reject `UPDATE` and `DELETE`, so the table is append-only even for a direct database session. The audit row is inserted before the side effect and updated to a terminal status afterward; a crash leaves a visible `pending` row rather than an unrecorded action.

## Admin API

### Routing

`lib/router.ts` maps method + path to a typed handler. Routes live in `routes/*.ts` and queries in `queries/*.ts`. Handlers do four things, in order:

1. `requireRole` / `requireFreshAuth`.
2. Parse and validate with Zod.
3. Run the shared module that owns the business rule.
4. Return a typed response.

### Read-path rules

The production database is a small single-AZ instance. The portal must not become a reporting warehouse:

- Every list is cursor-paginated and bounded.
- Dashboard trends read `admin_metrics_daily`, not raw event tables.
- Analysis payloads are presigned S3 URLs with a short TTL.
- Heavy operational state comes from CloudWatch, SQS attributes, and DynamoDB, not from joins over OLTP tables.
- Indexes exist for every supported filter combination; a new filter requires an index review.

### Error contract

```json
{ "error": { "code": "FORBIDDEN", "message": "…", "requestId": "…" } }
```

`401` means the request never passed the authorizer. `403` means the role is insufficient. `409` covers state conflicts such as `LAST_OWNER`. `422` covers validation. `5xx` is unexpected and alarmed.

## Read surfaces

| Surface | Data source | Notes |
|---------|-------------|-------|
| Overview | `admin_metrics_daily`, CloudWatch | 24h / 7d / 30d trends |
| Users | RDS PostgreSQL `users`, credits, sessions, payments, notes | Search + bounded detail queries |
| Analyses | RDS PostgreSQL `analysis_results`, S3 | No-trade reasons, live vs shadow, payload viewer |
| Portfolio | RDS PostgreSQL sessions/trades/decisions, DynamoDB kill switch | Cross-user exposure |
| Billing | payments, subscriptions, renewals | Read-only ledger |
| Agents | `agent_performance`, calibration, model cost | Leaderboard and cost |
| Ops | CloudWatch, SQS, RDS, alarms | No log reimplementation |
| Markets | analysis pool, schedules, stuck rows | Detect `is_executing` leaks |
| Audit | `admin_audit_log` | Append-only viewer |

## UI design

- Navigation is grouped by operator question, not database table: Monitor, Customers, Intelligence, Trading, Growth, Governance.
- Items declare a minimum role and a `ready` flag; hidden is a hint, not a guarantee.
- Longest-prefix matching keeps a detail page highlighted and provides the breadcrumb.
- Shared primitives enforce density and consistency: `Page`, `Panel`, `Stat`, `Dialog`, `DataTable`, `Filters`, `Notice`, `Tabs`.
- No optimistic updates. A mutation shows a pending state, then renders the server's answer.
- Every surface has explicit loading, empty, and error states.
- Detail views preserve list filters in the URL so operators can go back without losing context.

## Security posture

- The portal is never linked from the product.
- `X-Robots-Tag`, a `noindex` meta tag, and `robots.txt` keep it out of search.
- The admin bundle contains no wallet, CLOB, Magic SDK, or on-chain code.
- IAM grants are per-handler and scoped.
- CORS is an explicit origin allowlist.
- The PWA service worker caches only content-hashed assets. Navigations, API/RSC data, and presigned URLs are never cached; an offline navigation gets an inline notice rather than a previous operator's shell.
- The security checklist in `docs/admin-portal-architecture.md` §12 is the sign-off gate.

## Testing

- `admin-api/handler.test.ts` covers auth, role enforcement, validation, audit, pagination, and mutation contracts.
- `shared/admin-auth.test.ts` covers token parsing, role ranking, MFA, and fresh-auth failures.
- RBAC is property-tested across the route matrix: no route may succeed below its declared minimum role.
- `npx tsc --noEmit` in `tradewizard-admin/` is the UI safety net; the `admin-typecheck` Kiro hook runs it on save.
- `npm run synth:dev` must succeed after `admin-stack.ts` changes.

## Kiro traceability

This spec was developed alongside the portal using Kiro's spec workflow. The implementation is constrained by:

- `.kiro/steering/product.md` - what the platform is and who it serves.
- `.kiro/steering/structure.md` - package boundaries and where portal code belongs.
- `.kiro/steering/tech.md` - stack, shared modules, and the deterministic analysis invariants the portal must not bypass.
- `.kiro/steering/kiroween.md` - submission rules and honest-claim constraints.
- `.kiro/hooks/admin-typecheck.json` - typecheck the portal after TypeScript edits.
- `.kiro/hooks/spec-task-followthrough.json` - close tasks, run affected tests, and reconcile docs.

The companion spec `.kiro/specs/admin-portal-operations/` covers mutations, controls, support, newsletter, and runtime settings.

## Risks and tradeoffs

- **Copied primitives**: the admin app cannot import the product app, so primitives are duplicated. Accepted to keep admin code out of the public bundle.
- **Single-AZ database**: every new query is an availability risk. Pagination, rollups, and indexes are mandatory, not optional.
- **Session length**: a 30-day refresh token improves operations but increases the value of a stolen device session. The API authorizer, MFA gate, and fresh-auth checks remain the security boundary.
- **MFA bootstrap exception**: `/admin/bootstrap/*` is the one path that defers the MFA assertion. It is constrained to token + admin group and re-verifies the factor before recording enrolment.
