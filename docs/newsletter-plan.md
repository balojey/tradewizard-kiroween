# Newsletter — Design & Delivery Plan

**Status:** Phase 4 shipped (dev) 2026-11-04. Phase 5 is unscheduled. See §13 for live verification notes.
**Audience:** whoever builds or operates the newsletter.
**Companion docs:** `docs/support-tickets-plan.md` (same slice/progress pattern),
`docs/admin-portal-architecture.md` (portal routing, RBAC, audit).

> Decisions in §2 are deliberate. The one that will be challenged first is
> §2.1 (no pre-checked consent); read why before "improving" conversion.

---

## 1. What this is

An opt-in editorial email — "The Weekly Brief" — sent from the portal in batches,
with per-recipient idempotency, one-click unsubscribe, and a design that survives
Outlook and blocked images. It is **marketing mail**, deliberately separated from
transactional email so a complaint cannot throttle login/receipt mail.

## 2. Decisions

| # | Decision | Consequence |
|---|---|---|
| 1 | **Explicit consent only.** One-time post-sign-in prompt + account toggle. No pre-checked boxes, no login-page checkbox. | The list starts near empty. Pre-checked consent is invalid in the EU/UK (*Planet49*) and would also re-subscribe people who unsubscribed. |
| 2 | **Templates + typed fields**, not raw HTML or a block editor. | New layout = deploy. Content is zod-validated, so unrenderable content is impossible. |
| 3 | **`news@tradewizard.live`**, display "TradeWizard Weekly". | Sender reputation isolated from `notifications@`. |
| 4 | **Delivery-only truth in v1.** No open pixels. | Bounce/complaint suppression via webhook in Phase 4. Privacy is a feature. |
| 5 | **Account-only subscribers in v1.** | No public signup until it ships with double opt-in (Phase 5). |
| 6 | **Owner-only send**, fresh auth + reason + idempotency. | Drafting is admin; sending is a privileged act. |

## 3. Consent model

`none → subscribed (confirmed_at) → unsubscribed (unsubscribed_at)`.

- One-time prompt after first sign-in: **"The Weekly Brief"** with *Yes, send it* /
  *No thanks*. Either answer sets `users.newsletter_prompted_at`; it never nags.
- Never shown when a subscriber row exists — an unsubscribed user must not be
  re-asked by a modal they might misclick.
- The prompt is affirmative: one click, recorded with `source`, `consent_version`,
  `ip_hash`, `user_agent`, `confirmed_at`.
- `/account` holds the durable toggle, separate from alert preferences.
- Suppression is a harder state than unsubscribed (bounce/complaint/manual) and is
  checked at send time, not just at snapshot time.

## 4. Data model

```
newsletter_subscribers   email unique · user_id → users on delete cascade
                         status · source · consent_version · ip_hash · user_agent
                         confirmed_at · unsubscribed_at
newsletter_suppressions  email unique · reason (unsubscribed|bounced|complained|manual)
newsletter_campaigns     slug · subject · preheader · template · content jsonb
                         audience jsonb · status · scheduled/started/sent timestamps
                         created_by · approved_by · recipient/sent/failed counts
newsletter_deliveries    campaign_id + email unique · status · provider_message_id
                         error · attempts · sent_at
users.newsletter_prompted_at
```

`unique (campaign_id, email)` is the double-send guard. Audience is snapshotted
into deliveries when sending starts; an unsubscribe flips remaining queued rows
to `skipped`.

## 5. API

**Product / public**

| Route | Auth | Purpose |
|---|---|---|
| `GET /user/newsletter` | Cognito | status + `promptedAt` |
| `POST /user/newsletter` | Cognito | `{optIn, source}` upsert consent |
| `POST /user/newsletter/dismiss` | Cognito | mark prompted without subscribing |
| `GET /newsletter/unsubscribe?token=` | none | token validity for the page |
| `POST /newsletter/unsubscribe` | none | RFC 8058 one-click; idempotent |

**Admin** (Phase 2): campaigns CRUD, preview, test send, owner-only send/cancel,
subscriber list, suppression — all audited, RBAC matrix entries mandatory.

