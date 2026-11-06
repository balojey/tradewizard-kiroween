/**
 * Polymarket outcome helpers.
 *
 * CLOB `tokens` arrays and Gamma `outcomes` / `outcomePrices` arrays are
 * positionally aligned but the order is not contractual. Every service that
 * needs the YES side must resolve it by the `outcome` label, never by index.
 * These helpers centralise that rule so the analysis pipeline and the
 * recommendation scorer cannot drift apart.
 */

/** True when a Polymarket outcome label means YES. */
export function isYesOutcome(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'yes';
}

/**
 * Resolve a CLOB `tokens` array to the YES token id.
 *
 * Falls back to the first token only when the payload carries no outcome
 * labels at all, which keeps the caller working on legacy payloads. An
 * explicitly-labelled NO token is never treated as YES.
 */
export function selectYesTokenId(tokens: unknown): string {
  if (!Array.isArray(tokens) || tokens.length === 0) return '';

  const yes = tokens.find((token) =>
    isYesOutcome((token as { outcome?: unknown } | null)?.outcome),
  );
  if (yes) {
    const yesTokenId = (yes as { token_id?: unknown }).token_id;
    return typeof yesTokenId === 'string' ? yesTokenId : '';
  }

  // No YES label. Only fall back to the first token when the payload does not
  // label outcomes at all; never treat an explicit NO token as YES.
  const first = tokens[0] as { outcome?: unknown; token_id?: unknown };
  if (typeof first?.outcome === 'string' && first.outcome.trim() !== '') {
    return '';
  }

  return typeof first?.token_id === 'string' ? first.token_id : '';
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Resolve Gamma `outcomes` + `outcomePrices` to the YES probability.
 *
 * Returns null when no usable price is present. Falls back to index 0 only when
 * the outcomes array is missing or does not label a YES outcome.
 */
export function yesProbabilityFromOutcomes(
  outcomesRaw: unknown,
  pricesRaw: unknown,
): number | null {
  const prices = parseArray(pricesRaw);
  if (prices.length === 0) return null;

  const outcomes = parseArray(outcomesRaw);
  const yesIndex = outcomes.findIndex((outcome) => isYesOutcome(outcome));
  const index = yesIndex >= 0 && yesIndex < prices.length ? yesIndex : 0;

  const parsed = Number.parseFloat(String(prices[index]));
  return Number.isFinite(parsed) ? parsed : null;
}
