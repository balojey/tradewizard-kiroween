/**
 * Transport types for the admin API (API Gateway REST, Lambda proxy).
 */

export interface AdminApiEvent {
  httpMethod: string;
  path: string;
  resource?: string;
  headers?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string> | null;
  pathParameters?: Record<string, string> | null;
  body?: string | null;
  requestContext?: {
    requestId?: string;
    identity?: { sourceIp?: string };
    authorizer?: {
      sub?: string;
      email?: string;
      role?: string;
      roleRank?: string | number;
      mfa?: string | boolean;
      authTime?: string | number;
    };
  };
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface PaginationMeta {
  nextCursor: string | null;
  totalCount?: number;
}

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'MFA_REQUIRED'
  | 'REAUTH_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_FAILED'
  | 'INTERNAL';
