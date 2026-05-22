/**
 * Second real-capture sanity check for applyCanonicalFrame.
 *
 * Source: reports/verify-cadence/Q-loop-post-811-604acc6d/Q1-azure-subs-rgs-v2.ndjson
 *   - Different model than the primary Q1 (gpt-oss:20b)
 *   - Captures the OBO-empty failure mode (azure tool errored at MCP layer)
 *   - 2742 lines — much larger fixture
 *
 * If the reducer survives this without throwing or producing absurd
 * shape (zero blocks, NaN, undefined types), we've got real confidence
 * the pure function handles wire diversity. SKIP-with-loud-warn applies
 * if the fixture isn't present.
 */
import { describe, it, expect } from 'vitest';
import {
  applyCanonicalFrame,
  initialFrameState,
  type FrameState,
} from '../applyCanonicalFrame';
import {
  loadNDJSONFixture,
  type WireFrame,
} from '../../../__tests__/integration/wireShape.fixtures';

const reduce = (frames: WireFrame[]): FrameState =>
  frames.reduce<FrameState>(applyCanonicalFrame, initialFrameState());

const fixture = loadNDJSONFixture(
  'reports/verify-cadence/Q-loop-post-811-604acc6d/Q1-azure-subs-rgs-v2.ndjson',
  "show me my Azure subscriptions and what's in each resource group",
);

(fixture ? describe : describe.skip)(
  'applyCanonicalFrame — Q1-v2 real-NDJSON replay (gpt-oss:20b + OBO-empty)',
  () => {
    const finalState = reduce(fixture!.frames);

    it('does not throw and produces a non-empty contentBlocks array', () => {
      expect(finalState.contentBlocks.length).toBeGreaterThan(0);
    });

    it('every block has a defined valid type ∈ {thinking, text, tool_use}', () => {
      const types = new Set(finalState.contentBlocks.map((b) => b.type));
      const valid = new Set(['thinking', 'text', 'tool_use']);
      for (const t of types) {
        expect(valid.has(t)).toBe(true);
      }
    });

    it('every block has stable id + numeric index + boolean isComplete', () => {
      for (const b of finalState.contentBlocks) {
        expect(typeof b.id).toBe('string');
        expect(b.id.length).toBeGreaterThan(0);
        expect(typeof b.index).toBe('number');
        expect(Number.isFinite(b.index)).toBe(true);
        expect(typeof b.isComplete).toBe('boolean');
      }
    });

    it('no two blocks share the same id', () => {
      const ids = finalState.contentBlocks.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every tool_use block has toolId + toolName populated', () => {
      const toolBlocks = finalState.contentBlocks.filter((b) => b.type === 'tool_use');
      for (const b of toolBlocks) {
        expect(typeof b.toolId).toBe('string');
        expect(b.toolId).toBeTruthy();
        expect(typeof b.toolName).toBe('string');
        expect(b.toolName).toBeTruthy();
      }
    });

    it('toolIdxByUseId is consistent — every entry points at the right block', () => {
      for (const [id, idx] of Object.entries(finalState.toolIdxByUseId)) {
        const b = finalState.contentBlocks[idx];
        expect(b, `block at idx ${idx} for tool_use_id ${id}`).toBeDefined();
        expect(b.type).toBe('tool_use');
        expect(b.toolId).toBe(id);
      }
    });

    it('nextBlockIndex matches the count of canonical blocks', () => {
      expect(finalState.nextBlockIndex).toBe(finalState.contentBlocks.length);
    });
  },
);
