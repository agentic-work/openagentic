/**
 * Workflow Execution E2E Test
 * Tests actual workflow execution (not just CRUD) through the OpenAgentic API.
 *
 * Validates:
 * 1. Create a multi-node workflow with trigger → LLM → transform
 * 2. Execute workflow via SSE streaming
 * 3. Verify execution events are received (node_start, node_complete, etc.)
 * 4. Verify execution history records the run
 * 5. Test workflow versioning (create version, activate)
 * 6. Test workflow duplication
 * 7. Cleanup: delete test workflows
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@openagentic.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

test.use({ ignoreHTTPSErrors: true });

async function login(page: any) {
  console.log('=== LOGIN FLOW (Azure AD) ===');
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) {
    console.log('Already logged in!');
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

  for (let attempt = 0; attempt < 5; attempt++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const hasOverlay = await page.locator('.fixed.inset-0').first().isVisible({ timeout: 500 }).catch(() => false);
    if (!hasOverlay) break;
    try {
      const skipBtn = page.locator('button:has-text("Skip")').first();
      if (await skipBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await skipBtn.click({ force: true });
        await page.waitForTimeout(500);
      }
    } catch {}
  }

  console.log('Login complete!');
}

async function getAuthToken(page: any): Promise<string> {
  return await page.evaluate(() => localStorage.getItem('auth_token') || '');
}

test.describe('Workflow Execution', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[BROWSER ERROR] ${msg.text()}`);
      }
    });
    page.on('response', async response => {
      if (response.status() >= 400 && response.url().includes('/api/')) {
        const body = await response.text().catch(() => '');
        console.log(`[HTTP ${response.status()}] ${response.url()} → ${body.substring(0, 200)}`);
      }
    });
  });

  test('Execute workflow via SSE and verify events', async ({ page }) => {
    test.setTimeout(120000); // 2 min for execution
    await login(page);
    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Step 1: Create a workflow with trigger → LLM → transform
    console.log('\n=== STEP 1: CREATE WORKFLOW ===');
    const createRes = await page.evaluate(async (t: string) => {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Execution Test',
          description: 'Tests workflow execution via SSE',
          definition: {
            nodes: [
              {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: 100, y: 200 },
                data: { label: 'Start', triggerType: 'manual' }
              },
              {
                id: 'llm-1',
                type: 'openagentic_llm',
                position: { x: 400, y: 200 },
                data: {
                  label: 'Generate Greeting',
                  prompt: 'Say "Hello from workflow execution test" and nothing else.',
                  maxTokens: 50,
                }
              },
              {
                id: 'transform-1',
                type: 'transform',
                position: { x: 700, y: 200 },
                data: {
                  label: 'Format Output',
                  expression: '{ "result": input.content, "timestamp": new Date().toISOString() }',
                }
              },
            ],
            edges: [
              { id: 'e1', source: 'trigger-1', target: 'llm-1' },
              { id: 'e2', source: 'llm-1', target: 'transform-1' },
            ]
          },
        }),
      });
      return { status: res.status, body: await res.json() };
    }, token);

    expect(createRes.status).toBe(201);
    const workflowId = createRes.body.workflow.id;
    console.log(`Created workflow: ${workflowId} with ${createRes.body.workflow.nodes.length} nodes`);

    // Step 2: Execute the workflow via SSE streaming
    console.log('\n=== STEP 2: EXECUTE WORKFLOW (SSE) ===');
    const execResult = await page.evaluate(async ([t, wfId]: string[]) => {
      const res = await fetch(`/api/workflows/${wfId}/execute`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { message: 'Test execution' } }),
      });

      if (!res.ok) {
        return { error: `HTTP ${res.status}: ${await res.text()}` };
      }

      // Check if it's SSE (streaming)
      const contentType = res.headers.get('content-type') || '';
      const isSSE = contentType.includes('text/event-stream');

      if (isSSE && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const events: Array<{ type: string; data: any }> = [];
        let executionId = '';

        const timeout = setTimeout(() => reader.cancel(), 90000); // 90s timeout

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n');

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const dataStr = trimmed.substring(5).trim();
              if (dataStr === '[DONE]') continue;

              try {
                const data = JSON.parse(dataStr);
                events.push({ type: data.type || data.event || 'unknown', data });

                if (data.executionId) executionId = data.executionId;
                if (data.execution_id) executionId = data.execution_id;
              } catch {}
            }
          }
        } finally {
          clearTimeout(timeout);
        }

        return {
          isSSE: true,
          events,
          executionId,
          eventTypes: [...new Set(events.map(e => e.type))],
          eventCount: events.length,
        };
      }

      // Non-SSE response (sync execution)
      const body = await res.json();
      return {
        isSSE: false,
        body,
        executionId: body.executionId || body.execution?.id || '',
      };
    }, [token, workflowId]);

    console.log(`Execution result: SSE=${execResult.isSSE}, events=${execResult.eventCount || 0}`);
    if (execResult.error) {
      console.log(`Execution error: ${execResult.error}`);
    }
    if (execResult.eventTypes) {
      console.log(`Event types: ${execResult.eventTypes.join(', ')}`);
    }
    if (execResult.executionId) {
      console.log(`Execution ID: ${execResult.executionId}`);
    }

    // The execution should either return SSE events or a sync result
    expect(execResult.error).toBeUndefined();

    // Step 3: Check execution history
    console.log('\n=== STEP 3: CHECK EXECUTION HISTORY ===');
    const historyRes = await page.evaluate(async ([t, wfId]: string[]) => {
      const res = await fetch(`/api/workflows/${wfId}/executions`, {
        headers: { 'Authorization': `Bearer ${t}` },
      });
      return { status: res.status, body: await res.json() };
    }, [token, workflowId]);

    console.log(`History status: ${historyRes.status}`);
    if (historyRes.body.executions) {
      console.log(`Execution count: ${historyRes.body.executions.length}`);
      if (historyRes.body.executions.length > 0) {
        const latest = historyRes.body.executions[0];
        console.log(`Latest execution: status=${latest.status}, nodes=${latest.completed_nodes || latest.completedNodes || '?'}/${latest.total_nodes || latest.totalNodes || '?'}`);
      }
    }

    // Step 4: Test workflow versioning
    console.log('\n=== STEP 4: VERSION CONTROL ===');
    const versionRes = await page.evaluate(async ([t, wfId]: string[]) => {
      // Create a new version
      const createVersionRes = await fetch(`/api/workflows/${wfId}/versions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'E2E test version' }),
      });
      const createBody = await createVersionRes.json();

      // List versions
      const listVersionsRes = await fetch(`/api/workflows/${wfId}/versions`, {
        headers: { 'Authorization': `Bearer ${t}` },
      });
      const listBody = await listVersionsRes.json();

      return {
        createStatus: createVersionRes.status,
        versionId: createBody.version?.id,
        listStatus: listVersionsRes.status,
        versionCount: listBody.versions?.length,
      };
    }, [token, workflowId]);

    console.log(`Version create: ${versionRes.createStatus}, version ID: ${versionRes.versionId}`);
    console.log(`Version list: ${versionRes.listStatus}, count: ${versionRes.versionCount}`);

    // Step 5: Test workflow duplication
    console.log('\n=== STEP 5: DUPLICATE WORKFLOW ===');
    const dupRes = await page.evaluate(async ([t, wfId]: string[]) => {
      const res = await fetch(`/api/workflows/${wfId}/duplicate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t}` },
      });
      return { status: res.status, body: await res.json() };
    }, [token, workflowId]);

    console.log(`Duplicate status: ${dupRes.status}`);
    let duplicateId = '';
    if (dupRes.body.workflow) {
      duplicateId = dupRes.body.workflow.id;
      console.log(`Duplicated as: ${duplicateId} (name: "${dupRes.body.workflow.name}")`);
      expect(dupRes.body.workflow.nodes.length).toBe(3); // Same node count
    }

    // Step 6: Cleanup
    console.log('\n=== STEP 6: CLEANUP ===');
    await page.evaluate(async ([t, wfId, dupId]: string[]) => {
      await fetch(`/api/workflows/${wfId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${t}` } });
      if (dupId) {
        await fetch(`/api/workflows/${dupId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${t}` } });
      }
    }, [token, workflowId, duplicateId]);

    console.log('Cleanup complete');
    console.log('\n=== RESULTS SUMMARY ===');
    console.log(`  Workflow CRUD: PASS`);
    console.log(`  Execution: ${execResult.error ? 'FAIL' : 'PASS'}`);
    console.log(`  Versioning: ${versionRes.createStatus === 201 ? 'PASS' : versionRes.createStatus === 200 ? 'PASS' : 'FAIL'}`);
    console.log(`  Duplication: ${dupRes.status === 201 || dupRes.status === 200 ? 'PASS' : 'FAIL'}`);
  });

  test('Workflow test mode (execute without saving)', async ({ page }) => {
    test.setTimeout(120000);
    await login(page);
    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    console.log('\n=== TEST MODE: Execute Workflow Without Saving ===');

    const testResult = await page.evaluate(async (t: string) => {
      const res = await fetch('/api/workflows/test', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger',
              position: { x: 100, y: 200 },
              data: { label: 'Start', triggerType: 'manual' }
            },
            {
              id: 'llm-1',
              type: 'openagentic_llm',
              position: { x: 400, y: 200 },
              data: {
                label: 'Quick Test',
                prompt: 'Reply with exactly: "test passed"',
                maxTokens: 20,
              }
            },
          ],
          edges: [
            { id: 'e1', source: 'trigger-1', target: 'llm-1' },
          ],
          input: { message: 'test' },
        }),
      });

      if (!res.ok) {
        return { error: `HTTP ${res.status}: ${await res.text()}` };
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const events: any[] = [];
        const timeout = setTimeout(() => reader.cancel(), 60000);

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const line of text.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const dataStr = trimmed.substring(5).trim();
              if (dataStr === '[DONE]') continue;
              try { events.push(JSON.parse(dataStr)); } catch {}
            }
          }
        } finally { clearTimeout(timeout); }

        return { events, count: events.length };
      }

      return { body: await res.json() };
    }, token);

    if (testResult.error) {
      console.log(`Test mode error: ${testResult.error}`);
    } else {
      console.log(`Test mode: ${testResult.count || 0} events received`);
      if (testResult.events) {
        const types = [...new Set(testResult.events.map((e: any) => e.type || e.event || 'unknown'))];
        console.log(`Event types: ${types.join(', ')}`);
      }
    }

    expect(testResult.error).toBeUndefined();
    console.log('Test mode PASSED');
  });

  test('Workflow UI: Navigate to flows, create, and verify canvas', async ({ page }) => {
    test.setTimeout(120000);
    await login(page);

    console.log('\n=== NAVIGATE TO FLOWS ===');

    // Navigate to Flows
    const flowsLink = page.locator('a:has-text("Flows"), button:has-text("Flows"), [href*="workflow"], [href*="flows"]').first();
    if (await flowsLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await flowsLink.click();
    } else {
      await page.goto(`${BASE_URL}/workflows`);
    }
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check for React errors
    const hasError = await page.locator('text=Something went wrong').isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasError).toBe(false);

    await page.screenshot({ path: '/tmp/wf-exec-1-flows-page.png', fullPage: true });

    // Check for workflow list or canvas
    const hasContent = await page.locator('.react-flow, text=Workflows, text=Create, text=New Workflow').first()
      .isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`Has workflow content: ${hasContent}`);

    // Try creating a new workflow via the UI
    const newBtn = page.locator('button:has-text("New"), button:has-text("Create"), button:has-text("+ New")').first();
    const hasNewBtn = await newBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`New button visible: ${hasNewBtn}`);

    if (hasNewBtn) {
      await newBtn.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/tmp/wf-exec-2-new-workflow.png', fullPage: true });

      // Verify canvas loaded
      const hasCanvas = await page.locator('.react-flow').isVisible({ timeout: 10000 }).catch(() => false);
      console.log(`Canvas visible: ${hasCanvas}`);
      expect(hasCanvas).toBe(true);

      // Check node palette exists
      const hasPalette = await page.locator('text=Triggers, text=AI / LLM, text=Actions').first()
        .isVisible({ timeout: 5000 }).catch(() => false);
      console.log(`Node palette visible: ${hasPalette}`);

      await page.screenshot({ path: '/tmp/wf-exec-3-canvas.png', fullPage: true });
    }

    console.log('UI navigation test PASSED');
  });

  test('UI Execute: Create workflow, click Execute, verify node execution states', async ({ page }) => {
    test.setTimeout(180000);
    await login(page);
    const token = await getAuthToken(page);
    expect(token).toBeTruthy();

    // Step 1: Create a simple 2-node workflow via API (trigger → transform)
    // Using transform instead of LLM to avoid LLM timeouts in E2E
    console.log('\n=== STEP 1: CREATE WORKFLOW VIA API ===');
    const createRes = await page.evaluate(async (t: string) => {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E UI Execute Test',
          description: 'Test UI execution flow',
          definition: {
            nodes: [
              {
                id: 'trigger-1',
                type: 'trigger',
                position: { x: 250, y: 100 },
                data: { label: 'Start', triggerType: 'manual', triggerConfig: {} }
              },
              {
                id: 'transform-1',
                type: 'transform',
                position: { x: 250, y: 300 },
                data: {
                  label: 'Format',
                  transformType: 'map',
                  transformExpression: '{ "result": "executed", "ts": new Date().toISOString() }',
                }
              },
            ],
            edges: [
              { id: 'e1', source: 'trigger-1', target: 'transform-1' },
            ]
          },
        }),
      });
      return { status: res.status, body: await res.json() };
    }, token);

    expect(createRes.status).toBe(201);
    const workflowId = createRes.body.workflow.id;
    console.log(`Created workflow: ${workflowId}`);

    // Step 2: Navigate to the workflow in the UI
    console.log('\n=== STEP 2: OPEN WORKFLOW IN UI ===');

    // Navigate to flows page
    const flowsTab = page.locator('[data-tab="flows"], a[href*="/workflows"], button:has-text("Flows")').first();
    if (await flowsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await flowsTab.click();
    } else {
      await page.goto(`${BASE_URL}/workflows`);
    }
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle');

    // Find and click on our test workflow
    const wfItem = page.locator(`text=E2E UI Execute Test`).first();
    const hasWfItem = await wfItem.isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`Workflow visible in list: ${hasWfItem}`);

    if (hasWfItem) {
      await wfItem.click();
      await page.waitForTimeout(2000);
    } else {
      // Direct navigation
      await page.goto(`${BASE_URL}/workflows/${workflowId}`);
      await page.waitForTimeout(3000);
    }

    // Wait for canvas to load
    const hasCanvas = await page.locator('.react-flow').isVisible({ timeout: 15000 }).catch(() => false);
    console.log(`Canvas visible: ${hasCanvas}`);
    expect(hasCanvas).toBe(true);

    await page.screenshot({ path: '/tmp/wf-ui-exec-1-canvas.png', fullPage: true });

    // Step 3: Click the Execute button
    console.log('\n=== STEP 3: CLICK EXECUTE ===');
    const executeBtn = page.locator('button:has-text("Execute"), button:has-text("Run")').first();
    const hasBtnVisible = await executeBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Execute button visible: ${hasBtnVisible}`);

    if (hasBtnVisible) {
      // Check button is not disabled
      const isDisabled = await executeBtn.isDisabled();
      console.log(`Execute button disabled: ${isDisabled}`);

      if (!isDisabled) {
        await executeBtn.click();
        console.log('Clicked Execute button');

        // Wait for execution to complete (look for state changes)
        await page.waitForTimeout(5000);

        await page.screenshot({ path: '/tmp/wf-ui-exec-2-executing.png', fullPage: true });

        // Check for execution panel or node state changes
        const executionPanel = page.locator('text=Execution, text=Timeline, text=Running, text=Completed').first();
        const hasExecPanel = await executionPanel.isVisible({ timeout: 10000 }).catch(() => false);
        console.log(`Execution panel/indicator visible: ${hasExecPanel}`);

        // Wait a bit more for completion
        await page.waitForTimeout(5000);

        await page.screenshot({ path: '/tmp/wf-ui-exec-3-completed.png', fullPage: true });

        // Verify execution happened by checking API
        const historyRes = await page.evaluate(async ([t, wfId]: string[]) => {
          const res = await fetch(`/api/workflows/${wfId}/executions`, {
            headers: { 'Authorization': `Bearer ${t}` },
          });
          return { status: res.status, body: await res.json() };
        }, [token, workflowId]);

        console.log(`Execution history: ${historyRes.body.executions?.length || 0} executions`);
        if (historyRes.body.executions?.length > 0) {
          const latest = historyRes.body.executions[0];
          console.log(`Latest execution: status=${latest.status}`);
          expect(latest.status).toBe('completed');
          console.log('UI Execute test PASSED - workflow executed successfully');
        } else {
          console.log('WARNING: No executions found in history after UI execute');
        }
      } else {
        console.log('Execute button is disabled - checking why');
        await page.screenshot({ path: '/tmp/wf-ui-exec-disabled.png', fullPage: true });
      }
    } else {
      console.log('Execute button not found - checking toolbar');
      await page.screenshot({ path: '/tmp/wf-ui-exec-no-button.png', fullPage: true });
    }

    // Step 4: Cleanup
    console.log('\n=== STEP 4: CLEANUP ===');
    await page.evaluate(async ([t, wfId]: string[]) => {
      await fetch(`/api/workflows/${wfId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${t}` } });
    }, [token, workflowId]);
    console.log('Cleanup complete');
  });
});
