# TradeWizard Operations Portal - Kiroween 2026

> **Category: Frankenstein**
>
> The audited control surface for a live multi-agent prediction-market platform. A separate internal Next.js product, specified and documented by two Kiro specs during the submission period.

## Why this is the submission

TradeWizard itself is a live prediction-market platform: fourteen AI agents, a deterministic analysis pipeline, an autonomous Portfolio Manager, credits, on-chain billing, support, and a newsletter.

The new thing built during Kiroween is the **Operations Portal**: the product that lets a team operate that platform safely. It is not a rebrand of the platform and not a CRUD dashboard. It is a separate application with its own API, identity, roles, audit trail, runtime controls, and deployment.

The platform is context. The portal is the submission.

## What the portal does

The portal is a role-gated control surface with four jobs: observe, control, configure, and account for what happened.

**Observe.** Overview metrics, users and their credits/analyses/sessions/payments/notes, analyses with quality analytics and presigned payloads, portfolio sessions with trades and decisions, billing, agent calibration and cost, queues and alarms, markets, and the audit log.

**Control.** A fail-closed per-user kill switch, session pause/resume/terminate, credit grants, plan overrides, account suspension, support notes, member invitations and removal, analysis cache invalidation, refunds, and market requeue.

**Configure.** Audited runtime settings, each with a named consumer: pause new analysis, edit the maintenance message, override the AI provider, pause new Portfolio Manager activations, tune support SLA, or disable newsletter opt-ins. A missing or unreadable setting falls back to the deployed default.

**Account for it.** Every mutation requires a reason and writes an append-only audit row before the side effect, with actor, action, target, before/after state, request id, and idempotency key. Database triggers reject updates and deletes.

The portal also carries the support inbox and the newsletter composer. Support tickets keep the analysis or session context that prompted them and use a tokenised customer thread. Newsletter campaigns are composed from typed templates and sent by an owner with fresh auth; bounce and complaint webhooks are signature-verified.

It is installable as a PWA, but the service worker caches only content-hashed static assets. Navigations, API responses, RSC payloads, and presigned S3 URLs are never cached, so a shared machine cannot show a previous operator's shell.

## Why this is a Frankenstein

The portal is a chimera of systems that normally do not share a body:

- A separate Next.js 16 application that never enters the customer bundle
- Amazon Cognito for email + password + TOTP, admin groups, and a request authorizer
- A dedicated admin API on API Gateway, backed by Lambda
- Amazon RDS for PostgreSQL for business state and an append-only audit log
- Amazon DynamoDB for kill-switch state, rate limits, and concurrent claims
- Amazon S3 for analysis payloads behind short-lived presigned URLs
- EventBridge Scheduler for housekeeping and metrics rollups
- SNS and CloudWatch for alarms and operational visibility
- AWS Amplify Hosting for a separate admin domain
- A conservative PWA service worker that treats browser caching as a security decision

The unusual part is the contract between them: the portal can stop a live trading system, but it cannot move money; it can change runtime behavior, but every change names its consumer and lands in an immutable log; it can read sensitive data, but it never holds the keys to act on-chain.

Kiro is the stitching. Two specs define the foundation and the operations layer, four steering documents constrain the work, and hooks verify the parts most likely to drift.

## How Kiro built it

### Specs

- **`admin-portal-foundation`** - package isolation, Cognito authentication, MFA bootstrap, four-tier RBAC, the append-only audit spine, the admin API contract, read surfaces, the UI shell, and the security checklist.
- **`admin-portal-operations`** - the mutation envelope, per-user kill switch, session controls, account operations, membership and invites, runtime settings, analysis operations, support inbox, newsletter, and verification.

Both have requirements, a design, and an ordered task list. The tasks are checked against shipped code.

### Steering

Four documents constrain the work:

- `product.md` - the platform the portal operates, and the support/newsletter surfaces.
- `structure.md` - package boundaries; portal code stays in `tradewizard-admin/` and `admin-api`.
- `tech.md` - shared modules and the deterministic analysis invariants the portal must not bypass.
- `kiroween.md` - category, license, honest claims, and demo rules.

The most useful rule was negative: deterministic analysis stages must never contain model calls. That kept a portal change from weakening the product it operates.

### Hooks

Five hooks automate verification: `admin-typecheck`, `infra-typecheck`, `frontend-typecheck`, `analysis-gate-guard`, and `spec-task-followthrough`. The admin typecheck is the daily guardrail; the gate guard matters when a portal change reaches into the analysis pipeline.

### MCP

`.kiro/settings/mcp.json` connects Kiro to Magic Link and Polymarket documentation, so admin auth and the product's market/order contracts are verified against the source instead of recalled.

### Property-based testing

The portal's authorization surface is covered by `fast-check` properties: role ranking, group-to-role resolution, order independence, `requireRole` across every role pair, the fresh-auth window, and bearer-token extraction. Each property runs 100-300 generated cases. The remaining suites are example-based.

## How it works

```
Operator browser
  │  Cognito email + password + TOTP
  ▼
tradewizard-admin/  (Next.js 16, Amplify)
  │  ID token + 30-day refresh token
  │  presence-only tw_admin_session cookie
  ▼
admin-api  (API Gateway REST + Cognito REQUEST authorizer)
  │  verify ID token → groups → role → MFA gate
  │  requireRole + requireFreshAuth at the handler
  ▼
shared modules → RDS PostgreSQL / DynamoDB / S3 / CloudWatch
                → Lambda invoke for support and newsletter workers
```

