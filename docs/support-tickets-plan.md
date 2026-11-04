# Customer Support Tickets — Design & Delivery Plan

**Status:** Shipped 2026-11-03 (slices 1-5). See §10 for live verification notes and the remaining console work.
**Audience:** whoever builds or operates the support feature (product + portal).
**Companion docs:** `docs/admin-portal-architecture.md` (binding for the admin
surface: routing, RBAC matrix, audit rules, UI primitives) and
`docs/admin-portal-runbook.md` (operating procedures).

> **How to use this document.** §1–2 are decisions and context: read them before
> proposing changes, because several look like omissions and are deliberate.
> §3–7 are the design. §8 is the execution order — one slice per PR, each with
> its own acceptance criteria. §10 is the live progress log; **update it in the
> same commit as the slice**, the way the admin architecture doc's §14.4 works.

---

## 1. What this is

Customers can reach the team from inside the product — on a market analysis, on a
Portfolio Manager session, or from a public help page if they are not signed in.
Requests become **tickets** with a context snapshot, a thread, and a status, so
support can answer once and both sides can see the same history.

It deliberately is not an email form. An email form fails the exact cases this is
for ("something is wrong with *this* analysis") because the context evaporates and
nobody knows whether the person was ever answered.

## 2. Decisions (agreed 2026-11-03)

| # | Decision | Consequence |
|---|---|---|
| 1 | **No inbound email in v1.** Replies happen in a tokenised thread page; emails link to it. | Emails omit `Reply-To`, and the copy never says "just reply to this email" — a customer reply would otherwise disappear into an unmonitored mailbox. |
| 2 | **Anonymous tickets link to an account silently** when the email matches `users.email`. | Support sees the account. The API response is identical either way, so it cannot be used to enumerate accounts. |
| 3 | **Portal-only queue.** No team notification email, no SNS topic, no `SUPPORT_INBOX`. | The admin Support inbox (and its nav badge) is the queue. Nothing pages anyone except someone opening the portal. |
| 4 | **No attachments in v1.** Text plus auto-captured context. | Adding screenshots later is a presigned-S3 slice; it is the most requested thing support will miss, so expect it. |
| 5 | **Topics:** `analysis`, `portfolio`, `billing`, `login`, `data`, `other`. | Fixed enum; adding one is a schema change plus a `CHECK` widening (idempotent, like other widening blocks in `001-schema.sql`). |
| 6 | **Sender `support@tradewizard.live` via Resend, no `Reply-To`.** | Follows decision 1. Deliverability must be proven with a real send before the form ships. |

**Open question:** should the `analyst` role read support tickets? Recommend
**no** — tickets carry customer PII and analyst is an intelligence role. All
support routes therefore use `minimumRole: 'support'`, and the nav item is hidden
from analysts. Reverse this only with a reason.

### 2.1 The unauthenticated / market-detail conflict

`middleware.ts` guards `/markets`, `/portfolio`, `/portfolio-manager`, `/account`,
`/insights`. A logged-out visitor is never **on** a market page — they are on
`/login?next=/markets/<slug>`. Making market pages public would expose paid
analysis output, so instead:

- the public entry point is `/help`, linked from the landing page and login;
- the login page's "Trouble signing in?" passes the blocked `next` path as
  context, so the ticket still says *"they were trying to reach /markets/x"*.

This is the agreed resolution (option A). Do not "fix" it by unprotecting market
pages as part of support work.

---

## 3. Data model (Aurora)

Appended to the single consolidated, idempotent `infra/sql/001-schema.sql`. No new
`NNN-*.sql` file — `deploy.sh` only runs that one.

