# How TradeWizard Warden Was Built With Kiro

This is the judge-facing write-up for the Kiroween 2026 submission. It describes only what is present in the repository. There are no claims about Kiro surfaces or techniques that a judge cannot verify by opening a file.

- **Project:** TradeWizard Warden
- **Category:** Frankenstein
- **Repository:** https://github.com/balojey/tradewizard-kiroween
- **Live portal:** https://admin.tradewizard.live

The platform the portal operates is context. The new artifact in this submission is the portal.

---

## 1. Which Kiro surface we used

The repository's Kiro artifacts are the **Kiro IDE / agent** format:

| Artifact | Location | Format |
|----------|----------|--------|
| Specs | `.kiro/specs/**` | `requirements.md`, `design.md`, `tasks.md`, optional `.config.kiro` |
| Steering | `.kiro/steering/*.md` | Markdown context documents |
| Hooks | `.kiro/hooks/*.json` | `version: v1` structured hook schema, shared by the IDE and CLI V3 |
| MCP | `.kiro/settings/mcp.json` | Standard MCP server configuration |

We are not claiming Kiro Crew, Kiro Web, Kiro powers, or custom agent profiles. Those surfaces are not represented in the repository. The depth here is in specs, steering, hooks, and MCP.

## 2. The build loop

Every non-trivial portal change followed the same loop:

```
Idea
  ↓
Steering check        # does this fit the portal boundary and the platform invariants?
  ↓
Spec                  # requirements.md → design.md → tasks.md
  ↓
Task execution        # one slice at a time, smallest verifiable change
  ↓
Hook verification     # admin typecheck on save; gate review when the pipeline is touched
  ↓
Task close-out        # checkbox, targeted tests, doc reconciliation
```

The loop left artifacts. A new contributor can read the foundation spec, see why the portal is a separate app, read the operations spec, see the mutation envelope and kill-switch state machine, and see which tasks were completed.

## 3. The four specs behind the portal

### `admin-portal-foundation`

[`.kiro/specs/admin-portal-foundation/`](../.kiro/specs/admin-portal-foundation/requirements.md) defines:

- Why the portal is a separate Next.js package and a separate Amplify app
- Cognito email + password + TOTP, dedicated admin identities, MFA bootstrap
- Four roles and the authorizer/handler enforcement contract
- The hash-chained audit spine and idempotency
- The admin API, validation, pagination, and read-path limits
- Read surfaces: overview, users, analyses, portfolio, billing, agents, ops, markets, audit
- The UI shell, design primitives, and PWA cache policy
- The security checklist and verification rules

### `admin-portal-operations`

[`.kiro/specs/admin-portal-operations/`](../.kiro/specs/admin-portal-operations/requirements.md) defines:

- The common mutation envelope: role, fresh auth, reason, audit, idempotency
- The per-user kill switch: synchronous halt, asynchronous exit, fail-closed reporting
- Session pause/resume/terminate and the executor boundaries
- Credits, plan overrides, status, and support notes
- Member invites, role changes, immediate revocation, last-owner protection
- Runtime settings, each with a named consumer and default fallback
- Analysis cache invalidation, refunds, and atomic requeue
- The support inbox and newsletter operations
- The tests and live-verification rules

### `audit-chain-integrity`

[`.kiro/specs/audit-chain-integrity/`](../.kiro/specs/audit-chain-integrity/requirements.md) defines:

- The canonical row hash over immutable fields and the separate completion hash
- `hash_version` and the rule that a new hashed field requires a version bump
- The advisory-lock write path that prevents a chain fork
- The idempotent backfill for rows written before the chain existed
- The bounded verification endpoint and its first-broken-row reasons
- The audit UI's **Chain verified** / **Chain broken** / **Not verified** states
- The tamper drill and the rule that `--force` is a scratch-database tool

### `admin-copilot`

[`.kiro/specs/admin-copilot/`](../.kiro/specs/admin-copilot/requirements.md) defines:

- The hard boundary: no mutation route, no tool loop, no `execute` suggestion
- Deterministic, parameterised retrieval from audit, support, analyses, sessions, settings, metrics, impact, and runbook
- Citation validation against the records actually sent
- Role scoping through the existing `AdminRole` model
- One model call, bounded context, timeout, token cap, and cost metric
- The `copilot_enabled` kill switch and `copilot_daily_limit`
- Tests for prompt injection, role leakage, invented citations, and the no-execution invariant

### What a spec looks like in practice

