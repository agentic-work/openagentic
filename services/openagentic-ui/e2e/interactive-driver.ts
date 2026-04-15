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
 * Interactive Browser Driver for UAT Testing
 *
 * Launches a headed browser and provides step-by-step control:
 * - login: Login via Azure AD
 * - send <msg>: Send a chat message
 * - wait: Wait for LLM response to finish
 * - sendwait <msg>: Send message, wait for response, output text to stdout
 * - screenshot: Take a screenshot
 * - content: Get last assistant response (structured)
 * - toolcalls: Extract visible tool call info from DOM
 * - thinking: Extract visible thinking blocks
 * - allcontent: Get ALL messages in the conversation
 * - newchat: Start a new chat
 * - codemode: Switch to code mode tab
 * - goto <path>: Navigate to a URL path
 * - click <sel>: Click an element
 * - type <text>: Type text into focused element
 * - status: Show page state
 * - consolelog: Show browser console errors
 * - quit: Close browser
 *
 * Usage:
 *   npx tsx e2e/interactive-driver.ts <command> [args...]
 *
 * The browser persists via CDP port 9223 so subsequent commands reuse
 * the same session.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { execSync } from 'child_process';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentics.io';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mcp-tester@phatoldsungmail.onmicrosoft.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestMcp@2026';
const STATE_DIR = '/tmp/uat-driver';
const SCREENSHOT_DIR = path.join(STATE_DIR, 'screenshots');
const CDP_PORT = 9223;

// ─── Helpers ────────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function connectOrLaunch(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  // Quick check if CDP port is open before trying Playwright connect
  const cdpAlive = await new Promise<boolean>((resolve) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json/version`, { timeout: 2000 }, (res: any) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });

  if (cdpAlive) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, {
        timeout: 8000,
      });
      const contexts = browser.contexts();
      if (contexts.length > 0) {
        const context = contexts[0];
        const pages = context.pages();
        if (pages.length > 0) {
          try {
            await pages[0].title();
            console.error('[driver] Reconnected to existing browser');
            return { browser, context, page: pages[0] };
          } catch {
            console.error('[driver] Existing page is stale, opening new one');
            const page = await context.newPage();
            return { browser, context, page };
          }
        }
        const page = await context.newPage();
        return { browser, context, page };
      }
    } catch (e) {
      console.error(`[driver] CDP connect failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.error('[driver] Launching new browser...');
  const browser = await chromium.launch({
    headless: process.env.HEADLESS === 'true',
    args: [
      `--remote-debugging-port=${CDP_PORT}`,
      '--no-first-run',
      '--disable-default-apps',
      '--window-size=1440,900',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });

  // Suppress onboarding/welcome modals via localStorage
  await context.addInitScript(() => {
    localStorage.setItem('ac-welcome-shown', 'true');
    localStorage.setItem('ac-onboarding-completed', 'true');
    localStorage.setItem('onboarding-completed', 'true');
    localStorage.setItem('ac-onboarding-step', '999');
    localStorage.setItem('hasSeenWelcome', 'true');
  });

  const page = await context.newPage();
  return { browser, context, page };
}

// ─── Login ──────────────────────────────────────────────────────

async function login(page: Page) {
  console.error('[driver] Navigating to app...');
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Check if already logged in
  const textarea = page.locator('textarea').first();
  if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('LOGIN_OK: Already logged in');
    return;
  }

  console.error('[driver] Starting Azure AD login...');
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

  // Dismiss onboarding modal - click Skip if visible
  for (let i = 0; i < 5; i++) {
    const skipBtn = page.locator('button:has-text("Skip")').first();
    if (await skipBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await skipBtn.click();
      await page.waitForTimeout(500);
      continue;
    }
    // Try Escape for any remaining modals
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }

  // Set localStorage after page load to suppress on future navigations
  await page.evaluate(() => {
    localStorage.setItem('ac-welcome-shown', 'true');
    localStorage.setItem('ac-onboarding-completed', 'true');
    localStorage.setItem('onboarding-completed', 'true');
    localStorage.setItem('ac-onboarding-step', '999');
    localStorage.setItem('hasSeenWelcome', 'true');
  });

  console.log('LOGIN_OK: Login complete');
}

// ─── Send Message ───────────────────────────────────────────────

