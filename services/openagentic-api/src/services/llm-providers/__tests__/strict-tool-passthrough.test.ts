/**
 * Phase A.3 — strict tool passthrough RED → GREEN test.
 *
 * Asserts that when a tool definition carries `function.strict: true`
 * (OpenAI-shape), the resulting Anthropic wire body preserves
 * `strict: true` on the tool entry. This exercises the full chain:
 *
 *   ComposeVisualTool / ComposeAppTool / RenderArtifactTool
 *     → completionRequestToCanonical (legacyShape.ts convertTools)
 *       → OpenagenticToAnthropic.adaptRequest
 *         → buildAnthropicWireBody body.tools
 *
 * RED: before Phase A.3 changes, `strict` is dropped by legacyShape.ts
 *      `convertTools()` which only copies name/description/input_schema.
 * GREEN: after fixing legacyShape + OpenagenticToAnthropic, strict
 *        survives to the wire body.
 *
 * AMENDMENT (A.6 live-verify, 2026-05-19): strict:true was removed from
 * COMPOSE_VISUAL_TOOL / COMPOSE_APP_TOOL / RENDER_ARTIFACT_TOOL because
 * Anthropic rejects tool definitions that carry `strict:true` but have
 * nested object schemas without `additionalProperties:false`. The free-form
 * `data` / `params` fields make full strict compliance impractical.
 * Section 2 of this test is updated to assert strict is NOT set on those
 * three tools (and that A.1 input_examples are preserved). Section 1
 * (generic passthrough test with a synthetic tool) still exercises the
 * adapter code path so the SDK chain is covered.
 *
 * Also tests the Bedrock-Claude path (buildBedrockClaudeBody) which
 * delegates to buildAnthropicWireBody — same fix, same assertion.
 *
 * Pre-existing sibling tests that must remain green (run after this):
 *   src/services/llm-providers/anthropic/__tests__/buildAnthropicWireBody.test.ts
 */

import { describe, it, expect } from 'vitest';
import { buildAnthropicWireBody } from '../anthropic/buildAnthropicWireBody.js';
import { buildBedrockClaudeBody } from '../aws/buildBedrockClaudeBody.js';
import type { CompletionRequest } from '../ILLMProvider.js';
import { COMPOSE_VISUAL_TOOL } from '../../ComposeVisualTool.js';
import { COMPOSE_APP_TOOL } from '../../ComposeAppTool.js';
import { RENDER_ARTIFACT_TOOL } from '../../RenderArtifactTool.js';

const baseOpts = { model: 'claude-sonnet-4-6', parallelOn: true };

// ---------------------------------------------------------------------------
// Helper: build a minimal CompletionRequest with a single tool
// ---------------------------------------------------------------------------
function makeRequest(tool: typeof COMPOSE_VISUAL_TOOL | typeof COMPOSE_APP_TOOL | typeof RENDER_ARTIFACT_TOOL): CompletionRequest {
  return {
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 100,
    tools: [tool as any],
  } as CompletionRequest;
}

