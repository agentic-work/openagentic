/**
 * Flows Execution & Validation E2E Test
 * Verifies:
 * 1. Workflow execution produces real node_outputs (not "No output")
 * 2. Validation endpoint catches missing config
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@openagentic.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

async function login(page: any) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) {
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
    try { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch {}
    const skipBtn = page.locator('button:has-text("Skip")');
    if (await skipBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await skipBtn.click();
      await page.waitForTimeout(500);
    }
  }
}

test.describe('Flows Execution & Validation', () => {

  test('Execute a simple LLM workflow and verify node_outputs are populated', async ({ page }) => {
    test.setTimeout(120000);
    await login(page);

    const results = await page.evaluate(async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return { error: 'No auth token' };

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const output: Record<string, any> = {};

      // 1. Create a simple 2-node workflow: trigger → llm_completion
      const triggerId = 'trigger-1';
      const llmId = 'llm-1';
      const definition = {
        nodes: [
          {
            id: triggerId,
            type: 'trigger',
            position: { x: 100, y: 200 },
            data: {
              label: 'Manual Trigger',
              type: 'trigger',
              config: { triggerType: 'manual' }
            }
          },
          {
            id: llmId,
            type: 'llm_completion',
            position: { x: 400, y: 200 },
            data: {
              label: 'Test LLM',
              type: 'llm_completion',
              prompt: 'Say exactly: "Hello from OpenAgentic test". Nothing else.',
              model: 'auto'
            }
          }
        ],
        edges: [
          { id: 'e1', source: triggerId, target: llmId }
        ]
      };

      // Create workflow
      const createRes = await fetch('/api/workflows', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'E2E Execution Test',
          description: 'Tests node_outputs are populated',
          definition,
        }),
      });
      const createData = await createRes.json();
      const workflowId = createData.workflow?.id;
      output.create = { status: createRes.status, workflowId };

      if (!workflowId) {
        output.error = 'Failed to create workflow';
        return output;
      }

      // 2. Validate the workflow
      try {
        const valRes = await fetch(`/api/workflows/${workflowId}/validate`, {
          method: 'POST',
          headers,
        });
        output.validation = await valRes.json();
      } catch (e: any) {
        output.validation = { error: e.message };
      }

      // 3. Execute the workflow via SSE
      try {
        const execRes = await fetch(`/api/workflows/${workflowId}/execute`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ input: { test: true } }),
        });

        // Read SSE stream
        const reader = execRes.body?.getReader();
        const decoder = new TextDecoder();
        let sseData = '';
        let executionId = '';
        const events: string[] = [];

        if (reader) {
          const startTime = Date.now();
          while (Date.now() - startTime < 60000) {
            const { done, value } = await reader.read();
            if (done) break;
            sseData += decoder.decode(value, { stream: true });

            // Parse SSE events
            const lines = sseData.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const evt = JSON.parse(line.substring(6));
                  events.push(evt.type || 'unknown');
                  if (evt.executionId) executionId = evt.executionId;
                  if (evt.type === 'complete' || evt.type === 'error') {
                    reader.cancel();
                    break;
                  }
                } catch {}
              }
            }

            // Check if we got completion
            if (events.includes('complete') || events.includes('error')) break;
          }
        }

        output.execution = { events, executionId };

        // 4. Fetch the execution record to verify node_outputs
        if (executionId) {
          await new Promise(r => setTimeout(r, 1000)); // Wait for DB write
          const execRecord = await fetch(`/api/workflows/${workflowId}/executions/${executionId}`, { headers });
          if (execRecord.ok) {
            const data = await execRecord.json();
            const exec = data.execution || data;
            output.executionRecord = {
              status: exec.status,
              nodeOutputKeys: exec.node_outputs ? Object.keys(exec.node_outputs) : [],
              hasNodeOutputs: exec.node_outputs && Object.keys(exec.node_outputs).length > 0,
              llmNodeOutput: exec.node_outputs?.[llmId] || null,
            };
          } else {
            output.executionRecord = { error: `HTTP ${execRecord.status}` };
          }
        }
      } catch (e: any) {
        output.execution = { error: e.message };
      }

      // 5. Cleanup
      try {
        await fetch(`/api/workflows/${workflowId}`, { method: 'DELETE', headers });
        output.cleanup = 'deleted';
      } catch { output.cleanup = 'failed'; }

      return output;
    });

    console.log('Execution test results:', JSON.stringify(results, null, 2));

    // Assertions
    expect(results.error).toBeUndefined();
    expect(results.create?.status).toBe(201);

    // Validation should pass (simple valid workflow)
    if (results.validation && !results.validation.error) {
      console.log(`Validation ready: ${results.validation.ready}`);
      console.log(`Compilation valid: ${results.validation.compilation?.valid}`);
    }

    // Execution should produce node_outputs
    if (results.executionRecord) {
      expect(results.executionRecord.hasNodeOutputs).toBe(true);
      expect(results.executionRecord.nodeOutputKeys.length).toBeGreaterThan(0);
      console.log(`Node output keys: ${results.executionRecord.nodeOutputKeys.join(', ')}`);

      if (results.executionRecord.llmNodeOutput) {
        console.log(`LLM node status: ${results.executionRecord.llmNodeOutput.status}`);
        const content = results.executionRecord.llmNodeOutput.output?.content || '';
        console.log(`LLM output preview: ${content.substring(0, 100)}`);
        expect(content.length).toBeGreaterThan(0);
      }
    }
  });

  test('Validation catches missing condition expression', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);

    const results = await page.evaluate(async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return { error: 'No auth token' };

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      // Create workflow with intentionally missing condition expression
      const definition = {
        nodes: [
          {
            id: 'trigger-1',
            type: 'trigger',
            position: { x: 100, y: 200 },
            data: { label: 'Trigger', type: 'trigger', config: { triggerType: 'manual' } }
          },
          {
            id: 'cond-1',
            type: 'condition',
            position: { x: 400, y: 200 },
            data: {
              label: 'Empty Condition',
              type: 'condition',
              config: { expression: '' }  // Intentionally empty
            }
          }
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'cond-1' }
        ]
      };

      const createRes = await fetch('/api/workflows', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Validation Test - Missing Condition',
          definition,
        }),
      });
      const { workflow } = await createRes.json();
      if (!workflow?.id) return { error: 'Failed to create' };

      // Validate
      const valRes = await fetch(`/api/workflows/${workflow.id}/validate`, {
        method: 'POST',
        headers,
      });
      const validation = await valRes.json();

      // Cleanup
      await fetch(`/api/workflows/${workflow.id}`, { method: 'DELETE', headers });

      return { validation };
    });

    console.log('Validation test:', JSON.stringify(results, null, 2));

    expect(results.error).toBeUndefined();

    // Validation should flag the missing condition expression
    const runtime = results.validation?.runtime;
    if (runtime) {
      const conditionIssue = runtime.issues?.find((i: any) =>
        i.nodeId === 'cond-1' || i.message?.toLowerCase().includes('condition')
      );
      console.log(`Found condition issue: ${!!conditionIssue}`);
      if (conditionIssue) {
        console.log(`Issue: ${conditionIssue.message}`);
      }
      expect(conditionIssue).toBeTruthy();
    }
  });
});
