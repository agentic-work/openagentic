/**
 * Bridge: legacy OpenAI-flat `CompletionRequest`-style input → `CanonicalRequest`.
 *
 * The openagentic-api `CompletionRequest` shape evolved before the canonical
 * SoT existed and accepts a heterogeneous mix:
 *
 *   - OpenAI-flat: `{role:'system'|'user'|'assistant'|'tool', content:string,
 *                    tool_calls?, tool_call_id?}`
 *   - Anthropic-blocks inside `content`: `[{type:'text'}, {type:'tool_use'},
 *                    {type:'tool_result'}, {type:'thinking'}, ...]`
 *   - Multimodal `[{type:'text',text}, {type:'image_url', image_url:{url}}]`
 *
 * This helper consumes all three shapes and emits a CanonicalRequest with:
 *   - Role split (system messages hoisted, tool messages folded into user
 *     with tool_result blocks)
 *   - Tool ids canonicalized to `toolu_*` via `toToolu`
 *   - OpenAI-shape function defs in `tools[]` rewrapped as `CanonicalTool`
 *   - tool_choice mapped (`required` → `any`, `{type:'function',...}` → `tool`)
 *
 * Adapters (`selectOutboundAdapter`) consume the canonical output and
 * re-translate to native wire shape. The api provider therefore does:
 *
 *     const canonical = completionRequestToCanonical(req);
 *     const wireBody  = selectOutboundAdapter('aif-responses').adaptRequest(canonical);
 *     // → HTTP POST
 *
 * Once chatLoop is migrated to build CanonicalRequest directly (audit §10
 * step 5), this helper is only needed at the legacy boundary.
 *
 * the design notes
 *        §"0.4 — Wire api providers as THIN clients"
 */

import type {
  CanonicalMessage,
  CanonicalRequest,
  CanonicalRequestContentBlock,
  CanonicalRequestToolResultContentBlock,
  CanonicalTool,
  CanonicalToolChoice,
} from './types.js';
import { toToolu } from './toolIdNormalize.js';

/** Minimal shape we accept — matches `CompletionRequest` from the api repo
 * but kept loose (`unknown` for tools etc.) since the legacy type
 * accumulated a lot of `any`s. */
export interface LegacyCompletionRequestLike {
  messages: Array<LegacyMessage>;
  model?: string;
  max_tokens?: number;
  tools?: Array<unknown>;
  tool_choice?: unknown;
  stop?: string[];
  thinking?: { type: 'enabled'; budget_tokens: number };
  // intentionally ignore: temperature/top_p/top_k/presence/frequency_penalty
  // — those go to a separate provider-level sampling config slot, not part
  // of the canonical request body shape.
}

export interface LegacyMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: unknown;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type?: string;
    function?: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

const DEFAULT_MAX_TOKENS = 4096;

export function completionRequestToCanonical(
  req: LegacyCompletionRequestLike,
): CanonicalRequest {
  const systemParts: string[] = [];
  const messages: CanonicalMessage[] = [];

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      const text = extractSystemText(msg.content);
      if (text) systemParts.push(text);
      continue;
    }

    if (msg.role === 'tool') {
      // OpenAI tool role → user message with tool_result block(s).
      // Two input shapes are accepted:
      //   1. OpenAI-flat: `{role:'tool', tool_call_id, content: string}`
      //   2. Anthropic-blocks-in-tool: `{role:'tool', content: [{type:'tool_result',
      //      tool_use_id, ...}, ...]}` — used by mixed-shape callers that wrap
      //      tool results in an Anthropic content array but keep the OpenAI
      //      role label.
      const id = msg.tool_call_id;
      if (typeof id === 'string' && id.length > 0) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toToolu(id, 'openai'),
              content: stringifyResultContent(msg.content),
            },
          ],
        });
        continue;
      }
      // No top-level tool_call_id — look for Anthropic-shape tool_result
      // blocks inside content[].
      if (Array.isArray(msg.content)) {
        const blocks = convertUserContent(msg.content);
        if (blocks.length > 0) {
          messages.push({ role: 'user', content: blocks });
        }
      }
      continue;
    }

    const blocks =
      msg.role === 'user'
        ? convertUserContent(msg.content)
        : convertAssistantContent(msg.content, msg.tool_calls);

    if (blocks.length === 0) continue;
    messages.push({ role: msg.role, content: blocks });
  }

  return {
    messages,
    system: systemParts.length > 0 ? systemParts.join('\n') : null,
    tools: convertTools(req.tools),
    tool_choice: convertToolChoice(req.tool_choice),
    max_tokens: req.max_tokens ?? DEFAULT_MAX_TOKENS,
    ...(req.thinking ? { thinking: req.thinking } : {}),
    ...(req.stop && req.stop.length > 0 ? { stop_sequences: req.stop } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSystemText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b && b.type === 'text' ? String(b.text ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function stringifyResultContent(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((p: any) =>
        typeof p === 'string' ? p : (p?.text ?? JSON.stringify(p)),
      )
      .join('\n');
  }
  return JSON.stringify(raw ?? '');
}

function convertUserContent(content: unknown): CanonicalRequestContentBlock[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const out: CanonicalRequestContentBlock[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      out.push({ type: 'text', text: block });
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    const b = block as any;

    switch (b.type) {
      case 'text':
        out.push({ type: 'text', text: String(b.text ?? '') });
        break;
      case 'tool_result':
        // Already Anthropic-shape. Canonicalize the tool_use_id.
        // Accept `.content` (canonical) OR `.text` (legacy shorthand some
        // callers persisted in chatLoop history — e.g. openagentic replay).
        out.push({
          type: 'tool_result',
          tool_use_id: toToolu(String(b.tool_use_id ?? ''), 'openai'),
          content:
            typeof b.content === 'string'
              ? b.content
              : Array.isArray(b.content)
                ? (b.content as CanonicalRequestToolResultContentBlock[])
                : b.content !== undefined
                  ? stringifyResultContent(b.content)
                  : typeof b.text === 'string'
                    ? b.text
                    : '',
          ...(b.is_error ? { is_error: true } : {}),
        });
        break;
      case 'image':
        // Anthropic-shape image — pass through
        if (b.source && typeof b.source === 'object') {
          out.push({
            type: 'image',
            source: {
              type: b.source.type === 'url' ? 'url' : 'base64',
              ...(b.source.media_type ? { media_type: String(b.source.media_type) } : {}),
              ...(b.source.data ? { data: String(b.source.data) } : {}),
              ...(b.source.url ? { url: String(b.source.url) } : {}),
            },
          });
        }
        break;
      case 'image_url': {
        // OpenAI-shape image
        const url = b.image_url?.url ? String(b.image_url.url) : '';
        if (!url) break;
        if (url.startsWith('data:')) {
          // data:image/png;base64,<data>
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match && match[1] && match[2]) {
            out.push({
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] },
            });
          }
        } else {
          out.push({ type: 'image', source: { type: 'url', url } });
        }
        break;
      }
    }
  }
  return out;
}

