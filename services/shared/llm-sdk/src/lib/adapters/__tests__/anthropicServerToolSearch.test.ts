/**
 * A1 — Anthropic native server tool search (`tool_search_tool_bm25_20251119`
 * / `tool_search_tool_regex_20251119`).
 *
 * Anthropic-only feature (Anthropic direct API; Bedrock/Vertex parity is
 * rolling out as of mid-2026). When the canonical request opts in via
 * `enable_server_tool_search: 'bm25' | 'regex'`:
 *
 *   1. The adapter PREPENDS the server tool entry into `body.tools[0]`,
 *      shaped as `{ type: 'tool_search_tool_bm25_20251119', name: '…' }`.
 *   2. Regular tools tagged `defer_loading: true` carry that flag on the
 *      wire so Anthropic keeps them out of the system prompt prefix.
 *   3. F1 cache_control still applies — marker on the LAST tool entry
 *      (caches server tool + all deferred defs in the prefix).
 *
 * Token reduction: ~85% on heavy MCP catalogs (per Anthropic blog +
 * vendor docs). MCP eval lift: Opus 4 went 49% → 74% with tool search.
 *
 * Non-Anthropic adapters ignore both `enable_server_tool_search` and
 * per-tool `defer_loading`. Existing adapters.shape.test.ts pins that
 * AIF/OpenAI/Ollama/Vertex-Gemini drop foreign markers; we don't re-pin.
 *
 * Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
 */

import { describe, it, expect } from 'vitest';
import { OpenagenticToAnthropic } from '../OpenagenticToAnthropic.js';
import type { CanonicalRequest } from '../../canonical/types.js';

const T1_TOOLS: CanonicalRequest['tools'] = [
  // Built-in T1 — caller leaves defer_loading unset (always loaded)
  { name: 'tool_search', description: 'Discover relevant tools.', input_schema: { type: 'object' } },
  { name: 'Task', description: 'Spawn a sub-agent.', input_schema: { type: 'object' } },
];

const MCP_TOOLS: CanonicalRequest['tools'] = [
  // MCP tools — caller sets defer_loading: true
  { name: 'azure_list_subscriptions', description: 'List Azure subs.', input_schema: { type: 'object' }, defer_loading: true },
  { name: 'azure_list_resource_groups', description: 'List Azure RGs.', input_schema: { type: 'object' }, defer_loading: true },
  { name: 'aws_list_accounts', description: 'List AWS accounts.', input_schema: { type: 'object' }, defer_loading: true },
];

function baseRequest(extra: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'list azure subs' }] }],
    system: null,
    tools: [...T1_TOOLS, ...MCP_TOOLS],
    tool_choice: { type: 'auto' },
    max_tokens: 1024,
    ...extra,
  };
}

describe('A1 — Anthropic server tool search adapter branch', () => {
  it('prepends tool_search_tool_bm25_20251119 when enable_server_tool_search="bm25"', () => {
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(baseRequest({ enable_server_tool_search: 'bm25' }));

    expect(body.tools).toBeDefined();
    // Total: 1 server tool + 2 T1 + 3 MCP = 6 entries
    expect(body.tools).toHaveLength(6);
    // First entry is the server tool
    expect((body.tools![0] as any).type).toBe('tool_search_tool_bm25_20251119');
    expect((body.tools![0] as any).name).toBe('tool_search_tool_bm25');
  });

  it('prepends the regex variant when enable_server_tool_search="regex"', () => {
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(baseRequest({ enable_server_tool_search: 'regex' }));

    expect((body.tools![0] as any).type).toBe('tool_search_tool_regex_20251119');
    expect((body.tools![0] as any).name).toBe('tool_search_tool_regex');
  });

  it('passes defer_loading:true through to wire body on deferred tools', () => {
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(baseRequest({ enable_server_tool_search: 'bm25' }));

    // Locate by name
    const tool_search = body.tools!.find((t) => (t as any).name === 'tool_search');
    const azureSubs = body.tools!.find((t) => (t as any).name === 'azure_list_subscriptions');
    const awsAccts = body.tools!.find((t) => (t as any).name === 'aws_list_accounts');

    // T1 tool — NOT deferred
    expect((tool_search as any).defer_loading).toBeUndefined();
    // MCP tools — deferred
    expect((azureSubs as any).defer_loading).toBe(true);
    expect((awsAccts as any).defer_loading).toBe(true);
  });

  it('F1 cache_control still marks the LAST tool (with server-tool-search enabled)', () => {
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(baseRequest({ enable_server_tool_search: 'bm25' }));
    const last = body.tools![body.tools!.length - 1];
    expect((last as any).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('does NOT prepend server tool when enable_server_tool_search is unset', () => {
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(baseRequest());
    expect(body.tools).toHaveLength(5); // 2 T1 + 3 MCP
    expect(JSON.stringify(body).includes('tool_search_tool_')).toBe(false);
  });

  it('still passes defer_loading on tools even when server tool search is unset (forward-compat)', () => {
    // If caller marks tools deferred but doesn't enable the server tool,
    // the flag still rides through — Anthropic might use it for caching
    // optimization independently. No behavior change in our adapter:
    // pass-through.
    const adapter = new OpenagenticToAnthropic();
    const body = adapter.adaptRequest(baseRequest());
    const azureSubs = body.tools!.find((t) => (t as any).name === 'azure_list_subscriptions');
    expect((azureSubs as any).defer_loading).toBe(true);
  });
});
