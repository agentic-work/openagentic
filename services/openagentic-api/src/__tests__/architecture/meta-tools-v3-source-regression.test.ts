/**
 * Phase 9 — meta-tools source-regression (TDD architecture).
 *
 * Pins the wirings introduced in Phase 9 so a future refactor can't
 * silently rip them out:
 *   - dispatchTool.ts handles `memory_search`, `read_large_result`
 *   - runChat.ts imports the memory service for turn-start injection
 *   - getAllBaseTools() (the T1 catalog) registers `read_large_result`
 *     (memory_search now discoverable via tool_search,
 *     not part of the always-on T1 catalog)
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §10
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const apiSrc = resolve(__dirname, '../..');

describe('arch: meta-tools wired (Phase 9)', () => {
  it('dispatchTool.ts handles memory_search', () => {
    const src = readFileSync(`${apiSrc}/routes/chat/pipeline/chat/dispatchTool.ts`, 'utf8');
    expect(src).toContain('memory_search');
  });

  it('dispatchTool.ts handles read_large_result', () => {
    const src = readFileSync(`${apiSrc}/routes/chat/pipeline/chat/dispatchTool.ts`, 'utf8');
    expect(src).toContain('read_large_result');
  });

  it('runChat.ts imports memory service for injection', () => {
    const src = readFileSync(`${apiSrc}/routes/chat/pipeline/chat/runChat.ts`, 'utf8');
    expect(src).toMatch(/AgentMemoryService|getAgentMemoryService|recall\(/);
  });

  it('toolRegistry.getAllBaseTools registers READ_LARGE_RESULT_TOOL_DEF', () => {
    const src = readFileSync(`${apiSrc}/routes/chat/pipeline/chat/toolRegistry.ts`, 'utf8');
    expect(src).toContain('READ_LARGE_RESULT_TOOL_DEF');
  });
});
