/**
 * AI Flow Builder E2E Test
 * Tests CRUD operations on workflows via both API and the AI Builder UI.
 *
 * Validates:
 * 1. Workflow CRUD (Create, Read, Update, Delete) via API
 * 2. AI Builder generates workflow JSON from natural language
 * 3. Generated workflow appears on canvas
 * 4. Workflow is saved to database
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.onmicrosoft.com';
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

  // Dismiss modals
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

/** Extract auth token from localStorage after login */
async function getAuthToken(page: any): Promise<string> {
  return await page.evaluate(() => localStorage.getItem('auth_token') || '');
}

test.describe('AI Flow Builder CRUD', () => {
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

  test('API CRUD: Create, Read, Update, Delete workflow', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);
    const token = await getAuthToken(page);
    expect(token).toBeTruthy();
    console.log('Got auth token');

    // CREATE
    console.log('\n=== CREATE WORKFLOW ===');
    const createRes = await page.evaluate(async (t: string) => {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Test Workflow',
          description: 'Created by Playwright',
          definition: {
            nodes: [
              { id: 'trigger-1', type: 'trigger', position: { x: 100, y: 100 }, data: { label: 'Start', triggerType: 'manual' } },
              { id: 'llm-1', type: 'openagentic_llm', position: { x: 350, y: 100 }, data: { label: 'Analyze', prompt: 'Analyze input' } },
            ],
            edges: [{ id: 'e1', source: 'trigger-1', target: 'llm-1' }]
          },
        }),
      });
      return { status: res.status, body: await res.json() };
    }, token);

    console.log(`Create status: ${createRes.status}`);
    expect(createRes.status).toBe(201);
    expect(createRes.body.workflow).toBeTruthy();
    const workflowId = createRes.body.workflow.id;
    console.log(`Created workflow: ${workflowId}`);

    // READ (list)
    console.log('\n=== LIST WORKFLOWS ===');
    const listRes = await page.evaluate(async (t: string) => {
      const res = await fetch('/api/workflows', { headers: { 'Authorization': `Bearer ${t}` } });
      return { status: res.status, body: await res.json() };
    }, token);

    console.log(`List status: ${listRes.status}, count: ${listRes.body.workflows?.length}`);
    expect(listRes.status).toBe(200);
    const found = listRes.body.workflows?.find((w: any) => w.id === workflowId);
    expect(found).toBeTruthy();
    console.log(`Found created workflow in list: ${found.name}`);

    // READ (single)
    console.log('\n=== GET WORKFLOW ===');
    const getRes = await page.evaluate(async ([t, id]: string[]) => {
      const res = await fetch(`/api/workflows/${id}`, { headers: { 'Authorization': `Bearer ${t}` } });
      return { status: res.status, body: await res.json() };
    }, [token, workflowId]);

    console.log(`Get status: ${getRes.status}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.workflow.name).toBe('E2E Test Workflow');
    expect(getRes.body.workflow.nodes.length).toBe(2);
    console.log(`Workflow has ${getRes.body.workflow.nodes.length} nodes, ${getRes.body.workflow.edges.length} edges`);

    // UPDATE
    console.log('\n=== UPDATE WORKFLOW ===');
    const updateRes = await page.evaluate(async ([t, id]: string[]) => {
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Updated Workflow',
          definition: {
            nodes: [
              { id: 'trigger-1', type: 'trigger', position: { x: 100, y: 100 }, data: { label: 'Start', triggerType: 'manual' } },
              { id: 'llm-1', type: 'openagentic_llm', position: { x: 350, y: 100 }, data: { label: 'Analyze', prompt: 'Analyze input' } },
              { id: 'mcp-1', type: 'mcp_tool', position: { x: 600, y: 100 }, data: { label: 'Web Search', toolName: 'web_search' } },
            ],
            edges: [
              { id: 'e1', source: 'trigger-1', target: 'llm-1' },
              { id: 'e2', source: 'llm-1', target: 'mcp-1' },
            ]
          },
        }),
      });
      return { status: res.status, body: await res.json() };
    }, [token, workflowId]);

    console.log(`Update status: ${updateRes.status}`);
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.workflow.name).toBe('E2E Updated Workflow');
    expect(updateRes.body.workflow.nodes.length).toBe(3);
    console.log(`Updated to ${updateRes.body.workflow.nodes.length} nodes`);

    // DELETE
    console.log('\n=== DELETE WORKFLOW ===');
    const deleteRes = await page.evaluate(async ([t, id]: string[]) => {
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${t}` },
      });
      return { status: res.status };
    }, [token, workflowId]);

    console.log(`Delete status: ${deleteRes.status}`);
    expect(deleteRes.status).toBe(200);

    // Verify deleted
    const verifyRes = await page.evaluate(async (t: string) => {
      const res = await fetch('/api/workflows', { headers: { 'Authorization': `Bearer ${t}` } });
      return { body: await res.json() };
    }, token);
    const stillExists = verifyRes.body.workflows?.find((w: any) => w.id === workflowId);
    expect(stillExists).toBeFalsy();
    console.log('Workflow deleted and verified gone');
    console.log('\n✅ CRUD test PASSED');
  });

  test('OpenAI-compatible streaming completions work', async ({ page }) => {
    test.setTimeout(60000);
    await login(page);
    const token = await getAuthToken(page);

    console.log('\n=== TEST STREAMING COMPLETIONS ===');
    const result = await page.evaluate(async (t: string) => {
      const res = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Say "hello world" and nothing else.' }],
          model: 'auto',
          max_tokens: 50,
          stream: true,
        }),
      });

      if (!res.ok) return { error: `HTTP ${res.status}: ${await res.text()}` };
      if (!res.body) return { error: 'No response body' };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let chunkCount = 0;

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
            const delta = data.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              chunkCount++;
            }
          } catch {}
        }
      }

      return { fullContent, chunkCount };
    }, token);

    console.log(`Result: ${JSON.stringify(result)}`);
    expect(result.error).toBeUndefined();
    expect(result.fullContent).toBeTruthy();
    expect(result.fullContent.toLowerCase()).toContain('hello');
    expect(result.chunkCount).toBeGreaterThan(0);
    console.log(`✅ Streaming works: "${result.fullContent}" (${result.chunkCount} chunks)`);
  });

  test('AI Builder generates workflow on canvas', async ({ page }) => {
    test.setTimeout(180000); // 3 min for LLM generation
    await login(page);

    console.log('\n=== NAVIGATE TO WORKFLOWS ===');

    // Navigate to Flows
    const flowsLink = page.locator('a:has-text("Flows"), button:has-text("Flows"), [href*="workflow"], [href*="flows"]').first();
    if (await flowsLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await flowsLink.click();
    } else {
      await page.goto(`${BASE_URL}/workflows`);
    }
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/aibuilder-1-flows-page.png', fullPage: true });

    // Create a new workflow first
    console.log('Creating new workflow...');
    const newBtn = page.locator('button:has-text("New"), button:has-text("Create"), button:has-text("+ New")').first();
    const hasNewBtn = await newBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasNewBtn) {
      await newBtn.click();
      await page.waitForTimeout(3000);
    } else {
      console.log('No New button found, checking if already in builder...');
    }

    await page.screenshot({ path: '/tmp/aibuilder-2-builder-view.png', fullPage: true });

    // Check if we're in the builder view (has ReactFlow canvas)
    const hasCanvas = await page.locator('.react-flow').isVisible({ timeout: 10000 }).catch(() => false);
    console.log(`Canvas visible: ${hasCanvas}`);
    expect(hasCanvas).toBe(true);

    // Open AI Builder
    console.log('Opening AI Builder...');
    const aiButton = page.locator('button:has-text("AI"), button[title*="AI"], button:has(svg.lucide-sparkles)').first();
    const hasAiBtn = await aiButton.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`AI Builder button visible: ${hasAiBtn}`);

    if (hasAiBtn) {
      await aiButton.click();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({ path: '/tmp/aibuilder-3-panel-open.png', fullPage: true });

    // Check AI Builder panel is visible
    const aiPanel = page.locator('text=AI Flow Builder, text=Describe your workflow').first();
    const hasPanelText = await aiPanel.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`AI Builder panel visible: ${hasPanelText}`);

    if (!hasPanelText) {
      console.log('AI Builder panel not found - checking alternative selectors...');
      // Try finding by textarea placeholder
      const textarea = page.locator('textarea[placeholder*="workflow"], textarea[placeholder*="Describe"]').first();
      const hasTextarea = await textarea.isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`Found workflow textarea: ${hasTextarea}`);
    }

    // Type a simple workflow description
    console.log('Typing workflow description...');
    const input = page.locator('textarea[placeholder*="workflow"], textarea[placeholder*="Describe"]').first();
    await input.fill('Create a simple workflow with a manual trigger that calls an LLM to analyze text, then uses web search to find related articles.');
    await page.waitForTimeout(500);

    // Send message
    console.log('Sending message to AI Builder...');
    await page.keyboard.press('Enter');

    // Wait for generation (up to 90 seconds)
    console.log('Waiting for AI to generate workflow...');
    await page.waitForTimeout(5000); // Initial wait

    // Poll for completion
    let generationDone = false;
    for (let i = 0; i < 30; i++) {
      // Check if generating spinner is gone
      const isGenerating = await page.locator('.animate-spin').isVisible({ timeout: 1000 }).catch(() => false);
      if (!isGenerating && i > 2) {
        generationDone = true;
        break;
      }
      await page.waitForTimeout(3000);
      console.log(`  Waiting... (${(i + 1) * 3}s)`);
    }

    await page.screenshot({ path: '/tmp/aibuilder-4-after-generation.png', fullPage: true });
    console.log(`Generation completed: ${generationDone}`);

    // Check if "Apply to Canvas" button appeared
    const applyBtn = page.locator('button:has-text("Apply to Canvas"), button:has-text("Apply")').first();
    const hasApplyBtn = await applyBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Apply to Canvas button visible: ${hasApplyBtn}`);

    if (hasApplyBtn) {
      console.log('Clicking Apply to Canvas...');
      await applyBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: '/tmp/aibuilder-5-canvas-with-nodes.png', fullPage: true });

    // Check if nodes appeared on canvas
    const nodeCount = await page.locator('.react-flow__node').count();
    console.log(`Nodes on canvas: ${nodeCount}`);
    expect(nodeCount).toBeGreaterThan(0);

    console.log(`\n✅ AI Builder test PASSED: ${nodeCount} nodes generated on canvas`);
  });
});
