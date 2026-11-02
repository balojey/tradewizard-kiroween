# tradewizard-admin

> Part of the [TradeWizard Kiroween 2026 submission](../README.md) (Frankenstein category). The admin portal is a separate deployment and is never linked from the customer app.

Internal management portal for TradeWizard. **Not** part of the customer product:
it is a separate package, deployed as its own Amplify app, and its routes are
never linked from the public frontend.

- Architecture and decisions: `docs/admin-portal-architecture.md`
- Operational procedures: `docs/admin-portal-runbook.md`

## Development

```bash
cp .env.example .env.local     # fill in from CloudFormation exports
npm install
npm run dev                    # http://localhost:3001
```

Values come from the deployed stacks, not from source control:

```bash
aws cloudformation list-exports \
  --query "Exports[?Name=='tw-dev-admin-client-id' || Name=='tw-dev-admin-api-url']"
```

Add `http://localhost:3001` to the admin API's CORS allowlist (`ADMIN_ALLOWED_ORIGINS`)
if it is not already there.

## What this package is allowed to do

- Talk to the admin API with a Cognito ID token.
- Keep that token in `sessionStorage`, mirrored to a cookie only so the route guard
  (`proxy.ts`) can redirect before render.

It must never contain: wallet/Magic SDK code, Polymarket clients, trading logic,
or any on-chain capability. The portal asks the backend to act; it never acts.

## Sign-in

Email + password + TOTP, direct to Cognito (`USER_PASSWORD_AUTH` on the admin
client only). Bootstrapping an admin is a terminal task — see runbook §1.

## Current scope

Slice 5: login, route guard, shell, `GET /admin/me`, the users read path
(`/users`, `/users/{id}` with credits, analyses, sessions, payments, notes), and
the analyses read path (`/analyses` with a quality view, `/analyses/{id}` with a
presigned S3 payload viewer), the portfolio read path (`/portfolio` exposure
and sessions, `/portfolio/{id}` trades and decisions), billing (`/billing` revenue,
ledger, subscriptions), agents (`/agents` calibration and model cost), ops
(`/ops` queues, Lambda health, alarms, database), and markets (`/markets` analysis
pool and stuck executions). and the overview dashboard (`/overview`). Phase 1 (read-only) is complete; Phase 2 has started with the audit spine and
support notes.
Everything else in the navigation is disabled until its slice lands; see §14.1 of
the architecture doc for the order.

## Deploying

Amplify app rooted at this directory. Add to the root `amplify.yml`:

```yaml
applications:
  - appRoot: tradewizard-admin
```

Then set `NEXT_PUBLIC_ADMIN_API_BASE_URL`, `NEXT_PUBLIC_ADMIN_CLIENT_ID`, and
`NEXT_PUBLIC_COGNITO_REGION` in the Amplify environment, and attach
`admin.tradewizard.live`. Finally add that origin to `ADMIN_ALLOWED_ORIGINS` in
the Admin stack and redeploy.
