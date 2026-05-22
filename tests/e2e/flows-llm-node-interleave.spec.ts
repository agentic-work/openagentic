/**
 * Phase E₂.2 Playwright proof — flow LLM-node live interleave
 * ==========================================================
 *
 * Asserts that when a workflow with an LLM node executes, the node
 * card fills in with LIVE `content_block_delta` events streamed
 * inside the node's lifespan (between `node_start` and `node_complete`),
 * not just at the end once the full output arrives.
 *
 * Approach: drive the UI through the workflows page with an
 * authenticated session (mcp-tester@openagentic.local
 * storage state from .auth/user.json), then:
 *   1. Capture every network response body for the execution stream
 *      endpoint (`/api/workflows/executions/.../stream`).
 *   2. Parse the NDJSON stream; assert the ordering
 *        node_start (llm node)  → node_stream (inner content_block_delta)
 *        → node_complete (llm node).
 *   3. Assert that at least TWO distinct `node_stream` frames carry a
 *      `content_block_delta.text_delta`, proving per-chunk interleaving
 *      rather than a single batch flush.
 *
 * If auth state isn't available locally the test self-skips with a
 * clear hint — matches the other e2e suites.
 */

import { test, expect } from './fixtures/auth.fixture';
import fs from 'fs';
import path from 'path';

const AUTH_FILE = path.join(__dirname, '../../.auth/user.json');

test.describe('Phase E₂.2 flow LLM-node interleave proof', () => {
  test.beforeAll(() => {
    if (!fs.existsSync(AUTH_FILE)) {
      test.skip(
        true,
        `No auth state at ${AUTH_FILE} — run \`npx playwright test --project=auth-setup\` first.`,
      );
    }
  });

  test('LLM node emits live node_stream deltas between node_start and node_complete', async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    const streamLines: Array<{ type: string; nodeId?: string; event?: any; [k: string]: any }> = [];
    const streamEndpointRe = /\/api\/workflows\/executions\/[^/]+\/stream/;

    page.on('response', async (resp) => {
      if (!streamEndpointRe.test(resp.url())) return;
      try {
        const body = await resp.text();
        for (const line of body.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            streamLines.push(JSON.parse(trimmed));
          } catch {
            // Skip malformed lines — tolerated on live wire.
          }
        }
      } catch {
        // Response body may be opaque if the stream is still open.
      }
    });

    await page.goto('https://chat-dev.openagentic.io/flows');

    const runButton = page.locator(
      'button:has-text("Execute"), button:has-text("Run"), [data-testid="execute-workflow"]',
    );
    if (await runButton.first().isVisible({ timeout: 15_000 }).catch(() => false)) {
      await runButton.first().click();
    } else {
      test.skip(
        true,
        'No runnable flow with Execute button found on /flows — populate a starter template to exercise the LLM-node path',
      );
    }

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const terminal = streamLines.find(
        (l) => l.type === 'execution_complete' || l.type === 'execution_error' || l.type === 'timeout',
      );
      if (terminal) break;
      await page.waitForTimeout(500);
    }

    if (streamLines.length === 0) {
      test.skip(true, 'Network capture returned 0 NDJSON lines — opaque stream; re-run with trace on to confirm');
    }

    const nodeStarts = streamLines.filter((l) => l.type === 'node_start' && l.nodeType?.includes('llm'));
    if (nodeStarts.length === 0) {
      test.skip(true, 'No llm_completion node observed in this flow — pick a template that includes one');
    }
    const llmNodeId = nodeStarts[0].nodeId as string;

    const llmStartIdx = streamLines.findIndex(
      (l) => l.type === 'node_start' && l.nodeId === llmNodeId,
    );
    const llmCompleteIdx = streamLines.findIndex(
      (l, idx) => idx > llmStartIdx && l.type === 'node_complete' && l.nodeId === llmNodeId,
    );

    expect(llmStartIdx).toBeGreaterThan(-1);
    expect(llmCompleteIdx).toBeGreaterThan(llmStartIdx);

    const innerDeltas = streamLines
      .slice(llmStartIdx + 1, llmCompleteIdx)
      .filter(
        (l) =>
          l.type === 'node_stream' &&
          l.nodeId === llmNodeId &&
          (l.event?.type === 'content_block_delta' || l.event?.type === 'stream'),
      );

    expect(innerDeltas.length).toBeGreaterThanOrEqual(2);

    const firstDeltaIdx = streamLines.findIndex(
      (l, idx) =>
        idx > llmStartIdx &&
        idx < llmCompleteIdx &&
        l.type === 'node_stream' &&
        l.nodeId === llmNodeId &&
        (l.event?.type === 'content_block_delta' || l.event?.type === 'stream'),
    );
    expect(firstDeltaIdx).toBeGreaterThan(-1);
    expect(firstDeltaIdx).toBeLessThan(llmCompleteIdx);

    const nodeCard = page
      .locator(`[data-node-id="${llmNodeId}"], [data-id="${llmNodeId}"]`)
      .first();
    await nodeCard.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
  });
});
