/**
 * Support email copy.
 *
 * Shared because three code paths send it: the public support API (intake), the
 * admin API (replies), and housekeeping (closure). All of them go through
 * `shared/email.ts` — no direct SES/Resend calls anywhere.
 *
 * Rules (docs/support-tickets-plan.md §5):
 * - no `Reply-To` until inbound email exists, so a customer reply cannot vanish
 *   into an unmonitored mailbox;
 * - the acknowledgement and reply carry a tokenised thread link, because for an
 *   anonymous requester that link is the only access;
 * - bookkeeping changes (assignment, priority) never email.
 */

import { sendEmail, type EmailSendResult } from './email';

const APP_URL = process.env.APP_URL || 'https://tradewizard.live';

export const SUPPORT_FROM_EMAIL = 'support@tradewizard.live';

export function supportThreadUrl(ref: string, token: string): string {
  return `${APP_URL}/help/t/${encodeURIComponent(ref)}?t=${encodeURIComponent(token)}`;
}

export async function sendSupportAcknowledgement(input: {
  to: string;
  ref: string;
  token: string;
  subject: string;
}): Promise<EmailSendResult> {
  const url = supportThreadUrl(input.ref, input.token);

  return sendEmail({
    to: input.to,
    subject: `We received your request (${input.ref})`,
    // Stable key: a retried submit must not send a second acknowledgement.
    idempotencyKey: `support-ack-${input.ref}`,
    text: [
      `Thanks for contacting TradeWizard support.`,
      ``,
      `Your reference is ${input.ref}.`,
      `About: ${input.subject}`,
      ``,
      `Read or reply to this request at any time:`,
      url,
      ``,
      `Keep this link — it is how you access the conversation. It expires in 30 days.`,
      `Replying to this email does not reach us; use the link above.`,
      ``,
      `— TradeWizard Support`,
    ].join('\n'),
    html: shellHtml(`
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Thanks for contacting TradeWizard support.</p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Reference</p>
      <p style="margin:0 0 16px;font-size:18px;font-weight:600;letter-spacing:0.04em;">${escapeHtml(input.ref)}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">About</p>
      <p style="margin:0 0 20px;font-size:14px;">${escapeHtml(input.subject)}</p>
      ${buttonHtml(url, 'View this request')}
      <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#374151;">
        Keep this link — it is how you read our reply and add more detail. It expires in 30 days.
      </p>
      <p style="margin:0;font-size:13px;color:#6b7280;">
        Replying to this email does not reach us; use the button above.
      </p>
    `),
  });
}

/**
 * A support reply.
 *
 * The link is rotated by the caller before this is sent, so the newest email
 * always carries a working link. The message body is included in full: a reply
 * that only says "you have a message" makes the customer sign in to find out
 * whether it was worth reading.
 */
export async function sendSupportReply(input: {
  to: string;
  ref: string;
  token: string;
  subject: string;
  body: string;
  idempotencyKey: string;
}): Promise<EmailSendResult> {
  const url = supportThreadUrl(input.ref, input.token);

  return sendEmail({
    to: input.to,
    subject: `Re: ${input.subject} (${input.ref})`,
    idempotencyKey: input.idempotencyKey,
    text: [
      input.body,
      ``,
      `— TradeWizard Support`,
      ``,
      `Reference ${input.ref}. Reply or add detail here:`,
      url,
      ``,
      `Replying to this email does not reach us; use the link above.`,
    ].join('\n'),
    html: shellHtml(`
      <div style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#111827;">${escapeHtml(
        input.body
      ).replace(/\n/g, '<br />')}</div>
      <p style="margin:0 0 20px;font-size:13px;color:#6b7280;">— TradeWizard Support</p>
      ${buttonHtml(url, 'View this request')}
      <p style="margin:0;font-size:13px;color:#6b7280;">
        Reference ${escapeHtml(input.ref)}. Replying to this email does not reach us; use the button above.
      </p>
    `),
  });
}

/**
 * Resolution notice. Deliberately carries no link: the reply email already has
 * one, and rotating the token here would break it.
 */
export async function sendSupportResolved(input: {
  to: string;
  ref: string;
  subject: string;
}): Promise<EmailSendResult> {
  return sendEmail({
    to: input.to,
    subject: `Resolved: ${input.subject} (${input.ref})`,
    idempotencyKey: `support-resolved-${input.ref}-${Date.now()}`,
    text: [
      `We've marked your request as resolved.`,
      ``,
      `Reference: ${input.ref}`,
      `About: ${input.subject}`,
      ``,
      `If it is not fixed, open the latest email we sent you and reply there — that reopens the conversation.`,
      ``,
      `— TradeWizard Support`,
    ].join('\n'),
    html: shellHtml(`
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">We&apos;ve marked your request as resolved.</p>
      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Reference</p>
      <p style="margin:0 0 16px;font-size:18px;font-weight:600;letter-spacing:0.04em;">${escapeHtml(input.ref)}</p>
      <p style="margin:0 0 16px;font-size:14px;">${escapeHtml(input.subject)}</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#374151;">
        If it is not fixed, open the latest email we sent you and reply there — that reopens the conversation.
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
