# How TradeWizard Was Built With Kiro

This is the judge-facing write-up for the Kiroween 2026 submission. It describes only what is present in the repository. There are no claims about Kiro surfaces or techniques that a judge cannot verify by opening a file.

- **Category:** Frankenstein
- **Project:** TradeWizard - multi-agent intelligence for prediction markets
- **Repository:** https://github.com/balojey/tradewizard-kiroween

---

## 1. Which Kiro surface we used

The repository's Kiro artifacts are the **Kiro IDE / agent** format:

| Artifact | Location | Format |
|----------|----------|--------|
| Specs | `.kiro/specs/**` | `requirements.md`, `design.md`, `tasks.md`, optional `.config.kiro` |
| Steering | `.kiro/steering/*.md` | Markdown context documents |
| Hooks | `.kiro/hooks/*.json` | `version: v1` structured hook schema, shared by the IDE and CLI V3 |
| MCP | `.kiro/settings/mcp.json` | Standard MCP server configuration |

We are not claiming Kiro Crew, Kiro Web, Kiro powers, or custom agent profiles. Those surfaces are not represented in the repository, and a submission should not invent a workflow it cannot show. The depth here is in specs, steering, hooks, and MCP.

## 2. The build loop

Every non-trivial change followed the same loop:

```
Idea
  ↓
Steering check        # does this fit the product, structure, and tech rules?
  ↓
Spec                  # requirements.md → design.md → tasks.md
  ↓
Task execution        # one task at a time, smallest verifiable slice
  ↓
Hook verification     # typecheck on save; agent review for gate files
  ↓
Task close-out        # checkbox, targeted tests, doc reconciliation
```

The important part is not that the loop existed. It is that the loop left artifacts. A new contributor can read the spec for a feature, see the design decision, and see which tasks were completed. When a change crosses a package boundary, `.kiro/steering/structure.md` says where it belongs before code is written.

## 3. Spec-driven development

There are **34 specs** under [`.kiro/specs/`](../.kiro/specs/), each with a design document and an ordered task list. Thirty-three are product specs; the thirty-fourth specifies this Kiroween submission. Most follow the requirements → design → tasks rhythm; one legacy fix spec uses a `bugfix.md` document instead of a requirements file.

### Representative specs

| Spec | Why it matters |
|------|----------------|
| [`advanced-agent-league`](../.kiro/specs/advanced-agent-league/requirements.md) | Defines the fourteen specialists, their signal contract, and the fusion inputs |
| [`market-intelligence-engine`](../.kiro/specs/market-intelligence-engine/requirements.md) | Defines the 11-stage workflow and the deterministic stages |
| [`autonomous-portfolio-manager`](../.kiro/specs/autonomous-portfolio-manager/requirements.md) | Defines personas, session lifecycle, guardrails, and the kill switch |
| [`phase3-delivery-frontend`](../.kiro/specs/phase3-delivery-frontend/requirements.md) | Defines auth, WebSocket delivery, results history, and subscription UI |
| [`wallet-subscription-system`](../.kiro/specs/wallet-subscription-system/requirements.md) | Defines on-chain plans, credits, allowances, and renewal |
| [`lambda-strands-migration`](../.kiro/specs/lambda-strands-migration/requirements.md) | Defines the move to self-hosted Strands agents on Lambda |
| [`agent-memory-system`](../.kiro/specs/agent-memory-system/requirements.md) | Defines per-agent isolated memory and why cross-agent history is excluded |
| [`admin-portal-foundation`](../.kiro/specs/admin-portal-foundation/requirements.md) | Defines the isolated portal, auth/MFA, RBAC, audit spine, admin API, read surfaces, and UI shell |
| [`admin-portal-operations`](../.kiro/specs/admin-portal-operations/requirements.md) | Defines the mutation envelope, kill switch, session controls, membership, runtime settings, support, and newsletter |

The two admin portal specs are deliberately split. The foundation spec covers why the portal is a separate package and how identity, authorization, audit, and every read surface work. The operations spec covers every write the portal is allowed to make and the invariants that make each one reviewable. Together they trace the portal from package boundary to the kill switch.

### What a spec looks like in practice

`advanced-agent-league` is a useful example because the product's core behavior depends on it:

1. **Requirements** describe the agent league in user-story form, with acceptance criteria for signal shape, failure handling, and fusion inputs.
2. **Design** describes the agent registry, the tools each category receives, the signal schema, and the failure path.
3. **Tasks** break the work into ordered slices that can be verified independently.

That structure is why the fourteen agents have a consistent contract. Each agent can fail, return a fallback signal, or be excluded without the downstream stages guessing what happened.

