# TradeWizard - Full Kiroween 2026 Submission

> **Category: Frankenstein**
>
> Multi-agent intelligence for real-world prediction markets. Fourteen specialists, three deterministic gates, a bounded-autonomy Portfolio Manager, and a spec-first build with Kiro.

This is the long-form submission narrative. The shorter Devpost copy is in [kiroween-submission.md](kiroween-submission.md); the judge-facing Kiro write-up is in [kiro-usage.md](kiro-usage.md).

---

## The problem

Prediction markets aggregate dispersed information into a single number - the price - and that number is a probability. They are one of the cleanest forecasting mechanisms ever built. But they offer markets without intelligence.

To price an outcome on Polymarket consistently, a person has to monitor breaking news, read polling internals, watch order books for liquidity and whale activity, track narrative velocity across media and social platforms, and time entries against catalysts. Those are five distinct analytical disciplines. Most retail traders have none of them, so they trade on headlines, lose money, and leave.

Bloomberg-grade analysis exists for equities. Nothing comparable existed for political, legal, economic, and geopolitical outcomes. TradeWizard is built to fill that gap - not as a content feed or a signal group, but as a decision system that produces explainable, probability-disciplined recommendations and tracks its own accuracy over time.

There is a second gap that most "AI trading" products avoid: what happens after the recommendation. Reading a thesis is one thing. Acting on it under time pressure, with the right size, with mandatory exits, while the market is moving - that is where retail loses. TradeWizard addresses that with an opt-in autonomous Portfolio Manager that executes inside hard guardrails the user pre-approves, with a kill switch that fails closed.

## What it does

TradeWizard is two products that share one intelligence core.

### The intelligence layer

A user requests analysis on any Polymarket market. Behind the request runs an 11-stage workflow:

1. **Data preparation** - fetch price history from the Polymarket CLOB API and market metadata from the Gamma API, including related sibling markets
2. **Memory retrieval** - load each agent's own prior signals from Aurora PostgreSQL, plus its fitted calibration line and accuracy weight
3. **Web research** - an autonomous research stage uses NewsData.io and Serper tools for breaking news, expert opinion, polling, and social discourse
4. **Agent selection** - all fourteen intelligence agents are activated for every market; there is no router deciding who gets to speak
5. **Parallel intelligence agents** - fourteen specialists run in parallel through the configured inference provider
6. **Signal fusion** (deterministic) - market-anchored log-odds aggregation with per-agent calibration, Brier-derived weights, evidence-scaled pass-through, and a standard-error noise floor
7. **Thesis construction** - competing bull and bear theses
8. **Cross-examination** - five adversarial tests against each thesis
9. **Consensus engine** (deterministic) - applies the active consensus mode (`anchored` by default, `agent` opt-in) and gate profile, and refuses the trade when the evidence is not strong enough
10. **Risk philosophy agents** - aggressive, conservative, and neutral sizing perspectives
11. **Recommendation generation** - `LONG_YES`, `LONG_NO`, or `NO_TRADE` with entry zone, target zone, stop-loss, expected value, win probability, and reasoning

Results are delivered through WebSocket, email, push, and webhook, respecting quiet hours and per-channel preferences. Every recommendation is scored after it hits take-profit or stop-loss, and every agent has an accuracy leaderboard that feeds back into signal weighting. Outcomes are explicit in the product - pending, target hit, stop hit, expired, or no trade - and pending picks are highlighted only for 60 minutes because entry, target, and stop are priced at execution time.

### The autonomous Portfolio Manager (Pro and Elite)

A user opts into autonomous execution on a specific market by activating a session with:

- a persona: Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, or Momentum Rider
- a capital envelope
- pre-approved guardrails

The Portfolio Manager Lambda consumes recurring analyses for that market - it never triggers its own - and decides entry, sizing, stop-loss, and take-profit. Orders are placed through the Polymarket CLOB API.

A Position Guard monitors open positions for regime shifts and stale markets. A Risk Engine enforces loss limits, cooldowns, and a kill switch that fails closed. The user can pause, resume, stop, or kill all sessions at any time, and every trade, exit, and risk event fans out across notification channels in real time.

