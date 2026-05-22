/**
 * 3-Sev-0 Bug #1 — "shit prints twice" during live streaming.
 *
 * Root cause:
 *   `MessageBubble.tsx` mounts BOTH `<AgenticActivityStream>` (always-on,
 *   line ~1220) AND `<StreamEnginedActivityStream>` (line ~1287) whenever
 *   `isStreaming && isStreamEngineEnabled()` is true.
 *
 *   - The StreamEngine builds its own thinking / text / tool DOM in a
 *     stable container (`data-cm-stream-engine="true"`).
 *   - AgenticActivityStream receives `streamingContentBlocks` (the
 *     in-flight reducer state) and ALSO renders thinking / text / tool
 *     blocks via React.
 *
 *   Result: the user sees each thinking block twice (once from the engine,
 *   once from AAS) and each prose chunk twice during a live stream.
 *
 *   Live reproduction on `chat-dev.openagentic.io` (image `0.7.1-f65b94e4`):
 *     DOM contains both `.cm-thinking.inline-thinking-natural` AND
 *     `.cm-thinking-block.inline-thinking-block` for the SAME assistant
 *     turn while streaming. Screenshot:
 *       reports/verify-cadence/3sev0-f65b94e4-2026-05-18/raw-repro/01-double-thinking-RED.png
 *
 * Fix contract (REFINED 2026-05-18 PM after user reported compose tools broke):
 *   The engine ONLY correctly paints simple block types (`thinking`, `text`,
 *   `tool_use`, `tool_round`, `follow_up`). It does NOT receive the
 *   theme-token map at construction (StreamEnginedActivityStream never
 *   passes `themeTokens` to the StreamEngine constructor), so iframe
 *   srcdoc resolves `var(--cm-*)` to defaults — compose_app + compose_visual
 *   iframes render blank/dark. It also has no React parity for
 *   `streaming_table` (TanStack table), `ChartBridge` (ECharts), `ReactFlow`,
 *   `MermaidRenderer`.
 *
 *   So the fix is NOT a blanket zero-out. It is a TYPE FILTER:
 *   - Engine-rendered types → filtered OUT of AAS contentBlocks during
 *     stream (no dup paint).
 *   - React-required artifact types (`viz_render`, `app_render`) → KEPT in
 *     AAS contentBlocks so React renders them with full theme-token +
 *     ChartBridge fidelity.
 *
 *   This test is a source-content test (the established convention for
 *   MessageBubble — see MessageBubble.cm-msg-asst.test.tsx). It greps the
 *   file for the type-filter wired around the `contentBlocks` prop.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'MessageBubble.tsx');

describe('MessageBubble — engine/AAS dual-render guard (3-Sev-0 #1)', () => {
  it('imports isStreamEngineEnabled so the dual-render guard can read the flag', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/isStreamEngineEnabled/);
  });

  it('passes filtered contentBlocks to AAS when engine is the live painter — keeps artifact types, drops engine-painted types', () => {
    // Pre-fix: AAS received raw streamingContentBlocks → painted thinking
    // twice (engine + AAS) → "shit prints twice".
    //
    // First broad-zero attempt (commit ebb6abbc): passed [] → killed
    // compose_app/compose_visual which the engine CAN'T render with parity
    // (no themeTokens passed at construction, no ECharts bridge).
    //
    // Refined fix: filter by block.type. Engine-rendered types
    // (thinking, text, tool_use, tool_round, follow_up) are dropped from
    // AAS; artifact types (viz_render, app_render) are KEPT so React
    // renders them. The filter must mention isStreamEngineEnabled (the
    // gate) AND the artifact type names.
    const src = readFileSync(SRC, 'utf8');

    const aasIdx = src.indexOf('<AgenticActivityStream');
    expect(aasIdx).toBeGreaterThan(-1);
    const aasBlock = src.slice(aasIdx, aasIdx + 6000);

    // The contentBlocks expression must mention isStreamEngineEnabled
    // (gate active during stream-engine live phase).
    expect(aasBlock).toMatch(/contentBlocks=\{[\s\S]{0,3000}?isStreamEngineEnabled/);
    // AND must explicitly keep the artifact types — viz_render + app_render
    // (the types that REQUIRE React to render with full theme/chart fidelity).
    expect(aasBlock).toMatch(/viz_render/);
    expect(aasBlock).toMatch(/app_render/);
  });

  it('still mounts the StreamEngine wrapper when engine flag is ON and streaming', () => {
    // Regression guard — keep the engine mount.
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/<StreamEnginedActivityStream[\s\S]{0,400}?messageId=\{message\.id\}[\s\S]{0,400}?isStreaming=\{isStreaming\}/);
  });
});
