/**
 * structured_output node executor — Tier C (streaming via SDK canonical normalizer).
 *
 * Behavior pinned:
 *   - streams /api/v1/chat/completions with response_format:{type:'json_object'}
 *   - retries up to maxRetries on JSON.parse failure
 *   - returns { output, model, attempts, raw } on success
 *   - returns { output:null, error, raw, model, attempts } when all retries fail
 *
 * Tier C (2026-05-13): per-token canonical events are forwarded via
 * streamLLMCompletion → ctx.emitCanonical so the UI sees JSON tokens
 * stream in. The aggregated text is JSON.parsed at end-of-stream — same
 * behavior the legacy non-streaming path had.
 *
 * NO MODEL LITERALS: defaults to 'auto' (Smart Router).
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { streamLLMCompletion } from '../../llm/streamLLMCompletion.js';
import { withGenAISpan } from '../../observability/GenAITracer.js';

/**
 * Permissive JSON extractor: tolerates prose prefix/suffix + ```json fences.
 *
 * Strategy in order:
 *   1. Strip fences + whitespace, try JSON.parse on the whole string.
 *   2. Scan for the first balanced top-level `{...}` or `[...]` block
 *      (respects nested braces inside strings — quote-aware), try parse.
 *
 * Returns the parsed object on success, throws on failure. Used by
 * structured_output to recover from weak models (e.g. gpt-oss:20b) that
 * emit reasoning prose before the JSON envelope. With Ollama's
 * `format: 'json'` grammar mode the model SHOULD emit clean JSON, but
 * this defensive fallback catches any provider that ignores the field.
 */
function tryParseJsonRobust(raw: string): unknown {
  const stripped = raw.replace(/```json\n?|\n?```/g, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Fall through to balanced-block extraction.
  }

  // Pick the EARLIEST occurrence of `{` or `[` in the stripped text so a
  // top-level array isn't pre-empted by a `{}` nested inside it. Quote-aware
  // scanner that tolerates braces/brackets inside string literals.
  const objIdx = stripped.indexOf('{');
  const arrIdx = stripped.indexOf('[');
  const candidates: Array<{ open: string; close: string; start: number }> = [];
  if (objIdx >= 0) candidates.push({ open: '{', close: '}', start: objIdx });
  if (arrIdx >= 0) candidates.push({ open: '[', close: ']', start: arrIdx });
  candidates.sort((a, b) => a.start - b.start);

  for (const { open, close, start } of candidates) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < stripped.length; i++) {
      const ch = stripped[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const candidate = stripped.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break; // bail this open-char; try the next one
          }
        }
      }
    }
  }

  throw new Error('No parseable JSON block found in model output');
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;
  const model = ctx.interpolateTemplate(data.model || 'auto', input);
  const schema = data.schema || '{}';
  const promptInput =
    ctx.interpolateTemplate(data.prompt || '', input) ||
    (typeof input === 'string'
      ? input
      : (input as any)?.content || (input as any)?.prompt || '');
  const maxRetries = data.maxRetries ?? 2;

  ctx.logger.info(
    { nodeId: node.id, model },
    '[structured_output] Executing (streaming)',
  );

  const systemPrompt = `You MUST respond with valid JSON matching this schema:\n${schema}\n\nDo not include markdown code fences. Return ONLY the JSON object.`;

  let lastRaw = '';
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let returnedModel: string | undefined;
  const t0 = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let raw = '';
    try {
      // One OTel span per attempt — operators can slice retries by
      // gen_ai.response.finish_reasons and see attempt latency separately.
      const result = await withGenAISpan(
        {
          operation: 'chat',
          system: 'openagentic.platform',
          requestModel: model,
          maxTokens: 4096,
          temperature: 0.1,
        },
        async () => {
          const r = await streamLLMCompletion({
            apiUrl: ctx.apiUrl,
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: promptInput },
            ],
            temperature: 0.1,
            maxTokens: 4096,
            headers: {
              ...ctx.getInternalAuthHeaders(),
              'X-Workflow-Execution': ctx.executionId,
            },
            signal: ctx.signal,
            messageId: `wf_${ctx.executionId}_${node.id}_a${attempt}`,
            onCanonical: (event) => {
              ctx.emitCanonical?.(event as unknown as { type: string } & Record<string, unknown>);
            },
            extraBody: {
              response_format: { type: 'json_object' },
            },
            timeoutMs: 60_000,
          });
          return {
            result: r,
            meta: {
              responseModel: r.model,
              finishReasons: r.stopReason ? [r.stopReason] : undefined,
              inputTokens: r.usage?.input_tokens,
              outputTokens: r.usage?.output_tokens,
            },
          };
        },
      );

      raw = result.fullText;
      lastRaw = raw;
      // Canonical {output_tokens, input_tokens} → legacy counters.
      totalCompletionTokens += result.usage?.output_tokens ?? 0;
      totalPromptTokens += result.usage?.input_tokens ?? 0;
      if (!returnedModel) returnedModel = result.model;
    } catch (err) {
      // streamLLMCompletion throws on non-2xx; mirror legacy retry-on-fail.
      lastRaw = err instanceof Error ? err.message : String(err);
      if (attempt === maxRetries) {
        const latencyMs = Date.now() - t0;
        void ctx.tracing?.recordCall({
          nodeId: node.id,
          executionId: ctx.executionId,
          workflowId: ctx.workflowId ?? ctx.executionId,
          tenantId: ctx.tenantId,
          model: returnedModel || model,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          costUsd: 0,
          latencyMs,
          prompt: promptInput,
          completion: lastRaw,
          error: 'Failed to parse structured output after retries',
        });
        return {
          output: null,
          error: 'Failed to parse structured output after retries',
          raw: lastRaw,
          model: returnedModel || model,
          attempts: attempt + 1,
        };
      }
      continue;
    }

    try {
      const parsed = tryParseJsonRobust(raw);
      const latencyMs = Date.now() - t0;
      void ctx.tracing?.recordCall({
        nodeId: node.id,
        executionId: ctx.executionId,
        workflowId: ctx.workflowId ?? ctx.executionId,
        tenantId: ctx.tenantId,
        model: returnedModel || model,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        costUsd: 0,
        latencyMs,
        prompt: promptInput,
        completion: raw,
      });
      return { output: parsed, model: returnedModel || model, attempts: attempt + 1, raw };
    } catch {
      if (attempt === maxRetries) {
        const latencyMs = Date.now() - t0;
        void ctx.tracing?.recordCall({
          nodeId: node.id,
          executionId: ctx.executionId,
          workflowId: ctx.workflowId ?? ctx.executionId,
          tenantId: ctx.tenantId,
          model: returnedModel || model,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          costUsd: 0,
          latencyMs,
          prompt: promptInput,
          completion: lastRaw,
          error: 'Failed to parse structured output after retries',
        });
        return {
          output: null,
          error: 'Failed to parse structured output after retries',
          raw: lastRaw,
          model: returnedModel || model,
          attempts: attempt + 1,
        };
      }
    }
  }

  // Unreachable — loop always returns. Fallback for type safety.
  return {
    output: null,
    error: 'Failed to parse structured output after retries',
    raw: lastRaw,
    model: returnedModel || model,
    attempts: maxRetries + 1,
  };
}
