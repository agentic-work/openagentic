/**
 * bedrock node executor — Tier C (streaming via SDK canonical normalizer).
 *
 * Posts to the platform's OpenAI-compatible chat-completion endpoint with
 * provider:'bedrock'. Streams the response so per-token canonical events
 * surface on the engine's frame stream.
 *
 * NO MODEL LITERALS: when node.data.model is unset, the model field falls
 * through to env (AWS_BEDROCK_CHAT_MODEL → DEFAULT_MODEL) — never a hard-coded
 * model string. Platform-wide rule: docs/rules/no-hardcoded-models.md.
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
  const { model, prompt, systemPrompt, temperature, maxTokens } = node.data as Record<
    string,
    any
  >;

  const resolvedPrompt = ctx.interpolateTemplate(prompt || '', input);
  const resolvedSystemPrompt = ctx.interpolateTemplate(systemPrompt || '', input);

  ctx.logger.info(
    { nodeId: node.id, model },
    '[bedrock] Executing (streaming)',
  );

  const messages: Array<{ role: string; content: string }> = [];
  if (resolvedSystemPrompt) {
    messages.push({ role: 'system', content: resolvedSystemPrompt });
  }
  messages.push({ role: 'user', content: resolvedPrompt });

  // Model resolution chain (NO LITERALS):
  //   node.data.model → AWS_BEDROCK_CHAT_MODEL → DEFAULT_MODEL → undefined.
  const effectiveModel =
    model || process.env.AWS_BEDROCK_CHAT_MODEL || process.env.DEFAULT_MODEL;

  const t0 = Date.now();
  const result = await withGenAISpan(
    {
      operation: 'chat',
      system: 'aws.bedrock',
      requestModel: effectiveModel ?? 'auto',
      maxTokens: maxTokens || 4096,
      temperature: temperature ?? 0.7,
    },
    async () => {
      const r = await streamLLMCompletion({
        apiUrl: ctx.apiUrl,
        model: effectiveModel ?? 'auto',
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
        extraBody: {
          provider: 'bedrock',
        },
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

  const content = result.fullText;
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
    model: returnedModel || effectiveModel || '',
    promptTokens,
    completionTokens,
    costUsd: 0,
    latencyMs,
    prompt: resolvedPrompt,
    completion: content,
  });

  return {
    content,
    model: returnedModel,
    usage,
    provider: 'bedrock',
  };
}
