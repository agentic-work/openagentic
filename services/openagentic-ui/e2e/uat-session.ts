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
 * Single-process UAT session runner.
 * Launches browser, logs in, runs multiple prompts in sequence,
 * takes screenshots between each, and outputs results.
 *
 * No CDP reconnection needed - everything runs in one process.
 *
 * Usage: npx tsx e2e/uat-session.ts [session-name]
 */

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentics.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@phatoldsungmail.onmicrosoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';
const SCREENSHOT_DIR = '/tmp/uat-driver/screenshots';
const HEADLESS = process.env.HEADLESS !== 'false';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let screenshotCount = 0;

async function screenshot(page: Page, label: string): Promise<string> {
  screenshotCount++;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(SCREENSHOT_DIR, `uat-${screenshotCount.toString().padStart(2,'0')}-${label}-${ts}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`📸 [${label}] ${filePath}`);
  return filePath;
}

async function login(page: Page) {
  console.log('🔑 Logging in via Azure AD...');
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const textarea = page.locator('textarea').first();
  if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('✅ Already logged in');
    return;
  }

  const msButton = page.locator('button:has-text("Microsoft"), button:has-text("Sign in with Microsoft")');
  if (await msButton.first().isVisible({ timeout: 5000 }).catch(() => false)) {
    await msButton.first().click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');

    const emailInput = page.locator('input[type="email"], input[name="loginfmt"]');
    if (await emailInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await emailInput.fill(ADMIN_EMAIL);
      await page.locator('input[type="submit"], button:has-text("Next")').click();
      await page.waitForTimeout(2000);
    }

    const passInput = page.locator('input[type="password"], input[name="passwd"]');
    if (await passInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await passInput.fill(ADMIN_PASSWORD);
      await page.locator('input[type="submit"], button:has-text("Sign in")').click();
      await page.waitForTimeout(3000);
    }

    const noBtn = page.locator('button:has-text("No"), input[value="No"]');
    if (await noBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await noBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.waitForURL(`${BASE_URL}/**`, { timeout: 30000 }).catch(() => {});
  }

  await page.waitForSelector('textarea', { timeout: 60000 }).catch(() => {});

  // Dismiss modals
  for (let i = 0; i < 5; i++) {
    const skipBtn = page.locator('button:has-text("Skip")').first();
    if (await skipBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await skipBtn.click();
      await page.waitForTimeout(500);
      continue;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }

  await page.evaluate(() => {
    localStorage.setItem('ac-onboarding-completed', 'true');
    localStorage.setItem('onboarding-completed', 'true');
    localStorage.setItem('ac-onboarding-step', '999');
  });

  console.log('✅ Login complete');
}

async function newChat(page: Page) {
  const btn = page.locator('button:has-text("New Chat"), [aria-label="New Chat"]').first();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click();
  } else {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  }
  await page.waitForTimeout(2000);
  console.log('💬 New chat started');
}

async function sendAndWait(page: Page, message: string, timeoutSec = 180): Promise<{ text: string; hasToolCalls: boolean; hasThinking: boolean }> {
  const shortMsg = message.length > 80 ? message.substring(0, 80) + '...' : message;
  console.log(`\n📤 Sending: "${shortMsg}"`);

  // Count existing messages
  const initialCount = await page.locator('[data-message-role="assistant"]').count();

  const textarea = page.locator('textarea').first();
  await textarea.click();
  await textarea.fill(message);
  await page.waitForTimeout(200);
  await textarea.press('Enter');

  console.log('⏳ Waiting for response...');
  const startTime = Date.now();
  let lastContent = '';
  let stableCount = 0;
  const timeoutMs = timeoutSec * 1000;

  while (Date.now() - startTime < timeoutMs) {
    await page.waitForTimeout(3000);
    const messages = page.locator('[data-message-role="assistant"]');
    const count = await messages.count();

    if (count > initialCount) {
      const lastMsg = messages.last();
      const content = (await lastMsg.textContent().catch(() => '')) || '';

      // Check for feedback row (response complete indicator)
      const hasFeedback = await lastMsg.locator('[class*="feedback"], button[title*="Copy"], button[aria-label*="copy"]').first().isVisible({ timeout: 500 }).catch(() => false);

      if (hasFeedback && content.length > 5) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ Response complete (${content.length} chars, ${elapsed}s)`);

        // Check for tool calls and thinking
        const hasToolCalls = await lastMsg.locator('.agentic-activity-stream button, [class*="tool-call"]').count() > 0;
        const hasThinking = await lastMsg.locator('.inline-thinking-natural, .inline-thinking-block, .thinking-section-natural, .thinking-section').count() > 0;

        return { text: content.substring(0, 5000), hasToolCalls, hasThinking };
      }

      if (content.length > 5 && content === lastContent) {
        stableCount++;
        if (stableCount >= 5) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✅ Response stable (${content.length} chars, ${elapsed}s)`);
          const hasToolCalls = await lastMsg.locator('.agentic-activity-stream button, [class*="tool-call"]').count() > 0;
          const hasThinking = await lastMsg.locator('.inline-thinking-natural, .inline-thinking-block, .thinking-section-natural, .thinking-section').count() > 0;
          return { text: content.substring(0, 5000), hasToolCalls, hasThinking };
        }
      } else {
        stableCount = 0;
        lastContent = content;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        process.stderr.write(`  ...streaming (${content.length} chars, ${elapsed}s)\r`);
      }
    }
  }

  console.log(`⏰ Timeout after ${timeoutSec}s! Got ${lastContent.length} chars`);
  return { text: lastContent, hasToolCalls: false, hasThinking: false };
}

async function navigateToFlows(page: Page) {
  console.log('\n🔀 Navigating to Flows page...');
  const flowsTab = page.locator('button:has-text("Flows"), [role="tab"]:has-text("Flows"), a:has-text("Flows")').first();
  if (await flowsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await flowsTab.click();
  } else {
    await page.goto(`${BASE_URL}/flows`);
  }
  await page.waitForTimeout(3000);
}

// ─── Main Session Runner ────────────────────────────────────────

async function main() {
  const sessionName = process.argv[2] || 'full-uat';
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  UAT SESSION: ${sessionName}`);
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Headless: ${HEADLESS}`);
  console.log(`${'═'.repeat(60)}\n`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-first-run', '--disable-default-apps', '--window-size=1440,900'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

  context.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.length > 10 && !text.includes('favicon')) {
        console.log(`  🔴 Console error: ${text.substring(0, 150)}`);
      }
    }
  });

  const page = await context.newPage();
  const results: Array<{ turn: string; pass: boolean; details: string }> = [];

  try {
    // ── Phase 1: Login ──
    await login(page);
    await screenshot(page, 'login');

    // ── Phase 2: Chat Mode - Azure & Web Search ──
    console.log('\n' + '─'.repeat(60));
    console.log('PHASE 2: Chat Mode — Azure + Web Search');
    console.log('─'.repeat(60));

    await newChat(page);
    await screenshot(page, 'new-chat');

    // Turn 1: Azure subscriptions
    const t1 = await sendAndWait(page, 'Use Azure tools to list all subscriptions I have access to. Show subscription name, ID, and state in a table.');
    await screenshot(page, 'turn1-azure');
    const t1pass = t1.text.includes('subscription') || t1.text.includes('Subscription') || t1.hasToolCalls;
    results.push({ turn: 'T1: Azure subscriptions', pass: t1pass, details: `${t1.text.length} chars, tools=${t1.hasToolCalls}, thinking=${t1.hasThinking}` });
    console.log(`  ${t1pass ? '✅ PASS' : '❌ FAIL'}: Azure subscription query`);

    // Turn 2: Web search
    const t2 = await sendAndWait(page, 'Search the web for the latest Kubernetes security advisories in 2026. List the top 3 CVEs.');
    await screenshot(page, 'turn2-websearch');
    const t2pass = t2.text.includes('CVE') || t2.text.includes('vulnerability') || t2.hasToolCalls;
    results.push({ turn: 'T2: Web search K8s CVEs', pass: t2pass, details: `${t2.text.length} chars, tools=${t2.hasToolCalls}, thinking=${t2.hasThinking}` });
    console.log(`  ${t2pass ? '✅ PASS' : '❌ FAIL'}: K8s CVE web search`);

    // Turn 3: Memory store
    const t3 = await sendAndWait(page, 'Store a summary of this conversation in memory with the key "uat-azure-test". Include the main findings.');
    await screenshot(page, 'turn3-memory');
    const t3pass = t3.text.includes('memory') || t3.text.includes('stored') || t3.text.includes('saved') || t3.hasToolCalls;
    results.push({ turn: 'T3: Memory store', pass: t3pass, details: `${t3.text.length} chars, tools=${t3.hasToolCalls}` });
    console.log(`  ${t3pass ? '✅ PASS' : '❌ FAIL'}: Memory store`);

    // Turn 4: Multi-turn context
    const t4 = await sendAndWait(page, 'Based on our earlier Azure subscription discussion, what was the most important finding? Reference specific details from turn 1.');
    await screenshot(page, 'turn4-context');
    const t4pass = t4.text.length > 50;
    results.push({ turn: 'T4: Multi-turn context', pass: t4pass, details: `${t4.text.length} chars` });
    console.log(`  ${t4pass ? '✅ PASS' : '❌ FAIL'}: Multi-turn context recall`);

    // ── Phase 3: Flows Page ──
    console.log('\n' + '─'.repeat(60));
    console.log('PHASE 3: Flows Page Validation');
    console.log('─'.repeat(60));

    await navigateToFlows(page);
    await page.waitForTimeout(3000);
    await screenshot(page, 'flows-page');

    // Check for errors on flows page
    const flowsErrors = await page.evaluate(() => {
      const errs: string[] = [];
      document.querySelectorAll('[class*="error"], [role="alert"]').forEach((el) => {
        const t = el.textContent?.trim() || '';
        if (t.length > 0 && t.length < 300) errs.push(t);
      });
      return errs;
    });

    const flowsPageUrl = page.url();
    const flowsPass = flowsErrors.length === 0 && !flowsPageUrl.includes('error');
    results.push({ turn: 'Flows page', pass: flowsPass, details: flowsErrors.length > 0 ? flowsErrors.join('; ') : 'No errors' });
    console.log(`  ${flowsPass ? '✅ PASS' : '❌ FAIL'}: Flows page loads (${flowsErrors.length} errors)`);

    // Check for template cards
    const templateCount = await page.locator('[class*="template"], [class*="workflow-card"], [class*="card"]').count();
    console.log(`  📊 Template cards visible: ${templateCount}`);

    // ── Phase 4: Code Mode Check ──
    console.log('\n' + '─'.repeat(60));
    console.log('PHASE 4: Code Mode Tab');
    console.log('─'.repeat(60));

    // Navigate back to chat
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const codeTab = page.locator('button:has-text("Code"), [role="tab"]:has-text("Code")').first();
    if (await codeTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await codeTab.click();
      await page.waitForTimeout(3000);
      await screenshot(page, 'code-mode');
      results.push({ turn: 'Code mode tab', pass: true, details: 'Tab visible and clickable' });
      console.log('  ✅ PASS: Code mode tab accessible');
    } else {
      results.push({ turn: 'Code mode tab', pass: false, details: 'Tab not found' });
      console.log('  ❌ FAIL: Code mode tab not found');
    }

    // ── Summary ──
    console.log('\n' + '═'.repeat(60));
    console.log('  UAT RESULTS SUMMARY');
    console.log('═'.repeat(60));

    let passCount = 0;
    for (const r of results) {
      const icon = r.pass ? '✅' : '❌';
      passCount += r.pass ? 1 : 0;
      console.log(`  ${icon} ${r.turn}: ${r.details.substring(0, 100)}`);
    }

    console.log(`\n  Score: ${passCount}/${results.length} (${((passCount/results.length)*100).toFixed(0)}%)`);
    console.log('═'.repeat(60));

    // Save results
    const resultPath = '/tmp/uat-driver/uat-results.json';
    fs.writeFileSync(resultPath, JSON.stringify({ session: sessionName, timestamp: new Date().toISOString(), results }, null, 2));
    console.log(`\n📄 Results saved to ${resultPath}`);

  } catch (err) {
    console.error(`\n💥 Fatal error: ${err instanceof Error ? err.message : err}`);
    await screenshot(page, 'error').catch(() => {});
  } finally {
    await browser.close();
    console.log('\n🏁 Browser closed. UAT session complete.');
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message || err}`);
  process.exit(1);
});
