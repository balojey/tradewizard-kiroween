/**
 * Response helpers for the support API.
 *
 * Public endpoints are called straight from the browser, so every response —
 * including errors — needs CORS headers. Errors carry a stable `code` so the UI
 * can branch without parsing prose.
 */

export type SupportErrorCode =
  | 'INVALID_JSON'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'TICKET_CLOSED'
  | 'RATE_LIMITED'
  | 'SUPPORT_DISABLED'
  | 'EMAIL_FAILED'
  | 'INTERNAL_ERROR';

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Cache-Control': 'no-store',
};

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: SupportErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(statusCode: number, body: unknown): ApiResponse {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export function errorResponse(error: HttpError): ApiResponse {
  return {
    statusCode: error.statusCode,
    headers: { ...CORS_HEADERS, ...retryAfter(error) },
    body: JSON.stringify({
      error: { code: error.code, message: error.message, ...(error.details ?? {}) },
    }),
  };
}

function retryAfter(error: HttpError): Record<string, string> {
  const seconds = error.details?.retryAfterSeconds;
  return typeof seconds === 'number' ? { 'Retry-After': String(seconds) } : {};
}

export function preflight(): ApiResponse {
  return { statusCode: 204, headers: CORS_HEADERS, body: '' };
}
