/**
 * Copilot orchestration: disabled-check → retrieve → prompt → one call →
 * validate → envelope.
 *
 * Dependencies are injectable so the tests can assert the contract without a
 * database or Bedrock: one model call, a bounded prompt, and citations that can
 * only point at records we supplied.
 *
 * See docs/plans/warden-ai-copilot.md §4 and §6.
 */

import type { Client } from 'pg';
import { getSetting } from '../../shared/settings';
import { buildContext, CopilotError } from './build-context';
import {
  lowerConfidence,
  mergeActions,
  parseModelJson,
  resolveSuggestedActions,
  reviewActions,
  validateCitations,
} from './citations';
import { generateAnswer, type GenerateOutput } from './generate';
import { COPILOT_SYSTEM_PROMPT, buildUserPrompt } from './prompt';
import type { CopilotRequest, CopilotResponse, RetrievedRecord } from '../types';

export interface RunDeps {
  withClient: <T>(fn: (client: Client) => Promise<T>) => Promise<T>;
  generate: (input: {
    systemPrompt: string;
    userPrompt: string;
  }) => Promise<GenerateOutput>;
  isEnabled: () => Promise<boolean>;
  now: () => Date;
}

export async function runCopilot(
  request: CopilotRequest,
  overrides: Partial<RunDeps> = {}
): Promise<CopilotResponse> {
  validateRequest(request);

  const deps: RunDeps = {
    withClient: overrides.withClient ?? defaultWithClient,
    generate: overrides.generate ?? ((input) => generateAnswer(input)),
    isEnabled: overrides.isEnabled ?? defaultIsEnabled,
    now: overrides.now ?? (() => new Date()),
  };

  if (!(await deps.isEnabled())) {
    throw new CopilotError(
      'COPILOT_DISABLED',
      'The copilot is switched off. An owner can re-enable it in Runtime settings.'
    );
  }

  const now = deps.now();
  const context = await deps.withClient((client) => buildContext(client, request, now));
  const userPrompt = buildUserPrompt({
    kind: request.kind,
    question: context.question,
    role: context.role,
    window: context.window,
    records: context.records,
    mode: request.mode,
  });

  const startedAt = Date.now();
  const generated = await deps.generate({
    systemPrompt: COPILOT_SYSTEM_PROMPT,
    userPrompt,
  });
  const latencyMs = Date.now() - startedAt;

  const response = synthesizeResponse({
    request,
    records: context.records,
    generated,
    now,
  });

  // Structured CloudWatch line: latency, citation count, token usage, outcome.
  // No question text and no record content — this log is metadata only.
  console.log(
    JSON.stringify({
      metric: 'CopilotQuery',
      surface: request.kind,
      role: request.context.role,
      actorPrefix: request.context.actorSub.slice(0, 8),
      latencyMs,
      records: context.records.length,
      citations: response.citations.length,
      confidence: response.confidence,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      estimatedCostUsd: generated.estimatedCostUsd,
      model: generated.modelId,
      structured: Boolean(parseModelJson(generated.raw)),
    })
  );

  return response;
}

/**
 * Prompt → model output → validated envelope. Exported so the contract can be
 * tested without a database, and so nothing in the API layer can rebuild an
 * answer without the citation check.
 */
export function synthesizeResponse(input: {
  request: CopilotRequest;
  records: RetrievedRecord[];
  generated: GenerateOutput;
  now: Date;
}): CopilotResponse {
  const { request, records, generated } = input;
  const isDraft = request.kind === 'support' && request.mode === 'draft_reply';

  const fromModel = parseModelJson(generated.raw);
  const rawAnswer = normalizeAnswer(
    fromModel?.answer ?? (fromModel ? '' : generated.raw),
    Boolean(fromModel)
  );

  // Validate before stripping: inline markers still identify the records the
  // model relied on, they just must not reach the customer-facing draft.
  const validation = validateCitations(fromModel, rawAnswer, records);
  const answer = isDraft ? stripCitationMarkers(rawAnswer) : rawAnswer;
  const confidence = lowerConfidence(fromModel?.confidence, validation, records);

  const modelActions = resolveSuggestedActions(fromModel, validation.citations, records);
  const suggestedActions = mergeActions(
    modelActions,
    reviewActions(request.kind, {
      ticketId: request.context.ticketId,
      analysisId: request.context.analysisId,
      sessionId: request.context.sessionId,
      action: request.context.action,
    })
  );

  const limitations = buildLimitations({
    modelLimitations: fromModel?.limitations,
    droppedCitations: validation.dropped.length,
    unknownInline: validation.unknownInline,
    recordCount: records.length,
    structured: Boolean(fromModel),
    draft: isDraft,
  });

  return {
    answer,
    citations: validation.citations,
    suggestedActions,
    confidence,
    limitations,
    model: generated.modelId,
    generatedAt: input.now.toISOString(),
    usage: {
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      estimatedCostUsd: generated.estimatedCostUsd,
    },
  };
}

