/**
 * llm_completion node executor — Tier B (streaming via SDK canonical normalizer).
 *
 * Migrated from WorkflowExecutionEngine.executeLLMNode (lines ~1441-1506).
 * Behavior preserved: templated prompt, optional system prompt, automatic
 * input-context appending when the prompt has no template variables,
 * Smart Router default model.
 *
 * Tier B (2026-05-13): the executor now streams the chat-completions
 * response via the `streamLLMCompletion` helper, which pipes each provider
 * chunk through the SDK `selectCanonicalNormalizer('openai')` state
 * machine. Each emitted `CanonicalEvent` is forwarded to the engine via
 * `ctx.emitCanonical(...)` and surfaces on the execution stream as a
 * `node_canonical` ExecutionEvent so the UI can render per-token deltas
 * in real time — identical to the chatmode V3 streamProvider pattern.
 *
 * Return contract preserved: `{ content, model, usage }` — downstream
 * nodes reading `{{steps.llm.content}}` continue to work unchanged.
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
  const { model, temperature, maxTokens, prompt, systemPrompt, responseFormat } =
    node.data as Record<string, any>;

  // ---------------------------------------------------------------------------
  // Pre-built messages array support — added 2026-05-14 with the
  // prompt_template P0 work. When upstream `input.messages` is a chat array
  // (e.g. produced by prompt_template with outputAs='messages') we use it
  // verbatim instead of rebuilding from `prompt` + `systemPrompt`. This
  // closes the "prompt_template feeds LLM" wiring without forcing authors
  // to serialize the conversation back to a single string.
  // ---------------------------------------------------------------------------
  const upstreamMessages = extractUpstreamMessages(input);
  if (upstreamMessages) {
    ctx.logger.info(
      { nodeId: node.id, model, messages: upstreamMessages.length, mode: 'upstream-messages' },
      '[llm_completion] Executing (streaming) with upstream messages array',
    );
    return await runChat({
      ctx,
      node,
      effectiveModel: model && model !== 'auto' ? model : 'auto',
      temperature: temperature ?? 0.7,
      maxTokens: maxTokens || 2000,
      messages: upstreamMessages,
      responseFormat,
    });
  }

  const resolvedPrompt = ctx.interpolateTemplate(prompt || '', input);
  const resolvedSystemPrompt = ctx.interpolateTemplate(systemPrompt || '', input);

  ctx.logger.info(
    {
      nodeId: node.id,
      model,
      promptLength: resolvedPrompt.length,
    },
    '[llm_completion] Executing (streaming)',
  );

  const messages: Array<{ role: string; content: string }> = [];
  if (resolvedSystemPrompt) {
    messages.push({ role: 'system', content: resolvedSystemPrompt });
  }

  // Auto-append input context when the prompt lacks template references.
  // Mirrors the legacy engine behavior so workflows keep working.
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
  messages.push({ role: 'user', content: userContent });

  // Smart Router default — no hardcoded model literal here.
  const effectiveModel = model && model !== 'auto' ? model : 'auto';

  return await runChat({
    ctx,
    node,
    effectiveModel,
    temperature: temperature ?? 0.7,
    maxTokens: maxTokens || 2000,
    messages,
    responseFormat,
  });
}

/**
 * Shared chat-completion runner used by both the prompt/system-prompt path
 * and the upstream-messages path. Owns the streaming, tracing, and return
 * envelope.
 */
async function runChat(opts: {
  ctx: NodeExecutionContext;
  node: WorkflowNode;
  effectiveModel: string;
  temperature: number;
  maxTokens: number;
  messages: Array<{ role: string; content: string }>;
  /**
   * Opt-in strict-output mode. `'json_object'` translates to OpenAI's
   * `response_format: { type: 'json_object' }` on the wire, which the
   * Ollama provider further translates to Ollama-native `format: 'json'`
   * (grammar-constrained output). Required when feeding a downstream
   * `structured_output` validator with a weak model like gpt-oss:20b
   * that ignores prose-level "output JSON only" instructions.
   */
  responseFormat?: 'json_object' | 'text';
}): Promise<unknown> {
  const { ctx, node, effectiveModel, temperature, maxTokens, messages, responseFormat } = opts;
  const t0 = Date.now();
  const result = await withGenAISpan(
    {
      operation: 'chat',
      system: 'openagentic.platform',
      requestModel: effectiveModel,
      maxTokens,
      temperature,
    },
    async () => {
      const r = await streamLLMCompletion({
        apiUrl: ctx.apiUrl,
        model: effectiveModel,
        messages,
        temperature,
        maxTokens,
        headers: {
          ...ctx.getInternalAuthHeaders(),
          'X-Workflow-Execution': ctx.executionId,
        },
        signal: ctx.signal,
        messageId: `wf_${ctx.executionId}_${node.id}`,
        onCanonical: (event) => {
          ctx.emitCanonical?.(event as unknown as { type: string } & Record<string, unknown>);
        },
        // include_usage:true asks the OpenAI-shape stream to emit the trailing
        // usage chunk so the node result reports real token counts instead of
        // total_tokens:0 (live defect 2026-06-02).
        extraBody: {
          stream_options: { include_usage: true },
          ...(responseFormat === 'json_object'
            ? { response_format: { type: 'json_object' } }
            : {}),
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
  const latencyMs = Date.now() - t0;

  // Strip the leaked gpt-oss Harmony "analysis" channel that the OpenAI shim
  // glues onto the final answer (verbatim "We need to…", "The user asks…",
  // "So say that." before the real content). Downstream {{steps.X.content}}
  // consumers must see the answer, not the reasoning (live defect 2026-06-02).
  const content = stripLeadingReasoning(result.fullText);
  const completionTokens = result.usage?.output_tokens ?? 0;
  const promptTokens = result.usage?.input_tokens ?? 0;
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
  const returnedModel = result.model ?? effectiveModel;

  // T7: emit per-call trace. Pull the last user message as the "prompt"
  // representative for tracing (mirrors prior single-prompt behavior).
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  void ctx.tracing?.recordCall({
    nodeId: node.id,
    executionId: ctx.executionId,
    workflowId: ctx.workflowId ?? ctx.executionId,
    tenantId: ctx.tenantId,
    model: returnedModel,
    promptTokens,
    completionTokens,
    costUsd: 0,
    latencyMs,
    prompt: lastUser?.content ?? '',
    completion: content,
  });

  return {
    content,
    model: returnedModel,
    usage,
  };
}

/**
 * Recognize prompt_template's `outputAs: 'messages'` upstream shape and
 * use the array verbatim. Returns null when the input doesn't carry a
 * usable messages array (engine falls back to prompt/systemPrompt path).
 */
function extractUpstreamMessages(
  input: unknown,
): Array<{ role: string; content: string }> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const m = o.messages;
  if (!Array.isArray(m) || m.length === 0) return null;
  const out: Array<{ role: string; content: string }> = [];
  for (const item of m) {
    if (!item || typeof item !== 'object') return null;
    const r = (item as { role?: unknown }).role;
    const c = (item as { content?: unknown }).content;
    if (typeof r !== 'string' || typeof c !== 'string') return null;
    out.push({ role: r, content: c });
  }
  return out;
}
