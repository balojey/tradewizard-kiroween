/**
 * Customer email policy.
 *
 * Warden accounts live on an aliased address (`name+warden@example.com`, see
 * `admin-email.ts`). The product must refuse tagged addresses for two reasons:
 *
 * 1. A customer could otherwise create a product identity *inside* the Warden
 *    alias namespace, making "is this an admin address?" undecidable by a human
 *    reading a list.
 * 2. The aliased address is an operations identity. If it could also sign in to
 *    the product, the "dedicated identity" guarantee (architecture §6.1) would
 *    be a convention rather than a boundary.
 *
 * The rule is any `+tag`, not just `+warden`: rejecting only the Warden tag
 * would leave the namespace collision one keystroke away.
 */

export const PLUS_TAG_MESSAGE =
  "Email addresses with a '+' tag aren't supported. Use your primary address.";

/** True when the local part contains a `+` segment (Gmail-style subaddressing). */
export function hasPlusTag(email: string): boolean {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');

  if (at <= 0) return false;

  return trimmed.slice(0, at).includes('+');
}
