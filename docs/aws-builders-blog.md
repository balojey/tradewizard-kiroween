#KiroweenHackathon26

# Building an Auditable Control Plane for a Live Trading Platform on AWS

*How I built TradeWizard Warden, the operations portal for a live prediction-market platform: four roles checked against live Cognito groups, an audit chain that names the first broken row, a kill switch that fails closed, and a read-only copilot that cannot act.*

<iframe width="100%" height="420" src="https://www.youtube.com/embed/XHgp7Q_Y1kE" title="TradeWizard Warden Demo" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>

**Demo (2:50): the portal end to end.**

[![Watch the 2:50 demo](https://i.ytimg.com/vi/XHgp7Q_Y1kE/maxresdefault.jpg)](https://youtu.be/XHgp7Q_Y1kE)

> **Kiroween 2026 · Frankenstein category.** The submitted project is TradeWizard Warden. The platform is context; the portal is the new artifact.

A live trading product has a problem that a demo never does: someone has to operate it. Refunds, halted strategies, role changes, paused features, and incident questions all happen while the system holds customer balances and open orders. On a real platform that work ends up in the AWS console: raw SQL for a credit, a Lambda invocation for a queue, a console click for a kill switch, and a spreadsheet for who changed what.

Warden replaces that with one internal product:

- **Portal:** https://warden.tradewizard.live
- **Repository:** https://github.com/balojey/tradewizard-kiroween
- **Kiro usage:** https://github.com/balojey/tradewizard-kiroween/blob/main/docs/kiro-usage.md

It is a separate Next.js 16 application on Amplify, backed by its own API Gateway REST API, Cognito app client, Lambda handlers, and the platform's RDS PostgreSQL, DynamoDB, and S3. It never holds wallet keys, signs transactions, or places orders. It asks the platform to act, and records who asked, why, and what changed.

The interesting engineering is not the dashboard. It is the four properties below.

---

## The boundary is the product

```
Operator browser
  │  Cognito email + password + TOTP
  ▼
tradewizard-admin/  (Next.js 16, Amplify)
  │  ID token (30-day refresh)
  │  presence-only tw_admin_session cookie
  ▼
API Gateway  →  admin-authorizer  (ID token, live groups, MFA gate)
  │
  ▼
admin-api Lambda  (requireRole + requireFreshAuth per route)
  │
  ├─ RDS PostgreSQL   business state, hash-chained audit
  ├─ DynamoDB         kill-switch state, rate limits, claims
  ├─ S3               analysis payloads behind 60s presigned URLs
  └─ Lambda invoke    support, newsletter, metrics rollup
```

The portal reads customer data, so it is the most dangerous place in the product to put a wallet key. It has none. It can stop trading, change a plan, or grant credits; it cannot sign, transfer, or place an order. Control calls cross the boundary; money never does.

---

## Identity: four roles, checked twice, against live groups

Admin accounts are dedicated Cognito identities on a separate app client with email, password, and TOTP. Two details matter more than they look.

**The token is not the source of truth.** An ID token carries `cognito:groups` as a snapshot. If an operator is demoted, that claim stays stale until the token expires. The authorizer therefore ignores the claim for authorization and reads current membership from Cognito on every request:

```ts
const claimedGroups = groupsFromClaim(payload['cognito:groups']);
const groups = await liveGroups(payload.sub);      // deliberately uncached
const role = roleFromGroups(groups);               // highest rank wins
```

A removal or demotion takes effect on the next request, not in thirty days. The denial path emits an `AdminAuthDenied` log marker, which a metric filter turns into a CloudWatch alarm — repeated authorization failures are visible without reading logs.

**The UI is not the boundary.** Four roles are cumulative (analyst 10, support 20, admin 30, owner 40). Every handler re-checks the minimum role, even when the navigation hides the page. Destructive actions additionally require an `auth_time` fresher than ten minutes, so a stolen session cannot trip a kill switch. The last owner cannot be removed, and that check runs inside the transaction.

Access is separated from the customer product in three ways:

- Warden accounts live on `+warden` aliases, and the product refuses any `+tag` address, so an admin identity can never double as a customer account.
- Owners mint **role-carrying invite links**: a bearer token in the URL fragment, stored only as SHA-256, with a lifetime, a use cap, and one-click revoke.
- Roles are groups, not a column, so Cognito and the API cannot disagree.

---

## The audit chain: write the row before the effect

Every mutation opens an audit row with `pending` status *before* the side effect, then completes it as `succeeded` or `failed`. A crash leaves a visible pending row instead of an unrecorded action. That alone is better than most admin tools. It is not proof.

Proof comes from two hashes. Each row commits to the previous row's hash, and terminal rows also carry a `completion_hash` over the terminal state:

```ts
export function computeRowHash(row: AuditChainRow): string {
  return sha256Hex(canonicalJson({
    id: row.id,
    actorSub: row.actorSub,
    actorRole: row.actorRole,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    before: row.before,
    createdAt: row.createdAt,
    prevHash: row.prevHash,
    hashVersion: row.hashVersion,
  }));
}
```

The canonical JSON sorts keys and turns `undefined` into `null`, so the hashed shape is always the stored shape. Without that, a serialization change quietly breaks every historical hash.

Why a second hash? `row_hash` is fixed at write time, so the completion fields are not covered by it. `completion_hash` commits to `status`, `after`, `error`, and `completed_at`, which means flipping a `failed` row to `succeeded` after the fact is detectable.

Three more decisions make the chain hold under concurrency and time:

1. **Serialized writes.** Insert takes a transaction-scoped advisory lock around "read head, compute hash, insert", so two Lambdas cannot fork the chain. A unique index on `row_hash` is the backstop.
2. **Append-only at the database layer.** A trigger rejects `DELETE` and rejects any `UPDATE` except the one transition from `pending` to terminal.
3. **Verification returns a finding, not a 500.** `GET /admin/audit/verify` walks a bounded window, recomputes, and names the first broken row with a reason: `missing_row_hash`, `row_hash_mismatch`, `prev_hash_mismatch`, `chain_start_mismatch`, `unexpected_completion`, `missing_completion`, or `completion_hash_mismatch`.

Rows written before the chain existed are sealed by an idempotent backfill, oldest first. `--force` recomputes the whole chain, which re-seals tampered rows — a scratch-database tool, never an evidence-preserving one.

The difference between "the portal logged it" and "the portal can prove the record is intact" is the whole point of this table.

---

## The kill switch: fail closed, then fail safe

The kill switch is per user and two phase, because the two halves have different failure modes. Persisting the halt is fast and must be synchronous; cancelling orders and exiting positions needs CLOB credentials and can take a minute, so it is dispatched asynchronously.

```ts
// Phase 1: halt. Throws if the state cannot be persisted.
const state = await activateUser(input.userId, {
  reason: input.reason,
  actor: `admin:${identity.sub}`,
});

// Phase 2: exit. Best effort by design.
const dispatch = await dispatchHalt(input.userId, input.reason);
```

The response says `halted: true` and reports whether the exit dispatch was sent. If the dispatch fails, the halt still stands and the operator is told the exit failed, because the safe direction is stopping, not retrying blindly. Readers fail closed too: if DynamoDB cannot be read, trading paths treat the switch as active.

State lives in the existing rate-limit table (`kill_switch#{userId}` / `state`) instead of a new table, so a halt survives a deploy without another IAM surface.

---

## Settings that name their consumer

A runtime switch is only control if something reads it. Every setting declares its type, default, and the service that consumes it:

```ts
analysis_paused: {
  key: 'analysis_paused',
  type: 'boolean',
  defaultValue: false,
  description: 'Stop accepting new analysis requests. Existing schedules keep running.',
  consumer: 'analysis-request',
}
```

The portal shows that consumer next to the toggle, so an operator sees the blast radius before changing it. Reads are cached for 60 seconds per container; a missing row or a database error falls back to the declared default, so a settings outage cannot change behaviour. Writes are owner-only, fresh-auth, and reason-required.

A switch that stores a value nobody reads is worse than no switch, because it looks like control.

---

## The copilot: read-only by construction

Ask Warden answers operational questions - "What changed in the last hour?", "Summarize this ticket", "Why did this analysis return NO_TRADE?" - and it is designed so the read-only promise does not depend on prompt wording.

- **Retrieval is deterministic and parameterised**, not natural-language-to-SQL. The model never chooses a query.
- **One model call, no tools.** A Strands agent is created without tools, through the platform's existing AI provider switch, with a 20-second timeout and a 1,200-token cap. There is no tool loop to escape.
- **Records are wrapped as untrusted data.** Instructions inside a ticket body or an audit reason are data, not commands.
- **Citations are validated against the records actually sent.** An invented citation is dropped and confidence is lowered.
- **There is no mutation route.** Every suggested action is a link to an existing human control; there is no `execute` variant to call.
- **Its own controls:** a `copilot_enabled` runtime kill switch and a per-operator daily cap. Usage is a CloudWatch line with latency, tokens, cost, and citation count - never the question text or record content.

The interesting part is not that an LLM can summarize a ticket. It is that the answer can be checked, and that a compromised prompt cannot make the copilot do anything.

---

## The PWA is a security decision

A normal service worker caches navigations and API responses, which is a performance win on a personal laptop and a data leak on a shared machine. This worker caches only content-hashed static assets. Navigations, API responses, React Server Component payloads, and presigned S3 URLs are never cached, and an offline navigation gets a notice instead of a stale shell.

Presigned payload URLs are also deliberately short: 60 seconds, never logged, never stored in an audit row.

---

## Operational shape

- **Amplify Hosting** serves the portal on its own domain, separate from the customer app.
- **API Gateway + one Lambda** handle the admin API; the authorizer is a second function, so a bad token never reaches business logic.
- **RDS PostgreSQL** is shared with the platform; the portal adds tables, not a database. Access is TLS-only.
- **DynamoDB** holds kill-switch state, rate limits, and claims in the table the platform already had.
- **EventBridge Scheduler** runs support housekeeping and an hourly metrics rollup, so the dashboard never aggregates over the OLTP tables.
- **SNS + CloudWatch** alarm on authorizer denials, API 5xx, and rollup failures.

The admin functions run outside a VPC and reach RDS over its TLS-only public endpoint, so the stack needs no NAT Gateway.

---

## How Kiro built it

The portal was specified and built with Kiro:

- **Four specs**, each with requirements, design, and an ordered task list: `admin-portal-foundation` (package boundary, auth, RBAC, audit spine), `admin-portal-operations` (mutation envelope, kill switch, session controls, settings), `audit-chain-integrity` (canonical hashes, backfill, bounded verification), and `admin-copilot` (read-only retrieval, citations, no mutation path).
- **Four steering documents** (`product`, `structure`, `tech`, `kiroween`) load into every session, so a portal change knows the platform invariants it must not break.
- **Five hooks**: three typecheck a package on save, `analysis-gate-guard` reviews edits to the deterministic gates for model calls and shadow-data leakage, and `spec-task-followthrough` closes a completed task and runs only the affected tests.
- **Two MCP documentation servers** (Magic Link, Polymarket) verify API shapes against the source.
- **Property-based tests** with `fast-check` cover the authorization surface: role ranking, group-to-role resolution, order independence, every role pair, the fresh-auth window, and bearer extraction - 10 properties at 100-300 generated cases each.

Specs: https://github.com/balojey/tradewizard-kiroween/tree/main/.kiro/specs
Hooks: https://github.com/balojey/tradewizard-kiroween/tree/main/.kiro/hooks
Steering: https://github.com/balojey/tradewizard-kiroween/tree/main/.kiro/steering

---

## What I would do differently

**Write the audit row before the action, always.** An append-after-success model loses the record exactly when it matters: when the process dies mid-mutation.

**Treat re-sealing as a destructive operation.** The backfill can rebuild a chain, which is useful on a scratch database and catastrophic on one whose integrity is the evidence.

**Do not add a setting without its consumer in the same change.** Half the design review was deciding which service reads each switch.

**Fresh auth is not friction to remove.** Ten minutes is the difference between a stolen session and a halted trading account.

**A hidden button is not a permission check.** The UI can hide; only the authorizer and the handler can deny.

---

## Try it

- **Portal:** https://warden.tradewizard.live
- **Repository:** https://github.com/balojey/tradewizard-kiroween
- **Demo video:** https://youtu.be/XHgp7Q_Y1kE
- **Platform the portal operates:** https://tradewizard.live

*Built with Next.js 16, TypeScript, Amazon Cognito, API Gateway, AWS Lambda, Amazon RDS for PostgreSQL, Amazon DynamoDB, Amazon S3, EventBridge, SNS, CloudWatch, Amplify Hosting, AWS CDK, and Kiro.*
