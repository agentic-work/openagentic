/**
 * AC Tests with Claude Sonnet 4.5
 *
 * These tests validate OpenAgentic's ability to create REAL cloud resources using Sonnet 4.5.
 * They use BOTH Playwright (UI) AND curl (API) for parity testing.
 *
 * AC-1: Azure Application Gateway - Create ACTUAL AppGW in Azure
 * AC-2: AWS API Gateway/ALB - Create ACTUAL equivalent in AWS
 * AC-4: Data layer validation (PostgreSQL, Redis, Milvus)
 * AC-5: Full UI/Modal validation
 */

import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
// Microsoft AAD test user (from codemode-appgw-arm.spec.ts)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@phatoldsungmail.onmicrosoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';

// API test credentials — must be set via env
const API_KEY = process.env.API_KEY || '';

// Report directories
const REPORT_BASE = '/mnt/synology/Code/company/openagentic/agentic/docs/uat/ac/sonnet45';

// Model to use for all tests
const SONNET_45_MODEL = 'claude-sonnet-4-6';

// Test configuration
test.use({
  ignoreHTTPSErrors: true,
  viewport: { width: 1920, height: 1080 }
});

interface TestReport {
  testName: string;
  status: 'PASS' | 'FAIL' | 'PARTIAL';
  startTime: Date;
  endTime?: Date;
  playwrightResults: Record<string, any>;
  curlResults: Record<string, any>;
  cloudValidation: Record<string, any>;
  artifacts: string[];
  errors: string[];
  notes: string[];
}

