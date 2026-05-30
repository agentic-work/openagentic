/**
 * streamLLMCompletion — Tier B helper for AI node executors.
 *
 * Drains a streaming OpenAI-shape `/api/v1/chat/completions` response and
 * pipes each provider chunk through the SDK
 * `selectCanonicalNormalizer('openai')` state machine. Each emitted
 * `CanonicalEvent` is forwarded to the caller via `onCanonical(...)` so
 * the engine can surface per-token frames on its execution stream.
 *
 * Architecture parity: this is the same single-accumulator-per-stream
 * pattern the chatmode V3 pipeline uses
 * (`openagentic-api/.../streamProvider.ts`). The SDK is the SoT for the
 * canonical event shape — every OpenAgentic AI surface consumes the same
 * union.
 *
 * Returned aggregate ({ fullText, usage, stopReason }) preserves the
 * legacy llm_completion return contract so downstream nodes that read
 * `{{steps.llm.content}}` keep working unchanged after the streaming
 * migration.
 */

import {
  selectCanonicalNormalizer,
  type CanonicalEvent,
} from '@agentic-work/llm-sdk';

/**
 * Anti-CoT preamble directive (Blocker A2 — rebuild plan 2026-05-13).
 *
 * Small instruction-tuned models (notably gpt-oss:20b) frequently emit
 * meta-narration before the actual answer: "The user wants me to ...",
 * "Let me think about ...", "First, I need to ...". That preamble flows
 * straight into rendered output for downstream nodes that consume
 * `{{steps.llm.content}}` and renders as visible junk in artifacts.
 *
 * We prepend this directive to the FIRST system message every call.
 * If the caller already supplied a system message, we splice the
 * directive in front of their content (single system message,
 * directive first). If they didn't, we synthesize one.
 *
 * The model name is intentionally NOT mentioned here — this is a
 * generic instruction, not a model-specific workaround.
 */
const ANTI_COT_DIRECTIVE =
  'Return ONLY the final answer. Do NOT include phrases like ' +
  '"The user wants", "Let me think", "First, I need to", ' +
  '"Here\'s how I\'ll", or "Looking at the user" — no preamble, no ' +
  'meta-narration, no commentary about what you are about to do. ' +
  'Respond directly with the final content.';

/**
 * Splice the anti-CoT directive into the messages array. Mutates a
 * copy — the caller's array is not modified. Exported for tests; not
 * intended for direct use by node executors.
 */
export function applyAntiCotDirective(
  messages: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  if (messages.length > 0 && messages[0].role === 'system') {
    // Splice directive in front of the existing system message — same
    // role, single message, directive first, then caller's content.
    const merged = `${ANTI_COT_DIRECTIVE}\n\n${messages[0].content}`;
    return [{ role: 'system', content: merged }, ...messages.slice(1)];
  }
  return [{ role: 'system', content: ANTI_COT_DIRECTIVE }, ...messages];
}

