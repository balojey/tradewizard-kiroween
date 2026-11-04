# Admin Portal Runbook

**Audience:** whoever operates the TradeWizard management portal
**Companion:** `docs/admin-portal-architecture.md` (the *why*). This file is the
*how* — copy-paste procedures that have actually been run.

> Everything here was executed against the dev environment on 2026-11-02. If a
> command stops working, fix this file in the same commit as the code.

---

## 0. Environment values

Fetch these instead of trusting a hardcoded copy — they change when a stack is
replaced:

```bash
export AWS_REGION=us-east-1

export POOL=$(aws cloudformation list-exports \
  --query "Exports[?Name=='tw-dev-user-pool-id'].Value" --output text)
export ADMIN_CLIENT=$(aws cloudformation list-exports \
  --query "Exports[?Name=='tw-dev-admin-client-id'].Value" --output text)
export ADMIN_API=$(aws cloudformation list-exports \
  --query "Exports[?Name=='tw-dev-admin-api-url'].Value" --output text)

echo "pool=$POOL client=$ADMIN_CLIENT api=$ADMIN_API"
```

Use `tw-prod-*` for production. **Pool id and app client id are not secrets**
(the admin client has no client secret); passwords and TOTP secrets are.

---

## 1. Bootstrap a new admin

Do this once per person. Nothing here is automated by `deploy.sh` on purpose:
creating admins as a deploy side effect would be surprising and unauditable.

> **Use a dedicated admin email. Never convert a customer account.**
>
> The product signs in with a magic link that uses a password derived from the
> email (`HMAC(PASSWORD_SALT, email)`), set only when the account is created. Two
> things break if you reuse a customer account:
>
> 1. `admin-set-user-password` replaces the derived password → the next magic-link
>    sign-in fails with *"Login succeeded but backend sync failed"*.
> 2. Enrolling TOTP makes `AdminInitiateAuth` return an MFA challenge the product
>    cannot answer — same symptom.
>
> Use something like `ops@yourdomain.tld`. `GET /admin/me` reporting
> `linked: false` for that account is correct, not a fault.

**Check before you start.** If this command succeeds, the account already exists —
stop and read the warning above:

```bash
aws cognito-idp admin-get-user --user-pool-id "$POOL" \
  --username candidate@yourdomain.tld --query "{status:UserStatus,mfa:UserMFASettingList}"
# UserNotFoundException → safe to continue as a new account
```

### 1.1a From the portal (preferred)

An owner can do all of it: **Members → Add member**, enter the email, role and
reason. If no account exists, the dialog offers **Send invitation**:

1. Cognito creates the account and emails a temporary password.
2. They sign in with it and are asked to **choose their own password**.
3. The portal then shows the QR enrolment screen; they add the authenticator and
   are in.

The portal never sets a password, which is exactly why this is safe for admin
identities.

**Caveat:** the copy of §1.1 that runs from the CLI still exists for recovery and
for accounts the owner does not manage. Note that Cognito sends the invitation
from its default sender (`no-reply@verificationemail.com`, 50/day); wire the SES
identity into the pool if invitations need to come from `@tradewizard.live`.

### 1.1 Create the account and add the group (CLI alternative)

```bash
cd infra
npx tsx scripts/seed-admin.ts \
  --email someone@example.com \
  --group tw-owner \
  --user-pool-id "$POOL"
```

- `tw-owner` (full) · `tw-admin` (all mutations except settings/roles) ·
  `tw-support` (credits, resend, notes, pause) · `tw-analyst` (read-only)
- The script is idempotent: it will not reset an existing password.
- **Use a dedicated admin address.** The script reuses an existing Cognito user if
  one matches, so pointing it at a customer's email silently gives that customer
  portal access — and setting a password or enrolling TOTP on that account breaks
  their product magic-link login (recovery: §1.6).

### 1.2 Set a permanent password

The seeded account has no usable password (existing magic-link accounts never
had one). Prompt for it so it stays out of shell history:

```bash
read -rsp "New admin password: " PW; echo
aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL" \
  --username someone@example.com \
  --password "$PW" --permanent
```

Policy: ≥8 chars, upper, lower, digit.

### 1.3 Enrol TOTP

