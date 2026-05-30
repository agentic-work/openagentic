/**
 * Phase 4 / Task 4.1 — ToolResult two-channel envelope (RED → GREEN).
 *
 * Pins the type contract for the model-channel (`structuredContent`) +
 * UI-channel (`_meta`) split per Spec §6.1.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { ToolResult, StructuredContent, ToolResultMeta } from '../ToolResult.js';

describe('ToolResult envelope', () => {
  it('has ok, structuredContent, _meta', () => {
    expectTypeOf<ToolResult>().toHaveProperty('ok').toEqualTypeOf<boolean>();
    expectTypeOf<ToolResult>()
      .toHaveProperty('structuredContent')
      .toMatchTypeOf<StructuredContent>();
    expectTypeOf<ToolResult>().toHaveProperty('_meta').toMatchTypeOf<ToolResultMeta>();
  });

  it('structuredContent has summary required + data + truncated optional', () => {
    expectTypeOf<StructuredContent>().toHaveProperty('summary').toEqualTypeOf<string>();
    // data is optional unknown
    expectTypeOf<StructuredContent>().toMatchTypeOf<{
      summary: string;
      data?: unknown;
      truncated?: boolean;
    }>();
  });

  it('_meta has size + elapsed required, outputTemplate / artifactHandle / cost optional', () => {
    expectTypeOf<ToolResultMeta>().toHaveProperty('size').toEqualTypeOf<number>();
    expectTypeOf<ToolResultMeta>().toHaveProperty('elapsed').toEqualTypeOf<number>();
    expectTypeOf<ToolResultMeta>().toMatchTypeOf<{
      size: number;
      elapsed: number;
      outputTemplate?: string;
      artifactHandle?: string;
      cost?: number;
    }>();
  });
});