The foundation spec is a useful example because the portal's safety depends on it:

1. **Requirements** describe the package boundary, auth, RBAC, audit, API, read surfaces, and UI as user stories with acceptance criteria.
2. **Design** describes the request flow, role matrix, audit schema, read-path rules, and the threat model.
3. **Tasks** break the work into ordered slices that can be verified independently.

That structure is why the portal has one identity contract, one audit shape, and one authorization rule instead of four slightly different ones.

## 4. Why specs beat vibe coding here

The portal has hard invariants that are easy to violate with a plausible-looking change:

- Every mutation writes an audit row before the side effect.
- Every handler re-checks the role; the UI is never the boundary.
- Destructive actions require fresh auth and a reason.
- The kill switch writes the halt before dispatching the exit.
- A runtime setting must have a consumer in the same change.
- The last owner cannot be removed.
- The PWA never caches navigations, API data, or presigned URLs.
- A portal change must not weaken the deterministic analysis gates.

A free-form prompt can produce code that violates any of these while looking correct. A spec with acceptance criteria, plus steering that repeats the invariant, gives the agent a place to check itself.

## 5. Steering

Four documents under [`.kiro/steering/`](../.kiro/steering/) are included in the agent's context:

| File | What it encodes |
|------|-----------------|
| [`product.md`](../.kiro/steering/product.md) | The platform the portal operates, and the support/newsletter surfaces |
| [`structure.md`](../.kiro/steering/structure.md) | Package boundaries; portal code stays in `tradewizard-admin/` and `admin-api` |
| [`tech.md`](../.kiro/steering/tech.md) | Shared modules and the deterministic analysis invariants the portal must not bypass |
| [`kiroween.md`](../.kiro/steering/kiroween.md) | Submission category, license, honest claims, and demo rules |

The highest-leverage lines were negative:

- "Deterministic analysis stages must never contain model calls."
- "The portal asks the backend to act; it never acts on-chain."
- "Do not claim Kiro surfaces or techniques that lack repository evidence."
- "Do not describe planned features in the present tense."

The last two exist specifically for this submission. They are why this write-up does not mention Crew or powers as if they were part of the build.

## 6. Agent hooks

Five hooks under [`.kiro/hooks/`](../.kiro/hooks/) automate verification. They use the structured `version: v1` schema, so the same files work across the IDE and CLI V3.

| Hook file | Trigger | Matcher | Action |
|-----------|---------|---------|--------|
| [`admin-typecheck.json`](../.kiro/hooks/admin-typecheck.json) | `PostFileSave` | `tradewizard-admin/.*\.(ts\|tsx)$` | `cd tradewizard-admin && npx tsc --noEmit` |
| [`infra-typecheck.json`](../.kiro/hooks/infra-typecheck.json) | `PostFileSave` | `infra/(lib\|services\|scripts)/.*\.ts$` | `cd infra && npx tsc --noEmit` |
| [`frontend-typecheck.json`](../.kiro/hooks/frontend-typecheck.json) | `PostFileSave` | `tradewizard-frontend/.*\.(ts\|tsx)$` | `cd tradewizard-frontend && npx tsc --noEmit` |
| [`analysis-gate-guard.json`](../.kiro/hooks/analysis-gate-guard.json) | `PostFileSave` | Gate files | Agent review of determinism, live-path isolation, and tests |
| [`spec-task-followthrough.json`](../.kiro/hooks/spec-task-followthrough.json) | `PostTaskExec` | — | Close `tasks.md`, run affected tests, reconcile docs |

The admin typecheck is the daily guardrail. The gate guard matters when a portal change reaches into the analysis pipeline.

## 7. MCP

[`.kiro/settings/mcp.json`](../.kiro/settings/mcp.json) configures MCP servers:

| Server | Status | Why it is there |
|--------|--------|-----------------|
| `magic-link-docs` | Enabled | Passwordless auth is implemented with Magic Link and Cognito; the docs server verifies flow details |
| `polymarket-docs` | Enabled | CLOB and Gamma API fields are verified against the docs instead of recalled |
| `Railway` | Disabled | Unused deployment experiment |
| `ranger-docs` | Disabled | Unused integration research |

The Polymarket server matters because outcome ordering is a safety issue. The portal and the platform resolve YES/NO by outcome label, never by array index.

## 8. Testing and verification

The portal and its backend use **Vitest**:

