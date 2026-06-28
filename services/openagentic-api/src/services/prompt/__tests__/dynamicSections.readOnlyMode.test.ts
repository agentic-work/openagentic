/**
 * #790 — global READ-ONLY mode system-prompt section.
 *
 * When the admin flips the platform-wide READ-ONLY toggle ON, the chat
 * pipeline must INFORM the model so it stops attempting mutations
 * (create / update / delete / scale / deploy / etc). Otherwise the model
 * happily emits write tool_calls that get rejected at evaluate() time,
 * burning turns + frustrating the user.
 *
 * Contract:
 *   - readOnlyMode=false → returns empty string (caller drops the section).
 *   - readOnlyMode=true  → returns a clearly-marked block explaining the
 *     block, mentioning the verbs the model should NOT call, and stating
 *     that the platform will reject write attempts before execution.
 */
import { describe, it, expect } from 'vitest';
import { getReadOnlyModeSection } from '../dynamicSections.js';

describe('#790 getReadOnlyModeSection — global READ-ONLY system-prompt block', () => {
  it('returns empty string when readOnlyMode is false', () => {
    expect(getReadOnlyModeSection(false)).toBe('');
  });

  it('returns a non-empty block when readOnlyMode is true', () => {
    const out = getReadOnlyModeSection(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('block clearly states READ-ONLY mode is active', () => {
    const out = getReadOnlyModeSection(true);
    expect(out).toMatch(/READ-ONLY/i);
    expect(out).toMatch(/active/i);
  });

  it('block names mutation categories the model must avoid', () => {
    const out = getReadOnlyModeSection(true);
    // Mention at least create/update/delete + deploy/scale variants so the
    // model has explicit verb anchors.
    expect(out.toLowerCase()).toContain('create');
    expect(out.toLowerCase()).toContain('update');
    expect(out.toLowerCase()).toContain('delete');
  });

  it('block warns that write attempts will be rejected before execution', () => {
    const out = getReadOnlyModeSection(true);
    expect(out.toLowerCase()).toMatch(/reject/);
  });
});
