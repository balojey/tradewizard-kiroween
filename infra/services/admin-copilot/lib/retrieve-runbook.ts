/**
 * Runbook citations for the risk brief.
 *
 * Deliberately static: the risk brief may point at the written procedure for an
 * action, but it must not paraphrase a runbook it has never read. Each entry is
 * a short, true statement of what the human control does.
 *
 * See docs/plans/warden-ai-copilot.md §8 (runbook citations).
 */

import type { RetrievedRecord } from '../types';

interface RunbookEntry {
  id: string;
  match: RegExp;
  label: string;
  summary: string;
  url: string;
}

const RUNBOOK: RunbookEntry[] = [
  {
    id: 'kill-switch',
    match: /kill|halt|stop.?session|pause/i,
    label: 'Runbook: kill switch and session halt',
    summary:
      'A kill switch blocks new orders for the user; halting a session cancels working orders and exits the open position at market. Both are reversible only by a human, and both are audited with a reason.',
    url: '/ops',
  },
  {
    id: 'settings',
    match: /setting|pause|enable|disable|provider|flag/i,
    label: 'Runbook: runtime settings',
    summary:
      'Every setting names its consumer. A change takes effect within 60 seconds in warm containers and is audited with the previous value.',
    url: '/settings',
  },
  {
    id: 'refund',
    match: /refund|credit|charge|billing/i,
    label: 'Runbook: refunds and credit grants',
    summary:
      'Admin refunds mirror the failure-refund guarantee: at most one per user per analysis result, even on retry. The action is audited and requires a reason.',
    url: '/audit?action=analysis.refund',
  },
  {
    id: 'suspend',
    match: /suspend|ban|restrict|account/i,
    label: 'Runbook: account suspension',
    summary:
      'Suspending an account blocks new activations and sign-in; active sessions are not automatically stopped, so a kill switch may also be needed.',
    url: '/audit?action=user.status.update',
  },
];

export function retrieveRunbook(action: string | undefined): RetrievedRecord[] {
  if (!action) return [];

  return RUNBOOK.filter((entry) => entry.match.test(action)).map(
    (entry): RetrievedRecord => ({
      type: 'runbook',
      id: entry.id,
      label: entry.label,
      url: entry.url,
      data: {
        procedure: entry.label,
        summary: entry.summary,
        actionUnderReview: action,
      },
    })
  );
}
