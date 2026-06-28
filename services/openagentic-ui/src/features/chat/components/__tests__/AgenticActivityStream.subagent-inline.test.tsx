/**
 * Sev-2 #646 Option B — sub-agent card renders inline INSIDE
 * AgenticActivityStream's timeline at the agent-block position.
 *
 * Option A (lift the strip into MessageBubble between AgenticActivityStream
 * and EnhancedMessageContent) DID NOT WORK because when the activity stream
 * has text content blocks, EnhancedMessageContent is suppressed
 * (MessageBubble.tsx:1053 guard) and the prose actually renders OUT OF the
 * AgenticActivityStream itself. So the rendered DOM ends up:
 *   AAS (tool chips + prose) → my strip → (suppressed prose)
 * which puts the strip AFTER the prose, not before it.
 *
 * Real fix: pass `subAgents` into AgenticActivityStream. When a tool/agent
 * block in the timeline has an `agentRole` matching a SubAgentEntry, render
 * the rich SubAgentCard at THAT position in the timeline. That puts the
 * card AT the Task call position (mock 01:1077-1140) — between the parent's
 * tool calls / narration and the parent's final synthesis prose.
 *
 * Source-content style (matches MessageBubble.cm-msg-asst.test.tsx pattern)
 * — runtime render is too heavy.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'AgenticActivityStream', 'AgenticActivityStream.tsx');

describe('AgenticActivityStream — sub-agent inline render (#646 Option B)', () => {
  it('imports SubAgentCard from the v2 barrel', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/import\s*\{[^}]*\bSubAgentCard\b[^}]*\}\s*from\s*['"][^'"]*\/v2['"]?/);
  });

  it('declares subAgents prop on the AgenticActivityStream component', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/subAgents\??: \s*(?:ReadonlyArray<)?SubAgentEntry/);
  });

  it('renders SubAgentCard inline when an agent block matches a SubAgentEntry by role', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/<SubAgentCard\b/);
  });

  it('looks up sub-agent entry by role at the agent block position', () => {
    const src = readFileSync(SRC, 'utf8');
    // The implementation must do a lookup keyed off block.agentRole — not
    // hardcode a single role. We verify the code path references both.
    expect(src).toMatch(/agentRole/);
    expect(src).toMatch(/subAgents/);
  });
});

describe('MessageBubble — strip render REMOVED (lifted into AAS via Option B)', () => {
  const MB_SRC = join(__dirname, '..', 'MessageBubble.tsx');

  it('no longer renders cm-subagent-strip directly (delegates to AgenticActivityStream)', () => {
    const src = readFileSync(MB_SRC, 'utf8');
    expect(src).not.toMatch(/className="cm-v2 cm-subagent-strip"/);
  });

  it('still passes subAgents down to AgenticActivityStream as a prop', () => {
    const src = readFileSync(MB_SRC, 'utf8');
    // Pass-through to AAS — the strip moved INTO AAS, MessageBubble is now
    // a forwarder.
    expect(src).toMatch(/<AgenticActivityStream[\s\S]{0,2500}?\bsubAgents=\{/);
  });
});