export interface StreamLLMCompletionOptions {
  /** Base URL of the OpenAgentic API. */
  apiUrl: string;
  /** Smart-Router-routed model id, or 'auto'. */
  model: string;
  /** OpenAI-shape messages array (already merged with system prompt). */
  messages: Array<{ role: string; content: string }>;
  /** Sampling temperature. */
  temperature: number;
  /** Token cap. */
  maxTokens: number;
  /** Internal-service auth headers (workflows -> api). */
  headers: Record<string, string>;
  /** AbortSignal threaded from NodeExecutionContext.signal. */
  signal?: AbortSignal;
  /**
   * Stable id for the assistant message — used as `message.id` in the
   * canonical `message_start` event so downstream consumers can correlate
   * frames with the originating node execution.
   */
  messageId: string;
  /**
   * Called once per emitted canonical event. Fire-and-forget; the
   * caller is responsible for any async work (e.g. forwarding to the
   * engine event stream). Errors thrown by this callback are swallowed
   * so a misbehaving consumer cannot break the stream drain.
   */
  onCanonical: (event: CanonicalEvent) => void;
  /** Optional request timeout in ms. Defaults to 10 minutes. */
  timeoutMs?: number;
  /**
   * Tier C: provider-specific extra fields to merge into the request body.
   * Lets caller pass through `provider:'bedrock'/'vertex'/'azure_openai'`,
   * reasoning's `enableThinking` + `thinkingBudget` + `sliderPosition`,
   * `response_format`, etc. — without forking the helper per node.
   * Extras CANNOT override the four canonical fields (model, messages,
   * temperature, max_tokens) or `stream:true`.
   */
  extraBody?: Record<string, unknown>;
  /**
   * Path D (GH #143) — switch the upstream endpoint + SSE consumer.
   *
   * - `'openai'` (default): POST `/api/v1/chat/completions`; parse SSE
   *    via `selectCanonicalNormalizer('openai')`. Same behavior as
   *    before Path D — preserved for back-compat + emergency rollback.
   *
   * - `'canonical'`: POST `/api/v1/canonical/completions`; the upstream
   *    already emits canonical events as SSE frames, so we skip the
   *    normalizer and forward each parsed event verbatim to
   *    `onCanonical(...)`. Removes the double-normalization
   *    (provider → canonical → openai-shape → canonical) that the
   *    SDK leverage study identified.
   *
   * Env override: `WORKFLOWS_STREAM_FORMAT=openai|canonical` flips the
   * default WITHOUT requiring per-executor code changes. Useful for
   * canary rollouts or emergency rollback.
   */
  format?: 'openai' | 'canonical';
}

export interface StreamLLMCompletionResult {
  /** Concatenated assistant text (sum of all `text_delta` events). */
  fullText: string;
  /** Token usage if the provider reported it on `message_delta.usage`. */
  usage?: { input_tokens?: number; output_tokens: number };
  /** Stop reason from `message_delta.delta.stop_reason`, if any. */
  stopReason?: string;
  /** Model id echoed by the provider on the first chunk, if any. */
  model?: string;
  /**
   * Tier C: concatenated chain-of-thought text aggregated from
   * `thinking_delta` canonical events. Empty string when the provider
   * did not emit any thinking blocks (or when the upstream is not a
   * reasoning model). The reasoning node returns this on
   * `outputs.<id>.thinking`.
   */
  thinking: string;
}

/**
 * Stream a chat completion and pipe canonical events to `onCanonical`.
 *
 * Returns the aggregate `{ fullText, usage, stopReason, model }` once the
 * stream closes. The executor returns this to its caller so downstream
 * nodes reading `{{steps.X.content}}` continue to work.
 */
