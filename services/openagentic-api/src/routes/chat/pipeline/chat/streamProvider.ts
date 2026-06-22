/**
 * V3 streamProvider — pipes raw provider chunks through the SDK
 * `selectCanonicalNormalizer(format, opts)` factory and yields V3-shape
 * `StreamEvent`s to the chat-loop.
 *
 * Phase 2 (Spec §12.1): replaces the V2 streamAdapter wrapper. The SDK
 * is the single source of stream-shape truth — every provider's native
 * chunks now flow through one canonical state machine before V3 sees
 * them.
 *
 * Architecture parity: this is the same single-accumulator-per-stream
 * pattern Anthropic Claude Code uses (claude.ts:1997-2111). Providers
 * stay dumb chunk pipes; V3 owns canonicalization via the SDK factory.
 *
 * the design notes
 * the design notes
 *       Phase 2, Task 2.3.
 *
 * Pinned by:
 *   - src/__tests__/architecture/normalizer-wire-in.source-regression.test.ts
 */
import { selectCanonicalNormalizer } from '@agentic-work/llm-sdk/lib/normalizers/index.js';
// F2-5 (2026-05-12 audit): root logger for the streamProvider seam so
// we can surface config-bug signals (e.g. system prompt undefined)
// instead of silently passing through to the provider.
import { logger as rootLogger } from '../../../../utils/logger.js';
import type {
  CanonicalEvent,
  CanonicalStreamFormat,
} from '@agentic-work/llm-sdk/lib/normalizers/index.js';
import type { ProviderRequest, StreamEvent, StopReason } from './types.js';

// V2's ProviderManager surface is intentionally typed loosely — V3 only
// reaches in for `createCompletion(req)` and `getStreamFormatForModel(model)`.
type ProviderManagerLike = {
  createCompletion: (req: any, target?: string) => Promise<any>;
  getStreamFormatForModel?: (model: string) => CanonicalStreamFormat | string;
};

/**
 * Build the V3 streamProvider closure. Captures the ProviderManager so
 * each call resolves the per-model stream format and constructs a fresh
 * SDK normalizer instance for that turn.
 *
 * Each call returns an `AsyncIterable<StreamEvent>` consumers drain with
 * `for await`.
 */
