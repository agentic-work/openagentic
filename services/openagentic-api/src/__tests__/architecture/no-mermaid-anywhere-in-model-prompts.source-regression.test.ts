/**
 * Arch regression — Mermaid is dead. d3 + ECharts + ReactFlow (admin docs only)
 * are the canonical diagram primitives.
 *
 * Rule (the user, repeated): "we removed mermaid in favor of d3 — like the
 * graphs in the admin console". Despite that:
 *
 *   - `RENDER_ARTIFACT_KINDS` no longer contains `'mermaid'` (arch-test enforced)
 *   - `COMPOSE_VISUAL_TEMPLATES` no longer contains `'mermaid'` (arch-test enforced)
 *   - Production prompts in `FormattingCapabilitiesService` say "Mermaid is
 *     deprecated — emit reactflow JSON or svg"
 *
 * BUT contradictory prose still lingers in:
 *
 *   1. `formatting/capabilities.ts:227-238` says "PREFER compose_visual
 *      chart_type:'mermaid'" — `chart_type` doesn't exist in the schema
 *      (it's `template`), and `mermaid` is not in the template enum.
 *   2. `formatting/validators.ts:65-69` claims mermaid is "the PRIMARY diagram
 *      primitive via compose_visual chart_type:'mermaid'".
 *   3. `system-mcps/index.ts:127` says "DO prefer Mermaid for simple diagrams"
 *      inside the dead `ARTIFACT_GUIDANCE_PROMPT` constant.
 *   4. `RenderArtifactTool.ts:63-67, 166-167` tells models to use
 *      `compose_visual chart_type:"mermaid"`.
 *   5. `composeAppTemplates/_shared.ts:39` exposes a `mermaid:` CDN_LIB
 *      entry — dead code, zero callers.
 *
 * Every one of these is a lie to the model: the schema rejects them, the
 * renderer never sees them, and the user has stated 3+ times that mermaid is
 * gone. This test pins that the model-facing surfaces ALL say "use the d3
 * primitives" not "use mermaid".
 */

import { describe, it, expect } from 'vitest';
import { COMPOSE_VISUAL_TOOL, COMPOSE_VISUAL_TEMPLATES } from '../../services/ComposeVisualTool.js';
import { COMPOSE_APP_TOOL } from '../../services/ComposeAppTool.js';
import { RENDER_ARTIFACT_TOOL, RENDER_ARTIFACT_KINDS } from '../../services/RenderArtifactTool.js';

describe('no mermaid in any model-facing tool description', () => {
  it('compose_visual description does not say "chart_type:mermaid"', () => {
    const d = COMPOSE_VISUAL_TOOL.function.description;
    // `chart_type` is not even a field — it's `template`. And mermaid is not
    // in the template enum.
    expect(d).not.toMatch(/chart_type\s*[:=]\s*["']?mermaid/i);
  });

  it('compose_visual description does not say "use mermaid" or "prefer mermaid"', () => {
    const d = COMPOSE_VISUAL_TOOL.function.description.toLowerCase();
    expect(d).not.toMatch(/use mermaid|prefer mermaid|primary.*mermaid|mermaid.*primary/i);
  });

  it('compose_visual template enum does not contain mermaid', () => {
    expect(COMPOSE_VISUAL_TEMPLATES as readonly string[]).not.toContain('mermaid');
  });

  it('compose_app description does not name mermaid as a preferred path', () => {
    const d = COMPOSE_APP_TOOL.function.description.toLowerCase();
    // OK to mention `mermaid.min.js` if it's in CDN_LIB (back-compat), but
    // NOT OK to tell the model to "use mermaid" or list it as a primitive.
    expect(d).not.toMatch(/use mermaid|prefer mermaid|mermaid is.*primary/i);
  });

  it('render_artifact description does not say "use compose_visual chart_type:mermaid"', () => {
    const d = RENDER_ARTIFACT_TOOL.function.description;
    expect(d).not.toMatch(/chart_type\s*[:=]\s*["']?mermaid/i);
    expect(d).not.toMatch(/compose_visual.*mermaid/i);
  });

  it('render_artifact kind enum does not contain mermaid', () => {
    expect(RENDER_ARTIFACT_KINDS as readonly string[]).not.toContain('mermaid');
  });
});

describe('canonical diagram primitives are surfaced correctly', () => {
  it('compose_visual description names "arch_diagram" template', () => {
    const d = COMPOSE_VISUAL_TOOL.function.description;
    expect(d).toMatch(/arch_diagram/);
  });

  it('compose_visual description mentions the d3 / ECharts primitives the renderer actually supports', () => {
    const d = COMPOSE_VISUAL_TOOL.function.description.toLowerCase();
    // At least these template slugs must be named — they are the model's
    // actual options.
    for (const slug of ['sankey', 'bar_chart', 'line_chart', 'kpi_grid', 'arch_diagram']) {
      expect(d.toLowerCase()).toContain(slug);
    }
  });
});