```sql
support_tickets (
  id uuid pk default gen_random_uuid(),
  ref text not null unique,                     -- human handle, e.g. TW-4F2K9Q
  requester_email text not null,
  user_id uuid null references users(id) on delete cascade,
  topic text not null check (topic in ('analysis','portfolio','billing','login','data','other')),
  status text not null default 'open' check (status in ('open','pending','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  subject text not null,
  body text not null,                           -- first message; keeps the inbox list cheap
  context jsonb not null default '{}',
  context_hash text,                            -- dedupe key: sha256 of canonical context
  app_version text,
  request_id text,                              -- client idempotency key
  assigned_admin_sub text,
  assigned_at timestamptz,                      -- drives stale-assignment release
  confirmation_sent boolean not null default false,
  last_customer_notified_at timestamptz,        -- anti-burst for admin replies
  first_response_at timestamptz,
  last_message_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  access_token_hash text not null,
  access_token_expires_at timestamptz not null,
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE UNIQUE INDEX ... ON support_tickets (requester_email, request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX ... ON support_tickets (status, last_message_at DESC);
CREATE INDEX ... ON support_tickets (user_id, created_at DESC);
CREATE INDEX ... ON support_tickets (requester_email, created_at DESC);
CREATE INDEX ... ON support_tickets (requester_email, context_hash);

support_messages (
  id uuid pk default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_type text not null check (author_type in ('customer','admin','system')),
  author_user_id uuid null references users(id) on delete set null,
  author_admin_sub text,
  author_admin_email text,
  body text not null,
  is_internal boolean not null default false,   -- never emailed, never shown in the customer thread
  created_at timestamptz not null default now()
);
CREATE INDEX ... ON support_messages (ticket_id, created_at);
```

Notes
- `user_id ON DELETE CASCADE`: deleting an account must not leave its support
  history behind. Anonymous tickets (`user_id IS NULL`) are handled by retention.
- `context jsonb` is a snapshot, not a join. A ticket about an analysis must still
  read correctly after that analysis is pruned from S3.
- `ip_hash` is `sha256(salt + sourceIp)` with a stack-generated salt; raw IPs are
  never stored. It exists to correlate abuse, not to identify people.

## 4. API — `support-api` Lambda

New function on the **existing product REST API** (same CORS, same base URL, no
new origin). DB/VPC wiring mirrors `subscription-api` (`DB_SECRET_ARN`,
`DB_HOST`); rate limits reuse `incrementCounter()` in
`infra/services/shared/dynamo.ts` against `tw-{env}-rate-limits`.

| Route | Auth | Purpose |
|---|---|---|
| `POST /support/tickets` | **NONE** | submit; optional bearer links `user_id` |
| `GET /support/tickets/{ref}?t=<token>` | token **or** owner | customer thread |
| `POST /support/tickets/{ref}/messages` | token **or** owner | customer reply |
| `GET /support/tickets` | Cognito | "my tickets" |

### 4.1 Submit

```
POST /support/tickets
{ "email": "...", "topic": "analysis", "subject": "...", "body": "...",
  "context": { ... }, "requestId": "uuid" }
→ 201 { "ref": "TW-4F2K9Q", "emailSent": true }
```

- Validation (zod): email ≤254 and valid; subject 5–140; body 20–4000; topic in
  the enum; context size-capped (~4 KB) and whitelisted keys only.
- Limits: **3 tickets/hour per email**, **10/hour per IP**, plus a global ceiling
  on the counter used for the kill switch. Exceeding → 429 with `Retry-After`.
- `requestId` makes retries safe: the unique index returns the existing row and
  `ref` rather than creating a second ticket.
- Owner resolution: if a bearer token is present and valid, `user_id` is set via
  `getUserIdByCognitoSub()`. If the submitted email matches an account, `user_id`
  is also set — **silently** (decision 2).

### 4.2 Thread access

- On create, generate 32 random bytes; store `sha256` only; expire in 30 days.
- **Every email issues its own token** (`support_thread_tokens`), and any
  unexpired token opens the thread. Additive, not rotating: customers scroll back
  and click the first email they received, and that must still work.
- Customer URL: `https://tradewizard.live/help/t/{ref}?t=<token>`.
- Clicking the link proves mailbox ownership — **that click is the email
  verification.** There is no separate "verify your email" step and no account is
  created for an anonymous requester.
- Wrong / expired token → **404**, not 403. A 403 would confirm the ticket exists.
- A signed-in owner reads the same ticket without `?t=`; `/account/support` lists
  their tickets.

### 4.3 Context payload (whitelisted keys)

```json
{ "page": "/markets/will-x", "marketId": "...", "marketSlug": "...",
  "analysisId": "...", "sessionId": "...", "plan": "pro",
  "recommendation": "BUY_YES", "appVersion": "..." }
```

