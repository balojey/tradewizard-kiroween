# TradeWizard

> **Kiroween 2026 · Frankenstein category**
>
> A creature stitched from fourteen AI specialists, three deterministic gates, a serverless AWS nervous system, an on-chain payment rail, and a Next.js trading terminal. Built spec-first with Kiro.

TradeWizard turns prediction markets from speculative guessing into intelligence-driven trading. A multi-agent system analyzes Polymarket markets from independent perspectives, fuses their signals through deterministic stages, and produces explainable trade recommendations with clear reasoning, catalysts, and risk scenarios. When the evidence does not support a trade, it refuses.

The product already ran on AWS. This repository is the Kiroween submission: the same working platform, packaged with the specs, steering documents, hooks, and MCP configuration that shaped it.

## Why this is a Frankenstein

TradeWizard is not one technology wearing a costume. It is a chimera of layers that normally do not share a body:

| Layer | What it contributes | Why it is unusual |
|-------|--------------------|-------------------|
| Multi-agent inference | 14 specialists analyze every market in parallel, each with its own tools and memory | The models are allowed to disagree, and disagreement is treated as signal |
| Deterministic gates | Signal fusion, consensus, EV rejection, and schema validation run in TypeScript, not in a prompt | The pipeline can overrule every model in the system |
| Serverless substrate | CDK, Lambda, Aurora, DynamoDB, SQS, SNS, API Gateway | No long-lived servers, no NAT, scales to zero |
| On-chain billing | USDC.e subscriptions and credit packs on Polygon via Safe trading wallets | Payment verification is on-chain, not card-processor based |
| Trading terminal | Next.js 16, React 19, WebSocket delivery, TanStack Query | Real-time analysis and execution in one product surface |
| Autonomous execution | A Portfolio Manager that decides, plus a separate executor that enforces hard limits | The agent never holds the order-book keys |
| Kiro | Specs, steering, hooks, and MCP | The stitching that keeps the layers coherent |

The seam is Kiro. Every non-trivial slice of the backend and frontend has a spec under [`.kiro/specs/`](.kiro/specs/), every architectural rule lives in [`.kiro/steering/`](.kiro/steering/), and the workflows that protect the deterministic gates are encoded as [hooks](.kiro/hooks/).

## Built with Kiro

| Artifact | Count | What it does |
|----------|-------|--------------|
| [`.kiro/specs/`](.kiro/specs/) | 34 specs | Requirements → design → tasks for features such as the agent league, autonomous portfolio manager, delivery frontend, admin portal, and analysis gates |
| [`.kiro/steering/`](.kiro/steering/) | 4 documents | `product.md`, `structure.md`, `tech.md`, and `kiroween.md` give the agent the product model, package boundaries, and submission constraints |
| [`.kiro/hooks/`](.kiro/hooks/) | 5 hooks | Typecheck the three packages on save, guard the deterministic gates with an agent review, and close out completed spec tasks |
| [`.kiro/settings/mcp.json`](.kiro/settings/mcp.json) | 2 active servers | Magic Link and Polymarket documentation, so the agent can verify integration details instead of guessing |

Read [docs/kiro-usage.md](docs/kiro-usage.md) for the judge-facing write-up, including the spec workflow, the hook table, and the MCP setup. The management portal has its own pair of specs: [`admin-portal-foundation`](.kiro/specs/admin-portal-foundation/requirements.md) covers the isolated package, auth/MFA, RBAC, audit spine, admin API, read surfaces, and shell; [`admin-portal-operations`](.kiro/specs/admin-portal-operations/requirements.md) covers every mutation, the kill switch, session controls, membership, runtime settings, support, and newsletter.

## Components

| Component | Purpose | Tech Stack |
|-----------|---------|-----------|
| [infra/](infra/README.md) | Serverless platform: CDK, Lambda, Aurora, DynamoDB | TypeScript, AWS CDK, Lambda, RDS, DynamoDB |
| [tradewizard-frontend/](tradewizard-frontend/README.md) | Customer web UI with Cognito auth, real-time delivery, subscriptions | Next.js 16, React 19, Tailwind CSS 4 |
| [tradewizard-admin/](tradewizard-admin/README.md) | Internal management portal: roles, MFA, audit, runtime settings, analysis requeue, billing/ops visibility, installable PWA | Next.js, TypeScript |
| [remotion/](remotion/) | Product demo video compositions | Remotion, React |
| [docs/](docs/) | Product, architecture, and submission documentation | Markdown |

