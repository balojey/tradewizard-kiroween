import type { PolymarketMarket } from '@/hooks/useMarkets';
import { yesPriceFromOutcomes, yesTokenIdFromClobTokenIds } from '@/utils/outcomePrices';

/** Resolve the YES probability (0–100) from live prices, falling back to outcome prices. */
export function getYesProbability(market: PolymarketMarket): number {
  if (market.realtimePrices) {
    const yesTokenId = yesTokenIdFromClobTokenIds(
      market.outcomes,
      market.clobTokenIds,
    );
    if (yesTokenId && market.realtimePrices[yesTokenId]) {
      return Math.round(market.realtimePrices[yesTokenId].midPrice * 100);
    }
  }

  const yesPrice = yesPriceFromOutcomes(market.outcomes, market.outcomePrices);
  if (yesPrice !== null) return Math.round(yesPrice * 100);

  return 50;
}

export function formatMarketVolume(vol: string | number | undefined): string {
  if (!vol) return '';
  const num = typeof vol === 'string' ? parseFloat(vol) : vol;
  if (isNaN(num)) return '';
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

export function formatMarketEndDate(date: string | undefined): string {
  if (!date) return '';
  try {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
