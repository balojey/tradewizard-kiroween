/**
 * Warden Copilot — transport and internal types.
 *
 * The copilot is a reader, not an operator. Nothing in this file (or anywhere
 * below `services/admin-copilot/`) can mutate a row, call a mutation route, or
 * instruct a Lambda to act. `suggestedActions` carries links only; there is no
 * `execute` variant because there is no execution path to describe.
 *
 * See docs/plans/warden-ai-copilot.md §4 and §6.
 */

import type { AdminRole } from '../shared/admin-auth';

export type CopilotKind = 'incident' | 'support' | 'risk_brief' | 'analysis' | 'session';

/** Everything the admin API is allowed to tell the copilot. */
export interface CopilotRequestContext {
  role: AdminRole;
  actorSub: string;
  from?: string;
  to?: string;
  ticketId?: string;
  analysisId?: string;
  userId?: string;
  sessionId?: string;
  /** Risk brief only: the action the operator is considering. */
  action?: string;
  targetType?: string;
  targetId?: string;
  payload?: unknown;
}

export interface CopilotRequest {
  kind: CopilotKind;
  question?: string;
  /** Support only: distinguishes a summary from a customer-facing draft. */
  mode?: 'summary' | 'draft_reply';
  context: CopilotRequestContext;
}

export type CitationType =
  | 'audit'
  | 'ticket'
  | 'analysis'
  | 'session'
  | 'setting'
  | 'metric'
  | 'runbook';

export interface CopilotCitation {
  type: CitationType;
  id: string;
  label: string;
  /** Relative portal path. The UI renders it with `<Link>`, never as raw HTML. */
  url: string;
}

export interface CopilotSuggestedAction {
  label: string;
  url: string;
  /** `open` navigates to a record; `review` opens the human control for review. */
  kind: 'open' | 'review';
}

export interface CopilotUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface CopilotResponse {
  answer: string;
  citations: CopilotCitation[];
  suggestedActions: CopilotSuggestedAction[];
  confidence: 'high' | 'medium' | 'low';
  limitations: string | null;
  model: string;
  generatedAt: string;
  usage: CopilotUsage;
}

/**
 * The Lambda returns an envelope rather than throwing: the portal needs a
 * typed error it can show ("copilot is switched off"), not a FunctionError.
 */
export type CopilotErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'COPILOT_DISABLED'
  | 'NOT_FOUND'
  | 'UPSTREAM_FAILED'
  | 'INTERNAL';

export type CopilotEnvelope =
  | { ok: true; response: CopilotResponse }
  | { ok: false; code: CopilotErrorCode; message: string };

/**
 * One retrieved, already-redacted record. `data` is the only thing the model
 * sees; `url` and `label` are resolved server-side so the model cannot invent a
 * link.
 */
export interface RetrievedRecord {
  type: CitationType;
  id: string;
  label: string;
  url: string;
  data: Record<string, unknown>;
  /** ISO timestamp, used to present incident records chronologically. */
  at?: string | null;
}

/** What the model is asked to return, before validation. */
export interface CopilotModelOutput {
  answer: string;
  citations?: Array<{ type?: string; id?: string }>;
  suggestedActions?: Array<{ label?: string; citationId?: string }>;
  confidence?: string;
  limitations?: string | null;
}
