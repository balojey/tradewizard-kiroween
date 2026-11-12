/**
 * Invitation email for a Warden account created through an invite link.
 *
 * Sent through `shared/email.ts` (Resend by default) rather than Cognito's
 * default sender: that sender is `no-reply@verificationemail.com`, capped at 50
 * messages a day, and routinely filtered — a registration people never hear
 * about is a broken feature (docs/warden-invite-links-plan.md §2.5).
 *
 * No `Reply-To`: the support plan deliberately has no inbound mailbox yet, and a
 * reply that vanishes is worse than an email that says "do not reply".
 */

import { sendEmail, type EmailSendResult } from './email';

export const WARDEN_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'support@tradewizard.live';

function appUrl(): string {
  return (process.env.ADMIN_APP_URL || 'https://admin.tradewizard.live').replace(/\/+$/, '');
}

export interface AdminInvitationInput {
  /** The aliased address the account was created on. */
  to: string;
  role: string;
  /** One-time password that must be changed at first sign-in. */
  temporaryPassword: string;
  /** Link expiry, used only for the "this invitation was issued because…" note. */
  expiresAt?: Date;
  /** Stable key so a retried registration cannot send twice. */
  idempotencyKey?: string;
}

export async function sendAdminInvitation(
  input: AdminInvitationInput
): Promise<EmailSendResult> {
  const loginUrl = `${appUrl()}/login`;

  return sendEmail({
    to: input.to,
    from: WARDEN_FROM_EMAIL,
    subject: 'Your TradeWizard Warden access',
    idempotencyKey: input.idempotencyKey,
    text: [
      `You have been given ${input.role} access to TradeWizard Warden, the operations portal.`,
      ``,
      `Sign in with this exact address (it is your Warden identity):`,
      input.to,
      ``,
      `Temporary password: ${input.temporaryPassword}`,
      ``,
      `At your first sign-in you will choose your own password, then add an`,
      `authenticator app (TOTP). The temporary password expires in 7 days.`,
      ``,
      `Sign in: ${loginUrl}`,
      ``,
      `This account is for the operations portal only. Do not use it for the`,
      `TradeWizard product — your product account stays separate and untouched.`,
      ``,
      `Replying to this email does not reach us.`,
      ``,
      `— TradeWizard Warden`,
    ].join('\n'),
    html: shellHtml(`
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        You have been given <strong>${escapeHtml(input.role)}</strong> access to
        TradeWizard Warden, the operations portal.
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Sign in with this exact address</p>
      <p style="margin:0 0 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;font-weight:600;">
        ${escapeHtml(input.to)}
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Temporary password</p>
      <p style="margin:0 0 20px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:17px;font-weight:600;letter-spacing:0.04em;">
        ${escapeHtml(input.temporaryPassword)}
      </p>
      ${buttonHtml(loginUrl, 'Sign in to Warden')}
      <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#374151;">
        At your first sign-in you will choose your own password, then add an
        authenticator app. The temporary password expires in 7 days.
      </p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
        This account is for the operations portal only. Do not use it for the
        TradeWizard product — your product account stays separate and untouched.
        Replying to this email does not reach us.
      </p>
    `),
  });
}

function shellHtml(inner: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
      <tr><td>${inner}</td></tr>
    </table>
  </body>
</html>`;
}

function buttonHtml(url: string, label: string): string {
  return `<p style="margin:0 0 24px;">
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(label)}</a>
  </p>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
