/**
 * Canonical → Azure AI Foundry Responses API request body (`POST /v1/responses`).
 *
 * The Sev-0 #774 home. AIF Responses API uses a flat `input[]` array of typed
 * items rather than a nested `messages[].content[]` structure. Specifically:
 *
 *   - User text          → `{ role: 'user', content: [{ type: 'input_text', text }] }`
 *   - Assistant text     → `{ role: 'assistant', content: [{ type: 'output_text', text }] }`
 *   - Assistant thinking → `{ type: 'reasoning', summary: [{ type: 'summary_text', text }] }`
 *   - Assistant tool_use → `{ type: 'function_call', id, call_id, name, arguments }`
 *   - Tool result        → `{ type: 'function_call_output', call_id, output }`
 *
 * Critical contract: every `function_call` MUST be paired with a matching
 * `function_call_output` (by `call_id`) in the same `input[]` array. Parallel
 * tool batches → N function_call items immediately followed by N function_call_output
 * items, in order. Pairing failure is the documented cause of #774 (AIF
 * rejects with `invalid_request_error: missing function_call_output`).
 *
 * Provider tool ids on this wire are `call_*` format. canonical `toolu_*`
 * gets converted via `fromToolu(id, 'aif-responses')` → `call_*`.
 *
 * cache_control is dropped (Anthropic-only marker; AIF has its own caching
 * that doesn't expose a per-block knob).
 *
 * Spec: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *       §"Phase 0.3 — outbound adapters · AIF Responses"
 */

import type {
  CanonicalRequest,
  CanonicalMessage,
  CanonicalRequestContentBlock,
} from '../canonical/types.js';
import { fromToolu, type ProviderHint } from '../canonical/toolIdNormalize.js';
import type { IOutboundAdapter } from './AdapterContract.js';

interface AIFResponsesBody {
  model?: string;
  input: AIFInputItem[];
  instructions?: string;
  tools?: Array<{
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  tool_choice?: 'auto' | 'required' | 'none' | { type: 'function'; name: string };
  max_output_tokens?: number;
  stream?: boolean;
  /**
   * OpenAI reasoning-model config block — Responses API only.
   * `effort` controls how much internal CoT the model spends before
   * emitting an answer (per MS Learn: minimal|low|medium|high; gpt-5
   * accepts 'minimal', o-series uses low|medium|high).
   * `summary` controls how the model exposes that CoT back to us
   * (auto|concise|detailed; gpt-5 does NOT accept 'concise').
   * Omit on non-reasoning models — they ignore it.
   * Source: https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/reasoning
   */
  reasoning?: {
    effort?: 'minimal' | 'low' | 'medium' | 'high';
    summary?: 'auto' | 'concise' | 'detailed';
  };
}

type AIFInputItem =
  | { role: 'user'; content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> }
  | { role: 'assistant'; content: Array<{ type: 'output_text'; text: string }> }
  | { type: 'reasoning'; summary: Array<{ type: 'summary_text'; text: string }> }
  | { type: 'function_call'; id?: string; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

export class OpenagenticToAIFResponses implements IOutboundAdapter {
  readonly format: ProviderHint = 'aif-responses';

  adaptRequest(req: CanonicalRequest): AIFResponsesBody {
    const input: AIFInputItem[] = [];
    for (const m of req.messages) {
      this.flattenMessageInto(m, input);
    }

    const body: AIFResponsesBody = { input };

    if (req.system) {
      // AIF Responses uses `instructions` for system prompt (not a message role).
      body.instructions = req.system;
    }

    if (req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      }));
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
          body.tool_choice = { type: 'function', name: req.tool_choice.name };
          break;
      }
    }

    body.max_output_tokens = req.max_tokens;

    // Gap 2 — emit `reasoning` block when caller passes effort/summary.
    // Per MS Learn, both fields are independent: caller may set just one.
    // o-series ignores them silently; gpt-5 honors them (with the 'concise'
    // gotcha called out on CanonicalRequest.reasoning_summary).
    if (req.reasoning_effort || req.reasoning_summary) {
      body.reasoning = {};
      if (req.reasoning_effort) body.reasoning.effort = req.reasoning_effort;
      if (req.reasoning_summary) body.reasoning.summary = req.reasoning_summary;
    }

    return body;
  }

  /**
   * Flatten one canonical message into one OR MORE AIF input items.
   * An assistant message with [thinking, text, tool_use, tool_use] becomes
   * 4 separate input items (reasoning, assistant text, function_call × 2).
   * A user message with [tool_result, tool_result] becomes 2 function_call_output
   * items — NOT a user message wrapping them (different from Anthropic shape).
   */
  private flattenMessageInto(m: CanonicalMessage, out: AIFInputItem[]): void {
    if (m.role === 'user') {
      // User-message content blocks split: tool_result blocks become
      // top-level function_call_output items; text/image blocks aggregate
      // into a single user content array.
      const userContent: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> = [];
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          out.push({
            type: 'function_call_output',
            call_id: fromToolu(b.tool_use_id, 'aif-responses'),
            output: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
          });
        } else if (b.type === 'text') {
          userContent.push({ type: 'input_text', text: b.text });
        } else if (b.type === 'image') {
          // AIF supports image input via base64 or URL. Adapter prefers URL when
          // present; otherwise builds a data URL from base64.
          const url = b.source.url
            ? b.source.url
            : b.source.data
              ? `data:${b.source.media_type ?? 'image/png'};base64,${b.source.data}`
              : '';
          if (url) userContent.push({ type: 'input_image', image_url: url });
        }
        // Other block types (thinking, tool_use) MUST NOT appear on user role;
        // silently drop if they do (forward-compat).
      }
      if (userContent.length > 0) {
        out.push({ role: 'user', content: userContent });
      }
      return;
    }

    // role === 'assistant'
    const assistantText: string[] = [];
    const thinkingTexts: string[] = [];
    const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    for (const b of m.content) {
      switch (b.type) {
        case 'text':
          assistantText.push(b.text);
          break;
        case 'thinking':
          thinkingTexts.push(b.thinking);
          break;
        case 'tool_use':
          toolUses.push({ id: b.id, name: b.name, input: b.input });
          break;
        // tool_result and image silently dropped on assistant role.
      }
    }

    // AIF Responses order convention: reasoning first, then assistant text,
    // then function_calls. This matches what the Responses API echoes back
    // in the `output[]` array for multi-turn history.
    if (thinkingTexts.length > 0) {
      out.push({
        type: 'reasoning',
        summary: thinkingTexts.map((t) => ({ type: 'summary_text', text: t })),
      });
    }
    if (assistantText.length > 0) {
      out.push({
        role: 'assistant',
        content: [{ type: 'output_text', text: assistantText.join('') }],
      });
    }
    for (const tu of toolUses) {
      const callId = fromToolu(tu.id, 'aif-responses');
      out.push({
        type: 'function_call',
        call_id: callId,
        name: tu.name,
        arguments: JSON.stringify(tu.input),
      });
    }
  }
}