## Architecture

```
User → Next.js Frontend (Cognito Auth)
         ↓ REST API (API Gateway)
   Analysis Request Lambda
         ↓ Credit check → Dedup → SQS
   Analysis Orchestrator Lambda
         ↓ Lambda invoke (Strands SDK)
   AI provider boundary
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

The division of responsibility is deliberate. Models run inference. The deterministic stages - signal fusion, consensus, expected-value rejection, schema validation - run in application code. The Portfolio Manager's executor, risk engine, and kill switch never depend on a model deciding to behave.

On the frontend, wallet calls route through a same-origin Polygon JSON-RPC proxy that splits large batches and falls back across providers. Outcome sides (YES/NO) are resolved by label, never by array index, in both analysis and execution.

The inference provider is a configuration boundary, not a rewrite. `AI_PROVIDER=bedrock` (default) and `AI_PROVIDER=nebius` route the same Strands agent code to different providers, so the agent layer is not coupled to a single vendor.

### Analysis Pipeline (11 Stages)

1. **Data Preparation** - Fetch live data from Polymarket CLOB + Gamma APIs
2. **Memory Retrieval** - Load historical agent signals from Aurora PostgreSQL, plus each agent's fitted price-calibration line and Brier-derived weight
3. **Web Research** - Autonomous research via NewsData.io and Serper tools
4. **Agent Selection** - All 14 agents activated for every market (no conditional filtering)
5. **Parallel Intelligence Agents** - 14 agents execute in parallel through the configured provider
6. **Signal Fusion** (deterministic) - Market-anchored log-odds aggregation. Each agent forecast is de-biased against its own fitted calibration line, evidence-scaled pass-through decides how much of the ensemble's edge survives, Brier-calibrated weights set influence, and a standard-error noise floor plus conflict detection describe how much of the result is signal
7. **Thesis Construction** - Competing bull and bear theses
8. **Cross-Examination** - 5 adversarial tests on both theses
9. **Consensus Engine** (deterministic) - Uses `CONSENSUS_MODE=anchored` by default: market-anchored fusion, the gate profile's edge floor derived from the market's spread + slippage, two standard errors of ensemble noise, thesis confirmation, and the divergence cap. `CONSENSUS_MODE=agent` opts into the confidence-weighted, de-biased vote. Fails to `NO_TRADE` on disagreement > 30% or confidence < 20%, and records the reason that produced the refusal
10. **Risk Philosophy Agents** - Aggressive, conservative, neutral position sizing
11. **Recommendation Generation** - LONG_YES, LONG_NO, or NO_TRADE with entry/exit zones

Both consensus configurations are computed on every run. The non-live one is stored in the `shadow_*` columns and both are graded on the same 24-hour price move (`live_pnl` vs `shadow_pnl`). The shadow decision is never shown to users - it is the evidence used before switching modes or changing a gate.

### Gate Configuration

The deterministic gates are environment knobs, not prompt text, so a gate can be retuned without touching inference:

| Variable | Default | Effect |
|----------|---------|--------|
| `GATE_PROFILE` | `actionable` | `actionable` derives the edge floor from the spread + slippage and treats thesis disagreement as a confidence haircut; `strict` restores the flat 4c floor and hard thesis veto |
| `CONSENSUS_MODE` | `anchored` | `anchored` uses market-anchored fusion plus the edge floor for the live action; `agent` opts into the confidence-weighted, de-biased vote (both are computed each run) |
| `FUSION_MAX_PASS_THROUGH` | `0.6` | Fraction of the ensemble's raw edge allowed through for moderate (≤15%) disagreements; 15–30% passes at half that, >30% is treated as model error |
| `MIN_ACTIONABLE_EDGE` | `0.04` | Flat edge floor under the `strict` profile (high-liquidity markets require 1.5×) |
| `MIN_EDGE_SIGMA` | `2` | How many standard errors of ensemble noise an edge must clear to count as signal |
| `MAX_ACTIONABLE_DIVERGENCE` | `0.15` | Credibility cap on model-vs-market disagreement |
| `SHADOW_PNL_HORIZON_HOURS` | `24` | Fixed horizon on which the live and shadow decisions are compared |

Every `NO_TRADE` persists a machine-readable reason (`consensus_failed`, `divergence_cap`, `edge_below_threshold`, `edge_below_significance`, `thesis_veto`, plus recommendation-stage `levels_rejected`, `recommendation_failed`, and `analysis_failed`), so "why is everything NO_TRADE?" is a query rather than an interpretation.

## Frontend Features

### Authentication
- Amazon Cognito with Magic Link custom auth flow (passwordless)
- JWT token management with auto-refresh
- Secure localStorage token storage with `tw_` prefix

### Real-Time Delivery
- WebSocket connection with exponential backoff reconnection (1s → 30s max)
- Ping keepalive every 5 minutes
- TanStack Query cache integration (new results prepend without refresh)

### Analysis Request
- One-time or recurring analysis with plan-aware interval selection
- Credit balance display with optimistic decrement
- Handles cached (instant) and queued (async) responses

### Results Viewer
- Paginated history with infinite scroll
- Full detail view: agent signals, bull/bear thesis, cross-examination, position sizing
- Explicit outcome state: pending, target hit, stop hit, expired, or no trade
- Pending picks are highlighted only for 60 minutes; entry, target, and stop are priced at execution time, so an older call is a cached read rather than a live pick
- Visual distinction between cached and fresh analyses
- Real-time prepend from WebSocket

### Subscription Management
- Plan comparison (Free, Starter 19 USDC.e, Pro 49 USDC.e, Elite 149 USDC.e)
- On-chain USDC.e payments from Trading Wallet (Safe) on Polygon
- Auto-renewal via ERC-20 allowance (approve/revoke from UI)
- Manual renewal flow for users without allowance set
- Credit pack purchases (20 for 9 USDC.e, 50 for 19 USDC.e)
- Subscription cancellation with period-end handling
- Payment history with on-chain transaction links
- Credit balance in header with optimistic updates

### Notification Settings
- Channel toggles (in-app, email, push, webhook) with plan-based restrictions
- Quiet hours configuration (HH:MM time pickers)
- Probability shift threshold (0.01–1.00)
- Webhook URL validation (HTTPS required)

### Customer Support
- Contextual help from an analysis verdict, a Portfolio Manager session, the nav, or the login screen
- Public help pages and tokenised ticket threads (`/help`, `/help/t/[ref]`)
- Signed-in ticket history under `/account/support`
- Tickets carry a context snapshot (market, analysis, session, plan) so support sees the artifact, not just a description
- Admin inbox with claim/release, guarded replies, SLA flags, and hourly housekeeping

### Newsletter
- Opt-in "The Weekly Brief" with explicit consent; no pre-checked boxes
- One-time post-sign-in prompt plus a durable account toggle
- One-click unsubscribe (RFC 8058) and a public `/unsubscribe` page
- Public web view for each published issue at `/newsletter/[slug]`
- Admin composer with typed templates, production-renderer preview, test sends, cancellation, and owner-only send
- Subscriber list with status, source, search, and suppression reasons
- Signed Resend delivery webhooks for bounces and complaints; marketing mail is isolated from transactional email

### Autonomous Portfolio Manager
- Six personas: Sniper, Scalper, Contrarian, Catalyst Hunter, Hedge Architect, Momentum Rider
- User-chosen market, capital envelope, and persona; the agent cannot change them
- Read-only tool layer on the decision agent; a separate executor places orders
- Mandatory stop-loss and take-profit, per-session and cross-session loss limits, cooldowns, and a fail-closed kill switch

## Prerequisites

| Requirement | Used by |
|-------------|---------|
| Node.js 18+ | All components |
| AWS account | infra (CDK deployment) |
| Platform Wallet (Polygon) | USDC.e payment receiving + renewal `transferFrom` |
| Amazon Cognito User Pool | Authentication |
| Optional: Nebius Token Factory key | Alternative inference provider (`AI_PROVIDER=nebius`) |

## Getting Started

### Option A: Full Platform (AWS)

```bash
# 1. Deploy infrastructure (handles secrets, CDK, DB, Resend/SES email)
cd infra
npm install
cp .env.example .env.dev
./deploy.sh up dev

