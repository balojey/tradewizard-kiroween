import { cognitoAuthClient } from "./cognito-auth";

/**
 * Client for the public support API.
 *
 * Deliberately separate from `api-client.ts`: those calls assume a signed-in
 * user and retry aggressively. Support has to work for anonymous visitors, and
 * retrying a submit would create duplicate tickets — the API's `requestId`
 * makes a retry safe, but the UI should not do it silently.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export type SupportTopic =
  | "analysis"
  | "portfolio"
  | "billing"
  | "login"
  | "data"
  | "other";

export interface SupportSubmitInput {
  email: string;
  topic: SupportTopic;
  subject: string;
  body: string;
  context?: Record<string, string>;
  requestId?: string;
}

export interface SupportSubmitResult {
  ref: string;
  emailSent: boolean;
  duplicate?: boolean;
}

export interface SupportThreadMessage {
  id: string;
  author: "customer" | "admin" | "system";
  body: string;
  createdAt: string;
}

export interface SupportThread {
  ticket: {
    ref: string;
    topic: SupportTopic;
    status: "open" | "pending" | "resolved" | "closed";
    subject: string;
    createdAt: string;
    resolvedAt: string | null;
  };
  messages: SupportThreadMessage[];
  canReply: boolean;
}

export interface SupportTicketSummary {
  ref: string;
  subject: string;
  topic: SupportTopic;
  status: SupportThread["ticket"]["status"];
  lastMessageAt: string;
  createdAt: string;
}

export class SupportApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SupportApiError";
  }
}

interface CallOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Explicit access token (thread links do not have one). */
  token?: string | null;
  signal?: AbortSignal;
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const token =
    options.token === undefined ? cognitoAuthClient.getIdToken() : options.token;

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: options.signal,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const error = (payload as { error?: Record<string, unknown> } | null)?.error;

    throw new SupportApiError(
      response.status,
      typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
      typeof error?.message === "string"
        ? error.message
        : "We could not complete that request.",
      error ?? undefined
    );
  }

  return payload as T;
}

/** Random, stable-per-submission id so a double submit cannot create two tickets. */
export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function submitSupportTicket(input: SupportSubmitInput): Promise<SupportSubmitResult> {
  return call<SupportSubmitResult>("/support/tickets", {
    method: "POST",
    body: input,
  });
}

export function getSupportThread(ref: string, token?: string | null): Promise<SupportThread> {
  const query = token ? `?t=${encodeURIComponent(token)}` : "";
  return call<SupportThread>(`/support/tickets/${encodeURIComponent(ref)}${query}`);
}

export function postSupportMessage(
  ref: string,
  body: string,
  token?: string | null,
  requestId?: string
): Promise<SupportThreadMessage> {
  const query = token ? `?t=${encodeURIComponent(token)}` : "";
  return call<SupportThreadMessage>(
    `/support/tickets/${encodeURIComponent(ref)}/messages${query}`,
    { method: "POST", body: { body, requestId } }
  );
}

export function listMySupportTickets(): Promise<{ items: SupportTicketSummary[] }> {
  return call<{ items: SupportTicketSummary[] }>("/support/tickets");
}

/** Human-readable copy for the states the API can return. */
export function supportErrorMessage(error: unknown): string {
  if (error instanceof SupportApiError) {
    if (error.code === "RATE_LIMITED") return error.message;
    if (error.code === "SUPPORT_DISABLED") return error.message;
    if (error.code === "VALIDATION_ERROR") return error.message;
    return error.message;
  }
  if (error instanceof TypeError) {
    return "We could not reach support. Check your connection and try again.";
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