Unsubscribe tokens are HMAC-SHA256 over `email + version` with a Secrets Manager
pepper; no DB row is needed to validate, so old emails keep working.

## 6. Send pipeline (Phase 2)

1. Claim campaign (`draft → sending`) so a retry is a no-op.
2. Snapshot subscribers into deliveries, excluding unsubscribed and suppressed.
3. Render **per recipient** (name + unsubscribe token), so preview and send share
   one renderer.
4. Batch 100 per Resend call, `FOR UPDATE SKIP LOCKED`, paced under the account
   rate limit, idempotency key per recipient.
5. Continue via SQS when rows remain; never die on the Lambda timeout.
6. Abort when failures exceed 5% (minimum 5) — a broken template must not burn the
   list.
7. Mark `sent`, reconcile counts.

## 7. Authoring & design

React Email templates (`market_brief`, `product_update`, `milestone`) with
zod-validated content, rendered by the same module for preview/test/send.

Design language: dark charcoal canvas, warm off-white type, one accent rule,
serif headlines with system fallbacks, tabular monospace probabilities, market
cards with probability rails. 600px table layout, inline CSS, dark-mode-safe,
**readable with images blocked**, plain-text alternative generated from content.

Composer nicety (Phase 2): "Fill picks from this week's analyses".

## 8. Surfaces

- Portal: Newsletter nav (admin), campaigns list, composer with preview iframe +
  audience count + test send, send dialog with reason + fresh auth, progress,
  subscriber list. All audited.
- Product: `/account` toggle, one-time post-sign-in prompt, public `/unsubscribe`,
  landing footer link once public signup exists.

## 9. Compliance & security

`List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` on every
message; footer with why-receiving, address and unsubscribe; suppression checked
at send; public endpoints rate-limited; tokens constant-time compared; owner-only
send with idempotency; no tracking pixels in v1.

## 10. Settings

| Key | Consumer |
|---|---|
| `newsletter_enabled` | product prompt + subscribe endpoints return 409/disabled |

## 11. Slices

| Phase | Scope | Acceptance |
|---|---|---|
| **1** | Schema, account toggle, one-time prompt, HMAC unsubscribe + page | Prompt once; toggle persists; old-email unsubscribe works and is idempotent; unsubscribed excluded from counts |
| **2** | Campaign engine, `market_brief`, preview/test/send, progress UI, audit | Test arrives; send reaches exactly the confirmed list; double send refused; unsubscribe mid-send skips remaining; counts reconcile; >5% failure pauses |
| **3** | Editorial design, second template, plain text, web view | Gmail/Outlook/Apple Mail checked with images blocked |
| **4** | Svix-verified Resend webhook → bounce/complaint suppression | A complaint suppresses the address permanently |
| **5** | Public signup (double opt-in), scheduling, segments, block editor, A/B | — |

## 12. Risks

1. Domain reputation with a tiny list — one complaint is measurably large.
2. Outlook: no dark mode, square buttons; text-first absorbs it.
3. Resend batch limits — batching, pacing, idempotency or retries duplicate mail.
4. Consent wording must be unambiguous; the record captures version and source.
5. Prompt fatigue — once, and never for someone who already decided.

## 13. Progress log

