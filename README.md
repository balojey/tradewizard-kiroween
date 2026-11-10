# TradeWizard Operations Portal

> **Kiroween 2026 · Frankenstein category**
>
> The audited control surface for a live multi-agent prediction-market platform. A separate internal product, specified and documented by two Kiro specs during the submission period.

TradeWizard is a live prediction-market platform: fourteen AI agents, a deterministic analysis pipeline, an autonomous Portfolio Manager, on-chain billing, customer support, and a newsletter.

Operating that from the AWS console is unsafe and slow. The **TradeWizard Operations Portal** is the product built to do it: a separate internal Next.js application with its own API, Cognito identity, four-role RBAC, append-only audit trail, runtime settings, and deployment. It never holds wallet keys, signs transactions, or calls the CLOB. It asks the platform to act, and records who asked, why, and what changed.

The portal is the Kiroween submission. The platform is the system it operates.

## Why this is a Frankenstein

The portal is a chimera of systems that normally do not share a body:

- A separate Next.js 16 app that never enters the customer bundle
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

## What the portal does

### Authentication and roles

Admin accounts are dedicated Cognito identities. Sign-in is email + password + TOTP on a separate admin client. MFA enrolment is self-service with a QR code. Sessions use a 30-day refresh token; the UI keeps the session in `localStorage` and writes a presence-only cookie for the route guard. The API authorizer is the security boundary.

| Role | Rank | Capability |
|------|------|------------|
| Analyst | 10 | Read-only metrics, analyses, agent performance |
| Support | 20 | Read all; credits, notes, resend, pause/resume sessions |
| Admin | 30 | All mutations except settings and role changes |
| Owner | 40 | Everything, including settings and membership |

Every handler re-checks the minimum role. Destructive actions require a token fresher than 10 minutes and a reason. The last owner cannot be removed.

### Append-only audit

Every mutation writes an audit row before the side effect, with actor, action, target, reason, before/after state, request id, IP, user agent, and idempotency key. The row starts `pending` and ends `succeeded` or `failed`. Database triggers reject `UPDATE` and `DELETE`, so the log is append-only even from a direct database session.

### Read surfaces

- **Overview** - signups, analyses, revenue, active PM sessions, realized P&L, error trend
- **Users** - search, detail, credits, analyses, sessions, payments, notes, plan, status
- **Analyses** - filters, quality analytics, no-trade reasons, live-vs-shadow, presigned payload viewer
- **Portfolio** - cross-user sessions, exposure, trades, decisions, P&L
- **Billing** - payments, renewals, trials, subscription state
- **Agents** - accuracy leaderboard, calibration, model cost
- **Ops** - queues, DLQ, Lambda health, alarms, database health
- **Markets** - analysis pool, schedules, stuck executions
- **Audit** - append-only event log with filters

### Controls

- **Kill switch** - per-user, fail-closed: synchronous DynamoDB halt, asynchronous risk-engine exit, explicit exit-dispatch result
- **Session controls** - pause, resume, terminate; existing exits and guards stay active while paused
- **Users** - credit grants, plan overrides with expiry, suspension, support notes
- **Members** - owner-managed invites, role changes, immediate revocation, MFA enrolment
- **Analyses** - cache invalidation, refund every recipient, atomic market requeue
- **Settings** - audited runtime settings, each with a named consumer
- **Support** - ticket inbox with context snapshots, claim/reply, tokenised threads
- **Newsletter** - typed templates, preview, test send, owner-only send, subscriber suppression

### Runtime settings

| Setting | Consumer | Effect |
|---------|----------|--------|
| `analysis_paused` | `analysis-request` | Refuse new analysis; schedules continue |
| `analysis_pause_message` | `analysis-request` | User-facing maintenance copy |
| `ai_provider` | `ai-provider` | Override the deployed provider |
| `pm_activations_paused` | `portfolio-activation` | Refuse new sessions; existing sessions continue |
| `support_enabled` | `support-api` | Refuse new tickets; unsubscribe still works |
| `support_first_response_target_hours` | support inbox | SLA and overdue flags |
| `newsletter_enabled` | `newsletter-api` | Hide opt-in; unsubscribe always works |

Reads are cached for 60 seconds per container. Synchronous consumers read a warmed cache; a missing row falls back to the default. Writes are owner-only, fresh-auth, reason-required, and audited.

### PWA