function convertAssistantContent(
  content: unknown,
  toolCalls?: LegacyMessage['tool_calls'],
): CanonicalRequestContentBlock[] {
  const out: CanonicalRequestContentBlock[] = [];

  if (typeof content === 'string') {
    if (content.length > 0) out.push({ type: 'text', text: content });
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as any;
      switch (b.type) {
        case 'text':
          if (b.text) out.push({ type: 'text', text: String(b.text) });
          break;
        case 'thinking':
        case 'redacted_thinking':
          out.push({
            type: 'thinking',
            thinking: String(b.thinking ?? b.data ?? ''),
            ...(b.signature ? { signature: String(b.signature) } : {}),
          });
          break;
        case 'tool_use':
          out.push({
            type: 'tool_use',
            id: toToolu(String(b.id ?? ''), 'openai'),
            name: String(b.name ?? ''),
            input: (b.input && typeof b.input === 'object') ? b.input : {},
          });
          break;
      }
    }
  }

  if (toolCalls && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      if (!tc.function) continue;
      out.push({
        type: 'tool_use',
        id: toToolu(String(tc.id ?? ''), 'openai'),
        name: String(tc.function.name ?? ''),
        input: parseArgumentsSafely(tc.function.arguments),
      });
    }
  }

  return out;
}

function parseArgumentsSafely(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function convertTools(tools: unknown): CanonicalTool[] {
  if (!Array.isArray(tools)) return [];
  const out: CanonicalTool[] = [];
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    const obj = t as any;
    // OpenAI-shape: { type:'function', function:{name,description,parameters} }
    if (obj.type === 'function' && obj.function) {
      out.push({
        name: String(obj.function.name ?? ''),
        description: String(obj.function.description ?? ''),
        input_schema:
          obj.function.parameters && typeof obj.function.parameters === 'object'
            ? obj.function.parameters
            : {},
      });
      continue;
    }
    // Anthropic-shape: { name, description, input_schema }
    if (obj.name && obj.input_schema) {
      out.push({
        name: String(obj.name),
        description: String(obj.description ?? ''),
        input_schema: obj.input_schema,
      });
      continue;
    }
  }
  return out;
}

function convertToolChoice(raw: unknown): CanonicalToolChoice {
  if (raw === 'auto' || raw == null) return { type: 'auto' };
  if (raw === 'required') return { type: 'any' };
  if (raw === 'none') return { type: 'none' };
  if (typeof raw === 'object') {
    const obj = raw as any;
    // OpenAI-shape: {type:'function', function:{name}}
    if (obj.type === 'function' && obj.function?.name) {
      return { type: 'tool', name: String(obj.function.name) };
    }
    // Anthropic-shape: {type:'auto'|'any'|'none'|'tool', name?}
    if (obj.type === 'auto' || obj.type === 'any' || obj.type === 'none') {
      return { type: obj.type };
    }
    if (obj.type === 'tool' && obj.name) {
      return { type: 'tool', name: String(obj.name) };
    }
  }
  return { type: 'auto' };
}
