# TradeWizard Operations Portal - Kiroween 2026 Demo Script

**Target runtime:** 2:45 · **Hard cap:** 3:00
**Category:** Frankenstein
**Subject:** the Operations Portal, not the platform it operates.

The video should feel like an incident console, not a marketing site. Open on the portal, show real controls, and let the product appear only as the thing being operated.

---

## Shot list

| Time | On screen | Action |
|------|-----------|--------|
| 0:00 | `admin.tradewizard.live` login | Hold on the “Operations portal” copy. Lower third: **TradeWizard Operations Portal**. |
| 0:08 | Sign-in | Email → password → TOTP. Show the error path for a protected action without a fresh token, then recover. |
| 0:20 | Overview | Metrics: signups, analyses, revenue, active PM sessions, realized P&L, error trend. |
| 0:32 | Users | Search a user; show credits, analyses, sessions, payments, notes, plan, status. |
| 0:45 | Analyses | Open an analysis; show quality, no-trade reason, payload, then requeue/refund controls. |
| 1:00 | Portfolio | Open a live session; show trades, decisions, P&L. |
| 1:10 | Kill switch | Show the confirmation, the synchronous halt, and the asynchronous exit result. Do not execute unless using a demo account. |
| 1:25 | Settings | Show a runtime setting with its named consumer, change it with a reason, then show the audit row. |
| 1:40 | Support | Open a ticket; show context snapshot, claim, reply, internal note. |
| 1:55 | Newsletter | Compose from a template, preview, show subscriber/suppression list. |
| 2:10 | Audit + roles | Show the append-only log; switch to an analyst view and show mutations disappear. |
| 2:25 | PWA + Kiro | Show the install prompt, then the two portal specs, steering, and hooks. |
| 2:45 | End card | Portal URL + repo URL. |

---

## Full version (≈ 2:45)

This is TradeWizard: a live prediction-market platform with fourteen AI agents, autonomous execution, on-chain billing, support, and a newsletter.

But a live trading system is only as safe as the people operating it. This is the product built to do that: the TradeWizard Operations Portal.

A separate internal Next.js app with its own API, identity, audit trail, and deployment. Sign-in is Cognito email, password, and TOTP on a dedicated admin client. Four roles - analyst, support, admin, owner - are enforced by the API on every request. Hiding a button is not the security boundary.

The overview shows signups, analyses, revenue, active sessions, realized P&L, and error trend. Users gives support credits, analyses, sessions, payments, notes, plan, and status without a database session.

Analyses shows the full payload, no-trade reason, live-versus-shadow performance, and controls to invalidate a cache, refund every recipient, or requeue a market. Requeue clears the in-flight state atomically, so a concurrent request cannot create a duplicate run.

Portfolio shows sessions, trades, decisions, and P&L. The kill switch is per-user and two-phase: a synchronous halt stops new entries before the response, then an asynchronous exit. If the exit fails, the halt remains and the response says so. The safe direction is stopping.

Settings is runtime configuration. Every switch names its consumer: pause analysis, edit the maintenance message, override the AI provider, or pause new Portfolio Manager activations. Changes are owner-only, fresh-auth, reason-required, and audited.

Support is the customer queue: tickets carry the analysis or session context, a tokenised thread, and an honest SLA. Newsletter adds typed templates, production preview, owner-only send, subscriber suppression, and signed bounce webhooks.

Underneath it all, the audit log: every mutation writes an append-only row before the side effect, with who, what, why, before, after, and request id. Triggers reject edits and deletes.

The PWA caches only content-hashed assets - never a navigation, API data, or a presigned payload - so a shared machine cannot show the previous operator's shell.

We built it from two Kiro specs: foundation and operations. Four steering documents constrain the work, and hooks typecheck the admin app and guard the deterministic analysis stages it can touch.

The platform is the product. This is the control plane. Two Kiro specs, one audited portal - built to let a team operate a live trading system without guessing.

---

## Short version (≈ 75s)

TradeWizard is a live prediction-market platform. This is the product built to operate it: the TradeWizard Operations Portal.

A separate internal Next.js app with Cognito email, password, and TOTP; four roles enforced by the API; and an append-only audit row before every mutation.

Operators get users, analyses, portfolio sessions, billing, agents, queues, and markets. They can run a fail-closed per-user kill switch, pause or terminate a session, grant credits, requeue an analysis, change audited runtime settings, answer support tickets, and send the newsletter.

Every switch names the service that reads it. Every destructive action requires a reason and a fresh token. The PWA caches only static assets, never a previous operator's shell.

Two Kiro specs, foundation and operations, define the whole control plane.

The platform is the product. This is the control plane.
