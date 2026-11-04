import { createHash } from 'node:crypto';

export type NewsletterErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'NEWSLETTER_DISABLED'
  | 'RATE_LIMITED'
  | 'INVALID_TOKEN'
  | 'NOT_FOUND'
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
    public readonly code: NewsletterErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(statusCode: number, body: unknown): ApiResponse {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

export function errorResponse(error: HttpError): ApiResponse {
  return {
    statusCode: error.statusCode,
    headers: {
      ...CORS_HEADERS,
      ...(error.code === 'RATE_LIMITED' ? { 'Retry-After': '60' } : {}),
    },
    body: JSON.stringify({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    }),
  };
}

export function htmlResponse(body: string): ApiResponse {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex, nofollow',
    },
    body,
  };
}

export function preflight(): ApiResponse {
  return { statusCode: 204, headers: CORS_HEADERS, body: '' };
}

/** Stable, non-reversible key for rate limits. */
export function tokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}
