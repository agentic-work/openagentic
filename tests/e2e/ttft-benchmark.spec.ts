/**
 * E2E Test: TTFT (Time to First Token) Benchmark
 *
 * Measures UI responsiveness metrics:
 * - Time to First Token (from submit to first visible character)
 * - Time to First Thinking Event
 * - Time to First Content Event
 * - Total Response Time
 *
 * Run with: npx playwright test ttft-benchmark.spec.ts --headed
 */

import { test, expect, Page } from '@playwright/test';

// Environment configuration
const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@openagentic.io';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';

// TTFT thresholds in milliseconds
const TTFT_THRESHOLDS = {
  excellent: 500,   // < 500ms is excellent
  good: 1500,       // < 1500ms is good
  acceptable: 3000, // < 3000ms is acceptable
  poor: 5000        // > 5000ms is poor
};

interface TTFTResult {
  question: string;
  model: string;
  ttftMs: number;
  timeToThinkingMs: number | null;
  timeToContentMs: number | null;
  totalTimeMs: number;
  rating: 'excellent' | 'good' | 'acceptable' | 'poor';
  error?: string;
}

test.describe('TTFT Benchmark', () => {
  test.setTimeout(180000); // 3 minute timeout

  let page: Page;
  let results: TTFTResult[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Enable console logging
    page.on('console', msg => {
      if (msg.text().includes('TTFT') || msg.text().includes('SSE')) {
        console.log(`[Browser] ${msg.text()}`);
      }
    });

    // Login flow (same as chat-sse-stress.spec.ts)
    console.log('Navigating to application...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Handle local auth button if present
    const localAuthButton = page.locator('text=Local').first();
    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Found local auth button, clicking...');
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }

    // Fill login form
    const emailInput = page.locator('input[type="email"]').or(page.locator('input[name="email"]'));
    const passwordInput = page.locator('input[type="password"]');

    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Filling login form...');
      await emailInput.fill(TEST_EMAIL);
      await passwordInput.fill(TEST_PASSWORD);

      console.log('Submitting login...');
      await page.locator('button[type="submit"]').click();

      // Wait for redirect to chat
      await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 });
      console.log('Login successful!');
    } else {
      console.log('Already logged in or different auth flow');
    }

    // Wait for chat interface
    await page.waitForSelector('textarea, input[type="text"], [contenteditable="true"]', { timeout: 30000 });
    console.log('Chat interface ready');
  });

  test.afterAll(async () => {
    // Print results summary
    console.log('\n\n========================================');
    console.log('        TTFT BENCHMARK RESULTS          ');
    console.log('========================================\n');

    for (const result of results) {
      const ratingEmoji = {
        excellent: '🚀',
        good: '✅',
        acceptable: '⚠️',
        poor: '🐌'
      }[result.rating];

      console.log(`${ratingEmoji} ${result.question.substring(0, 40)}...`);
      console.log(`   Model: ${result.model}`);
      console.log(`   TTFT: ${result.ttftMs}ms (${result.rating})`);
      console.log(`   Thinking: ${result.timeToThinkingMs ? `${result.timeToThinkingMs}ms` : 'N/A'}`);
      console.log(`   Content: ${result.timeToContentMs ? `${result.timeToContentMs}ms` : 'N/A'}`);
      console.log(`   Total: ${result.totalTimeMs}ms`);
      if (result.error) console.log(`   Error: ${result.error}`);
      console.log('');
    }

    // Calculate averages
    const avgTTFT = results.reduce((sum, r) => sum + r.ttftMs, 0) / results.length;
    const avgTotal = results.reduce((sum, r) => sum + r.totalTimeMs, 0) / results.length;

    console.log('----------------------------------------');
    console.log(`Average TTFT: ${avgTTFT.toFixed(0)}ms`);
    console.log(`Average Total: ${avgTotal.toFixed(0)}ms`);
    console.log('========================================\n');

    await page.close();
  });

  async function measureTTFT(question: string, model: string = 'gemini-2.5-flash'): Promise<TTFTResult> {
    const submitTime = Date.now();
    let ttftTime: number | null = null;
    let thinkingTime: number | null = null;
    let contentTime: number | null = null;
    let completeTime: number | null = null;
    let error: string | undefined;

    // Try to start a new chat to avoid MCP context pollution
    const newChatButton = page.locator('[data-testid="new-chat"], button:has-text("New Chat"), button:has-text("New Conversation"), [aria-label="New chat"]').first();
    if (await newChatButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await newChatButton.click();
      await page.waitForTimeout(500);
    }

    // Find chat input
    const chatInput = page.locator('[data-testid="chat-input"], textarea, input[type="text"]').first();
    await chatInput.waitFor({ state: 'visible', timeout: 10000 });

    // Clear any existing text and type the question
    await chatInput.fill('');
    await chatInput.fill(question);

    // Set up mutation observer to detect first visible content
    const firstVisiblePromise = page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const startTime = Date.now();

        // Watch for any new text content in assistant messages
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === 'childList' || mutation.type === 'characterData') {
              const target = mutation.target as Element;
              // Look for assistant message content
              if (target.textContent && target.textContent.length > 0) {
                const parent = target.closest?.('[data-role="assistant"]') ||
                               target.closest?.('.assistant-message') ||
                               target.closest?.('[class*="message"]');
                if (parent) {
                  observer.disconnect();
                  resolve(Date.now() - startTime);
                  return;
                }
              }
            }
          }
        });

        // Observe the entire chat container
        const chatContainer = document.querySelector('[data-testid="chat-messages"]') ||
                             document.querySelector('[class*="messages"]') ||
                             document.querySelector('main');
        if (chatContainer) {
          observer.observe(chatContainer, {
            childList: true,
            subtree: true,
            characterData: true
          });
        }

        // Timeout after 60 seconds
        setTimeout(() => {
          observer.disconnect();
          resolve(-1);
        }, 60000);
      });
    });

    // Submit the message (Enter key or button click)
    const sendButton = page.locator('[data-testid="send-button"], button[type="submit"], button:has-text("Send")').first();
    if (await sendButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await sendButton.click();
    } else {
      await chatInput.press('Enter');
    }

    const actualSubmitTime = Date.now();

    // Wait for first visible content with a timeout
    try {
      const observerTTFT = await Promise.race([
        firstVisiblePromise,
        new Promise<number>((_, reject) => setTimeout(() => reject(new Error('TTFT timeout')), 60000))
      ]);

      if (observerTTFT !== -1) {
        ttftTime = actualSubmitTime + observerTTFT;
      }
    } catch (e) {
      error = 'TTFT measurement failed: ' + (e as Error).message;
    }

    // Wait for streaming to complete (look for done indicator or stable content)
    try {
      await page.waitForFunction(() => {
        // Check if streaming indicator is gone
        const streamingIndicator = document.querySelector('[data-streaming="true"]') ||
                                   document.querySelector('.streaming') ||
                                   document.querySelector('[class*="cursor"]');
        return !streamingIndicator;
      }, { timeout: 60000 });
    } catch (e) {
      // If timeout, that's okay - we still got TTFT
    }

    completeTime = Date.now();

    // Calculate final metrics
    const result: TTFTResult = {
      question,
      model,
      ttftMs: ttftTime ? ttftTime - actualSubmitTime : -1,
      timeToThinkingMs: thinkingTime ? thinkingTime - actualSubmitTime : null,
      timeToContentMs: contentTime ? contentTime - actualSubmitTime : null,
      totalTimeMs: completeTime - actualSubmitTime,
      rating: 'poor',
      error
    };

    // Determine rating
    if (result.ttftMs > 0) {
      if (result.ttftMs < TTFT_THRESHOLDS.excellent) result.rating = 'excellent';
      else if (result.ttftMs < TTFT_THRESHOLDS.good) result.rating = 'good';
      else if (result.ttftMs < TTFT_THRESHOLDS.acceptable) result.rating = 'acceptable';
      else result.rating = 'poor';
    }

    results.push(result);
    return result;
  }

  // Use prompts that explicitly avoid tool use for accurate TTFT measurement
  test('TTFT - Simple greeting', async () => {
    const result = await measureTTFT('Just say "Hello!" back to me. Do not use any tools.');
    console.log(`TTFT Result: ${result.ttftMs}ms (${result.rating})`);
    expect(result.ttftMs).toBeGreaterThan(0);
    expect(result.ttftMs).toBeLessThan(TTFT_THRESHOLDS.poor);
  });

  test('TTFT - Math calculation', async () => {
    await page.waitForTimeout(2000); // Brief pause between tests
    const result = await measureTTFT('Calculate 123 * 456 mentally and give me the answer. Do not use any tools.');
    console.log(`TTFT Result: ${result.ttftMs}ms (${result.rating})`);
    expect(result.ttftMs).toBeGreaterThan(0);
    expect(result.ttftMs).toBeLessThan(TTFT_THRESHOLDS.poor);
  });

  test('TTFT - Code generation', async () => {
    await page.waitForTimeout(2000);
    const result = await measureTTFT('Write a Python function to check if a number is prime. Do not use any tools, just respond with the code.');
    console.log(`TTFT Result: ${result.ttftMs}ms (${result.rating})`);
    expect(result.ttftMs).toBeGreaterThan(0);
  });

  test('TTFT - Complex reasoning', async () => {
    await page.waitForTimeout(2000);
    const result = await measureTTFT('Explain the difference between REST and GraphQL APIs in 3 sentences. Do not use any tools.');
    console.log(`TTFT Result: ${result.ttftMs}ms (${result.rating})`);
    expect(result.ttftMs).toBeGreaterThan(0);
  });
});