export function makeStreamProvider(
  providerManager: ProviderManagerLike,
): (req: ProviderRequest) => AsyncIterable<StreamEvent> {
  return (req: ProviderRequest) => {
    return {
      async *[Symbol.asyncIterator]() {
        // 1. Resolve the canonical stream format for this model. Falls back
        // to 'openai' (the most common shape) when the providerManager
        // can't be queried — same default as `getStreamFormatForModel`.
        const format = resolveFormat(providerManager, req.model);

        // 2. Construct the SDK normalizer — single accumulator for this
        // turn's stream. messageId is synthetic; downstream consumers
        // correlate via the V3 envelope, not Anthropic-shape ids.
        const normalizer = selectCanonicalNormalizer(format, {
          messageId: `msg_v3_${Date.now()}`,
          model: req.model,
        });

        // 3. Map our V3 ProviderRequest to the OpenAI-shape body the
        // ProviderManager expects. (ProviderManager handles per-provider
        // body translation downstream — Anthropic, Bedrock, Gemini all
        // accept this shape and re-translate internally.)
        const oaiMessages: any[] = [];
        if (req.system) {
          oaiMessages.push({ role: 'system', content: req.system });
        } else {
          // F2-5 (2026-05-12 audit): surface config-bug signal. Every
          // production chat turn should carry a system prompt; an
          // undefined value is almost always a wiring issue in the
          // composer or runChat's getSystemPromptForRole pipeline. Log
          // at warn so it shows up in dashboards but doesn't kill the
          // request (some legitimate batch/test paths run system-less).
          rootLogger.warn(
            { model: req.model, messageCount: req.messages.length, hasTools: req.tools.length > 0 },
            '[streamProvider] req.system is undefined — request will run without a system prompt (likely a config bug)',
          );
        }
        for (const m of req.messages) {
          if (m.role === 'tool' && Array.isArray(m.content)) {
            for (const tr of m.content as Array<any>) {
              oaiMessages.push({
                role: 'tool',
                tool_call_id: tr.tool_use_id,
                content:
                  typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
              });
            }
          } else if (m.role === 'assistant' && Array.isArray(m.content)) {
            const text = (m.content as any[])
              .filter(b => b.type === 'text')
              .map(b => b.text)
              .join('');
            const toolCalls = (m.content as any[])
              .filter(b => b.type === 'tool_use')
              .map(b => ({
                id: b.id,
                type: 'function',
                function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
              }));
            oaiMessages.push({
              role: 'assistant',
              content: text || '',
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            });
          } else {
            oaiMessages.push({ role: m.role, content: m.content });
          }
        }

        const oaiRequest: any = {
          messages: oaiMessages,
          model: req.model,
          tools: req.tools,
          tool_choice: req.tool_choice,
          stream: true,
          temperature: 0.7,
        };

        // Z.ET (2026-05-19) — per-turn extended thinking toggle. When the
        // UI Brain toggle is OFF, req.extendedThinkingEnabled === false.
        // Thread it onto the oaiRequest so AnthropicProvider (and any
        // future thinking-capable provider) can skip attaching a thinking
        // budget. Omitting the field (undefined) = provider default (ON).
        if (req.extendedThinkingEnabled === false) {
          oaiRequest.extendedThinkingEnabled = false;
        }

        // 4. Drain the provider's raw chunks through the normalizer +
        // translate canonical events into V3 StreamEvents.
        //
        // Tool-use input arrives as canonical input_json_delta fragments
        // on a tool_use content_block. We accumulate per-block partial
        // JSON and emit `tool_use_start` / `tool_use_delta` /
        // `tool_use_complete` events so the chat-loop's existing
        // dispatch logic continues to work unchanged.
        const toolBlockState = new Map<
          number,
          { id: string; name: string; partialJson: string }
        >();

        let stopReason: StopReason = 'end_turn';
        // 2026-05-10 Sev-0 fix — track whether the provider's stream
        // ALREADY yielded a canonical `message_delta` carrying the real
        // stop_reason (or any terminal envelope). When true, the SDK
        // normalizer's `finalize()` MUST NOT inject its synthetic
        // `message_delta(stop_reason:'end_turn') + message_stop` pair
        // (AIFResponsesToOpenagentic.ts:277-294), which would downgrade
        // a genuine 'tool_use' signal because chatLoop assigns
        // `stopReason` on every message_stop (last-event-wins).
        let providerSuppliedTerminal = false;
        // Q1-fix-5 (2026-05-12) — track whether a NON-default terminal
        // stop_reason has been seen. Bedrock streams a `message_delta`
        // with `stop_reason='tool_use'` immediately followed by a bare
        // `message_stop` whose raw event has NO `stop_reason` field.
        // After AWSBedrockProvider.convertStreamChunk's OpenAI-shape
        // conversion, that bare message_stop becomes
        // `{choices:[{delta:{},finish_reason:'stop'}]}` (the `||'stop'`
        // default) — and `translateOpenAIFinishChunk` maps `'stop'` to
        // `'end_turn'`. Without this guard the second yield would override
        // the prior `'tool_use'` via chatLoop's last-event-wins consumer.
        // The rule: never downgrade an already-set non-end_turn terminator
        // back to end_turn from a subsequent finish chunk.
        let firmTerminalSet = false;

        const resp = await providerManager.createCompletion(oaiRequest);
        // Provider may return a non-stream response if streaming is not
        // supported for this model — guard with a runtime asyncIterator
        // check. In that case we yield nothing canonical and fall
        // through to normalizer.finalize(); the chat-loop sees an empty
        // turn (treated as end_turn-no-text) which the synthesis
        // fallback handles.
        if (resp && typeof (resp as any)[Symbol.asyncIterator] === 'function') {
          for await (const chunk of resp as AsyncIterable<unknown>) {
            // Sev-0 — some providers (notably AzureAIFoundryProvider on
            // chat/completions) yield openagentic-sdk CanonicalEvent
            // envelopes ({type:'content_block_delta', delta:{type:
            // 'text_delta', text}}) interleaved with their native chunk
            // shape. The format-keyed normalizer (e.g. `openai`) only
            // understands its native shape, so those SDK-canonical
            // envelopes were silently dropped → 0 tokens, empty bubble.
            // Pass already-canonical SDK events through directly without
            // re-feeding the normalizer (which would mis-classify them).
            if (isCanonicalEnvelope(chunk)) {
              // Mark terminal envelopes so the normalizer.finalize() flush
              // below doesn't synthesize a duplicate end_turn message_stop.
              const cType = (chunk as { type?: string }).type;
              if (cType === 'message_delta' || cType === 'message_stop') {
                providerSuppliedTerminal = true;
              }
              for (const e of translateCanonicalEvent(chunk as CanonicalEvent, toolBlockState)) {
                if (e.type === 'message_stop') {
                  // Q1-fix-5: never downgrade. If a firm terminal
                  // (tool_use / max_tokens / stop_sequence / content_filter)
                  // has already been emitted, drop a trailing 'end_turn'
                  // chunk so chatLoop's last-event-wins consumer doesn't
                  // clobber the real signal.
                  if (firmTerminalSet && e.stop_reason === 'end_turn') {
                    continue;
                  }
                  stopReason = e.stop_reason;
                  if (e.stop_reason !== 'end_turn') firmTerminalSet = true;
                }
                yield e;
              }
              continue;
            }
            // Sev-0 (2026-05-11) — some providers stream **mixed shape**:
            // canonical Anthropic-shape `content_block_*` events PLUS
            // OpenAI-shape finish chunks `{choices:[{delta:{},finish_reason}]}`
            // for the terminator. AWSBedrockProvider.convertStreamChunk
            // does exactly this: it passes through `content_block_start` /
            // `content_block_delta` / `content_block_stop` verbatim
            // (those keep their canonical `type` field and hit the
            // `isCanonicalEnvelope` bypass above), but converts
            // Anthropic-shape `message_delta` / `message_stop` to OpenAI
            // shape (no `type` field; just choices + finish_reason).
            // The SDK normalizer keyed `bedrock-anthropic` can't parse
            // those — they hit `default` in the Anthropic passthrough
            // and are silently dropped. Result: a Sonnet turn that
            // emitted `stop_reason='tool_use'` was downgraded to
            // `end_turn` by the normalizer's synthetic finalize(),
            // chatLoop never reached the dispatch branch, the UI
            // showed an empty bubble. Live capture 2026-05-11 against
            // Claude Sonnet 4.6 via Bedrock cross-region us-east-1.
            //
            // Provider-agnostic fix: translate OpenAI-shape finish
            // chunks to a canonical `message_stop` BEFORE the
            // normalizer sees them. Any provider that yields the
            // mixed shape now produces the correct stop_reason. No
            // Bedrock-specific code path; no Sonnet special-case.
            const finishMapped = translateOpenAIFinishChunk(chunk);
            if (finishMapped) {
              providerSuppliedTerminal = true;
              // Sev-0 (2026-06-01) — Ollama native tool calls ride a
              // SINGLE OpenAI-shape chunk that carries BOTH
              // `delta.tool_calls` AND `finish_reason:'tool_calls'`
              // (OllamaProvider.ts:859-880 "Emitting stored native tool
              // calls at stream completion"). The short-circuit below
              // would `yield finishMapped; continue;` and SKIP
              // `normalizer.consume(chunk)`, dropping the tool name +
              // arguments entirely. chatLoop then sees stop_reason='tool_use'
              // with ZERO tool_use blocks → no dispatch, no tool_result,
              // and the model says "I'm not seeing a tool response". Extract
              // the inline tool_calls into canonical tool_use_start/
              // tool_use_complete events BEFORE yielding the terminator so
              // chatLoop's dispatch (+ audit + approval gate) fires. The
              // Bedrock bare-finish path (empty delta) extracts nothing and
              // behaves exactly as before.
              for (const e of extractInlineToolCalls(chunk, toolBlockState)) {
                yield e;
              }
              if (finishMapped.type === 'message_stop') {
                // Q1-fix-5: never downgrade. Bedrock's bare message_stop
                // (no stop_reason field on the raw event) becomes
                // finish_reason='stop' after convertStreamChunk, which
                // translateOpenAIFinishChunk then maps to 'end_turn'. If
                // a firm terminal already arrived (e.g. 'tool_use' from
                // the preceding message_delta), drop this stale chunk.
                if (firmTerminalSet && finishMapped.stop_reason === 'end_turn') {
                  continue;
                }
                stopReason = finishMapped.stop_reason;
                if (finishMapped.stop_reason !== 'end_turn') firmTerminalSet = true;
              }
              yield finishMapped;
              continue;
            }
            const events = normalizer.consume(chunk as any);
            for (const ev of events) {
              for (const e of translateCanonicalEvent(ev, toolBlockState)) {
                if (e.type === 'message_stop') {
                  if (firmTerminalSet && e.stop_reason === 'end_turn') {
                    continue;
                  }
                  stopReason = e.stop_reason;
                  if (e.stop_reason !== 'end_turn') firmTerminalSet = true;
                }
                yield e;
              }
            }
          }
        }

        // 5. Flush the normalizer — captures any trailing
        // content_block_stop / message_delta / message_stop events the
        // provider didn't emit on the wire.
        //
        // 2026-05-10 Sev-0 — skip the flush entirely when the provider
        // already supplied terminal canonical envelopes via the bypass
        // path. The normalizer in that case has never been fed and its
        // synthesized end_turn would override the real stop_reason.
        if (!providerSuppliedTerminal) {
          const flushed = normalizer.finalize();
          for (const ev of flushed) {
            for (const e of translateCanonicalEvent(ev, toolBlockState)) {
              if (e.type === 'message_stop') {
                if (firmTerminalSet && e.stop_reason === 'end_turn') {
                  continue;
                }
                stopReason = e.stop_reason;
                if (e.stop_reason !== 'end_turn') firmTerminalSet = true;
              }
              yield e;
            }
          }
        }

        // 6. Backstop — if the normalizer didn't synthesize a
        // message_stop event (some shapes never end cleanly), emit one
        // so the chat-loop can finalize the turn.
        //
        // F0-4 (2026-05-12 audit): when tool_use blocks remain open in
        // toolBlockState after the finalize flush AND the operative
        // stop_reason is not already 'tool_use', force a corrective
        // message_stop(tool_use). chatLoop's last-event-wins consumer
        // (chatLoop.ts:317-318) picks up the override → dispatch fires
        // for the pending block(s) instead of falling through to the
        // end_turn synthesis-fallback at chatLoop.ts:343.
        if (toolBlockState.size > 0 && stopReason !== 'tool_use') {
          // Synthesize content_block_stop for each open block so the
          // accumulated partial-JSON input flows through chatLoop's
          // tool_use_complete case (chatLoop.ts:273) — without this,
          // chatLoop's own toolBufs flush at :327 picks up the input,
          // but emitting tool_use_complete here keeps the wire-shape
          // consistent with cleanly-terminated streams.
          for (const idx of Array.from(toolBlockState.keys())) {
            for (const e of translateCanonicalEvent(
              { type: 'content_block_stop', index: idx } as CanonicalEvent,
              toolBlockState,
            )) {
              yield e;
            }
          }
          stopReason = 'tool_use';
          yield { type: 'message_stop', stop_reason: 'tool_use' };
        }
      },
    };
  };
}