The portal is installable, but the service worker caches only content-hashed static assets. Navigations, API responses, RSC payloads, and presigned S3 URLs are never cached. An offline navigation gets an inline notice instead of a previous operator's shell.

## Built with Kiro

| Artifact | Count | What it does |
|----------|-------|--------------|
| [`admin-portal-foundation`](.kiro/specs/admin-portal-foundation/requirements.md) | 1 spec | Package isolation, auth/MFA, RBAC, audit spine, admin API, read surfaces, shell |
| [`admin-portal-operations`](.kiro/specs/admin-portal-operations/requirements.md) | 1 spec | Mutation envelope, kill switch, session controls, membership, settings, support, newsletter |
| [`.kiro/steering/`](.kiro/steering/) | 4 documents | Product, structure, tech, and submission constraints |
| [`.kiro/hooks/`](.kiro/hooks/) | 5 hooks | Typecheck all packages, guard the analysis gates, close spec tasks |
| [`.kiro/settings/mcp.json`](.kiro/settings/mcp.json) | 2 active servers | Magic Link and Polymarket documentation |

The repository also contains 31 product specs for the platform. They are context for the system the portal operates; the two portal specs are the submission.

Read [docs/kiro-usage.md](docs/kiro-usage.md) for the judge-facing write-up.

Property-based tests cover the portal's authorization invariants with `fast-check`: role ranking, group resolution, `requireRole` across every role pair, the fresh-auth window, and bearer-token extraction.

## Architecture

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

The portal is deployed as a separate Amplify app at `admin.tradewizard.live`. It is never linked from the customer product and is excluded from search indexing.

## AWS services used by the portal

| Service | Role |
|---------|------|
| AWS CDK + CloudFormation | Nine stacks; no console drift |
| AWS Lambda (Node.js 20) | Admin API, authorizer, metrics rollup, support housekeeping, newsletter sender |
| Amazon API Gateway | Admin REST API with Cognito request authorizer and access logs |
| Amazon Cognito | Admin app client, four groups, TOTP, authorizer |
| Amazon RDS for PostgreSQL 18.3 | Users, credits, analyses, sessions, audit, settings, support, newsletter; single-AZ `db.t4g.micro`, encrypted 20-50 GB, SSL, 7-day production backups |
| Amazon DynamoDB | Kill-switch state, rate limits, support claims, dedup |
| Amazon S3 | Analysis payloads and agent traces behind presigned URLs |
| Amazon EventBridge Scheduler | Hourly support housekeeping and admin metrics rollup |
| Amazon SNS | Alarm topic for authorizer denials, API 5xx, rollup failures |
| Amazon CloudWatch | Logs, metrics, dashboards, alarms |
| AWS Secrets Manager + IAM | Database, email, CLOB, wallet, webhook, newsletter secrets; scoped handler roles |
| AWS Amplify Hosting | Separate admin app and domain |
| Amazon Bedrock | Inference layer of the platform the portal operates |

## The platform it operates

TradeWizard runs an 11-stage analysis workflow with fourteen specialized agents, three gates, and a bounded-autonomy Portfolio Manager. It has passwordless Cognito auth, on-chain USDC.e billing, a market-level analysis pool, multi-channel delivery, support tickets, and a newsletter.

The portal is how a team operates that system: users, analyses, sessions, money, settings, support, and the record of who changed what.

## Components

| Component | Purpose | Tech stack |
|-----------|---------|------------|
| [tradewizard-admin/](tradewizard-admin/README.md) | **The Kiroween submission**: internal operations portal | Next.js 16, React 19, TypeScript |
| [infra/](infra/README.md) | Admin API, authorizer, portal Lambdas, and the platform substrate | TypeScript, AWS CDK, Lambda, RDS, DynamoDB |
| [tradewizard-frontend/](tradewizard-frontend/README.md) | The customer product the portal operates | Next.js 16, React 19, Tailwind CSS 4 |
| [remotion/](remotion/) | Demo video compositions | Remotion, React |
| [docs/](docs/) | Product, portal, and submission documentation | Markdown |

## Getting Started

### Backend + portal

```bash
# 1. Deploy the AWS substrate (CDK, database, auth, admin API)
cd infra
npm install
cp .env.example .env.dev
./deploy.sh up dev

# 2. Start the operations portal
cd ../tradewizard-admin
npm install
cp .env.example .env.local
npm run dev  # http://localhost:3001
```

