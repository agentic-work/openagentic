/**
 * Canonical → Anthropic Messages API request body.
 *
 * The "easy" adapter — canonical types mirror the Anthropic Messages API
 * by design, so this is mostly pass-through with three pieces of work:
 *
 *   1. Attach `cache_control: { type: 'ephemeral' }` to the LAST content
 *      block of every message index in `cache_control_marker_indices`. This
 *      is how Anthropic prompt caching gets activated (per-block marker, not
 *      request-level flag).
 *
 *   2. F1 — Attach `cache_control: { type: 'ephemeral' }` to the LAST tool
 *      in `body.tools[]` whenever tools are present. Anthropic caches the
 *      tool prefix back to the marker, which is the single biggest cacheable
 *      chunk in any agentic system (12 T1 tools + N MCP tools = tens of
 *      thousands of input tokens per turn). Cost-of-fix: one line; cost
 *      reduction: ~80-90% of tool-prefix input tokens across the
 *      conversation. Source: docs.claude.com/.../tool-use-with-prompt-caching
 *
 *   3. Preserve `signature` on thinking blocks so the multi-turn replay
 *      contract works (Anthropic encrypts thinking trace for verifying it
 *      was a real Anthropic emission, not a forged one).
 *
 * Tool IDs already canonical (`toolu_*`) — no conversion needed.
 * Tool definitions already canonical input_schema shape — pass-through.
 *
 * Used for: Anthropic direct API, AIF Anthropic format on /chat/completions,
 * Vertex Anthropic-on-Vertex (URL/auth different, body identical).
 */

import type {
  CanonicalRequest,
  CanonicalMessage,
  CanonicalRequestContentBlock,
} from '../canonical/types.js';
import type { ProviderHint } from '../canonical/toolIdNormalize.js';
import type { IOutboundAdapter } from './AdapterContract.js';

/**
 * Anthropic wire-tool shape: a regular tool definition OR a server-tool
 * marker entry (`tool_search_tool_*`) which Anthropic ingests without a
 * full schema. `defer_loading: true` keeps the regular tool out of the
 * system prompt prefix; Anthropic surfaces it via the server tool_search
 * response when the model invokes the server tool.
 */
type AnthropicWireTool =
  | {
      name: string;
      description: string;
      input_schema: Record<string, unknown>;
      cache_control?: { type: 'ephemeral' };
      defer_loading?: boolean;
    }
  | {
      type: `tool_search_tool_${string}`;
      name: string;
      cache_control?: { type: 'ephemeral' };
    };

interface AnthropicRequestBody {
  model?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: any[];
  }>;
  system?: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  tools?: AnthropicWireTool[];
  tool_choice?:
    | { type: 'auto' }
    | { type: 'any' }
    | { type: 'none' }
    | { type: 'tool'; name: string };
  max_tokens: number;
  thinking?: { type: 'enabled'; budget_tokens: number };
  stop_sequences?: string[];
}

export class OpenagenticToAnthropic implements IOutboundAdapter {
  readonly format: ProviderHint = 'anthropic';

  adaptRequest(req: CanonicalRequest): AnthropicRequestBody {
    const markerSet = new Set(req.cache_control_marker_indices ?? []);

    const messages = req.messages.map((m, idx) => {
      const content = adaptContentBlocks(m.content);
      // Attach cache_control to the LAST content block of marked messages.
      if (markerSet.has(idx) && content.length > 0) {
        const last = content[content.length - 1];
        if (last && typeof last === 'object') {
          (last as any).cache_control = { type: 'ephemeral' };
        }
      }
      return { role: m.role, content };
    });

    const body: AnthropicRequestBody = {
      messages,
      max_tokens: req.max_tokens,
    };

    if (req.system) {
      body.system = [{ type: 'text', text: req.system }];
    }
    if (req.tools.length > 0) {
      const regularTools: AnthropicWireTool[] = req.tools.map((t) => {
        const wire: AnthropicWireTool = {
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        };
        // A1 — pass through defer_loading per-tool so Anthropic keeps
        // marked tools out of the system-prompt prefix.
        if (t.defer_loading === true) {
          (wire as any).defer_loading = true;
        }
        return wire;
      });

      // A1 — when enable_server_tool_search is set, PREPEND the server tool
      // entry. Anthropic auto-expands `tool_reference` blocks returned by the
      // server tool against the deferred tool defs in this same array.
      if (req.enable_server_tool_search) {
        const variant = req.enable_server_tool_search;
        const serverTool: AnthropicWireTool = {
          type: `tool_search_tool_${variant}_20251119` as const,
          name: `tool_search_tool_${variant}`,
        };
        body.tools = [serverTool, ...regularTools];
      } else {
        body.tools = regularTools;
      }

      // F1 — attach cache_control to the LAST tool. Anthropic caches the
      // entire tool-array prefix back to this marker, including system text
      // (when system has its own marker). Modifying any tool definition
      // invalidates the entire tools cache, which is fine for our T1
      // catalog (stable across turns) + MCP tools (also stable per session).
      const lastTool = body.tools[body.tools.length - 1];
      if (lastTool) lastTool.cache_control = { type: 'ephemeral' };
    }
    if (req.tool_choice && req.tool_choice.type !== 'auto') {
      body.tool_choice = req.tool_choice;
    } else {
      body.tool_choice = { type: 'auto' };
    }
    // Q2 — per-turn parallel-tool-use override. Toggling this invalidates
    // the messages cache (Anthropic contract), so caller should set it
    // per-turn judiciously, not as a session default.
    if (req.disable_parallel_tool_use) {
      (body.tool_choice as any).disable_parallel_tool_use = true;
    }
    if (req.thinking) {
      body.thinking = req.thinking;
    }
    if (req.stop_sequences && req.stop_sequences.length > 0) {
      body.stop_sequences = req.stop_sequences;
    }
    return body;
  }
}

/**
 * Pass canonical content blocks through verbatim — they're already Anthropic
 * shape. Only normalization: preserve `signature` on thinking blocks, drop
 * any unknown `type` discriminator silently (forward-compat).
 */
function adaptContentBlocks(blocks: CanonicalRequestContentBlock[]): any[] {
  const out: any[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'text': {
        const o: any = { type: 'text', text: b.text };
        if (b.cache_control) o.cache_control = b.cache_control;
        out.push(o);
        break;
      }
      case 'thinking': {
        const o: any = { type: 'thinking', thinking: b.thinking };
        if (b.signature !== undefined) o.signature = b.signature;
        out.push(o);
        break;
      }
      case 'tool_use': {
        const o: any = {
          type: 'tool_use',
          id: b.id,
          name: b.name,
          input: b.input,
        };
        if (b.cache_control) o.cache_control = b.cache_control;
        out.push(o);
        break;
      }
      case 'tool_result': {
        const o: any = {
          type: 'tool_result',
          tool_use_id: b.tool_use_id,
          content: b.content,
        };
        if (b.is_error !== undefined) o.is_error = b.is_error;
        if (b.cache_control) o.cache_control = b.cache_control;
        out.push(o);
        break;
      }
      case 'image': {
        const o: any = {
          type: 'image',
          source: b.source,
        };
        if (b.cache_control) o.cache_control = b.cache_control;
        out.push(o);
        break;
      }
      default: {
        // Forward-compat: unknown block types silently dropped.
        // eslint-disable-next-line no-console
        console.warn(`[OpenagenticToAnthropic] dropping unknown content block type: ${(b as any).type}`);
      }
    }
  }
  return out;
}
