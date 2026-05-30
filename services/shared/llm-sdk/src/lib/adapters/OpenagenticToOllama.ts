/**
 * Canonical → Ollama /api/chat request body.
 *
 *   {
 *     model: "gpt-oss:20b",
 *     messages: [
 *       { role: 'system', content: "..." },
 *       { role: 'user', content: "..." },
 *       { role: 'assistant', content: "...", tool_calls: [{ function: { name, arguments: {} } }] },
 *       { role: 'tool', content: "..." }    // paired to prior tool_calls by POSITION, no id field
 *     ],
 *     tools: [{ type: 'function', function: { name, description, parameters } }],
 *     stream: true,
 *     options: { temperature, top_p, top_k, num_predict }
 *   }
 *
 * Critical contracts:
 *   - Ollama's tool result message has NO `tool_call_id` field. Pairing is
 *     by ORDER — the model expects role:'tool' messages in the same order
 *     as the prior assistant message's `tool_calls[]`. Adapter preserves
 *     the canonical order.
 *   - tool_call arguments are an OBJECT, not a JSON-string like OpenAI. This
 *     is a common confusion source — keep `b.input` raw, don't JSON.stringify.
 *   - System prompt is a separate `role:'system'` message at position 0.
 *   - Thinking blocks: only certain Ollama models surface a `message.thinking`
 *     field on response chunks (gpt-oss, deepseek-r1). The REQUEST shape has
 *     no thinking slot; adapter drops on outbound. Inbound thinking is
 *     extracted by the normalizer.
 *   - tool_use_id ids: Ollama assigns its own (often numeric or `call_*`).
 *     Adapter converts canonical `toolu_*` → `call_*` for outbound compatibility.
 *
 * Spec: https://github.com/ollama/ollama/blob/main/docs/api.md +
 *       docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 */

import type {
  CanonicalRequest,
  CanonicalMessage,
} from '../canonical/types.js';
import { fromToolu, type ProviderHint } from '../canonical/toolIdNormalize.js';
import type { IOutboundAdapter } from './AdapterContract.js';

interface OllamaChatBody {
  model?: string;
  messages: OllamaMessage[];
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  stream?: boolean;
  options?: {
    num_predict?: number;
    stop?: string[];
  };
}

type OllamaMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: string[] }
  | {
      role: 'assistant';
      content: string;
      tool_calls?: Array<{
        id?: string;
        function: { name: string; arguments: Record<string, unknown> };
      }>;
    }
  | { role: 'tool'; content: string };

export class OpenagenticToOllama implements IOutboundAdapter {
  readonly format: ProviderHint = 'ollama';

  adaptRequest(req: CanonicalRequest): OllamaChatBody {
    const messages: OllamaMessage[] = [];

    if (req.system) {
      messages.push({ role: 'system', content: req.system });
    }

    for (const m of req.messages) {
      this.flattenMessageInto(m, messages);
    }

    const body: OllamaChatBody = {
      messages,
      stream: true,
      options: { num_predict: req.max_tokens },
    };

    if (req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    if (req.stop_sequences && req.stop_sequences.length > 0) {
      body.options = { ...(body.options ?? {}), stop: req.stop_sequences };
    }

    return body;
  }

  private flattenMessageInto(m: CanonicalMessage, out: OllamaMessage[]): void {
    if (m.role === 'user') {
      const textParts: string[] = [];
      const images: string[] = [];
      const toolResults: { content: string }[] = [];

      for (const b of m.content) {
        if (b.type === 'tool_result') {
          toolResults.push({
            content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
          });
        } else if (b.type === 'text') {
          textParts.push(b.text);
        } else if (b.type === 'image') {
          if (b.source.type === 'base64' && b.source.data) {
            images.push(b.source.data);
          }
        }
      }

      if (textParts.length > 0 || images.length > 0) {
        const msg: OllamaMessage = { role: 'user', content: textParts.join('') };
        if (images.length > 0) (msg as any).images = images;
        out.push(msg);
      }
      // Tool results in order — Ollama pairs by position to the prior
      // assistant.tool_calls[] array.
      for (const tr of toolResults) {
        out.push({ role: 'tool', content: tr.content });
      }
      return;
    }

    // role === 'assistant'
    const textParts: string[] = [];
    const toolCalls: Array<{
      id?: string;
      function: { name: string; arguments: Record<string, unknown> };
    }> = [];

    for (const b of m.content) {
      switch (b.type) {
        case 'text':
          textParts.push(b.text);
          break;
        case 'thinking':
          // Drop — Ollama outbound has no thinking slot.
          break;
        case 'tool_use':
          toolCalls.push({
            id: fromToolu(b.id, 'ollama'),
            function: { name: b.name, arguments: b.input },
          });
          break;
      }
    }

    const msg: OllamaMessage = {
      role: 'assistant',
      content: textParts.join(''),
    };
    if (toolCalls.length > 0) {
      (msg as any).tool_calls = toolCalls;
    }
    out.push(msg);
  }
}
