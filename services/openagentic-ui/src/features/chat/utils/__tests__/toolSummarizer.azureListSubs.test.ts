/**
 * Live capture 2026-05-12 on chat-dev (post-SEV-0 OBO fix in 8f2ffe56):
 *
 *   List Subscriptions
 *   0 subscriptions          ← chip badge
 *
 *   2 Azure subscriptions visible:   ← model body text
 *     Azure subscription 1  6ed638e7-...
 *     openagentic-dev       815a115d-...
 *
 * Root cause: `toolSummarizer.ts:252-256` calls
 *   `countArray(unwrapResult(r), ['subscriptions', 'value']) ?? 0`
 * If `unwrapResult` returns a shape where `.subscriptions` isn't a literal
 * array (e.g. wrapped/serialized differently after the api-side envelope
 * splitter), `countArray` returns null → `?? 0` → "0 subscriptions" even
 * when the tool actually returned 2.
 *
 * Fix: add a `count`/`total` field fallback for the SoT MCP shape
 * `{success, count, subscriptions: [...], executed_as}` that the
 * `oap-azure-mcp` server emits. The shipping tool always carries `count =
 * len(subscriptions)`. When `countArray` can't find the array (envelope
 * quirk), trust `count`.
 */
import { describe, it, expect } from 'vitest';
import { summarizeToolCall } from '../toolSummarizer';

describe('azure_list_subscriptions summarizer — 2026-05-12 live capture', () => {
  it('returns "2 subscriptions" for the real MCP wire shape', () => {
    // The real oap-azure-mcp/server.py:1391 shape:
    const result = {
      success: true,
      count: 2,
      subscriptions: [
        { id: '6ed638e7-7deb-4773-b516-a2a2b9dbb948', name: 'Azure subscription 1', state: 'Enabled' },
        { id: '815a115d-bf32-495c-a89f-b5ce6b349b57', name: 'openagentic-dev', state: 'Enabled' },
      ],
      executed_as: { upn: 'mcp-tester@openagentic.local' },
    };
    const summary = summarizeToolCall('azure_list_subscriptions', {}, result);
    expect(summary?.text).toMatch(/2 subscriptions/);
    expect(summary?.text).not.toMatch(/0 subscriptions/);
  });

  it('returns "2 subscriptions" when envelope wraps {content:[{text: <json>}]}', () => {
    // MCP-protocol envelope: structuredContent often wrapped as content array.
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: 2,
            subscriptions: [
              { id: 'a', name: 'sub-a', state: 'Enabled' },
              { id: 'b', name: 'sub-b', state: 'Enabled' },
            ],
          }),
        },
      ],
    };
    const summary = summarizeToolCall('azure_list_subscriptions', {}, result);
    expect(summary?.text).toMatch(/2 subscriptions/);
  });

  it('falls back to count field when array is missing but count is present', () => {
    // Defensive: if some downstream shape drops the array but keeps count,
    // the chip should still reflect reality from the count field.
    const result = { success: true, count: 5 };
    const summary = summarizeToolCall('azure_list_subscriptions', {}, result);
    expect(summary?.text).toMatch(/5 subscriptions/);
  });

  it('returns "0 subscriptions" only when truly empty', () => {
    const result = { success: true, count: 0, subscriptions: [] };
    const summary = summarizeToolCall('azure_list_subscriptions', {}, result);
    expect(summary?.text).toMatch(/0 subscriptions/);
  });

  it('handles singular: 1 subscription (no s)', () => {
    const result = { success: true, count: 1, subscriptions: [{ id: 'a' }] };
    const summary = summarizeToolCall('azure_list_subscriptions', {}, result);
    expect(summary?.text).toMatch(/1 subscription\b/);
  });
});