# 2. Start the frontend
cd ../tradewizard-frontend
npm install
cp .env.example .env.local
npm run dev  # http://localhost:3000
```

### Option B: Frontend only (development)

```bash
cd tradewizard-frontend
npm install
cp .env.example .env.local
# Configure environment variables (see below)
npm run dev  # http://localhost:3000
```

## Environment Variables Reference

### tradewizard-frontend (.env.local)

```bash
# Cognito Auth
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=your_client_id
NEXT_PUBLIC_AWS_REGION=us-east-1

# API Gateway
NEXT_PUBLIC_API_BASE_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com/dev

# WebSocket
NEXT_PUBLIC_WS_URL=wss://your-ws-id.execute-api.us-east-1.amazonaws.com/dev

# Wallet Payments
NEXT_PUBLIC_PLATFORM_WALLET_ADDRESS=0x...
NEXT_PUBLIC_USDC_CONTRACT_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174

# Polymarket
NEXT_PUBLIC_POLYMARKET_API_URL=https://clob.polymarket.com
```

### infra (.env.dev)

```bash
# Deployment substrate
AWS_REGION=us-east-1
CDK_DEFAULT_ACCOUNT=your_account_id
ENVIRONMENT=dev

# Wallet (stored in Secrets Manager via deploy.sh)
PLATFORM_WALLET_ADDRESS=0x...
USDC_CONTRACT_ADDRESS=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
POLYGON_RPC_URL=https://polygon-rpc.com
SAFE_FACTORY_ADDRESS=0x...