// ---------------------------------------------------------------------------
// 1. Generic strict passthrough (minimal synthetic tool definition)
// ---------------------------------------------------------------------------
describe('strict tool passthrough — buildAnthropicWireBody', () => {
  it('tool with function.strict: true → wire body includes strict: true', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'render a chart' }],
        max_tokens: 100,
        tools: [
          {
            type: 'function',
            function: {
              name: 'compose_visual',
              strict: true,
              description: 'Render an inline chart',
              parameters: {
                type: 'object',
                properties: { template: { type: 'string' } },
                required: ['template'],
              },
            },
          },
        ],
      } as CompletionRequest,
      baseOpts,
    );

    const tools = body.tools as any[];
    expect(tools).toHaveLength(1);
    // The Anthropic wire tool must carry strict: true
    expect(tools[0].strict).toBe(true);
    // Other required fields must still be present
    expect(tools[0].name).toBe('compose_visual');
    expect(tools[0].description).toBeDefined();
    expect(tools[0].input_schema).toBeDefined();
  });

  it('tool WITHOUT strict → wire body does NOT include strict field', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        tools: [
          {
            type: 'function',
            function: {
              name: 'plain_tool',
              description: 'No strict',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      } as CompletionRequest,
      baseOpts,
    );

    const tools = body.tools as any[];
    expect(tools).toHaveLength(1);
    // strict MUST NOT be present (or must be falsy) on non-strict tools
    expect(tools[0].strict).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Artifact tool definitions — strict mode removed (A.6 live-verify finding)
//
// Phase A.3 originally set strict:true on all three artifact tools.
// A.6 live-verify discovered Anthropic rejects tool definitions with nested
// object schemas that lack additionalProperties:false — the free-form `data`
// and `params` fields make full strict compliance impractical without
// stripping dispatch capability entirely.
//
// Decision: remove strict:true from artifact tools. A.4 tool_choice forcing
// handles dispatch enforcement server-side. The generic strict passthrough
// (section 1 above) still exercises the adapter code path with a synthetic
// tool that has correct strict-mode schemas.
// ---------------------------------------------------------------------------
describe('artifact tool definitions — strict mode disabled (A.6 fix)', () => {
  it('COMPOSE_VISUAL_TOOL.function.strict is NOT set (strict removed A.6)', () => {
    expect((COMPOSE_VISUAL_TOOL as any).function.strict).toBeUndefined();
  });

  it('COMPOSE_APP_TOOL.function.strict is NOT set (strict removed A.6)', () => {
    expect((COMPOSE_APP_TOOL as any).function.strict).toBeUndefined();
  });

  it('RENDER_ARTIFACT_TOOL.function.strict is NOT set (strict removed A.6)', () => {
    expect((RENDER_ARTIFACT_TOOL as any).function.strict).toBeUndefined();
  });

  it('COMPOSE_VISUAL_TOOL still has input_examples (A.1 preserved)', () => {
    const examples = (COMPOSE_VISUAL_TOOL as any).function.input_examples;
    expect(Array.isArray(examples)).toBe(true);
    expect(examples.length).toBeGreaterThan(0);
  });

  it('COMPOSE_APP_TOOL still has input_examples (A.1 preserved)', () => {
    const examples = (COMPOSE_APP_TOOL as any).function.input_examples;
    expect(Array.isArray(examples)).toBe(true);
    expect(examples.length).toBeGreaterThan(0);
  });

  it('RENDER_ARTIFACT_TOOL still has input_examples (A.1 preserved)', () => {
    const examples = (RENDER_ARTIFACT_TOOL as any).function.input_examples;
    expect(Array.isArray(examples)).toBe(true);
    expect(examples.length).toBeGreaterThan(0);
  });

  it('COMPOSE_VISUAL_TOOL wire body does NOT emit strict (no strict on tool)', () => {
    const body = buildAnthropicWireBody(makeRequest(COMPOSE_VISUAL_TOOL), baseOpts);
    const tools = body.tools as any[];
    const cv = tools.find((t) => t.name === 'compose_visual');
    expect(cv).toBeDefined();
    expect(cv.strict).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Anthropic-native-shape branch in convertTools — strict propagation
//    (Issue 1 fix: legacyShape.ts Anthropic-shape branch must propagate strict)
// ---------------------------------------------------------------------------
describe('strict tool passthrough — Anthropic-native-shape tool object', () => {
  it('tool in Anthropic-native shape with strict: true → wire body includes strict: true', () => {
    // Construct a tool already in Anthropic-canonical shape (name + input_schema,
    // no `type:'function'` wrapper). This exercises the second branch in
    // convertTools() that was previously missing the strict propagation.
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'render something' }],
        max_tokens: 100,
        tools: [
          {
            name: 'foo',
            description: 'A tool in Anthropic-native shape',
            input_schema: {
              type: 'object',
              properties: { bar: { type: 'string' } },
              required: ['bar'],
            },
            strict: true,
          } as any,
        ],
      } as CompletionRequest,
      baseOpts,
    );

    const tools = body.tools as any[];
    expect(tools).toHaveLength(1);
    // The Anthropic wire tool must carry strict: true
    expect(tools[0].strict).toBe(true);
    expect(tools[0].name).toBe('foo');
    expect(tools[0].input_schema).toBeDefined();
  });

  it('Anthropic-native-shape tool WITHOUT strict → wire body does NOT include strict field', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        tools: [
          {
            name: 'bar',
            description: 'No strict field',
            input_schema: { type: 'object', properties: {} },
          } as any,
        ],
      } as CompletionRequest,
      baseOpts,
    );

    const tools = body.tools as any[];
    expect(tools).toHaveLength(1);
    expect(tools[0].strict).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Bedrock-Claude path (buildBedrockClaudeBody) — same assertion
// ---------------------------------------------------------------------------
describe('strict tool passthrough — buildBedrockClaudeBody (Bedrock-Claude)', () => {
  it('compose_visual strict NOT set on Bedrock wire body (strict removed A.6)', () => {
    const body = buildBedrockClaudeBody(makeRequest(COMPOSE_VISUAL_TOOL), {
      parallelOn: true,
    });
    const tools = (body as any).tools as any[];
    expect(tools).toBeDefined();
    const cv = tools.find((t: any) => t.name === 'compose_visual');
    expect(cv).toBeDefined();
    // strict was removed from compose_visual in A.6 (see file header comment)
    expect(cv.strict).toBeUndefined();
  });

  it('tool WITHOUT strict → Bedrock wire body does NOT include strict field', () => {
    const body = buildBedrockClaudeBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        tools: [
          {
            type: 'function',
            function: {
              name: 'plain_tool',
              description: 'No strict',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      } as CompletionRequest,
      { parallelOn: true },
    );

    const tools = (body as any).tools as any[];
    expect(tools).toHaveLength(1);
    expect(tools[0].strict).toBeUndefined();
  });
});