async function sendMessage(page: Page, message: string) {
  const textarea = page.locator('textarea').first();
  await textarea.click();
  await textarea.fill(message);
  await page.waitForTimeout(200);
  await textarea.press('Enter');
  console.error(`[driver] Sent: "${message.substring(0, 120)}${message.length > 120 ? '...' : ''}"`);
}

// ─── Wait for Response ──────────────────────────────────────────

async function waitForResponse(page: Page, timeoutMs = 180000): Promise<string> {
  console.error('[driver] Waiting for LLM response...');
  const startTime = Date.now();
  let lastContent = '';
  let stableCount = 0;

  // Get current assistant message count
  const initialCount = await page.locator('[data-message-role="assistant"]').count();

  while (Date.now() - startTime < timeoutMs) {
    await page.waitForTimeout(3000);
    const messages = page.locator('[data-message-role="assistant"]');
    const count = await messages.count();

    if (count > initialCount) {
      // Get content from the last assistant message
      const lastMsg = messages.last();
      const content = (await lastMsg.textContent().catch(() => '')) || '';

      // Check if response is complete by looking for feedback row (copy/thumbs up buttons)
      const hasFeedback = await lastMsg.locator('.feedback-row').isVisible({ timeout: 500 }).catch(() => false);

      if (hasFeedback && content.length > 5) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`[driver] Response complete (feedback visible): ${content.length} chars in ${elapsed}s`);
        return content;
      }

      if (content.length > 5 && content === lastContent) {
        stableCount++;
        if (stableCount >= 4) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.error(`[driver] Response stable: ${content.length} chars in ${elapsed}s`);
          return content;
        }
      } else {
        stableCount = 0;
        lastContent = content;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.error(`[driver]   ...streaming (${content.length} chars, ${elapsed}s)`);
      }
    }
  }
  console.error(`[driver] Timeout after ${timeoutMs / 1000}s! Got ${lastContent.length} chars`);
  return lastContent;
}

// ─── Screenshot ─────────────────────────────────────────────────

