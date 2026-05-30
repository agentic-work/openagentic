/**
 * OllamaProvider — wire-body builder.
 *
 * Thin client per audit §0.4: takes a legacy CompletionRequest, runs it
 * through the SDK's canonical bridge + outbound adapter, then layers
 * Ollama-specific provider-config (keep_alive, think, temperature/top_p,
 * capability-stripped tools, stream toggle) on top.
 *
 * Pre-existing wire-shape conversion (`convertMessages`,
 * `convertToolsToOllama`) is DELETED — the SDK adapter at
 * `@agentic-work/llm-sdk/lib/adapters` is now the SoT for canonical →
 * Ollama wire translation.
 *
 * Ollama-specific post-process (kept here, not in SDK):
 *   1. Orphan tool-message filter: any `role:'tool'` not immediately
 *      preceded by an `assistant` with a `tool_calls` array is dropped.
 *      Ollama returns empty completions otherwise — its session-replay
 *      hygiene is stricter than the canonical spec.
 *   2. Empty assistant drop: assistant turns with neither content nor
 *      tool_calls are no-ops that confuse `/api/chat`.
 *   3. tool_choice='none' → strip `tools[]` from wire body entirely.
 *      Ollama doesn't honor OpenAI-style `tool_choice: 'none'` (Sev-0
 *      Bug A, 2026-05-11). Pinned by
 *      OllamaProvider.synthesisAfterTools.test.ts.
 *
 * Tests: ollama/__tests__/buildOllamaWireBody.test.ts
 */

import {
  completionRequestToCanonical,
  selectOutboundAdapter,
} from '@agentic-work/llm-sdk/lib/adapters/index.js';
import type { CompletionRequest } from '../ILLMProvider.js';

export interface BuildOllamaWireBodyOptions {
  modelName: string;
  /** Keep-alive duration (Ollama's GPU-residency hint). e.g. "10m". */
  keepAlive: string;
  /** Set when the model passed the capability probe. When `false`, the
   * `tools[]` field is stripped from the wire payload even if the
   * request carries tools — gemma3 etc. return HTTP 400 if tools
   * are present and the model doesn't support them. */
  modelSupportsTools: boolean;
  /** Set when this is a thinking-enabled invocation (request thinking
   * type === 'enabled'|'adaptive' OR env `OLLAMA_THINKING_MODELS`
   * lists the model). Adds `think: true` to the wire body. */
  supportsThinking: boolean;
  /** Default true. Caller (createCompletion) honors `request.stream ?? true`. */
  stream: boolean;
}

export function buildOllamaWireBody(
  request: CompletionRequest,
  opts: BuildOllamaWireBodyOptions,
): Record<string, unknown> {
  // Sev-0 #5 (2026-05-11) — Ollama doesn't honor tool_choice:'none'; only way
  // to forbid tool calls is to drop the tools array entirely. Done BEFORE the
  // adapter so the canonical request doesn't carry tools either.
  //
  // Phase A.4 known gap (2026-05-19) — Ollama's /api/chat ALSO silently ignores
  // OpenAI-style named-function `tool_choice: { type: 'function', function: { name } }`.
  // The artifact-verb forcing in chatLoop.ts will pass that shape through;
  // Anthropic/Bedrock honor it, but Ollama doesn't. For gpt-oss:20b this is
  // acceptable because the model has separate prompt-engineering safeguards
  // (lexical safety-net + JSON-coerce retry, MEMORY.md #568-#570). A future
  // Ollama-specific fallback could filter `tools[]` to just the named tool to
  // simulate forcing.
  const stripToolsForSynthesis = request.tool_choice === 'none';

  const requestForCanonical: CompletionRequest = stripToolsForSynthesis
    ? { ...request, tools: undefined, tool_choice: undefined }
    : opts.modelSupportsTools
      ? request
      : { ...request, tools: undefined, tool_choice: undefined };

  const canonical = completionRequestToCanonical(requestForCanonical);
  const adapter = selectOutboundAdapter('ollama');
  const wire = adapter.adaptRequest(canonical) as {
    messages: any[];
    tools?: any[];
    options?: { num_predict?: number; stop?: string[] };
    stream?: boolean;
  };

  const sanitizedMessages = sanitizeOllamaHistory(wire.messages);

  const body: Record<string, unknown> = {
    model: opts.modelName,
    messages: sanitizedMessages,
    options: {
      ...(wire.options ?? {}),
      temperature: request.temperature ?? 0.7,
      top_p: request.top_p ?? 1,
    },
    stream: opts.stream,
    keep_alive: opts.keepAlive,
  };

  if (wire.tools && wire.tools.length > 0) {
    body.tools = wire.tools;
  }

  if (opts.supportsThinking) {
    body.think = true;
  }

  // OpenAI `response_format: { type: 'json_object' }` → Ollama-native
  // `format: 'json'`. Ollama enforces this server-side via a JSON grammar,
  // so weaker models (e.g. gpt-oss:20b) that ignore "output JSON only"
  // in the system prompt still emit a parseable object.
  //
  // Also accepts the JSON Schema variant `{ type: 'json_schema', json_schema: {schema} }`
  // — Ollama accepts an actual schema object in the `format` field, which
  // constrains the output beyond just "valid JSON" to "matches this shape".
  const rf = (request as { response_format?: unknown }).response_format as
    | { type?: string; json_schema?: { schema?: unknown } }
    | undefined;
  if (rf && typeof rf === 'object') {
    if (rf.type === 'json_object') {
      body.format = 'json';
    } else if (rf.type === 'json_schema' && rf.json_schema?.schema) {
      body.format = rf.json_schema.schema;
    }
  }

  return body;
}

/**
 * Filter the Ollama wire-shape message history to satisfy `/api/chat`'s
 * hygiene rules. Returns a new array; does NOT mutate input.
 *
 * Rules:
 *   - Drop assistants with no content AND no tool_calls (no-op turns).
 *   - Drop role:'tool' messages NOT immediately preceded (after
 *     sanitization) by an assistant with a non-empty tool_calls array.
 *
 * Codemode CLI replays its full session (`--continue`) which often ships
 * historical assistants whose content was stripped (thinking / tool_use
 * blocks dropped in a prior turn) but with the matching tool_results
 * still present. Without this filter, Ollama returns an empty completion.
 */
export function sanitizeOllamaHistory(messages: any[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (
      m.role === 'assistant' &&
      (!m.content || (typeof m.content === 'string' && !m.content.trim())) &&
      (!m.tool_calls || m.tool_calls.length === 0)
    ) {
      continue;
    }
    if (m.role === 'tool') {
      const prev = out[out.length - 1];
      if (
        !prev ||
        prev.role !== 'assistant' ||
        !prev.tool_calls ||
        prev.tool_calls.length === 0
      ) {
        continue;
      }
    }
    out.push(m);
  }
  return out;
}
