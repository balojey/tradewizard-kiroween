"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  SetUserMFAPreferenceCommand,
  VerifySoftwareTokenCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { adminFetch } from "@/lib/admin-api";
import { useAdminAuth } from "@/providers/AdminAuthProvider";

const REGION = process.env.NEXT_PUBLIC_COGNITO_REGION ?? "us-east-1";

type Stage = "idle" | "scan" | "verifying" | "done";

/** Enrolment must happen promptly, not with a day-old token. */
const MAX_TOKEN_AGE_SECONDS = 10 * 60;

function authTimeFromIdToken(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf-8"));
    return typeof payload.auth_time === "number" ? payload.auth_time : null;
  } catch {
    return null;
  }
}

function emailFromIdToken(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf-8"));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/**
 * otpauth URI for the authenticator app.
 *
 * Built and rendered entirely in the browser: the secret **is** the factor, so it
 * must never be sent to a QR-image service to be turned into a picture.
 */
function otpauthUri(secret: string, account: string): string {
  const issuer = "TradeWizard Admin";
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Enrol a TOTP factor from inside the portal.
 *
 * Reached only when the API answered `403 MFA_REQUIRED`: the account is a valid
 * admin with a password but no second factor. The enrolment is performed against
 * Cognito with the caller's **access token**, and the API independently verifies
 * that the factor now exists before recording it.
 */
export function MfaSetup() {
  const { tokens, signOut } = useAdminAuth();

  const [stage, setStage] = useState<Stage>("idle");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const accessToken = tokens?.accessToken;
  const idToken = tokens?.idToken;
  const account = idToken ? emailFromIdToken(idToken) ?? "admin" : "admin";

  const authTime = idToken ? authTimeFromIdToken(idToken) : null;
  const tooStale =
    authTime !== null && Math.floor(Date.now() / 1000) - authTime > MAX_TOKEN_AGE_SECONDS;

  async function begin() {
    if (!accessToken) return;
    setError(null);

    try {
      const client = new CognitoIdentityProviderClient({ region: REGION });
      const response = await client.send(
        new AssociateSoftwareTokenCommand({ AccessToken: accessToken })
      );

      if (!response.SecretCode) throw new Error("Cognito did not return a secret");

      setSecret(response.SecretCode);
      setStage("scan");
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function verify() {
    if (!accessToken || !secret) return;
    setStage("verifying");
    setError(null);

    try {
      const client = new CognitoIdentityProviderClient({ region: REGION });

      const verified = await client.send(
        // No FriendlyName here: it is not part of this SDK's command input.
        new VerifySoftwareTokenCommand({
          AccessToken: accessToken,
          UserCode: code.trim(),
        })
      );

      if (verified.Status !== "SUCCESS") {
        throw new Error("Cognito did not accept that code");
      }

      await client.send(
        new SetUserMFAPreferenceCommand({
          AccessToken: accessToken,
          SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
        })
      );

      // Server-side check: the route refuses unless Cognito reports the factor.
      await adminFetch("admin/bootstrap/mfa-enrolled", { token: idToken, method: "POST" });

      setStage("done");
    } catch (caught) {
      setStage("scan");
      setError((caught as Error).message);
    }
  }

  if (stage === "done") {
    return (
      <div>
        <h1 className="text-[14px] font-medium text-fg">Two-factor enabled</h1>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
          The factor is registered and the enrolment is in the audit log. Reload to enter the
          portal.
        </p>
        <Button className="mt-4" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[14px] font-medium text-fg">Add a second factor</h1>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
        This portal requires an authenticator app on every admin account. Your password got you
        this far; the code is what lets you in.
      </p>

      {tooStale && (
        <p className="mt-3 rounded-[8px] border border-warning/40 bg-warning/10 p-2.5 text-[11.5px] text-fg">
          You signed in a while ago. Sign out and back in before enrolling, so the factor is
          registered against a fresh session.
        </p>
      )}

      {stage === "idle" && (
        <Button className="mt-4" size="sm" onClick={begin} disabled={tooStale || !accessToken}>
          Set up authenticator
        </Button>
      )}

      {stage !== "idle" && secret && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3">
            <div className="flex justify-center rounded-[8px] bg-white p-3">
              {/* White plate: a QR on the dark surface is unreliable to scan. */}
              <QRCodeSVG
                value={otpauthUri(secret, account)}
                size={168}
                level="M"
                marginSize={0}
                bgColor="#ffffff"
                fgColor="#000000"
                title="Scan with your authenticator app"
              />
            </div>

            <div>
              <p className="text-[11.5px] text-muted">
                Scan with your authenticator app — or enter this key by hand:
              </p>
              <div className="mt-1 flex items-start gap-2">
                <p className="mono flex-1 break-all rounded-[8px] border border-border bg-surface-2 p-2.5 text-[11px] text-fg">
                  {secret}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(secret).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1200);
                    });
                  }}
                  className="h-8 shrink-0 rounded-[6px] border border-border-strong/60 bg-surface-2 px-2.5 text-[11px] text-fg hover:bg-surface-elevated"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-1 text-[10.5px] text-faint">
                Account: {account} · time-based (TOTP), 6 digits, 30 s
              </p>
            </div>
          </div>

          <Input
            label="6-digit code from the app"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            mono
            placeholder="000000"
            error={error ?? undefined}
            autoFocus
          />

          <Button
            size="sm"
            onClick={verify}
            loading={stage === "verifying"}
            disabled={code.length !== 6}
          >
            Verify and enable
          </Button>
        </div>
      )}

      {stage === "idle" && error && <p className="mt-3 text-[11.5px] text-no">{error}</p>}

      <button
        type="button"
        onClick={() => {
          signOut();
          window.location.href = "/login";
        }}
        className="mt-4 text-[11.5px] text-muted hover:text-fg"
      >
        Use a different account
      </button>
    </div>
  );
}