The admin env needs `NEXT_PUBLIC_ADMIN_API_BASE_URL`, `NEXT_PUBLIC_ADMIN_CLIENT_ID`, `NEXT_PUBLIC_COGNITO_REGION`, and `NEXT_PUBLIC_PRODUCT_BASE_URL`. Values come from CloudFormation exports; see [tradewizard-admin/README.md](tradewizard-admin/README.md).

### Product frontend (optional context)

```bash
cd tradewizard-frontend
npm install
cp .env.example .env.local
npm run dev  # http://localhost:3000
```

## Common Commands

### tradewizard-admin

```bash
npm run dev          # http://localhost:3001
npm run build        # production build
npm run build:prod   # build with .env.prod exported
npm run start:prod   # start on 3001 with .env.prod
npm run lint
npx tsc --noEmit
```

### infra

```bash
npm run build                        # tsc typecheck
npm test                             # vitest
npm run verify                       # build + test + synth
./deploy.sh up dev                   # full deploy
./deploy.sh up dev --skip-db         # CDK only
./deploy.sh status dev
npx cdk diff --all -c env=development
```

## Project Structure

```
tradewizard-kiroween/
├── .kiro/                  # Kiro specs, steering, hooks, MCP
│   ├── specs/             # 34 specs; two are the portal submission
│   ├── steering/          # Product, structure, tech, submission rules
│   ├── hooks/             # Typecheck, gate guard, spec follow-through
│   └── settings/mcp.json
├── tradewizard-admin/      # The submission: operations portal
├── infra/                  # CDK stacks + Lambda services
│   ├── lib/               # Network, database, auth, queue, compute, admin, monitoring
│   ├── services/          # admin-api, admin-authorizer, support, newsletter, analysis, portfolio
│   └── sql/               # PostgreSQL schema
├── tradewizard-frontend/   # The customer product the portal operates
├── remotion/               # Demo video compositions
└── docs/                   # Submission, portal, and product documentation
```

## Documentation

### Kiroween submission
- [docs/devpost-submission.md](docs/devpost-submission.md) - Devpost submission, 2,838 words, absolute links
- [docs/kiroween-submission.md](docs/kiroween-submission.md) - Internal category write-up
- [docs/kiro-usage.md](docs/kiro-usage.md) - How Kiro was used
- [docs/devpost-form.md](docs/devpost-form.md) - Form fields, test instructions, checklist
- [docs/devpost-vo-script.md](docs/devpost-vo-script.md) - Demo voiceover and shot list
- [docs/youtube-description.md](docs/youtube-description.md) - Video metadata

### Portal
- [tradewizard-admin/README.md](tradewizard-admin/README.md) - Portal development and deployment
- [.kiro/specs/admin-portal-foundation](.kiro/specs/admin-portal-foundation/requirements.md) - Foundation spec
- [.kiro/specs/admin-portal-operations](.kiro/specs/admin-portal-operations/requirements.md) - Operations spec
- [docs/admin-portal-architecture.md](docs/admin-portal-architecture.md) - Binding portal architecture
- [docs/admin-portal-runbook.md](docs/admin-portal-runbook.md) - Operating procedures

### Platform context
- [docs/tradewizard-overview.md](docs/tradewizard-overview.md) - The platform the portal operates
- [docs/support-tickets-plan.md](docs/support-tickets-plan.md) - Support design
- [docs/newsletter-plan.md](docs/newsletter-plan.md) - Newsletter design
- [infra/README.md](infra/README.md) - Infrastructure guide
- [tradewizard-frontend/README.md](tradewizard-frontend/README.md) - Customer app guide

## Kiroween Checklist

- [x] Public repository with all source, assets, and instructions
- [x] MIT license at the root, detectable by GitHub
- [x] `/.kiro` directory tracked with specs, steering, and hooks
- [x] Frankenstein category rationale
- [x] Kiro usage write-up with file-level references
- [ ] Operations portal URL added to the Devpost form
- [ ] Demo video uploaded to YouTube (under three minutes, public)
- [ ] Devpost form completed with category and bonus prizes

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push and open a Pull Request

Code quality requirements:
- TypeScript strict mode
- ESLint + Prettier
- All infrastructure changes via CDK
- Graceful error handling at every layer
- Non-trivial portal changes start as a spec in `.kiro/specs/`

## License

MIT. See [LICENSE](LICENSE).

---

**Note**: The Operations Portal is an internal control surface and is not linked from the customer product. TradeWizard's market analysis is provided for educational and informational purposes; all trading involves risk.