async function takeScreenshot(page: Page): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(SCREENSHOT_DIR, `uat-${ts}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(filePath);
  return filePath;
}

// ─── Content Extraction ─────────────────────────────────────────

async function getLastContent(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-message-role="assistant"]');
    if (msgs.length === 0) return null;

    const last = msgs[msgs.length - 1];
    const msgId = last.getAttribute('data-message-id') || '';

    // Get plain text content
    const textContent = last.textContent?.trim() || '';

    // Extract code blocks
    const codeBlocks: Array<{ lang: string; code: string }> = [];
    last.querySelectorAll('pre code, .code-block pre').forEach((el) => {
      const lang = el.className?.match(/language-(\w+)/)?.[1] || '';
      codeBlocks.push({ lang, code: el.textContent?.trim() || '' });
    });

    // Check for tool calls in activity stream
    const toolCards: Array<{ name: string; status: string }> = [];
    last.querySelectorAll('.agentic-activity-stream button, [class*="tool-call"]').forEach((el) => {
      const text = el.textContent?.trim() || '';
      if (text && text.length > 0 && text.length < 200) {
        const hasCheck = el.querySelector('[class*="success"], .text-green') !== null;
        const hasError = el.querySelector('[class*="error"], .text-red') !== null;
        const hasSpinner = el.querySelector('.animate-spin') !== null;
        const status = hasError ? 'error' : hasSpinner ? 'running' : hasCheck ? 'complete' : 'unknown';
        toolCards.push({ name: text.substring(0, 100), status });
      }
    });

    // Check for thinking blocks
    const hasThinking = last.querySelector('.inline-thinking-natural, .inline-thinking-block, .thinking-section-natural') !== null;

    return {
      messageId: msgId,
      textLength: textContent.length,
      text: textContent.substring(0, 4000),
      codeBlocks,
      toolCards,
      hasThinking,
      truncated: textContent.length > 4000,
    };
  });

  if (!result) {
    console.log(JSON.stringify({ error: 'No assistant messages found' }));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

async function getAllContent(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const messages: Array<{ role: string; text: string; id: string }> = [];
    document.querySelectorAll('[data-message-role]').forEach((el) => {
      const role = el.getAttribute('data-message-role') || '';
      if (role === 'user' || role === 'assistant') {
        messages.push({
          role,
          id: el.getAttribute('data-message-id') || '',
          text: (el.textContent?.trim() || '').substring(0, 2000),
        });
      }
    });
    return messages;
  });

  console.log(JSON.stringify(result, null, 2));
}

// ─── Tool Calls ─────────────────────────────────────────────────

async function getToolCalls(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const tools: Array<{ name: string; status: string; details: string }> = [];

    // Look in activity stream
    document.querySelectorAll('.agentic-activity-stream').forEach((stream) => {
      // Find all step items - buttons with tool info
      stream.querySelectorAll('button').forEach((btn) => {
        const text = btn.textContent?.trim() || '';
        if (text.length > 3 && text.length < 300) {
          const hasSuccess = btn.querySelector('svg.text-green-500, [class*="success"]') !== null
            || btn.querySelector('svg')?.classList.toString().includes('success') === true;
          const hasError = btn.querySelector('svg.text-red-500, [class*="error"]') !== null;
          const hasSpinner = btn.querySelector('.animate-spin') !== null;
          const status = hasError ? 'error' : hasSpinner ? 'running' : hasSuccess ? 'success' : 'complete';

          tools.push({ name: text.substring(0, 150), status, details: '' });
        }
      });
    });

    // Also look for standalone tool call cards
    document.querySelectorAll('[class*="tool-call"], [class*="ToolCall"]').forEach((el) => {
      const text = el.textContent?.trim() || '';
      if (text.length > 3) {
        tools.push({ name: text.substring(0, 150), status: 'found', details: '' });
      }
    });

    return tools;
  });

  console.log(JSON.stringify(result, null, 2));
}

// ─── Thinking Blocks ────────────────────────────────────────────

async function getThinking(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const blocks: Array<{ type: string; text: string; expanded: boolean }> = [];

    document.querySelectorAll('.inline-thinking-natural, .inline-thinking-block, .thinking-section-natural, .thinking-section').forEach((el) => {
      const expanded = el.querySelector('motion, [style*="height: auto"], div[class*="overflow"]') !== null;
      const text = el.textContent?.trim() || '';
      blocks.push({
        type: el.className.includes('natural') ? 'natural' : 'boxed',
        text: text.substring(0, 1000),
        expanded,
      });
    });

    return blocks;
  });

  console.log(JSON.stringify(result, null, 2));
}

// ─── Status ─────────────────────────────────────────────────────

async function getStatus(page: Page): Promise<void> {
  const url = page.url();
  const title = await page.title();
  const assistantMsgs = await page.locator('[data-message-role="assistant"]').count();
  const userMsgs = await page.locator('[data-message-role="user"]').count();
  const hasTextarea = await page.locator('textarea').isVisible().catch(() => false);

  // Check for activity stream
  const hasActivity = await page.locator('.agentic-activity-stream').count();

  // Check for errors in the page
  const errorText = await page.evaluate(() => {
    const errs: string[] = [];
    document.querySelectorAll('[class*="error"], [role="alert"]').forEach((el) => {
      const text = el.textContent?.trim() || '';
      if (text.length > 0 && text.length < 200) errs.push(text);
    });
    return errs;
  });

  const result = {
    url,
    title,
    userMessages: userMsgs,
    assistantMessages: assistantMsgs,
    chatInputVisible: hasTextarea,
    activityStreams: hasActivity,
    errors: errorText,
  };

  console.log(JSON.stringify(result, null, 2));
}

// ─── Console Errors ─────────────────────────────────────────────

// Store console messages when we can
const consoleErrors: string[] = [];

async function getConsoleLogs(page: Page): Promise<void> {
  // Collect recent console errors via evaluate
  const errors = await page.evaluate(() => {
    // Can't access console history from page context, but can check for React error boundaries
    const errBoundaries: string[] = [];
    document.querySelectorAll('[class*="error-boundary"], [class*="ErrorBoundary"]').forEach((el) => {
      errBoundaries.push(el.textContent?.trim().substring(0, 200) || '');
    });
    return errBoundaries;
  });

  console.log(JSON.stringify({ errorBoundaries: errors, capturedErrors: consoleErrors.slice(-20) }, null, 2));
}

// ─── Logs (kubectl) ────────────────────────────────────────────

async function getLogs(target: string, lines = 20): Promise<void> {
  const deploymentMap: Record<string, string> = {
    api: 'deployment/openagentic-api',
    mcp: 'deployment/openagentic-mcp-proxy',
    proxy: 'deployment/openagentic-mcp-proxy',
    ui: 'deployment/openagentic-ui',
    'code-manager': 'deployment/openagentic-code-manager',
    agent: 'deployment/openagentic-openagentic-proxy',
    crewai: 'deployment/openagentic-crewai',
    langgraph: 'deployment/openagentic-langgraph',
  };

  const deployment = deploymentMap[target] || `deployment/${target}`;
  try {
    const output = execSync(
      `kubectl logs ${deployment} -n agentic-dev --tail=${lines} 2>&1`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    console.log(output);
  } catch (err) {
    const msg = err instanceof Error ? (err as any).stdout || err.message : String(err);
    console.log(`LOGS_ERROR: ${msg}`);
  }
}

// ─── Scroll to Bottom ──────────────────────────────────────────

async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const chatContainer = document.querySelector('[class*="chat-messages"], [class*="message-list"], main, [role="main"]');
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    } else {
      window.scrollTo(0, document.body.scrollHeight);
    }
  });
  await page.waitForTimeout(300);
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  ensureDirs();

  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  if (command === 'help') {
    console.log(`
Interactive UAT Driver Commands:
  login              Launch browser and login via Azure AD
  send <msg>         Send a chat message (no wait)
  wait               Wait for LLM response to complete
  sendwait <msg>     Send message + wait, output response text to stdout
  screenshot         Take a screenshot (outputs file path)
  content            Get last assistant response as structured JSON
  allcontent         Get all messages in conversation
  toolcalls          Extract tool call cards from activity stream
  thinking           Extract thinking blocks
  newchat            Start a new chat session
  codemode           Switch to code mode tab
  goto <path>        Navigate to URL path (e.g., goto /flows)
  click <selector>   Click an element
  type <text>        Type text into the focused element
  status             Page state as JSON
  consolelog         Show console errors and error boundaries
  logs <svc> [n]     Show last N lines of kubectl logs (api|mcp|ui|agent|code-manager)
  eval <js>          Evaluate JavaScript in page context
  scroll <dir>       Scroll up/down in chat
  scrollbottom       Scroll to bottom of chat
  dismiss            Force dismiss onboarding/modal overlays
  quit               Close the browser

Environment:
  BASE_URL           ${BASE_URL}
  ADMIN_EMAIL        ${ADMIN_EMAIL}
  HEADLESS           ${process.env.HEADLESS || 'false'}
  CDP_PORT           ${CDP_PORT}
`);
    return;
  }

  const { browser, context, page } = await connectOrLaunch();

  // Capture console errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[${new Date().toISOString()}] ${msg.text().substring(0, 200)}`);
    }
  });

  try {
    switch (command) {
      case 'login':
        await login(page);
        await takeScreenshot(page);
        break;

      case 'send': {
        const message = args.slice(1).join(' ');
        if (!message) {
          console.log('Usage: send <message>');
          return;
        }
        await sendMessage(page, message);
        break;
      }

      case 'wait': {
        const timeout = args[1] ? parseInt(args[1], 10) * 1000 : 180000;
        const response = await waitForResponse(page, timeout);
        // Output response to stdout
        console.log(response);
        fs.writeFileSync(path.join(STATE_DIR, 'last-response.txt'), response);
        break;
      }

      case 'sendwait': {
        const message = args.slice(1).join(' ');
        if (!message) {
          console.log('Usage: sendwait <message>');
          return;
        }
        await sendMessage(page, message);
        await page.waitForTimeout(1000);
        const response = await waitForResponse(page);
        // Output the response text to stdout
        console.log(response);
        fs.writeFileSync(path.join(STATE_DIR, 'last-response.txt'), response);
        await takeScreenshot(page);
        break;
      }

      case 'screenshot':
        await takeScreenshot(page);
        break;

      case 'content':
        await getLastContent(page);
        break;

      case 'allcontent':
        await getAllContent(page);
        break;

      case 'toolcalls':
        await getToolCalls(page);
        break;

      case 'thinking':
        await getThinking(page);
        break;

      case 'newchat': {
        // Try clicking the new chat button
        const newChatBtn = page.locator('button:has-text("New Chat"), [aria-label="New Chat"], [aria-label="new chat"]').first();
        if (await newChatBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await newChatBtn.click();
        } else {
          // Try the + icon or sidebar button
          const plusBtn = page.locator('[class*="new-chat"], button svg[class*="plus"]').first();
          if (await plusBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await plusBtn.click();
          } else {
            await page.goto(BASE_URL);
            await page.waitForLoadState('networkidle');
          }
        }
        await page.waitForTimeout(2000);
        console.log('NEW_CHAT_OK');
        await takeScreenshot(page);
        break;
      }

      case 'codemode': {
        // Look for Code tab or code mode button
        const codeTab = page.locator('button:has-text("Code"), [role="tab"]:has-text("Code")').first();
        if (await codeTab.isVisible({ timeout: 3000 }).catch(() => false)) {
          await codeTab.click();
          await page.waitForTimeout(2000);
          console.log('CODE_MODE_OK');
        } else {
          console.log('CODE_MODE_ERROR: Code tab not found');
        }
        await takeScreenshot(page);
        break;
      }

      case 'goto': {
        const urlPath = args[1] || '/';
        await page.goto(`${BASE_URL}${urlPath}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
        console.log(`GOTO_OK: ${BASE_URL}${urlPath}`);
        await takeScreenshot(page);
        break;
      }

      case 'click': {
        const selector = args.slice(1).join(' ');
        if (!selector) {
          console.log('Usage: click <selector>');
          return;
        }
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
          await el.click();
          await page.waitForTimeout(1000);
          console.log(`CLICK_OK: ${selector}`);
        } else {
          console.log(`CLICK_ERROR: Element not visible: ${selector}`);
        }
        await takeScreenshot(page);
        break;
      }

      case 'type': {
        const text = args.slice(1).join(' ');
        await page.keyboard.type(text);
        console.log(`TYPE_OK: "${text.substring(0, 50)}"`);
        break;
      }

      case 'scroll': {
        const dir = args[1] || 'down';
        if (dir === 'up') {
          await page.mouse.wheel(0, -500);
        } else {
          await page.mouse.wheel(0, 500);
        }
        await page.waitForTimeout(500);
        console.log(`SCROLL_OK: ${dir}`);
        break;
      }

      case 'status':
        await getStatus(page);
        break;

      case 'consolelog':
        await getConsoleLogs(page);
        break;

      case 'logs': {
        const target = args[1] || 'api';
        const lines = args[2] ? parseInt(args[2], 10) : 20;
        await getLogs(target, lines);
        break;
      }

      case 'eval': {
        const expr = args.slice(1).join(' ');
        if (!expr) {
          console.log('Usage: eval <js expression>');
          return;
        }
        try {
          const result = await page.evaluate((e) => {
            try { return JSON.stringify(eval(e), null, 2); } catch (err: any) { return `Error: ${err.message}`; }
          }, expr);
          console.log(result);
        } catch (err) {
          console.log(`EVAL_ERROR: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }

      case 'scrollbottom':
        await scrollToBottom(page);
        console.log('SCROLL_BOTTOM_OK');
        break;

      case 'dismiss':
        // Force dismiss any modal/overlay
        for (let i = 0; i < 5; i++) {
          const skipBtn = page.locator('button:has-text("Skip")').first();
          if (await skipBtn.isVisible({ timeout: 500 }).catch(() => false)) {
            await skipBtn.click();
            await page.waitForTimeout(300);
            continue;
          }
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(200);
        }
        await page.evaluate(() => {
          localStorage.setItem('ac-onboarding-completed', 'true');
          localStorage.setItem('onboarding-completed', 'true');
          localStorage.setItem('ac-onboarding-step', '999');
        });
        console.log('DISMISS_OK');
        await takeScreenshot(page);
        break;

      case 'quit':
        await browser.close();
        console.log('QUIT_OK: Browser closed');
        // Clean up state
        try {
          fs.rmSync(STATE_DIR, { recursive: true, force: true });
        } catch {}
        break;

      default:
        console.log(`Unknown command: ${command}. Run with 'help' for usage.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[driver] Error: ${msg}`);
    // If it's a connection error, the browser might be dead
    if (msg.includes('Target closed') || msg.includes('Connection refused') || msg.includes('has been closed')) {
      console.error('[driver] Browser connection lost. Run "login" to start a new session.');
    }
    await takeScreenshot(page).catch(() => {});
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[driver] Fatal: ${err.message || err}`);
  process.exit(1);
});
