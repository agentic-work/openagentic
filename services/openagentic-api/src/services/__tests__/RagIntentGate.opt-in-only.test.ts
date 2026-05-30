/**
 * RagIntentGate.opt-in-only.test.ts
 *
 * Task 1.9 + 1.13 of chatmode-ux-mock-parity Phase 1
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §150
 *
 * The legacy V1 gate used keyword-stack regex constants
 * (DOC_SEEK_RE / FEATURE_NAME_RE / VISUALIZATION_RE) to GUESS at user
 * intent. They false-positive'd on common prose ("show me cloud
 * resources and give me a sankey cost diagram for the last 6 months")
 * and bloated the system prompt with irrelevant doc excerpts.
 *
 * V2 contract: RAG fires ONLY when the user explicitly opts in via:
 *   1. `@docs` token (whitespace-bounded, case-insensitive)
 *   2. `/rag` slash command (whitespace-stripped from start)
 *   3. attachment with `kind === 'rag_collection'` or `type === 'rag_collection'`
 *   4. context envelope flag `{ rag_optin: true }` — NOT in scope here;
 *      caller should check that themselves and short-circuit
 *
 * The exported public surface is `detectExplicitRagOptIn(message, attachments?)`.
 * This is NOT regex intent classification — it's parsing user-typed
 * MARKERS, the same shape as Claude Code's slash-command parser. Per
 * arch-test EXEMPT note: "tool-name prefix string-match is a contract
 * not routing".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { detectExplicitRagOptIn } from '../RagIntentGate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RAG_INTENT_GATE_SOURCE = join(__dirname, '..', 'RagIntentGate.ts');

describe('RagIntentGate — V2 trim: opt-in only', () => {
  describe('SOURCE GREP — banned regex constants are gone', () => {
    const source = readFileSync(RAG_INTENT_GATE_SOURCE, 'utf8');

    it('does NOT contain DOC_SEEK_RE', () => {
      expect(source).not.toContain('DOC_SEEK_RE');
    });

    it('does NOT contain FEATURE_NAME_RE', () => {
      expect(source).not.toContain('FEATURE_NAME_RE');
    });

    it('does NOT contain VISUALIZATION_RE', () => {
      expect(source).not.toContain('VISUALIZATION_RE');
    });
  });

  describe('SHAPE — module exports', () => {
    it('exports detectExplicitRagOptIn', async () => {
      const mod = await import('../RagIntentGate.js');
      expect(typeof mod.detectExplicitRagOptIn).toBe('function');
    });
  });

  describe('BEHAVIOR — explicit opt-in semantics', () => {
    it('plain prose without any marker → false', () => {
      expect(detectExplicitRagOptIn('show me cloud resources')).toBe(false);
    });

    it('@docs token mid-message → true', () => {
      expect(
        detectExplicitRagOptIn('what does our @docs say about retries?'),
      ).toBe(true);
    });

    it('/rag slash command at start → true', () => {
      expect(detectExplicitRagOptIn('/rag find auth flow')).toBe(true);
    });

    it('attachment with kind: rag_collection → true', () => {
      expect(
        detectExplicitRagOptIn('plain query', [{ kind: 'rag_collection' }]),
      ).toBe(true);
    });

    it('attachment with type: rag_collection → true', () => {
      expect(
        detectExplicitRagOptIn('plain query', [{ type: 'rag_collection' }]),
      ).toBe(true);
    });

    it('attachment with kind: image → false', () => {
      expect(
        detectExplicitRagOptIn('plain query', [{ kind: 'image' }]),
      ).toBe(false);
    });

    it('empty string → false', () => {
      expect(detectExplicitRagOptIn('')).toBe(false);
    });

    it('undefined message → false (defensive)', () => {
      expect(detectExplicitRagOptIn(undefined as any)).toBe(false);
    });

    it('null message → false (defensive)', () => {
      expect(detectExplicitRagOptIn(null as any)).toBe(false);
    });
  });

  describe('BEHAVIOR — case-insensitivity for explicit markers', () => {
    it('@DOCS uppercase → true', () => {
      expect(detectExplicitRagOptIn('what does @DOCS say')).toBe(true);
    });

    it('/RAG uppercase → true', () => {
      expect(detectExplicitRagOptIn('/RAG find me something')).toBe(true);
    });
  });

  describe('BEHAVIOR — does NOT classify intent (this is the V1 trap)', () => {
    it('keyword "documentation" without @docs → false (NO regex inference)', () => {
      expect(
        detectExplicitRagOptIn('show me the documentation for routing'),
      ).toBe(false);
    });

    it('keyword "docs" inline without @ prefix → false', () => {
      expect(detectExplicitRagOptIn('please find the docs')).toBe(false);
    });

    it('keyword "knowledge base" → false', () => {
      expect(detectExplicitRagOptIn('search the knowledge base')).toBe(false);
    });

    it('the original failing prompt → false (the smoking gun)', () => {
      expect(
        detectExplicitRagOptIn(
          'show me cloud resources and give me a sankey cost diagram for the last 6 months',
        ),
      ).toBe(false);
    });

    it('long-form question about platform → false', () => {
      expect(
        detectExplicitRagOptIn(
          'how does the smart router decide which model to escalate to',
        ),
      ).toBe(false);
    });
  });

  describe('BEHAVIOR — @docs whitespace boundary', () => {
    it('@docs at very start → true', () => {
      expect(detectExplicitRagOptIn('@docs how do I use mcp')).toBe(true);
    });

    it('@docsearch (substring, not whitespace bounded) → false', () => {
      expect(detectExplicitRagOptIn('use @docsearch')).toBe(false);
    });

    it('@docs.api (followed by punctuation, not word boundary) — true OR false acceptable as long as NOT inferring intent', () => {
      // Word boundary semantics — \b in JS treats . as non-word, so this
      // matches under \s@docs\b. Either behavior is acceptable to the
      // contract as long as it's a marker-parse, not intent classification.
      const result = detectExplicitRagOptIn('use @docs.api maybe');
      expect(typeof result).toBe('boolean');
    });
  });

  describe('BEHAVIOR — null/undefined attachments are safe', () => {
    it('undefined attachments + plain prose → false', () => {
      expect(detectExplicitRagOptIn('plain query', undefined)).toBe(false);
    });

    it('empty attachments + plain prose → false', () => {
      expect(detectExplicitRagOptIn('plain query', [])).toBe(false);
    });

    it('attachment with no kind/type → false', () => {
      expect(detectExplicitRagOptIn('plain query', [{}])).toBe(false);
    });

    it('null entries in attachments array → false (defensive)', () => {
      expect(
        detectExplicitRagOptIn('plain query', [null as any]),
      ).toBe(false);
    });
  });
});
