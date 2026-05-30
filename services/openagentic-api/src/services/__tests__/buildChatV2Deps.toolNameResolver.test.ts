/**
 * Integration test — Claude Code's tool-name resolution wired into
 * `makeExecuteMcpTool`. Mirrors the live failure mode captured 2026-04-30:
 * gpt-oss:20b emits `aws.run`, the MCP proxy returns "tool not found",
 * the sub-agent loops with the same hallucinated name 5×, exits empty.
 *
 * After wiring resolveMcpToolName into the executor:
 *   - `aws.run` → resolver normalizes to `aws_run` → still no match →
 *     return ok:false with "Did you mean: aws_iam_list_users, ..."
 *   - `aws_iam_list_users` (exact) → pass through, posted to proxy
 *   - `aws.iam.list.users` (dotted) → normalize → match → posted
 *
 * The resolver runs BEFORE the proxy POST so we don't burn a network
 * round-trip for every hallucinated name.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeExecuteMcpToolWithResolver } from '../buildChatV2Deps.js';

const REGISTERED = [
  'aws_iam_list_users',
  'aws_iam_list_groups',
  'aws_list_subscriptions',
  'azure_list_resource_groups',
  'k8s_list_pods',
];

describe('makeExecuteMcpToolWithResolver — Claude Code tool-name resolver wired into executeMcpTool', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a hallucinated name with structured "did you mean" suggestions BEFORE hitting the proxy', async () => {
    const fetchSpy = vi.fn();
    (global as any).fetch = fetchSpy;
    const exec = makeExecuteMcpToolWithResolver(async () => REGISTERED);
    const r = await exec({ user: {} }, 'aws.run', {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('aws.run');
    expect(r.error).toContain('not found');
    expect(r.error).toContain('aws_iam_list_users');
    // The proxy should NOT have been called for a hallucinated name.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('normalizes dotted forms to canonical and posts to the proxy', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { data: 'ok' } }),
    });
    (global as any).fetch = fetchSpy;
    const exec = makeExecuteMcpToolWithResolver(async () => REGISTERED);
    const r = await exec({ user: {} }, 'aws.iam.list.users', {});
    expect(r.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    // Sent to the proxy under the canonical name, not the dotted form.
    expect(body.tool).toBe('aws_iam_list_users');
  });

  it('passes exact-match names through unchanged', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { rows: [] } }),
    });
    (global as any).fetch = fetchSpy;
    const exec = makeExecuteMcpToolWithResolver(async () => REGISTERED);
    const r = await exec({ user: {} }, 'azure_list_resource_groups', {});
    expect(r.ok).toBe(true);
    const body = JSON.parse((fetchSpy.mock.calls[0] as any)[1].body);
    expect(body.tool).toBe('azure_list_resource_groups');
  });

  it('falls through with the input as-is when the registered list is unavailable', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'ok' }),
    });
    (global as any).fetch = fetchSpy;
    // listMcpProxyTools throws (e.g. proxy briefly unreachable for /tools).
    const exec = makeExecuteMcpToolWithResolver(async () => {
      throw new Error('proxy /tools 503');
    });
    const r = await exec({ user: {} }, 'aws_iam_list_users', {});
    // The resolver fail-soft: when it can't load the index, send the
    // raw name to the proxy. The proxy may still resolve it.
    expect(r.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
