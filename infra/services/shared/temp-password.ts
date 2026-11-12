/**
 * Temporary passwords for invited admins.
 *
 * The person must replace this at first sign-in (`NEW_PASSWORD_REQUIRED`), so it
 * only has to clear the pool policy: ≥8 characters, upper, lower and digit.
 * Twenty characters from an unambiguous alphabet avoids transcription errors
 * when someone reads it from a phone.
 *
 * Never logged, never audited, never returned by the API — its only destination
 * is the invitation email.
 */

import { randomInt } from 'node:crypto';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
const LOWER = 'abcdefghijkmnopqrstuvwxyz'; // no l
const DIGITS = '23456789'; // no 0, 1
const ALL = `${UPPER}${LOWER}${DIGITS}`;

const DEFAULT_LENGTH = 20;

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)];
}

export function generateTemporaryPassword(length = DEFAULT_LENGTH): string {
  if (length < 12) {
    throw new Error('Temporary passwords must be at least 12 characters');
  }

  // Guarantee every required class, then fill.
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(ALL));

  // Fisher–Yates with a CSPRNG so the guaranteed characters are not always first.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}