### Why specs beat vibe coding here

The system has hard invariants that are easy to violate with a plausible-looking change:

- Signal fusion and consensus must not call a model.
- The shadow consensus must not influence the live recommendation.
- A `NO_TRADE` must persist a machine-readable reason.
- The executor must reject any trade without a stop-loss and take-profit.
- Cross-service identity must use the internal user UUID, not the Cognito subject.

A free-form prompt can produce code that violates any of these while looking correct. A spec with acceptance criteria, plus steering that repeats the invariant, gives the agent a place to check itself. The specs are also how a human reviewer catches drift.

## 4. Steering

Four documents under [`.kiro/steering/`](../.kiro/steering/) are included in the agent's context:

| File | What it encodes |
|------|-----------------|
| [`product.md`](../.kiro/steering/product.md) | The product model: intelligence layer, Portfolio Manager, subscription credits, and the target user |
| [`structure.md`](../.kiro/steering/structure.md) | Package boundaries, file ownership, naming, and where new code belongs |
| [`tech.md`](../.kiro/steering/tech.md) | Stack, provider abstraction, deterministic stages, and the invariants that must not drift |
| [`kiroween.md`](../.kiro/steering/kiroween.md) | Submission rules: category, license, honest claims, demo constraints, and writing rules |

The steering documents are short on purpose. A long steering file gets skimmed; a short one gets applied. The highest-leverage lines were the negative rules:

- "The deterministic stages are non-LLM. Keep them that way."
- "The shadow decision never influences the live recommendation."
- "Do not describe planned features in the present tense."
- "Do not claim Kiro surfaces or techniques that lack repository evidence."

The last two exist specifically for this submission. They are the reason this write-up does not mention Crew, powers, or property-based testing as if they were part of the build.

## 5. Agent hooks

Five hooks under [`.kiro/hooks/`](../.kiro/hooks/) automate verification. They use the structured `version: v1` schema, so the same files work across the IDE and CLI V3.

| Hook file | Trigger | Matcher | Action |
|-----------|---------|---------|--------|
| [`infra-typecheck.json`](../.kiro/hooks/infra-typecheck.json) | `PostFileSave` | `infra/(lib\|services\|scripts)/.*\.ts$` | `cd infra && npx tsc --noEmit` |
| [`frontend-typecheck.json`](../.kiro/hooks/frontend-typecheck.json) | `PostFileSave` | `tradewizard-frontend/.*\.(ts\|tsx)$` | `cd tradewizard-frontend && npx tsc --noEmit` |
| [`admin-typecheck.json`](../.kiro/hooks/admin-typecheck.json) | `PostFileSave` | `tradewizard-admin/.*\.(ts\|tsx)$` | `cd tradewizard-admin && npx tsc --noEmit` |
| [`analysis-gate-guard.json`](../.kiro/hooks/analysis-gate-guard.json) | `PostFileSave` | Gate files: `signal-fusion`, `consensus-engine`, `recommendation`, `shadow-consensus` | Agent review of determinism, live-path isolation, and test coverage |
| [`spec-task-followthrough.json`](../.kiro/hooks/spec-task-followthrough.json) | `PostTaskExec` | — | Agent closes the `tasks.md` checkbox, runs affected tests, and reconciles docs |

### Why these hooks

The typecheck hooks exist because all three packages are TypeScript and two of them have no test runner. A save-triggered typecheck catches the most common regression before a deploy.

The gate guard exists because the deterministic stages are the safety story. A normal lint rule cannot tell you whether a model call appeared in `consensus-engine.ts`, whether shadow data leaked into the live path, or whether a new `NO_TRADE` reason was left untested. An agent review with an explicit checklist can.

The spec follow-through hook closes the loop that specs otherwise lose. A task can be implemented while its checkbox, tests, and docs are left behind. The hook makes the close-out part of task execution rather than a separate chore.

