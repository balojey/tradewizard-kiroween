# TradeWizard - Kiroween 2026 Submission

> **Category: Frankenstein**
>
> The intelligence layer for real-world prediction markets, stitched together from a fourteen-agent league, three deterministic gates, a serverless AWS nervous system, an on-chain payment rail, and a Next.js trading terminal - built spec-first with Kiro.

---

## Inspiration

Prediction markets are one of the cleanest signal-generation mechanisms ever built. They aggregate dispersed information into a single number - the price - and that number is a probability. In theory, anyone can trade them. In practice, almost nobody can trade them well.

To consistently price an outcome on Polymarket you need to monitor breaking news, read polling internals, watch order books for whale activity, track narrative velocity across media and social platforms, and time entries against catalysts. Those are five different jobs. Most retail traders have none of them, so they trade headlines, lose money, and quit. The asymmetry is not liquidity - it is intelligence.

We also wanted to confront the part most "AI trading" products avoid: what happens after the recommendation. Reading a thesis is one thing. Acting on it under time pressure, with the right size, with mandatory exits, while the market is moving - that is where retail loses. So we built an opt-in autonomous Portfolio Manager that executes inside hard guardrails the user pre-approves, with a kill switch that fails closed. Bounded autonomy, not unbounded delegation.

## What it does

TradeWizard is two products that share one brain.

**The intelligence layer.** A user can request analysis on any Polymarket market. Behind the request is an 11-stage workflow that runs 14 specialized intelligence agents in parallel, fuses their signals deterministically, debates the resulting thesis adversarially, runs a deterministic consensus engine, asks three risk-philosophy agents about sizing, and emits a recommendation with entry zone, target zone, mandatory stop-loss, expected value, win probability, and a full reasoning chain.

If the agents disagree above a hard threshold, or if expected value is non-positive, the system refuses to recommend. It returns `NO_TRADE` and explains which gate rejected the trade. Results are delivered through WebSocket, email, push, and webhook, respecting quiet hours and notification preferences. Every recommendation is scored after it hits take-profit or stop-loss, and every agent has an accuracy leaderboard that feeds back into signal weighting.

**The autonomous Portfolio Manager (Pro and Elite).** A user opts into autonomous execution on a specific market by activating a session with a chosen persona (Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider), a capital envelope, and pre-approved guardrails. The Portfolio Manager Lambda consumes recurring analyses for that market - it never triggers its own - and decides entry, sizing, stop-loss, and take-profit per trade. Orders are placed through the Polymarket CLOB API.

A Position Guard monitors every open position for regime shifts and stale markets. A Risk Engine enforces loss limits, cooldowns, and a kill switch that fails closed. The user can pause, resume, stop, or kill all sessions at any time, and every trade, exit, and risk event fans out across notification channels in real time.

Around these sit the pieces a real product needs: passwordless Cognito Magic Link auth, on-chain USDC.e billing on Polygon with auto-renewal via ERC-20 allowances, a market-level analysis pool that prevents redundant compute, a credit system with an immutable audit trail, an internal management portal, and a Next.js 16 / React 19 frontend that surfaces all of it through a clean trading-terminal UI.

## Why this is a Frankenstein

TradeWizard is a working chimera, not a themed wrapper:

- **Fourteen independent model personalities** run in parallel, each with its own tool kit and its own isolated memory. They are encouraged to disagree.
- **Deterministic TypeScript gates** sit between the models and the user and can overrule every one of them. The consensus engine, signal fusion, expected-value rejection, and schema validation contain no model calls.
- **A serverless AWS substrate** runs the whole thing without a long-lived server: CDK, Lambda, Aurora PostgreSQL Serverless v2, DynamoDB, SQS FIFO, SNS, API Gateway, S3, and EventBridge.
- **An on-chain payment rail** settles subscriptions and credit packs in USDC.e on Polygon, with Safe trading wallets, ERC-20 allowances, and transaction-hash verification.
- **A separate internal admin portal** shares the backend contracts but deploys independently and is never linked from the customer app.
- **A bounded-autonomy executor** lets an agent decide trades while a different service enforces stop-loss, take-profit, loss caps, cooldowns, and a fail-closed kill switch.

