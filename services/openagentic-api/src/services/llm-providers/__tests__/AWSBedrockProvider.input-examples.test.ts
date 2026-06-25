/**
 * #1112 — AWSBedrockProvider must propagate tool.input_examples into the
 * tool description body so Bedrock-served Claude models see the exemplar
 * shapes at schema-prompt time.
 *
 * Live evidence (2026-05-25, pod -9cc54f4f4-qxsrs, fb007bea image,
 * Sonnet 4.6 via Bedrock): compose_app was force-dispatched via
 * `tool_choice: {type:'tool', name:'compose_app'}` on a permission-
 * matrix prompt. Detector and force both worked. But Sonnet emitted:
 *   { principals: [{...object...}], cells: [] }
 * instead of:
 *   { title, principals: [strings], actions: [strings], cells: [{...}] }
 *
 * Root cause: AWSBedrockProvider.ts:1813-1818 built tool defs with
 * only {name, description, input_schema}, stripping the input_examples
 * field that COMPOSE_APP_TOOL.input_examples populates from each
 * template's exampleParams.
 *
 * Anthropic Messages API doesn't have a dedicated `input_examples`
 * wire field — the canonical pattern is to inline the examples in the
 * description. This test pins that the Bedrock serializer inlines them.
 *
 * Test strategy: exercise the REAL provider serializer. The tool-def
 * builder used by `AWSBedrockProvider.convertToBedrock` was extracted into
 * `helpers/bedrockToolExamples.ts` (single source of truth) so the provider
 * map and this test invoke the SAME code path — no mirror copy that could
 * drift. `buildBedrockToolDef` is exactly what the provider calls for each
 * tool entry; the schema-passthrough default mirrors the provider's identity
 * case (the provider wires `flattenTopLevelUnions` as the schema transform).
 */
import { describe, it, expect } from 'vitest';
import { buildBedrockToolDef } from '../helpers/bedrockToolExamples.js';

/** Thin alias so the assertions read against the real provider helper. */
function buildToolDef(tool: any): any {
  return buildBedrockToolDef(tool);
}

describe('#1112 — AWSBedrockProvider inlines tool.input_examples into description', () => {
  it('preserves base description when no input_examples', () => {
    const toolDef = buildToolDef({
      function: {
        name: 'compose_app',
        description: 'Compose an interactive app.',
        parameters: { type: 'object' },
      },
    });
    expect(toolDef.name).toBe('compose_app');
    expect(toolDef.description).toBe('Compose an interactive app.');
    expect(toolDef.input_schema).toEqual({ type: 'object' });
  });

  it('inlines input_examples as fenced JSON blocks in the description', () => {
    const toolDef = buildToolDef({
      function: {
        name: 'compose_app',
        description: 'Compose an interactive app.',
        parameters: { type: 'object' },
        input_examples: [
          {
            template: 'permission-matrix',
            title: 'IAM permission matrix — chat-pipeline',
            params: {
              title: 'IAM perms',
              principals: ['sa:chat-api', 'sa:admin-portal'],
              actions: ['s3:GetObject', 'iam:PassRole'],
              cells: [
                { principal: 'sa:chat-api', action: 's3:GetObject', effect: 'allow' },
              ],
            },
          },
        ],
      },
    });
    expect(toolDef.description).toContain('Compose an interactive app.');
    expect(toolDef.description).toContain('Example inputs');
    expect(toolDef.description).toContain('use these shapes verbatim');
    expect(toolDef.description).toContain('"template": "permission-matrix"');
    expect(toolDef.description).toContain('"principals"');
    expect(toolDef.description).toContain('"sa:chat-api"');
    expect(toolDef.description).toContain('"effect": "allow"');
  });

  it('handles multiple examples — one fenced block per example', () => {
    const toolDef = buildToolDef({
      function: {
        name: 'compose_visual',
        description: 'Compose a visualization.',
        parameters: { type: 'object' },
        input_examples: [
          { template: 'sankey', params: { flows: [{ source: 'a', target: 'b', value: 1 }] } },
          { template: 'donut', params: { slices: [{ label: 'x', value: 10 }] } },
        ],
      },
    });
    const fenceCount = (toolDef.description.match(/```json/g) || []).length;
    expect(fenceCount).toBe(2);
    expect(toolDef.description).toContain('"template": "sankey"');
    expect(toolDef.description).toContain('"template": "donut"');
  });

  it('falls back to flat input_examples when not nested under function', () => {
    const toolDef = buildToolDef({
      name: 'plain_tool',
      description: 'A plain tool.',
      input_schema: { type: 'object' },
      input_examples: [{ template: 'flat', params: { x: 1 } }],
    });
    expect(toolDef.name).toBe('plain_tool');
    expect(toolDef.description).toContain('"template": "flat"');
  });

  it('skips un-serializable examples gracefully (no throw)', () => {
    const circular: any = { template: 'x' };
    circular.self = circular;
    const toolDef = buildToolDef({
      function: {
        name: 'tool',
        description: 'desc',
        input_examples: [circular, { template: 'good', params: { ok: true } }],
      },
    });
    // The circular ref is skipped silently; the second example IS serialized.
    expect(toolDef.description).toContain('"template": "good"');
    // The fence count is exactly 1 (the good one).
    const fenceCount = (toolDef.description.match(/```json/g) || []).length;
    expect(fenceCount).toBe(1);
  });
});