Cognito will not let you enable MFA until a software token is verified, and
**each `associate-software-token` call issues a new secret** — always verify with
the newest one. **Or let the portal do it.** Sign in with the new account's password: if no factor
is enrolled, the portal shows **Add a second factor** instead of a denial. Scan the
QR code (or copy the key by hand), enter a code, and it registers the factor and
writes an `admin.mfa.enrolled` audit row. The QR is rendered in the browser from
the `otpauth://` URI — the secret never leaves it. (The account must have signed in within the last
ten minutes; otherwise sign out and back in.)

To do it from a terminal instead, the whole block below must run in one shell so
the 30-second code window doesn't close:

```bash
EMAIL=someone@example.com
read -rsp "Password: " PW; echo
AT=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH \
  --client-id "$ADMIN_CLIENT" \
  --auth-parameters USERNAME=$EMAIL,PASSWORD="$PW" \
  --query AuthenticationResult.AccessToken --output text)
unset PW

SECRET=$(aws cognito-idp associate-software-token \
  --access-token "$AT" --query SecretCode --output text)

CODE=$(python3 -c 'import base64,hmac,hashlib,struct,time,sys
s=sys.argv[1]; k=base64.b32decode(s+"="*((8-len(s)%8)%8))
d=hmac.new(k,struct.pack(">Q",int(time.time())//30),hashlib.sha1).digest()
o=d[-1]&15; print(str((struct.unpack(">I",d[o:o+4])[0]&0x7fffffff)%1000000).zfill(6))' "$SECRET")

aws cognito-idp verify-software-token --access-token "$AT" --user-code "$CODE"
aws cognito-idp set-user-mfa-preference --access-token "$AT" \
  --software-token-mfa-settings Enabled=true,PreferredMfa=true

echo "Add to the authenticator app:"
echo "  account: $EMAIL"
echo "  key:     $SECRET"
```

`verify-software-token` prints `Status: SUCCESS`; the preference call prints
nothing on success.

**Do not pass `--friendly-name`** — it is not supported by the CLI version in
use and the command fails before executing, which then makes the preference call
fail with *"User has not verified software token mfa"*.

### 1.4 Verify the whole chain

```bash
EMAIL=someone@example.com
read -rsp "Password: " PW; echo
JSON=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH \
  --client-id "$ADMIN_CLIENT" \
  --auth-parameters USERNAME=$EMAIL,PASSWORD="$PW")
unset PW

CHALLENGE=$(python3 -c 'import sys,json;print(json.loads(sys.argv[1]).get("ChallengeName",""))' "$JSON")
SESSION=$(python3 -c 'import sys,json;print(json.loads(sys.argv[1]).get("Session",""))' "$JSON")
echo "challenge: ${CHALLENGE:-<none>}"

# Self-contained code generator: this step must work on a fresh shell and must
# not depend on the `totp` helper below (that ordering bug bit once).
CODE=$(python3 -c 'import base64,hmac,hashlib,struct,time,sys
s=sys.argv[1]; k=base64.b32decode(s+"="*((8-len(s)%8)%8))
d=hmac.new(k,struct.pack(">Q",int(time.time())//30),hashlib.sha1).digest()
o=d[-1]&15; print(str((struct.unpack(">I",d[o:o+4])[0]&0x7fffffff)%1000000).zfill(6))' "$SECRET")

TOKEN=$(aws cognito-idp respond-to-auth-challenge --client-id "$ADMIN_CLIENT" \
  --challenge-name "$CHALLENGE" --session "$SESSION" \
  --challenge-responses USERNAME=$EMAIL,SOFTWARE_TOKEN_MFA_CODE="$CODE" \
  --query AuthenticationResult.IdToken --output text)

curl -s -H "Authorization: Bearer $TOKEN" "${ADMIN_API}admin/me"; echo
```

Expected:

```json
{"data":{"sub":"…","email":"someone@example.com","role":"owner","roleRank":40,
         "mfa":true,"userId":"<users.id UUID>","linked":true}}
```

- `challenge: SOFTWARE_TOKEN_MFA` — the second factor is now mandatory for this
  account, which is what production relies on.
- `linked: true` — the Cognito identity resolves to a row in `users`. **`false`
  is a defect**: the portal can read data but cannot attribute actions.