The parts should not fit together this cleanly. What holds them together is Kiro: every major seam has a spec, every architectural rule has a steering document, and the workflows that protect the gates are encoded as hooks.

## How we built it with Kiro

### Spec-driven development

The repository contains **32 specs** under [`.kiro/specs/`](../.kiro/specs/) - thirty-one product specs plus the spec for this submission. Most follow the requirements → design → tasks rhythm and cover a real slice of the product, including:

- [`advanced-agent-league`](../.kiro/specs/advanced-agent-league/requirements.md) - the fourteen-agent league and signal contracts
- [`autonomous-portfolio-manager`](../.kiro/specs/autonomous-portfolio-manager/requirements.md) - personas, guardrails, and execution lifecycle
- [`market-intelligence-engine`](../.kiro/specs/market-intelligence-engine/requirements.md) - the 11-stage analysis workflow
- [`phase3-delivery-frontend`](../.kiro/specs/phase3-delivery-frontend/requirements.md) - auth, WebSocket delivery, and results viewer
- [`wallet-subscription-system`](../.kiro/specs/wallet-subscription-system/requirements.md) - on-chain plans, credits, and renewal
- [`admin-api`](../docs/admin-portal-architecture.md) - the internal portal's route contracts and audit model

The specs are not decoration. They define the acceptance criteria, the edge cases, and the task order that the implementation followed. When a model or a contributor is unsure what a stage is allowed to do, the spec is the tiebreaker.

### Steering

Four steering documents under [`.kiro/steering/`](../.kiro/steering/) give the agent the context that does not belong in any single prompt:

- [`product.md`](../.kiro/steering/product.md) - what TradeWizard is, who it serves, and the value proposition
- [`structure.md`](../.kiro/steering/structure.md) - package boundaries, naming, and where new code belongs
- [`tech.md`](../.kiro/steering/tech.md) - the stack, the deterministic stages, and the invariants that must not drift
- [`kiroween.md`](../.kiro/steering/kiroween.md) - the submission constraints: category, license, honest claims, and demo rules

The most useful steering rule was negative: the deterministic stages must never contain model calls. That single invariant prevented several plausible-looking but unsafe changes.

### Hooks

Five hooks under [`.kiro/hooks/`](../.kiro/hooks/) automate the verification work that would otherwise be forgotten:

| Hook | Trigger | What it runs |
|------|---------|--------------|
| `infra-typecheck` | Save under `infra/lib`, `infra/services`, or `infra/scripts` | `npx tsc --noEmit` in `infra/` |
| `frontend-typecheck` | Save a frontend `.ts`/`.tsx` file | `npx tsc --noEmit` in `tradewizard-frontend/` |
| `admin-typecheck` | Save an admin `.ts`/`.tsx` file | `npx tsc --noEmit` in `tradewizard-admin/` |
| `analysis-gate-guard` | Save a gate file (`signal-fusion`, `consensus-engine`, `recommendation`, `shadow-consensus`) | An agent review that checks determinism, live-path isolation, and test coverage |
| `spec-task-followthrough` | A spec task completes | Update the matching `tasks.md`, run the affected tests, and reconcile docs |

The gate guard is the important one. The deterministic stages are the safety story, so a hook that asks the agent to prove they stayed deterministic is worth more than a generic test runner.

### MCP

[`.kiro/settings/mcp.json`](../.kiro/settings/mcp.json) connects Kiro to two active documentation servers:

- **Magic Link docs** - the passwordless auth flow used by Cognito
- **Polymarket docs** - CLOB and Gamma API contracts, so order and market fields are verified against the source instead of recalled

Two more servers (Railway and Ranger) are present but disabled. Keeping the configuration in the repository means the next contributor inherits the same verified context.

### Property-based testing

The deterministic gates are covered by focused Vitest suites for consensus, fusion, calibration, gate profiles, and shadow consensus. `fast-check` is available in `infra/` for property-level tests, but the submitted test strategy is example-based rather than property-based. We are not claiming a PBT practice the repository does not have.

## How it works

### Inputs

Every analysis begins with a market identifier from Polymarket. From that seed the system collects:

1. **Price history** - OHLC-style data from the Polymarket CLOB API, written as a deterministic CSV for agents to query numerically
2. **Market metadata** - resolution criteria, expiry, probability, spread, volume, and liquidity from the Gamma API, plus related sibling markets
3. **Agent memory** - per-agent historical signals from Aurora PostgreSQL; each agent sees only its own history to avoid cross-agent anchoring
4. **Real-time web context** - an autonomous research stage uses NewsData.io and Serper tools to gather breaking news, expert opinion, polling, and social discourse
5. **Agent performance weights** - historical accuracy from the `agent_performance` table, used to scale influence during fusion

For the Portfolio Manager, additional inputs include the active session, persona, capital envelope, current position, order-book depth, the latest analysis, trade history, and session performance.

### The three deterministic gates

**Gate 1 - Signal Fusion (no LLM).** Agent signals are aggregated in log-odds space, anchored to the market price. Each forecast is de-biased against its own fitted calibration line. Brier-calibrated weights set influence. Evidence-scaled pass-through decides how much of the ensemble's edge survives, and a standard-error noise floor plus a conflict map describe how much of the result is signal rather than agreement.

**Gate 2 - Adversarial Debate.** A thesis stage generates competing bull and bear cases from the fused signal. A cross-examination stage runs five tests against each thesis - evidence, causality, timing, liquidity, tail risk - for ten structured tests in total. Each produces survived / weakened / refuted with a numeric score.

**Gate 3 - Consensus Engine (no LLM).** The engine applies the active gate profile: an edge floor derived from the market's spread plus slippage and two standard errors of ensemble noise, thesis confirmation, and a divergence cap. It fails to `NO_TRADE` on disagreement above 30% or confidence below 20%, and persists a machine-readable reason (`consensus_failed`, `divergence_cap`, `edge_below_threshold`, `edge_below_significance`, `thesis_veto`).

The recommendation stage then validates schema and price ordering. If expected value is non-positive, the recommendation is rejected and replaced with `NO_TRADE`. These are not model behaviors we hope for; they are deterministic checks the models cannot override.

### Shadow consensus

Every analysis also computes an agent-driven shadow consensus next to the live one. Both are graded on the same fixed-horizon price move, and the results are stored for comparison. The shadow decision is never shown to users and never influences the live recommendation. It is the evidence we require before changing a gate.

### Bounded autonomy

The Portfolio Manager's decision agent has a read-only tool layer. It cannot place an order. Its output is a structured decision, and the Trade Executor validates that decision against hard limits before touching the CLOB:

- Mandatory stop-loss and take-profit on every position
- Per-session loss limit at 50% of capital; cross-session cap at 40%
- 30-minute cooldown after a loss exit
- Position size capped at 50% of session capital
- Concurrent session limits: 3 for Pro, 10 for Elite
- Capital conservation: no trade can exceed uninvested session capital
- Mutual exclusion between Trade Executor and Position Guard
- Token-ID resolution by outcome string, never by array index
- Kill switch totality: exits all positions, terminates all sessions, and fails closed

## Challenges we ran into

**The autonomy paradox.** "The human is the final decision maker" and "autonomous execution" sound contradictory. The resolution was to separate the agent's decision authority from the executor's enforcement authority, then express the perimeter as machine-checked invariants the user pre-approves.

**LLM determinism is a fantasy; pipeline determinism is achievable.** Early prototypes tried to make the model behave consistently. That never worked at the tail. The fix was to stop asking the model to be deterministic and bracket it with deterministic stages.

**Agreement is not consensus.** When all fourteen agents agree, it often means they read the same headline. The divergence penalty, the 30% disagreement gate, and isolated per-agent memory made disagreement informative.

**Cost runaway under naive deduplication.** Per-user caching is the same as no caching. The market-level analysis pool coalesces requests, and delivery accounting had to be redesigned so users pay only for results they actually receive.

**Token ordering on the CLOB.** Outcome arrays are not stably ordered. A trade executor that indexes YES at `[0]` will eventually place a YES order on a NO token. The resolver matches by outcome string and has a regression test.

**Keeping the docs honest.** The repository's older READMEs contain stale model and file names. The submission uses `.kiro/steering/` and the current code as the source of truth, and the Kiro write-up only claims artifacts a judge can inspect.