Server-side, ignore any key not on the list. The UI **shows** what is attached and
lets the user remove it — silent collection of account data is a trust problem.

### 4.4 Duplicate submissions and concurrent staff

Two different collisions, two different mechanisms.

**Same customer, same issue twice** — dedupe at submit:

- `context_hash = sha256(canonical JSON of the whitelisted context)`.
- If an `open`/`pending` ticket exists for the same `requester_email` +
  `context_hash` created in the last 10 minutes, return **200 with the existing
  `ref`** and `duplicate: true`. No second row, no second staffer.
- Canonicalisation sorts keys and drops volatile fields (`page`), so a reloaded
  page does not defeat it.

**Two staffers, same ticket** — claim is a lock, not a label:

```sql
UPDATE support_tickets
   SET assigned_admin_sub = $me, assigned_at = now()
 WHERE id = $id
   AND (assigned_admin_sub IS NULL OR assigned_admin_sub = $me)
RETURNING assigned_admin_sub;
```

- Zero rows → `409 ALREADY_CLAIMED` carrying the current assignee, so the UI can
  say "Ada took this 2 minutes ago" instead of doing nothing.
- **Reply is gated on ownership**: replying to someone else's ticket →
  `409 NOT_YOURS` with a "reassign to me" action. `admin`/`owner` may override,
  and the override is audited with a reason. (Slice 4. In Slice 1 there is no
  admin API yet, so nothing can claim.)
- The reply mutation runs in a transaction with `SELECT … FOR UPDATE` on the
  ticket row and re-reads the thread before sending, so two simultaneous replies
  serialise instead of both emailing.
- Claim-on-first-reply: an unassigned ticket is claimed by whoever answers it,
  in the same transaction.
- **Stale release**: a `support-housekeeping` Lambda (hourly, added in Slice 4)
  unassigns tickets with no activity for 8 hours, so a claimed ticket never
  becomes invisible work. The list shows "assigned to X · last activity 2h ago"
  before the job runs.
- Admin replies take a `requestId` too — a double-click sends one email.

## 5. Email (through `services/shared/email.ts`)

The rule: **email on customer-visible events, never on bookkeeping.** Anything
else trains people to ignore support mail.

| Event | Email? | Why |
|---|---|---|
| Ticket created | **Yes** | Proves receipt; for anonymous it is the only access to the thread |
| Admin public reply | **Yes** | The reply body itself, not "you have a message" |
| Ticket `resolved` | **Yes** | Short note + thread link + "reply to reopen" |
| `closed` | **Yes**, only if resolved more than a day earlier | Closes the loop without a second ping |
| Customer's own message | **No** | They just typed it |
| Internal note | **Never** | Never leaves the portal and never appears in the customer thread |
| Assignment / priority / topic change | **No** | Bookkeeping: one answer must not generate three emails |
| `pending` (waiting on customer) | **No** | The reply email already asked the question |

Rules
- From `support@tradewizard.live`; **no `Reply-To`** (decision 1).
- If the acknowledgement send fails, the **ticket still exists** with
  `confirmation_sent = false`; the API returns a retryable error so `requestId`
  prevents a duplicate, and the admin inbox flags the ticket.
- Admin reply email failure does not lose the message: the message is stored, the
  portal reports "delivery failed", and the admin can retry.
- **Anti-burst:** a second admin reply inside 60 seconds is stored but its email
  is suppressed (`last_customer_notified_at`), so fixing a typo does not send two
  emails. The composer says so.
- Support replies **ignore** `notification_preferences.channel_email = false`:
  they are transactional and customer-initiated, and for anonymous requesters
  email is the only channel. Do not "fix" this later.
- Do not add direct SES/Resend calls anywhere; everything goes through
  `shared/email.ts`.

## 6. Product surfaces

| Surface | Where | Context attached |
|---|---|---|
| Nav "Help" | `components/shell/AppNav.tsx` | current page |
| "Report a problem with this analysis" | `app/markets/[slug]/page.tsx`, beside the recommendation card | market + `analysisId` + recommendation + plan |
| "Get help with this session" | `app/portfolio-manager/page.tsx`, session header menu | `sessionId`, status, persona, market |
| Public `/help` | new page; linked from landing footer and login | `topic`/`from` query params |
| "Trouble signing in?" | `app/login/page.tsx` | the blocked `next` path |
| `/account/support` | new page | — (list of own tickets) |
| `/help/t/[ref]` | new page | tokenised thread |

