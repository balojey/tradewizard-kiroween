/**
 * Bounded reporting windows.
 *
 * Every aggregate in the portal is scoped to an explicit range: there is no
 * "all time" query, because that is exactly the query that turns a dashboard
 * into an outage on a small OLTP database.
 */

import { HttpError } from './responses';

export const DEFAULT_WINDOW_DAYS = 7;
export const MAX_WINDOW_DAYS = 90;

export interface ReportingWindow {
  from: string;
  to: string;
}

function parseDate(raw: string | null | undefined, name: string): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'BAD_REQUEST', `Invalid ${name}: ${raw}`);
  }
  return date.toISOString();
}

export function parseWindow(
  params: Record<string, string> | null | undefined
): ReportingWindow {
  const to = parseDate(params?.to, 'to') ?? new Date().toISOString();
  const from =
    parseDate(params?.from, 'from') ??
    new Date(new Date(to).getTime() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();

  const spanMs = new Date(to).getTime() - new Date(from).getTime();
  if (spanMs <= 0) {
    throw new HttpError(400, 'BAD_REQUEST', '"from" must be before "to"');
  }
  if (spanMs > MAX_WINDOW_DAYS * 86_400_000) {
    throw new HttpError(
      400,
      'BAD_REQUEST',
      `Window too large: maximum is ${MAX_WINDOW_DAYS} days`
    );
  }

  return { from, to };
}

/** Parse one optional ISO date, for list filters that are not windows. */
export function parseOptionalDate(
  raw: string | null | undefined,
  name: string
): string | null {
  return parseDate(raw, name);
}
