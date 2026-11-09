/**
 * Shared interpretation of a recommendation's post-execution outcome.
 *
 * `outcome_status` is written by `recommendation-scorer`:
 *   pending  - neither target nor stop has been hit yet
 *   success  - take-profit hit
 *   failure  - stop-loss hit
 *   expired  - no hit within the expiry window
 *   no_trade - the recommendation was NO_TRADE
 */

export type RecommendationOutcome =
  | 'pending'
  | 'success'
  | 'failure'
  | 'expired'
  | 'no_trade';

/** Above this age a pick is no longer prioritised at all. */
export const PICK_VALID_MINUTES = 24 * 60;

/** Above this age the pick is still prioritised, but labelled cached. */
export const PICK_FRESH_MINUTES = 60;

function ageMinutes(
  executedAt: string | null | undefined,
  now: number,
): number | null {
  if (!executedAt) return null;
  const executedMs = new Date(executedAt).getTime();
  if (!Number.isFinite(executedMs)) return null;
  return (now - executedMs) / 60_000;
}

/** Fresh enough to present as a live pick. */
export function isPickFresh(
  executedAt?: string | null,
  now: number = Date.now(),
): boolean {
  const age = ageMinutes(executedAt, now);
  return age !== null && age < PICK_FRESH_MINUTES;
}

/** Still inside the 24h priority window (fresh or cached). */
export function isPickValid(
  executedAt?: string | null,
  now: number = Date.now(),
): boolean {
  const age = ageMinutes(executedAt, now);
  return age !== null && age < PICK_VALID_MINUTES;
}

/** True once the recommendation is no longer a live idea. */
export function isOutcomeResolved(status?: string | null): boolean {
  return status === 'success' || status === 'failure' || status === 'expired';
}

/** True when the target or stop was actually reached. */
export function hasOutcomeHit(status?: string | null): boolean {
  return status === 'success' || status === 'failure';
}

/** User-facing label for the outcome state. */
export function outcomeLabel(status?: string | null): string | null {
  switch (status) {
    case 'success':
      return 'Target hit';
    case 'failure':
      return 'Stop hit';
    case 'expired':
      return 'Expired';
    case 'no_trade':
      return 'No trade';
    default:
      return null;
  }
}

/**
 * Replacement for a live edge number once the target/stop has been hit.
 * Returns null while the recommendation is still pending.
 */
export function edgeOutcomeLabel(status?: string | null): string | null {
  switch (status) {
    case 'success':
      return 'Edge realized';
    case 'failure':
      return 'Edge not realized';
    case 'expired':
      return 'Edge expired';
    default:
      return null;
  }
}

/** Short form for surfaces that already label the value "Edge". */
export function edgeOutcomeShort(status?: string | null): string | null {
  switch (status) {
    case 'success':
      return 'Realized';
    case 'failure':
      return 'Not realized';
    case 'expired':
      return 'Expired';
    default:
      return null;
  }
}

/**
 * Derive a hit from the live traded-token price.
 *
 * The recommendation-scorer polls every 5 minutes, so a target/stop can be
 * visibly hit while the stored status is still `pending`. These levels are
 * already in traded-token space (YES for LONG_YES, NO for LONG_NO), so the
 * caller must pass the matching live token price.
 */
export function deriveOutcomeFromPrice(
  action: 'LONG_YES' | 'LONG_NO' | 'NO_TRADE' | undefined,
  targetZone: [number, number] | undefined,
  stopLoss: number | undefined,
  currentTokenPrice: number | undefined,
): 'success' | 'failure' | null {
  if (!action || action === 'NO_TRADE') return null;
  if (currentTokenPrice == null || !Number.isFinite(currentTokenPrice)) return null;
  // 0/1 usually means missing price data, not a real quote.
  if (!(currentTokenPrice > 0 && currentTokenPrice < 1)) return null;

  // Fail-safe order mirrors the scorer: a malformed overlapping level should
  // read as a stop, not a win.
  if (stopLoss != null && stopLoss > 0 && currentTokenPrice <= stopLoss) {
    return 'failure';
  }
  if (targetZone && currentTokenPrice >= targetZone[0]) {
    return 'success';
  }
  return null;
}

/**
 * Prefer a stored terminal outcome; otherwise fall back to the live-price hit.
 * A stale `pending` must not mask a visible target/stop hit.
 */
export function resolveOutcomeStatus(
  storedStatus: string | null | undefined,
  liveOutcome: 'success' | 'failure' | null,
): RecommendationOutcome {
  if (storedStatus && storedStatus !== 'pending') {
    return storedStatus as RecommendationOutcome;
  }
  return liveOutcome ?? (storedStatus as RecommendationOutcome) ?? 'pending';
}

export type PickStateReason =
  | 'active'
  | 'cached'
  | 'stale'
  | 'target_hit'
  | 'stop_hit'
  | 'expired'
  | 'no_trade';

export interface PickState {
  /** True only when the recommendation is still a live, fresh pick. */
  active: boolean;
  reason: PickStateReason;
  /** Short label for badges/edge replacement. */
  label: string;
  /** Trader-facing explanation for why the pick is not prioritised. */
  note: string | null;
}

/**
 * Single explanation model for "why is the buy button no longer prioritised?"
 * Used by the verdict panel, market cards, and trade panel.
 */
export function getPickState(
  outcomeStatus: string | null | undefined,
  executedAt: string | null | undefined,
  now: number = Date.now(),
): PickState {
  switch (outcomeStatus) {
    case 'success':
      return {
        active: false,
        reason: 'target_hit',
        label: 'Target hit',
        note: 'Target already hit — this pick is closed.',
      };
    case 'failure':
      return {
        active: false,
        reason: 'stop_hit',
        label: 'Stop hit',
        note: 'Stop already hit — this pick is closed.',
      };
    case 'expired':
      return {
        active: false,
        reason: 'expired',
        label: 'Expired',
        note: 'This recommendation expired without hitting its target or stop.',
      };
    case 'no_trade':
      return {
        active: false,
        reason: 'no_trade',
        label: 'No trade',
        note: 'No trade was recommended for this analysis.',
      };
    default:
      if (!isPickValid(executedAt, now)) {
        return {
          active: false,
          reason: 'stale',
          label: 'Cached',
          note: 'This analysis is older than 24 hours — refresh for a live pick.',
        };
      }
      if (!isPickFresh(executedAt, now)) {
        return {
          active: true,
          reason: 'cached',
          label: 'Cached pick',
          note: 'Cached analysis — still within the 24-hour pick window. Target and stop remain active.',
        };
      }
      return {
        active: true,
        reason: 'active',
        label: 'Live pick',
        note: null,
      };
  }
}