### 1.5 TOTP helper (optional convenience)

Every step above is self-contained; paste this only if you want `totp "$SECRET"`
for repeated manual checks. It is **not** defined early enough to use in §1.4.

```bash
totp() { python3 -c 'import base64,hmac,hashlib,struct,time,sys
s=sys.argv[1]; k=base64.b32decode(s+"="*((8-len(s)%8)%8))
d=hmac.new(k,struct.pack(">Q",int(time.time())//30),hashlib.sha1).digest()
o=d[-1]&15; print(str((struct.unpack(">I",d[o:o+4])[0]&0x7fffffff)%1000000).zfill(6))' "$1"; }
```

Never commit a TOTP secret, and never paste one into a chat or ticket.

---

### 1.6 Recovering an account that was used for both

Symptoms: product login shows *"Login succeeded but backend sync failed"*; the
sync Lambda log shows `NotAuthorizedException: Incorrect username or password`.

```bash
# 1. Restore the derived password the product expects
PW=$(node -e "
const c=require('crypto');
const email=process.argv[1];
console.log('Tw'+c.createHmac('sha256','tw-magic-sync-${ENV_LONG}-v1').update(email).digest('hex').slice(0,30)+'1!');
" someone@example.com)

aws cognito-idp admin-set-user-password --user-pool-id "$POOL" \
  --username someone@example.com --password "$PW" --permanent

# 2. Remove the factor the product cannot answer
aws cognito-idp admin-set-user-mfa-preference --user-pool-id "$POOL" \
  --username someone@example.com --software-token-mfa-settings Enabled=false
```

`${ENV_LONG}` is `development` or `production`. That account now works for the
product again and is **denied by the portal** (`ADMIN_REQUIRE_MFA=true`) — which
is the correct outcome: move their admin access to a dedicated identity.

## 2. Check who is an admin

```bash
aws cognito-idp admin-list-groups-for-user \
  --user-pool-id "$POOL" --username someone@example.com \
  --query "Groups[].GroupName" --output text

aws cognito-idp admin-get-user \
  --user-pool-id "$POOL" --username someone@example.com \
  --query "{status:UserStatus,mfa:UserMFASettingList}" --output json
```

`mfa: null` means no second factor — that account will be denied once
`ADMIN_REQUIRE_MFA=true`.

---

## 3. Revoke access

```bash
# Remove portal capability (leaves the product account intact)
aws cognito-idp admin-remove-user-from-group \
  --user-pool-id "$POOL" --username someone@example.com --group-name tw-owner

# Force re-authentication everywhere (sessions die at the next token refresh)
aws cognito-idp admin-user-global-sign-out \
  --user-pool-id "$POOL" --username someone@example.com
```

Removing the last `tw-owner` is blocked in the API, not in these commands — an
operator running raw CLI calls can still lock the team out. Keep two owners.

---

## 4. Deploying portal changes

```bash
cd infra
./deploy.sh up dev            # CDK → then DB migration (step 4/6)
./deploy.sh up dev --skip-db  # schema unchanged
```

Two operational facts that have already bitten us:

- **`deploy.sh` runs CDK before the migration and uses `set -e`.** A failed CDK
  deploy means the migration never ran. Check `Step 4/6` in the output.
- **A stack that fails on first create lands in `ROLLBACK_COMPLETE`** and cannot
  be updated. Delete and recreate:

  ```bash
  aws cloudformation delete-stack --stack-name TradeWizard-Dev-Admin
  aws cloudformation wait stack-delete-complete --stack-name TradeWizard-Dev-Admin
  ```

- Run the full deploy **twice** after a schema change to prove idempotency.

### Applying the schema manually (when the deploy aborted)