function validateRequest(request: CopilotRequest): void {
  if (!request || typeof request !== 'object') {
    throw new CopilotError('BAD_REQUEST', 'Malformed copilot request.');
  }

  const kinds = ['incident', 'support', 'risk_brief', 'analysis', 'session'];
  if (!kinds.includes(request.kind)) {
    throw new CopilotError('BAD_REQUEST', `Unknown copilot surface: ${String(request.kind)}`);
  }

  const context = request.context;
  if (!context || typeof context !== 'object') {
    throw new CopilotError('BAD_REQUEST', 'Missing copilot context.');
  }

  const roles = ['analyst', 'support', 'admin', 'owner'];
  if (!roles.includes(context.role)) {
    throw new CopilotError('BAD_REQUEST', 'Unknown admin role.');
  }

  if (!context.actorSub || typeof context.actorSub !== 'string') {
    throw new CopilotError('BAD_REQUEST', 'Missing actor.');
  }

  if (request.question !== undefined && typeof request.question !== 'string') {
    throw new CopilotError('BAD_REQUEST', 'question must be a string.');
  }

  if (
    request.mode !== undefined &&
    request.mode !== 'summary' &&
    request.mode !== 'draft_reply'
  ) {
    throw new CopilotError('BAD_REQUEST', 'Unknown support mode.');
  }
}

/**
 * The customer-facing draft must not contain internal citation markers. They
 * are validated first (so grounding still counts), then removed here.
 */
export function stripCitationMarkers(answer: string): string {
  return answer
    .replace(
      /\s*\[(?:audit|ticket|analysis|session|setting|metric|runbook):[^\]\s]{1,200}\]/g,
      ''
    )
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Answers are plain text, capped, and stripped of anything that could be read
 * as markup by a future renderer. The UI shows a plain-text block today.
 */
function normalizeAnswer(value: string, structured: boolean): string {
  const text = value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]{1,200}>/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, 6_000);

  if (text) return text;

  return structured
    ? 'The records were retrieved but the model returned no answer. Try a narrower question or a different window.'
    : 'The model did not return a structured answer. The raw response was empty.';
}

function buildLimitations(input: {
  modelLimitations: string | null | undefined;
  droppedCitations: number;
  unknownInline: number;
  recordCount: number;
  structured: boolean;
  draft?: boolean;
}): string | null {
  const notes: string[] = [];

  if (input.modelLimitations && typeof input.modelLimitations === 'string') {
    notes.push(input.modelLimitations.trim().slice(0, 400));
  }

  if (input.draft) {
    notes.push(
      'This is a model draft. Check names, amounts, and any commitment before sending.'
    );
  }

  if (input.recordCount === 0) {
    notes.push('No matching records were found in the requested window.');
  }

  if (input.droppedCitations > 0 || input.unknownInline > 0) {
    notes.push(
      `${input.droppedCitations + input.unknownInline} citation(s) could not be matched to a retrieved record and were removed.`
    );
  }

  if (!input.structured) {
    notes.push('The model returned prose instead of the structured envelope; confidence is low.');
  }

  return notes.length > 0 ? notes.join(' ') : null;
}

async function defaultIsEnabled(): Promise<boolean> {
  const value = await getSetting('copilot_enabled');
  return value === true || value === 'true';
}

async function defaultWithClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const { withClient } = await import('./db');
  return withClient(fn);
}
