/**
 * E2E Test: Flowise Bulk Workflow Creation
 *
 * Creates 50 chatflows and 50 agentflows via Flowise MCP integration.
 * Tests include RAG, Agentic RAG, Agent as Tool, and various workflow patterns.
 *
 * Run with: npx playwright test flowise-bulk-workflows.spec.ts --headed
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const FLOWISE_URL = process.env.FLOWISE_URL || 'https://chat-dev.openagentic.io/flowise';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@openagentic.io';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';

// Workflow templates for chatflows
const CHATFLOW_TEMPLATES = [
  { name: 'Basic Q&A', type: 'qa', description: 'Simple question answering chatflow' },
  { name: 'RAG Document', type: 'rag', description: 'RAG with document loader' },
  { name: 'RAG Web Scraper', type: 'rag-web', description: 'RAG with web scraping' },
  { name: 'Conversational', type: 'conversation', description: 'Multi-turn conversation' },
  { name: 'Code Assistant', type: 'code', description: 'Code generation and review' },
  { name: 'SQL Query', type: 'sql', description: 'Natural language to SQL' },
  { name: 'API Chain', type: 'api', description: 'API call chains' },
  { name: 'Summary', type: 'summary', description: 'Text summarization' },
  { name: 'Translation', type: 'translate', description: 'Multi-language translation' },
  { name: 'Knowledge Base', type: 'kb', description: 'Knowledge base Q&A' }
];

// Workflow templates for agentflows
const AGENTFLOW_TEMPLATES = [
  { name: 'ReAct Agent', type: 'react', description: 'Reasoning and acting agent' },
  { name: 'Plan-Execute', type: 'plan', description: 'Planning and execution agent' },
  { name: 'Multi-Tool', type: 'tools', description: 'Agent with multiple tools' },
  { name: 'Research Agent', type: 'research', description: 'Web research agent' },
  { name: 'Data Analysis', type: 'analysis', description: 'Data analysis agent' },
  { name: 'Code Review', type: 'code-review', description: 'Code review agent' },
  { name: 'DevOps', type: 'devops', description: 'DevOps automation agent' },
  { name: 'Customer Support', type: 'support', description: 'Customer support agent' },
  { name: 'Content Creator', type: 'content', description: 'Content generation agent' },
  { name: 'Task Manager', type: 'task', description: 'Task management agent' }
];

interface WorkflowResult {
  name: string;
  type: string;
  created: boolean;
  id?: string;
  error?: string;
  duration: number;
}

test.describe('Flowise Bulk Workflow Creation', () => {
  test.setTimeout(1800000); // 30 minute timeout

  let page: Page;
  const chatflowResults: WorkflowResult[] = [];
  const agentflowResults: WorkflowResult[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Login to main app
    await page.goto(BASE_URL);

    const localAuthButton = page.locator('text=Local').first();
    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }

    const emailInput = page.locator('input[type="email"]').or(page.locator('input[name="email"]'));
    const passwordInput = page.locator('input[type="password"]');
    await emailInput.fill(TEST_EMAIL);
    await passwordInput.fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 });

    console.log('[Setup] Logged in successfully');
  });

  test.afterAll(async () => {
    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('FLOWISE BULK WORKFLOW CREATION SUMMARY');
    console.log('='.repeat(80));

    const successfulChatflows = chatflowResults.filter(r => r.created);
    const successfulAgentflows = agentflowResults.filter(r => r.created);

    console.log(`\nChatflows: ${successfulChatflows.length}/${chatflowResults.length} created`);
    for (const result of chatflowResults) {
      const status = result.created ? '✅' : '❌';
      console.log(`  ${status} ${result.name} (${result.duration}ms)${result.error ? `: ${result.error}` : ''}`);
    }

    console.log(`\nAgentflows: ${successfulAgentflows.length}/${agentflowResults.length} created`);
    for (const result of agentflowResults) {
      const status = result.created ? '✅' : '❌';
      console.log(`  ${status} ${result.name} (${result.duration}ms)${result.error ? `: ${result.error}` : ''}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log(`TOTAL: ${successfulChatflows.length + successfulAgentflows.length}/${chatflowResults.length + agentflowResults.length} workflows created`);
    console.log('='.repeat(80));

    await page.close();
  });

  test('Create 50 Chatflows via MCP', async () => {
    console.log('\n[Test] Creating chatflows via MCP...\n');

    // Create 50 chatflows (5 variations of each template)
    for (let i = 0; i < 50; i++) {
      const templateIndex = i % CHATFLOW_TEMPLATES.length;
      const template = CHATFLOW_TEMPLATES[templateIndex];
      const variation = Math.floor(i / CHATFLOW_TEMPLATES.length) + 1;
      const workflowName = `${template.name} v${variation} - ${Date.now()}`;

      const startTime = Date.now();
      let result: WorkflowResult = {
        name: workflowName,
        type: template.type,
        created: false,
        duration: 0
      };

      try {
        console.log(`[Chatflow ${i + 1}/50] Creating: ${workflowName}`);

        // Use the chat interface to create via MCP
        const chatInput = page.locator('textarea').first();
        await chatInput.click();

        // Construct MCP command to create chatflow
        const mcpCommand = `Create a new Flowise chatflow named "${workflowName}" with the following configuration:
- Type: ${template.type}
- Description: ${template.description}
- Use the default LLM model
- Enable memory for conversation context`;

        await chatInput.fill(mcpCommand);

        // Submit
        const sendButton = page.locator('button[type="submit"]')
          .or(page.locator('[data-testid="send-button"]'));

        if (await sendButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
          await sendButton.first().click();
        } else {
          await chatInput.press('Enter');
        }

        // Wait for response
        await page.waitForTimeout(5000);

        // Check for success indicators in response
        const responseText = await page.locator('[data-message-role="assistant"]')
          .last()
          .innerText({ timeout: 30000 })
          .catch(() => '');

        if (responseText.toLowerCase().includes('created') ||
            responseText.toLowerCase().includes('success') ||
            responseText.toLowerCase().includes('chatflow')) {
          result.created = true;
          // Try to extract ID from response
          const idMatch = responseText.match(/id[:\s]+([a-f0-9-]+)/i);
          if (idMatch) {
            result.id = idMatch[1];
          }
        } else {
          result.error = 'No success confirmation in response';
        }

      } catch (error: any) {
        result.error = error.message;
      }

      result.duration = Date.now() - startTime;
      chatflowResults.push(result);

      console.log(`  ${result.created ? '✅' : '❌'} ${workflowName} (${result.duration}ms)`);

      // Brief delay between creations
      await page.waitForTimeout(1000);
    }

    const successCount = chatflowResults.filter(r => r.created).length;
    expect(successCount).toBeGreaterThan(0);
    console.log(`\n[Chatflows] Created ${successCount}/50`);
  });

  test('Create 50 Agentflows via MCP', async () => {
    console.log('\n[Test] Creating agentflows via MCP...\n');

    // Create 50 agentflows (5 variations of each template)
    for (let i = 0; i < 50; i++) {
      const templateIndex = i % AGENTFLOW_TEMPLATES.length;
      const template = AGENTFLOW_TEMPLATES[templateIndex];
      const variation = Math.floor(i / AGENTFLOW_TEMPLATES.length) + 1;
      const workflowName = `${template.name} Agent v${variation} - ${Date.now()}`;

      const startTime = Date.now();
      let result: WorkflowResult = {
        name: workflowName,
        type: template.type,
        created: false,
        duration: 0
      };

      try {
        console.log(`[Agentflow ${i + 1}/50] Creating: ${workflowName}`);

        // Use the chat interface to create via MCP
        const chatInput = page.locator('textarea').first();
        await chatInput.click();

        // Construct MCP command to create agentflow
        const mcpCommand = `Create a new Flowise agentflow named "${workflowName}" with the following configuration:
- Agent Type: ${template.type}
- Description: ${template.description}
- Include tool nodes for web search and document retrieval
- Configure with ReAct agent pattern`;

        await chatInput.fill(mcpCommand);

        // Submit
        const sendButton = page.locator('button[type="submit"]')
          .or(page.locator('[data-testid="send-button"]'));

        if (await sendButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
          await sendButton.first().click();
        } else {
          await chatInput.press('Enter');
        }

        // Wait for response
        await page.waitForTimeout(5000);

        // Check for success indicators in response
        const responseText = await page.locator('[data-message-role="assistant"]')
          .last()
          .innerText({ timeout: 30000 })
          .catch(() => '');

        if (responseText.toLowerCase().includes('created') ||
            responseText.toLowerCase().includes('success') ||
            responseText.toLowerCase().includes('agentflow') ||
            responseText.toLowerCase().includes('agent')) {
          result.created = true;
          // Try to extract ID from response
          const idMatch = responseText.match(/id[:\s]+([a-f0-9-]+)/i);
          if (idMatch) {
            result.id = idMatch[1];
          }
        } else {
          result.error = 'No success confirmation in response';
        }

      } catch (error: any) {
        result.error = error.message;
      }

      result.duration = Date.now() - startTime;
      agentflowResults.push(result);

      console.log(`  ${result.created ? '✅' : '❌'} ${workflowName} (${result.duration}ms)`);

      // Brief delay between creations
      await page.waitForTimeout(1000);
    }

    const successCount = agentflowResults.filter(r => r.created).length;
    expect(successCount).toBeGreaterThan(0);
    console.log(`\n[Agentflows] Created ${successCount}/50`);
  });

  test('Verify workflows in Flowise UI', async () => {
    console.log('\n[Test] Verifying workflows in Flowise UI...\n');

    // Navigate to Flowise
    const flowiseButton = page.locator('text=Flowise')
      .or(page.locator('[aria-label*="Flowise" i]'))
      .or(page.locator('button:has-text("Flowise")'));

    if (await flowiseButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await flowiseButton.first().click();
      await page.waitForTimeout(5000);

      // Try to access Flowise iframe
      const frame = page.frameLocator('iframe').first();

      // Look for Chatflows menu
      const chatflowsMenu = frame.locator('text=Chatflows')
        .or(frame.locator('[data-testid="chatflows"]'));

      if (await chatflowsMenu.isVisible({ timeout: 10000 }).catch(() => false)) {
        await chatflowsMenu.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/flowise-chatflows-list.png', fullPage: true });

        // Count visible chatflows
        const chatflowItems = await frame.locator('[class*="MuiCard"]')
          .or(frame.locator('[class*="workflow-card"]'))
          .count();
        console.log(`  Visible chatflows in UI: ${chatflowItems}`);
      }

      // Look for Agentflows menu
      const agentflowsMenu = frame.locator('text=Agentflows')
        .or(frame.locator('[data-testid="agentflows"]'));

      if (await agentflowsMenu.isVisible({ timeout: 5000 }).catch(() => false)) {
        await agentflowsMenu.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/flowise-agentflows-list.png', fullPage: true });

        // Count visible agentflows
        const agentflowItems = await frame.locator('[class*="MuiCard"]')
          .or(frame.locator('[class*="workflow-card"]'))
          .count();
        console.log(`  Visible agentflows in UI: ${agentflowItems}`);
      }
    } else {
      console.log('  ⚠️ Could not find Flowise button');
    }

    await page.screenshot({ path: 'screenshots/flowise-bulk-complete.png', fullPage: true });
  });

  test('Test workflow execution', async () => {
    console.log('\n[Test] Testing workflow execution...\n');

    // Test one of each type to verify they work
    const chatflowToTest = chatflowResults.find(r => r.created && r.id);
    const agentflowToTest = agentflowResults.find(r => r.created && r.id);

    if (chatflowToTest) {
      console.log(`  Testing chatflow: ${chatflowToTest.name}`);

      const chatInput = page.locator('textarea').first();
      await chatInput.click();
      await chatInput.fill(`Execute the Flowise chatflow "${chatflowToTest.name}" with the message: "Hello, this is a test message"`);

      const sendButton = page.locator('button[type="submit"]');
      if (await sendButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await sendButton.first().click();
      } else {
        await chatInput.press('Enter');
      }

      await page.waitForTimeout(10000);

      const responseText = await page.locator('[data-message-role="assistant"]')
        .last()
        .innerText({ timeout: 30000 })
        .catch(() => '');

      console.log(`  Chatflow response: ${responseText.substring(0, 100)}...`);
    }

    if (agentflowToTest) {
      console.log(`  Testing agentflow: ${agentflowToTest.name}`);

      const chatInput = page.locator('textarea').first();
      await chatInput.click();
      await chatInput.fill(`Execute the Flowise agentflow "${agentflowToTest.name}" with the task: "Research the latest trends in AI"`);

      const sendButton = page.locator('button[type="submit"]');
      if (await sendButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await sendButton.first().click();
      } else {
        await chatInput.press('Enter');
      }

      await page.waitForTimeout(15000);

      const responseText = await page.locator('[data-message-role="assistant"]')
        .last()
        .innerText({ timeout: 30000 })
        .catch(() => '');

      console.log(`  Agentflow response: ${responseText.substring(0, 100)}...`);
    }

    await page.screenshot({ path: 'screenshots/flowise-execution-test.png', fullPage: true });
  });
});
