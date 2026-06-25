/**
 * Prompt-side regression — no module emits "prefer mermaid" or
 * "chart_type:'mermaid'" guidance to the model. Mermaid is dead;
 * d3 + ECharts (via /api/cdn/lib/*) is the canonical primitive set.
 */

import { describe, it, expect, vi } from 'vitest';
import { FORMATTING_CAPABILITIES } from '../capabilities.js';
import { FormattingCapabilitiesService } from '../FormattingCapabilitiesService.js';

function makeLogger() {
  const noop = vi.fn();
  const logger: any = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
  };
  logger.child = () => logger;
  return logger;
}

describe('formatting/capabilities.ts — no mermaid guidance', () => {
  it('diagram-reactflow usage rules do NOT tell the model to "PREFER compose_visual chart_type:mermaid"', () => {
    const cap = FORMATTING_CAPABILITIES.find((c) => c.id === 'diagram-reactflow');
    expect(cap).toBeDefined();
    const allText = [
      ...(cap?.usageRules ?? []),
      ...(cap?.antiPatterns ?? []),
    ].join(' ');
    expect(allText).not.toMatch(/chart_type.*mermaid/i);
    // Tight match: "prefer mermaid" / "prefer Mermaid v11" — NOT "prefer X
    // ... mermaid is removed" (which is the new anti-pattern note).
    expect(allText.toLowerCase()).not.toMatch(/\bprefer\s+mermaid\b/i);
    expect(allText.toLowerCase()).not.toMatch(/\bmermaid\s+is\s+(the\s+)?primary\b/i);
    // The schema is `template`, not `chart_type`.
    expect(allText).not.toMatch(/chart_type:/i);
  });

  it('NO capability tells the model "prefer Mermaid for simple diagrams"', () => {
    for (const cap of FORMATTING_CAPABILITIES) {
      const allText = [
        cap.description ?? '',
        cap.example ?? '',
        ...(cap.usageRules ?? []),
        ...(cap.antiPatterns ?? []),
      ].join(' ');
      expect(allText.toLowerCase()).not.toMatch(/\bprefer\s+mermaid\b/i);
    }
  });
});

describe('FormattingCapabilitiesService — model-facing guidance', () => {
  it('built guidance does NOT contain "chart_type:mermaid" anywhere', () => {
    const svc = new FormattingCapabilitiesService(makeLogger());
    const guidance = svc.generateSystemPromptSection();
    expect(guidance).not.toMatch(/chart_type.*mermaid/i);
    expect(guidance).not.toMatch(/chart_type:/i);
  });

  it('built guidance points at compose_visual + compose_app meta-tools (not raw code-fences for diagrams)', () => {
    const svc = new FormattingCapabilitiesService(makeLogger());
    const guidance = svc.generateSystemPromptSection();
    expect(guidance).toMatch(/compose_visual/);
    expect(guidance).toMatch(/compose_app/);
  });
});
