import { test } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.onmicrosoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

async function login(page: any) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  const isLoggedIn = await page.locator('textarea').isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) { try { await page.keyboard.press('Escape'); } catch {} return; }
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
    await page.waitForURL(BASE_URL + '/**', { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
  }
  await page.waitForSelector('textarea', { timeout: 60000 });
  for (let i = 0; i < 3; i++) { try { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } catch {} }
}

test('Audit all workflows', async ({ page }) => {
  test.setTimeout(300000);
  await login(page);

  const results = await page.evaluate(async () => {
    const token = localStorage.getItem('auth_token');
    if (!token) return { error: 'No auth token' };
    const headers: Record<string, string> = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    // List all workflows
    const listRes = await fetch('/api/workflows', { headers });
    const listData = await listRes.json();
    const workflows = listData.workflows || listData || [];

    const audit: any[] = [];

    for (const wf of workflows) {
      // Get full workflow with definition
      const detRes = await fetch('/api/workflows/' + wf.id, { headers });
      const detData = await detRes.json();
      const workflow = detData.workflow || detData;
      const def = workflow.definition || {};
      const nodes = def.nodes || [];
      const edges = def.edges || [];

      const nodeTypes = nodes.map((n: any) => n.data?.type || n.type || 'unknown');
      const nodeDetails = nodes.map((n: any) => ({
        id: n.id,
        type: n.data?.type || n.type,
        label: n.data?.label || n.id,
        hasPrompt: !!(n.data?.prompt),
        hasModel: !!(n.data?.model),
        hasConfig: !!(n.data?.config && Object.keys(n.data.config).length > 0),
      }));

      // Validate
      let validation: any = null;
      try {
        const valRes = await fetch('/api/workflows/' + wf.id + '/validate', { method: 'POST', headers });
        validation = await valRes.json();
      } catch (e: any) { validation = { error: e.message }; }

      // Get recent executions
      let recentExec: any = null;
      try {
        const execsRes = await fetch('/api/workflows/' + wf.id + '/executions?limit=1', { headers });
        if (execsRes.ok) {
          const execsData = await execsRes.json();
          const execs = execsData.executions || [];
          if (execs.length > 0) {
            recentExec = {
              status: execs[0].status,
              hasNodeOutputs: execs[0].node_outputs && Object.keys(execs[0].node_outputs).length > 0,
              nodeOutputCount: execs[0].node_outputs ? Object.keys(execs[0].node_outputs).length : 0,
            };
          }
        }
      } catch {}

      audit.push({
        id: wf.id,
        name: wf.name || 'unnamed',
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodeTypes,
        nodeDetails,
        validationReady: validation?.ready,
        compilationValid: validation?.compilation?.valid,
        compilationErrors: validation?.compilation?.errors || [],
        runtimeIssues: validation?.runtime?.issues || [],
        recentExec,
      });
    }

    return { total: workflows.length, audit };
  });

  // Print detailed audit
  console.log('\n========================================');
  console.log('WORKFLOW AUDIT: ' + results.total + ' workflows');
  console.log('========================================\n');

  for (const wf of results.audit || []) {
    const status = wf.validationReady ? 'READY' : 'NOT READY';
    const execStatus = wf.recentExec ? (wf.recentExec.hasNodeOutputs ? 'HAS OUTPUTS' : 'NO OUTPUTS') : 'NEVER RUN';
    console.log(`[${status}] ${wf.name} (${wf.nodeCount} nodes, ${wf.edgeCount} edges)`);
    console.log(`  ID: ${wf.id}`);
    console.log(`  Node types: ${wf.nodeTypes.join(', ')}`);
    console.log(`  Last exec: ${execStatus}`);

    if (wf.compilationErrors.length > 0) {
      for (const e of wf.compilationErrors) {
        console.log(`  COMPILE ERROR: ${e.message} (${e.nodeId || 'global'})`);
      }
    }
    if (wf.runtimeIssues.length > 0) {
      for (const i of wf.runtimeIssues) {
        console.log(`  RUNTIME ISSUE: [${i.code}] ${i.message} (${i.nodeId || 'global'})`);
      }
    }

    // Show node details for nodes with issues
    for (const nd of wf.nodeDetails) {
      const issues = wf.runtimeIssues.filter((i: any) => i.nodeId === nd.id);
      if (issues.length > 0 || (!nd.hasPrompt && (nd.type === 'llm_completion' || nd.type === 'llm_openai'))) {
        console.log(`  NODE: ${nd.label} [${nd.type}] prompt=${nd.hasPrompt} model=${nd.hasModel}`);
      }
    }
    console.log('');
  }
});
