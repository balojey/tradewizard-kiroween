/**
 * Citation parsing and validation.
 *
 * A citation is only real if the exact record was sent to the model. Anything
 * else is dropped and the answer's confidence is lowered — hallucinated
 * citations are the failure mode that makes a grounded answer untrustworthy.
 *
 * See docs/plans/warden-ai-copilot.md §6 and §10.
 */

import type {
  CopilotCitation,
  CopilotKind,
  CopilotModelOutput,
  CopilotSuggestedAction,
  CitationType,
  RetrievedRecord,
} from '../types';

const VALID_TYPES: ReadonlySet<string> = new Set<CitationType>([
  'audit',
  'ticket',
  'analysis',
  'session',
  'setting',
  'metric',
  'runbook',
]);

/** `[audit:8f3c…]`, `[setting:copilot_enabled]`. */
const INLINE_CITATION = /\[(audit|ticket|analysis|session|setting|metric|runbook):([^\]\s]{1,200})\]/g;

export function recordKey(type: string, id: string): string {
  return `${type}:${id}`;
}

/**
 * Accept both a bare JSON object and one wrapped in a ```json fence, which is
 * what most models emit despite being told not to.
 */
export function parseModelJson(raw: string): CopilotModelOutput | null {
  if (!raw) return null;

  const candidates: string[] = [];
  const trimmed = raw.trim();

  candidates.push(trimmed);

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // Last resort: the outermost object, for models that add a sentence first.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as CopilotModelOutput;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

export function extractInlineCitations(answer: string): Array<{ type: string; id: string }> {
  const found: Array<{ type: string; id: string }> = [];
  let match: RegExpExecArray | null;

  INLINE_CITATION.lastIndex = 0;
  while ((match = INLINE_CITATION.exec(answer)) !== null) {
    found.push({ type: match[1], id: match[2] });
  }

  return found;
}

export interface CitationValidation {
  citations: CopilotCitation[];
  /** Citations the model produced that were not in the supplied context. */
  dropped: string[];
  /** Inline `[type:id]` markers with no matching record (also dropped). */
  unknownInline: number;
}

/**
 * Keep only citations that match a record we actually sent. Preserves the
 * model's order, deduplicates, and caps the list so the UI stays readable.
 */
export function validateCitations(
  fromModel: CopilotModelOutput | null,
  answer: string,
  records: RetrievedRecord[]
): CitationValidation {
  const byKey = new Map(records.map((record) => [recordKey(record.type, record.id), record]));

  const requested: Array<{ type: string; id: string }> = [];
  for (const citation of fromModel?.citations ?? []) {
    if (citation && typeof citation.type === 'string' && typeof citation.id === 'string') {
      requested.push({ type: citation.type, id: citation.id });
    }
  }

  const inline = extractInlineCitations(answer);
  requested.push(...inline);

  const seen = new Set<string>();
  const citations: CopilotCitation[] = [];
  const dropped: string[] = [];

  for (const item of requested) {
    const key = recordKey(item.type, item.id);
    const record = byKey.get(key);

    if (!record) {
      if (VALID_TYPES.has(item.type)) dropped.push(key);
      continue;
    }

    if (seen.has(key)) continue;
    seen.add(key);

    citations.push({
      type: record.type,
      id: record.id,
      label: record.label,
      url: record.url,
    });

    if (citations.length >= 12) break;
  }

  const unknownInline = inline.filter(
    (item) => !byKey.has(recordKey(item.type, item.id))
  ).length;

  return { citations, dropped, unknownInline };
}

/**
 * Suggested actions are links chosen from records that were retrieved. The
 * model may only label a citation; the URL always comes from our record, so a
 * prompt-injected "open this URL" cannot survive.
 */
export function resolveSuggestedActions(
  fromModel: CopilotModelOutput | null,
  citations: CopilotCitation[],
  records: RetrievedRecord[]
): CopilotSuggestedAction[] {
  const byKey = new Map(records.map((record) => [recordKey(record.type, record.id), record]));

  const actions: CopilotSuggestedAction[] = [];
  const seen = new Set<string>();

  for (const proposed of fromModel?.suggestedActions ?? []) {
    if (!proposed || typeof proposed.citationId !== 'string') continue;

    // Split on the first colon only: analysis signal ids are
    // `<analysisId>#signal:<agent>` and contain a second colon.
    const separator = proposed.citationId.indexOf(':');
    if (separator <= 0) continue;

    const type = proposed.citationId.slice(0, separator);
    const id = proposed.citationId.slice(separator + 1);
    if (!type || !id) continue;

    const record = byKey.get(recordKey(type, id));
    if (!record) continue;

    const url = record.url;
    if (seen.has(url)) continue;
    seen.add(url);

    actions.push({
      label: cleanLabel(proposed.label, record.label),
      url,
      kind: 'open',
    });

    if (actions.length >= 4) break;
  }

  // Deterministic fallback: a grounded answer should always offer at least one
  // route back to the records it used.
  if (actions.length === 0) {
    for (const citation of citations.slice(0, 3)) {
      if (seen.has(citation.url)) continue;
      seen.add(citation.url);
      actions.push({
        label: `Open ${citation.label}`,
        url: citation.url,
        kind: 'open',
      });
    }
  }

  return actions;
}

/** The human control for a given copilot surface, never an execution. */
export function reviewActions(
  kind: CopilotKind,
  context: { ticketId?: string; analysisId?: string; sessionId?: string; action?: string }
): CopilotSuggestedAction[] {
  switch (kind) {
    case 'support':
      return context.ticketId
        ? [
            {
              label: 'Review and edit the reply',
              url: `/support/${context.ticketId}#reply`,
              kind: 'review',
            },
          ]
        : [];
    case 'incident':
      return [
        { label: 'Open the audit log', url: '/audit', kind: 'review' },
        { label: 'Open operational health', url: '/ops', kind: 'review' },
      ];
    case 'analysis':
      return context.analysisId
        ? [
            {
              label: 'Review the analysis',
              url: `/analyses/${context.analysisId}`,
              kind: 'review',
            },
          ]
        : [];
    case 'session':
      return context.sessionId
        ? [
            {
              label: 'Open the session controls',
              url: `/portfolio/${context.sessionId}`,
              kind: 'review',
            },
          ]
        : [];
    case 'risk_brief':
      return [
        { label: 'Open runtime settings', url: '/settings', kind: 'review' },
        { label: 'Open the audit log', url: '/audit', kind: 'review' },
      ];
    default:
      return [];
  }
}

export function mergeActions(
  primary: CopilotSuggestedAction[],
  secondary: CopilotSuggestedAction[]
): CopilotSuggestedAction[] {
  const seen = new Set<string>();
  const merged: CopilotSuggestedAction[] = [];

  for (const action of [...primary, ...secondary]) {
    const key = `${action.kind}:${action.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(action);
  }

  return merged.slice(0, 5);
}

/**
 * Confidence drops when the model cited something that was never supplied —
 * even if the answer text looks fine, the grounding is no longer verifiable.
 */
export function lowerConfidence(
  raw: string | undefined,
  validation: CitationValidation,
  records: RetrievedRecord[]
): 'high' | 'medium' | 'low' {
  const base = raw === 'high' || raw === 'medium' || raw === 'low' ? raw : 'medium';

  if (records.length === 0) return 'low';
  if (validation.dropped.length > 0 || validation.unknownInline > 0) {
    return base === 'low' ? 'low' : 'medium';
  }
  if (validation.citations.length === 0) return 'low';

  return base;
}

function cleanLabel(label: unknown, fallback: string): string {
  if (typeof label !== 'string') return `Open ${fallback}`;

  const trimmed = label.trim().replace(/[\r\n]+/g, ' ').slice(0, 80);
  return trimmed.length >= 3 ? trimmed : `Open ${fallback}`;
}