### What the hook schema looks like

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "Typecheck infra after TypeScript edits",
      "trigger": "PostFileSave",
      "matcher": "infra/(lib|services|scripts)/.*\\.ts$",
      "action": {
        "type": "command",
        "command": "cd infra && npx tsc --noEmit"
      }
    }
  ]
}
```

Command hooks run in the project root. File-related triggers expose `{{filePath}}`, and agent hooks inject a prompt into the active session.

## 6. MCP

[`.kiro/settings/mcp.json`](../.kiro/settings/mcp.json) configures MCP servers:

| Server | Status | Why it is there |
|--------|--------|-----------------|
| `magic-link-docs` | Enabled | Passwordless auth is implemented with Magic Link and Cognito; the docs server verifies flow details |
| `polymarket-docs` | Enabled | CLOB and Gamma API fields, order types, and market metadata are verified against the API docs instead of recalled |
| `Railway` | Disabled | Unused deployment experiment |
| `ranger-docs` | Disabled | Unused integration research |

The Polymarket server is the one that changed the build. Order and market shapes are easy to remember approximately and easy to get wrong exactly - especially outcome ordering, which is why token IDs are resolved by outcome string rather than array index. Having the docs in the agent's context turned a class of guesses into citations.

## 7. Testing and verification

The repository uses **Vitest** in `infra/`. The deterministic stages have focused suites:

- `stages/signal-fusion.test.ts`
- `stages/consensus-engine.test.ts`
- `stages/gate-profile.test.ts`
- `stages/recommendation.test.ts`
- `lib/calibration.test.ts`
- `lib/shadow-consensus.test.ts`
- `lib/multi-model.test.ts`
- `services/shared/ai-provider.test.ts`
- `services/shared/kill-switch.test.ts`
- `services/shared/admin-auth.test.ts`
- `services/analysis-lambda/stages/data-preparation.test.ts`
- `services/analysis-lambda/stages/historical-context.test.ts`
- `services/admin-api/handler.test.ts`

`fast-check` is declared in `infra/package.json`, but the submitted test strategy is example-based. Property-based testing is a plausible next step for the fusion and gate math; it is not claimed here.

The verification commands are:

```bash
cd infra
npm run build      # tsc
npm test           # vitest --run
npm run synth:dev  # cdk synth -c env=development
```

## 8. What Kiro changed about the process

Three differences were large enough to name:

1. **Specs made large changes reviewable.** A fourteen-agent pipeline is too large to hold in one prompt. The spec let the work be split into stages with acceptance criteria, and the design document captured the decisions that would otherwise live in a chat log.

2. **Steering made invariants durable.** The rule that deterministic stages contain no model calls survived multiple refactors because it was written in `tech.md` and repeated in the gate hook. Without that, a well-meaning "let the model explain the decision" change would have quietly moved the safety boundary.

3. **Hooks made verification automatic.** Typecheck-on-save is not glamorous, but it removed the most common class of broken commit. The gate-review hook is the more interesting one: it turns a written invariant into a check that runs at the moment the invariant is most likely to be violated.

## 9. What we did not use

For completeness, and because the submission rules reward honesty:

- **Kiro Crew:** not used; no Crew artifacts in the repository.
- **Kiro CLI / Web:** no evidence in the repository; the artifacts are IDE-format.
- **Kiro powers:** not used; no power configuration is checked in.
- **Custom agent profiles:** not used; the default agent plus steering and specs is the context mechanism.
- **Property-based testing:** not part of the submitted test strategy; `fast-check` is available but the suites are example-based.

## 10. Evidence map

| Claim | Where to verify |
|-------|-----------------|
| 34 specs | `find .kiro/specs -mindepth 1 -maxdepth 1 -type d \| wc -l` |
| Spec format | `.kiro/specs/*/requirements.md`, `design.md`, `tasks.md` |
| Steering | `.kiro/steering/product.md`, `structure.md`, `tech.md`, `kiroween.md` |
| Hooks | `.kiro/hooks/*.json` |
| Admin portal specs | `.kiro/specs/admin-portal-foundation/`, `.kiro/specs/admin-portal-operations/` |
| MCP | `.kiro/settings/mcp.json` |
| Deterministic gates | `infra/services/analysis-lambda/stages/signal-fusion.ts`, `consensus-engine.ts`, `recommendation.ts`, `infra/services/analysis-lambda/lib/shadow-consensus.ts` |
| 14 agents | `infra/services/analysis-lambda/stages/intelligence-agents.ts` (`ALL_AGENT_NAMES`) |
| Portfolio guardrails | `infra/services/portfolio-trade-executor/`, `portfolio-risk-engine/`, `portfolio-position-guard/` |
| Tests | `infra/**/*.test.ts` |
| License | `LICENSE` |
| Submission narrative | `README.md`, `docs/kiroween-submission.md` |

## 11. Reproducing the verification

```bash
# Clone
git clone https://github.com/balojey/tradewizard-kiroween.git
cd tradewizard-kiroween

# Inspect Kiro artifacts
find .kiro -maxdepth 3 -type f | sort

# Validate hook JSON
for f in .kiro/hooks/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))"; done

# Backend verification (requires npm install)
cd infra
npm install
npm run build
npm test
```

The app itself is deployed on AWS; the Devpost submission form carries the live URL and test credentials.
