/**
 * WebSearchTool — RED test for the T1 meta-tool definition shape.
 *
 * the chat-pipeline refactor plan §Phase C task C.9: web_search promoted from MCP-only
 * to a T1 always-on primitive. Description steers the model to use it
 * when local-context tools won't answer (general public knowledge,
 * current-events, citations).
 */
import { describe, it, expect } from 'vitest';
import { WEB_SEARCH_TOOL, isWebSearchTool } from '../WebSearchTool.js';

describe('WEB_SEARCH_TOOL definition (the chat-pipeline refactor Phase C.9)', () => {
  it('declares function-shape with name="web_search"', () => {
    expect(WEB_SEARCH_TOOL.type).toBe('function');
    expect(WEB_SEARCH_TOOL.function.name).toBe('web_search');
  });

  it('description distinguishes from tool_search (catalog) and kb_search (internal)', () => {
    const d = WEB_SEARCH_TOOL.function.description;
    expect(typeof d).toBe('string');
    // Must signal "the public internet", not platform tool catalog.
    expect(d).toMatch(/public|internet|web|external/i);
    // Must distinguish from tool_search.
    expect(d).toMatch(/tool_search/);
  });

  it('input_schema requires query string', () => {
    const params = WEB_SEARCH_TOOL.function.parameters;
    expect(params.type).toBe('object');
    expect(params.required).toEqual(['query']);
    expect(params.properties.query.type).toBe('string');
    expect(params.additionalProperties).toBe(false);
  });

  it('isWebSearchTool name guard returns true for "web_search" only', () => {
    expect(isWebSearchTool('web_search')).toBe(true);
    expect(isWebSearchTool('tool_search')).toBe(false);
    expect(isWebSearchTool('agent_search')).toBe(false);
    expect(isWebSearchTool('web_fetch')).toBe(false);
  });
});
