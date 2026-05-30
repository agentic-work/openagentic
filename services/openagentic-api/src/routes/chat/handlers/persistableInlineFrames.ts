/**
 * Persistable inline-frame catalogue (Sev-0 2026-05-08).
 *
 * NDJSON frames the V2 chat pipeline emits during a turn that carry
 * RENDERED CONTENT the UI must replay on session reload. Without persisting
 * these, every ToolCard / sub-agent card / mermaid / sankey / iframe widget
 * vanishes when the user switches sessions and comes back — leaving only
 * the assistant prose. The DB column `chat_messages.visualizations` is the
 * sink; ChatMessages.tsx + useChatStream replay them through the same
 * reducer that handles live frames.
 *
 * Pure constants + predicate. Unit-tested in __tests__/persistableInlineFrames.test.ts.
 *
 * Design tension: keeping this set TIGHT prevents bloating the row JSON
 * with throw-away frames (intent_classified fires every turn, no render).
 * But missing a render-bearing frame here = it vanishes on reload, which is
 * the entire bug we're fixing. When in doubt, ADD it — JSON column has no
 * meaningful size cap for typical chat turns.
 */

export const PERSISTABLE_INLINE_FRAMES = Object.freeze(
  new Set<string>([
    // ── compose_visual / compose_app primitives (already worked) ──────
    'visual_render', // ECharts / SVG / sankey
    'app_render', // sandboxed iframe srcdoc (T3 compose_app)
    'streaming_table', // cost / metric tables

    // ── ToolCard fan-out (THE most common rendered object) ───────────
    // V2 emits these on every tool invocation; without persistence the
    // little Input/Result cards vanish on reload.
    'tool_executing',
    'tool_result',

    // ── Artifact render (mermaid / html / code / svg) ────────────────
    'artifact_render',

    // ── Sub-agent cards (mock 10 — fan-out interleaved with prose) ───
    // Both spellings exist in the codebase. Persist all of them so we
    // don't depend on which emitter wins on a given path.
    'inline_widget',
    'sub_agent_started',
    'sub_agent_complete', // legacy spelling — pre-existing
    'sub_agent_completed', // canonical spelling
    'subagent_started',
    'subagent_completed',
    'subagent_tool_call',
    'subagent_reasoning',

    // ── Tool shortlist chip (intent → tool subset) ───────────────────
    // Fires once per turn; the chip stays visible above the assistant
    // bubble after the turn ends, so it must survive reload.
    'tool_shortlist',

    // ── HITL approval cards emitted at approval-ask ───────────────────
    //
    // Q1-fix-8 (2026-05-12): PermissionService now emits only the
    // canonical `hitl_approval` frame. The legacy `mcp_approval_required`
    // entry stays here ONLY so OLD persisted rows (pre-fix) still
    // hydrate gracefully — no new turn produces it.
    'hitl_approval',
    'mcp_approval_required',

    // ── End-of-turn follow-up chip row (Sev-0 F1-6, 2026-05-17) ───────
    // Every assistant turn ends with a `follow_up` frame carrying 0..5
    // chip strings (mocks ship 3). All 17 northstar mocks render a
    // `.followups` row immediately after the final synthesis; without
    // persistence the chip row vanishes on session reload despite being
    // live-streamed correctly.
    'follow_up',

    // ── E1 (2026-05-12) ─────────────────────────────────────────────
    // Final batch closing reload-loses-everything. Without these the
    // Findings card, synth lifecycle strip, and download tiles all
    // vanish on session reload despite being live-streamed correctly.
    //
    // findings_emit — severity-tagged audit/review artifacts emitted
    //   by the security-analysis sub-agent (mocks 03, 07, 08, 09).
    // artifact_emit — synth-executor / RenderArtifactTool emit when a
    //   file is written to UserStorageService. Renders as <DownloadTile>.
    // synth_* — the 8-frame synth lifecycle that drives <SynthCard>
    //   (planned → code_chunk → approval_requested → approved/denied →
    //   executing → stdout → completed). All 8 must persist; orphans
    //   in the persisted blob would render a stuck "planned" card.
    'findings_emit',
    'artifact_emit',
    'synth_planned',
    'synth_code_chunk',
    'synth_approval_requested',
    'synth_approved',
    'synth_denied',
    'synth_executing',
    'synth_stdout',
    'synth_completed',
  ]),
);

export function isPersistableInlineFrame(frameType: string): boolean {
  return PERSISTABLE_INLINE_FRAMES.has(frameType);
}
