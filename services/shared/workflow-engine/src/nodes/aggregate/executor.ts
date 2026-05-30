/**
 * aggregate node executor — LLM-driven reduce / map over a list.
 *
 * Modes:
 *   reduce — one LLM call with the entire array serialized into the
 *            prompt. Returns a single string output.
 *   map    — one LLM call per item. Returns an array of strings.
 *
 * Wire path: workflows-svc engine → streamLLMCompletion → platform shim
 * /api/v1/chat/completions → ProviderManager (DB-backed model registry).
 * Same /v1 path as llm_completion / llm_router / structured_output.
 * Smart Router (model:'auto') is the recommended default — the registry
 * is the SoT for routable models.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { streamLLMCompletion } from '../../llm/streamLLMCompletion.js';
import { withGenAISpan } from '../../observability/GenAITracer.js';

const DEFAULT_REDUCE_SYSTEM_PROMPT =
  'You are an aggregation assistant. Given a list of items, produce a concise, ' +
  'high-signal summary that captures every distinct theme without losing important ' +
  'details. No preamble; no commentary about the task itself.';

const DEFAULT_MAP_SYSTEM_PROMPT =
  'You are a transformation assistant. Given a single item, produce the requested ' +
  'output for that item. No preamble; no meta-narration.';

function coerceItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through — non-JSON string isn't a valid array
    }
  }
  throw new Error(
    `aggregate requires an array of items — got ${raw === null ? 'null' : typeof raw}. ` +
      'Use a JSON-serialized array (string) or an actual array.',
  );
}

interface RunCallOpts {
  ctx: NodeExecutionContext;
  node: WorkflowNode;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  userPrompt: string;
  messageId: string;
}

async function runCall(opts: RunCallOpts): Promise<{
  text: string;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}> {
  const { ctx, node, model, temperature, maxTokens, systemPrompt, userPrompt, messageId } = opts;
  const result = await withGenAISpan(
    {
      operation: 'chat',
      system: 'openagentic.platform',
      requestModel: model,
      maxTokens,
      temperature,
    },
    async () => {
      const r = await streamLLMCompletion({
        apiUrl: ctx.apiUrl,
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        maxTokens,
        headers: {
          ...ctx.getInternalAuthHeaders(),
          'X-Workflow-Execution': ctx.executionId,
        },
        signal: ctx.signal,
        messageId,
        onCanonical: (event) => {
          ctx.emitCanonical?.(event as unknown as { type: string } & Record<string, unknown>);
        },
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
  return {
    text: result.fullText,
    model: result.model,
    usage: result.usage,
  };
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;

  const itemsRaw = data.items;
  const promptRaw = data.prompt;
  const mode = (data.mode as string | undefined) || 'reduce';
  const model = (data.model as string | undefined) || 'auto';
  const temperature = typeof data.temperature === 'number' ? data.temperature : 0.2;
  const maxTokens = typeof data.maxTokens === 'number' ? data.maxTokens : 1024;
  const customSystemPrompt = data.systemPrompt as string | undefined;

  if (!promptRaw) throw new Error('aggregate requires `prompt`.');
  if (mode !== 'reduce' && mode !== 'map') {
    throw new Error(`aggregate mode must be 'reduce' or 'map' — got '${mode}'.`);
  }

  // items field may be a templated string (must be interpolated first)
  // or a JSON array passed verbatim.
  const itemsResolved =
    typeof itemsRaw === 'string' ? ctx.interpolateTemplate(itemsRaw, input) : itemsRaw;
  const items = coerceItems(itemsResolved);

  if (items.length === 0) {
    ctx.logger.info(
      { nodeId: node.id, mode, itemsIn: 0 },
      '[aggregate] No items — returning empty output without LLM call',
    );
    return {
      mode,
      output: mode === 'map' ? [] : '',
      items_in: 0,
      model,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  const systemPrompt =
    customSystemPrompt
      ? ctx.interpolateTemplate(customSystemPrompt, input)
      : mode === 'map'
        ? DEFAULT_MAP_SYSTEM_PROMPT
        : DEFAULT_REDUCE_SYSTEM_PROMPT;

  ctx.logger.info(
    { nodeId: node.id, mode, itemsIn: items.length, model },
    '[aggregate] Running LLM aggregation',
  );

  let outputUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let returnedModel: string | undefined;

  if (mode === 'reduce') {
    const promptStr = ctx.interpolateTemplate(String(promptRaw), {
      ...((input as Record<string, unknown>) ?? {}),
      items: JSON.stringify(items, null, 2),
    });
    const callResult = await runCall({
      ctx,
      node,
      model,
      temperature,
      maxTokens,
      systemPrompt,
      userPrompt: promptStr,
      messageId: `wf_${ctx.executionId}_${node.id}`,
    });
    returnedModel = callResult.model;
    if (callResult.usage) {
      outputUsage.prompt_tokens = callResult.usage.input_tokens ?? 0;
      outputUsage.completion_tokens = callResult.usage.output_tokens ?? 0;
      outputUsage.total_tokens = outputUsage.prompt_tokens + outputUsage.completion_tokens;
    }
    return {
      mode: 'reduce',
      output: callResult.text,
      items_in: items.length,
      model: returnedModel ?? model,
      usage: outputUsage,
    };
  }

  // mode === 'map'
  const mapped: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemStr = typeof item === 'string' ? item : JSON.stringify(item, null, 2);
    const promptStr = ctx.interpolateTemplate(String(promptRaw), {
      ...((input as Record<string, unknown>) ?? {}),
      item: itemStr,
      itemIndex: String(i),
    });
    const callResult = await runCall({
      ctx,
      node,
      model,
      temperature,
      maxTokens,
      systemPrompt,
      userPrompt: promptStr,
      messageId: `wf_${ctx.executionId}_${node.id}_i${i}`,
    });
    mapped.push(callResult.text);
    if (callResult.model) returnedModel = callResult.model;
    if (callResult.usage) {
      outputUsage.prompt_tokens += callResult.usage.input_tokens ?? 0;
      outputUsage.completion_tokens += callResult.usage.output_tokens ?? 0;
    }
  }
  outputUsage.total_tokens = outputUsage.prompt_tokens + outputUsage.completion_tokens;

  return {
    mode: 'map',
    output: mapped,
    items_in: items.length,
    model: returnedModel ?? model,
    usage: outputUsage,
  };
}
