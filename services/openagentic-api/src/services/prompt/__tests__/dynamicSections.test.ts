/**
 * Dynamic-section function pack — recomputed per turn from request-scope
 * inputs. Mirrors ~/anthropic/src/constants/prompts.ts §dynamic sections.
 *
 * getToolCatalogSection wraps the tool array the chatLoop is about to send
 * to the provider in a <tool-catalog> block listing every tool by name +
 * first-sentence description. Anchors the model on what's available even if
 * it ignores the API `tools` array.
 */
import { describe, it, expect } from 'vitest';
import { getToolCatalogSection } from '../dynamicSections.js';

describe('dynamicSections — getToolCatalogSection', () => {
  it('wraps tool names + first-sentence descriptions in <tool-catalog> tags', () => {
    const tools = [
      { function: { name: 'tool_search', description: 'Search the live MCP tool catalog.\nMore info here.' } },
      { function: { name: 'azure_list_subscriptions', description: 'List Azure subscriptions for the OBO-authenticated user. Multi-tenant.' } },
    ];
    const out = getToolCatalogSection(tools);
    expect(out).toContain('<tool-catalog>');
    expect(out).toContain('</tool-catalog>');
    expect(out).toContain('`tool_search` — Search the live MCP tool catalog');
    expect(out).toContain('`azure_list_subscriptions` — List Azure subscriptions for the OBO-authenticated user');
  });

  it('returns empty string when no tools are loaded', () => {
    expect(getToolCatalogSection([])).toBe('');
  });

  it('tolerates tools missing function/description (provider-shape drift)', () => {
    const tools = [
      { function: { name: 'has_desc', description: 'Real one.' } },
      { function: { name: 'no_desc' } } as any,
      { name: 'top_level_name', description: 'Anthropic shape.' } as any,
      null as any,
      undefined as any,
    ];
    const out = getToolCatalogSection(tools);
    expect(out).toContain('has_desc');
    expect(out).toContain('no_desc'); // listed even without description
    expect(out).toContain('top_level_name'); // Anthropic-shape fallback
    expect(out).not.toContain('null');
  });

  it('caps at 100 tools to bound prompt size — overflow rolls into a count', () => {
    const tools = Array.from({ length: 130 }, (_, i) => ({
      function: { name: `t${i}`, description: `Tool ${i}` },
    }));
    const out = getToolCatalogSection(tools);
    expect(out).toContain('`t0`');
    expect(out).toContain('`t99`');
    expect(out).not.toContain('`t100`');
    expect(out).toMatch(/30 more tools available via `tool_search`/);
  });

  it('first sentence is split on . / ! / ? / newline, not mid-word', () => {
    const tools = [{ function: { name: 'x', description: 'First sentence. Second sentence.' } }];
    expect(getToolCatalogSection(tools)).toContain('`x` — First sentence');
    expect(getToolCatalogSection(tools)).not.toContain('Second sentence');
  });
});
