/**
 * E1.5 (2026-05-12) — Bug 2: `makeExecuteMcpToolWithResolver` (and the
 * legacy non-resolver `makeExecuteMcpTool`) was JSON.stringifying every
 * non-string MCP result before returning it to the dispatcher. The
 * stringified blob then flowed into the splitter as `raw`, ended up as
 * `structuredContent.data` (a string), got embedded in the tool_result
 * wire frame, and finally rendered in the UI's JsonView with 6 layers of
 * escape sequences (`\\\\\\\"`).
 *
 * Ground truth: reports/verify-cadence/B5/d69bdb0b/after-trace-full.ndjson
 * shows `tool_result.content.data` as a literal string instead of the
 * structured object the MCP proxy actually returned.
 *
 * RED: this test expects the executor to return `output` as the parsed
 * object when the MCP proxy returned a structured body. With the current
 * stringify wrap, `output` is `"{\"ok\":true,...}"` and the assertion
 * fails.
 *
 * GREEN: drop the JSON.stringify wrap; pass the structured object
 * through verbatim. Strings are still strings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeExecuteMcpToolWithResolver } from '../buildChatV2Deps.js';

describe('E1.5 — makeExecuteMcpTool preserves structured MCP result shape (no JSON.stringify wrap)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns structured object output verbatim when the MCP proxy returned an object', async () => {
    const proxyBody = {
      result: {
        ok: true,
        totalCost: 42.0,
        services: ['EC2', 'S3'],
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => proxyBody,
    });
    (global as any).fetch = fetchSpy;

    const exec = makeExecuteMcpToolWithResolver(async () => ['aws_cost_by_service']);
    const r = await exec({ user: {} }, 'aws_cost_by_service', { days: 30 });

    expect(r.ok).toBe(true);
    // Output must be the structured object, NOT a JSON-stringified string.
    expect(r.output).toEqual({
      ok: true,
      totalCost: 42.0,
      services: ['EC2', 'S3'],
    });
    expect(typeof r.output).toBe('object');
    // The exact failure mode the live UI showed — escape soup — comes
    // from this `typeof === 'string'` being true. Lock it down.
    expect(typeof r.output).not.toBe('string');
  });

  it('still passes string output through unchanged (no double-wrap, no parse)', async () => {
    const proxyBody = { result: 'plain text reply from mcp tool' };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => proxyBody,
    });
    (global as any).fetch = fetchSpy;

    const exec = makeExecuteMcpToolWithResolver(async () => ['some_tool']);
    const r = await exec({ user: {} }, 'some_tool', {});

    expect(r.ok).toBe(true);
    expect(r.output).toBe('plain text reply from mcp tool');
    expect(typeof r.output).toBe('string');
  });

  it('returns structured array output verbatim', async () => {
    const proxyBody = {
      result: [
        { id: 'sub-1', name: 'Production' },
        { id: 'sub-2', name: 'Dev' },
      ],
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => proxyBody,
    });
    (global as any).fetch = fetchSpy;

    const exec = makeExecuteMcpToolWithResolver(async () => ['azure_list_subscriptions']);
    const r = await exec({ user: {} }, 'azure_list_subscriptions', {});

    expect(r.ok).toBe(true);
    expect(Array.isArray(r.output)).toBe(true);
    expect(r.output).toEqual([
      { id: 'sub-1', name: 'Production' },
      { id: 'sub-2', name: 'Dev' },
    ]);
  });

  it('handles double-nested {result:{result:...}} envelope (existing behavior preserved)', async () => {
    const proxyBody = { result: { result: { unwrapped: true } } };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => proxyBody,
    });
    (global as any).fetch = fetchSpy;

    const exec = makeExecuteMcpToolWithResolver(async () => ['x']);
    const r = await exec({ user: {} }, 'x', {});

    expect(r.ok).toBe(true);
    expect(r.output).toEqual({ unwrapped: true });
  });
});
