/**
 * WebFetchTool — RED test for the T1 meta-tool definition shape.
 *
 * the chat-pipeline refactor plan §Phase C task C.10: web_fetch is the companion to
 * web_search — it pulls a single URL into context (so the model can
 * read a referenced page rather than re-search). Promoted from MCP-only
 * to T1 always-on.
 */
import { describe, it, expect } from 'vitest';
import { WEB_FETCH_TOOL, isWebFetchTool } from '../WebFetchTool.js';

describe('WEB_FETCH_TOOL definition (the chat-pipeline refactor Phase C.10)', () => {
  it('declares function-shape with name="web_fetch"', () => {
    expect(WEB_FETCH_TOOL.type).toBe('function');
    expect(WEB_FETCH_TOOL.function.name).toBe('web_fetch');
  });

  it('description signals "URL into context" + companion to web_search', () => {
    const d = WEB_FETCH_TOOL.function.description;
    expect(typeof d).toBe('string');
    expect(d).toMatch(/url/i);
    expect(d).toMatch(/web_search/);
  });

  it('input_schema requires url string', () => {
    const params = WEB_FETCH_TOOL.function.parameters;
    expect(params.type).toBe('object');
    expect(params.required).toEqual(['url']);
    expect(params.properties.url.type).toBe('string');
    expect(params.additionalProperties).toBe(false);
  });

  it('isWebFetchTool name guard returns true for "web_fetch" only', () => {
    expect(isWebFetchTool('web_fetch')).toBe(true);
    expect(isWebFetchTool('web_search')).toBe(false);
    expect(isWebFetchTool('tool_search')).toBe(false);
  });
});
