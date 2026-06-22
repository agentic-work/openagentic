/**
 * reasoning node executor — Tier C (streaming via SDK canonical normalizer).
 *
 * Forces extended chain-of-thought (enableThinking:true) at max quality
 * (sliderPosition:100). Streams the chat-completions response through
 * streamLLMCompletion so per-token canonical events (text_delta,
 * thinking_delta when the upstream emits them) surface on the engine's
 * frame stream as `node_canonical` ExecutionEvents — same shape as
 * llm_completion (Tier B).
 *
 * NO MODEL LITERALS: defaults to 'auto' (Smart Router). Users can
 * override via modelOverride.
 *
 * Return contract preserved:
 *   { content, thinking, model, usage, provider: 'openagentic' }
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { streamLLMCompletion } from '../../llm/streamLLMCompletion.js';
import { withGenAISpan } from '../../observability/GenAITracer.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const { prompt, systemPrompt, thinkingBudget, maxTokens, modelOverride } =
    node.data as Record<string, any>;

  const resolvedPrompt = ctx.interpolateTemplate(prompt || '', input);
  const resolvedSystemPrompt = ctx.interpolateTemplate(systemPrompt || '', input);

  ctx.logger.info(
    { nodeId: node.id, thinkingBudget },
    '[reasoning] Executing (streaming)',
  );

  const messages: Array<{ role: string; content: string }> = [];
  if (resolvedSystemPrompt) {
    messages.push({ role: 'system', content: resolvedSystemPrompt });
  }
  messages.push({ role: 'user', content: resolvedPrompt });

  const effectiveModel = modelOverride || 'auto'; // Smart Router default — no literal
  const effectiveBudget = thinkingBudget || 10000;

  const t0 = Date.now();
  // reasoning passes extra fields (enableThinking, thinkingBudget,
  // sliderPosition) on the request body. streamLLMCompletion takes a
  // generic `extraBody` map so node-specific fields propagate verbatim.
  const result = await withGenAISpan(
    {
      operation: 'chat',
      system: 'openagentic.platform',
      requestModel: effectiveModel,
      maxTokens: maxTokens || 8192,
      temperature: 0.7,
    },
    async () => {
      const r = await streamLLMCompletion({
        apiUrl: ctx.apiUrl,
        model: effectiveModel,
        messages,
        temperature: 0.7,
        maxTokens: maxTokens || 8192,
        headers: {
          ...ctx.getInternalAuthHeaders(),
          'X-Workflow-Execution': ctx.executionId,
        },
        signal: ctx.signal,
        messageId: `wf_${ctx.executionId}_${node.id}`,
        onCanonical: (event) => {
          ctx.emitCanonical?.(event as unknown as { type: string } & Record<string, unknown>);
        },
        extraBody: {
          enableThinking: true,
          thinkingBudget: effectiveBudget,
          sliderPosition: 100, // Max quality for reasoning
        },
        timeoutMs: 180_000, // 3min — extended for reasoning
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
  const latencyMs = Date.now() - t0;

  const content = result.fullText;
  // Translate canonical {input_tokens, output_tokens} → legacy
  // {prompt_tokens, completion_tokens, total_tokens} so downstream
  // tracing / template references keep working.
  const completionTokens = result.usage?.output_tokens ?? 0;
  const promptTokens = result.usage?.input_tokens ?? 0;
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
  const returnedModel = result.model;

  void ctx.tracing?.recordCall({
    nodeId: node.id,
    executionId: ctx.executionId,
    workflowId: ctx.workflowId ?? ctx.executionId,
    tenantId: ctx.tenantId,
    model: returnedModel || effectiveModel,
    promptTokens,
    completionTokens,
    costUsd: 0,
    latencyMs,
    prompt: resolvedPrompt,
    completion: content,
  });

  return {
    content,
    // The SSE shim drops thinking deltas from the aggregate `fullText` —
    // they ride on canonical thinking_delta events instead. For the
    // executor's return contract we keep the legacy `thinking: ''`
    // placeholder; downstream consumers wanting chain-of-thought read
    // the per-token canonical events the engine forwarded.
    thinking: result.thinking ?? '',
    model: returnedModel,
    usage,
    provider: 'openagentic',
  };
}