```bash
SECRET_ARN=$(aws cloudformation list-exports \
  --query "Exports[?Name=='tw-dev-db-secret-arn'].Value" --output text)
aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" \
  --query SecretString --output text > /tmp/dbcreds.json

node -e "const c=require('/tmp/dbcreds.json');require('fs').writeFileSync('/tmp/pg.env',
 'PGHOST='+c.host+'\nPGPORT='+(c.port||5432)+'\nPGUSER='+c.username+'\nPGDATABASE='+(c.database||c.dbname||'tradewizard')+'\nPGPASSWORD='+c.password+'\nPGSSLMODE=require\n')"

set -a && . /tmp/pg.env && set +a
psql -v ON_ERROR_STOP=1 -f sql/001-schema.sql
rm -f /tmp/pg.env /tmp/dbcreds.json
```

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `SoftwareTokenMFANotFoundException` on `associate-software-token` | Pool has software-token MFA disabled | Should be impossible now (enabled in every env since `f8e4567`). Check `aws cognito-idp get-user-pool-mfa-config --user-pool-id "$POOL"` |
| `Unknown options: --friendly-name` | CLI version doesn't support it | Drop the flag — verification still works |
| `User has not verified software token mfa` | The verify call never ran, or used a code from an older secret | Re-run §1.3 as one block |
| Code always rejected | Code computed from a stale `SECRET` (each `associate` call rotates it) | Use the secret printed by the most recent call |
| `401 UNAUTHORIZED` from `/admin/me` | Missing/expired/wrong-audience token | Must be the **ID token** from the **admin client**, refreshed within the hour |
| `403 FORBIDDEN` from `/admin/me` | No admin group, or MFA required but not enrolled | §2. Check the authorizer log for `AdminMfaLookupMiss`, which prints the Cognito view |
| `403` on a route that exists, immediately after a deploy | The stage deployment has not finished propagating | Wait 10–20 s and retry. Confirm with `aws apigateway get-deployments --rest-api-id <id>` |
| Presigned S3 fetch blocked by CORS | Bucket CORS missing an admin origin | Add it in `lib/storage-stack.ts` and redeploy Storage |
| `{"code":"BAD_REQUEST"}` on an unknown path | API Gateway denial before routing | Not a Lambda error; check the URL |
| `linked: false` in `/admin/me` | No `users` row for this Cognito sub | Investigate the signup path; do not grant more access |
| `308`/`403` when calling the API root | Missing trailing path or a deployed stage rewrite | Use `${ADMIN_API}admin/me` |

---

## 6. What "healthy" looks like

| Check | Expected |
|---|---|
| `GET /admin/me` without a token | `401`, JSON `{"error":{"code":"UNAUTHORIZED",…}}`, CORS header present |
| `GET /admin/me` with a valid admin token | `200`, `linked: true` |
| `admin_audit_log` after any mutation | exactly one row per action |
| `AdminAuthDenied` alarm | `OK`; brief spikes only during investigations |
| `tw-dev-admin-api` Lambda errors | zero |

---

## 7. Operating the portal

Every action below is audited. Each dialog requires a **reason of at least eight
characters**, which lands in `admin_audit_log` — write what a future reader needs.

### 7.1 Incident toggles (Settings, owner)

Settings take effect within a minute (product paths cache for 60 s). Pick by what
you are trying to stop:

| Toggle | Stops | Does not stop |
|---|---|---|
| `analysis_paused` | New analysis requests (users see your `analysis_pause_message`) | Recurring schedules already running |
| `pm_activations_paused` | New portfolio sessions | Existing sessions — use the kill switch for those |
| `ai_provider` | Nothing directly; switches Bedrock ↔ Nebius ahead of the deployed env | — |

Reverting: set the value back and confirm in the list that "Last changed" updated.
`ai_provider = ""` means "follow the deployment".

### 7.2 Suspend an account (admin)

User → **Suspend** → reason. Immediately: the account cannot request analyses,
cannot activate a portfolio session, and its `active` sessions are paused.
Open positions are **not** exited — that is the kill switch. Reinstating restores
access but leaves sessions paused; resume them deliberately.

### 7.3 Halt trading (admin)

Two entry points, both admin-only, both keyed to the same user-level switch:

- **Users → a user → Kill switch** — halts everything that user has open.
- **Portfolio → a session → Kill switch** — same action, reached from the runaway
  session rather than the account. Phase 1 applies the halt synchronously (new entries stop
now); phase 2 cancels orders and exits positions in the background and can take a
minute per session. The response says whether the exit was dispatched; if it was
not, retry or terminate the session manually.

Reset with **Clear kill switch**. Paused sessions still need resuming.

Verify the halt landed:

