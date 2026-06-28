/**
 * C2 — thinking + tool_choice named-function / 'any' conflict.
 *
 * Anthropic API constraint (documented at:
 * https://platform.claude.com/docs/en/agents-and-tools/tool-use
 * section "Forcing tool use"):
 *   "When using extended thinking with tool use, tool_choice {type:'any'}
 *    and tool_choice {type:'tool', name:'...'} are not supported and will
 *    result in an error. Only tool_choice {type:'auto'} (the default) and
 *    tool_choice {type:'none'} are compatible with extended thinking."
 *
 * The fix lives in OpenagenticToAnthropic.adaptRequest() — the single
 * layer that knows BOTH canonical shape AND Anthropic wire constraints.
 * chatLoop should NOT need to know about this; it just sets tool_choice
 * to whatever makes sense; the adapter strips thinking when needed.
 *
 * Tests:
 *   C2-a. tool_choice:'any' + thinking → thinking STRIPPED from wire body
 *   C2-b. tool_choice:{type:'tool',name:'compose_visual'} + thinking → thinking STRIPPED
 *   C2-c. tool_choice:'auto' + thinking → thinking PRESERVED (normal chat traffic)
 *   C2-d. tool_choice:'none' + thinking → thinking PRESERVED (synthesis-retry path)
 *   C2-e. tool_choice:'any' WITHOUT thinking → no change (nothing to strip)
 *   C2-f. tool_choice:{type:'tool',...} WITHOUT thinking → no change
 */
import { describe, it, expect } from 'vitest';
import { OpenagenticToAnthropic } from '../OpenagenticToAnthropic.js';
import type { CanonicalRequest } from '../../canonical/types.js';

function makeBase(): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    system: null,
    tools: [
      {
        name: 'compose_visual',
        description: 'render a visual',
        input_schema: { type: 'object', properties: {} },
      },
    ],
    tool_choice: { type: 'auto' },
    max_tokens: 8192,
    thinking: { type: 'enabled', budget_tokens: 4096 },
  };
}

describe('OpenagenticToAnthropic — thinking + tool_choice conflict (C2)', () => {
  const adapter = new OpenagenticToAnthropic();

  it('C2-a: tool_choice "any" + thinking → strips thinking from wire body', () => {
    const req: CanonicalRequest = { ...makeBase(), tool_choice: { type: 'any' } };
    const wire = adapter.adaptRequest(req) as any;

    expect(wire.tool_choice?.type).toBe('any');
    // thinking MUST be absent — stripped by adapter to prevent Anthropic API error
    expect(wire.thinking).toBeUndefined();
  });

  it('C2-b: tool_choice {type:"tool", name:"compose_visual"} + thinking → strips thinking', () => {
    const req: CanonicalRequest = {
      ...makeBase(),
      tool_choice: { type: 'tool', name: 'compose_visual' },
    };
    const wire = adapter.adaptRequest(req) as any;

    expect(wire.tool_choice?.type).toBe('tool');
    expect(wire.tool_choice?.name).toBe('compose_visual');
    // thinking MUST be absent
    expect(wire.thinking).toBeUndefined();
  });

  it('C2-c: tool_choice "auto" + thinking → PRESERVES thinking (normal chat traffic)', () => {
    const req: CanonicalRequest = { ...makeBase(), tool_choice: { type: 'auto' } };
    const wire = adapter.adaptRequest(req) as any;

    expect(wire.tool_choice?.type).toBe('auto');
    // thinking MUST be present — auto is compatible with extended thinking
    expect(wire.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });

  it('C2-d: tool_choice "none" + thinking → PRESERVES thinking (synthesis-retry path)', () => {
    const req: CanonicalRequest = { ...makeBase(), tool_choice: { type: 'none' } };
    const wire = adapter.adaptRequest(req) as any;

    expect(wire.tool_choice?.type).toBe('none');
    // 'none' is compatible with extended thinking per the spec
    expect(wire.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });

  it('C2-e: tool_choice "any" WITHOUT thinking → no thinking in wire (nothing to strip)', () => {
    const req: CanonicalRequest = { ...makeBase(), tool_choice: { type: 'any' } };
    delete (req as any).thinking;
    const wire = adapter.adaptRequest(req) as any;

    expect(wire.tool_choice?.type).toBe('any');
    expect(wire.thinking).toBeUndefined();
  });

  it('C2-f: tool_choice named-function WITHOUT thinking → no thinking in wire', () => {
    const req: CanonicalRequest = {
      ...makeBase(),
      tool_choice: { type: 'tool', name: 'compose_visual' },
    };
    delete (req as any).thinking;
    const wire = adapter.adaptRequest(req) as any;

    expect(wire.tool_choice?.type).toBe('tool');
    expect(wire.tool_choice?.name).toBe('compose_visual');
    expect(wire.thinking).toBeUndefined();
  });
});
