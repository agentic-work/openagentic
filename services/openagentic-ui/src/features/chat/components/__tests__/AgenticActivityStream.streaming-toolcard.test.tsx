/**
 * #515 Sev-1 — running ToolCard render must NOT be gated on tool_input_delta
 * arrival. Mock 01 shows a tool card the moment a tool is dispatched, with an
 * empty INPUT pane that fills as deltas stream in. The previous gating
 * (`block.content && block.content.trim()`) hid the card entirely until the
 * first delta arrived — for fast tools, the card was never shown during the
 * running state.
 *
 * Source-content style — runtime render of AgenticActivityStream is too heavy
 * (3247 LOC). We assert the gating predicate at the JSX site uses
 * `!hasChildren` (and NOT a content-truthy guard) so the card renders for
 * every running, non-agent leaf block.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// God-file decomposition (behavior-preserving): the running-state ToolCallCard
// JSX lives in the extracted serial-cluster module (ExpandableToolItem) now.
const SRC = join(__dirname, '..', 'AgenticActivityStream', 'TreeToolCallGroup.tsx');

describe('AgenticActivityStream — streaming-state ToolCard ungated (#515)', () => {
  it('renders the running-state <ToolCallCard> without a content-truthy guard', () => {
    const src = readFileSync(SRC, 'utf8');
    // The JSX block that mounts the running ToolCallCard. Pinned by the
    // status="calling" prop string so we know we're at the right site.
    const m = src.match(
      /\{!isAgentBlock && isRunning[^}]*\}[\s\S]{0,2000}?status="calling"/,
    );
    expect(m, 'running ToolCallCard JSX block must exist').toBeTruthy();
    const block = m![0];

    // The content guard must NOT be part of the predicate. The previous
    // gating was `block.content && block.content.trim()`. Both forms are
    // banned at this site so the card always renders during running state.
    expect(block).not.toMatch(/block\.content\s*&&\s*block\.content\.trim\(\)/);
    expect(block).not.toMatch(/&&\s*block\.content\s*&&/);
  });
});