```bash
aws dynamodb get-item --table-name tw-$( [ "$ENV" = prod ] && echo prod || echo dev )-rate-limits \
  --key '{"pk":{"S":"kill_switch#<userId>"},"sk":{"S":"state"}}'
```

### 7.4 Terminate a session (admin)

Portfolio → session → **Terminate**. Cancels working orders, exits the position,
drops the guard schedule and marks the session `terminated` / `admin_terminated`
in the background. Irreversible: the user must open a new session.

### 7.5 Comp a plan (admin)

User → **Comp plan** → plan + optional expiry. The plan applies immediately,
renewal pauses, and the previous plan is restored on revoke **or expiry** (the
hourly maintenance run does the expiry and writes a `system`-actor audit row).
Comping does not top up credits.

### 7.6 Grant credits / refund (support / admin)

- **Grant**: user header → **Grant credits**. Credits land with
  `credit_source='admin_grant'`; the dialog generates one idempotency key per
  confirmation, so a double click cannot credit twice.
- **Refund**: analysis detail → **Refund credits**. Credits 1 to every recipient
  of that result, at most once each (partial unique index).

### 7.7 Invalidate a cached analysis / requeue (admin)

- **Invalidate cache** (analysis detail): deletes that market's cached result so
  the next request re-runs. The in-flight marker is preserved on purpose.
- **Requeue** (API, `POST /admin/analyses/requeue`): dispatches a run now as a
  scheduled fire — subscribers may be charged as usual, and nobody is charged
  merely because an operator asked. Refuses while a run is already in flight.

### 7.8 Manage members (owner)

**Members** → **Add member** (existing TradeWizard account only), change role, or
remove. The last owner cannot be demoted or removed. Changes apply immediately
because removal and role changes force a global sign-out.

### 7.9 Kill-switch drill (do this in dev before relying on it in prod)

1. Create a test session for a test user (or use a real paused session in dev).
2. Activate the kill switch from the portal; confirm the response says
   `exitsDispatched: true`.
3. Confirm the session row is `terminated` with `termination_reason='kill_switch'`.
4. Reset the switch; confirm the DynamoDB item is gone.
5. Check the audit log for `portfolio.kill_switch.activate` and `.reset`.

### 7.10 Still outstanding

- **DLQ inspect + redrive** — use the AWS console; the portal shows depth only.
- **Payment reconciliation** — mutations exist for trial extension only.
- **Audit export** — query the table or use the AWS console.
- **Global (platform-wide) kill switch** — not implemented; per-user only.


---

## 10. Working a support ticket

Customers reach this inbox from the product (AI verdict, Portfolio Manager session,
`/help`). Every ticket carries the context they had open.

1. **Open `/support`.** Filters: status, assignee (Anyone / Mine / Unassigned),
   topic. The header shows open, unassigned, overdue and waiting-on-customer
   counts. `overdue` means no first reply within the target in Settings
   (`support_first_response_target_hours`).
2. **Claim before you type.** Claim is atomic — if someone got there first you
   get `409 ALREADY_CLAIMED` naming the holder. Replying to a ticket held by
   someone else is refused unless you are admin+.
3. **Reply or note.** `Send reply` emails the customer and moves the ticket to
   `waiting on customer`. `Internal note` never emails and never appears in the
   customer's thread — use it for what the next operator needs.
4. **Anti-burst.** A second reply inside 60 seconds is stored but not emailed,
   and says so. Fix the typo, don't send a third.
5. **Update** (status / priority / assignment) needs a reason ≥8 characters; it
   lands in `/audit`. Resolving emails the customer a short notice with no link.
6. **Closed tickets** refuse replies. Set status back to `open` first.
7. **Housekeeping runs hourly**: claims idle for 8 hours are released (so a
   ticket is never invisible work), and tickets resolved more than 7 days ago are
   closed.

### When the email fails

The message is stored either way. If `delivery: failed`, the customer sees it
when they open their last thread link; send another reply to retry the email.
If `delivery: suppressed`, a reply went out under a minute earlier — the existing
link is valid and already shows the new message.

### When the customer says the link does not work

Links expire after 30 days. Every email we send issues its own link and **all
unexpired links work**, so an older email is still safe to click — if one fails,
it has expired or the address is wrong. Send another reply to issue a fresh one.
If they have an account, they can also read the ticket at `/account/support`.
