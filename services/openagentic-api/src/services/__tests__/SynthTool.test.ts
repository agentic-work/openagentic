/**
 * SynthTool — RED test for the renamed T1 meta-tool definition.
 *
 * chatmode-rip plan §Phase C task C.5: rename `synth_execute` → `synth`
 * in the T1 catalog. The new SynthTool.ts owns the canonical definition;
 * the existing SynthExecuteTool.ts stays intact for transitional dispatch
 * compatibility until the C.1 catalog rewrite swaps the name everywhere.
 *
 * This test pins ONLY the tool-definition shape. The OBO + CredentialBroker
 * dispatch (plan §C.5 step 1-5) lands as a follow-up commit that wires
 * userJwt through chatLoop.
 */
import { describe, it, expect } from 'vitest';
import { SYNTH_TOOL, isSynthTool } from '../SynthTool.js';

describe('SYNTH_TOOL definition (chatmode-rip Phase C.5)', () => {
  it('declares function-shape with name="synth" (renamed from synth_execute)', () => {
    expect(SYNTH_TOOL.type).toBe('function');
    expect(SYNTH_TOOL.function.name).toBe('synth');
  });

  it('description signals OBO + capability declaration + Python sandbox', () => {
    const d = SYNTH_TOOL.function.description;
    expect(typeof d).toBe('string');
    // OBO is the load-bearing security contract — description must signal it.
    expect(d).toMatch(/capabilit/i);
    // Sandbox / Python remain.
    expect(d).toMatch(/python|sandbox/i);
  });

  it('input_schema requires code + intent; capabilities optional array', () => {
    const params = SYNTH_TOOL.function.parameters;
    expect(params.type).toBe('object');
    expect(params.required).toEqual(
      expect.arrayContaining(['code', 'intent']),
    );
    expect(params.required).toHaveLength(2);
    expect(params.properties.code.type).toBe('string');
    expect(params.properties.intent.type).toBe('string');
    expect(params.properties.capabilities.type).toBe('array');
  });

  it('isSynthTool name guard returns true for "synth" only', () => {
    expect(isSynthTool('synth')).toBe(true);
    expect(isSynthTool('synth_execute')).toBe(false);
    expect(isSynthTool('synth_synthesize')).toBe(false);
    expect(isSynthTool('Task')).toBe(false);
  });
});
