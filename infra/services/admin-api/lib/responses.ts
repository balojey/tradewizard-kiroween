/**
 * Response helpers for the admin API.
 *
 * Every response is JSON with a CORS header resolved against an explicit
 * allowlist — the admin surface is a separate origin and must never answer with
 * a wildcard in production.
 */

import type { AdminApiEvent, ApiResponse, ErrorCode, PaginationMeta } from './types';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function allowedOrigins(): string[] {
  const configured = process.env.ADMIN_ALLOWED_ORIGINS ?? '';
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Echo the request origin when it is allowed; otherwise fall back to the first
 * configured origin (or `*` only when nothing is configured, i.e. local use).
 */
export function resolveCorsOrigin(event: AdminApiEvent): string {
  const origins = allowedOrigins();
  const requestOrigin = event.headers?.origin ?? event.headers?.Origin;

  if (origins.length === 0) return '*';
  if (requestOrigin && origins.includes(requestOrigin)) return requestOrigin;
  return origins[0];
}

function headers(event: AdminApiEvent, withBody = true): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': resolveCorsOrigin(event),
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    Vary: 'Origin',
    ...(withBody ? { 'Cache-Control': 'no-store' } : {}),
  };
}

export function json(
  event: AdminApiEvent,
  statusCode: number,
  data: unknown,
  meta?: PaginationMeta
): ApiResponse {
  return {
    statusCode,
    headers: headers(event),
    body: JSON.stringify(meta ? { data, meta } : { data }),
  };
}

export function errorResponse(
  event: AdminApiEvent,
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): ApiResponse {
  return {
    statusCode,
    headers: headers(event),
    body: JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }),
  };
}
