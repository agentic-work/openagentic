/**
 * translate.ts — Pure translation between the Anthropic Messages API wire
 * shape and our internal CompletionRequest / CompletionResponse types.
 *
 * Nothing in this file touches Fastify, the DB, or any provider — it is
 * pure data mapping and fully unit-testable in isolation.
 */

import type { CompletionRequest, CompletionResponse } from '../../services/llm-providers/ILLMProvider.js';

// ---------------------------------------------------------------------------
// Anthropic input types
// ---------------------------------------------------------------------------

export type AnthropicTextBlock = { type: 'text'; text: string };
export type AnthropicToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type AnthropicToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string | Array<AnthropicTextBlock> };

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export type AnthropicRole = 'user' | 'assistant';

export interface AnthropicMessage {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string };

export interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<AnthropicTextBlock>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
}

// ---------------------------------------------------------------------------
// Anthropic output type
// ---------------------------------------------------------------------------

export type AnthropicStopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence';

export type AnthropicContentOut =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export interface AnthropicResponseMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentOut[];
  stop_reason: AnthropicStopReason;
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}

// ---------------------------------------------------------------------------
// 1. anthropicToCompletionRequest
// ---------------------------------------------------------------------------

/**
 * Translate an Anthropic Messages API request body to the internal
 * CompletionRequest shape.
 */
export function anthropicToCompletionRequest(body: AnthropicRequestBody): CompletionRequest {
  const messages: CompletionRequest['messages'] = [];

  // system → prepend as role:'system'
  if (body.system != null) {
    const systemText =
      typeof body.system === 'string'
        ? body.system
        : body.system.map((b) => b.text).join('\n');
    if (systemText) {
      messages.push({ role: 'system', content: systemText });
    }
  }

  // Translate each Anthropic message
  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      // Simple string content
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Array content blocks — split into assistant text/tool_use and user tool_result
    const blocks = msg.content;

    if (msg.role === 'user') {
      // Separate tool_result blocks from text blocks
      const textBlocks = blocks.filter(
        (b): b is AnthropicTextBlock => b.type === 'text',
      );
      const toolResultBlocks = blocks.filter(
        (b): b is AnthropicToolResultBlock => b.type === 'tool_result',
      );

      // If there are text blocks, emit a user message
      if (textBlocks.length > 0) {
        messages.push({
          role: 'user',
          content: textBlocks.map((b) => b.text).join('\n'),
        });
      }

      // Each tool_result becomes a separate 'tool' message
      for (const tr of toolResultBlocks) {
        const content =
          typeof tr.content === 'string'
            ? tr.content
            : tr.content.map((b) => b.text).join('\n');
        messages.push({
          role: 'tool',
          content,
          tool_call_id: tr.tool_use_id,
        });
      }
    } else {
      // assistant message
      const textBlocks = blocks.filter(
        (b): b is AnthropicTextBlock => b.type === 'text',
      );
      const toolUseBlocks = blocks.filter(
        (b): b is AnthropicToolUseBlock => b.type === 'tool_use',
      );

      const textContent = textBlocks.map((b) => b.text).join('\n');

      if (toolUseBlocks.length > 0) {
        // Assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: textContent,
          tool_calls: toolUseBlocks.map((b) => ({
            id: b.id,
            type: 'function' as const,
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input),
            },
          })),
        });
      } else {
        messages.push({ role: 'assistant', content: textContent });
      }
    }
  }

  // Translate tools
  let tools: CompletionRequest['tools'];
  if (body.tools && body.tools.length > 0) {
    tools = body.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  // Translate tool_choice
  let tool_choice: CompletionRequest['tool_choice'];
  if (body.tool_choice) {
    const tc = body.tool_choice;
    if (tc.type === 'auto') {
      tool_choice = 'auto';
    } else if (tc.type === 'any') {
      tool_choice = 'required';
    } else if (tc.type === 'tool') {
      tool_choice = { type: 'function', function: { name: (tc as { type: 'tool'; name: string }).name } };
    }
  }

  return {
    messages,
    model: body.model,
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stream: !!body.stream,
    ...(tools ? { tools } : {}),
    ...(tool_choice !== undefined ? { tool_choice } : {}),
  };
}

// ---------------------------------------------------------------------------
// 2. completionResponseToAnthropic
// ---------------------------------------------------------------------------

/**
 * Translate an internal CompletionResponse (non-stream) to the Anthropic
 * Messages API response shape.
 */
export function completionResponseToAnthropic(
  resp: CompletionResponse,
  model: string,
): AnthropicResponseMessage {
  const choice = resp.choices[0];
  const msg = choice.message;

  // Build content array
  const content: AnthropicContentOut[] = [];

  if (msg.content) {
    content.push({ type: 'text', text: msg.content });
  }

  if (msg.tool_calls && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(tc.function?.arguments ?? '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          input = parsed as Record<string, unknown>;
        }
      } catch {
        // leave as {}
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function?.name ?? '',
        input,
      });
    }
  }

  // Map finish_reason → Anthropic stop_reason
  const finishReason = choice.finish_reason ?? 'stop';
  let stop_reason: AnthropicStopReason;
  if (finishReason === 'stop') {
    stop_reason = 'end_turn';
  } else if (finishReason === 'length') {
    stop_reason = 'max_tokens';
  } else if (finishReason === 'tool_calls') {
    stop_reason = 'tool_use';
  } else {
    stop_reason = 'end_turn';
  }

  return {
    id: resp.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
    },
  };
}
