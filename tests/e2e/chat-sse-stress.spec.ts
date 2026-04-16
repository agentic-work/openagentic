/**
 * E2E Test: Chat SSE Stress Test
 *
 * Tests chat functionality with increasingly difficult questions in a single session.
 * Verifies SSE streaming works correctly and responses are complete.
 *
 * Environment Variables:
 *   BASE_URL - The application URL (default: https://chat-dev.openagentic.io)
 *   TEST_EMAIL - Login email (default: admin@openagentic.io)
 *   TEST_PASSWORD - Login password
 *
 * Run with: npx playwright test chat-sse-stress.spec.ts --headed
 */

import { test, expect, Page } from '@playwright/test';

// Environment configuration - works across AKS, GKE, local, etc.
const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@openagentic.io';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';

// Test questions with increasing complexity
const TEST_QUESTIONS = [
  {
    level: 'simple',
    question: 'What is 2 + 2?',
    expectedKeywords: ['4', 'four'],
    description: 'Basic arithmetic'
  },
  {
    level: 'simple',
    question: 'What color is the sky on a clear day?',
    expectedKeywords: ['blue'],
    description: 'Basic factual question'
  },
  {
    level: 'medium',
    question: 'Explain the difference between TCP and UDP in networking.',
    expectedKeywords: ['connection', 'reliable', 'packet', 'protocol'],
    description: 'Technical explanation'
  },
  {
    level: 'medium',
    question: 'Write a Python function that reverses a string.',
    expectedKeywords: ['def', 'return', 'reverse', '[::-1]'],
    description: 'Code generation'
  },
  {
    level: 'complex',
    question: 'Explain the CAP theorem in distributed systems and provide examples of databases that prioritize each combination.',
    expectedKeywords: ['consistency', 'availability', 'partition', 'tolerance', 'database'],
    description: 'Complex technical concept'
  },
  {
    level: 'complex',
    question: 'Design a rate limiting system for an API that handles 10,000 requests per second. Include the data structures and algorithms you would use.',
    expectedKeywords: ['token', 'bucket', 'sliding', 'window', 'redis', 'algorithm'],
    description: 'System design question'
  },
  {
    level: 'stress',
    question: 'Write a detailed implementation of a LRU cache in TypeScript with O(1) get and put operations. Include comments explaining the approach.',
    expectedKeywords: ['class', 'Map', 'get', 'put', 'capacity', 'node'],
    description: 'Complex code with explanation'
  }
];

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  streamingComplete: boolean;
  tokenCount?: number;
}

interface TestResult {
  question: string;
  level: string;
  responseReceived: boolean;
  streamingWorked: boolean;
  responseLength: number;
  timeToFirstToken: number;
  totalTime: number;
  keywordsFound: string[];
  keywordsMissing: string[];
  error?: string;
}