### The platform around them

- Passwordless Cognito Magic Link authentication
- On-chain USDC.e subscriptions and credit packs on Polygon, with Safe trading wallets and ERC-20 allowance-based renewal
- A market-level analysis pool that deduplicates compute across users
- A credit ledger with an immutable audit trail
- Customer support tickets with contextual entry points, a tokenised thread, and an admin inbox
- An opt-in editorial newsletter with explicit consent, one-click unsubscribe, and a public web view
- An internal management portal with roles, MFA enrolment, audit logging, audited runtime settings, analysis requeue, billing and ops visibility, and support tooling
- A Next.js 16 / React 19 trading terminal with real-time delivery

## Why this is a Frankenstein

The Kiroween Frankenstein category asks for a chimera of technologies that should not fit together. TradeWizard qualifies literally:

| Layer | Technology | The seam |
|-------|-----------|----------|
| Reasoning | 14 model-backed agents, capability-routed across providers | Typed `AgentSignal` contracts, Zod validation |
| Safety | Deterministic TypeScript gates | Non-LLM stages that can overrule every model |
| Compute | AWS Lambda, SQS, EventBridge | Orchestrator + queue, no long-lived servers |
| State | Aurora PostgreSQL Serverless v2, DynamoDB, S3 | Idempotent schema, TTL dedup, artifact storage |
| Delivery | SNS fan-out to WebSocket, email, push, webhook | Per-user preference and quiet-hours logic |
| Money | USDC.e on Polygon, Safe wallets, ERC-20 allowances | Transaction-hash verification, never custody |
| Execution | Polymarket CLOB, separate Trade Executor | Machine-checked guardrails, fail-closed kill switch |
| Surface | Next.js 16, React 19, Tailwind 4, TanStack Query | WebSocket cache integration |
| Process | Kiro specs, steering, hooks, MCP | The stitching that keeps the layers coherent |

Most of these layers are ordinary on their own. The unusual part is the contract between them: the model layer produces signals, the deterministic layer decides what to do with them, and the execution layer enforces what the autonomous manager is allowed to do. Kiro is how that contract stayed coherent across 34 specs and three packages.

## Architecture

```
User → Next.js Frontend (Cognito Auth)
         ↓ REST API (API Gateway)
   Analysis Request Lambda
         ↓ Credit check → Dedup → SQS
   Analysis Orchestrator Lambda
         ↓ Lambda invoke (Strands SDK)
   AI provider boundary (Bedrock default, Nebius optional)
   ┌──────────────────────────────────────────────────────────┐
   │ Web Research                                             │
   │ 14 Intelligence Agents (capability-routed, parallel)     │
   │ Thesis · Cross-Exam · Risk Philosophy · Recommendation   │
   └──────────────────────────────────────────────────────────┘
         ↓ typed signals, deterministic gates
   Signal Fusion → Consensus → EV Check → Recommendation
         ↓
   Results → S3 + Aurora PostgreSQL
         ↓ SNS Fan-out
   ┌─────────────────────────────────────┐
   │ WebSocket Push │ Email (Resend) │ Push │ Webhook │
   └─────────────────────────────────────┘
         ↓
   Real-time delivery to frontend
```

### Inputs

Every analysis begins with a market identifier. From that seed the system collects:

1. **Price history** - OHLC-style data from the CLOB API, written as a deterministic CSV for agents to query numerically
2. **Market metadata** - resolution criteria, expiry, probability, spread, volume, liquidity, and related markets from the Gamma API
3. **Agent memory** - per-agent historical signals from Aurora; each agent sees only its own history to avoid cross-agent anchoring
4. **Real-time web context** - NewsData.io and Serper research
5. **Agent performance weights** - historical accuracy used to scale influence during fusion

For the Portfolio Manager, additional inputs include the active session, persona, capital envelope, current position, order-book depth, the latest analysis, trade history, and session performance.