/**
 * Detect openagentic-sdk CanonicalEvent envelopes that providers
 * (notably AzureAIFoundryProvider on chat/completions) yield interleaved
 * with their native chunk shape. Already-canonical SDK events bypass
 * the format-keyed SDK normalizer and pass straight to
 * translateCanonicalEvent — feeding them to a native-format normalizer
 * (e.g. `openai`) mis-classifies and silently drops text deltas (root
 * cause of "Model finished without producing an answer" on chat-stream).
 *
 * Recognized envelope `type` strings (subset of CanonicalEvent from
 * @agentic-work/llm-sdk/lib/normalizers/index.js):
 *   message_start | message_delta | message_stop
 *   content_block_start | content_block_delta | content_block_stop
 *   error
 */
const CANONICAL_ENVELOPE_TYPES = new Set<string>([
  'message_start',
  'message_delta',
  'message_stop',
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'error',
]);

function isCanonicalEnvelope(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== 'object') return false;
  const t = (chunk as { type?: unknown }).type;
  return typeof t === 'string' && CANONICAL_ENVELOPE_TYPES.has(t);
}

/** Resolve the per-model stream format with a safe fallback. */
function resolveFormat(
  pm: ProviderManagerLike,
  model: string,
): CanonicalStreamFormat {
  try {
    const fn = pm.getStreamFormatForModel;
    const fmt = typeof fn === 'function' ? fn.call(pm, model) : 'openai';
    if (
      fmt === 'anthropic' ||
      fmt === 'bedrock-anthropic' ||
      fmt === 'vertex-anthropic' ||
      fmt === 'foundry-anthropic' ||
      fmt === 'ollama' ||
      fmt === 'openai' ||
      fmt === 'gemini' ||
      fmt === 'aif-responses'
    ) {
      return fmt;
    }
  } catch {
    // fall through to default
  }
  return 'openai';
}

