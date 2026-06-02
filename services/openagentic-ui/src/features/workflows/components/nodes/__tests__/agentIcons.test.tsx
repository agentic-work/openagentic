/**
 * agentIcons — Flows > Agents per-agent SVG identity.
 *
 * The admin SOT agent registry (admin.agents → /api/agents) stamps each agent
 * with an icon-KEY (== agent_type) + a distinct color. The Flows palette and
 * canvas nodes resolve that key to a UNIQUE, function-evocative SVG via
 * AGENT_TYPE_ICONS — so no two seeded agents share a glyph or a color, and
 * unknown/custom agents fall back deterministically (never one generic icon
 * for all). This test pins both invariants.
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AGENT_TYPE_ICONS,
  AGENT_TYPE_COLORS,
  getAgentTypeIcon,
  getAgentTypeColor,
} from '../nodeIcons';

// The 12 platform agents seeded by POST /api/admin/agents/seed.
const SEEDED_AGENT_TYPES = [
  'reasoning',
  'data_query',
  'tool_orchestration',
  'summarization',
  'code_execution',
  'planning',
  'validation',
  'synthesis',
  'artifact_creation',
  'oat_function_builder',
  'cloud_operations',
  'custom',
];

describe('Flows agent icons — per-agent SVG identity', () => {
  it('every seeded agent_type has a dedicated icon in the registry map', () => {
    for (const t of SEEDED_AGENT_TYPES) {
      expect(AGENT_TYPE_ICONS[t], `missing icon for "${t}"`).toBeTypeOf('function');
      expect(AGENT_TYPE_COLORS[t], `missing color for "${t}"`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('renders a DISTINCT SVG markup for each seeded agent type', () => {
    const markups = SEEDED_AGENT_TYPES.map((t) =>
      renderToStaticMarkup(getAgentTypeIcon(t)),
    );
    // No two agent glyphs should be byte-identical.
    const unique = new Set(markups);
    expect(unique.size).toBe(SEEDED_AGENT_TYPES.length);
    // Each is a real <svg>, not an emoji/text fallback.
    for (const m of markups) expect(m).toContain('<svg');
  });

  it('assigns a DISTINCT color to each seeded agent type', () => {
    const colors = SEEDED_AGENT_TYPES.map((t) => getAgentTypeColor(t));
    expect(new Set(colors).size).toBe(SEEDED_AGENT_TYPES.length);
  });

  it('unknown agent type falls back to the custom puzzle glyph (deterministic, not blank)', () => {
    const unknown = renderToStaticMarkup(getAgentTypeIcon('totally_made_up_role'));
    const custom = renderToStaticMarkup(getAgentTypeIcon('custom'));
    expect(unknown).toContain('<svg');
    expect(unknown).toBe(custom);
    expect(getAgentTypeColor('totally_made_up_role')).toBe(AGENT_TYPE_COLORS.custom);
  });

  it('the two newest agent types (oat_function_builder, cloud_operations) are unique vs all others', () => {
    const oat = renderToStaticMarkup(getAgentTypeIcon('oat_function_builder'));
    const cloud = renderToStaticMarkup(getAgentTypeIcon('cloud_operations'));
    const custom = renderToStaticMarkup(getAgentTypeIcon('custom'));
    expect(oat).not.toBe(cloud);
    expect(oat).not.toBe(custom);
    expect(cloud).not.toBe(custom);
  });
});