The four roles are cumulative: analyst (read-only), support (credits, notes, session pause/resume), admin (all mutations except settings and roles), owner (settings and membership). Every handler re-checks the minimum role. Destructive actions require a token fresher than 10 minutes and a reason. The last owner cannot be removed.

The kill switch is per-user and two-phase: a synchronous DynamoDB halt blocks new entries before the response, then the risk engine is invoked asynchronously to cancel orders and exit positions. If the dispatch fails, the halt still stands and the response says the exit failed.

A runtime setting is only allowed if a service reads it in the same change. Reads are cached for 60 seconds; a missing row falls back to the default. Writes are owner-only, fresh-auth, reason-required, and audited.

## Challenges

**Operating a live system is a product, not a script.** The first version was console runbooks. The hard part was making the portal fast during an incident while still forcing a reason, a role, and an audit row.

**Fresh authentication was a dead end.** The API returned `REAUTH_REQUIRED`, but the UI had no way forward. The fix was a reauthentication notice that signs out and returns to the same page.

**The last owner is a single point of failure.** Removing the final owner would lock everyone out. The check runs in a transaction and returns `409 LAST_OWNER`.

**A kill switch must fail closed.** The halt is written before the exit dispatch. If the dispatch fails, the halt remains and the operator sees the failure.

**Settings are theatre without consumers.** Every switch names the service that reads it. A value nobody reads is worse than no switch, because it looks like control.

**Support concurrency.** Two agents can open the same ticket. Claim is a conditional update, replies take a row lock, and ownership is checked before a reply.

**Newsletter idempotency.** The campaign claim, unique `(campaign_id, email)`, and per-delivery status transitions make a retried send safe.

**PWA caching is a security decision.** A normal service worker would cache a previous operator's shell on a shared machine. This one caches content-hashed assets only.

## Accomplishments

- A real control plane for a live trading system: role-gated, reason-required, append-only.
- Four-tier RBAC enforced by the authorizer and re-checked in every handler.
- An audit spine inserted before the side effect and immutable at the database layer.
- A fail-closed kill switch with synchronous halt and asynchronous exit.
- Runtime settings with named consumers.
- Contextual support tickets and consent-first newsletter campaigns in the same control plane.
- A PWA that does not leak the previous operator.
- Two Kiro specs that trace the portal end to end.

## What we learned

- Admin UX is safety UX: the reason, role, and audit row are the real features.
- Write the audit row before the action; append-after-success loses the record.
- Every setting needs a consumer, or the portal lies about control.
- Fresh auth is not friction to remove; it separates a stolen session from a kill switch.
- Caching is a security boundary, not a performance tweak.
- Specs keep a control plane coherent.

## What's next

- Portfolio Manager session-cap override as a runtime setting.
- Maintenance banner coordinated with the product frontend.
- Model routing view once a configuration source exists.
- Hosted production portal on its own Amplify app and `admin.tradewizard.live` domain.
- Audit export and retention policy for compliance reviews.

## Kiro usage summary

| Kiro capability | Evidence |
|-----------------|----------|
| Spec-driven development | `admin-portal-foundation` and `admin-portal-operations`, each with requirements, design, and completed tasks |
| Steering | `.kiro/steering/product.md`, `structure.md`, `tech.md`, `kiroween.md` |
| Agent hooks | 5 hooks, including `admin-typecheck`, `analysis-gate-guard`, and `spec-task-followthrough` |
| MCP | `.kiro/settings/mcp.json` with Magic Link and Polymarket documentation |
| Custom agents | Not claimed; steering and specs are the context mechanism |

## Built with

Kiro · TypeScript · Next.js 16 · React 19 · Tailwind CSS 4 · TanStack Query · Amazon Cognito · API Gateway · AWS Lambda · Amazon RDS for PostgreSQL · Amazon DynamoDB · Amazon S3 · Amazon EventBridge · Amazon SNS · Amazon CloudWatch · AWS Secrets Manager · AWS IAM · AWS Amplify Hosting · AWS CDK · Zod · Vitest · Remotion

Platform context: Amazon Bedrock · Strands Agents SDK · Polymarket CLOB and Gamma APIs · viem · Safe · USDC.e on Polygon · Resend · NewsData.io · Serper

## Links

- **Repository**: https://github.com/balojey/tradewizard-kiroween
- **Operations portal**: https://admin.tradewizard.live
- **Platform it operates**: https://tradewizard.live
- **Kiro usage write-up**: https://github.com/balojey/tradewizard-kiroween/blob/main/docs/kiro-usage.md
- **Portal foundation spec**: https://github.com/balojey/tradewizard-kiroween/blob/main/.kiro/specs/admin-portal-foundation/requirements.md
- **Portal operations spec**: https://github.com/balojey/tradewizard-kiroween/blob/main/.kiro/specs/admin-portal-operations/requirements.md

---

**Note**: The Operations Portal is internal and is not linked from the customer product. TradeWizard's market analysis is provided for educational and informational purposes; all trading involves risk.
