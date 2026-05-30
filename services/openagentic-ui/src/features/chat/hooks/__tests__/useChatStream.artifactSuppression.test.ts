/**
 * P1-5 of chatmode UX parity — suppress orphan / trivial artifact
 * slide-outs that the model fires for plain prose.
 *
 * Punch list ref: docs/superpowers/specs/2026-04-30-chatmode-ux-parity-punchlist.md
 *
 * User direction (verbatim 2026-04-30):
 * "the broken almost always empty or shitty Html Artifact slide outs are
 *  still popping up when they probably shouldnt - as old cruft."
 *
 * The server emits `artifact_open` for any structured response, but plain
 * prose with no fences / SVG / Mermaid / chart syntax should NEVER have
 * triggered the slide-out. The hook checks at `artifact_close` whether the
 * accumulated content has real substance and drops the panel when it does
 * not — same effect as if the open frame had never fired.
 *
 * This file specifies the pure helper `isArtifactWorthShowing(content,
 * kind)`. The wire-up (calling it inside the artifact_close case) is
 * verified by reading the production code; this file freezes the
 * substance-detection contract.
 */

import { describe, it, expect } from 'vitest';
import { isArtifactWorthShowing } from '../useChatStream';

describe('isArtifactWorthShowing — P1-5 trivial-artifact suppression', () => {
  describe('drops the panel (returns false)', () => {
    it('empty content', () => {
      expect(isArtifactWorthShowing('', 'markdown')).toBe(false);
    });
    it('whitespace-only content', () => {
      expect(isArtifactWorthShowing('   \n  \t\n', 'markdown')).toBe(false);
    });
    it('short plain markdown without fences or diagrams', () => {
      expect(isArtifactWorthShowing('Sure! Here you go.', 'markdown')).toBe(
        false,
      );
    });
    it('one-line apology that has no real artifact', () => {
      expect(
        isArtifactWorthShowing('I cannot help with that.', 'markdown'),
      ).toBe(false);
    });
  });

  describe('shows the panel (returns true)', () => {
    it('markdown with a fenced code block', () => {
      const md = 'Here:\n```typescript\nexport const x = 1;\n```';
      expect(isArtifactWorthShowing(md, 'markdown')).toBe(true);
    });
    it('markdown containing an inline SVG', () => {
      expect(
        isArtifactWorthShowing(
          'See diagram:\n<svg xmlns="..."><rect/></svg>',
          'markdown',
        ),
      ).toBe(true);
    });
    it('markdown containing a Mermaid graph fence', () => {
      const md = '```mermaid\ngraph TD\n  A-->B\n```';
      expect(isArtifactWorthShowing(md, 'markdown')).toBe(true);
    });
    it('markdown containing a Mermaid sequenceDiagram', () => {
      const md = '```mermaid\nsequenceDiagram\n  A->>B: hi\n```';
      expect(isArtifactWorthShowing(md, 'markdown')).toBe(true);
    });
    it('markdown containing a Mermaid flowchart', () => {
      const md = '```mermaid\nflowchart LR\n  A-->B\n```';
      expect(isArtifactWorthShowing(md, 'markdown')).toBe(true);
    });
    it('long markdown prose (≥ 200 chars) — assume the user wants it docked', () => {
      const long = 'a'.repeat(220);
      expect(isArtifactWorthShowing(long, 'markdown')).toBe(true);
    });
    it('non-markdown kind always shows (code, chart, csv, mermaid)', () => {
      // The slide-out for those kinds is the whole point — they're never
      // confused with prose. Suppression only applies to markdown.
      expect(isArtifactWorthShowing('export const x = 1', 'code')).toBe(true);
      expect(isArtifactWorthShowing('a,b\n1,2', 'csv')).toBe(true);
      expect(isArtifactWorthShowing('graph TD\n  A-->B', 'mermaid')).toBe(true);
      expect(isArtifactWorthShowing('{"data":[1,2]}', 'chart')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('empty content in code kind still drops (no point showing empty file)', () => {
      expect(isArtifactWorthShowing('', 'code')).toBe(false);
    });
    it('whitespace-only code drops', () => {
      expect(isArtifactWorthShowing('  \n  ', 'code')).toBe(false);
    });
    it('a single-line markdown table still shows (≥ pipe count signals substance)', () => {
      const tbl = '| a | b |\n|---|---|\n| 1 | 2 |';
      expect(isArtifactWorthShowing(tbl, 'markdown')).toBe(true);
    });
  });
});
