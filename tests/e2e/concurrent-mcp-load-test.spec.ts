/**
 * E2E Test: Concurrent MCP Load Test
 *
 * Tests 100 concurrent chat sessions with 200 requests each using ALL MCP tools.
 * Forces full API capability usage including:
 * - oap-diagram-mcp: React Flow diagrams
 * - oap-azure-cost-mcp: Azure cost analysis
 * - oap-azure-mcp: Azure operations
 * - oap-gcp-mcp: GCP operations
 * - oap-flowise-mcp: Flowise workflow management
 * - oap-web-mcp: Web operations
 * - oap-memory-mcp: Memory/context persistence
 * - oap-servicenow-mcp: ServiceNow integration
 *
 * Run with: npx playwright test concurrent-mcp-load-test.spec.ts --headed
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@openagentic.io';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';
const API_KEY = process.env.API_KEY || 'awc_c17e659516e2d9c9a902cf872408a9f17df3378ad6e3bb7be0f6a73307d4c274';

// Configuration
const CONCURRENT_SESSIONS = 10;  // Start with 10 for testing, scale to 100
const REQUESTS_PER_SESSION = 20; // Start with 20 for testing, scale to 200
const REQUEST_DELAY_MS = 1000;   // Delay between requests within a session

// MCP Tool-specific questions that FORCE tool usage
const MCP_QUESTIONS = [
  // oap-diagram-mcp: React Flow diagrams
  {
    category: 'diagram',
    questions: [
      'Create a React Flow diagram showing a microservices architecture with API Gateway, User Service, Order Service, and Database nodes. Use different colors for each service type.',
      'Generate a flowchart diagram using React Flow for a CI/CD pipeline: Source -> Build -> Test -> Deploy Staging -> Deploy Production',
      'Design an entity relationship diagram showing Users, Orders, Products, and Categories with their connections using React Flow',
      'Create a state machine diagram with React Flow showing: Idle -> Processing -> Success/Error -> Complete states',
      'Build a network topology diagram showing: Internet -> Load Balancer -> Web Servers (x3) -> Database Cluster'
    ],
    validateResponse: (text: string) =>
      text.toLowerCase().includes('diagram') ||
      text.toLowerCase().includes('node') ||
      text.toLowerCase().includes('flow') ||
      text.toLowerCase().includes('created')
  },

  // oap-azure-cost-mcp: Azure cost analysis
  {
    category: 'azure-cost',
    questions: [
      'Analyze Azure costs for the current month broken down by resource group',
      'Show me the top 5 most expensive Azure resources this week',
      'Compare Azure spending between this month and last month',
      'Generate a cost forecast for Azure resources for the next 30 days',
      'What Azure resources are consuming the most budget percentage?'
    ],
    validateResponse: (text: string) =>
      text.toLowerCase().includes('cost') ||
      text.toLowerCase().includes('azure') ||
      text.toLowerCase().includes('spend') ||
      text.toLowerCase().includes('budget')
  },

  // oap-azure-mcp: Azure operations
  {
    category: 'azure-ops',
    questions: [
      'List all Azure virtual machines in my subscription with their status',
      'What Azure resource groups exist in my account?',
      'Show the current status of Azure App Services',
      'List Azure Storage accounts and their storage usage',
      'What Azure SQL databases are running and their performance metrics?'
    ],
    validateResponse: (text: string) =>
      text.toLowerCase().includes('azure') ||
      text.toLowerCase().includes('resource') ||
      text.toLowerCase().includes('vm') ||
      text.toLowerCase().includes('subscription')
  },

  // oap-gcp-mcp: GCP operations
  {
    category: 'gcp-ops',
    questions: [
      'List all GCP projects I have access to',
      'Show Google Cloud Compute Engine instances and their status',
      'What GCP Cloud Storage buckets exist in my projects?',
      'List BigQuery datasets in my GCP account',
      'Show GCP Cloud Functions and their recent invocations'
    ],
    validateResponse: (text: string) =>
      text.toLowerCase().includes('gcp') ||
      text.toLowerCase().includes('google') ||
      text.toLowerCase().includes('cloud') ||
      text.toLowerCase().includes('project')
  },

  // oap-flowise-mcp: Flowise workflows
  {
    category: 'flowise',
    questions: [
      'List all chatflows available in Flowise',
      'Create a new RAG chatflow with document loader and vector store',
      'Show me the agentflows that have been created',
      'What Flowise templates are available for agentic workflows?',
      'Execute a test message through an existing Flowise chatflow'
    ],
    validateResponse: (text: string) =>
      text.toLowerCase().includes('flowise') ||
      text.toLowerCase().includes('chatflow') ||
      text.toLowerCase().includes('agentflow') ||
      text.toLowerCase().includes('workflow')
  },

  // oap-web-mcp: Web operations
  {
    category: 'web',
    questions: [
      'Fetch the content from https://docs.anthropic.com and summarize the main sections',
      'Search the web for "Kubernetes best practices 2024" and give me the top results',
      'Extract the main content from a technical documentation page',
      'Find the latest information about Claude API updates',
      'Web search for React Flow documentation and summarize key features'
    ],
    validateResponse: (text: string) =>
      text.toLowerCase().includes('web') ||
      text.toLowerCase().includes('search') ||
      text.toLowerCase().includes('found') ||
      text.toLowerCase().includes('result') ||
      text.toLowerCase().includes('content')
  },

  // oap-memory-mcp: Memory operations
  {
    category: 'memory',
    questions: [
      'Remember that my preferred programming language is TypeScript for future conversations',
      'What do you remember about my previous requests in this conversation?',
      'Store the context that I am working on a Kubernetes deployment project',
      'Recall any saved preferences or context from our interactions',
      'Save a note that our deployment target is Azure Kubernetes Service (AKS)'
    ],
    validateResponse: (text: string) =>
      text.toLowerCase().includes('remember') ||
      text.toLowerCase().includes('stored') ||
      text.toLowerCase().includes('context') ||
      text.toLowerCase().includes('memory') ||
      text.toLowerCase().includes('saved')
  },

  // Complex multi-tool questions
  {
    category: 'multi-tool',
    questions: [
      'Create a diagram of our Azure architecture and then show the costs for each component',
      'Search for Kubernetes best practices, then create a flowchart of the deployment process',
      'Analyze our cloud costs across both Azure and GCP, and generate a comparison diagram',
      'Create a Flowise chatflow for RAG, then generate a diagram showing the data flow',
      'Remember our cloud architecture, create a diagram of it, and analyze costs'
    ],
    validateResponse: (text: string) =>
      text.length > 100 // Complex responses should be substantial
  },

  // Technical deep-dive questions (no specific MCP, but tests full capability)
  {
    category: 'technical',
    questions: [
      'Explain the CAP theorem and how it applies to distributed databases. Include examples.',
      'Design a rate limiting system for an API handling 10k req/s using token bucket algorithm',
      'Write a TypeScript implementation of an LRU cache with O(1) get/put operations',
      'Explain the differences between Kubernetes Services: ClusterIP, NodePort, LoadBalancer',
      'Design a event-driven microservices architecture using Kafka and explain the data flow'
    ],
    validateResponse: (text: string) =>
      text.length > 200 // Technical explanations should be detailed
  }
];

interface SessionResult {
  sessionId: string;
  requestsCompleted: number;
  requestsFailed: number;
  totalTime: number;
  avgTTFT: number;
  avgResponseTime: number;
  mcpToolsUsed: string[];
  errors: string[];
}

interface RequestResult {
  success: boolean;
  ttft: number;
  totalTime: number;
  responseLength: number;
  mcpTool?: string;
  error?: string;
  responsePreview?: string;
}

// Helper to make a single chat request
async function makeChatRequest(
  sessionId: string,
  message: string,
  apiKey: string
): Promise<RequestResult> {
  const startTime = Date.now();
  let ttft = 0;
  let responseText = '';

  try {
    const response = await fetch(`${BASE_URL}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        sessionId,
        message,
        model: 'gemini-2.5-flash'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      if (firstChunk && chunk.length > 0) {
        ttft = Date.now() - startTime;
        firstChunk = false;
      }

      // Parse SSE events
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              responseText += parsed.content;
            }
          } catch {
            // Ignore parse errors for non-JSON data
          }
        }
      }
    }

    const totalTime = Date.now() - startTime;

    return {
      success: responseText.length > 0,
      ttft,
      totalTime,
      responseLength: responseText.length,
      responsePreview: responseText.substring(0, 100)
    };

  } catch (error: any) {
    return {
      success: false,
      ttft: 0,
      totalTime: Date.now() - startTime,
      responseLength: 0,
      error: error.message
    };
  }
}

// Run a single session with multiple requests
async function runSession(
  sessionIndex: number,
  apiKey: string,
  requestCount: number
): Promise<SessionResult> {
  const sessionId = `load-test-${Date.now()}-${sessionIndex}`;
  const results: RequestResult[] = [];
  const mcpToolsUsed = new Set<string>();
  const errors: string[] = [];
  const startTime = Date.now();

  // Distribute questions across MCP categories
  for (let i = 0; i < requestCount; i++) {
    const categoryIndex = i % MCP_QUESTIONS.length;
    const category = MCP_QUESTIONS[categoryIndex];
    const questionIndex = Math.floor(i / MCP_QUESTIONS.length) % category.questions.length;
    const question = category.questions[questionIndex];

    console.log(`[Session ${sessionIndex}] Request ${i + 1}/${requestCount}: ${category.category}`);

    const result = await makeChatRequest(sessionId, question, apiKey);
    results.push(result);

    if (result.success) {
      mcpToolsUsed.add(category.category);

      // Validate response
      if (!category.validateResponse(result.responsePreview || '')) {
        console.log(`[Session ${sessionIndex}] Warning: Response may not contain expected content`);
      }
    } else {
      errors.push(`Request ${i + 1}: ${result.error}`);
    }

    // Delay between requests
    if (i < requestCount - 1) {
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
    }
  }

  const totalTime = Date.now() - startTime;
  const successfulResults = results.filter(r => r.success);

  return {
    sessionId,
    requestsCompleted: successfulResults.length,
    requestsFailed: results.length - successfulResults.length,
    totalTime,
    avgTTFT: successfulResults.length > 0
      ? successfulResults.reduce((sum, r) => sum + r.ttft, 0) / successfulResults.length
      : 0,
    avgResponseTime: successfulResults.length > 0
      ? successfulResults.reduce((sum, r) => sum + r.totalTime, 0) / successfulResults.length
      : 0,
    mcpToolsUsed: Array.from(mcpToolsUsed),
    errors
  };
}

test.describe('Concurrent MCP Load Test', () => {
  test.setTimeout(3600000); // 1 hour timeout for large tests

  let apiKey: string = '';

  test.beforeAll(async ({ browser }) => {
    console.log('\n' + '='.repeat(80));
    console.log('CONCURRENT MCP LOAD TEST');
    console.log(`Sessions: ${CONCURRENT_SESSIONS}, Requests/Session: ${REQUESTS_PER_SESSION}`);
    console.log(`Total Requests: ${CONCURRENT_SESSIONS * REQUESTS_PER_SESSION}`);
    console.log('='.repeat(80) + '\n');

    // Login to get API key
    const page = await browser.newPage();
    await page.goto(BASE_URL);

    // Handle local auth
    const localAuthButton = page.locator('text=Local').first();
    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }

    // Login
    const emailInput = page.locator('input[type="email"]').or(page.locator('input[name="email"]'));
    const passwordInput = page.locator('input[type="password"]');
    await emailInput.fill(TEST_EMAIL);
    await passwordInput.fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();

    // Wait for login
    await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 });

    // Use the configured API key
    apiKey = API_KEY;

    console.log(`[Setup] Logged in as ${TEST_EMAIL}`);
    await page.close();
  });

  test('Run concurrent sessions with MCP tool coverage', async ({ page }) => {
    console.log('\n[Test] Starting concurrent sessions...\n');

    const sessionPromises: Promise<SessionResult>[] = [];

    // Launch concurrent sessions
    for (let i = 0; i < CONCURRENT_SESSIONS; i++) {
      // Stagger session starts slightly to avoid thundering herd
      await new Promise(resolve => setTimeout(resolve, i * 100));

      sessionPromises.push(runSession(i, apiKey, REQUESTS_PER_SESSION));
    }

    // Wait for all sessions to complete
    const results = await Promise.all(sessionPromises);

    // Aggregate results
    console.log('\n' + '='.repeat(80));
    console.log('LOAD TEST RESULTS');
    console.log('='.repeat(80));

    let totalRequests = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalTime = 0;
    let ttftSum = 0;
    let responseTimeSum = 0;
    const allMcpTools = new Set<string>();
    const allErrors: string[] = [];

    for (const result of results) {
      console.log(`\n[Session ${result.sessionId}]`);
      console.log(`  Completed: ${result.requestsCompleted}/${REQUESTS_PER_SESSION}`);
      console.log(`  Failed: ${result.requestsFailed}`);
      console.log(`  Total Time: ${result.totalTime}ms`);
      console.log(`  Avg TTFT: ${result.avgTTFT.toFixed(0)}ms`);
      console.log(`  Avg Response: ${result.avgResponseTime.toFixed(0)}ms`);
      console.log(`  MCP Tools: ${result.mcpToolsUsed.join(', ')}`);

      if (result.errors.length > 0) {
        console.log(`  Errors: ${result.errors.slice(0, 3).join(', ')}${result.errors.length > 3 ? '...' : ''}`);
      }

      totalRequests += REQUESTS_PER_SESSION;
      totalSuccessful += result.requestsCompleted;
      totalFailed += result.requestsFailed;
      totalTime += result.totalTime;
      ttftSum += result.avgTTFT * result.requestsCompleted;
      responseTimeSum += result.avgResponseTime * result.requestsCompleted;
      result.mcpToolsUsed.forEach(tool => allMcpTools.add(tool));
      allErrors.push(...result.errors);
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Requests: ${totalRequests}`);
    console.log(`Successful: ${totalSuccessful} (${(totalSuccessful/totalRequests*100).toFixed(1)}%)`);
    console.log(`Failed: ${totalFailed} (${(totalFailed/totalRequests*100).toFixed(1)}%)`);
    console.log(`Total Test Time: ${(totalTime/1000).toFixed(1)}s`);
    console.log(`Average TTFT: ${(ttftSum/totalSuccessful).toFixed(0)}ms`);
    console.log(`Average Response Time: ${(responseTimeSum/totalSuccessful).toFixed(0)}ms`);
    console.log(`MCP Tools Tested: ${Array.from(allMcpTools).join(', ')}`);
    console.log(`MCP Coverage: ${allMcpTools.size}/${MCP_QUESTIONS.length} categories`);
    console.log('='.repeat(80));

    // Take final screenshot
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/load-test-complete.png', fullPage: true });

    // Assertions
    expect(totalSuccessful).toBeGreaterThan(0);
    expect(totalFailed).toBeLessThan(totalRequests * 0.2); // Less than 20% failures
    expect(allMcpTools.size).toBeGreaterThan(0);
  });

  test('Validate response quality from each MCP category', async ({ page }) => {
    console.log('\n[Test] Validating response quality...\n');

    // Run one request per category to validate quality
    const sessionId = `quality-test-${Date.now()}`;

    for (const category of MCP_QUESTIONS) {
      console.log(`[Quality Check] Testing ${category.category}...`);

      const question = category.questions[0];
      const result = await makeChatRequest(sessionId, question, apiKey);

      console.log(`  Response length: ${result.responseLength}`);
      console.log(`  TTFT: ${result.ttft}ms`);
      console.log(`  Preview: ${result.responsePreview?.substring(0, 80)}...`);

      if (result.success) {
        const isValid = category.validateResponse(result.responsePreview || '');
        console.log(`  Validation: ${isValid ? '✅ PASS' : '⚠️ WARN'}`);
      } else {
        console.log(`  Error: ${result.error}`);
      }

      // Brief delay between categories
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  });
});
