/**
 * E2E Test: Chain of Thought (COT) Reasoning Benchmark
 *
 * Tests the LLM's reasoning abilities with difficult questions:
 * - Math proofs and logic puzzles
 * - Complex analysis and multi-step reasoning
 * - Measures COT/thinking events from SSE stream
 * - Times response speed and evaluates informativeness
 *
 * Run with: npx playwright test cot-reasoning-test.spec.ts --headed
 */

import { test, expect, Page } from '@playwright/test';

// Environment configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@openagentic.io';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '';

// Difficulty levels
type DifficultyLevel = 'medium' | 'hard' | 'expert';

interface COTResult {
  question: string;
  difficulty: DifficultyLevel;
  model: string;
  ttftMs: number;
  timeToThinkingMs: number | null;
  thinkingDurationMs: number | null;
  thinkingTokens: number;
  thinkingSteps: string[];
  totalTimeMs: number;
  responseLength: number;
  responsePreview: string;
  correctnessScore: number | null; // 0-100 for questions with known answers
  informativeness: 'low' | 'medium' | 'high';
  error?: string;
}

// Difficult questions with expected reasoning patterns
const DIFFICULT_QUESTIONS: Array<{
  question: string;
  difficulty: DifficultyLevel;
  category: string;
  expectedAnswer?: string | RegExp;
  requiresReasoning: boolean;
}> = [
  // Math and Logic
  {
    question: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Show your reasoning step by step.',
    difficulty: 'medium',
    category: 'cognitive-reflection',
    expectedAnswer: /\$?0\.05|5\s*cents|five\s*cents/i,
    requiresReasoning: true
  },
  {
    question: 'If it takes 5 machines 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets? Explain your reasoning.',
    difficulty: 'medium',
    category: 'cognitive-reflection',
    expectedAnswer: /5\s*minutes/i,
    requiresReasoning: true
  },
  {
    question: 'In a lake, there is a patch of lily pads. Every day, the patch doubles in size. If it takes 48 days for the patch to cover the entire lake, how many days would it take for the patch to cover half of the lake? Show your work.',
    difficulty: 'medium',
    category: 'cognitive-reflection',
    expectedAnswer: /47/,
    requiresReasoning: true
  },
  // Harder math
  {
    question: 'Prove that the square root of 2 is irrational. Provide a complete proof.',
    difficulty: 'hard',
    category: 'mathematical-proof',
    requiresReasoning: true
  },
  {
    question: 'A farmer has 17 sheep. All but 9 die. How many sheep are left? Then explain why this problem trips people up.',
    difficulty: 'medium',
    category: 'trick-question',
    expectedAnswer: /9/,
    requiresReasoning: true
  },
  // Logic puzzles
  {
    question: 'Three boxes are labeled "Apples", "Oranges", and "Mixed". Each label is WRONG. You can pick one fruit from one box. How do you correctly label all boxes? Explain the logic.',
    difficulty: 'hard',
    category: 'logic-puzzle',
    requiresReasoning: true
  },
  {
    question: 'You have 12 balls, one is heavier or lighter than the others. You have a balance scale and can only use it 3 times. Describe a strategy to find the odd ball AND determine if it is heavier or lighter.',
    difficulty: 'expert',
    category: 'logic-puzzle',
    requiresReasoning: true
  },
  // Philosophical/Ethical reasoning
  {
    question: 'The trolley problem: A trolley is heading towards 5 people. You can pull a lever to divert it to a track with 1 person. Analyze both utilitarian and deontological perspectives on this dilemma.',
    difficulty: 'hard',
    category: 'ethical-reasoning',
    requiresReasoning: true
  },
  // Complex analysis
  {
    question: 'Explain the P vs NP problem in computer science. Why is it significant, and what would be the implications if P = NP were proven true?',
    difficulty: 'expert',
    category: 'computer-science',
    requiresReasoning: true
  },
  // Multi-step reasoning
  {
    question: 'Alice is taller than Bob. Charlie is shorter than Diana. Bob is taller than Charlie. Diana is shorter than Alice. Rank all four people from tallest to shortest, showing your reasoning.',
    difficulty: 'medium',
    category: 'transitive-reasoning',
    expectedAnswer: /Alice.*Bob.*Diana.*Charlie|Alice.*Diana.*Bob.*Charlie/i,
    requiresReasoning: true
  }
];

