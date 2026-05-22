/**
 * Architecture gate (V3 Phase 8): ConversationCompactionWorker /
 * ContextManagementService is wired into both pre-loop and mid-loop.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §4.4
 *
 * Pre-loop: runChat must consult getContextUsage() with a 65% soft threshold.
 * Mid-loop: chatLoop must consult getContextUsage() with an 85% hard threshold
 *           after tool_results are pushed.
 *
 * Pure source-regression — reads files from disk so the gate works even when
 * Prisma client / tsc cannot compile. Mirrors the composer-audience-contract
 * test pattern.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const apiSrc = resolve(__dirname, '../..');

describe('arch: V3 compaction triggers wired (Phase 8)', () => {
  it('runChat imports the contextManagementService singleton', () => {
    const src = readFileSync(`${apiSrc}/routes/chat/pipeline/chat/runChat.ts`, 'utf8');
    expect(src).toContain('contextManagementService');
  });

  it('runChat fires compactContext at the pre-loop with a 65% threshold', () => {
    const src = readFileSync(`${apiSrc}/routes/chat/pipeline/chat/runChat.ts`, 'utf8');
    expect(src).toMatch(/usagePercentage\s*>=\s*65/);
    expect(src).toContain('compactContext');
  });

  it('chatLoop fires compactContext mid-loop with an 85% hard threshold', () => {
    const src = readFileSync(`${apiSrc}/routes/chat/pipeline/chat/chatLoop.ts`, 'utf8');
    expect(src).toMatch(/usagePercentage\s*>=\s*85/);
    expect(src).toContain('compactContext');
  });

  it('ChatLoopDeps surface accepts an optional contextMgmt injection point', () => {
    const src = readFileSync(`${apiSrc}/routes/chat/pipeline/chat/types.ts`, 'utf8');
    expect(src).toContain('contextMgmt');
  });
});
