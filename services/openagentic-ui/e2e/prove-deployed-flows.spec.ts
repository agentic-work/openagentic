/**
 * Prove Deployed Flows E2E Test
 *
 * Logs in via Azure AD, fetches ALL workflows, filters to status==='active' (deployed),
 * executes each one via SSE, fetches execution detail, and prints a detailed report
 * with per-node outputs.
 *
 * Skips empty workflows (0 nodes / no definition) to avoid wasting time.
 * Prints a final summary report even if the test times out partway through.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@openagentic.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

const EXECUTION_TIMEOUT_MS = 90_000; // 90s per workflow (local LLM is slow)

// ── Azure AD Login ──────────────────────────────────────────────────────────

async function login(page: any) {
  console.log('=== LOGIN FLOW (Azure AD) ===');
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) {
    console.log('Already logged in!');
    try { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch {}
    return;
  }

  const msButton = page.locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft")');
  if (await msButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await msButton.first().click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');

    const msEmailInput = page.locator('input[type="email"], input[name="loginfmt"]');
    if (await msEmailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await msEmailInput.fill(ADMIN_EMAIL);
      await page.locator('input[type="submit"], button:has-text("Next")').click();
      await page.waitForTimeout(2000);
    }

    const msPasswordInput = page.locator('input[type="password"], input[name="passwd"]');
    if (await msPasswordInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await msPasswordInput.fill(ADMIN_PASSWORD);
      await page.locator('input[type="submit"], button:has-text("Sign in")').click();
      await page.waitForTimeout(3000);
    }

    const staySignedIn = page.locator('button:has-text("No"), input[value="No"]');
    if (await staySignedIn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await staySignedIn.click();
      await page.waitForTimeout(2000);
    }

    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
  }

  await page.waitForSelector('textarea', { timeout: 60000 });

  // Dismiss modals
  for (let i = 0; i < 3; i++) {
    try { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch {}
    const skipBtn = page.locator('button:has-text("Skip")');
    if (await skipBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await skipBtn.click();
      await page.waitForTimeout(500);
    }
  }

  console.log('Login complete!');
}

// ── Helper: truncate to N chars ─────────────────────────────────────────────

function truncate(s: any, n: number): string {
  const str = typeof s === 'string' ? s : JSON.stringify(s) ?? '';
  return str.length > n ? str.substring(0, n) + '...' : str;
}

// ── Helper: print report ────────────────────────────────────────────────────

function printReport(results: any[], skippedEmpty: any[]) {
  console.log('\n\n');
  console.log('#'.repeat(100));
  console.log('#  DEPLOYED WORKFLOW EXECUTION REPORT');
  console.log('#'.repeat(100));

  let passCount = 0;
  let failCount = 0;

  for (const r of results) {
    const passed = r.status === 'completed';
    if (passed) passCount++; else failCount++;
    const verdict = passed ? 'PASS' : 'FAIL';
    const durStr = `${(r.durationMs / 1000).toFixed(1)}s`;

    console.log(`\n  [${verdict}] ${r.name}`);
    console.log(`         ID: ${r.id}`);
    console.log(`         Status: ${r.status} | Duration: ${durStr} | Nodes: ${r.nodeCount}`);
    console.log(`         Execution ID: ${r.executionId || 'N/A'}`);
    console.log(`         SSE Events: [${r.sseEventTypes.join(', ')}]`);
    if (r.error) {
      console.log(`         Error: ${r.error}`);
    }

    if (r.nodes.length > 0) {
      console.log(`         Node Results:`);
      for (const nr of r.nodes) {
        const nodeStatus = nr.status === 'completed' ? 'OK' : nr.status.toUpperCase();
        const dur = nr.durationMs ? `${nr.durationMs}ms` : '-';
        console.log(`           [${nodeStatus}] ${nr.nodeName} (${nr.nodeType}) ${dur}`);
        if (nr.outputPreview && nr.outputPreview !== 'null' && nr.outputPreview !== '""') {
          console.log(`                 Output: ${nr.outputPreview}`);
        }
        if (nr.error) {
          console.log(`                 Error: ${nr.error}`);
        }
      }
    } else {
      console.log(`         (no node output data retrieved)`);
    }
  }

  if (skippedEmpty.length > 0) {
    console.log(`\n  SKIPPED (empty/no definition): ${skippedEmpty.length} workflows`);
    for (const s of skippedEmpty) {
      console.log(`    - ${s.name} (${s.id})`);
    }
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log(`SUMMARY: ${results.length} executed | ${passCount} PASSED | ${failCount} FAILED | ${skippedEmpty.length} skipped (empty)`);
  console.log(`${'='.repeat(100)}`);
  if (results.length > 0) {
    console.log(`Pass rate: ${((passCount / results.length) * 100).toFixed(1)}%`);
  }
}

// ── Interfaces ──────────────────────────────────────────────────────────────

interface NodeResult {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: string;
  outputPreview: string;
  error: string | null;
  durationMs: number | null;
}

interface WorkflowResult {
  name: string;
  id: string;
  nodeCount: number;
  executionId: string | null;
  status: string;
  durationMs: number;
  error: string | null;
  nodes: NodeResult[];
  sseEventTypes: string[];
}

// ── Test ─────────────────────────────────────────────────────────────────────

test.describe('Prove Deployed Flows', () => {

  test('Execute ALL active (deployed) workflows and report per-node results', async ({ page }) => {
    test.setTimeout(1_800_000); // 30 minutes total

    await login(page);

    // ── 1. Fetch all workflows and filter to active ───────────────────────

    const { token, activeWorkflows, allCount } = await page.evaluate(async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) throw new Error('No auth_token in localStorage');

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const res = await fetch('/api/workflows', { headers });
      if (!res.ok) throw new Error(`List workflows failed: ${res.status} ${res.statusText}`);
      const data = await res.json();
      const all: any[] = data.workflows || [];

      const active = all.filter((w: any) => w.status === 'active');

      return {
        token,
        allCount: all.length,
        activeWorkflows: active.map((w: any) => ({
          id: w.id,
          name: w.name,
          nodes: (w.nodes || []).map((n: any) => ({
            id: n.id,
            label: n.data?.label || n.data?.name || n.type || n.id,
            type: n.type || 'unknown',
          })),
          nodeCount: (w.nodes || []).length,
        })),
      };
    });

    console.log(`\nTotal workflows: ${allCount}`);
    console.log(`Active (deployed) workflows: ${activeWorkflows.length}`);

    if (activeWorkflows.length === 0) {
      console.log('No active workflows found. Nothing to execute.');
      return;
    }

    // Split into executable (has nodes) and empty (skip)
    const executableWorkflows = activeWorkflows.filter((w: any) => w.nodeCount > 0);
    const skippedEmpty = activeWorkflows.filter((w: any) => w.nodeCount === 0);

    console.log(`Executable workflows (have nodes): ${executableWorkflows.length}`);
    console.log(`Skipped (empty/no nodes): ${skippedEmpty.length}`);

    for (const wf of executableWorkflows) {
      console.log(`  - ${wf.name} (${wf.id}), ${wf.nodeCount} nodes`);
    }

    // ── 2. Execute each workflow with nodes ─────────────────────────────

    const results: WorkflowResult[] = [];

    try {
      for (const wf of executableWorkflows) {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`EXECUTING [${results.length + 1}/${executableWorkflows.length}]: ${wf.name} (${wf.id})`);
        console.log(`${'='.repeat(80)}`);

        const startTime = Date.now();

        // Execute via SSE and collect events
        const sseResult = await page.evaluate(async ({
          wfId, timeout
        }: { wfId: string; timeout: number }) => {
          const token = localStorage.getItem('auth_token')!;
          const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          };

          const result = {
            executionId: null as string | null,
            sseStatus: 'unknown' as string,
            sseError: null as string | null,
            sseEventTypes: [] as string[],
          };

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          try {
            const execRes = await fetch(`/api/workflows/${wfId}/execute`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ input: { test: true, source: 'prove-deployed-flows-e2e' } }),
              signal: controller.signal,
            });

            const contentType = execRes.headers.get('content-type') || '';

            // Non-SSE error response
            if (!contentType.includes('text/event-stream') && !execRes.ok) {
              clearTimeout(timeoutId);
              try {
                const errData = await execRes.json();
                result.sseStatus = 'failed';
                result.sseError = errData.error || errData.message || `HTTP ${execRes.status}`;
              } catch {
                result.sseStatus = 'failed';
                result.sseError = `HTTP ${execRes.status}`;
              }
              return result;
            }

            const reader = execRes.body?.getReader();
            if (!reader) {
              clearTimeout(timeoutId);
              result.sseStatus = 'failed';
              result.sseError = 'No response body';
              return result;
            }

            const decoder = new TextDecoder();
            let buffer = '';
            let done = false;

            try {
              while (!done) {
                const { done: streamDone, value } = await reader.read();
                if (streamDone) { done = true; break; }

                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n');
                buffer = parts.pop() || '';

                for (const line of parts) {
                  if (line.startsWith('data: ')) {
                    try {
                      const event = JSON.parse(line.substring(6));
                      result.sseEventTypes.push(event.type || 'unknown');
                      if (event.executionId) result.executionId = event.executionId;

                      if (event.type === 'execution_complete' || event.type === 'execution_completed') {
                        result.sseStatus = 'completed';
                        done = true;
                      } else if (event.type === 'execution_error' || event.type === 'error') {
                        result.sseStatus = 'failed';
                        result.sseError = event.data?.error || event.error || 'execution error';
                        done = true;
                      }
                    } catch {}
                  }
                }
              }
            } catch (err: any) {
              if (err.name === 'AbortError') {
                result.sseStatus = 'timeout';
                result.sseError = `Timed out after ${timeout / 1000}s`;
              } else {
                result.sseStatus = 'error';
                result.sseError = err.message;
              }
            } finally {
              try { reader.cancel(); } catch {}
            }

            if (result.sseStatus === 'unknown') {
              result.sseStatus = 'stream_ended';
              result.sseError = 'Stream ended without completion event';
            }
          } catch (fetchErr: any) {
            if (fetchErr.name === 'AbortError') {
              result.sseStatus = 'timeout';
              result.sseError = `Timed out after ${timeout / 1000}s`;
            } else {
              result.sseStatus = 'error';
              result.sseError = fetchErr.message;
            }
          } finally {
            clearTimeout(timeoutId);
          }

          return result;
        }, { wfId: wf.id, timeout: EXECUTION_TIMEOUT_MS });

        const durationMs = Date.now() - startTime;

        console.log(`  SSE Status: ${sseResult.sseStatus}`);
        console.log(`  SSE Events: [${sseResult.sseEventTypes.join(', ')}]`);
        console.log(`  Execution ID: ${sseResult.executionId || 'none'}`);
        if (sseResult.sseError) console.log(`  SSE Error: ${sseResult.sseError}`);

        // ── 3. Fetch detailed execution record with node outputs ──────────

        let nodeResults: NodeResult[] = [];
        let finalStatus = sseResult.sseStatus;
        let finalError = sseResult.sseError;

        if (sseResult.executionId) {
          await page.waitForTimeout(1500);

          const detail = await page.evaluate(async ({
            wfId, execId
          }: { wfId: string; execId: string }) => {
            const token = localStorage.getItem('auth_token')!;
            const headers: Record<string, string> = {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            };

            try {
              const res = await fetch(`/api/workflows/${wfId}/executions/${execId}`, { headers });
              if (!res.ok) return { error: `HTTP ${res.status}` };
              return await res.json();
            } catch (err: any) {
              return { error: err.message };
            }
          }, { wfId: wf.id, execId: sseResult.executionId });

          if (detail.error && !detail.execution) {
            console.log(`  Detail fetch error: ${detail.error}`);
          } else if (detail.execution) {
            finalStatus = detail.execution.status || finalStatus;
            finalError = detail.execution.error || finalError;

            console.log(`  DB Status: ${detail.execution.status}`);
            console.log(`  Execution Time: ${detail.execution.execution_time_ms ?? 'N/A'}ms`);
            console.log(`  Completed Nodes: ${detail.execution.completed_nodes ?? '?'}/${detail.execution.total_nodes ?? '?'}`);

            const nodeSummary = detail.nodeSummary || {};
            const nodeOutputs = detail.execution.node_outputs || {};
            const nodeDefMap = new Map(wf.nodes.map((n: any) => [n.id, n]));
            const seenNodeIds = new Set<string>();

            for (const [nodeId, summary] of Object.entries(nodeSummary) as [string, any][]) {
              seenNodeIds.add(nodeId);
              const def = nodeDefMap.get(nodeId) as any;
              nodeResults.push({
                nodeId,
                nodeName: def?.label || nodeId,
                nodeType: def?.type || 'unknown',
                status: summary.status || 'unknown',
                outputPreview: truncate(summary.output, 200),
                error: summary.error || null,
                durationMs: summary.duration || null,
              });
            }

            for (const [nodeId, output] of Object.entries(nodeOutputs) as [string, any][]) {
              if (seenNodeIds.has(nodeId)) continue;
              const def = nodeDefMap.get(nodeId) as any;
              nodeResults.push({
                nodeId,
                nodeName: def?.label || nodeId,
                nodeType: def?.type || 'unknown',
                status: output?.status || (output?.error ? 'failed' : 'completed'),
                outputPreview: truncate(output?.output || output?.result || output, 200),
                error: output?.error || null,
                durationMs: output?.duration || output?.execution_time_ms || null,
              });
            }
          }
        }

        // Print per-node details inline
        if (nodeResults.length > 0) {
          console.log(`\n  NODE DETAILS (${nodeResults.length} nodes):`);
          for (const nr of nodeResults) {
            const dur = nr.durationMs ? `${nr.durationMs}ms` : '-';
            console.log(`    [${nr.status.toUpperCase()}] ${nr.nodeName} (${nr.nodeType}) - ${dur}`);
            if (nr.outputPreview && nr.outputPreview !== 'null' && nr.outputPreview !== '""') {
              console.log(`      Output: ${nr.outputPreview}`);
            }
            if (nr.error) {
              console.log(`      Error: ${nr.error}`);
            }
          }
        }

        results.push({
          name: wf.name,
          id: wf.id,
          nodeCount: wf.nodeCount,
          executionId: sseResult.executionId,
          status: finalStatus,
          durationMs,
          error: finalError,
          nodes: nodeResults,
          sseEventTypes: sseResult.sseEventTypes,
        });
      }
    } finally {
      // Always print report, even if test times out partway through
      printReport(results, skippedEmpty);
    }

    expect(results.length, 'Should have executed at least one workflow').toBeGreaterThan(0);
  });
});
