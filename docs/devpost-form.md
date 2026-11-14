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
| Live app URL | https://warden.tradewizard.live |
| Judge invite link | `TODO: https://warden.tradewizard.live/join#t=...` (owner/admin, 1–25 uses, short expiry, revoke after judging) |
| Demo video (YouTube, public) | `TODO: https://youtu.be/...` |
| Blog post (optional bonus) | `TODO` |
| Social post (optional bonus) | `TODO` |

## Short description

TradeWizard is a live prediction-market platform: fourteen AI agents, a deterministic analysis pipeline, an autonomous Portfolio Manager, on-chain billing, support, and a newsletter. Operating that from the AWS console is unsafe and slow.

For readers new to the space: a prediction market is an exchange on a yes/no question. Shares trade between 0 and 100 cents and pay $1 if correct, so the price reads as a probability. TradeWizard runs on Polymarket, where orders are matched on the central limit order book and settled in USDC on Polygon. Its customers buy analyses with credits, and can let a Portfolio Manager trade inside a budget they approve — with real orders and real money.

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

**Primary access is the invite link above.** It is a role-carrying Warden link; no shared password is needed.

1. Open the judge invite link from this form. It lands on `https://warden.tradewizard.live/join#t=…`.
2. Enter an email address you can access. The page shows the exact `+warden` address you will sign in with.
3. Check that inbox for the one-time password from Resend.
4. Sign in with the `+warden` address, choose your own password, then enrol an authenticator (TOTP).
5. The portal opens with the role carried by the link. Start at **Overview**, then open **Users** and search for the demo customer.
6. Open **Analyses** to inspect a result, its quality panel, and the payload viewer.
7. Open **Portfolio** to see a session, its decisions, and the kill-switch control.
8. Open **Settings** to see runtime settings with their named consumers.
9. Open **Audit** to see the hash-chained record of every mutation; click **Verify chain** and show the verified/broken badge.
10. Open **Ask Warden** on the Audit or Support page and ask “What changed in the last hour?” or “Summarize this ticket.” Show the citations and the read-only notice.
11. Open **Members** to see role-carrying invite links, `+warden` aliases, and live access controls.

The link is capped and expiring. Revoke it after judging. If an invite fails, mint a fresh link rather than sharing a password.

### Access notes

- Use a dedicated **owner** or **admin** link for judges; owner is required to see Settings and Members.
- Keep the lifetime short and the use count small. The link is a bearer credential.
- The invitee still chooses a password and enrols TOTP on first sign-in. That is the product’s normal access flow, not extra setup.
- Do not put the invite token in the repository. Put it only in the Devpost form, which is visible to judges.
- Revoke the link from **Members → Invite links** after judging.

### Local run

```bash
cd infra && npm install && cp .env.example .env.dev && ./deploy.sh up dev
cd ../tradewizard-admin && npm install && cp .env.example .env.local && npm run dev
```

The portal runs at `http://localhost:3001`. Full setup: [README.md](../README.md).

## Demo video

- Script: [docs/devpost-vo-script.md](devpost-vo-script.md)
- Description (plain text, paste into YouTube): [docs/youtube-description.txt](youtube-description.txt)
- Thumbnail: [docs/warden-thumbnail.png](warden-thumbnail.png) (1280×720, 100 KB; regenerate with `python3 docs/warden-thumbnail.py`)
- Runtime target: 2:50, hard cap 3:00.
- Title: `TradeWizard Warden - The Audited Control Plane + Read-Only AI Copilot | Kiroween 2026` (85 chars, under YouTube's 100).
- Show the platform in ten seconds, then the portal at `https://warden.tradewizard.live`: market and analysis → login/MFA → overview → users → analyses → session and kill switch → settings and audit (Verify chain) → support → Ask Warden with citations → Members and invite links → newsletter → Kiro specs and hooks.
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
- [ ] Judge invite link created (owner/admin, short expiry, small use cap) and tested end-to-end, including first-sign-in TOTP
- [ ] Judge invite link revoked after judging
- [ ] Demo video is public, under 3:00, and shows the portal end-to-end
- [ ] Description pasted from `docs/devpost-submission.md` (under the 5,000-word limit)
- [ ] Category set to Frankenstein
- [ ] Kiro write-up added to the form
- [ ] Bonus prize fields completed or intentionally skipped
- [ ] Devpost draft saved before the deadline
