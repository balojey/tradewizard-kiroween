# Devpost Form Pack - Kiroween 2026

Copy-paste fields for the Devpost submission form. Replace every `TODO` before submitting.

---

## Project name

**TradeWizard Warden**

## Elevator pitch (≤ 200 characters)

The audited control plane for a live AI prediction-market platform: four-role RBAC, hash-chained audit, a read-only AI copilot with citations, kill switch, runtime settings, support, and newsletter. Built with Kiro.

## Category

**Frankenstein**

## Links

| Field | Value |
|-------|-------|
| Public GitHub repository | https://github.com/balojey/tradewizard-kiroween |
| Live app URL | https://admin.tradewizard.live |
| Demo video (YouTube, public) | `TODO: https://youtu.be/...` |
| Blog post (optional bonus) | `TODO` |
| Social post (optional bonus) | `TODO` |

## Short description

TradeWizard is a live prediction-market platform: fourteen AI agents, a deterministic analysis pipeline, an autonomous Portfolio Manager, on-chain billing, support, and a newsletter. Operating that from the AWS console is unsafe and slow.

The TradeWizard Warden is the separate internal product built to operate it. A Next.js 16 app with its own admin API, Cognito identity, four-role RBAC, and a hash-chained audit trail. Every mutation requires a reason and writes a hash-chained audit row before the side effect; the portal verifies the chain and names the first broken row. Operators can inspect users, analyses, portfolio sessions, billing, agents, queues, and markets; run a fail-closed per-user kill switch; pause or terminate sessions; grant credits and plan overrides; requeue or refund analyses; change audited runtime settings; handle support tickets; and compose the newsletter. A read-only AI copilot, Ask Warden, answers operational questions with citations to the exact audit row, ticket, analysis, or session — and every suggestion is a link, never an action. Access is built for separation too: Warden-only `+warden` aliases, revocable role-carrying invite links, and live Cognito group checks on every request.

The portal never holds wallet keys, signs transactions, or calls the CLOB. It is a control surface, not a second business-logic layer.

## Full description

Paste `docs/devpost-submission.md` into the Devpost description field. It follows Devpost’s section order, contains absolute GitHub links, and is under the 5,000-word limit. The internal category write-up is [docs/kiroween-submission.md](kiroween-submission.md).

## How we used Kiro

Use [docs/kiro-usage.md](kiro-usage.md) for the full write-up. The short version:

- **Specs.** The portal is specified and documented by four specs: `admin-portal-foundation` (package isolation, auth/MFA, RBAC, audit spine, admin API, read surfaces, shell), `admin-portal-operations` (mutation envelope, kill switch, session controls, membership, settings, support, newsletter), `audit-chain-integrity` (hash chain, completion hash, backfill, verification, audit UI), and `admin-copilot` (read-only retrieval, citations, role scoping, no execution path). Each has requirements, a design, and an ordered task list.
- **Steering.** Four documents under `.kiro/steering/` encode the product model, package boundaries, technical invariants, and submission rules. The most important rule is negative: deterministic analysis stages contain no model calls.
- **Agent hooks.** Five hooks, including `admin-typecheck` for the portal, `analysis-gate-guard` for changes that reach into the analysis pipeline, and `spec-task-followthrough` to close tasks and reconcile docs.
- **MCP.** `.kiro/settings/mcp.json` connects the agent to Magic Link and Polymarket documentation so auth and market contracts are verified, not recalled.
- **Property-based testing.** `fast-check` covers the authorization invariants: role ranking, group resolution, `requireRole` across every role pair, the fresh-auth window, and bearer extraction.
- **Honest scope.** We do not claim Kiro Crew, CLI, Web, powers, or custom agents; the repository does not contain evidence for them.

## Built with

Kiro, TypeScript, Next.js 16, React 19, Tailwind CSS 4, TanStack Query, Amazon Cognito, API Gateway, AWS Lambda, Amazon RDS for PostgreSQL, Amazon DynamoDB, Amazon S3, Amazon EventBridge, Amazon SNS, Amazon CloudWatch, AWS Secrets Manager, AWS IAM, AWS Amplify Hosting, AWS CDK, Zod, Vitest, Remotion.

Platform context: Amazon Bedrock, Strands Agents SDK, Polymarket CLOB and Gamma APIs, viem, Safe, USDC.e on Polygon, Resend, NewsData.io, Serper.

## Try it out

### Judge instructions

1. Open https://admin.tradewizard.live.
2. Sign in with the test account below. The portal uses email + password + TOTP; the demo account’s TOTP is provided with the credentials.
3. Start at **Overview**, then open **Users** and search for the demo customer.
4. Open **Analyses** to inspect a result, its quality panel, and the payload viewer.
5. Open **Portfolio** to see a session, its decisions, and the kill-switch control.
6. Open **Settings** to see runtime settings with their named consumers.
7. Open **Audit** to see the hash-chained record of every mutation; click **Verify chain** and show the verified/broken badge.
8. Open **Ask Warden** on the Audit or Support page and ask “What changed in the last hour?” or “Summarize this ticket.” Show the citations and the read-only notice.

### Test credentials

```
Email: TODO
Password: TODO
TOTP secret / current code: TODO
Demo role: TODO (owner recommended, so Settings and Members are visible)
```

Do not put real credentials in the repository. Enter them only in the Devpost form, which is visible to judges.

### Local run

```bash
cd infra && npm install && cp .env.example .env.dev && ./deploy.sh up dev
cd ../tradewizard-admin && npm install && cp .env.example .env.local && npm run dev
```

The portal runs at `http://localhost:3001`. Full setup: [README.md](../README.md).

## Demo video

- Script: [docs/devpost-vo-script.md](devpost-vo-script.md)
- Metadata: [docs/youtube-description.md](youtube-description.md)
- Runtime target: 2:45, hard cap 3:00.
- Show the portal at `https://admin.tradewizard.live`: login/MFA → overview → users → analyses → session and kill switch → settings and audit (Verify chain) → support → Ask Warden with citations → newsletter → Kiro specs and hooks.
- Mention the platform at `https://tradewizard.live` only as the system the portal operates. Do not present the platform as the new build.

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
- [ ] Operations portal URL works in an incognito window
- [ ] Test credentials and TOTP verified
- [ ] Demo video is public, under 3:00, and shows the portal end-to-end
- [ ] Description pasted from `docs/devpost-submission.md` (under the 5,000-word limit)
- [ ] Category set to Frankenstein
- [ ] Kiro write-up added to the form
- [ ] Bonus prize fields completed or intentionally skipped
- [ ] Devpost draft saved before the deadline