One reusable `components/support/SupportDialog.tsx`; the context is rendered as
chips before submit.

## 7. Admin portal surfaces

New nav item **Support** (`constants/routes.ts`, `requires: "support"`, badge with
open/unanswered count).

| Route | Minimum role |
|---|---|
| `GET /admin/support/tickets` (filters + cursor) | support |
| `GET /admin/support/tickets/{id}` | support |
| `POST /admin/support/tickets/{id}/messages` | support |
| `PUT /admin/support/tickets/{id}` (status/priority/assignment) | support (assign: admin) |

- Ticket detail links context into existing pages: `/users/{id}`, `/markets`,
  `/analyses/{id}`, `/portfolio?session=…`.
- Replies are audited by authorship, **no reason prompt** (a reason field there
  would be theatre). Status, priority and assignment changes **require a reason
  ≥8 characters** and write `admin_audit_log` rows, like every other mutation.
- RBAC matrix entries in `services/admin-api/handler.test.ts` are mandatory — the
  suite fails without them (§17.1 of the admin architecture doc).
- Internal notes (`is_internal`) never email and never appear in the customer
  thread.
- Compose with the portal primitives (`Page`, `PageHeader`, `Panel`, `StatCard`,
  `Dialog`) per `docs/admin-portal-architecture.md`; no bespoke headers or overlays.

## 8. Delivery slices

One PR per slice. Do not start a slice before the previous one is live in dev.

### Slice 1 — Schema + `support-api`
Files: `infra/sql/001-schema.sql`, `infra/services/support-api/*`,
`infra/lib/compute-stack.ts`.

Acceptance
- Anonymous submit → 201; a registered email returns an identical response (no enumeration)
- 4th ticket/hour from one email → 429; 11th from one IP → 429
- Replayed `requestId` → same `ref`, one row
- Resubmitting the same context within 10 minutes → 200 with the same `ref`, one row
- Wrong token → 404; an expired token → 404
- Signed-in owner reads own ticket without `?t=`
- Email failure → ticket persists with `confirmation_sent = false`
- `npm run verify` green with new route tests

### Slice 2 — Public surfaces
Files: `app/help/page.tsx`, `app/help/t/[ref]/page.tsx`,
`app/account/support/page.tsx`, `components/support/*`, `lib/support-client.ts`,
login + landing links.

Acceptance
- Logged-out submit → acknowledgement email → thread opens → reply round-trips
- Expired token shows a clear recovery state (submit again / use last email link)
- Signed-in user sees the ticket in `/account/support` without a token
- `/help` is reachable while signed out (`middleware.ts` untouched)

### Slice 3 — Contextual entry points
Files: `components/shell/AppNav.tsx`, `app/markets/[slug]/page.tsx`,
`app/portfolio-manager/page.tsx`, `components/support/SupportDialog.tsx`.

Acceptance
- Market help carries `marketId` + `analysisId`; user saw the attached chips
- PM help carries `sessionId`, status, persona
- Login help carries the blocked `next` path
- Nav help carries only `page`

### Slice 4 — Admin Support inbox
Files: `infra/services/admin-api/routes/support.ts`, `queries/support.ts`,
`lib/router.ts`, `handler.test.ts`, `infra/services/support-housekeeping/handler.ts`
+ its hourly schedule, `tradewizard-admin/app/(app)/support/*`,
`hooks/useSupport.ts`, `components/support/*`, `constants/routes.ts`, both docs.

`support-housekeeping` does exactly two things: release assignments idle for more
than 8 hours, and close `resolved` tickets after 7 days. Both are single
`UPDATE … WHERE` statements, so a re-run is harmless.

Acceptance
- Analyst → 403 on every support route; support can read/reply/status; admin can assign
- Claiming twice → one 200 and one `409 ALREADY_CLAIMED` naming the current assignee
- Replying to someone else's ticket → `409 NOT_YOURS`; an admin override is audited
- Two simultaneous replies serialise (one email, both messages in the thread)
- A ticket idle for 8h is released by the hourly sweep; the list marks stale claims
- Status change without a reason → 400; with a reason → audit row in `/audit`
- Customer thread shows the reply, not the internal note
- Cursor pagination + filters behave like the other list pages

