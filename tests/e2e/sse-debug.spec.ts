/**
 * E2E Test: SSE Streaming Debug
 *
 * Specifically tests Server-Sent Events (SSE) streaming functionality
 * Captures network traffic, response headers, and EventSource behavior
 * to debug k3s + NGINX Ingress SSE issues
 *
 * Run with: npx playwright test sse-debug.spec.ts --headed
 */

import { test, expect } from '@playwright/test';

const BASE_URL = 'https://chat.dev.openagentic.io';
const LOCAL_ADMIN_EMAIL = 'admin@openagentic.io';
const LOCAL_ADMIN_PASSWORD = '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';

test.describe('SSE Streaming Debug', () => {

  test.setTimeout(180000); // 3 minute timeout

  test('Capture SSE streaming behavior and network headers', async ({ page, context }) => {

    // Collect console logs (especially EventSource errors)
    const consoleLogs: Array<{ type: string; text: string; time: Date }> = [];
    page.on('console', msg => {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        time: new Date()
      });
      console.log(`[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    // Collect network requests/responses
    const networkLogs: Array<{
      url: string;
      method: string;
      status?: number;
      headers?: Record<string, string>;
      responseHeaders?: Record<string, string>;
      timing: number;
    }> = [];

    page.on('request', request => {
      const entry = {
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        timing: Date.now()
      };
      networkLogs.push(entry);

      // Log SSE-related requests
      if (request.url().includes('/api/chat') || request.url().includes('stream')) {
        console.log(`\n[REQUEST] ${request.method()} ${request.url()}`);
        console.log(`  Headers:`, JSON.stringify(request.headers(), null, 2));
      }
    });

    page.on('response', async response => {
      const matchingEntry = networkLogs.find(
        e => e.url === response.url() && !e.status
      );

      if (matchingEntry) {
        matchingEntry.status = response.status();
        matchingEntry.responseHeaders = response.headers();
      }

      // Log SSE-related responses
      if (response.url().includes('/api/chat') || response.url().includes('stream')) {
        console.log(`\n[RESPONSE] ${response.status()} ${response.url()}`);
        console.log(`  Response Headers:`, JSON.stringify(response.headers(), null, 2));

        // Check for critical SSE headers
        const headers = response.headers();
        console.log(`\n=== CRITICAL SSE HEADERS CHECK ===`);
        console.log(`  Content-Type: ${headers['content-type'] || 'MISSING'}`);
        console.log(`  Transfer-Encoding: ${headers['transfer-encoding'] || 'MISSING'}`);
        console.log(`  Cache-Control: ${headers['cache-control'] || 'MISSING'}`);
        console.log(`  Connection: ${headers['connection'] || 'MISSING'}`);
        console.log(`  X-Accel-Buffering: ${headers['x-accel-buffering'] || 'MISSING'}`);

        // Check for buffering headers that break SSE
        const problematicHeaders = {
          'Content-Length': headers['content-length'],
          'Content-Encoding': headers['content-encoding'],
          'Proxy-Buffering': headers['proxy-buffering']
        };
        console.log(`\n=== POTENTIALLY PROBLEMATIC HEADERS ===`);
        for (const [key, value] of Object.entries(problematicHeaders)) {
          if (value) {
            console.log(`  ⚠️  ${key}: ${value} (may break SSE)`);
          }
        }
      }
    });

    // ========================================================================
    // SECTION 1: LOGIN
    // ========================================================================
    console.log('\n=== SECTION 1: LOGIN ===');

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'screenshots/sse-01-landing.png', fullPage: true });

    // Handle local auth
    const localAuthButton = page.locator('text=Local Login')
      .or(page.locator('text=local'))
      .or(page.locator('[data-testid="local-auth"]'));

    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('  Clicking local auth...');
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }

    const emailInput = page.locator('input[type="email"]')
      .or(page.locator('input[name="email"]'))
      .or(page.locator('input[placeholder*="email" i]'));
    const passwordInput = page.locator('input[type="password"]')
      .or(page.locator('input[name="password"]'));

    await emailInput.fill(LOCAL_ADMIN_EMAIL);
    await passwordInput.fill(LOCAL_ADMIN_PASSWORD);

    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    await page.waitForURL(url => !url.pathname.includes('login') && !url.pathname.includes('auth'), {
      timeout: 30000
    });

    console.log('  ✅ Login successful');
    await page.screenshot({ path: 'screenshots/sse-02-logged-in.png', fullPage: true });

    // ========================================================================
    // SECTION 2: SEND TEST MESSAGE AND MONITOR SSE
    // ========================================================================
    console.log('\n=== SECTION 2: SEND TEST MESSAGE ===');

    await page.waitForTimeout(2000);

    const chatInput = page.locator('textarea')
      .or(page.locator('input[placeholder*="message" i]'))
      .or(page.locator('[contenteditable="true"]'));

    const sendButton = page.locator('button:has-text("Send")')
      .or(page.locator('button[aria-label*="Send" i]'))
      .or(page.locator('button[type="submit"]'));

    // Send a simple message
    const testMessage = 'Say "Hello World" and nothing else.';
    console.log(`  Sending message: "${testMessage}"`);

    await chatInput.first().fill(testMessage);
    await page.screenshot({ path: 'screenshots/sse-03-message-typed.png', fullPage: true });

    // Clear network logs before sending to focus on chat request
    networkLogs.length = 0;
    consoleLogs.length = 0;

    const messageStartTime = Date.now();
    console.log(`  Message sent at: ${new Date(messageStartTime).toISOString()}`);

    // Click send and immediately start monitoring
    if (await sendButton.first().isVisible({ timeout: 1000 }).catch(() => false)) {
      await sendButton.first().click();
    } else {
      await chatInput.first().press('Enter');
    }

    await page.screenshot({ path: 'screenshots/sse-04-message-sent.png', fullPage: true });

    // Monitor for thinking animation
    console.log('\n  Checking for thinking animation...');
    const thinkingIndicator = page.locator('[class*="thinking"]')
      .or(page.locator('[class*="loading"]'))
      .or(page.locator('[class*="typing"]'))
      .or(page.locator('text=Thinking'))
      .or(page.locator('.animate-spin'));

    const hasThinking = await thinkingIndicator.first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  Thinking animation visible: ${hasThinking ? '✅' : '❌'}`);

    if (hasThinking) {
      await page.screenshot({ path: 'screenshots/sse-05-thinking.png', fullPage: true });
    }

    // Wait for response to stream in
    console.log('\n  Waiting for SSE stream (20 seconds)...');
    let streamingDetected = false;
    let responseAppeared = false;

    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);

      // Check if response text is appearing
      const responseText = page.locator('[class*="message"]')
        .or(page.locator('[class*="response"]'))
        .or(page.locator('[role="log"]'));

      const textContent = await responseText.evaluateAll(elements =>
        elements.map(el => el.textContent).join(' ')
      );

      if (textContent.toLowerCase().includes('hello') || textContent.toLowerCase().includes('world')) {
        if (!responseAppeared) {
          responseAppeared = true;
          console.log(`  ✅ Response appeared at ${i + 1}s`);
          streamingDetected = true;
        }
      }

      // Check if thinking animation disappeared (response completed)
      const stillThinking = await thinkingIndicator.first().isVisible({ timeout: 500 }).catch(() => false);
      if (!stillThinking && responseAppeared) {
        console.log(`  ✅ Response completed at ${i + 1}s`);
        break;
      }

      // Take periodic screenshots
      if (i % 5 === 0) {
        await page.screenshot({ path: `screenshots/sse-06-waiting-${i}s.png`, fullPage: true });
      }
    }

    const messageEndTime = Date.now();
    const totalTime = (messageEndTime - messageStartTime) / 1000;

    console.log(`\n=== STREAMING RESULTS ===`);
    console.log(`  Total time: ${totalTime.toFixed(1)}s`);
    console.log(`  Streaming detected: ${streamingDetected ? '✅ YES' : '❌ NO'}`);
    console.log(`  Response appeared: ${responseAppeared ? '✅ YES' : '❌ NO'}`);

    await page.screenshot({ path: 'screenshots/sse-07-final.png', fullPage: true });

    // ========================================================================
    // SECTION 3: ANALYZE NETWORK TRAFFIC
    // ========================================================================
    console.log('\n=== SECTION 3: NETWORK ANALYSIS ===');

    // Find chat API requests
    const chatRequests = networkLogs.filter(
      log => log.url.includes('/api/chat') || log.url.includes('stream')
    );

    console.log(`\n  Found ${chatRequests.length} chat-related requests`);

    chatRequests.forEach((req, idx) => {
      console.log(`\n  Request ${idx + 1}:`);
      console.log(`    URL: ${req.url}`);
      console.log(`    Method: ${req.method}`);
      console.log(`    Status: ${req.status || 'pending'}`);

      if (req.responseHeaders) {
        console.log(`    Response Headers:`);
        console.log(`      content-type: ${req.responseHeaders['content-type'] || 'N/A'}`);
        console.log(`      transfer-encoding: ${req.responseHeaders['transfer-encoding'] || 'N/A'}`);
        console.log(`      cache-control: ${req.responseHeaders['cache-control'] || 'N/A'}`);
        console.log(`      x-accel-buffering: ${req.responseHeaders['x-accel-buffering'] || 'N/A'}`);
        console.log(`      content-length: ${req.responseHeaders['content-length'] || 'N/A'}`);
        console.log(`      connection: ${req.responseHeaders['connection'] || 'N/A'}`);
      }
    });

    // ========================================================================
    // SECTION 4: CONSOLE LOG ANALYSIS
    // ========================================================================
    console.log('\n=== SECTION 4: CONSOLE LOG ANALYSIS ===');

    const errors = consoleLogs.filter(log => log.type === 'error');
    const warnings = consoleLogs.filter(log => log.type === 'warning');

    console.log(`\n  Total console messages: ${consoleLogs.length}`);
    console.log(`  Errors: ${errors.length}`);
    console.log(`  Warnings: ${warnings.length}`);

    if (errors.length > 0) {
      console.log('\n  ⚠️  Console Errors:');
      errors.forEach(err => {
        console.log(`    [${err.time.toISOString()}] ${err.text}`);
      });
    }

    if (warnings.length > 0) {
      console.log('\n  ⚠️  Console Warnings:');
      warnings.forEach(warn => {
        console.log(`    [${warn.time.toISOString()}] ${warn.text}`);
      });
    }

    // Look for EventSource-specific messages
    const eventSourceLogs = consoleLogs.filter(
      log => log.text.toLowerCase().includes('eventsource') ||
             log.text.toLowerCase().includes('sse')
    );

    if (eventSourceLogs.length > 0) {
      console.log('\n  EventSource-related logs:');
      eventSourceLogs.forEach(log => {
        console.log(`    [${log.type}] ${log.text}`);
      });
    }

    // ========================================================================
    // SECTION 5: SAVE DETAILED REPORT
    // ========================================================================
    console.log('\n=== SECTION 5: GENERATING REPORT ===');

    const report = {
      timestamp: new Date().toISOString(),
      environment: {
        url: BASE_URL,
        browser: 'chromium',
        k8s: 'k3s + NGINX Ingress + MetalLB'
      },
      streamingTest: {
        messageStartTime: new Date(messageStartTime).toISOString(),
        messageEndTime: new Date(messageEndTime).toISOString(),
        totalTimeSeconds: totalTime,
        streamingDetected,
        responseAppeared,
        thinkingAnimationShown: hasThinking
      },
      networkRequests: chatRequests.map(req => ({
        url: req.url,
        method: req.method,
        status: req.status,
        responseHeaders: req.responseHeaders
      })),
      consoleLogs: {
        total: consoleLogs.length,
        errors: errors.map(e => e.text),
        warnings: warnings.map(w => w.text),
        eventSourceLogs: eventSourceLogs.map(l => ({ type: l.type, text: l.text }))
      },
      diagnosis: {
        sseWorking: streamingDetected && responseAppeared,
        possibleIssues: []
      }
    };

    // Add diagnosis
    if (!streamingDetected) {
      report.diagnosis.possibleIssues.push('SSE streaming not detected - text not appearing incrementally');
    }

    if (!responseAppeared) {
      report.diagnosis.possibleIssues.push('No response appeared - SSE connection may be failing completely');
    }

    const chatReq = chatRequests.find(r => r.responseHeaders);
    if (chatReq?.responseHeaders) {
      const headers = chatReq.responseHeaders;

      if (!headers['transfer-encoding']?.includes('chunked')) {
        report.diagnosis.possibleIssues.push('Missing Transfer-Encoding: chunked header');
      }

      if (!headers['content-type']?.includes('text/event-stream')) {
        report.diagnosis.possibleIssues.push('Missing or incorrect Content-Type for SSE');
      }

      if (headers['content-length']) {
        report.diagnosis.possibleIssues.push('Content-Length header present (prevents streaming)');
      }

      if (headers['x-accel-buffering'] !== 'no') {
        report.diagnosis.possibleIssues.push('X-Accel-Buffering not set to "no"');
      }
    }

    console.log(`\n  Writing report to sse-debug-report.json`);
    const fs = require('fs');
    fs.writeFileSync(
      'sse-debug-report.json',
      JSON.stringify(report, null, 2)
    );

    console.log('\n=== TEST COMPLETE ===');
    console.log(`  Report saved: sse-debug-report.json`);
    console.log(`  Screenshots: screenshots/sse-*.png`);
    console.log(`\n  SSE Working: ${report.diagnosis.sseWorking ? '✅ YES' : '❌ NO'}`);

    if (report.diagnosis.possibleIssues.length > 0) {
      console.log(`\n  ⚠️  Possible Issues Detected:`);
      report.diagnosis.possibleIssues.forEach(issue => {
        console.log(`    - ${issue}`);
      });
    }
  });
});