### Outputs

The intelligence layer emits a `TradeRecommendation`:

- action: `LONG_YES`, `LONG_NO`, or `NO_TRADE`
- entry zone and target zone
- mandatory stop-loss
- expected value and win probability
- explicit outcome state: pending, target hit, stop hit, expired, or no trade
- multi-paragraph explanation with catalysts, failure scenarios, and uncertainty notes
- per-agent signals, bull and bear theses, cross-examination scores, and the three risk-philosophy perspectives

The Portfolio Manager emits lifecycle events: trade entered, position exited, risk alert, kill switch, session status change, and daily summary.

## The deterministic gates

This is the part that distinguishes TradeWizard from a chat bot recommending trades. There are three deterministic gates between raw agent output and what reaches the user.

### Gate 1 - Signal Fusion (no LLM)

Agent signals are aggregated in log-odds space, anchored to the market price. Each forecast is de-biased against its own fitted calibration line. Brier-calibrated weights set influence. Evidence-scaled pass-through decides how much of the ensemble's edge survives a disagreement, and a standard-error noise floor plus a conflict map describe how much of the result is signal.

### Gate 2 - Adversarial Debate

A thesis stage generates competing bull and bear cases from the fused signal. A cross-examination stage runs five adversarial tests against each thesis - evidence, causality, timing, liquidity, tail risk - for ten structured tests. Each test produces survived / weakened / refuted with a numeric score.

### Gate 3 - Consensus Engine (no LLM)

The engine uses `CONSENSUS_MODE=anchored` by default (`agent` opts into the confidence-weighted, de-biased vote):

- an edge floor derived from the market's spread plus slippage and two standard errors of ensemble noise
- thesis confirmation
- a divergence cap on model-vs-market disagreement

It fails to `NO_TRADE` on disagreement above 30% or confidence below 20%, and persists a machine-readable reason:

- `consensus_failed`
- `divergence_cap`
- `edge_below_threshold`
- `edge_below_significance`
- `thesis_veto`
- `levels_rejected`
- `recommendation_failed`
- `analysis_failed`

The recommendation stage validates schema and price ordering. If expected value is non-positive, the recommendation is rejected and replaced with `NO_TRADE`. These are deterministic checks the models cannot override.

### Gate tuning is configuration, not prompt text

| Variable | Default | Effect |
|----------|---------|--------|
| `GATE_PROFILE` | `actionable` | `actionable` derives the edge floor from spread + slippage; `strict` restores the flat 4c floor and hard thesis veto |
| `CONSENSUS_MODE` | `anchored` | `anchored` uses market-anchored fusion + edge floor for the live action; `agent` opts into the confidence-weighted, de-biased vote (both run every analysis) |
| `FUSION_MAX_PASS_THROUGH` | `0.6` | Fraction of raw ensemble edge allowed through for moderate disagreement |
| `MIN_ACTIONABLE_EDGE` | `0.04` | Flat edge floor under the `strict` profile |
| `MIN_EDGE_SIGMA` | `2` | Standard errors of ensemble noise an edge must clear |
| `MAX_ACTIONABLE_DIVERGENCE` | `0.15` | Credibility cap on model-vs-market disagreement |
| `SHADOW_PNL_HORIZON_HOURS` | `24` | Horizon for live-vs-shadow comparison |

### Shadow consensus is measurement only

Every analysis computes both consensus configurations. The non-live one is stored in the `shadow_*` columns and both are graded on the same fixed-horizon price move. The shadow decision is never shown to users and never influences the live recommendation. It is the evidence used before switching modes or changing a gate.

## Bounded autonomy

The Portfolio Manager's decision agent has a read-only tool layer. It cannot place an order. Its output is a structured decision, and the Trade Executor validates that decision against hard limits before touching the CLOB:

- **Mandatory stop-loss and take-profit** on every position; a trade is rejected if either is missing or out of bounds
- **Per-session loss limit** at 50% of capital; cross-session cap at 40%
- **30-minute cooldown** after a loss exit
- **Position size cap** at 50% of session capital
- **Concurrent session limits**: 3 for Pro, 10 for Elite
- **Capital conservation**: no trade can exceed uninvested session capital
- **Mutual exclusion** between Trade Executor and Position Guard
- **Token-ID resolution by outcome string**, never by array index
- **Kill switch totality**: exits all positions, terminates all sessions, and fails closed

The agent decides. A separate service enforces. That split is what makes the safety properties reviewable.

## Human-in-the-loop perimeter

The AI never decides how much of a user's money is at risk.

A human must explicitly choose:

1. which market to expose capital to
2. how much capital to commit
3. which persona governs decision-making
4. whether to enable autonomous execution at all

Those four choices define the blast radius, and the AI is architecturally excluded from making them. The activation handler requires the user to submit and confirm a capital amount. The Lambda cannot self-activate or increase committed capital. The kill switch is always available and fails closed. On the intelligence layer, the user places the trade manually unless they have explicitly opted into bounded autonomy.

## Responsible AI guardrail

The primary risk is over-reliance: users trusting probabilistic recommendations as certainties.

Four mechanisms reduce it:

1. **The system visibly refuses.** When disagreement is high or expected value is non-positive, it returns `NO_TRADE` with a structured reason. A system that sometimes says "I don't know" trains users to evaluate.
2. **Uncertainty is surfaced.** Every recommendation exposes its disagreement index, confidence band, dissenting agents, and the failure scenarios that would invalidate the thesis.
3. **Mandatory stop-losses bound the cost of misplaced trust.** No position can exist without an exit plan.
4. **The accuracy leaderboard creates calibrated expectations.** Every recommendation is scored against outcomes, so users can see that the system is fallible.

## What happens when a recommendation is wrong

TradeWizard is designed around the assumption that recommendations will be wrong regularly, and the architecture's job is to contain the damage, learn from it, and get less wrong over time.

### At the intelligence layer

Every actionable recommendation enters a pending outcome state. A Recommendation Scorer runs on a schedule, fetches the current YES-token midpoint from the Gamma API, and checks whether the take-profit or stop-loss was hit.

When a recommendation fails:

- aligned agents receive an incorrect mark
- dissenting agents receive a correct mark
- neutral agents are excluded

The accuracy data feeds back into the next analysis through performance weights. An agent at 0% accuracy receives half influence; an agent at 100% receives double. A consistently wrong agent is mathematically demoted, not just displayed lower on a dashboard. If there is insufficient data, all agents fall back to neutral weight rather than hallucinating confidence.

### At the Portfolio Manager layer

- **Stop-loss fires** - a resting order placed at the CLOB at entry, so it executes even if the platform is unavailable
- **Cooldown activates** - 30 minutes after a loss exit, blocking re-entry
- **Warning at 30% session loss** - halves maximum position size
- **Termination at 50% session loss** - cancels orders, exits at market, terminates the session
- **Cross-session cap at 40%** - trips the kill switch programmatically
- **Kill switch errors fail closed** - sessions terminate and un-exited positions are flagged for manual review

The user is never in the dark about a wrong recommendation. Failure is a first-class event with its own notification, scoring, and mechanical response.

## How Kiro was used

The full write-up is in [kiro-usage.md](kiro-usage.md). In short:

- **34 specs** under `.kiro/specs/` define the agent league, portfolio manager, delivery frontend, wallet subscriptions, admin API, management portal, memory system, and more. Each has requirements, design, and tasks.
- **4 steering documents** under `.kiro/steering/` encode the product model, package boundaries, technical invariants, and submission rules.
- **5 hooks** under `.kiro/hooks/` typecheck the three packages on save, protect the deterministic gates with an agent review, and close out spec tasks.
- **2 active MCP servers** in `.kiro/settings/mcp.json` provide Magic Link and Polymarket documentation to the agent.

The repository is the evidence. We do not claim Kiro Crew, CLI, Web, powers, custom agents, or property-based testing, because the repository does not contain artifacts for them.

## Challenges

