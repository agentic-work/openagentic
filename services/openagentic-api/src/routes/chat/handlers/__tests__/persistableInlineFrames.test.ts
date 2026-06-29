/**
 * RED → GREEN test for the persistable-inline-frame catalogue.
 *
 * Sev-0 2026-05-08: rendered objects (ToolCards, sub-agent cards, mermaid,
 * artifact_render, tool_shortlist) vanished on session reload because the
 * pre-fix predicate only captured 5 of the ~15 render-bearing frames.
 *
 * This test pins every render frame the UI depends on so a future emit
 * site rename or removal trips a test, not a silent UX regression.
 */
import { describe, it, expect } from 'vitest';
import {
  PERSISTABLE_INLINE_FRAMES,
  isPersistableInlineFrame,
} from '../persistableInlineFrames.js';

describe('PERSISTABLE_INLINE_FRAMES — Sev-0 session-reload regression cage', () => {
  it.each([
    // compose_visual / compose_app
    'visual_render',
    'app_render',
    'streaming_table',
    // ToolCard fan-out — THE most common rendered object
    'tool_executing',
    'tool_result',
    // Artifact (mermaid / html / code)
    'artifact_render',
    // Sub-agent card variants (both spellings)
    'inline_widget',
    'sub_agent_started',
    'sub_agent_completed',
    'subagent_started',
    'subagent_completed',
    'subagent_tool_call',
    'subagent_reasoning',
    // Tool shortlist chip
    'tool_shortlist',
    // HITL approval cards
    'hitl_approval',
    'mcp_approval_required',
    // F1-6 (2026-05-17) — end-of-turn follow-up chip row. Re-added after
    // the 2026-05-12 rip because all 17 northstar mocks render a
    // `.followups` row in this slot; without persistence the chip row
    // vanishes on session reload despite being live-streamed correctly.
    'follow_up',
    // E1 (2026-05-12) — closes the remaining reload-loses-X gaps
    'findings_emit',
    'artifact_emit',
  ])('persists "%s" — render-bearing, must survive reload', (frame) => {
    expect(isPersistableInlineFrame(frame)).toBe(true);
    expect(PERSISTABLE_INLINE_FRAMES.has(frame)).toBe(true);
  });

  it.each([
    // Stream metadata — no render, must NOT bloat the row
    'assistant_message_delta',
    'assistant_message_stop',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'intent_classified', // not visible UI; the resulting tool_shortlist is
    'usage',
    'message_received',
    'message_saved',
    'thinking_delta',
    'error',
  ])('does NOT persist "%s" — non-render frame, would bloat row', (frame) => {
    expect(isPersistableInlineFrame(frame)).toBe(false);
  });

});
