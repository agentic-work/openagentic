/**
 * Canonical → OpenAI Chat Completions request body.
 *
 * Used for: OpenAI direct API, AIF Anthropic-format on /chat/completions when
 * a non-Anthropic model is targeted, Azure OpenAI Service (foundry-anthropic
 * for Anthropic models on AIF uses OpenagenticToAnthropic instead — only
 * non-Anthropic models on AIF/Azure OpenAI flow through this adapter).
 *
 * Wire shape:
 *
 *   {
 *     model: "gpt-4o",
 *     messages: [
 *       { role: "system", content: "..." },
 *       { role: "user",   content: "..." },
 *       { role: "assistant", content: "text", tool_calls: [{ id, type:'function', function: {name, arguments} }] },
 *       { role: "tool",   tool_call_id: "call_xxx", content: "..." }
 *     ],
 *     tools: [{ type: 'function', function: {name, description, parameters} }],
 *     tool_choice: 'auto' | 'required' | 'none' | { type:'function', function: {name} },
 *     max_tokens: N,
 *     stop: [...]
 *   }
 *
 * Critical drops:
 *   - thinking blocks (no slot on this wire — adapter drops, history-preserve
 *     happens upstream)
 *   - cache_control markers (Anthropic-only)
 *   - signature on thinking (would be no-op anyway)
 *
 * Critical conversions:
 *   - tool_use blocks → assistant.tool_calls[] (multiple tool_uses → multiple
 *     tool_calls entries on a SINGLE assistant message)
 *   - tool_result blocks → SEPARATE messages with role:'tool', each (NOT
 *     wrapped in a user message like Anthropic shape)
 *   - toolu_* ids → call_* via fromToolu
 *   - system role hoisted to messages[0] if not already
 */

import type {
  CanonicalRequest,
  CanonicalMessage,
} from '../canonical/types.js';
import { fromToolu, type ProviderHint } from '../canonical/toolIdNormalize.js';
import type { IOutboundAdapter } from './AdapterContract.js';

interface OpenAIRequestBody {
  model?: string;
  messages: OpenAIChatMessage[];
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      /** Q2 — OpenAI strict JSON-schema validation. */
      strict?: boolean;
    };
  }>;
  tool_choice?: 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
  /** Q2 — set false when caller requests serial dispatch OR any tool has strict:true. */
  parallel_tool_calls?: boolean;
}

type OpenAIChatMessage =
  | { role: 'system' | 'developer'; content: string }
  | { role: 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export class OpenagenticToOpenAI implements IOutboundAdapter {
  readonly format: ProviderHint = 'openai';

  adaptRequest(req: CanonicalRequest): OpenAIRequestBody {
    const messages: OpenAIChatMessage[] = [];

    if (req.system) {
      // Gap 3 — o-series prefers `developer` role; latest reasoning models
      // still accept `system` for back-compat. Caller opts in via
      // `system_role_hint: 'developer'` when routing to o4-mini/o3/etc.
      const role: 'system' | 'developer' = req.system_role_hint === 'developer' ? 'developer' : 'system';
      messages.push({ role, content: req.system });
    }

    for (const m of req.messages) {
      this.flattenMessageInto(m, messages);
    }

    const body: OpenAIRequestBody = {
      messages,
      max_tokens: req.max_tokens,
    };

    if (req.tools.length > 0) {
      body.tools = req.tools.map((t) => {
        const fn: { name: string; description: string; parameters: Record<string, unknown>; strict?: boolean } = {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        };
        // Q2 — strict JSON-schema validation per tool. OpenAI requires
        // `parallel_tool_calls: false` whenever ANY tool has strict:true.
        if (t.strict === true) {
          fn.strict = true;
        }
        return { type: 'function' as const, function: fn };
      });
    }

    // Q2 — set parallel_tool_calls=false when:
    //   (a) caller explicitly disabled parallel (synthesis-retry turn, etc.), OR
    //   (b) ANY tool has strict:true (OpenAI contract — strict requires serial)
    const hasStrictTool = req.tools.some((t) => t.strict === true);
    if (req.disable_parallel_tool_use === true || hasStrictTool) {
      body.parallel_tool_calls = false;
    }

    if (req.tool_choice) {
      switch (req.tool_choice.type) {
        case 'auto':
          body.tool_choice = 'auto';
          break;
        case 'any':
          body.tool_choice = 'required';
          break;
        case 'none':
          body.tool_choice = 'none';
          break;
        case 'tool':
          body.tool_choice = { type: 'function', function: { name: req.tool_choice.name } };
          break;
      }
    }

    if (req.stop_sequences && req.stop_sequences.length > 0) {
      body.stop = req.stop_sequences;
    }

    return body;
  }

  private flattenMessageInto(m: CanonicalMessage, out: OpenAIChatMessage[]): void {
    if (m.role === 'user') {
      // User content: aggregate text blocks; tool_result blocks become
      // SEPARATE role:'tool' messages (one per result).
      const userContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
      const toolResults: { tool_call_id: string; content: string }[] = [];

      for (const b of m.content) {
        if (b.type === 'tool_result') {
          toolResults.push({
            tool_call_id: fromToolu(b.tool_use_id, 'openai'),
            content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
          });
        } else if (b.type === 'text') {
          userContent.push({ type: 'text', text: b.text });
        } else if (b.type === 'image') {
          const url = b.source.url
            ? b.source.url
            : b.source.data
              ? `data:${b.source.media_type ?? 'image/png'};base64,${b.source.data}`
              : '';
          if (url) userContent.push({ type: 'image_url', image_url: { url } });
        }
      }

      if (userContent.length > 0) {
        // OpenAI supports string content for single-text-block; use simple shape
        // when there's only one text block (more cache-friendly).
        const first = userContent[0];
        if (userContent.length === 1 && first && first.type === 'text') {
          out.push({ role: 'user', content: first.text });
        } else {
          out.push({ role: 'user', content: userContent });
        }
      }
      // Push each tool result as a separate `tool` role message AFTER the user
      // text (OpenAI expects role:'tool' messages immediately following the
      // assistant message that emitted the tool_calls).
      for (const tr of toolResults) {
        out.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content });
      }
      return;
    }

    // role === 'assistant'
    const assistantText: string[] = [];
    const toolCalls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }> = [];

    for (const b of m.content) {
      switch (b.type) {
        case 'text':
          assistantText.push(b.text);
          break;
        case 'thinking':
          // Drop — OpenAI Chat Completions wire has no thinking slot.
          break;
        case 'tool_use':
          toolCalls.push({
            id: fromToolu(b.id, 'openai'),
            type: 'function',
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          });
          break;
      }
    }

    const assistantMessage: OpenAIChatMessage = {
      role: 'assistant',
      content: assistantText.length > 0 ? assistantText.join('') : null,
    };
    if (toolCalls.length > 0) {
      (assistantMessage as any).tool_calls = toolCalls;
    }
    out.push(assistantMessage);
  }
}