test.describe('COT Reasoning Benchmark', () => {
  test.setTimeout(600000); // 10 minute timeout for all tests

  let page: Page;
  let results: COTResult[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Enable console logging for thinking/COT events
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('thinking') || text.includes('COT') || text.includes('reasoning') || text.includes('SSE')) {
        console.log(`[Browser Console] ${text}`);
      }
    });

    // Login flow
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
    // Print comprehensive results summary
    console.log('\n\n' + '='.repeat(70));
    console.log('           COT REASONING BENCHMARK RESULTS');
    console.log('='.repeat(70) + '\n');

    // Group by category
    const byCategory: Record<string, COTResult[]> = {};
    for (const result of results) {
      const cat = DIFFICULT_QUESTIONS.find(q => q.question === result.question)?.category || 'unknown';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(result);
    }

    for (const [category, catResults] of Object.entries(byCategory)) {
      console.log(`\n--- ${category.toUpperCase()} ---\n`);

      for (const result of catResults) {
        const difficultyEmoji = {
          medium: '🟡',
          hard: '🔴',
          expert: '💀'
        }[result.difficulty];

        const infoEmoji = {
          low: '📉',
          medium: '📊',
          high: '📈'
        }[result.informativeness];

        console.log(`${difficultyEmoji} ${result.question.substring(0, 60)}...`);
        console.log(`   Difficulty: ${result.difficulty}`);
        console.log(`   TTFT: ${result.ttftMs}ms`);
        console.log(`   Thinking: ${result.timeToThinkingMs ? `${result.timeToThinkingMs}ms (${result.thinkingDurationMs}ms duration)` : 'N/A'}`);
        console.log(`   Thinking Tokens: ${result.thinkingTokens}`);
        if (result.thinkingSteps.length > 0) {
          console.log(`   Thinking Steps: ${result.thinkingSteps.length}`);
          for (const step of result.thinkingSteps.slice(0, 3)) {
            console.log(`      - ${step.substring(0, 80)}...`);
          }
        }
        console.log(`   Total Time: ${result.totalTimeMs}ms`);
        console.log(`   Response Length: ${result.responseLength} chars`);
        console.log(`   ${infoEmoji} Informativeness: ${result.informativeness}`);
        if (result.correctnessScore !== null) {
          console.log(`   Correctness: ${result.correctnessScore}%`);
        }
        if (result.error) console.log(`   Error: ${result.error}`);
        console.log(`   Preview: "${result.responsePreview.substring(0, 100)}..."`);
        console.log('');
      }
    }

    // Overall statistics
    console.log('\n' + '-'.repeat(70));
    console.log('                     OVERALL STATISTICS');
    console.log('-'.repeat(70));

    const avgTTFT = results.reduce((sum, r) => sum + r.ttftMs, 0) / results.length;
    const avgTotal = results.reduce((sum, r) => sum + r.totalTimeMs, 0) / results.length;
    const avgResponseLength = results.reduce((sum, r) => sum + r.responseLength, 0) / results.length;
    const thinkingResults = results.filter(r => r.timeToThinkingMs !== null);
    const avgThinkingTime = thinkingResults.length > 0
      ? thinkingResults.reduce((sum, r) => sum + (r.timeToThinkingMs || 0), 0) / thinkingResults.length
      : 0;
    const avgThinkingDuration = thinkingResults.filter(r => r.thinkingDurationMs !== null).length > 0
      ? thinkingResults.filter(r => r.thinkingDurationMs !== null).reduce((sum, r) => sum + (r.thinkingDurationMs || 0), 0) / thinkingResults.filter(r => r.thinkingDurationMs !== null).length
      : 0;

    const highInfo = results.filter(r => r.informativeness === 'high').length;
    const medInfo = results.filter(r => r.informativeness === 'medium').length;
    const lowInfo = results.filter(r => r.informativeness === 'low').length;

    console.log(`\nTotal Questions: ${results.length}`);
    console.log(`Average TTFT: ${avgTTFT.toFixed(0)}ms`);
    console.log(`Average Total Time: ${avgTotal.toFixed(0)}ms`);
    console.log(`Average Response Length: ${avgResponseLength.toFixed(0)} characters`);
    console.log(`\nThinking/COT Statistics:`);
    console.log(`  Questions with thinking: ${thinkingResults.length}/${results.length}`);
    console.log(`  Average time to thinking: ${avgThinkingTime.toFixed(0)}ms`);
    console.log(`  Average thinking duration: ${avgThinkingDuration.toFixed(0)}ms`);
    console.log(`\nInformativeness Distribution:`);
    console.log(`  High: ${highInfo} (${(highInfo/results.length*100).toFixed(0)}%)`);
    console.log(`  Medium: ${medInfo} (${(medInfo/results.length*100).toFixed(0)}%)`);
    console.log(`  Low: ${lowInfo} (${(lowInfo/results.length*100).toFixed(0)}%)`);

    const correctnessResults = results.filter(r => r.correctnessScore !== null);
    if (correctnessResults.length > 0) {
      const avgCorrectness = correctnessResults.reduce((sum, r) => sum + (r.correctnessScore || 0), 0) / correctnessResults.length;
      console.log(`\nCorrectness (for verifiable answers):`);
      console.log(`  Average: ${avgCorrectness.toFixed(0)}%`);
      console.log(`  Perfect (100%): ${correctnessResults.filter(r => r.correctnessScore === 100).length}/${correctnessResults.length}`);
    }

    console.log('\n' + '='.repeat(70) + '\n');

    await page.close();
  });

  async function measureCOTReasoning(
    questionObj: typeof DIFFICULT_QUESTIONS[0],
    model: string = 'gemini-2.5-flash'
  ): Promise<COTResult> {
    const submitTime = Date.now();
    let ttftTime: number | null = null;
    let thinkingStartTime: number | null = null;
    let thinkingEndTime: number | null = null;
    let completeTime: number | null = null;
    let error: string | undefined;
    let responseText = '';
    let thinkingTokens = 0;
    const thinkingSteps: string[] = [];

    // Try to start a new chat
    const newChatButton = page.locator('[data-testid="new-chat"], button:has-text("New Chat"), button:has-text("New Conversation"), [aria-label="New chat"]').first();
    if (await newChatButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await newChatButton.click();
      await page.waitForTimeout(500);
    }

    // Find chat input
    const chatInput = page.locator('[data-testid="chat-input"], textarea, input[type="text"]').first();
    await chatInput.waitFor({ state: 'visible', timeout: 10000 });

    // Clear and fill
    await chatInput.fill('');
    await chatInput.fill(questionObj.question);

    // Set up SSE event interception to capture thinking events
    const sseEvents: Array<{type: string; data: any; timestamp: number}> = [];

    await page.route('**/api/chat/stream**', async route => {
      const response = await route.fetch();
      const body = await response.text();

      // Parse SSE events
      const lines = body.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.substring(5).trim());
            sseEvents.push({
              type: data.type || 'unknown',
              data,
              timestamp: Date.now()
            });

            // Track thinking events
            if (data.type === 'thinking' || data.type === 'thinking_event' || data.type === 'cot_step') {
              if (!thinkingStartTime) thinkingStartTime = Date.now();
              if (data.content) {
                thinkingSteps.push(data.content);
                thinkingTokens += data.content.split(/\s+/).length;
              }
            }

            if (data.type === 'thinking_complete') {
              thinkingEndTime = Date.now();
            }
          } catch {
            // Not JSON, skip
          }
        }
      }

      await route.fulfill({ response });
    });

    // Set up mutation observer for TTFT
    const firstVisiblePromise = page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const startTime = Date.now();
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.type === 'childList' || mutation.type === 'characterData') {
              const target = mutation.target as Element;
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

        setTimeout(() => {
          observer.disconnect();
          resolve(-1);
        }, 120000);
      });
    });

    // Submit
    const sendButton = page.locator('[data-testid="send-button"], button[type="submit"], button:has-text("Send")').first();
    if (await sendButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await sendButton.click();
    } else {
      await chatInput.press('Enter');
    }

    const actualSubmitTime = Date.now();
    console.log(`[${questionObj.difficulty.toUpperCase()}] Submitted: "${questionObj.question.substring(0, 50)}..."`);

    // Wait for TTFT
    try {
      const observerTTFT = await Promise.race([
        firstVisiblePromise,
        new Promise<number>((_, reject) => setTimeout(() => reject(new Error('TTFT timeout')), 120000))
      ]);

      if (observerTTFT !== -1) {
        ttftTime = actualSubmitTime + observerTTFT;
        console.log(`  TTFT: ${observerTTFT}ms`);
      }
    } catch (e) {
      error = 'TTFT measurement failed: ' + (e as Error).message;
    }

    // Wait for streaming to complete
    try {
      await page.waitForFunction(() => {
        const streamingIndicator = document.querySelector('[data-streaming="true"]') ||
                                   document.querySelector('.streaming') ||
                                   document.querySelector('[class*="cursor"]');
        return !streamingIndicator;
      }, { timeout: 120000 });
    } catch {
      // If timeout, that's okay
    }

    completeTime = Date.now();

    // Get the response text
    try {
      responseText = await page.evaluate(() => {
        const assistantMessages = document.querySelectorAll('[data-role="assistant"], .assistant-message');
        const lastMessage = assistantMessages[assistantMessages.length - 1];
        return lastMessage?.textContent || '';
      });
    } catch {
      responseText = '';
    }

    // Clear route interception
    await page.unroute('**/api/chat/stream**');

    // Evaluate informativeness based on response length and structure
    let informativeness: 'low' | 'medium' | 'high' = 'low';
    if (responseText.length > 1000 && (responseText.includes('because') || responseText.includes('therefore') || responseText.includes('step'))) {
      informativeness = 'high';
    } else if (responseText.length > 300) {
      informativeness = 'medium';
    }

    // Check correctness for questions with expected answers
    let correctnessScore: number | null = null;
    if (questionObj.expectedAnswer) {
      if (typeof questionObj.expectedAnswer === 'string') {
        correctnessScore = responseText.toLowerCase().includes(questionObj.expectedAnswer.toLowerCase()) ? 100 : 0;
      } else {
        correctnessScore = questionObj.expectedAnswer.test(responseText) ? 100 : 0;
      }
    }

    const result: COTResult = {
      question: questionObj.question,
      difficulty: questionObj.difficulty,
      model,
      ttftMs: ttftTime ? ttftTime - actualSubmitTime : -1,
      timeToThinkingMs: thinkingStartTime ? thinkingStartTime - actualSubmitTime : null,
      thinkingDurationMs: thinkingStartTime && thinkingEndTime ? thinkingEndTime - thinkingStartTime : null,
      thinkingTokens,
      thinkingSteps,
      totalTimeMs: completeTime - actualSubmitTime,
      responseLength: responseText.length,
      responsePreview: responseText.substring(0, 200).replace(/\n/g, ' '),
      correctnessScore,
      informativeness,
      error
    };

    results.push(result);
    console.log(`  Total: ${result.totalTimeMs}ms, Response: ${result.responseLength} chars, Informativeness: ${result.informativeness}`);

    return result;
  }

  // Run tests for each difficulty level
  test('COT - Medium difficulty: Bat and Ball problem', async () => {
    const q = DIFFICULT_QUESTIONS.find(q => q.question.includes('bat and a ball'))!;
    const result = await measureCOTReasoning(q);
    expect(result.ttftMs).toBeGreaterThan(0);
    expect(result.correctnessScore).toBe(100);
  });

  test('COT - Medium difficulty: Widget machines', async () => {
    await page.waitForTimeout(3000);
    const q = DIFFICULT_QUESTIONS.find(q => q.question.includes('5 machines'))!;
    const result = await measureCOTReasoning(q);
    expect(result.ttftMs).toBeGreaterThan(0);
    expect(result.correctnessScore).toBe(100);
  });

  test('COT - Medium difficulty: Lily pads', async () => {
    await page.waitForTimeout(3000);
    const q = DIFFICULT_QUESTIONS.find(q => q.question.includes('lily pads'))!;
    const result = await measureCOTReasoning(q);
    expect(result.ttftMs).toBeGreaterThan(0);
    expect(result.correctnessScore).toBe(100);
  });

  test('COT - Hard difficulty: Square root of 2 proof', async () => {
    await page.waitForTimeout(3000);
    const q = DIFFICULT_QUESTIONS.find(q => q.question.includes('square root of 2'))!;
    const result = await measureCOTReasoning(q);
    expect(result.ttftMs).toBeGreaterThan(0);
    expect(result.informativeness).not.toBe('low');
  });

  test('COT - Medium difficulty: Sheep trick question', async () => {
    await page.waitForTimeout(3000);
    const q = DIFFICULT_QUESTIONS.find(q => q.question.includes('17 sheep'))!;
    const result = await measureCOTReasoning(q);
    expect(result.ttftMs).toBeGreaterThan(0);
    expect(result.correctnessScore).toBe(100);
  });

  test('COT - Hard difficulty: Three boxes logic puzzle', async () => {
    await page.waitForTimeout(3000);
    const q = DIFFICULT_QUESTIONS.find(q => q.question.includes('Three boxes'))!;
    const result = await measureCOTReasoning(q);
    expect(result.ttftMs).toBeGreaterThan(0);
    expect(result.informativeness).not.toBe('low');
  });

  test('COT - Expert difficulty: 12 balls balance problem', async () => {
    await page.waitForTimeout(3000);
    const q = DIFFICULT_QUESTIONS.find(q => q.question.includes('12 balls'))!;
    const result = await measureCOTReasoning(q);
    expect(result.ttftMs).toBeGreaterThan(0);
    // This is a very hard problem, even getting a reasonable attempt is good
  });

  test('COT - Hard difficulty: Trolley problem analysis', async () => {
    await page.waitForTimeout(3000);
    const q = DIFFICULT_QUESTIONS.find(q => q.question.includes('trolley'))!;
    const result = await measureCOTReasoning(q);
    expect(result.ttftMs).toBeGreaterThan(0);
    expect(result.informativeness).toBe('high');
  });

  test('COT - Expert difficulty: P vs NP explanation', async () => {
    await page.waitForTimeout(3000);
    const q = DIFFICULT_QUESTIONS.find(q => q.question.includes('P vs NP'))!;
    const result = await measureCOTReasoning(q);
    expect(result.ttftMs).toBeGreaterThan(0);
    expect(result.informativeness).not.toBe('low');
  });

  test('COT - Medium difficulty: Transitive reasoning', async () => {
    await page.waitForTimeout(3000);
    const q = DIFFICULT_QUESTIONS.find(q => q.question.includes('Alice is taller'))!;
    const result = await measureCOTReasoning(q);
    expect(result.ttftMs).toBeGreaterThan(0);
    // The expected answer allows for two valid orderings
  });
});
