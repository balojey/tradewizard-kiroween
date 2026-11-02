/**
 * Typed client for the admin API.
 *
 * Errors carry the API's `code` so the UI can distinguish "your token expired"
 * (401) from "your role is insufficient" (403) from "we broke something" (500).
 */

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

const RAW_BASE = process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL ?? "";

/** Ensure exactly one trailing slash so relative paths compose predictably. */
export function apiBaseUrl(): string {
  if (!RAW_BASE) return "";
  return RAW_BASE.endsWith("/") ? RAW_BASE : `${RAW_BASE}/`;
}

interface RequestOptions {
  token?: string | null;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Extra headers, e.g. `Idempotency-Key` on mutations. */
  headers?: Record<string, string>;
}

export async function adminFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const payload = await request(path, options);
  return (payload as { data: T }).data;
}

/** Paginated GET: returns the rows plus the opaque next cursor. */
export async function adminFetchPage<T>(
  path: string,
  options: RequestOptions = {}
): Promise<{ items: T[]; nextCursor: string | null }> {
  const payload = (await request(path, options)) as {
    data: T[];
    meta?: { nextCursor?: string | null };
  };

  return {
    items: payload.data ?? [],
    nextCursor: payload.meta?.nextCursor ?? null,
  };
}

async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const base = apiBaseUrl();
  if (!base) {
    throw new AdminApiError(0, "CONFIG_MISSING", "NEXT_PUBLIC_ADMIN_API_BASE_URL is not set");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers ?? {}),
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${base}${path.replace(/^\//, "")}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new AdminApiError(0, "NETWORK", "Could not reach the admin API");
  }

  const text = await response.text();
  const payload = text ? safeJson(text) : {};

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } }).error;
    throw new AdminApiError(
      response.status,
      error?.code ?? `HTTP_${response.status}`,
      error?.message ?? `Request failed with status ${response.status}`,
      (payload as { requestId?: string }).requestId
    );
  }

  return payload;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
