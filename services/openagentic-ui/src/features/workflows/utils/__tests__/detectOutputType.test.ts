/**
 * detectOutputType — covers the 53 node types we render in the canvas
 * and the heuristics for rendering their outputs n8n/Langflow style
 * (HTML iframe, markdown, json tree, table, image, text).
 *
 * Drives the "Rendered" toggle in ExecutionResultsPanel so completed
 * nodes display their *actual* output instead of a JSON tree dump.
 */

import { describe, it, expect } from 'vitest';
import {
  detectOutputType,
  extractRenderable,
} from '../detectOutputType';

describe('detectOutputType', () => {
  describe('html — iframe-rendered', () => {
    it('routes webhook_response with body starting with <html', () => {
      const out = { statusCode: 200, body: '<html><body>Hi</body></html>', delivered: true };
      expect(detectOutputType('webhook_response', out)).toBe('html');
    });

    it('routes webhook_response with body starting with <!DOCTYPE', () => {
      const out = { statusCode: 200, body: '<!DOCTYPE html><html>x</html>' };
      expect(detectOutputType('webhook_response', out)).toBe('html');
    });

    it('routes webhook_response with body starting with <div', () => {
      // K8s Pod Health template emits a <div class="pod-health-report"> body
      const out = { statusCode: 200, body: '<div class="pod-health-report"><h2>K8s</h2></div>' };
      expect(detectOutputType('webhook_response', out)).toBe('html');
    });

    it('routes envelope { format: "html" } regardless of node type', () => {
      const out = { format: 'html', content: '<p>x</p>', title: 'r' };
      expect(detectOutputType('transform', out)).toBe('html');
    });

    it('does NOT route webhook_response body that is plain JSON to html', () => {
      const out = { statusCode: 200, body: { ok: true } };
      expect(detectOutputType('webhook_response', out)).toBe('json');
    });

    it('does NOT route HTML-looking string under 20 chars to html (too short to be a report)', () => {
      // Short snippets are likely chunks, not full HTML reports —
      // fall through to JSON tree so the user sees the surrounding shape
      const out = { body: '<a>x' };
      expect(detectOutputType('webhook_response', out)).toBe('json');
    });
  });

  describe('markdown — markdown renderer', () => {
    it('routes LLM content with # headers', () => {
      const out = { content: '# Heading\n\nbody' };
      expect(detectOutputType('llm_completion', out)).toBe('markdown');
    });

    it('routes LLM content with ## subheaders', () => {
      const out = { content: 'intro\n\n## section\n\nbody' };
      expect(detectOutputType('openagentic_llm', out)).toBe('markdown');
    });

    it('routes LLM content with **bold** markers', () => {
      const out = { content: 'something **bold** here' };
      expect(detectOutputType('agent_single', out)).toBe('markdown');
    });

    it('routes envelope { format: "markdown" }', () => {
      const out = { format: 'markdown', content: 'hi', title: 'r' };
      expect(detectOutputType('http_request', out)).toBe('markdown');
    });

    it('routes raw string starting with #', () => {
      expect(detectOutputType('llm_completion', '# greeting\n\nbody')).toBe('markdown');
    });

    it('does NOT route LLM content without markdown markers to markdown', () => {
      const out = { content: 'plain prose response without any markdown.' };
      expect(detectOutputType('llm_completion', out)).toBe('text');
    });
  });

  describe('image', () => {
    it('routes data URL images', () => {
      const out = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
      expect(detectOutputType('mcp_tool', out)).toBe('image');
    });

    it('routes .url ending in .png', () => {
      const out = { url: 'https://example.com/foo.png' };
      expect(detectOutputType('http_request', out)).toBe('image');
    });

    it('routes content-type image/*', () => {
      const out = { headers: { 'content-type': 'image/jpeg' }, body: 'binary' };
      expect(detectOutputType('http_request', out)).toBe('image');
    });
  });

  describe('table', () => {
    it('routes array of objects with consistent keys (≥2 rows, ≥2 cols)', () => {
      const out = [
        { name: 'a', pod: 'p1', status: 'Running' },
        { name: 'b', pod: 'p2', status: 'Pending' },
        { name: 'c', pod: 'p3', status: 'Running' },
      ];
      expect(detectOutputType('mcp_tool', out)).toBe('table');
    });

    it('routes wrapped data: rows: [...] shape', () => {
      const out = { rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }] };
      expect(detectOutputType('mcp_tool', out)).toBe('table');
    });

    it('does NOT route single-row arrays to table', () => {
      const out = [{ a: 1, b: 2 }];
      expect(detectOutputType('mcp_tool', out)).toBe('json');
    });

    it('does NOT route arrays of primitives to table', () => {
      const out = [1, 2, 3, 4];
      expect(detectOutputType('transform', out)).toBe('json');
    });
  });

  describe('text', () => {
    it('routes plain string', () => {
      expect(detectOutputType('code', 'just plain text output')).toBe('text');
    });

    it('routes { stdout: "..." } from code nodes', () => {
      const out = { stdout: 'hello world\n', exitCode: 0 };
      expect(detectOutputType('code', out)).toBe('text');
    });

    it('routes empty string as text', () => {
      expect(detectOutputType('http_request', '')).toBe('text');
    });
  });

  describe('json — default fallback', () => {
    it('routes structured object without markers', () => {
      const out = { a: 1, nested: { b: 2 } };
      expect(detectOutputType('transform', out)).toBe('json');
    });

    it('routes null as json (renderer shows "no output")', () => {
      expect(detectOutputType('transform', null)).toBe('json');
    });
  });

  describe('coverage — all 53 known node types resolve to a defined type', () => {
    const nodeTypes = [
      'trigger', 'mcp_tool', 'llm_completion', 'code', 'condition', 'switch',
      'loop', 'transform', 'merge', 'parallel', 'http_request',
      'webhook_response', 'approval', 'human_approval', 'wait', 'agent_spawn',
      'a2a', 'synth', 'openagentic', 'openagentic_llm', 'multi_agent', 'text',
      'reasoning', 'structured_output', 'rag_query', 'data_source_query',
      'file_upload', 'text_splitter', 'embedding', 'vector_store',
      'document_loader', 'sub_workflow', 'error_handler', 'user_context',
      'guardrails', 'slack_message', 'teams_message', 'discord_message',
      'send_email', 'outlook_email', 'pagerduty_incident', 'servicenow_ticket',
      'jira_issue', 'agent_single', 'agent_pool', 'agent_supervisor',
      'default', 'llm', 'webhook', 'api', 'input', 'output', 'start',
    ];
    for (const t of nodeTypes) {
      it(`${t}: returns a non-empty type for {a:1}`, () => {
        const r = detectOutputType(t, { a: 1 });
        expect(['html', 'markdown', 'json', 'table', 'image', 'text']).toContain(r);
      });
    }
  });
});

describe('extractRenderable', () => {
  it('pulls .body for webhook_response html', () => {
    const out = { statusCode: 200, body: '<div>hi</div>', delivered: true };
    expect(extractRenderable('webhook_response', out, 'html')).toBe('<div>hi</div>');
  });

  it('pulls envelope.content for {format:"html"}', () => {
    const out = { format: 'html', content: '<p>x</p>', title: 'r' };
    expect(extractRenderable('transform', out, 'html')).toBe('<p>x</p>');
  });

  it('pulls .content for LLM markdown', () => {
    const out = { content: '# title' };
    expect(extractRenderable('llm_completion', out, 'markdown')).toBe('# title');
  });

  it('returns raw string for plain markdown', () => {
    expect(extractRenderable('llm_completion', '# x', 'markdown')).toBe('# x');
  });
});
