# TradeWizard Warden - Kiroween 2026 Demo Script

**Target runtime:** 2:50 · **Hard cap:** 3:00
**Category:** Frankenstein
**Subject:** Warden, not the platform it operates.

The video should feel like an incident console, not a marketing site. But it must open by earning the context: a judge who has never seen a prediction market needs fifteen seconds of plain language before the portal makes sense. Show the platform only as the thing being operated, then spend the rest of the time on Warden.

---

## Shot list

| Time | On screen | Action |
|------|-----------|--------|
| 0:00 | `tradewizard.live/markets` | Plain-language setup: a yes/no question, shares priced 0-100 cents, $1 payout. Lower third: **TradeWizard**. |
| 0:08 | `tradewizard.live/insights`, then `/portfolio-manager` | Fourteen agents → one probability → recommendation or NO_TRADE; Portfolio Manager trades inside a user-approved budget. |
| 0:18 | `warden.tradewizard.live` login | Problem beat: operating that from the console. Lower third: **TradeWizard Warden**. |
| 0:24 | Sign-in | Email → password → TOTP. Show the error path for a protected action without a fresh token, then recover. |
| 0:32 | Overview | Metrics: signups, analyses, revenue, active PM sessions, realized P&L, error trend. |
| 0:42 | Users | Search a user; show credits, analyses, sessions, payments, notes, plan, status. |
| 0:53 | Analyses | Open an analysis; show quality, no-trade reason, payload, then requeue/refund controls. |
| 1:05 | Portfolio | Open a live session; show trades, decisions, P&L. |
| 1:15 | Kill switch | Show the confirmation, the synchronous halt, and the asynchronous exit result. Use the seeded demo account, which holds no position. |
| 1:29 | Settings | Show a runtime setting with its named consumer, change it with a reason, then show the audit row. |
| 1:42 | Support | Open a ticket; show context snapshot, claim, reply, internal note. |
| 1:53 | Ask Warden | Ask “What changed in the last hour?” or “Summarize this ticket”; show the answer, citations, and read-only notice. |
| 2:05 | Members / Invite links | Show a role-carrying link, the `+warden` alias, the use cap/expiry, and a live group check. |
| 2:15 | Hash-chained audit + roles | Show the audit log; click **Verify chain**; then switch to an analyst view and show mutations disappear. |
| 2:29 | PWA + Kiro | Show the install prompt, then the four portal specs, steering, and hooks. |
| 2:44 | End card | Portal URL + repo URL. |

---

## Full version (≈ 2:50)

Prediction markets let people trade yes-or-no questions. Will the Fed cut rates in December? A share costs between one and ninety-nine cents and pays a dollar if you are right, so the price is the crowd's probability.

TradeWizard is a live product built on Polymarket. Fourteen AI agents read the news, the polling, and the order book. A deterministic pipeline turns that into one probability, compares it with the price, and either recommends a trade or says no trade. Users pay credits for those analyses; a Portfolio Manager can trade inside a budget they approve.

Real customers, real balances, real orders. That is the system being operated. This is the product built to operate it: the TradeWizard Warden.

A separate internal Next.js app with its own API, identity, audit trail, and deployment. Sign-in is Cognito email, password, and TOTP. Accounts live on `+warden` aliases, access is a role-carrying invite link, and the API reads live group membership on every request. Four roles - analyst, support, administrator, owner - are enforced by the API.

The overview is the operational pulse. Users covers credits, analyses, sessions, payments, notes, plan, and status.

An analysis shows the payload, why it said no trade, and how the live call compared with the shadow one.

Portfolio shows sessions, trades, decisions, and P&L. This demo session holds no position, which is what makes the next beat safe. The kill switch is per user: a synchronous halt stops new entries, then an asynchronous exit unwinds positions.

Settings is runtime configuration; every switch names its consumer. Changes are owner-only, fresh-auth, reason-required, and audited.

Support tickets carry the analysis or session context, a tokenised thread, and an SLA. Ask Warden answers incident and support questions with citations; every suggestion is a link, never an action. Members adds role-carrying invite links and `+warden` aliases.

The audit log is hash-chained: every mutation writes a row before the side effect, with who, what, why, before, after, and request id. The portal verifies the chain and names the first broken row.

The PWA caches only static assets, never a previous operator's shell on a shared machine.

We built it from four Kiro specs: foundation, operations, audit chain, and copilot. Four steering documents constrain the work, and hooks typecheck the Warden app and guard the analysis gates.

The platform is the product. This is the control plane. Four Kiro specs, one audited portal - built to let a team operate a live trading system without guessing.

---

## Short version (≈ 85s)

Prediction markets let people trade yes-or-no questions; the share price is the crowd's probability. TradeWizard is a live product on Polymarket: fourteen AI agents estimate that probability, and a Portfolio Manager can trade inside a budget the user approves.

This is the product built to operate it: TradeWizard Warden.

A separate internal Next.js app with Cognito email, password, and TOTP; four roles enforced by the API; and a hash-chained audit row before every mutation. Access is a role-carrying invite link, and every Warden account lives on a `+warden` alias.

Operators get users, analyses, portfolio sessions, billing, agents, queues, and markets. They can run a fail-closed per-user kill switch, pause or terminate a session, grant credits, requeue an analysis, change audited runtime settings, answer support tickets, and send the newsletter.

Ask Warden answers incident and support questions with citations to the exact record, and every suggestion is a link, never an action.

Every switch names the service that reads it. Every destructive action requires a reason and a fresh token. The PWA caches only static assets, never a previous operator's shell.

Four Kiro specs, foundation, operations, audit chain, and copilot, define the whole control plane.

The platform is the product. This is the control plane.