## Accomplishments we are proud of

- **A multi-agent system that is allowed to refuse.** When disagreement is high or expected value is non-positive, TradeWizard returns `NO_TRADE` with a structured reason and does not bill the user.
- **Three deterministic gates around fourteen models.** Fusion and consensus are non-LLM stages. Schema validation and EV rejection are non-LLM stages.
- **Bounded-autonomy execution.** A fail-closed kill switch, mandatory exits, hard loss limits, cooldowns, capital conservation, and mutual exclusion between executor and guard.
- **A market-level analysis pool.** Cost scales with markets analyzed, not users requesting.
- **Closed-loop learning.** Every recommendation is scored, every agent has a leaderboard, and memory feeds back into signal weighting.
- **A spec-first build.** Thirty-two specs, four steering documents, five hooks, and two MCP servers keep a large system coherent.
- **A serverless platform that idles at roughly fifteen to twenty dollars a month.** No NAT, no ElastiCache, no always-on compute.

## What we learned

- **Refusing to recommend is a feature.** The most professional thing a trading system can do under high disagreement is decline.
- **Independence beats agreement at the agent layer.** Isolated memory made disagreement signal-bearing.
- **Enforce safety below the model, not inside it.** A prompt that says "always set a stop-loss" will eventually be ignored. An executor that rejects the trade will not.
- **Specs are a safety mechanism, not paperwork.** The determinism invariant survived because it was written down and checked.
- **Explainability is a product feature.** Reasoning chains, debate scores, agent leaderboards, and disagreement indices make the output usable and defensible.

## What's next

- **Model benchmarking.** Systematic quality and cost benchmarking per agent category, with routing updates when a model's price-to-quality ratio shifts.
- **Agent specialization and ablation.** Use the leaderboard's outcome data to retire under-performing agents and split high-performing ones into specialized variants.
- **Verticals beyond politics.** Macro, central-bank decisions, sports, and entertainment inherit the same workflow with domain-specific tools.
- **Portfolio-aware analysis.** Recommendations conditioned on existing exposure, with correlation-aware sizing and cross-market hedges.
- **Institutional surface.** A research-grade API with audit logs, signed reasoning chains, and SLA-backed delivery.
- **Public performance reporting.** Publish recommendation accuracy with methodology.

---

## Kiro usage summary

| Kiro capability | Evidence in this repository |
|-----------------|-----------------------------|
| Spec-driven development | 32 specs in `.kiro/specs/`, each with requirements, design, and tasks |
| Steering | `.kiro/steering/product.md`, `structure.md`, `tech.md`, `kiroween.md` |
| Agent hooks | 5 JSON hooks in `.kiro/hooks/` for typechecks, gate protection, and spec follow-through |
| MCP | `.kiro/settings/mcp.json` with Magic Link and Polymarket documentation servers |
| Custom agents | Not claimed; the repository's steering and specs are the primary context mechanism |

The full judge-facing write-up is in [docs/kiro-usage.md](kiro-usage.md).

## Built with

Kiro · TypeScript · Node.js 20 · AWS CDK · AWS Lambda · Amazon Aurora PostgreSQL Serverless v2 · DynamoDB · SQS · SNS · EventBridge · API Gateway · Cognito · S3 · CloudWatch · Amazon Bedrock (default inference) · Nebius Token Factory (optional inference) · Strands Agents SDK · Next.js 16 · React 19 · Tailwind CSS 4 · TanStack Query · Zod · Vitest · Remotion · Polymarket CLOB & Gamma APIs · viem · Safe · USDC.e on Polygon · Resend · NewsData.io · Serper

## Links

- **Repository**: https://github.com/balojey/tradewizard-kiroween
- **Live app**: _add the deployed URL to the Devpost submission form_
- **Demo video**: _add the public YouTube URL to the Devpost submission form_
- **Kiro usage write-up**: [docs/kiro-usage.md](kiro-usage.md)
- **Product overview**: [docs/tradewizard-overview.md](tradewizard-overview.md)

---

**Disclaimer**: TradeWizard provides AI-generated analysis for educational and informational purposes. All trading involves risk. Past performance does not guarantee future results. Please trade responsibly.
