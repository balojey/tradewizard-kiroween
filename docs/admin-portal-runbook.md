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

### 1.1 Create the account and add the group

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
- If the person already uses TradeWizard, it reuses their existing account — one
  identity for product and portal, which is what the audit log assumes.

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
the newest one. Do the whole thing in one block so the 30-second code window
doesn't close:

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

TOKEN=$(aws cognito-idp respond-to-auth-challenge --client-id "$ADMIN_CLIENT" \
  --challenge-name "$CHALLENGE" --session "$SESSION" \
  --challenge-responses USERNAME=$EMAIL,SOFTWARE_TOKEN_MFA_CODE=$(totp "$SECRET") \
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

### 1.5 TOTP helper

Paste once per shell; then `totp "$SECRET"` prints a current code.

```bash
totp() { python3 -c 'import base64,hmac,hashlib,struct,time,sys
s=sys.argv[1]; k=base64.b32decode(s+"="*((8-len(s)%8)%8))
d=hmac.new(k,struct.pack(">Q",int(time.time())//30),hashlib.sha1).digest()
o=d[-1]&15; print(str((struct.unpack(">I",d[o:o+4])[0]&0x7fffffff)%1000000).zfill(6))' "$1"; }
```

Never commit a TOTP secret, and never paste one into a chat or ticket.

---

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

## 7. Pending procedures

These land with the slices that need them and must be added here, not in chat:

- DLQ inspect + redrive (slice 3/11)
- Kill-switch drill in dev before enabling the admin route (slice 10)
- Global kill switch activation and reset
- Payment reconciliation
- Audit export for an incident
