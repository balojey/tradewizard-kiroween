/**
 * Gamma/CLOB outcome helpers.
 *
 * `outcomes`, `outcomePrices`, and `clobTokenIds` are positionally aligned, but
 * their order is not contractual. Anywhere the UI needs the YES side it must
 * resolve the index from `outcomes`, not assume index 0.
 */

/** Parse a JSON-encoded array (or return an existing array). */
export function parseOutcomeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Index of the YES outcome; 0 when the array is unlabelled. */
export function yesOutcomeIndex(outcomes: unknown): number {
  const list = parseOutcomeArray(outcomes);
  const index = list.findIndex(
    (outcome) => typeof outcome === 'string' && outcome.trim().toLowerCase() === 'yes',
  );
  return index >= 0 ? index : 0;
}

/**
 * Resolve the YES price (0–1) from `outcomes` + `outcomePrices`.
 * Returns null when no usable price is present.
 */
export function yesPriceFromOutcomes(
  outcomes: unknown,
  outcomePrices: unknown,
): number | null {
  const prices = parseOutcomeArray(outcomePrices);
  if (prices.length === 0) return null;

  const index = yesOutcomeIndex(outcomes);
  const raw = prices[index] ?? prices[0];
  const parsed = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolve both CLOB token ids from `outcomes` + `clobTokenIds`.
 */
export function yesNoTokenIds(
  outcomes: unknown,
  clobTokenIds: unknown,
): { yes: string | null; no: string | null } {
  const ids = parseOutcomeArray(clobTokenIds);
  if (ids.length === 0) return { yes: null, no: null };

  const yesIndex = yesOutcomeIndex(outcomes);
  const noIndex = yesIndex === 0 ? 1 : 0;
  const yes = ids[yesIndex] ?? ids[0];
  const no = ids[noIndex] ?? ids[1];

  return {
    yes: typeof yes === 'string' ? yes : null,
    no: typeof no === 'string' ? no : null,
  };
}

/**
 * Resolve the YES CLOB token id from `outcomes` + `clobTokenIds`.
 */
export function yesTokenIdFromClobTokenIds(
  outcomes: unknown,
  clobTokenIds: unknown,
): string | null {
  return yesNoTokenIds(outcomes, clobTokenIds).yes;
}