/**
 * Translate one CanonicalEvent into a V3 StreamEvent (or null when no
 * V3 surface maps to this event — message_start / content_block_start /
 * content_block_stop / message_delta are envelope-only and don't drive
 * the chat-loop directly).
 *
 * Tool-use blocks accumulate `input_json_delta` fragments per block_index
 * via `toolBlockState`. The normalizer synthesizes a tool_use
 * content_block_start (type:'tool_use', id, name) which we use to seed
 * the buffer; subsequent input_json_delta deltas extend the buffer; the
 * matching content_block_stop emits tool_use_complete with the parsed
 * JSON.
 */
function translateCanonicalEvent(
  ev: CanonicalEvent,
  toolBlockState: Map<number, { id: string; name: string; partialJson: string }>,
): StreamEvent[] {
  switch (ev.type) {
    case 'content_block_start': {
      const cb = (ev as any).content_block;
      const idx = (ev as any).index;
      if (cb && cb.type === 'tool_use' && typeof idx === 'number') {
        toolBlockState.set(idx, {
          id: String(cb.id ?? ''),
          name: String(cb.name ?? ''),
          partialJson: '',
        });
        return [{ type: 'tool_use_start', id: String(cb.id ?? ''), name: String(cb.name ?? '') }];
      }
      return [];
    }
    case 'content_block_delta': {
      const idx = (ev as any).index;
      const delta = (ev as any).delta;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return [{ type: 'text_delta', text: delta.text }];
      }
      if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        return [{ type: 'thinking_delta', text: delta.thinking }];
      }
      if (
        delta?.type === 'input_json_delta' &&
        typeof delta.partial_json === 'string' &&
        typeof idx === 'number'
      ) {
        const buf = toolBlockState.get(idx);
        if (buf) {
          buf.partialJson += delta.partial_json;
          return [
            {
              type: 'tool_use_delta',
              id: buf.id,
              name: buf.name,
              inputDelta: delta.partial_json,
            },
          ];
        }
      }
      return [];
    }
    case 'content_block_stop': {
      const idx = (ev as any).index;
      if (typeof idx === 'number' && toolBlockState.has(idx)) {
        const buf = toolBlockState.get(idx)!;
        let parsed: unknown = {};
        try {
          parsed = buf.partialJson ? JSON.parse(buf.partialJson) : {};
        } catch {
          parsed = { _raw: buf.partialJson };
        }
        toolBlockState.delete(idx);
        return [{ type: 'tool_use_complete', id: buf.id, name: buf.name, input: parsed }];
      }
      return [];
    }
    case 'message_delta': {
      // Both usage + stop_reason can ride on a single message_delta;
      // emit each as its own canonical StreamEvent for chatLoop.
      const evAny = ev as any;
      const out: StreamEvent[] = [];
      const usage = evAny.usage;
      if (usage && typeof usage === 'object') {
        const input = numOrZero(usage.input_tokens);
        const output = numOrZero(usage.output_tokens);
        // Anthropic shape; OpenAI's cached_tokens lives under
        // prompt_tokens_details and is flattened upstream.
        const cacheRead = numOrUndef(usage.cache_read_input_tokens);
        const cacheWrite = numOrUndef(usage.cache_creation_input_tokens);
        const reasoning = numOrUndef(usage.reasoning_tokens);
        if (input > 0 || output > 0 || cacheRead || cacheWrite || reasoning) {
          out.push({ type: 'usage', input, output, cacheRead, cacheWrite, reasoning });
        }
      }
      const sr = evAny.delta?.stop_reason;
      if (typeof sr === 'string') {
        out.push({ type: 'message_stop', stop_reason: mapStopReason(sr) });
      }
      return out;
    }
    case 'message_stop':
      // 2026-05-10 Sev-0 fix — DO NOT emit a hardcoded 'end_turn' here.
      //
      // Canonical contract: providers emit `message_delta` carrying the
      // real `stop_reason` (e.g. 'tool_use' on function-call turns) and
      // then a bare `message_stop` as the terminator. The bare event
      // adds no information — its `stop_reason` is ALREADY in the
      // preceding `message_delta`. Synthesizing 'end_turn' here
      // overrode the genuine 'tool_use' signal because chatLoop assigns
      // `stopReason` on every message_stop event, last-event-wins.
      // Result: turn ends without dispatching the tool the model just
      // emitted. chatLoop's initial `stopReason` is 'end_turn' so
      // providers that only emit a bare `message_stop` without a
      // prior `message_delta` still terminate correctly by default.
      return [];
    case 'message_start':
    default:
      return [];
  }
}

