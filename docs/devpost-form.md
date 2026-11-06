# Devpost Form Pack - Kiroween 2026

Copy-paste fields for the Devpost submission form. Replace every `TODO` before submitting.

---

## Project name

**TradeWizard**

## Elevator pitch (≤ 200 characters)

Fourteen AI agents analyze prediction markets, three deterministic gates decide whether to trade, and a bounded-autonomy Portfolio Manager executes inside hard limits. Built spec-first with Kiro.

## Category

**Frankenstein**

## Links

| Field | Value |
|-------|-------|
| Public GitHub repository | https://github.com/balojey/tradewizard-kiroween |
| Live app URL | `TODO: deployed Amplify URL` |
| Demo video (YouTube, public) | `TODO: https://youtu.be/...` |
| Blog post (optional bonus) | `TODO` |
| Social post (optional bonus) | `TODO` |

## Short description

TradeWizard is the intelligence layer for real-world prediction markets. A user requests analysis on any Polymarket market and an 11-stage workflow runs fourteen specialized AI agents in parallel. Their signals are fused, debated, and then passed through three deterministic, non-LLM gates. If the agents disagree above a hard threshold, or expected value is non-positive, the system returns `NO_TRADE` with a machine-readable reason instead of inventing a trade.

For Pro and Elite users, an optional autonomous Portfolio Manager can execute inside guardrails the user pre-approves. The decision agent has read-only tools; a separate executor enforces mandatory stop-loss and take-profit, per-session and cross-session loss caps, cooldowns, and a fail-closed kill switch.

The platform is serverless on AWS, with on-chain USDC.e billing on Polygon, passwordless Cognito auth, real-time delivery over WebSocket, email, push, and webhook, and a Next.js 16 trading terminal. It is a Kiroween Frankenstein build: multi-agent inference, deterministic TypeScript, serverless infrastructure, on-chain payments, and a modern frontend, stitched together by Kiro specs, steering, hooks, and MCP.

## Full description

Use [docs/kiroween-submission.md](kiroween-submission.md) for the Devpost text description, or [docs/devpost-submission.md](devpost-submission.md) for the long-form technical narrative.

## How we used Kiro

Use [docs/kiro-usage.md](kiro-usage.md) for the full write-up. The short version:

- **Spec-driven development.** Thirty-four specs under `.kiro/specs/` define the agent league, 11-stage workflow, autonomous Portfolio Manager, wallet subscriptions, delivery frontend, admin API, management portal, and memory system. Most follow requirements → design → tasks with an ordered task list.
- **Steering.** Four documents under `.kiro/steering/` encode the product model, package boundaries, technical invariants, and submission rules. The most important rule is negative: deterministic stages contain no model calls.
- **Agent hooks.** Five hooks under `.kiro/hooks/` typecheck each package on save, run an agent review when a deterministic gate changes, and close out completed spec tasks.
- **MCP.** `.kiro/settings/mcp.json` connects the agent to Magic Link and Polymarket documentation so integration details are verified rather than recalled.
- **Honest scope.** We do not claim Kiro Crew, CLI, Web, powers, custom agents, or property-based testing; the repository does not contain evidence for them.

## Built with

Kiro, TypeScript, AWS CDK, AWS Lambda, Amazon Aurora PostgreSQL Serverless v2, DynamoDB, SQS, SNS, EventBridge, API Gateway, Cognito, S3, CloudWatch, Amazon Bedrock, Nebius Token Factory, Strands Agents SDK, Next.js 16, React 19, Tailwind CSS 4, TanStack Query, Zod, Vitest, Remotion, Polymarket CLOB and Gamma APIs, viem, Safe, USDC.e on Polygon, Resend, NewsData.io, Serper.

## Try it out

### Judge instructions

1. Open the live app URL.
2. Sign in with the test account below (Magic Link auth; the inbox is monitored for the demo).
3. Open **Markets**, choose a live Polymarket market, and click **Analyze**.
4. Wait for the 14 agent signals and open the result detail. Scroll to the thesis, cross-examination, and final recommendation.
5. Open **Portfolio Manager** to see session activation, guardrails, and the kill switch.

### Test credentials

```
Email: TODO
Demo tier: TODO (Pro recommended, so the Portfolio Manager is visible)
```

Do not put real credentials in the repository. Enter them only in the Devpost form, which is visible to judges.

### Local run

```bash
cd infra && npm install && cp .env.example .env.dev && ./deploy.sh up dev
cd ../tradewizard-frontend && npm install && cp .env.example .env.local && npm run dev
```

Full setup: [README.md](../README.md).

## Demo video

- Script: [docs/devpost-vo-script.md](devpost-vo-script.md)
- Metadata: [docs/youtube-description.md](youtube-description.md)
- Runtime target: 2:45, hard cap 3:00.
- Must show the app working end-to-end: market discovery → analysis → agent signals → deterministic decision (including a `NO_TRADE`) → Portfolio Manager and kill switch → Kiro panel.

## Bonus prize eligibility

| Bonus prize | Eligible? | Action |
|-------------|-----------|--------|
| Best Startup Project | Only if founder confirmation applies | Add LinkedIn and startup website |
| Best Student Project | Only if all members are students | Add LinkedIn, student email, year, degree, school |
| Best Ghost of Kiroween Past | Only if registered for Kiroween 2025 | Confirm registration |
| Best Kiro Crew App | No | No Crew artifacts in the repository |
| Social Blitz Prize | Optional | Post with `#KiroweenHackathon26` at the start; add URL |
| Bonus Blog Prize | Optional | Publish a public blog post mentioning Kiroween 2026; add URL |
| Best Demo | Automatic | All eligible submissions are considered |

## Pre-submit checklist

- [ ] Repository is public and the About section shows the MIT license
- [ ] `.kiro/` is present at the root and not gitignored
- [ ] No `.env`, secrets, `node_modules`, `.next`, or `cdk.out` committed
- [ ] Live app URL works in an incognito window
- [ ] Test credentials verified
- [ ] Demo video is public, under 3:00, and plays end-to-end
- [ ] Category set to Frankenstein
- [ ] Kiro write-up added to the form
- [ ] Bonus prize fields completed or intentionally skipped
- [ ] Devpost draft saved before the deadline