### Slice 5 — not scheduled
Screenshots/attachments (presigned S3), inbound email threading (SES receipt rule
on a reply subdomain, DNS/MX work), team notifications, CSAT, canned replies,
Turnstile if spam appears. Revisit after real volume.

## 9. Settings (each with a real consumer)

| Key | Consumer |
|---|---|
| `support_enabled` | `POST /support/tickets` returns 503; the dialog hides its form |
| `support_first_response_target_hours` | SLA chip and overdue filter in the admin list |

Read via `getSettingSync` from `services/shared/settings.ts`; both are declared in
the registry with a `consumer` field, per the existing pattern.

## 10. Progress log

Newest first. Update in the same commit as the work, and record anything that was
verified live (not just compiled).

| Date | Slice | State | Notes |
|---|---|---|---|
| 2026-11-03 | Admin context panel | Done | The Context panel now opens real artifacts instead of printing identifiers: the market links to `NEXT_PUBLIC_PRODUCT_BASE_URL/markets/{slug}` (the portal has no market detail page, and the slug comes from the ticket context with the recorded page path as fallback), the recorded page path is a link, and the analysis id opens a dialog with the decision/execution snapshot plus a link to the full record. `NEXT_PUBLIC_PRODUCT_BASE_URL` defaults to `https://tradewizard.live`, so dev needs `http://localhost:3000` (set in `.env.local`; `.env.prod` carries the prod value). Admin typecheck/lint/build clean. |
| 2026-11-03 | 5 — Additive links + production rollout | Done | Thread links moved from a single rotating hash to `support_thread_tokens`: each acknowledgement/reply issues a token, all unexpired tokens work, and housekeeping purges expired ones. The single-hash columns were backfilled then dropped, so exactly one source of truth remains (dev: 2 tokens backfilled for 2 existing tickets). Verified live on dev with two seeded links for one ticket — both `200`, expired `404` — then the seeds were deleted. **Production is live:** prod schema applied (support tables + token table), `TradeWizard-Prod-Compute`/`-Admin` deployed (diff was additive apart from the API deployment replacement), `tw-prod-support-api` reports `RESEND_FROM_EMAIL=support@tradewizard.live`, `tw-prod-support-housekeeping` active on `rate(1 hour)`. End-to-end prod submit created `TW-G3P69N` (`confirmation_sent`, 1 token), invalid input returned `422`, admin API without a token `401`; the test ticket was deleted. **Still outstanding (console work):** the prod admin portal is not hosted, so the prod inbox has no UI yet. |
| 2026-11-03 | 4 — Admin inbox + housekeeping | Done (dev) | Seven portal routes (summary, list, detail, claim, release, reply, update), all `minimumRole: support` and in the RBAC matrix. Claim is a conditional update; replies take `FOR UPDATE`, refuse another operator's ticket unless admin+, and claim on first reply. Reasons inbound; DB backed by `/admin/users/{id}` context (plan/status) and `analysisId` deep link. Replies emails via `shared/support-email.ts` (new shared module, acknowledgement moved there), rotate the thread token, suppress a second email inside 60s, and never email internal notes; resolving emails a linkless notice. `support-housekeeping` hourly releases claims idle 8h and closes tickets resolved 7 days ago — verified live (`released: 1` on a seeded stale claim). UI: `/support` + `/support/{id}`. `support_first_response_target_hours` added with the inbox as its only consumer (overdue flags). 488 infra tests; admin typecheck/lint/build clean. |
| 2026-11-03 | 3b — Attach to the verdict, not the page | Done | The masthead link was the wrong place: people complain about the **verdict**, not the page chrome. Removed it and added `AnalysisSupportButton`, reused in two analysis surfaces — the AI verdict footer and each expanded run in the Track record. Both attach market + `analysisId` + recommendation, and the track-record variant attaches that specific run rather than the latest. The insights feed is the obvious third surface; deferred until the card layout is touched for another reason. Typecheck/lint clean, scratch build compiled. |
| 2026-11-03 | 3a — Identity, not a form field | Done | A signed-in requester was still asked for an email, and the market/PM dialogs did not even prefill it. The field is now hidden whenever an account is present (`lockedEmail`), and the API prefers the **verified token email** over the posted one, so a typo cannot file a ticket under an address the customer cannot open. Anonymous submissions are unchanged (`/help` still asks, because it must). New test: a bearer with `Account@Example.com` overrides `typo@example.com`. 22 support tests; compute stack redeployed. |
| 2026-11-03 | 3 — Contextual entry points | Done | `SupportDialog` wraps the slice-2 form in the product `Modal` (mobile bottom sheet, scroll-capped). Entry points: nav help icon on desktop and tablet plus a mobile menu item (context = `page` only); market masthead "Something wrong with this analysis?" (market id uses `conditionId \|\| id`, the identifier the pipeline stores, plus `analysisId`, recommendation, plan); Portfolio Manager "Get help" on every session card (session id, status, persona, market) — note it now renders for completed/terminated sessions too, which is exactly when people ask. Context is shown as chips before sending. Verified: typecheck, lint (no new warnings), production build compiled in a scratch copy. The product dev server (3000) was down after a restart, so the in-browser click-through is still outstanding. |
| 2026-11-03 | 2 — Public surfaces | Done (dev) | `/help` (public form, `?topic=` + `?from=` context), `/help/t/{ref}` (tokenised thread, reply, closed/expired states), `/account/support` (own tickets, bearer access, no token needed). Entry points added: login page "Trouble signing in?" carrying the blocked `next` path, landing footer, account page card. `HelpShell` is deliberately not `AppShell` so a signed-out visitor is not shown product navigation; `/help` is `noindex`. The thread page surfaces the three honest failure states: invalid/expired link, network error, closed ticket. **Not yet browser-verified** — API round trip was proven in slice 1; pages compile, build as static/dynamic routes and return 200 while signed out (`/account/support` redirects to login, as intended). `components/support/SupportForm.tsx` is the form slice 3's dialog will wrap. |
| 2026-11-03 | 1 — Schema + `support-api` | Done (dev) | Tables `support_tickets` / `support_messages` applied to dev; new `support-api` Lambda on the product REST API with `POST /support/tickets` (NONE), `GET /support/tickets` (Cognito), `GET /support/tickets/{ref}` and `POST …/messages` (token or owner, verified in-Lambda). Verified live: submit `201` with `confirmation_sent = true`; thread `200` with the token; wrong token `404`; reply `201` then replay `200` with the same message id; unauthenticated list `401`; `support_enabled=false` → `503` (then reverted); 4th submit in an hour → `429`. Acknowledgement accepted by Resend from `support@tradewizard.live` (delivery to an inbox not confirmed). 451 infra tests. Test rows deleted after verification. |
| 2026-11-03 | Plan | Revised | Added §4.4 (duplicate submission + staff concurrency: atomic claim, reply ownership, `FOR UPDATE`, 8h stale release) and replaced §5's email table with the full notification matrix (bookkeeping changes and internal notes never email; anti-burst; support mail ignores quiet-hours prefs). Schema gained `context_hash`, `assigned_at`, `last_customer_notified_at`. |
| 2026-11-03 | Plan | Agreed | Decisions 1–6 recorded above. No code written yet. |

## 11. Risks

1. **Deliverability of `support@tradewizard.live`** — prove with a real send to a
   Gmail/Outlook address before slice 2 ships. Resend is the provider; the domain
   is already verified for sending.
2. **Spam on the anonymous endpoint** — rate limits plus the `support_enabled`
   valve are the whole defence in v1. If it is hit, add Turnstile rather than
   tightening limits for real users.
3. **Token in a URL** — visible in browser history and any referrer. The thread
   route must send `Referrer-Policy: no-referrer`; 30-day expiry; rotation on
   request.
4. **Email-only recovery for anonymous users** — if the acknowledgement is lost,
   they can only resubmit (subject to limits) or use the last link. Expect this
   to be the top support-of-support issue; the resend path is deliberately capped.

## 12. Non-goals

- Live chat / presence.
- Making market pages public.
- A second notification system: support emails go through the existing sender, and
  the portal inbox is the queue (decision 3).
- Creating customer accounts from a support ticket (the portal invite flow already
  covers admin accounts).