| Date | Phase | State | Notes |
|---|---|---|---|
| 2026-11-04 | Plan | Agreed | Consent is the one-time prompt, not a pre-checked login box (see §2.1). Sender `news@`, delivery-only truth, owner-only send. |
| 2026-11-04 | Subscriber list | Done (dev) | Portal `/newsletter/subscribers`: email, status, source, join date, account link and suppression reason, with status/search filters and cursor pagination; header counts subscribed / unsubscribed / suppressed. Backed by `GET /admin/newsletter/subscribers` (admin) and an extended summary endpoint. This is the visibility needed before the first prod send — suppression is only useful if you can see it. |
| 2026-11-04 | 4 — Delivery truth | Done (dev) | `POST /newsletter/webhook/resend` verifies the Svix signature over the **raw body** before parsing (HMAC-SHA256, 5-minute timestamp window, constant-time compare, multiple signatures supported) — a forged request here could suppress any address. Permanent bounces and complaints mark the delivery and write a suppression; transient bounces mark the delivery only; opens/clicks are acknowledged and ignored (no tracking by decision). Signing secret lives in `tw-{env}-resend-webhook-secret`; the Lambda fails closed when it is unset. Verified live: unsigned `401`, signed permanent bounce `200 {handled:'bounced', permanent:true, updated:1}`, delivery `bounced` with the provider's message, suppression row created; test rows removed. 22 newsletter tests, 553 infra tests in total. **Manual step:** register the endpoint in Resend with that secret. |
| 2026-11-04 | 3 — Second template + web view | Done (dev) | `product_update` template (headline, intro, 1–3 sections with optional CTA), selectable in the composer; switching templates seeds a matching starter rather than leaving invalid content. Public web view: campaigns get an unambiguous `slug`, the email footer links `/newsletter/{slug}`, the API renders the published issue from the **same renderer** with a generic greeting and a preferences link, and the product page embeds it in a sandboxed iframe. Only `sent`/`sending` campaigns resolve, so a draft cannot be read by guessing. Verified live: both templates render (8.2KB / 5.8KB HTML, plain text present), sender delivered a `product_update` issue (`failures: 0`), published web view `200` with the headline and unsubscribe, draft slug `404`; test rows removed. 542 infra tests; frontend and admin builds include `/newsletter/[slug]`. **Not done:** real-client rendering checks (Gmail/Outlook/Apple Mail) — that needs eyes on a device. |
| 2026-11-04 | 2 — Campaign engine + composer | Done (dev) | Campaign/delivery tables; `newsletter-send` Lambda with a defensive claim, audience snapshot, per-recipient render, Resend **batch** sends (100/call, paced), per-delivery idempotency, 5% failure stop, cancellation checks and self-continuation after 10 minutes. Portal: campaigns list, composer with typed fields for `market_brief`, iframe preview from the **production renderer**, test-to-self from `news@`, owner-only send with fresh auth + reason, cancel. Every mutation audited. New `sendEmailBatch` + `headers` support in `shared/email.ts`, and a `from` override so tests come from the newsletter address. Verified live by invoking the sender on a seeded campaign: `attempted:1, failures:0`, delivery `sent` with a provider id, campaign `sent`; test rows removed. 542 infra tests; admin typecheck/lint/build clean. **Before a real send:** set `NEWSLETTER_POSTAL_ADDRESS` (CAN-SPAM requires a physical address; the footer falls back to the domain line). |
| 2026-11-04 | 1 — Consent + unsubscribe | Done (dev) | `newsletter_subscribers` + `newsletter_suppressions` + `users.newsletter_prompted_at`. Product API `newsletter-api`: `GET/POST /user/newsletter`, `POST /user/newsletter/dismiss`, public `GET/POST /newsletter/unsubscribe`. Unsubscribe tokens are **AES-256-GCM encrypted** (address never appears in a URL, old links keep working, no DB lookup); one-click is idempotent and exempt from the kill switch. Product: one-time post-sign-in prompt (affirmative, "No thanks" recorded so it never nags), account toggle in a separate "Weekly Brief" card, public `/unsubscribe` page. `newsletter_enabled` added with the API as its consumer (unsubscribe exempt). Verified live: invalid token `400`, valid token `200`, unsubscribe created an `unsubscribed` row and a replay was idempotent, then the test row was removed. **Bug found:** the schema's multi-token backfill still referenced the dropped `access_token_hash` column, so `001-schema.sql` was no longer idempotent — every future deploy would fail. Guarded behind a column-existence check. 499 infra tests. Personalisation fields (name) still need a product-side read before Phase 2 templates. |
| 2026-11-04 | 1 — Consent + unsubscribe | In progress | Schema, product endpoints (status/opt-in/dismiss), HMAC unsubscribe, account toggle, post-sign-in prompt, public `/unsubscribe`. |