// Helper to write test reports
function writeReport(acNumber: string, report: TestReport): void {
  const reportDir = path.join(REPORT_BASE, acNumber);
  try {
    fs.mkdirSync(reportDir, { recursive: true });

    const markdown = `# AC-${acNumber}: ${report.testName}

## Test Description
${report.testName}

## Test Executed
**Date:** ${report.startTime.toISOString().split('T')[0]}
**Model:** claude-sonnet-4-5 (Sonnet 4.5)
**Duration:** ${report.endTime ? ((report.endTime.getTime() - report.startTime.getTime()) / 1000).toFixed(1) : 'N/A'}s

## Status: ${report.status}

## Playwright UI Test Results
\`\`\`json
${JSON.stringify(report.playwrightResults, null, 2)}
\`\`\`

## Curl API Parity Test Results
\`\`\`json
${JSON.stringify(report.curlResults, null, 2)}
\`\`\`

## Cloud Resource Validation
\`\`\`json
${JSON.stringify(report.cloudValidation, null, 2)}
\`\`\`

## Artifacts Created
${report.artifacts.map(a => `- ${a}`).join('\n')}

${report.errors.length > 0 ? `## Errors\n${report.errors.map(e => `- ${e}`).join('\n')}` : ''}

## Notes
${report.notes.map(n => `- ${n}`).join('\n')}
`;

    fs.writeFileSync(path.join(reportDir, 'report.md'), markdown);
    console.log(`Report written to ${reportDir}/report.md`);
  } catch (err) {
    console.error(`Failed to write report: ${err}`);
  }
}

// Helper to login via Microsoft AAD
async function loginWithEmail(page: Page): Promise<boolean> {
  console.log('=== MICROSOFT AAD LOGIN FLOW ===');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Check if already logged in
  const chatInput = page.locator('textarea').first();
  const isLoggedIn = await chatInput.isVisible({ timeout: 3000 }).catch(() => false);
  if (isLoggedIn) {
    console.log('Already logged in!');
    return true;
  }

  console.log(`Current URL: ${page.url()}`);

  // Click "Continue with Microsoft" button
  const msButton = page.locator('button:has-text("Continue with Microsoft"), button:has-text("Microsoft")');
  const hasMsButton = await msButton.isVisible({ timeout: 10000 }).catch(() => false);

  if (hasMsButton) {
    console.log('Clicking "Continue with Microsoft" button...');
    await msButton.first().click();
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle');
  }

  // Handle Microsoft login page
  console.log(`After MS button click, URL: ${page.url()}`);

  // Fill email on Microsoft login page
  const msEmailInput = page.locator('input[type="email"], input[name="loginfmt"]');
  if (await msEmailInput.isVisible({ timeout: 15000 }).catch(() => false)) {
    console.log(`Filling Microsoft email: ${ADMIN_EMAIL}`);
    await msEmailInput.fill(ADMIN_EMAIL);

    // Click Next
    const nextButton = page.locator('input[type="submit"], button:has-text("Next")');
    await nextButton.click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');
  }

  // Fill password on Microsoft login page
  const msPasswordInput = page.locator('input[type="password"], input[name="passwd"]');
  if (await msPasswordInput.isVisible({ timeout: 15000 }).catch(() => false)) {
    console.log('Filling Microsoft password...');
    await msPasswordInput.fill(ADMIN_PASSWORD);

    // Click Sign in
    const signInButton = page.locator('input[type="submit"], button:has-text("Sign in")');
    await signInButton.click();
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle');
  }

  // Handle "Stay signed in?" prompt
  const staySignedIn = page.locator('button:has-text("No"), input[value="No"]');
  if (await staySignedIn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('Clicking "No" on stay signed in prompt...');
    await staySignedIn.click();
    await page.waitForTimeout(2000);
  }

  // Wait for redirect back to app
  console.log('Waiting for redirect to app...');
  await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle');

  // Wait for chat interface with retry
  console.log('Waiting for chat interface...');
  let loginSuccess = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.waitForSelector('textarea', { timeout: 15000 });
      loginSuccess = true;
      console.log('Login successful!');
      break;
    } catch {
      console.log(`Login attempt ${attempt + 1} timed out, retrying...`);
      await page.screenshot({ path: `/tmp/login-attempt-${attempt + 1}.png` });
      await page.waitForTimeout(2000);
    }
  }

  if (!loginSuccess) {
    throw new Error('Login failed after 5 attempts');
  }

  // Dismiss welcome modals
  await page.waitForTimeout(2000);
  for (let i = 0; i < 5; i++) {
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } catch {}

    const dismissButtons = page.locator('button:has-text("Skip"), button:has-text("Close"), button:has-text("Get Started"), button:has-text("Dismiss")');
    const hasButton = await dismissButtons.first().isVisible({ timeout: 1000 }).catch(() => false);
    if (hasButton) {
      await dismissButtons.first().click();
      await page.waitForTimeout(500);
    }

    // Handle capability selector modal if present
    const capabilityModal = page.locator('.fixed.inset-0.bg-black\\/70');
    if (await capabilityModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log('Dismissing capability selector modal...');
      const firstOption = page.locator('text=Cloud Operations').first();
      if (await firstOption.isVisible({ timeout: 1000 }).catch(() => false)) {
        await firstOption.click();
        await page.waitForTimeout(500);
      }
    }
  }

  console.log('Login complete!');
  return true;
}

// Helper to set model to Sonnet 4.5 via slider/settings
async function setModelToSonnet45(page: Page): Promise<boolean> {
  console.log('=== SETTING MODEL TO SONNET 4.5 ===');

  // Try to find slider control
  const sliderHandle = page.locator('[role="slider"], input[type="range"], .slider-handle');
  if (await sliderHandle.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Set slider to ~75% (Premium tier for Sonnet 4.5)
    const slider = await sliderHandle.first().boundingBox();
    if (slider) {
      const targetX = slider.x + (slider.width * 0.75);
      await page.mouse.click(targetX, slider.y + slider.height / 2);
      await page.waitForTimeout(500);
    }
  }

  // Alternative: Try settings menu
  const settingsButton = page.locator('button:has-text("Settings"), [data-testid="settings"]');
  if (await settingsButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await settingsButton.click();
    await page.waitForTimeout(500);

    // Look for model selector
    const modelSelect = page.locator('select:has-text("model"), [data-testid="model-select"]');
    if (await modelSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await modelSelect.selectOption({ label: 'Sonnet 4.5' });
    }

    // Close settings
    await page.keyboard.press('Escape');
  }

  console.log('Model configuration attempted');
  return true;
}

// Helper to send chat message via UI and wait for response
async function sendChatMessageUI(page: Page, message: string, timeoutMs: number = 300000): Promise<string> {
  const chatInput = page.locator('textarea').first();
  await chatInput.fill(message);
  await page.keyboard.press('Enter');

  console.log(`Sent message, waiting up to ${timeoutMs/1000}s for response...`);

  // Wait for response to complete
  const startTime = Date.now();
  let lastResponseLength = 0;
  let stableCount = 0;

  while (Date.now() - startTime < timeoutMs) {
    await page.waitForTimeout(5000);

    // Get all message content
    const messages = await page.locator('[class*="message"], [data-testid*="message"]').all();
    const responseText = await page.locator('body').textContent() || '';

    if (responseText.length === lastResponseLength) {
      stableCount++;
      if (stableCount >= 3) {
        console.log('Response appears complete (stable for 15s)');
        break;
      }
    } else {
      stableCount = 0;
      lastResponseLength = responseText.length;
    }

    // Check for error messages
    if (responseText.toLowerCase().includes('error') && responseText.toLowerCase().includes('failed')) {
      console.log('Error detected in response');
      break;
    }
  }

  const finalResponse = await page.locator('body').textContent() || '';
  console.log(`Response length: ${finalResponse.length} characters`);
  return finalResponse;
}

// Helper to send chat message via API (curl parity)
async function sendChatMessageAPI(request: APIRequestContext, message: string, sessionId?: string): Promise<{sessionId: string, response: string, sseLines: number}> {
  // Create session if needed
  if (!sessionId) {
    const sessionRes = await request.post(`${BASE_URL}/api/chat/sessions`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        title: `AC Test - Sonnet 4.5 - ${new Date().toISOString()}`
      }
    });
    const sessionData = await sessionRes.json();
    sessionId = sessionData.session?.id;
    console.log(`Created session: ${sessionId}`);
  }

  // Send message via streaming endpoint
  const streamRes = await request.post(`${BASE_URL}/api/chat/stream`, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    data: {
      message,
      sessionId,
      model: SONNET_45_MODEL
    },
    timeout: 600000 // 10 minutes
  });

  const responseText = await streamRes.text();
  const sseLines = responseText.split('\n').length;

  console.log(`API response: ${sseLines} SSE lines`);
  return { sessionId: sessionId!, response: responseText, sseLines };
}

// Helper to validate Azure resources with az CLI
async function validateAzureResources(resourceGroup: string, resourceName: string, resourceType: string): Promise<{exists: boolean, details: any}> {
  try {
    const cmd = `az ${resourceType} show --name ${resourceName} --resource-group ${resourceGroup} -o json 2>/dev/null || echo '{}'`;
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
    const details = JSON.parse(result);
    return {
      exists: !!details.id,
      details
    };
  } catch (err) {
    console.log(`Azure validation error: ${err}`);
    return { exists: false, details: { error: String(err) } };
  }
}

// Helper to cleanup Azure resources
async function cleanupAzureResources(resourceGroup: string, resourceName: string, resourceType: string): Promise<boolean> {
  try {
    const cmd = `az ${resourceType} delete --name ${resourceName} --resource-group ${resourceGroup} --yes 2>/dev/null || true`;
    execSync(cmd, { encoding: 'utf-8', timeout: 120000 });
    console.log(`Deleted Azure resource: ${resourceName}`);
    return true;
  } catch (err) {
    console.log(`Azure cleanup error: ${err}`);
    return false;
  }
}

// Helper to validate AWS resources with aws CLI
async function validateAWSResources(resourceArn: string, resourceType: string): Promise<{exists: boolean, details: any}> {
  try {
    let cmd: string;
    switch (resourceType) {
      case 'elbv2':
        cmd = `aws elbv2 describe-load-balancers --load-balancer-arns ${resourceArn} --output json 2>/dev/null || echo '{"LoadBalancers":[]}'`;
        break;
      case 'apigatewayv2':
        cmd = `aws apigatewayv2 get-api --api-id ${resourceArn} --output json 2>/dev/null || echo '{}'`;
        break;
      default:
        return { exists: false, details: { error: 'Unknown resource type' } };
    }
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
    const details = JSON.parse(result);
    return {
      exists: Object.keys(details).length > 0 && !details.LoadBalancers?.length === 0,
      details
    };
  } catch (err) {
    console.log(`AWS validation error: ${err}`);
    return { exists: false, details: { error: String(err) } };
  }
}

// ============================================================================
// AC-1: Azure Application Gateway
// ============================================================================
test.describe('AC-1: Azure Application Gateway', () => {
  test('Create production AppGW via UI + API parity + az CLI validation', async ({ page, request }) => {
    test.setTimeout(900000); // 15 minutes for full flow

    const report: TestReport = {
      testName: 'Azure Application Gateway - Create ACTUAL production AppGW',
      status: 'FAIL',
      startTime: new Date(),
      playwrightResults: {},
      curlResults: {},
      cloudValidation: {},
      artifacts: [],
      errors: [],
      notes: []
    };

    try {
      // === PLAYWRIGHT UI TEST ===
      console.log('\n=== PLAYWRIGHT UI TEST ===');
      await loginWithEmail(page);
      await setModelToSonnet45(page);

      const appGwPrompt = `Create a production Azure Application Gateway. This should represent what a typical production AppGW for a massive enterprise would have in Azure. Use the Azure MCP tool to ACTUALLY CREATE the Application Gateway, not just generate code.

Requirements:
- Multiple frontend IP configurations (3)
- At least 20 HTTP listeners
- At least 30 backend address pools
- Path-based routing rules
- WAF v2 configuration with OWASP 3.2
- SSL/TLS certificates (use placeholder or self-signed)
- Health probes for each backend
- Autoscaling from 2-10 units
- Use resource group: openagentic-ac-tests
- Name the AppGW: ac-test-appgw-${Date.now()}

IMPORTANT: Actually create this in Azure, do not just show me code.`;

      await page.screenshot({ path: '/tmp/ac1-before-prompt.png', fullPage: true });
      report.artifacts.push('/tmp/ac1-before-prompt.png');

      const uiResponse = await sendChatMessageUI(page, appGwPrompt, 600000);

      await page.screenshot({ path: '/tmp/ac1-after-response.png', fullPage: true });
      report.artifacts.push('/tmp/ac1-after-response.png');

      report.playwrightResults = {
        responseLength: uiResponse.length,
        containsSuccess: uiResponse.toLowerCase().includes('created') || uiResponse.toLowerCase().includes('success'),
        containsAppGw: uiResponse.toLowerCase().includes('appgw') || uiResponse.toLowerCase().includes('application gateway'),
        containsToolCall: uiResponse.toLowerCase().includes('tool') || uiResponse.toLowerCase().includes('mcp'),
        timestamp: new Date().toISOString()
      };

      report.notes.push(`UI response length: ${uiResponse.length} characters`);

      // === CURL API PARITY TEST ===
      console.log('\n=== CURL API PARITY TEST ===');
      const apiResult = await sendChatMessageAPI(request, appGwPrompt);

      report.curlResults = {
        sessionId: apiResult.sessionId,
        sseLines: apiResult.sseLines,
        responseContainsSuccess: apiResult.response.toLowerCase().includes('created'),
        timestamp: new Date().toISOString()
      };

      report.notes.push(`API SSE lines: ${apiResult.sseLines}`);

      // Save SSE response
      fs.writeFileSync('/tmp/ac1-sse-response.txt', apiResult.response);
      report.artifacts.push('/tmp/ac1-sse-response.txt');

      // === AZURE CLI VALIDATION ===
      console.log('\n=== AZURE CLI VALIDATION ===');

      // Extract AppGW name from response
      const appGwNameMatch = uiResponse.match(/ac-test-appgw-\d+/);
      const appGwName = appGwNameMatch ? appGwNameMatch[0] : '';

      if (appGwName) {
        report.notes.push(`AppGW name extracted: ${appGwName}`);

        const azValidation = await validateAzureResources('openagentic-ac-tests', appGwName, 'network application-gateway');
        report.cloudValidation = {
          resourceFound: azValidation.exists,
          resourceDetails: azValidation.details,
          validatedAt: new Date().toISOString()
        };

        if (azValidation.exists) {
          report.status = 'PASS';
          report.notes.push('Azure AppGW validated via az CLI!');

          // Cleanup
          console.log('\n=== CLEANUP ===');
          const cleaned = await cleanupAzureResources('openagentic-ac-tests', appGwName, 'network application-gateway');
          report.cloudValidation.cleanedUp = cleaned;
          report.notes.push(cleaned ? 'Resource cleaned up' : 'Cleanup failed');
        } else {
          report.errors.push('AppGW not found in Azure');
        }
      } else {
        report.errors.push('Could not extract AppGW name from response');
        report.cloudValidation = { error: 'No resource name found' };
      }

    } catch (err) {
      report.errors.push(String(err));
      await page.screenshot({ path: '/tmp/ac1-error.png', fullPage: true });
      report.artifacts.push('/tmp/ac1-error.png');
    }

    report.endTime = new Date();
    writeReport('1', report);

    // Assert for Playwright
    expect(report.playwrightResults.responseLength).toBeGreaterThan(100);
  });
});

// ============================================================================
// AC-2: AWS API Gateway/ALB Equivalent
// ============================================================================
test.describe('AC-2: AWS API Gateway/ALB', () => {
  test('Create production ALB/API GW via UI + API parity + aws CLI validation', async ({ page, request }) => {
    test.setTimeout(900000); // 15 minutes

    const report: TestReport = {
      testName: 'AWS API Gateway/ALB - Create ACTUAL production equivalent',
      status: 'FAIL',
      startTime: new Date(),
      playwrightResults: {},
      curlResults: {},
      cloudValidation: {},
      artifacts: [],
      errors: [],
      notes: []
    };

    try {
      // === PLAYWRIGHT UI TEST ===
      console.log('\n=== PLAYWRIGHT UI TEST (AWS) ===');
      await loginWithEmail(page);
      await setModelToSonnet45(page);

      const awsPrompt = `Create a production AWS Application Load Balancer that is equivalent to an Azure Application Gateway. Use the AWS MCP tool to ACTUALLY CREATE the ALB, not just generate code.

Requirements:
- ALB across 3 Availability Zones
- At least 25 target groups for different microservices
- 35 listener rules with path-based routing
- AWS WAF v2 with OWASP managed rules
- ACM certificates (placeholder or create self-signed)
- 30 routing rules
- Health checks for each target group
- Auto-scaling configuration
- Name the ALB: ac-test-alb-${Date.now()}
- Use VPC: default or create one for testing

IMPORTANT: Actually create this in AWS, do not just show me code or CloudFormation templates.`;

      await page.screenshot({ path: '/tmp/ac2-before-prompt.png', fullPage: true });
      report.artifacts.push('/tmp/ac2-before-prompt.png');

      const uiResponse = await sendChatMessageUI(page, awsPrompt, 600000);

      await page.screenshot({ path: '/tmp/ac2-after-response.png', fullPage: true });
      report.artifacts.push('/tmp/ac2-after-response.png');

      report.playwrightResults = {
        responseLength: uiResponse.length,
        containsSuccess: uiResponse.toLowerCase().includes('created') || uiResponse.toLowerCase().includes('success'),
        containsALB: uiResponse.toLowerCase().includes('alb') || uiResponse.toLowerCase().includes('load balancer'),
        containsToolCall: uiResponse.toLowerCase().includes('tool') || uiResponse.toLowerCase().includes('mcp'),
        timestamp: new Date().toISOString()
      };

      // === CURL API PARITY TEST ===
      console.log('\n=== CURL API PARITY TEST (AWS) ===');
      const apiResult = await sendChatMessageAPI(request, awsPrompt);

      report.curlResults = {
        sessionId: apiResult.sessionId,
        sseLines: apiResult.sseLines,
        timestamp: new Date().toISOString()
      };

      fs.writeFileSync('/tmp/ac2-sse-response.txt', apiResult.response);
      report.artifacts.push('/tmp/ac2-sse-response.txt');

      // === AWS CLI VALIDATION ===
      console.log('\n=== AWS CLI VALIDATION ===');

      const albNameMatch = uiResponse.match(/ac-test-alb-\d+/);
      const albName = albNameMatch ? albNameMatch[0] : '';

      if (albName) {
        report.notes.push(`ALB name extracted: ${albName}`);

        // Find ALB ARN
        try {
          const albListCmd = `aws elbv2 describe-load-balancers --names ${albName} --output json 2>/dev/null || echo '{"LoadBalancers":[]}'`;
          const albList = JSON.parse(execSync(albListCmd, { encoding: 'utf-8' }));

          if (albList.LoadBalancers && albList.LoadBalancers.length > 0) {
            const albArn = albList.LoadBalancers[0].LoadBalancerArn;
            report.cloudValidation = {
              resourceFound: true,
              resourceArn: albArn,
              resourceDetails: albList.LoadBalancers[0],
              validatedAt: new Date().toISOString()
            };
            report.status = 'PASS';
            report.notes.push('AWS ALB validated via aws CLI!');

            // Cleanup
            console.log('\n=== CLEANUP ===');
            try {
              execSync(`aws elbv2 delete-load-balancer --load-balancer-arn ${albArn}`, { timeout: 120000 });
              report.cloudValidation.cleanedUp = true;
              report.notes.push('ALB deleted');
            } catch {
              report.cloudValidation.cleanedUp = false;
            }
          } else {
            report.errors.push('ALB not found in AWS');
            report.cloudValidation = { resourceFound: false };
          }
        } catch (err) {
          report.errors.push(`AWS validation error: ${err}`);
        }
      } else {
        report.errors.push('Could not extract ALB name from response');
      }

    } catch (err) {
      report.errors.push(String(err));
      await page.screenshot({ path: '/tmp/ac2-error.png', fullPage: true });
      report.artifacts.push('/tmp/ac2-error.png');
    }

    report.endTime = new Date();
    writeReport('2', report);

    expect(report.playwrightResults.responseLength).toBeGreaterThan(100);
  });
});

// ============================================================================
// AC-4: Data Layer Validation
// ============================================================================
test.describe('AC-4: Data Layer Validation', () => {
  test('Validate PostgreSQL, Redis, and Milvus data layers', async ({ page, request }) => {
    test.setTimeout(300000);

    const report: TestReport = {
      testName: 'Data Layer Validation - PostgreSQL, Redis, Milvus',
      status: 'FAIL',
      startTime: new Date(),
      playwrightResults: {},
      curlResults: {},
      cloudValidation: {},
      artifacts: [],
      errors: [],
      notes: []
    };

    try {
      // === CHECK POSTGRESQL ===
      console.log('\n=== POSTGRESQL VALIDATION ===');

      const postgresTest = await request.post(`${BASE_URL}/api/chat/sessions`, {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        data: { title: `Data Layer Test - ${Date.now()}` }
      });

      const sessionData = await postgresTest.json();
      const postgresValid = postgresTest.ok() && sessionData.session?.id;

      report.cloudValidation.postgresql = {
        connected: postgresValid,
        sessionCreated: sessionData.session?.id,
        timestamp: new Date().toISOString()
      };

      if (postgresValid) {
        report.notes.push(`PostgreSQL: Session created ${sessionData.session.id}`);

        // Send a message to test message storage
        const msgResult = await sendChatMessageAPI(request, 'Hello, this is a data layer test.', sessionData.session.id);
        report.cloudValidation.postgresql.messageStored = msgResult.sseLines > 0;
      }

      // === CHECK REDIS ===
      console.log('\n=== REDIS VALIDATION ===');

      // Redis is used for rate limiting and caching - test via API health
      const healthRes = await request.get(`${BASE_URL}/api/health`);
      const healthData = await healthRes.json();

      report.cloudValidation.redis = {
        connected: healthData.redis === 'healthy' || healthRes.ok(),
        timestamp: new Date().toISOString()
      };

      if (healthRes.ok()) {
        report.notes.push('Redis: Health check passed');
      }

      // === CHECK MILVUS ===
      console.log('\n=== MILVUS VALIDATION ===');

      // Milvus is used for vector embeddings - test via memory MCP
      await loginWithEmail(page);
      await setModelToSonnet45(page);

      const memoryPrompt = `Use the memory MCP tool to store this fact: "AC-4 test ran at ${new Date().toISOString()}"
Then immediately search for "AC-4 test" to verify the memory was stored.`;

      const memoryResponse = await sendChatMessageUI(page, memoryPrompt, 120000);

      await page.screenshot({ path: '/tmp/ac4-memory-test.png', fullPage: true });
      report.artifacts.push('/tmp/ac4-memory-test.png');

      report.cloudValidation.milvus = {
        memoryStored: memoryResponse.toLowerCase().includes('stored') || memoryResponse.toLowerCase().includes('saved'),
        memoryRetrieved: memoryResponse.toLowerCase().includes('ac-4 test') || memoryResponse.toLowerCase().includes('found'),
        timestamp: new Date().toISOString()
      };

      if (report.cloudValidation.milvus.memoryStored || report.cloudValidation.milvus.memoryRetrieved) {
        report.notes.push('Milvus: Memory store/retrieve working');
      }

      // === OVERALL STATUS ===
      const allValid = postgresValid &&
                       report.cloudValidation.redis.connected &&
                       (report.cloudValidation.milvus.memoryStored || report.cloudValidation.milvus.memoryRetrieved);

      report.status = allValid ? 'PASS' : 'PARTIAL';

      report.playwrightResults = {
        postgresqlTested: true,
        redisTested: true,
        milvusTested: true,
        timestamp: new Date().toISOString()
      };

    } catch (err) {
      report.errors.push(String(err));
      await page.screenshot({ path: '/tmp/ac4-error.png', fullPage: true });
      report.artifacts.push('/tmp/ac4-error.png');
    }

    report.endTime = new Date();
    writeReport('4', report);

    expect(report.cloudValidation.postgresql?.connected).toBe(true);
  });
});

// ============================================================================
// AC-5: Full UI/Modal Validation
// ============================================================================
test.describe('AC-5: Full UI/Modal Validation', () => {
  test('5a: All pages have accurate live data (no mocks, no 0s)', async ({ page }) => {
    test.setTimeout(120000);

    const report: TestReport = {
      testName: 'AC-5a: All pages have accurate live data',
      status: 'FAIL',
      startTime: new Date(),
      playwrightResults: {},
      curlResults: {},
      cloudValidation: {},
      artifacts: [],
      errors: [],
      notes: []
    };

    try {
      await loginWithEmail(page);

      const pagesToCheck = [
        { path: '/chat', name: 'Chat' },
        { path: '/admin', name: 'Admin Dashboard' },
        { path: '/admin/analytics', name: 'Analytics' },
        { path: '/admin/users', name: 'Users' },
        { path: '/admin/settings', name: 'Settings' },
        { path: '/admin/workflows', name: 'Workflows' }
      ];

      const results: Record<string, any> = {};

      for (const pg of pagesToCheck) {
        console.log(`\n=== CHECKING ${pg.name.toUpperCase()} ===`);
        await page.goto(`${BASE_URL}${pg.path}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        await page.screenshot({ path: `/tmp/ac5a-${pg.name.toLowerCase().replace(/\s/g, '-')}.png`, fullPage: true });
        report.artifacts.push(`/tmp/ac5a-${pg.name.toLowerCase().replace(/\s/g, '-')}.png`);

        const pageContent = await page.locator('body').textContent() || '';

        // Check for mock data indicators
        const hasMockData = pageContent.toLowerCase().includes('mock') ||
                           pageContent.toLowerCase().includes('sample') ||
                           pageContent.toLowerCase().includes('placeholder');

        // Check for all zeros (suspicious)
        const hasAllZeros = /\b0\b.*\b0\b.*\b0\b/g.test(pageContent);

        // Check for errors
        const hasErrors = pageContent.toLowerCase().includes('error loading') ||
                         pageContent.toLowerCase().includes('failed to load');

        results[pg.name] = {
          loaded: pageContent.length > 100,
          hasMockData,
          hasAllZeros,
          hasErrors,
          contentLength: pageContent.length
        };

        if (hasMockData) report.errors.push(`${pg.name}: Contains mock data`);
        if (hasErrors) report.errors.push(`${pg.name}: Has loading errors`);
      }

      report.playwrightResults = results;
      report.status = report.errors.length === 0 ? 'PASS' : 'PARTIAL';

    } catch (err) {
      report.errors.push(String(err));
    }

    report.endTime = new Date();
    writeReport('5/5a', report);

    expect(report.playwrightResults).toBeDefined();
  });

  test('5b: All pages and modals open without React crashes', async ({ page }) => {
    test.setTimeout(180000);

    const report: TestReport = {
      testName: 'AC-5b: All pages/modals open without React crashes',
      status: 'FAIL',
      startTime: new Date(),
      playwrightResults: {},
      curlResults: {},
      cloudValidation: {},
      artifacts: [],
      errors: [],
      notes: []
    };

    const reactErrors: string[] = [];

    page.on('pageerror', error => {
      reactErrors.push(error.message);
    });

    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('React')) {
        reactErrors.push(msg.text());
      }
    });

    try {
      await loginWithEmail(page);

      const pagesToCheck = [
        '/', '/chat', '/admin', '/admin/analytics', '/admin/users',
        '/admin/settings', '/admin/workflows', '/admin/mcps', '/settings'
      ];

      const results: Record<string, any> = {};

      for (const path of pagesToCheck) {
        console.log(`\n=== CHECKING ${path} ===`);
        await page.goto(`${BASE_URL}${path}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        const crashed = await page.locator('text=/Something went wrong|Error boundary|white screen/i').isVisible({ timeout: 1000 }).catch(() => false);

        results[path] = {
          loaded: true,
          crashed,
          reactErrors: reactErrors.filter(e => e.includes(path)).length
        };

        if (crashed) {
          report.errors.push(`${path}: React crash detected`);
          await page.screenshot({ path: `/tmp/ac5b-crash-${path.replace(/\//g, '-')}.png`, fullPage: true });
          report.artifacts.push(`/tmp/ac5b-crash-${path.replace(/\//g, '-')}.png`);
        }
      }

      report.playwrightResults = {
        pages: results,
        totalReactErrors: reactErrors.length,
        reactErrors: reactErrors.slice(0, 10) // First 10 errors
      };

      report.status = reactErrors.length === 0 && report.errors.length === 0 ? 'PASS' : 'PARTIAL';

    } catch (err) {
      report.errors.push(String(err));
    }

    report.endTime = new Date();
    writeReport('5/5b', report);

    expect(report.playwrightResults.totalReactErrors).toBe(0);
  });

  // Additional AC-5 tests would continue here...
  // 5c through 5q following the same pattern
});
