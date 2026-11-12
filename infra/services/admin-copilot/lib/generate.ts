/**
 * One model call. No tool loop, no retries beyond a single transient retry.
 *
 * Provider selection reuses `shared/ai-provider`, so the copilot follows the
 * deployment's AI_PROVIDER switch and never introduces a second inference path.
 * The model is created without tools, which is what makes the read-only promise
 * structural rather than a matter of prompt wording.
 *
 * See docs/plans/warden-ai-copilot.md §6 and §9.
 */

import { Agent } from '@strands-agents/sdk';
import {
  createProviderModel,
  getNebiusModelId,
  resolveAiProvider,
  type ProviderModelSpec,
} from '../../shared/ai-provider';

export const DEFAULT_MAX_OUTPUT_TOKENS = 1_200;
const MAX_OUTPUT_TOKENS_CEILING = 2_000;
const MODEL_TIMEOUT_MS = 20_000;
/**
 * Hard ceiling for generation, including the retry. The copilot Lambda has 30 s
 * and admin-api has 29 s; two independent 20 s waits would guarantee a 504, so
 * the retry only gets whatever remains of this budget.
 */
const TOTAL_BUDGET_MS = 22_000;

/**
 * Rough rates for the usage metric. Labelled `estimated` everywhere it appears;
 * the point is to make a spike visible, not to reconcile an invoice.
 */
const INPUT_COST_PER_1K = Number(process.env.COPILOT_INPUT_COST_PER_1K_USD ?? '0.0008');
const OUTPUT_COST_PER_1K = Number(process.env.COPILOT_OUTPUT_COST_PER_1K_USD ?? '0.0032');

export interface GenerateInput {
  systemPrompt: string;
  userPrompt: string;
  /** Injectable for tests; defaults to the Strands agent. */
  invoke?: (input: { systemPrompt: string; userPrompt: string }) => Promise<string>;
  timeoutMs?: number;
  maxTokens?: number;
}

export interface GenerateOutput {
  raw: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export class ModelTimeoutError extends Error {
  constructor() {
    super('The model did not answer in time.');
    this.name = 'ModelTimeoutError';
  }
}

export function resolveCopilotModelSpec(): ProviderModelSpec {
  const provider = resolveAiProvider();
  const maxTokens = clampTokens(
    Number(process.env.COPILOT_MAX_TOKENS ?? String(DEFAULT_MAX_OUTPUT_TOKENS))
  );

  if (provider === 'nebius') {
    return {
      provider,
      modelId: getNebiusModelId('non_tool'),
      maxTokens,
    };
  }

  return {
    provider,
    modelId:
      process.env.COPILOT_MODEL_ID ||
      process.env.BEDROCK_MODEL_ID ||
      'global.amazon.nova-2-lite-v1:0',
    region: process.env.AWS_REGION || 'us-east-1',
    maxTokens,
  };
}

export async function generateAnswer(input: GenerateInput): Promise<GenerateOutput> {
  const spec = resolveCopilotModelSpec();
  const timeoutMs = input.timeoutMs ?? MODEL_TIMEOUT_MS;
  const deadline = Date.now() + Math.max(timeoutMs, TOTAL_BUDGET_MS);
  const invoke = input.invoke ?? defaultInvoke(spec, input.maxTokens ?? spec.maxTokens);

  let raw: string;

  try {
    raw = await withTimeout(invoke(input), Math.min(timeoutMs, deadline - Date.now()));
  } catch (error) {
    if (error instanceof ModelTimeoutError) throw error;

    const remaining = deadline - Date.now();
    if (remaining < 1_000) throw error;

    console.warn(
      JSON.stringify({
        metric: 'CopilotModelRetry',
        modelId: spec.modelId,
        error: (error as Error).message,
      })
    );

    // Exactly one retry, inside the remaining budget. A timeout is never
    // retried: the Lambda deadline is the real budget.
    raw = await withTimeout(invoke(input), Math.min(timeoutMs, remaining));
  }

  const inputTokens = estimateTokens(input.systemPrompt) + estimateTokens(input.userPrompt);
  const outputTokens = estimateTokens(raw);

  return {
    raw,
    modelId: spec.modelId,
    inputTokens,
    outputTokens,
    estimatedCostUsd: round6(
      (inputTokens / 1_000) * INPUT_COST_PER_1K + (outputTokens / 1_000) * OUTPUT_COST_PER_1K
    ),
  };
}

function defaultInvoke(
  spec: ProviderModelSpec,
  maxTokens: number
): (input: { systemPrompt: string; userPrompt: string }) => Promise<string> {
  return async ({ systemPrompt, userPrompt }) => {
    const model = createProviderModel({ ...spec, maxTokens });
    const agent = new Agent({ model, systemPrompt, printer: false });
    return String(await agent.invoke(userPrompt));
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ModelTimeoutError()), timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** ~4 characters per token; only used for the cost metric and the UI note. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

function clampTokens(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(Math.max(Math.trunc(value), 256), MAX_OUTPUT_TOKENS_CEILING);
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
