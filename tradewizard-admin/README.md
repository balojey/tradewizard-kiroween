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

Phase 1 (read-only) is complete. Phase 2 adds the audit spine, support notes, and
the operational controls:

- **Users** - read path, credits, analyses, sessions, payments, notes, plan
  overrides, suspension, grant credits, and refunds.
- **Analyses** - read path, quality view, presigned S3 payload viewer, refunds,
  cache invalidation, and requeue of a market's analysis.
- **Portfolio** - exposure, sessions, trades, decisions, pause/resume, terminate,
  and a two-phase kill switch.
- **Members** - owner-managed portal membership with immediate access revocation.
- **Settings** - audited runtime settings, each naming its consumer: pause new
  analysis, edit the pause message, override the AI provider without a redeploy,
  and pause new Portfolio Manager activations while existing sessions keep
  trading. Changes apply within a minute and are written to the audit log.
- **Billing, agents, ops, markets, overview** - revenue, ledger, subscriptions,
  calibration and model cost, queues, Lambda health, alarms, database state,
  analysis pool, stuck executions, and the dashboard.

See §14.1 of the architecture doc for the delivery order and §14.4 for the live
progress log.

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
