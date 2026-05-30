/**
 * dispatchLLM — one-shot dispatch of a resolved routing decision through the
 * provider pool, with declarative retry on retryable errors + cascade through
 * the ResolveOutput's fallbackChain.
 *
 * This is the ONLY place call sites should hand off from a ModelRouter decision
 * to the ProviderManager. Never invoke provider.createCompletion() directly from
 * a route handler — you'll lose the fallback semantics.
 *
 * Design rules:
 *   - Retry only on network / 5xx / 429. Never on 4xx, auth failures, capability
 *     mismatches, or malformed request. Those propagate verbatim.
 *   - Fallback is declarative: it walks resolved.fallbackChain[], calling back
 *     into the router so each fallback gets a fresh health + capability check.
 *   - One dispatch call = one LLM call from the user's perspective. The caller
 *     decides whether to surface fallback as a UI "handoff pill" via the reason
 *     field in the final result.
 */

import type { Logger } from 'pino';
import type { ResolveOutput, ResolveInput } from './types.js';
import { UnhealthyProviderError } from './types.js';
import type { ModelRouter } from './ModelRouter.js';

export type DispatchFn<TReq, TResp> = (
  providerName: string,
  modelId: string,
  request: TReq,
) => Promise<TResp>;

export interface DispatchContext<TReq, TResp> {
  router: ModelRouter;
  logger: Logger;
  /**
   * Adapter that takes (providerName, modelId, request) and calls the actual
   * provider instance. Kept injectable so we don't couple the router layer to
   * ProviderManager's exact API — that binding happens at call-site wiring.
   */
  invoke: DispatchFn<TReq, TResp>;
}

export async function dispatchLLM<TReq, TResp>(
  ctx: DispatchContext<TReq, TResp>,
  resolved: ResolveOutput,
  resolveInput: ResolveInput,
  request: TReq,
): Promise<TResp> {
  return attempt(ctx, resolved, resolveInput, request, new Set<string>([resolved.modelId]));
}

async function attempt<TReq, TResp>(
  ctx: DispatchContext<TReq, TResp>,
  resolved: ResolveOutput,
  resolveInput: ResolveInput,
  request: TReq,
  tried: Set<string>,
): Promise<TResp> {
  try {
    return await ctx.invoke(resolved.providerName, resolved.modelId, request);
  } catch (err: any) {
    if (!isRetryable(err)) throw err;

    const nextId = resolved.fallbackChain.find((id) => !tried.has(id));
    if (!nextId) throw err;

    ctx.logger.warn({
      event: 'dispatch.cascade',
      failed: resolved.modelId,
      failedProvider: resolved.providerName,
      fallback: nextId,
      err: err.message,
      status: err.status,
    }, '[dispatchLLM] primary failed, cascading to fallback');

    // Re-resolve so the fallback model also passes the health + capability gates.
    // If the fallback itself is unhealthy, router.resolve() will cascade again
    // internally OR throw UnhealthyProviderError, which we re-throw.
    try {
      const fb = await ctx.router.resolve({ ...resolveInput, requestedModel: nextId });
      tried.add(fb.modelId);
      return await attempt(ctx, fb, resolveInput, request, tried);
    } catch (fbErr) {
      // Throw the ORIGINAL error, not the fallback's. The original is what
      // made us cascade; we keep it as the user-facing cause. Include the
      // fallback failure reason in the log so ops can see both.
      ctx.logger.error({
        event: 'dispatch.cascade_exhausted',
        primary: resolved.modelId,
        attempted: Array.from(tried),
        primaryErr: err.message,
        fallbackErr: (fbErr as Error).message,
      }, '[dispatchLLM] all fallbacks exhausted');
      if (fbErr instanceof UnhealthyProviderError) throw fbErr;
      throw err;
    }
  }
}

/**
 * Classify an error as retry-worthy. Conservative by default: if we can't tell,
 * don't retry. Callers want loud failures over silent model swaps.
 */
export function isRetryable(err: any): boolean {
  if (!err) return false;
  // Explicit HTTP status classification
  const status = typeof err.status === 'number' ? err.status
    : typeof err.statusCode === 'number' ? err.statusCode
    : typeof err.code === 'number' ? err.code
    : undefined;
  if (status !== undefined) {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false; // every other explicit status is NOT retryable
  }
  // Network / abort / timeout heuristics — AWS SDK, Node fetch, etc.
  const code = typeof err.code === 'string' ? err.code : '';
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') return true;
  const name = typeof err.name === 'string' ? err.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  // Unclassified — don't retry.
  return false;
}