export async function streamLLMCompletion(
  opts: StreamLLMCompletionOptions,
): Promise<StreamLLMCompletionResult> {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(
    () => timeoutController.abort(new Error(`streamLLMCompletion timeout after ${timeoutMs}ms`)),
    timeoutMs,
  );

  // Chain the caller's signal with our timeout controller.
  const onCallerAbort = () => timeoutController.abort();
  if (opts.signal) {
    if (opts.signal.aborted) timeoutController.abort();
    else opts.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  // Blocker A2 — strip CoT preamble at the system-prompt layer. Every
  // AI node executor funnels through this helper, so a single splice
  // here covers llm_completion / reasoning / structured_output /
  // agent_* / azure_ai / bedrock / vertex / openagentic_*.
  const sanitizedMessages = applyAntiCotDirective(opts.messages);

  // Path D (GH #143) — pick the upstream endpoint based on the
  // streaming format. The canonical endpoint emits canonical SSE
  // directly, removing the openai-shape repackage step inside api.
  // Env override lets ops flip the default per service without code
  // changes (canary / rollback).
  const envFormat = (process.env.WORKFLOWS_STREAM_FORMAT ?? '').toLowerCase();
  const effectiveFormat: 'openai' | 'canonical' =
    opts.format ?? (envFormat === 'canonical' ? 'canonical' : 'openai');
  const endpointPath =
    effectiveFormat === 'canonical'
      ? '/api/v1/canonical/completions'
      : '/api/v1/chat/completions';

  let response: Response;
  try {
    response = await fetch(`${opts.apiUrl}${endpointPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...opts.headers,
      },
      body: JSON.stringify({
        // Extras first so canonical fields (model/messages/temperature/
        // max_tokens/stream) always win — extras CANNOT override them.
        ...(opts.extraBody ?? {}),
        model: opts.model,
        messages: sanitizedMessages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: true,
      }),
      signal: timeoutController.signal,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    opts.signal?.removeEventListener('abort', onCallerAbort);
    throw err;
  }

  if (!response.ok || !response.body) {
    clearTimeout(timeoutHandle);
    opts.signal?.removeEventListener('abort', onCallerAbort);
    const text = await response.text().catch(() => '');
    throw new Error(
      `streamLLMCompletion: upstream ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`,
    );
  }

  // Backwards-compat: a small number of pre-Tier-B callers / mocks still
  // return a single application/json envelope rather than text/event-
  // stream chunks (e.g. legacy harness template handlers that pre-date
  // the streaming migration). When we see a JSON content-type, drain the
  // body as JSON and synthesize a one-shot SSE chunk so the normalizer
  // still sees a canonical OpenAI shape. This keeps the executor
  // backwards-compatible with all existing fixtures while the rest of
  // the platform moves to streaming.
  const contentType = response.headers.get('content-type') ?? '';
  if (
    contentType.includes('application/json') &&
    !contentType.includes('event-stream')
  ) {
    clearTimeout(timeoutHandle);
    opts.signal?.removeEventListener('abort', onCallerAbort);

    const json = (await response.json()) as {
      id?: string;
      model?: string;
      choices?: Array<{
        index?: number;
        message?: { role?: string; content?: string };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const fallbackNorm = selectCanonicalNormalizer('openai', {
      messageId: opts.messageId,
      model: opts.model,
    });
    const content = json.choices?.[0]?.message?.content ?? '';
    const finishReason = json.choices?.[0]?.finish_reason ?? 'stop';
    const oneShot = {
      id: json.id ?? opts.messageId,
      model: json.model ?? opts.model,
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: finishReason }],
    };
    let fallbackFullText = '';
    let fallbackThinking = '';
    let fallbackStopReason: string | undefined;
    let fallbackUsage: StreamLLMCompletionResult['usage'];
    let fallbackModel: string | undefined = json.model;
    const dispatch = (ev: CanonicalEvent): void => {
      try {
        opts.onCanonical(ev);
      } catch {
        // swallow
      }
      if (ev.type === 'message_start') {
        if (!fallbackModel || fallbackModel === 'auto') fallbackModel = ev.message.model;
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') fallbackFullText += ev.delta.text;
        else if (ev.delta.type === 'thinking_delta') fallbackThinking += ev.delta.thinking;
      } else if (ev.type === 'message_delta') {
        fallbackStopReason = ev.delta.stop_reason;
        if (ev.usage) fallbackUsage = ev.usage;
      }
    };
    for (const ev of fallbackNorm.consume(oneShot as never)) dispatch(ev);
    for (const ev of fallbackNorm.finalize()) dispatch(ev);
    // JSON envelope IS the source of truth — its `usage` block always
    // takes precedence over the synthetic empty usage the normalizer
    // emits on finalize for a one-shot stream.
    if (json.usage) {
      fallbackUsage = {
        input_tokens: json.usage.prompt_tokens ?? 0,
        output_tokens: json.usage.completion_tokens ?? 0,
      };
    }
    return {
      fullText: fallbackFullText || content,
      thinking: fallbackThinking,
      usage: fallbackUsage,
      stopReason: fallbackStopReason,
      model: fallbackModel,
    };
  }

  // Path D — canonical SSE consumer. The upstream
  // /api/v1/canonical/completions endpoint emits canonical events as
  // SSE frames directly; we forward them verbatim to onCanonical(...)
  // and aggregate fullText / thinking / stopReason / usage / model the
  // same way the OpenAI normalizer path does.
  if (effectiveFormat === 'canonical') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let fullText = '';
    let thinking = '';
    let stopReason: string | undefined;
    let usage: StreamLLMCompletionResult['usage'];
    let model: string | undefined;

    const handleCanonical = (ev: CanonicalEvent): void => {
      try {
        opts.onCanonical(ev);
      } catch {
        // swallow — telemetry callback must not break the stream
      }
      if (ev.type === 'message_start') {
        const m = (ev as any).message?.model;
        if (typeof m === 'string' && (!model || model === 'auto')) model = m;
      } else if (ev.type === 'content_block_delta') {
        const d = (ev as any).delta;
        if (d?.type === 'text_delta' && typeof d.text === 'string') fullText += d.text;
        else if (d?.type === 'thinking_delta' && typeof d.thinking === 'string')
          thinking += d.thinking;
      } else if (ev.type === 'message_delta') {
        const md = ev as any;
        if (md.delta?.stop_reason) stopReason = md.delta.stop_reason;
        if (md.usage) usage = md.usage;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLines = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''));
          if (dataLines.length === 0) continue;
          const payload = dataLines.join('\n');
          if (payload === '[DONE]') continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          // Defensive: only forward objects with a known `type` — guards
          // against an upstream that accidentally interleaves non-canonical
          // chunks (e.g. an OpenAI-shape frame escaping through). Those
          // are dropped rather than mis-classified.
          if (
            parsed &&
            typeof parsed === 'object' &&
            typeof (parsed as { type?: unknown }).type === 'string'
          ) {
            handleCanonical(parsed as CanonicalEvent);
          }
        }
      }
    } finally {
      clearTimeout(timeoutHandle);
      opts.signal?.removeEventListener('abort', onCallerAbort);
    }
    return { fullText, thinking, usage, stopReason, model };
  }

  const normalizer = selectCanonicalNormalizer('openai', {
    messageId: opts.messageId,
    model: opts.model,
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let fullText = '';
  let thinking = '';
  let stopReason: string | undefined;
  let usage: StreamLLMCompletionResult['usage'];
  let model: string | undefined;

  const handleEvent = (ev: CanonicalEvent): void => {
    try {
      opts.onCanonical(ev);
    } catch {
      // swallow — telemetry callback must not break the stream
    }
    if (ev.type === 'message_start') {
      // Only keep the canonical model if we haven't already captured one
      // from the chunk top-level. The OpenAI normalizer initializes
      // message.model from opts.model ('auto' in the Smart Router path),
      // which would otherwise overwrite the provider-resolved id.
      if (!model || model === 'auto') model = ev.message.model;
    } else if (ev.type === 'content_block_delta') {
      if (ev.delta.type === 'text_delta') fullText += ev.delta.text;
      else if (ev.delta.type === 'thinking_delta') thinking += ev.delta.thinking;
    } else if (ev.type === 'message_delta') {
      stopReason = ev.delta.stop_reason;
      if (ev.usage) usage = ev.usage;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE frames are delimited by `\n\n`. Drain complete frames; keep
      // any trailing partial in `buf` for the next read.
      let sep: number;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const dataLines = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''));
        if (dataLines.length === 0) continue;
        const payload = dataLines.join('\n');
        if (payload === '[DONE]') continue;
        let chunk: unknown;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        // OpenAI shim echoes `model` at the chunk top level (not on the
        // canonical message_start, which reflects opts.model). Capture
        // the first non-empty value so the executor's return contract
        // surfaces the provider-resolved model rather than 'auto'.
        if (
          !model &&
          chunk &&
          typeof chunk === 'object' &&
          typeof (chunk as { model?: unknown }).model === 'string'
        ) {
          model = (chunk as { model: string }).model;
        }
        for (const ev of normalizer.consume(chunk as never)) {
          handleEvent(ev);
        }
      }
    }
    // Stream closed — flush any tail event the normalizer wants to emit.
    for (const ev of normalizer.finalize()) handleEvent(ev);
  } finally {
    clearTimeout(timeoutHandle);
    opts.signal?.removeEventListener('abort', onCallerAbort);
  }

  return { fullText, thinking, usage, stopReason, model };
}
