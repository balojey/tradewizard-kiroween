/**
 * Warden Copilot — Lambda handler.
 *
 * Invoked only by `admin-api` (`lambda:InvokeFunction`, RequestResponse). It has
 * no API Gateway route of its own, no mutation permission, and no tools attached
 * to its model. The worst outcome of a compromised prompt here is a wrong
 * summary, not a changed setting.
 *
 * Returns an envelope instead of throwing so the API can distinguish
 * "disabled" from "upstream failed" without parsing a FunctionError.
 *
 * See docs/plans/warden-ai-copilot.md §4 and §6.
 */

import { CopilotError } from './lib/build-context';
import { ModelTimeoutError } from './lib/generate';
import { runCopilot } from './lib/run';
import type { CopilotEnvelope, CopilotRequest } from './types';

export async function handler(event: unknown): Promise<CopilotEnvelope> {
  const startedAt = Date.now();

  try {
    const request = event as CopilotRequest;
    const response = await runCopilot(request);

    return { ok: true, response };
  } catch (error) {
    if (error instanceof CopilotError) {
      return { ok: false, code: error.code, message: error.message };
    }

    if (error instanceof ModelTimeoutError) {
      console.error(
        JSON.stringify({
          metric: 'CopilotError',
          code: 'UPSTREAM_FAILED',
          durationMs: Date.now() - startedAt,
          error: error.message,
        })
      );

      return {
        ok: false,
        code: 'UPSTREAM_FAILED',
        message: 'The model did not answer in time. The portal still works; retry once.',
      };
    }

    console.error(
      JSON.stringify({
        metric: 'CopilotError',
        durationMs: Date.now() - startedAt,
        error: (error as Error).message,
        stack: (error as Error).stack,
      })
    );

    return {
      ok: false,
      code: 'INTERNAL',
      message: 'The copilot could not complete this request.',
    };
  }
}
