/**
 * Sev-0 #842 — Q-loop verification needs stable DOM testids on AAS.
 *
 * Q1 redrive (2026-05-14 PM6) on 0.7.1-fb8f6495 returned a false-positive
 * "interleave fail" because the DOM probe looked for
 * `[data-testid="agentic-activity-stream"]` and `[data-testid*="tool-card"]`
 * — neither of which existed in AAS source. The AAS was actually rendering
 * fine (3 streaming-tables proved tool dispatch + result widgets worked).
 *
 * Fix: add stable testids so the Q-loop verification harness has reliable
 * mount-detection. Add to:
 *   1. AAS root container — `data-testid="agentic-activity-stream"` +
 *      `data-streaming` reflecting `isStreaming` prop.
 *   2. Per-tool-card div in the interleaved grouper path —
 *      `data-testid="tool-card"` + `data-tool-name` + `data-status`.
 *
 * These testids are render-only — no behavior change. The previous
 * `data-streaming` on the InlineThinkingBlock root (per #834 fix) is
 * unchanged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'AgenticActivityStream', 'AgenticActivityStream.tsx');

describe('Sev-0 #842 — AAS testid stability for Q-loop verification', () => {
  const src = readFileSync(SRC, 'utf8');

  it('AAS root div has data-testid="agentic-activity-stream"', () => {
    expect(src).toMatch(/data-testid="agentic-activity-stream"/);
  });

  it('AAS root div reflects isStreaming via data-streaming attr', () => {
    // Reflecting isStreaming as a data attribute lets the Q-loop probe assert
    // streaming-vs-completed state without invoking React internals.
    expect(src).toMatch(/data-streaming=\{isStreaming \? 'true' : 'false'\}/);
  });

  it('interleaved tool-card div has data-testid="tool-card"', () => {
    // The grouper output (the chronological-interleave path #814) tags each
    // tool block with a tool-card testid so Q-loop probes can count tool
    // mounts and confirm tool surface persistence post-stream.
    expect(src).toMatch(/data-testid="tool-card"/);
  });

  it('tool-card carries the resolved tool name + status', () => {
    // The probe needs to assert WHICH tool ran + final status (running/
    // success/error) without re-traversing the activity-step className.
    expect(src).toMatch(/data-testid="tool-card"\s+data-tool-name=\{toolName\}\s+data-status=\{status\}/);
  });
});
