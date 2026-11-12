/**
 * Client-side mirror of the Warden `+warden` aliasing rule.
 *
 * The server (`infra/services/shared/admin-email.ts`) is authoritative. This
 * exists so a person or an owner sees the exact address that will be created
 * *before* submitting, which is the only way a plus-addressing surprise is
 * discovered in time.
 */
export function previewAdminEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return trimmed;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  return local.endsWith("+warden") ? trimmed : `${local}+warden@${domain}`;
}
