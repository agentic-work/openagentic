/**
 * openagentic_chat node executor — Tier C (streaming via SDK canonical normalizer).
 *
 * Smart Router default ('auto') — no literal model strings. modelOverride
 * lets the user pin a specific deployment; sliderOverride / enableThinking /
 * thinkingBudget are forwarded through to the API as extraBody.
 *
 * Auto-input-context injection: when the prompt has no template variables
 * AND input is non-null, the input is appended to the user message under
 * '--- Input Data ---'. Mirrors llm_completion behavior.
 *
 * Tier C (2026-05-13): per-token canonical events are forwarded via
 * streamLLMCompletion → ctx.emitCanonical so the UI sees text deltas in
 * real time — same shape llm_completion already emits.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { streamLLMCompletion } from '../../llm/streamLLMCompletion.js';
import { stripLeadingReasoning } from '../../llm/stripReasoning.js';
import { withGenAISpan } from '../../observability/GenAITracer.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const {
    prompt,
    systemPrompt,
    temperature,
    maxTokens,
    modelOverride,
    sliderOverride,
    enableThinking,
    thinkingBudget,
  } = node.data as Record<string, any>;

  const resolvedPrompt = ctx.interpolateTemplate(prompt || '', input);
  const resolvedSystemPrompt = ctx.interpolateTemplate(systemPrompt || '', input);

  ctx.logger.info(
    { nodeId: node.id, modelOverride, sliderOverride },
    '[openagentic_chat] Executing (streaming)',
  );

  const messages: Array<{ role: string; content: string }> = [];
  if (resolvedSystemPrompt) {
    messages.push({ role: 'system', content: resolvedSystemPrompt });
  }

  // Auto-append input context when prompt doesn't reference template variables.
  let userContent = resolvedPrompt;
  const hadTemplateVars = (prompt || '').includes('{{');
  if (!hadTemplateVars && input != null) {
    const inputStr =
      typeof input === 'string'
        ? input
        : typeof input === 'object'
          ? JSON.stringify(input, null, 2)
          : String(input);
    if (inputStr && inputStr !== '{}' && inputStr !== 'null') {
      userContent = `${resolvedPrompt}\n\n--- Input Data ---\n${inputStr}`;
    }
  }

  // Defense-in-depth: never send an empty user message to a provider.
  if ((!userContent || userContent.trim() === '') && input != null) {
    userContent =
      typeof input === 'string'
        ? input
        : typeof input === 'object'
          ? JSON.stringify(input, null, 2)
          : String(input);
  }

  if (!userContent || userContent.trim() === '') {
    throw new Error(
      `[openagentic_chat] Cannot send empty user message — prompt "${prompt || ''}" interpolated to empty and no input was provided.`,
    );
  }

  messages.push({ role: 'user', content: userContent });

  // Model resolution: modelOverride wins, else Smart Router 'auto'.
  const effectiveModel = modelOverride || 'auto';

  // Non-canonical fields ride on extraBody so streamLLMCompletion can
  // merge them into the request without growing its surface.
  const extraBody: Record<string, unknown> = {
    // Ask the OpenAI-shape stream for the trailing usage chunk so the node
    // result reports real token counts (was total_tokens:0 — live 2026-06-02).
    stream_options: { include_usage: true },
  };
  if (sliderOverride !== null && sliderOverride !== undefined) {
    extraBody.sliderPosition = sliderOverride;
  }
  if (enableThinking) {
    extraBody.enableThinking = true;
    extraBody.thinkingBudget = thinkingBudget || 8000;
  }

  const t0 = Date.now();
  const result = await withGenAISpan(
    {
      operation: 'chat',
      system: 'openagentic.platform',
      requestModel: effectiveModel,
      maxTokens: maxTokens || 4096,
      temperature: temperature ?? 0.7,
    },
    async () => {
      const r = await streamLLMCompletion({
        apiUrl: ctx.apiUrl,
        model: effectiveModel,
        messages,
        temperature: temperature ?? 0.7,
        maxTokens: maxTokens || 4096,
        headers: {
          ...ctx.getInternalAuthHeaders(),
          'X-Workflow-Execution': ctx.executionId,
        },
        signal: ctx.signal,
        messageId: `wf_${ctx.executionId}_${node.id}`,
        onCanonical: (event) => {
          ctx.emitCanonical?.(event as unknown as { type: string } & Record<string, unknown>);
        },
        extraBody,
        timeoutMs: 120_000,
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

  // Strip the leaked gpt-oss Harmony "analysis" channel (reasoning prose glued
  // onto the final answer by the OpenAI shim) so .content is the real answer
  // and downstream {{steps.X.content}} consumers don't get garbage
  // (live defect 2026-06-02).
  const content = stripLeadingReasoning(result.fullText);
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
    prompt: userContent,
    completion: content,
  });

  return {
    content,
    model: returnedModel,
    usage,
    provider: 'openagentic',
  };
}