function numOrZero(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function numOrUndef(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Map canonical stop_reason strings to V3 StopReason union. */
function mapStopReason(sr: string): StopReason {
  if (
    sr === 'tool_use' ||
    sr === 'max_tokens' ||
    sr === 'stop_sequence' ||
    sr === 'end_turn' ||
    // F2-4 (2026-05-12 audit): preserve content_filter so chatLoop can
    // emit a distinct annotation frame for Responsible AI compliance.
    sr === 'content_filter'
  ) {
    return sr;
  }
  return 'end_turn';
}

/**
 * Translate an OpenAI-shape finish chunk
 * (`{choices:[{delta:{},finish_reason}]}`) directly to a canonical
 * `message_stop` StreamEvent.
 *
 * Returns `null` when the chunk isn't an OpenAI-shape finish chunk (i.e.
 * lacks `choices[0].finish_reason`). Callers route the chunk through
 * the SDK normalizer instead.
 *
 * Two finish_reason families are handled:
 *   - `tool_calls`           → `tool_use`  (OpenAI-style function-calling terminator)
 *   - `tool_use`             → `tool_use`  (Anthropic-style stop_reason that some
 *                                            providers leak through OpenAI's
 *                                            finish_reason field — notably
 *                                            Bedrock's `convertStreamChunk` for
 *                                            Claude models)
 *   - `length` / `max_tokens`→ `max_tokens`
 *   - `stop` / `end_turn`    → `end_turn`
 *   - anything else          → `end_turn`  (safe default; chatLoop reaches the
 *                                            normal terminator path)
 *
 * This translator is **provider-agnostic**: it triggers off the chunk
 * shape, not the provider id. Any mixed-shape stream (Anthropic content
 * blocks + OpenAI finish_reason) now produces the correct stop_reason
 * regardless of which cloud emitted it. Bedrock today; any future
 * provider that adopts the same conversion pattern tomorrow.
 *
 * Pinned by `chatLoop.bedrockToolUse.test.ts` (Sev-0 real-capture
 * 2026-05-11) and `streamProvider.providerShapes.integration.test.ts`
 * (multi-provider chunk-shape integration).
 */
function translateOpenAIFinishChunk(chunk: unknown): StreamEvent | null {
  if (!chunk || typeof chunk !== 'object') return null;
  const choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = choices[0] as { finish_reason?: unknown };
  const fr = choice?.finish_reason;
  if (typeof fr !== 'string' || fr.length === 0) return null;

  let mapped: StopReason;
  switch (fr) {
    case 'tool_calls':
    case 'tool_use':
      mapped = 'tool_use';
      break;
    case 'length':
    case 'max_tokens':
      mapped = 'max_tokens';
      break;
    case 'stop_sequence':
      mapped = 'stop_sequence';
      break;
    case 'stop':
    case 'end_turn':
      mapped = 'end_turn';
      break;
    // F2-4 (2026-05-12 audit): Azure Responsible AI content_filter.
    // Without this branch the value fell through to end_turn and the
    // UI rendered a clean-looking empty bubble — hiding a COMPLIANCE
    // EVENT from the operator + audit log. chatLoop now branches on
    // this distinct stop_reason to emit a 'content_filter' annotation
    // frame for the UI to render a compliance banner.
    case 'content_filter':
      mapped = 'content_filter';
      break;
    default:
      mapped = 'end_turn';
      break;
  }
  return { type: 'message_stop', stop_reason: mapped };
}

/**
 * Sev-0 (2026-06-01) — extract OpenAI-shape `delta.tool_calls` that ride
 * the SAME chunk as a `finish_reason` terminator into canonical V3
 * tool_use events.
 *
 * The OllamaProvider emits native tool calls as a single chunk:
 *   { choices: [{ delta: { tool_calls: [{ index, id, type:'function',
 *       function: { name, arguments } }] }, finish_reason: 'tool_calls' }] }
 *
 * The caller intercepts that chunk via `translateOpenAIFinishChunk`
 * (which keys off `finish_reason`) and short-circuits past
 * `normalizer.consume(chunk)`. Without this extraction the tool name +
 * arguments are silently dropped and chatLoop ends the turn with a
 * `stop_reason='tool_use'` but no tool_use block to dispatch.
 *
 * For each tool_call this emits a `tool_use_start` (id + name) followed
 * immediately by a `tool_use_complete` (id + name + PARSED input) — the
 * same V3 events the normalizer path produces for cleanly-streamed
 * tool_use blocks, so chatLoop's existing dispatch logic runs unchanged.
 * `arguments` is OpenAI-shape: a JSON STRING (parsed here), or already an
 * object on some providers (passed through). Malformed JSON degrades to
 * `{ _raw }` exactly like the normalizer's content_block_stop handling.
 *
 * Registers each block in `toolBlockState` then deletes it after the
 * complete, so the post-stream backstop (toolBlockState.size > 0) does
 * NOT double-emit a second tool_use_complete for the same call.
 *
 * Returns [] when the chunk carries no inline tool_calls (the Bedrock
 * bare-finish-chunk case) — that path is unchanged.
 */
function extractInlineToolCalls(
  chunk: unknown,
  toolBlockState: Map<number, { id: string; name: string; partialJson: string }>,
): StreamEvent[] {
  if (!chunk || typeof chunk !== 'object') return [];
  const choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const delta = (choices[0] as { delta?: unknown })?.delta;
  if (!delta || typeof delta !== 'object') return [];
  const toolCalls = (delta as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return [];

  const out: StreamEvent[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i] as {
      index?: unknown;
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const name = typeof tc?.function?.name === 'string' ? tc.function.name : '';
    // Skip nameless fragments — a tool_use with no name can't be dispatched
    // and would only produce a confusing unknown-tool error downstream.
    if (!name) continue;
    const id =
      typeof tc?.id === 'string' && tc.id.length > 0
        ? tc.id
        : `call_${Date.now()}_${i}`;

    // Parse OpenAI-shape arguments (JSON string) → object. Object/empty
    // pass through. Malformed JSON degrades to { _raw } so dispatch sees a
    // well-formed object and the downstream malformed-args guard can act.
    const rawArgs = tc?.function?.arguments;
    let input: unknown;
    if (typeof rawArgs === 'string') {
      try {
        input = rawArgs.length > 0 ? JSON.parse(rawArgs) : {};
      } catch {
        input = { _raw: rawArgs };
      }
    } else if (rawArgs && typeof rawArgs === 'object') {
      input = rawArgs;
    } else {
      input = {};
    }

    // Use a high synthetic block index so we never collide with real
    // content_block indices the normalizer may have registered this turn.
    const blockIndex = 100000 + i;
    toolBlockState.set(blockIndex, { id, name, partialJson: '' });
    out.push({ type: 'tool_use_start', id, name });
    out.push({ type: 'tool_use_complete', id, name, input });
    // Delete immediately so the post-stream open-block backstop does not
    // synthesize a duplicate tool_use_complete for this same call.
    toolBlockState.delete(blockIndex);
  }
  return out;
}

// Test seams — exported only for unit tests in __tests__/streamProvider.contentFilter.test.ts
// and similar. Do NOT import these from production code; the real
// path goes through makeStreamProvider/streamProvider.
export const __testing__mapStopReason = mapStopReason;
export const __testing__translateOpenAIFinishChunk = translateOpenAIFinishChunk;
export const __testing__extractInlineToolCalls = extractInlineToolCalls;
