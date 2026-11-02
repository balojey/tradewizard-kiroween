/**
 * Cursor pagination for admin lists.
 *
 * Opaque cursor = base64 of `{ createdAt, id }`, matching the tuple ordering
 * `(created_at, id) DESC`. Offset pagination is forbidden on this database:
 * `OFFSET n` scans n rows, and the portal must never do that to an OLTP table.
 */

export interface Cursor {
  createdAt: string;
  id: string;
}

export interface Pagination {
  limit: number;
  cursor: Cursor | null;
}

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;

export function parsePagination(
  params: Record<string, string> | null | undefined
): Pagination {
  const rawLimit = Number(params?.limit ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  return { limit, cursor: decodeCursor(params?.cursor ?? null) };
}

export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf-8').toString('base64');
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
    if (typeof parsed?.createdAt !== 'string' || typeof parsed?.id !== 'string') {
      return null;
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

/**
 * Convert `limit + 1` rows into a page: drop the sentinel row and derive the
 * next cursor from the last row actually returned.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Cursor
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(cursorOf(last).createdAt, cursorOf(last).id) : null;

  return { items, nextCursor };
}