**The autonomy paradox.** "The human is the final decision maker" and "autonomous execution" sound contradictory. The resolution was bounded autonomy: separate decision authority from enforcement authority, then express the perimeter as machine-checked invariants the user pre-approves.

**LLM determinism is a fantasy; pipeline determinism is achievable.** Early prototypes tried to make the model behave consistently. The fix was to stop asking the model to be deterministic and bracket it with deterministic stages.

**Agreement is not consensus.** When all fourteen agents agree, it often means they read the same headline. The divergence penalty, the disagreement gate, and isolated memory made disagreement informative.

**Cost runaway under naive deduplication.** Per-user caching is the same as no caching. The market-level pool coalesces requests, and delivery accounting had to be redesigned so users pay only for results they receive.

**Token ordering on the CLOB.** Outcome arrays are not stably ordered. Indexing YES at `[0]` eventually puts a YES order on a NO token. The resolver matches by outcome string and has a regression test.

**Docs drift.** The repository's older READMEs contain stale model and file names. The submission treats `.kiro/steering/` and current code as the source of truth and states only what is implemented.

## Accomplishments

- **A multi-agent system that is allowed to refuse.** `NO_TRADE` is a first-class outcome with a structured reason and no charge.
- **Three deterministic gates around fourteen models.** Fusion, consensus, schema validation, and EV rejection are non-LLM stages.
- **Bounded-autonomy execution.** Fail-closed kill switch, mandatory exits, hard loss limits, cooldowns, capital conservation, and executor/guard mutual exclusion.
- **A market-level analysis pool.** Cost scales with markets analyzed, not users requesting.
- **Closed-loop learning.** Every recommendation is scored; every agent has a leaderboard; memory feeds back into weighting.
- **A spec-first build.** 34 specs, 4 steering documents, 5 hooks, and 2 MCP servers keep a large system coherent.
- **A serverless platform that idles at roughly fifteen to twenty dollars a month.** No NAT, no ElastiCache, no always-on compute.

## What we learned

- **Refusing to recommend is a feature, not a failure mode.**
- **Independence beats agreement at the agent layer.**
- **Enforce safety below the model, not inside it.**
- **Specs are a safety mechanism, not paperwork.**
- **Deduplication is product strategy, not infrastructure.**
- **Explainability is a UI feature first.**

## What's next

- Model performance benchmarking and automated routing updates
- Agent specialization and ablation using leaderboard outcome data
- Vertical expansion beyond politics into macro, sports, and entertainment
- Portfolio-aware analysis with correlation-aware sizing
- Institutional API with audit logs and signed reasoning chains
- Public accuracy reporting with methodology

## Stack

**AI:** 14 capability-routed agents, Strands Agents SDK, Amazon Bedrock (default) or Nebius Token Factory (optional), Zod-validated signals, deterministic fusion/consensus/recommendation

**Infrastructure:** AWS CDK, Lambda (Node.js 20), Aurora PostgreSQL Serverless v2, DynamoDB, SQS FIFO + DLQ, EventBridge, SNS, S3, API Gateway REST + WebSocket, Cognito, CloudWatch, Amplify Hosting

**Frontend:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, TanStack Query, Magic SDK, viem

**Payments:** USDC.e on Polygon, Safe trading wallets, ERC-20 allowances, transaction-hash verification, Resend email

**Data and tools:** Polymarket CLOB + Gamma APIs, NewsData.io, Serper

**Build:** Kiro specs, steering, hooks, and MCP; Vitest; Remotion for demo compositions

## Links

- Repository: https://github.com/balojey/tradewizard-kiroween
- Kiro usage: [kiro-usage.md](kiro-usage.md)
- Short submission copy: [kiroween-submission.md](kiroween-submission.md)
- Product overview: [tradewizard-overview.md](tradewizard-overview.md)
- Live app and demo video: in the Devpost submission form

---

**Disclaimer**: TradeWizard provides AI-generated analysis for educational and informational purposes. All trading involves risk. Past performance does not guarantee future results. Please trade responsibly.
