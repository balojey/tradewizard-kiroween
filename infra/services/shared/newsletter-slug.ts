/** Public web-view slug: unambiguous, URL-safe, no database round trip to read. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateCampaignSlug(): string {
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
  const bytes = randomBytes(10);
  let slug = '';
  for (let i = 0; i < bytes.length; i += 1) slug += ALPHABET[bytes[i] % ALPHABET.length];
  return slug.toLowerCase();
}
