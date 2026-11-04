/**
 * Links from a support ticket's context into the customer app.
 *
 * The portal has no market detail page of its own — it shows the schedule pool —
 * so a market is opened in the product by slug, exactly as the product itself
 * links it.
 */

const BASE = process.env.NEXT_PUBLIC_PRODUCT_BASE_URL ?? "https://tradewizard.live";

export function productUrl(path: string): string {
  const base = BASE.replace(/\/+$/, "");
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

/** `/markets/<slug>` from stored context, falling back to the recorded page path. */
export function marketSlugFromContext(context: Record<string, string>): string | null {
  const fromContext = context.marketSlug?.trim();
  if (fromContext) return fromContext;

  const page = context.page?.trim();
  const match = page?.match(/^\/markets\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function marketUrlFromContext(context: Record<string, string>): string | null {
  const slug = marketSlugFromContext(context);
  return slug ? productUrl(`/markets/${slug}`) : null;
}
