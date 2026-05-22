/**
 * C2 — api-level integration: buildAnthropicWireBody must strip thinking
 * when tool_choice forces 'any' or named-function.
 *
 * This test goes through the full api-side builder
 * (buildAnthropicWireBody → completionRequestToCanonical → OpenagenticToAnthropic.adaptRequest)
 * and verifies the same constraint enforced at the SDK adapter layer is
 * honoured end-to-end from the api's CompletionRequest input.
 *
 * Anthropic API constraint: tool_choice:'any' and tool_choice:{type:'function',
 * function:{name:'...'}} are NOT compatible with extended thinking. Only
 * tool_choice:'auto' (default) and tool_choice:'none' are compatible.
 * Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use
 *         §"Forcing tool use" — extended thinking note.
 */
import { describe, it, expect } from 'vitest';
import { buildAnthropicWireBody } from '../buildAnthropicWireBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const BASE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'compose_visual',
      description: 'render a visual',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const BASE_OPTS = {
  model: 'us.anthropic.claude-sonnet-4-6',
  parallelOn: true,
  supportsThinking: true,
  thinkingBudgetTokens: 4096,
};

function makeRequest(tool_choice: unknown): CompletionRequest {
  return {
    messages: [{ role: 'user', content: 'Create a chart of my costs.' }],
    tools: BASE_TOOLS,
    tool_choice,
  } as unknown as CompletionRequest;
}

describe('buildAnthropicWireBody — thinking + tool_choice conflict (C2 api-level)', () => {
  it('C2-api-a: tool_choice "required" + thinking opts → strips thinking from wire body', () => {
    // "required" maps to canonical {type:'any'} via convertToolChoice
    const wire = buildAnthropicWireBody(makeRequest('required'), BASE_OPTS) as any;

    expect(wire.tool_choice?.type).toBe('any');
    // thinking MUST be absent
    expect(wire.thinking).toBeUndefined();
  });

  it('C2-api-b: tool_choice {type:"function", function:{name:"compose_visual"}} + thinking opts → strips thinking', () => {
    // OpenAI named-function shape → canonical {type:'tool', name:'compose_visual'}
    const wire = buildAnthropicWireBody(
      makeRequest({ type: 'function', function: { name: 'compose_visual' } }),
      BASE_OPTS,
    ) as any;

    expect(wire.tool_choice?.type).toBe('tool');
    expect(wire.tool_choice?.name).toBe('compose_visual');
    // thinking MUST be absent
    expect(wire.thinking).toBeUndefined();
  });

  it('C2-api-c: tool_choice "auto" + thinking opts → PRESERVES thinking (normal chat)', () => {
    const wire = buildAnthropicWireBody(makeRequest('auto'), BASE_OPTS) as any;

    expect(wire.tool_choice?.type).toBe('auto');
    // thinking MUST be present
    expect(wire.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });

  it('C2-api-d: tool_choice "none" + thinking opts → PRESERVES thinking (synthesis-retry)', () => {
    const wire = buildAnthropicWireBody(makeRequest('none'), BASE_OPTS) as any;

    expect(wire.tool_choice?.type).toBe('none');
    // 'none' is compatible with extended thinking
    expect(wire.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });
});
