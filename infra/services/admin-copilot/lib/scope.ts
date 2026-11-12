/**
 * Role scoping for copilot retrieval.
 *
 * This is the second line of defence, not the first: the admin API already
 * gates each endpoint with `requireRole`, and the retrieval code re-checks the
 * surface because a future route must not be able to widen the copilot by
 * passing a different role string.
 *
 * Vocabulary is the portal's existing one (`AdminRole`), deliberately not a
 * second role model. See docs/plans/warden-ai-copilot.md §5.
 */

import type { AdminRole } from '../../shared/admin-auth';

export type Surface =
  | 'audit'
  | 'support'
  | 'analysis'
  | 'session'
  | 'setting'
  | 'metrics'
  | 'runbook';

/**
 * analyst: operational read surfaces only — never customer PII or settings.
 * support: everything needed to answer a customer, but not settings.
 * admin/owner: everything the portal already shows them.
 */
const ALLOWED: Record<AdminRole, ReadonlySet<Surface>> = {
  analyst: new Set<Surface>(['audit', 'analysis', 'metrics', 'runbook']),
  support: new Set<Surface>(['audit', 'support', 'analysis', 'session', 'metrics', 'runbook']),
  admin: new Set<Surface>([
    'audit',
    'support',
    'analysis',
    'session',
    'setting',
    'metrics',
    'runbook',
  ]),
  owner: new Set<Surface>([
    'audit',
    'support',
    'analysis',
    'session',
    'setting',
    'metrics',
    'runbook',
  ]),
};

export function canRead(role: AdminRole, surface: Surface): boolean {
  return ALLOWED[role]?.has(surface) ?? false;
}

/** True when the role may see customer identity (email, account status). */
export function canReadCustomerIdentity(role: AdminRole): boolean {
  return role === 'support' || role === 'admin' || role === 'owner';
}
