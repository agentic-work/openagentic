/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Execute All Ready Workflows E2E Test
 *
 * Lists all workflows, validates each one, executes those that are ready,
 * and reports results with node output details.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentics.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@phatoldsungmail.onmicrosoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

const MAX_READY_WORKFLOWS = 999; // No cap - test ALL workflows
const EXECUTION_TIMEOUT_MS = 120000; // 120s per execution
const SKIP_NAMES = ['Untitled Workflow', 'E2E Execution Test'];

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

  for (let i = 0; i < 3; i++) {
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } catch {}
    const skipBtn = page.locator('button:has-text("Skip")');
    if (await skipBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await skipBtn.click();
      await page.waitForTimeout(500);
    }
  }

  console.log('Login complete!');
}

interface WorkflowResult {
  name: string;
  id: string;
  nodeCount: number;
  validationReady: boolean;
  validationErrors: string[];
  executed: boolean;
  executionId: string | null;
  status: string;
  nodeOutputsCount: number;
  allNodesHaveOutput: boolean;
  error: string | null;
  durationMs: number | null;
}

test.describe('Execute All Ready Workflows', () => {

  test('Validate and execute all ready workflows', async ({ page }) => {
    test.setTimeout(2700000); // 45 minutes for all 45 workflows

    await login(page);

    // Step 1: Get auth token and list workflows
    const { token, workflows } = await page.evaluate(async ({ skipNames }: { skipNames: string[] }) => {
      const token = localStorage.getItem('auth_token');
      if (!token) throw new Error('No auth_token in localStorage');

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const listRes = await fetch('/api/workflows', { headers });
      if (!listRes.ok) throw new Error(`List workflows failed: ${listRes.status}`);
      const listData = await listRes.json();
      const all: any[] = listData.workflows || [];
      const filtered = all.filter((w: any) => !skipNames.includes(w.name));

      return {
        token,
        workflows: filtered.map((w: any) => ({
          id: w.id,
          name: w.name,
          nodeCount: (w.nodes || []).length,
        })),
      };
    }, { skipNames: SKIP_NAMES });

    console.log(`Found ${workflows.length} candidate workflows (after filtering)`);

    // Step 2: Validate each workflow
    const validations = await page.evaluate(async ({ workflows, authToken }: { workflows: any[]; authToken: string }) => {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      };

      const results: Array<{ id: string; ready: boolean; errors: string[] }> = [];

      for (const wf of workflows) {
        try {
          const res = await fetch(`/api/workflows/${wf.id}/validate`, { method: 'POST', headers });
          if (!res.ok) {
            results.push({ id: wf.id, ready: false, errors: [`HTTP ${res.status}`] });
            continue;
          }
          const data = await res.json();
          const errors: string[] = [];
          if (data.compilation?.errors?.length) {
            errors.push(...data.compilation.errors.map((e: any) => e.message || e.code));
          }
          if (data.runtime?.issues?.length) {
            errors.push(...data.runtime.issues.map((i: any) => i.message || i.code));
          }
          results.push({ id: wf.id, ready: data.ready === true, errors });
        } catch (err: any) {
          results.push({ id: wf.id, ready: false, errors: [err.message] });
        }
      }
      return results;
    }, { workflows, authToken: token });

    const validationMap = new Map(validations.map(v => [v.id, v]));

    const readyWorkflows = workflows.filter(w => validationMap.get(w.id)?.ready).slice(0, MAX_READY_WORKFLOWS);
    const notReadyWorkflows = workflows.filter(w => !validationMap.get(w.id)?.ready);

    console.log(`${readyWorkflows.length} READY, ${notReadyWorkflows.length} NOT READY`);

    const results: WorkflowResult[] = [];

    // Add not-ready workflows
    for (const wf of notReadyWorkflows) {
      const val = validationMap.get(wf.id)!;
      results.push({
        name: wf.name,
        id: wf.id,
        nodeCount: wf.nodeCount,
        validationReady: false,
        validationErrors: val.errors,
        executed: false,
        executionId: null,
        status: 'skipped',
        nodeOutputsCount: 0,
        allNodesHaveOutput: false,
        error: val.errors.join('; ') || null,
        durationMs: null,
      });
    }

    // Step 3: Execute each ready workflow one at a time
    for (const wf of readyWorkflows) {
      console.log(`\nExecuting: ${wf.name} (${wf.id})...`);
      const startTime = Date.now();

      const execResult = await page.evaluate(async ({
        wfId, authToken, timeout
      }: { wfId: string; authToken: string; timeout: number }) => {
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        };

        const result = {
          executionId: null as string | null,
          status: 'unknown',
          error: null as string | null,
          sseEvents: [] as string[],
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const execRes = await fetch(`/api/workflows/${wfId}/execute`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ input: { test: true, message: 'test input' } }),
            signal: controller.signal,
          });

          // Check for non-SSE error response
          const contentType = execRes.headers.get('content-type') || '';
          if (!contentType.includes('text/event-stream') && !execRes.ok) {
            clearTimeout(timeoutId);
            try {
              const errData = await execRes.json();
              result.status = 'failed';
              result.error = errData.error || errData.message || `HTTP ${execRes.status}`;
            } catch {
              result.status = 'failed';
              result.error = `HTTP ${execRes.status}`;
            }
            return result;
          }

          // Read SSE stream
          const reader = execRes.body?.getReader();
          if (!reader) {
            clearTimeout(timeoutId);
            result.status = 'failed';
            result.error = 'No response body';
            return result;
          }

          const decoder = new TextDecoder();
          let buffer = '';
          let done = false;

          try {
            while (!done) {
              const { done: streamDone, value } = await reader.read();
              if (streamDone) {
                done = true;
                break;
              }

              buffer += decoder.decode(value, { stream: true });

              // Parse events line by line
              const parts = buffer.split('\n');
              buffer = parts.pop() || '';

              for (const line of parts) {
                if (line.startsWith('data: ')) {
                  try {
                    const event = JSON.parse(line.substring(6));
                    result.sseEvents.push(event.type || 'unknown');
                    if (event.executionId) result.executionId = event.executionId;

                    if (event.type === 'execution_complete' || event.type === 'execution_completed') {
                      result.status = 'completed';
                      done = true;
                    } else if (event.type === 'execution_error' || event.type === 'error') {
                      result.status = 'failed';
                      result.error = event.data?.error || event.error || 'execution error';
                      done = true;
                    } else if (event.type === 'execution_started') {
                      // already captured executionId above
                    }
                  } catch {}
                }
              }
            }
          } catch (readErr: any) {
            if (readErr.name === 'AbortError') {
              result.status = 'timeout';
              result.error = `Timed out after ${timeout / 1000}s`;
            } else {
              result.status = 'error';
              result.error = readErr.message;
            }
          } finally {
            try { reader.cancel(); } catch {}
          }

          // If stream ended without explicit completion event
          if (result.status === 'unknown') {
            result.status = 'stream_ended';
            result.error = 'Stream ended without execution_complete event';
          }

        } catch (fetchErr: any) {
          if (fetchErr.name === 'AbortError') {
            result.status = 'timeout';
            result.error = `Timed out after ${timeout / 1000}s`;
          } else {
            result.status = 'error';
            result.error = fetchErr.message;
          }
        } finally {
          clearTimeout(timeoutId);
        }

        return result;
      }, { wfId: wf.id, authToken: token, timeout: EXECUTION_TIMEOUT_MS });

      const durationMs = Date.now() - startTime;
      console.log(`  Status: ${execResult.status}, Events: [${execResult.sseEvents.join(', ')}], Duration: ${(durationMs / 1000).toFixed(1)}s`);
      if (execResult.error) console.log(`  Error: ${execResult.error}`);

      // Step 4: Fetch execution record
      let nodeOutputsCount = 0;
      let allNodesHaveOutput = false;
      let dbStatus = execResult.status;
      let dbError = execResult.error;
      let dbDuration = durationMs;

      if (execResult.executionId) {
        const execRecord = await page.evaluate(async ({
          wfId, execId, authToken
        }: { wfId: string; execId: string; authToken: string }) => {
          // Small delay for DB
          await new Promise(r => setTimeout(r, 1500));

          const headers: Record<string, string> = {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          };

          try {
            const res = await fetch(`/api/workflows/${wfId}/executions?limit=5`, { headers });
            if (!res.ok) return null;
            const data = await res.json();
            return (data.executions || []).find((e: any) => e.id === execId) || null;
          } catch {
            return null;
          }
        }, { wfId: wf.id, execId: execResult.executionId, authToken: token });

        if (execRecord) {
          dbStatus = execRecord.status || dbStatus;
          const nodeOutputs = execRecord.node_outputs || {};
          const outputKeys = Object.keys(nodeOutputs);
          nodeOutputsCount = outputKeys.length;
          allNodesHaveOutput = wf.nodeCount > 0 && outputKeys.length >= wf.nodeCount
            && outputKeys.every((k: string) => {
              const out = nodeOutputs[k];
              return out !== null && out !== undefined && out !== '';
            });
          if (execRecord.error) dbError = execRecord.error;
          if (execRecord.execution_time_ms) dbDuration = execRecord.execution_time_ms;
        }
      }

      results.push({
        name: wf.name,
        id: wf.id,
        nodeCount: wf.nodeCount,
        validationReady: true,
        validationErrors: [],
        executed: true,
        executionId: execResult.executionId,
        status: dbStatus,
        nodeOutputsCount,
        allNodesHaveOutput,
        error: dbError,
        durationMs: dbDuration,
      });
    }

    // Print summary
    console.log('\n' + '='.repeat(120));
    console.log('WORKFLOW EXECUTION SUMMARY');
    console.log('='.repeat(120));

    const colName = 35;
    const colStatus = 14;
    const colReady = 7;
    const colExec = 8;
    const colNodes = 7;
    const colOutputs = 9;
    const colAllOut = 10;
    const colDur = 10;

    const header = [
      'Workflow Name'.padEnd(colName),
      'Status'.padEnd(colStatus),
      'Ready'.padEnd(colReady),
      'Exec?'.padEnd(colExec),
      'Nodes'.padEnd(colNodes),
      'Outputs'.padEnd(colOutputs),
      'AllOutput'.padEnd(colAllOut),
      'Duration'.padEnd(colDur),
    ].join(' | ');

    console.log(header);
    console.log('-'.repeat(120));

    let executedCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const r of results) {
      const name = r.name.length > colName - 1 ? r.name.substring(0, colName - 2) + '..' : r.name;
      const duration = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '-';

      const row = [
        name.padEnd(colName),
        r.status.padEnd(colStatus),
        (r.validationReady ? 'YES' : 'NO').padEnd(colReady),
        (r.executed ? 'YES' : 'NO').padEnd(colExec),
        String(r.nodeCount).padEnd(colNodes),
        String(r.nodeOutputsCount).padEnd(colOutputs),
        (r.allNodesHaveOutput ? 'YES' : 'NO').padEnd(colAllOut),
        duration.padEnd(colDur),
      ].join(' | ');

      console.log(row);

      if (r.error && r.executed) {
        console.log(`  ERROR: ${r.error}`);
      }

      if (r.executed) executedCount++;
      if (r.status === 'completed') completedCount++;
      if (r.status === 'failed' || r.status === 'error') failedCount++;
      if (r.status === 'skipped') skippedCount++;
    }

    console.log('-'.repeat(120));
    console.log(`Total: ${results.length} workflows | Executed: ${executedCount} | Completed: ${completedCount} | Failed: ${failedCount} | Skipped (not ready): ${skippedCount}`);
    console.log('='.repeat(120));

    // Print validation errors for not-ready workflows
    const notReady = results.filter(r => !r.validationReady);
    if (notReady.length > 0) {
      console.log('\nNOT READY DETAILS:');
      for (const r of notReady) {
        console.log(`  ${r.name}: ${r.validationErrors.join('; ') || 'unknown'}`);
      }
    }

    // Test assertion: we should have at least found some workflows
    expect(results.length).toBeGreaterThan(0);
    console.log('\nTest complete.');
  });
});
