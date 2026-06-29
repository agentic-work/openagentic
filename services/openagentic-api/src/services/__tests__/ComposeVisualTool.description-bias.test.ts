/**
 * #575 — compose_visual description must NOT bias gpt-oss toward
 * visualization on plain "show me X" list asks.
 *
 * Live evidence (2026-04-30): the description fed to the LLM as part of the
 * tool array said "PRIMARY way to show, not tell" + listed bare "show" first
 * in the trigger keyword block + told the model to "RENDER WITH SENSIBLE
 * DEFAULTS … last 6 months for cost". For prompts like "show me cost", "show
 * me my deployments", or even "show me my subs" the model can match the
 * literal token "show" against this description and call compose_visual
 * instead of the right MCP list tool.
 *
 * Fix: drop the bias-creating phrases. Visual templates should fire on
 * EXPLICIT visual verbs (render, plot, visualize, draw a chart, make a
 * diagram, sankey, etc.) — not on bare "show".
 */
import { describe, test, expect } from 'vitest';
import { COMPOSE_VISUAL_TOOL } from '../ComposeVisualTool.js';

describe('compose_visual description — #575 no bias toward visualization on plain list asks', () => {
  const description = COMPOSE_VISUAL_TOOL.function.description;

  test('description does not advertise itself as the "PRIMARY way to show"', () => {
    // The phrase "PRIMARY way to show, not tell" trains the model to call
    // compose_visual on every "show me X" prompt. Drop it.
    expect(description.toLowerCase()).not.toContain('primary way to show');
  });

  test('does NOT contain bare "show" as a stand-alone trigger keyword', () => {
    // The original trigger list "show, render, draw, plot, chart, graph,
    // visualize, illustrate, diagram, dashboard, sankey, flowchart, table,
    // KPI summary." matches plain "show me my subs". The trigger list must
    // require explicit visual verbs.
    //
    // Detect the smell by scanning for a comma-delimited keyword block that
    // *starts* with bare "show".
    const triggerBlockMatch = description.match(
      /(USE THIS TOOL when[^.]*?asks?\s+to[\s:]+)([^.]+)/i,
    );
    if (triggerBlockMatch) {
      const triggerBlock = triggerBlockMatch[2].toLowerCase();
      // Reject standalone "show" at the start of the keyword run.
      expect(
        /^\s*show\s*[,)]/.test(triggerBlock) || /\bshow\s*,/.test(triggerBlock),
        `compose_visual trigger keyword block still lists bare "show": "${triggerBlock.slice(0, 120)}"`,
      ).toBe(false);
    }
  });

  test('does NOT instruct "RENDER WITH SENSIBLE DEFAULTS" for cost', () => {
    // The original workflow note told the model to render a cost chart with
    // last-6-months defaults whenever the ask was vaguely cloud-related.
    // That biased compose_visual toward firing on "show me azure" prompts.
    expect(description).not.toMatch(/RENDER\s+WITH\s+SENSIBLE\s+DEFAULTS/i);
    expect(description.toLowerCase()).not.toContain('last 6 months for cost');
  });

  test('still names the compose_visual templates so the model can pick one', () => {
    // The template list is a documentation surface — keep it. We only
    // changed the trigger framing, not the template enumeration.
    expect(description).toMatch(/sankey/i);
    expect(description).toMatch(/bar_chart/i);
    expect(description).toMatch(/line_chart/i);
    expect(description).toMatch(/arch_diagram/i);
    expect(description).toMatch(/table/i);
    expect(description).toMatch(/kpi_grid/i);
  });

  test('still has a "USE THIS TOOL when" framing — but with explicit visual verbs', () => {
    // Soft-fail signal: there should still be guidance for when to fire,
    // just keyed off explicit visual verbs (render/plot/visualize/draw/
    // make a chart) not bare "show". At least 3 of those must appear.
    const explicitVerbs = ['render', 'plot', 'visualize', 'draw', 'chart', 'diagram'];
    const hits = explicitVerbs.filter((v) => new RegExp(`\\b${v}`, 'i').test(description));
    expect(
      hits.length,
      `compose_visual description must still mention explicit visual verbs (got ${hits.length}/${explicitVerbs.length})`,
    ).toBeGreaterThanOrEqual(3);
  });

  test('description length is still substantial (>200 chars) — we softened, not gutted', () => {
    expect(description.length).toBeGreaterThan(200);
  });
});