# Inference (default: Bedrock; set to nebius for Token Factory)
AI_PROVIDER=bedrock
```

## Common Commands

### infra (CDK)

```bash
npm run build                        # tsc typecheck
npm test                             # vitest
npm run verify                       # build + test + synth
./deploy.sh up dev                   # Full deploy (secrets + CDK + DB + Resend/SES)
./deploy.sh up dev --skip-db         # Skip DB migration
./deploy.sh status dev               # Check deployment status
./deploy.sh down dev                 # Tear down
npx cdk diff --all -c env=development  # Show pending changes
```

### tradewizard-frontend

```bash
npm run dev     # Start dev server (localhost:3000)
npm run build   # Build for production
npm run lint    # Lint check
npx tsc --noEmit
```

### tradewizard-admin

```bash
npm run dev     # http://localhost:3001
npm run build
npm run lint
```

## Subscription Plans

| Plan | Price (USDC.e/mo) | Credits/Month | Intervals | Channels |
|------|-------------------|---------------|-----------|----------|
| Free | 0 | 20 | One-time only | In-app |
| Starter | 19 | 100 | One-time, 1 day | In-app, email, push |
| Pro | 49 | 350 | All (1h, 4h, 12h, 1d) | All channels |
| Elite | 149 | Unlimited | All intervals | All channels |

Credit packs: 20 credits for $4.99, 45 credits for $9.99, 75 credits for $14.99.

### Payment Model

Payments are made via on-chain USDC.e transfers on Polygon:
- **Frontend** initiates transfers from the user's Trading Wallet (Safe) via `relayClient.execute()`
- **Backend** verifies completed on-chain transactions (never initiates transfers from user wallets)
- **Auto-renewal** uses ERC-20 `transferFrom` with pre-approved allowance
- **Grace period** (3 days) if renewal fails, with retry every 24h and user notifications

## Project Structure

```
tradewizard-kiroween/
├── .kiro/                  # Kiro specs, steering, hooks, and MCP configuration
│   ├── specs/             # 34 feature specs (requirements → design → tasks)
│   ├── steering/          # Product, structure, tech, and submission rules
│   ├── hooks/             # Typecheck and gate-protection hooks
│   └── settings/mcp.json  # Active MCP servers
├── infra/                  # Serverless substrate + Lambda services
│   ├── lib/               # CDK stacks (network, database, auth, queue, compute, etc.)
│   ├── services/          # Lambda handlers (analysis, delivery, subscriptions, portfolio, etc.)
│   └── sql/               # PostgreSQL schema
├── tradewizard-frontend/   # Next.js customer application
│   ├── app/               # App Router pages (login, markets, insights, portfolio, account)
│   ├── components/        # React components (ui, shell, markets, portfolio, subscription)
│   ├── hooks/             # Custom hooks (useAuth, useWebSocket, usePortfolio*, etc.)
│   ├── lib/               # Utilities (cognito-auth, api-client, websocket-client)
│   └── providers/         # Context providers (Auth, Wallet, Query, WebSocket, Trading)
├── tradewizard-admin/      # Internal management portal (separate deployment)
├── remotion/               # Product demo video compositions
└── docs/                   # Product, architecture, and submission documentation
```

## Documentation

### Kiroween submission
- [docs/kiroween-submission.md](docs/kiroween-submission.md) - Devpost text description and category rationale
- [docs/kiro-usage.md](docs/kiro-usage.md) - How Kiro was used: specs, steering, hooks, MCP
- [.kiro/specs/admin-portal-foundation](.kiro/specs/admin-portal-foundation/requirements.md) - Portal package, auth/MFA, RBAC, audit, API, read surfaces, and shell
- [.kiro/specs/admin-portal-operations](.kiro/specs/admin-portal-operations/requirements.md) - Mutations, kill switch, session controls, membership, settings, support, and newsletter
- [docs/devpost-form.md](docs/devpost-form.md) - Ready-to-paste Devpost fields, test instructions, and pre-submit checklist
- [docs/devpost-vo-script.md](docs/devpost-vo-script.md) - Demo voiceover, under three minutes
- [docs/youtube-description.md](docs/youtube-description.md) - Video title, description, and chapters

### Product and architecture
- [docs/tradewizard-overview.md](docs/tradewizard-overview.md) - Product and system overview
- [docs/support-tickets-plan.md](docs/support-tickets-plan.md) - Customer support ticket design and delivery log
- [docs/newsletter-plan.md](docs/newsletter-plan.md) - Newsletter consent, campaign, and delivery design
- [docs/TradeWizard.md](docs/TradeWizard.md) - Original product specification
- [docs/TradeWizard V2 — Platform Architecture & New Direction.md](docs/TradeWizard%20V2%20—%20Platform%20Architecture%20&%20New%20Direction.md) - V2 architecture direction
- [docs/TradeWizard Debate Protocol.md](docs/TradeWizard%20Debate%20Protocol.md) - Multi-agent debate protocol
- [infra/README.md](infra/README.md) - Infrastructure and deployment guide
- [tradewizard-frontend/README.md](tradewizard-frontend/README.md) - Frontend development guide
- [tradewizard-admin/README.md](tradewizard-admin/README.md) - Admin portal guide

## Kiroween Checklist

- [x] Public repository with all source, assets, and instructions
- [x] MIT license at the root, detectable by GitHub
- [x] `/.kiro` directory tracked with specs, steering, and hooks
- [x] Frankenstein category rationale in the README and submission write-up
- [x] Kiro usage write-up with file-level references
- [ ] Working app URL added to the Devpost submission form
- [ ] Demo video uploaded to YouTube (under three minutes, public)
- [ ] Devpost form completed with category and any bonus prizes

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push and open a Pull Request

Code quality requirements:
- TypeScript strict mode
- ESLint + Prettier
- All infrastructure changes via CDK (never manual console changes)
- Graceful error handling at every layer
- Non-trivial features start as a spec in `.kiro/specs/`

## License

MIT. See [LICENSE](LICENSE).

---

**Disclaimer**: TradeWizard provides AI-generated analysis for educational and informational purposes. All trading involves risk. Past performance does not guarantee future results. Please trade responsibly.