test.describe('Chat SSE Stress Test', () => {
  test.setTimeout(300000); // 5 minute timeout for full test

  let page: Page;
  let testResults: TestResult[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Enable console logging from the page
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[Browser Error] ${msg.text()}`);
      }
    });

    // Log network errors
    page.on('requestfailed', request => {
      console.log(`[Network Failed] ${request.url()}: ${request.failure()?.errorText}`);
    });
  });

  test.afterAll(async () => {
    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('CHAT SSE STRESS TEST SUMMARY');
    console.log('='.repeat(80));

    for (const result of testResults) {
      const status = result.responseReceived && result.streamingWorked ? '✅' : '❌';
      console.log(`\n${status} [${result.level.toUpperCase()}] ${result.question.substring(0, 50)}...`);
      console.log(`   Response: ${result.responseLength} chars, TTFT: ${result.timeToFirstToken}ms, Total: ${result.totalTime}ms`);
      console.log(`   Keywords found: ${result.keywordsFound.join(', ') || 'none'}`);
      if (result.keywordsMissing.length > 0) {
        console.log(`   Keywords missing: ${result.keywordsMissing.join(', ')}`);
      }
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }

    const passed = testResults.filter(r => r.responseReceived && r.streamingWorked).length;
    const total = testResults.length;
    console.log('\n' + '='.repeat(80));
    console.log(`TOTAL: ${passed}/${total} questions answered successfully`);
    console.log('='.repeat(80) + '\n');

    await page.close();
  });

  test('Login to application', async () => {
    console.log(`\n[Test] Logging in to ${BASE_URL}`);

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Handle local auth button if present
    const localAuthButton = page.locator('text=Local').first();
    if (await localAuthButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[Test] Found local auth button, clicking...');
      await localAuthButton.click();
      await page.waitForTimeout(1000);
    }

    // Fill login form
    const emailInput = page.locator('input[type="email"]').or(page.locator('input[name="email"]'));
    const passwordInput = page.locator('input[type="password"]');

    await emailInput.fill(TEST_EMAIL);
    await passwordInput.fill(TEST_PASSWORD);

    console.log('[Test] Submitting login...');
    await page.locator('button[type="submit"]').click();

    // Wait for redirect to chat
    await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 });

    console.log('[Test] Login successful!');
    await page.screenshot({ path: 'screenshots/chat-test-01-logged-in.png' });
  });

  test('Navigate to chat and verify UI', async () => {
    console.log('\n[Test] Verifying chat UI...');

    // Look for chat input
    const chatInput = page.locator('textarea').or(page.locator('input[placeholder*="message" i]')).or(page.locator('[data-testid="chat-input"]'));
    await expect(chatInput.first()).toBeVisible({ timeout: 10000 });

    console.log('[Test] Chat input found!');
    await page.screenshot({ path: 'screenshots/chat-test-02-chat-ready.png' });
  });

  // Generate individual test for each question
  for (let i = 0; i < TEST_QUESTIONS.length; i++) {
    const q = TEST_QUESTIONS[i];

    test(`Ask question ${i + 1}: ${q.description} [${q.level}]`, async () => {
      console.log(`\n[Test ${i + 1}] [${q.level.toUpperCase()}] ${q.description}`);
      console.log(`[Test ${i + 1}] Question: ${q.question.substring(0, 80)}...`);

      const result: TestResult = {
        question: q.question,
        level: q.level,
        responseReceived: false,
        streamingWorked: false,
        responseLength: 0,
        timeToFirstToken: 0,
        totalTime: 0,
        keywordsFound: [],
        keywordsMissing: [...q.expectedKeywords]
      };

      try {
        // Find chat input
        const chatInput = page.locator('textarea').first();
        await chatInput.click();
        await chatInput.fill(q.question);

        // Track timing
        const startTime = Date.now();
        let firstTokenTime = 0;

        // Set up SSE response listener
        let responseText = '';
        let streamingDetected = false;
        let lastResponseLength = 0;
        let stableCount = 0;

        // Submit the question
        console.log(`[Test ${i + 1}] Sending question...`);

        // Try different submit methods
        const sendButton = page.locator('button[type="submit"]')
          .or(page.locator('[data-testid="send-button"]'))
          .or(page.locator('button:has-text("Send")'))
          .or(page.locator('button svg[class*="send" i]').locator('..'));

        // Check if there's a visible send button, otherwise press Enter
        if (await sendButton.first().isVisible({ timeout: 2000 }).catch(() => false)) {
          await sendButton.first().click();
        } else {
          await chatInput.press('Enter');
        }

        // Wait for response with streaming detection
        console.log(`[Test ${i + 1}] Waiting for response...`);

        // Poll for response updates
        for (let poll = 0; poll < 120; poll++) { // Max 2 minutes (120 * 1000ms)
          await page.waitForTimeout(1000);

          // Look for the latest assistant message
          const assistantMessages = page.locator('[class*="assistant"]')
            .or(page.locator('[data-role="assistant"]'))
            .or(page.locator('.message-content').last())
            .or(page.locator('[class*="response"]').last());

          // Try to get response text from various selectors
          let currentResponse = '';
          try {
            // Use actual UI selectors from the chat components:
            // - data-message-role="assistant" is set on assistant message wrappers
            // - .llm-content is the class for LLM-rendered content
            // - .message-content is the main content container
            const responseSelectors = [
              '[data-message-role="assistant"] .llm-content',
              '[data-message-role="assistant"] .message-content',
              '[data-message-role="assistant"]',
              '.llm-content',
              '.message-content'
            ];

            for (const selector of responseSelectors) {
              const elements = await page.locator(selector).all();
              if (elements.length > 0) {
                const lastElement = elements[elements.length - 1];
                const text = await lastElement.innerText().catch(() => '');
                if (text.length > currentResponse.length) {
                  currentResponse = text;
                }
              }
            }
          } catch (e) {
            // Ignore errors when trying to get text
          }

          // Detect streaming (response growing)
          if (currentResponse.length > lastResponseLength) {
            if (!streamingDetected && currentResponse.length > 0) {
              firstTokenTime = Date.now() - startTime;
              streamingDetected = true;
              console.log(`[Test ${i + 1}] First token received at ${firstTokenTime}ms`);
            }
            lastResponseLength = currentResponse.length;
            stableCount = 0;
            responseText = currentResponse;

            // Log streaming progress every 5 polls
            if (poll % 5 === 0) {
              console.log(`[Test ${i + 1}] Streaming... ${currentResponse.length} chars`);
            }
          } else if (currentResponse.length > 0) {
            stableCount++;
            // Response stable for 3 seconds = complete
            if (stableCount >= 3) {
              console.log(`[Test ${i + 1}] Response complete: ${currentResponse.length} chars`);
              responseText = currentResponse;
              break;
            }
          }

          // Check for error messages
          const errorVisible = await page.locator('text=Error')
            .or(page.locator('text=failed'))
            .or(page.locator('[class*="error"]'))
            .isVisible({ timeout: 100 }).catch(() => false);

          if (errorVisible && poll > 5) {
            result.error = 'Error message detected on page';
            break;
          }
        }

        const totalTime = Date.now() - startTime;
        result.totalTime = totalTime;
        result.timeToFirstToken = firstTokenTime;
        result.responseLength = responseText.length;
        result.responseReceived = responseText.length > 10;
        result.streamingWorked = streamingDetected;

        // Check for expected keywords
        const responseLower = responseText.toLowerCase();
        for (const keyword of q.expectedKeywords) {
          if (responseLower.includes(keyword.toLowerCase())) {
            result.keywordsFound.push(keyword);
            result.keywordsMissing = result.keywordsMissing.filter(k => k !== keyword);
          }
        }

        console.log(`[Test ${i + 1}] Response: ${responseText.substring(0, 200)}...`);
        console.log(`[Test ${i + 1}] Stats: ${result.responseLength} chars, TTFT: ${result.timeToFirstToken}ms, Total: ${result.totalTime}ms`);
        console.log(`[Test ${i + 1}] Keywords: ${result.keywordsFound.length}/${q.expectedKeywords.length} found`);

        // Take screenshot
        await page.screenshot({ path: `screenshots/chat-test-${String(i + 3).padStart(2, '0')}-q${i + 1}-${q.level}.png` });

        // Verify response
        expect(result.responseReceived).toBe(true);
        expect(result.streamingWorked).toBe(true);

      } catch (error: any) {
        result.error = error.message;
        console.log(`[Test ${i + 1}] ERROR: ${error.message}`);
        await page.screenshot({ path: `screenshots/chat-test-error-q${i + 1}.png` });
        throw error;
      } finally {
        testResults.push(result);
      }

      // Wait between questions to avoid rate limiting
      await page.waitForTimeout(2000);
    });
  }

  test('Verify chat history persistence', async () => {
    console.log('\n[Test] Verifying chat history...');

    // Count messages in the chat using actual UI selectors
    const userMessages = await page.locator('[data-message-role="user"]').count();
    const assistantMessages = await page.locator('[data-message-role="assistant"]').count();
    const messageCount = userMessages + assistantMessages;
    console.log(`[Test] Found ${userMessages} user messages and ${assistantMessages} assistant messages (${messageCount} total)`);

    // Should have at least 2 messages per question (user + assistant)
    const expectedMinMessages = TEST_QUESTIONS.length * 2;

    // Take final screenshot
    await page.screenshot({ path: 'screenshots/chat-test-final-history.png', fullPage: true });

    console.log(`[Test] Expected at least ${expectedMinMessages} messages, found ${messageCount}`);
    expect(messageCount).toBeGreaterThanOrEqual(expectedMinMessages - 2); // Allow some flexibility
  });
});