- `services/admin-api/handler.test.ts` covers auth, roles, validation, audit, pagination, and mutations.
- `services/shared/admin-auth.test.ts` covers token parsing, role ranking, MFA, and fresh-auth failures.
- `services/shared/admin-auth.property.test.ts` uses `fast-check` for the invariants: role ranking, group-to-role resolution, order independence, `requireRole` across every role pair, the fresh-auth window, and bearer-token extraction. Each property runs 100-300 generated cases.
- `services/shared/audit-chain.test.ts`, `services/admin-api/lib/audit-chain.test.ts`, and `services/admin-api/lib/audit.integration.test.ts` cover canonical hashing, completion hashes, concurrent inserts, backfill idempotency, and first-broken-row verification.
- `services/admin-api/routes/copilot.test.ts` and `services/admin-copilot/lib/*.test.ts` cover role scoping, citation validation, prompt construction, redaction, context building, and the no-execution boundary.
- Focused tests cover kill-switch state, session controls, settings fallback/cache, support claim/reply concurrency, newsletter idempotency, and webhook signatures.
- `npx tsc --noEmit` in `tradewizard-admin/` is the UI safety net; `admin-typecheck` runs it on save.

```bash
cd infra
npm run build
npm test
npm run synth:dev
```

## 9. What Kiro changed about the process

1. **Specs made the portal reviewable.** A control plane has too many cross-cutting rules for one prompt. Foundation, operations, audit chain, and copilot split the work into safety boundaries with acceptance criteria.
2. **Steering made invariants durable.** "Audit before the side effect" and "the portal never holds wallet keys" survived multiple slices because they were written down.
3. **Hooks made verification automatic.** The admin typecheck removed the most common broken-commit class; the gate guard turned a written invariant into a check at the moment it is most likely to be violated.

## 10. What we did not use

- **Kiro Crew:** not used; no Crew artifacts in the repository.
- **Kiro CLI / Web:** no evidence in the repository; the artifacts are IDE-format.
- **Kiro powers:** not used; no power configuration is checked in.
- **Custom agent profiles:** not used; the default agent plus steering and specs is the context mechanism.

## 11. Evidence map

| Claim | Where to verify |
|-------|-----------------|
| Portal foundation spec | `.kiro/specs/admin-portal-foundation/` |
| Portal operations spec | `.kiro/specs/admin-portal-operations/` |
| Steering | `.kiro/steering/product.md`, `structure.md`, `tech.md`, `kiroween.md` |
| Hooks | `.kiro/hooks/*.json` |
| MCP | `.kiro/settings/mcp.json` |
| Four-role RBAC | `infra/services/shared/admin-auth.ts`, `tradewizard-admin/constants/roles.ts` |
| Hash-chained audit | `infra/services/admin-api/lib/audit.ts`, `infra/services/shared/audit-chain.ts`, `infra/sql/001-schema.sql` |
| Kill switch | `infra/services/admin-api/routes/kill-switch.ts`, `tradewizard-admin/components/users/KillSwitchControl.tsx` |
| Runtime settings | `infra/services/shared/settings.ts`, `tradewizard-admin/app/(app)/settings/page.tsx` |
| Support inbox | `infra/services/admin-api/routes/support.ts`, `tradewizard-admin/components/support/` |
| Newsletter | `infra/services/admin-api/routes/newsletter.ts`, `tradewizard-admin/components/newsletter/` |
| PWA cache policy | `tradewizard-admin/public/sw.js`, `tradewizard-admin/components/pwa/ServiceWorkerRegistrar.tsx` |
| Audit chain spec | `.kiro/specs/audit-chain-integrity/` |
| Audit chain code | `infra/services/shared/audit-chain.ts`, `infra/services/admin-api/lib/audit-chain.ts`, `infra/scripts/backfill-audit-chain.ts` |
| Admin copilot spec | `.kiro/specs/admin-copilot/` |
| Admin copilot code | `infra/services/admin-copilot/`, `infra/services/admin-api/routes/copilot.ts`, `tradewizard-admin/components/copilot/` |
| Testing | `infra/services/shared/admin-auth.property.test.ts` (fast-check), the audit-chain suites, the copilot suites, and the focused Vitest suites |
| License | `LICENSE` |

## 12. Reproducing the verification

```bash
git clone https://github.com/balojey/tradewizard-kiroween.git
cd tradewizard-kiroween

find .kiro -maxdepth 3 -type f | sort
for f in .kiro/hooks/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))"; done

cd infra
npm install
npm run build
npm test
```

The portal is live at https://admin.tradewizard.live; the Devpost form carries the demo credentials.
