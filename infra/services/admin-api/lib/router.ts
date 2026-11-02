/**
 * Declarative route table for the admin API.
 *
 * Rules (see docs/admin-portal-architecture.md §17.1):
 * - Every route declares an explicit minimum role. There is no default.
 * - Every route is exercised by the RBAC matrix test; adding a route without a
 *   matrix entry fails the build.
 * - Path templates use `{param}` and compile to a regex with named captures.
 */

import type { AdminRole } from '../../shared/admin-auth';
import type { AdminIdentity } from '../../shared/admin-auth';
import type { AdminApiEvent, ApiResponse } from './types';
import { meRoute } from '../routes/me';
import { usersRoutes } from '../routes/users';
import { analysesRoutes } from '../routes/analyses';
import { portfolioRoutes } from '../routes/portfolio';
import { agentsRoutes, billingRoutes } from '../routes/billing-agents';
import { opsRoutes } from '../routes/ops';
import { marketsRoutes } from '../routes/markets';
import { dashboardRoutes } from '../routes/dashboard';
import { auditRoutes } from '../routes/audit';
import { userMutationRoutes } from '../routes/user-mutations';
import { portfolioMutationRoutes } from '../routes/portfolio-mutations';
import { killSwitchRoutes } from '../routes/kill-switch';
import { memberRoutes } from '../routes/members';

export interface RouteContext {
  event: AdminApiEvent;
  identity: AdminIdentity;
  params: Record<string, string>;
}

export interface AdminRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Template such as `/admin/users/{id}`. */
  path: string;
  minimumRole: AdminRole;
  handler: (context: RouteContext) => Promise<ApiResponse>;
}

interface CompiledRoute {
  route: AdminRoute;
  regex: RegExp;
  keys: string[];
}

function compile(route: AdminRoute): CompiledRoute {
  const keys: string[] = [];
  const pattern = route.path
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{(\w+)\\\}/g, (_match, key: string) => {
      keys.push(key);
      return '([^/]+)';
    });

  return {
    route,
    keys,
    regex: new RegExp(`^${pattern}$`),
  };
}

export const ROUTES: AdminRoute[] = [
  meRoute,
  ...usersRoutes,
  ...analysesRoutes,
  ...portfolioRoutes,
  ...billingRoutes,
  ...agentsRoutes,
  ...opsRoutes,
  ...marketsRoutes,
  ...dashboardRoutes,
  ...auditRoutes,
  ...userMutationRoutes,
  ...portfolioMutationRoutes,
  ...killSwitchRoutes,
  ...memberRoutes,
];

const COMPILED: CompiledRoute[] = ROUTES.map(compile);

export interface RouteMatch {
  route: AdminRoute;
  params: Record<string, string>;
}

export function matchRoute(method: string, path: string): RouteMatch | null {
  for (const { route, regex, keys } of COMPILED) {
    if (route.method !== method) continue;

    const match = regex.exec(path);
    if (!match) continue;

    const params: Record<string, string> = {};
    keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });

    return { route, params };
  }

  return null;
}
