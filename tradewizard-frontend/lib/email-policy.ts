/**
 * Client mirror of `infra/services/shared/email-policy.ts`.
 *
 * The API enforces this too — the form check only exists so the person is not
 * sent a Magic code that the backend will then refuse.
 */

export const PLUS_TAG_MESSAGE =
  "Email addresses with a '+' tag aren't supported. Use your primary address.";

export function hasPlusTag(email: string): boolean {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");

  if (at <= 0) return false;

  return trimmed.slice(0, at).includes("+");
}
