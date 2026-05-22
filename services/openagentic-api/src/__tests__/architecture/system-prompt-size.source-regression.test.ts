/**
 * Phase B.5 (rev-2 plan) — pin the role-keyed prompt size cap.
 *
 * The rev-2 spec hard-rules total system prompt ≤ 5000 tokens (Claude
 * Code's `getSystemPrompt` rendered output). This test enforces it on
 * the static .md files alone, leaving headroom for ~500 tokens of
 * dynamic sections (<session-facts> + <memories> + <mcp-instructions>)
 * appended at runtime.
 *
 * Cap: 4500 tokens × 4 chars/token = 18000 chars per .md file.
 *
 * If this test fails: trim the .md file, don't bump the cap.
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-three-layer-architecture.md §Layer-1
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PROMPTS_DIR = resolve(__filename, '../../../../prompts');

const MAX_CHARS = 18000; // 4500 tokens at 4 chars/token estimate

describe('arch: role-keyed system prompt size cap', () => {
  for (const role of ['admin', 'member'] as const) {
    it(`${role} prompt: file exists`, () => {
      const path = resolve(PROMPTS_DIR, `chat-system-${role}.md`);
      expect(existsSync(path)).toBe(true);
    });

    it(`${role} prompt: ≤ ${MAX_CHARS} chars (~4500 tokens)`, () => {
      const path = resolve(PROMPTS_DIR, `chat-system-${role}.md`);
      const body = readFileSync(path, 'utf8');
      expect(body.length).toBeLessThanOrEqual(MAX_CHARS);
    });

    it(`${role} prompt: ≥ 500 chars (non-trivial content)`, () => {
      const path = resolve(PROMPTS_DIR, `chat-system-${role}.md`);
      const body = readFileSync(path, 'utf8');
      expect(body.length).toBeGreaterThanOrEqual(500);
    });
  }
});
