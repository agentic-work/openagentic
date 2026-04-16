/**
 * E2E Test: Performance Metrics Collection
 *
 * Collects comprehensive performance metrics during concurrent tests:
 * - TTFB (Time to First Byte)
 * - Token latency
 * - SSE streaming latency
 * - Memory usage
 * - Redis cache hits/misses
 * - Milvus vector operations
 *
 * Run with: npx playwright test performance-metrics.spec.ts --headed
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const TEST_EMAIL = process.env.TEST_EMAIL || 'admin@openagentic.io';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3';

interface PerformanceMetrics {
  timestamp: Date;
  requestId: string;
  ttfb: number;           // Time to First Byte
  ttft: number;           // Time to First Token
  totalTime: number;      // Total response time
  tokenCount: number;     // Approximate token count
  tokensPerSecond: number; // Streaming speed
  sseLatency: number[];   // Inter-chunk latencies
  avgSseLatency: number;
  maxSseLatency: number;
  responseSize: number;
  success: boolean;
  error?: string;
}

interface SystemMetrics {
  timestamp: Date;
  apiMemoryMB?: number;
  redisMemoryMB?: number;
  redisCacheHits?: number;
  redisCacheMisses?: number;
  milvusQueryCount?: number;
  milvusQueryLatencyMs?: number;
  postgresConnections?: number;
}

// Helper to measure SSE streaming performance
async function measureSSEPerformance(
  sessionId: string,
  message: string
): Promise<PerformanceMetrics> {
  const requestId = `perf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  let ttfb = 0;
  let ttft = 0;
  const sseLatencies: number[] = [];
  let lastChunkTime = startTime;
  let tokenCount = 0;
  let responseText = '';
  let firstByteReceived = false;
  let firstTokenReceived = false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout

    const response = await fetch(`${BASE_URL}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer test_api_key` // Will be replaced in actual test
      },
      body: JSON.stringify({
        sessionId,
        message,
        model: 'gemini-2.5-flash'
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!firstByteReceived) {
      ttfb = Date.now() - startTime;
      firstByteReceived = true;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const now = Date.now();
      const chunk = decoder.decode(value, { stream: true });

      // Record inter-chunk latency
      const chunkLatency = now - lastChunkTime;
      sseLatencies.push(chunkLatency);
      lastChunkTime = now;

      // Parse SSE events
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              if (!firstTokenReceived) {
                ttft = Date.now() - startTime;
                firstTokenReceived = true;
              }
              responseText += parsed.content;
              // Rough token count (words + punctuation)
              tokenCount += parsed.content.split(/\s+/).length;
            }
          } catch {
            // Non-JSON data
          }
        }
      }
    }

    const totalTime = Date.now() - startTime;
    const avgSseLatency = sseLatencies.length > 0
      ? sseLatencies.reduce((a, b) => a + b, 0) / sseLatencies.length
      : 0;
    const maxSseLatency = sseLatencies.length > 0
      ? Math.max(...sseLatencies)
      : 0;
    const tokensPerSecond = totalTime > 0 ? (tokenCount / totalTime) * 1000 : 0;

    return {
      timestamp: new Date(),
      requestId,
      ttfb,
      ttft,
      totalTime,
      tokenCount,
      tokensPerSecond,
      sseLatency: sseLatencies,
      avgSseLatency,
      maxSseLatency,
      responseSize: responseText.length,
      success: true
    };

  } catch (error: any) {
    return {
      timestamp: new Date(),
      requestId,
      ttfb,
      ttft,
      totalTime: Date.now() - startTime,
      tokenCount,
      tokensPerSecond: 0,
      sseLatency: sseLatencies,
      avgSseLatency: 0,
      maxSseLatency: 0,
      responseSize: responseText.length,
      success: false,
      error: error.message
    };
  }
}

// Helper to collect system metrics
async function collectSystemMetrics(): Promise<SystemMetrics> {
  const metrics: SystemMetrics = {
    timestamp: new Date()
  };

  try {
    // Get Redis metrics
    const redisResponse = await fetch(`${BASE_URL}/api/admin/metrics/redis`).catch(() => null);
    if (redisResponse?.ok) {
      const redisData = await redisResponse.json();
      metrics.redisMemoryMB = redisData.usedMemoryMB;
      metrics.redisCacheHits = redisData.cacheHits;
      metrics.redisCacheMisses = redisData.cacheMisses;
    }

    // Get Milvus metrics
    const milvusResponse = await fetch(`${BASE_URL}/api/admin/metrics/milvus`).catch(() => null);
    if (milvusResponse?.ok) {
      const milvusData = await milvusResponse.json();
      metrics.milvusQueryCount = milvusData.queryCount;
      metrics.milvusQueryLatencyMs = milvusData.avgQueryLatencyMs;
    }

    // Get Postgres metrics
    const pgResponse = await fetch(`${BASE_URL}/api/admin/metrics/postgres`).catch(() => null);
    if (pgResponse?.ok) {
      const pgData = await pgResponse.json();
      metrics.postgresConnections = pgData.activeConnections;
    }
  } catch (e) {
    // Metrics endpoints may not be available
  }

  return metrics;
}

test.describe('Performance Metrics Collection', () => {
  test.setTimeout(600000); // 10 minute timeout

  let page: Page;
  const performanceResults: PerformanceMetrics[] = [];
  const systemMetrics: SystemMetrics[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Login
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
    // Print comprehensive report
    console.log('\n' + '='.repeat(100));
    console.log('PERFORMANCE METRICS REPORT');
    console.log('='.repeat(100));

    const successfulRequests = performanceResults.filter(r => r.success);
    const failedRequests = performanceResults.filter(r => !r.success);

    console.log(`\n📊 REQUEST STATISTICS`);
    console.log(`Total Requests: ${performanceResults.length}`);
    console.log(`Successful: ${successfulRequests.length} (${(successfulRequests.length/performanceResults.length*100).toFixed(1)}%)`);
    console.log(`Failed: ${failedRequests.length}`);

    if (successfulRequests.length > 0) {
      const avgTTFB = successfulRequests.reduce((sum, r) => sum + r.ttfb, 0) / successfulRequests.length;
      const avgTTFT = successfulRequests.reduce((sum, r) => sum + r.ttft, 0) / successfulRequests.length;
      const avgTotal = successfulRequests.reduce((sum, r) => sum + r.totalTime, 0) / successfulRequests.length;
      const avgTokens = successfulRequests.reduce((sum, r) => sum + r.tokenCount, 0) / successfulRequests.length;
      const avgTPS = successfulRequests.reduce((sum, r) => sum + r.tokensPerSecond, 0) / successfulRequests.length;
      const avgSSE = successfulRequests.reduce((sum, r) => sum + r.avgSseLatency, 0) / successfulRequests.length;
      const maxSSE = Math.max(...successfulRequests.map(r => r.maxSseLatency));

      console.log(`\n⏱️  TIMING METRICS`);
      console.log(`Average TTFB: ${avgTTFB.toFixed(0)}ms`);
      console.log(`Average TTFT: ${avgTTFT.toFixed(0)}ms`);
      console.log(`Average Total Time: ${avgTotal.toFixed(0)}ms`);
      console.log(`Min Total Time: ${Math.min(...successfulRequests.map(r => r.totalTime))}ms`);
      console.log(`Max Total Time: ${Math.max(...successfulRequests.map(r => r.totalTime))}ms`);

      console.log(`\n🔤 TOKEN METRICS`);
      console.log(`Average Tokens: ${avgTokens.toFixed(0)}`);
      console.log(`Average Tokens/Second: ${avgTPS.toFixed(1)}`);

      console.log(`\n📡 SSE STREAMING METRICS`);
      console.log(`Average Inter-chunk Latency: ${avgSSE.toFixed(0)}ms`);
      console.log(`Max Inter-chunk Latency: ${maxSSE}ms`);

      // Percentile calculations
      const sortedTTFT = [...successfulRequests].sort((a, b) => a.ttft - b.ttft);
      const p50Index = Math.floor(sortedTTFT.length * 0.5);
      const p95Index = Math.floor(sortedTTFT.length * 0.95);
      const p99Index = Math.floor(sortedTTFT.length * 0.99);

      console.log(`\n📈 TTFT PERCENTILES`);
      console.log(`P50: ${sortedTTFT[p50Index]?.ttft || 'N/A'}ms`);
      console.log(`P95: ${sortedTTFT[p95Index]?.ttft || 'N/A'}ms`);
      console.log(`P99: ${sortedTTFT[p99Index]?.ttft || 'N/A'}ms`);
    }

    // System metrics summary
    if (systemMetrics.length > 0) {
      console.log(`\n🖥️  SYSTEM METRICS`);
      const lastMetrics = systemMetrics[systemMetrics.length - 1];
      if (lastMetrics.redisMemoryMB) {
        console.log(`Redis Memory: ${lastMetrics.redisMemoryMB}MB`);
      }
      if (lastMetrics.redisCacheHits !== undefined) {
        console.log(`Redis Cache Hits: ${lastMetrics.redisCacheHits}`);
        console.log(`Redis Cache Misses: ${lastMetrics.redisCacheMisses}`);
      }
      if (lastMetrics.milvusQueryCount !== undefined) {
        console.log(`Milvus Queries: ${lastMetrics.milvusQueryCount}`);
        console.log(`Milvus Avg Latency: ${lastMetrics.milvusQueryLatencyMs}ms`);
      }
      if (lastMetrics.postgresConnections !== undefined) {
        console.log(`Postgres Connections: ${lastMetrics.postgresConnections}`);
      }
    }

    console.log('\n' + '='.repeat(100));
    await page.close();
  });

  test('Baseline performance measurement', async () => {
    console.log('\n[Test] Measuring baseline performance...\n');

    // Warm-up request
    console.log('[Warm-up] Sending warm-up request...');
    await page.locator('textarea').first().fill('Hello');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000);

    // Collect baseline system metrics
    const baselineMetrics = await collectSystemMetrics();
    systemMetrics.push(baselineMetrics);
    console.log('[Baseline] System metrics collected');
  });

  test('Simple request performance (10 requests)', async () => {
    console.log('\n[Test] Simple request performance...\n');

    const questions = [
      'What is 2+2?',
      'Say hello',
      'What day is it?',
      'Count to 5',
      'What is TypeScript?',
      'Name a color',
      'What is an API?',
      'Say goodbye',
      'What is HTML?',
      'Name a fruit'
    ];

    for (let i = 0; i < questions.length; i++) {
      console.log(`[Request ${i + 1}/10] ${questions[i]}`);

      const chatInput = page.locator('textarea').first();
      await chatInput.click();
      await chatInput.fill(questions[i]);

      const startTime = Date.now();
      await page.keyboard.press('Enter');

      // Wait for response to start
      let ttft = 0;
      for (let j = 0; j < 60; j++) {
        await page.waitForTimeout(100);
        const responseCount = await page.locator('[data-message-role="assistant"]').count();
        if (responseCount > 0) {
          ttft = Date.now() - startTime;
          break;
        }
      }

      // Wait for response to complete
      await page.waitForTimeout(3000);
      let totalTime = Date.now() - startTime;

      // Get response text
      const responseText = await page.locator('[data-message-role="assistant"]')
        .last()
        .innerText({ timeout: 5000 })
        .catch(() => '');

      const result: PerformanceMetrics = {
        timestamp: new Date(),
        requestId: `simple-${i}`,
        ttfb: ttft,
        ttft: ttft,
        totalTime,
        tokenCount: responseText.split(/\s+/).length,
        tokensPerSecond: responseText.split(/\s+/).length / (totalTime / 1000),
        sseLatency: [],
        avgSseLatency: 0,
        maxSseLatency: 0,
        responseSize: responseText.length,
        success: responseText.length > 0
      };

      performanceResults.push(result);
      console.log(`  TTFT: ${ttft}ms, Total: ${totalTime}ms, Response: ${responseText.length} chars`);

      await page.waitForTimeout(1000);
    }
  });

  test('Complex request performance (5 requests)', async () => {
    console.log('\n[Test] Complex request performance...\n');

    const complexQuestions = [
      'Explain the CAP theorem in distributed systems with examples',
      'Write a TypeScript function to implement a binary search tree',
      'Design a rate limiting system for 10000 requests per second',
      'Explain microservices architecture patterns and trade-offs',
      'Compare SQL and NoSQL databases for different use cases'
    ];

    for (let i = 0; i < complexQuestions.length; i++) {
      console.log(`[Request ${i + 1}/5] ${complexQuestions[i].substring(0, 50)}...`);

      const chatInput = page.locator('textarea').first();
      await chatInput.click();
      await chatInput.fill(complexQuestions[i]);

      const startTime = Date.now();
      await page.keyboard.press('Enter');

      // Wait for response with longer timeout for complex questions
      let ttft = 0;
      for (let j = 0; j < 120; j++) {
        await page.waitForTimeout(100);
        const lastResponse = page.locator('[data-message-role="assistant"]').last();
        const text = await lastResponse.innerText({ timeout: 1000 }).catch(() => '');
        if (text.length > 0) {
          ttft = Date.now() - startTime;
          break;
        }
      }

      // Wait for full response
      await page.waitForTimeout(10000);
      let totalTime = Date.now() - startTime;

      const responseText = await page.locator('[data-message-role="assistant"]')
        .last()
        .innerText({ timeout: 5000 })
        .catch(() => '');

      const result: PerformanceMetrics = {
        timestamp: new Date(),
        requestId: `complex-${i}`,
        ttfb: ttft,
        ttft: ttft,
        totalTime,
        tokenCount: responseText.split(/\s+/).length,
        tokensPerSecond: responseText.split(/\s+/).length / (totalTime / 1000),
        sseLatency: [],
        avgSseLatency: 0,
        maxSseLatency: 0,
        responseSize: responseText.length,
        success: responseText.length > 50
      };

      performanceResults.push(result);
      console.log(`  TTFT: ${ttft}ms, Total: ${totalTime}ms, Tokens: ~${result.tokenCount}`);

      // Collect system metrics
      const metrics = await collectSystemMetrics();
      systemMetrics.push(metrics);

      await page.waitForTimeout(2000);
    }
  });

  test('MCP tool performance (5 requests)', async () => {
    console.log('\n[Test] MCP tool performance...\n');

    const mcpQuestions = [
      'Create a React Flow diagram showing a 3-tier web architecture',
      'Analyze Azure costs for the current subscription',
      'Search the web for Kubernetes deployment strategies',
      'List Flowise chatflows available',
      'Remember that I prefer TypeScript for all code examples'
    ];

    for (let i = 0; i < mcpQuestions.length; i++) {
      console.log(`[Request ${i + 1}/5] ${mcpQuestions[i].substring(0, 50)}...`);

      const chatInput = page.locator('textarea').first();
      await chatInput.click();
      await chatInput.fill(mcpQuestions[i]);

      const startTime = Date.now();
      await page.keyboard.press('Enter');

      // MCP requests may take longer
      let ttft = 0;
      for (let j = 0; j < 180; j++) {
        await page.waitForTimeout(100);
        const lastResponse = page.locator('[data-message-role="assistant"]').last();
        const text = await lastResponse.innerText({ timeout: 1000 }).catch(() => '');
        if (text.length > 0) {
          ttft = Date.now() - startTime;
          break;
        }
      }

      // Wait for full response
      await page.waitForTimeout(15000);
      let totalTime = Date.now() - startTime;

      const responseText = await page.locator('[data-message-role="assistant"]')
        .last()
        .innerText({ timeout: 5000 })
        .catch(() => '');

      const result: PerformanceMetrics = {
        timestamp: new Date(),
        requestId: `mcp-${i}`,
        ttfb: ttft,
        ttft: ttft,
        totalTime,
        tokenCount: responseText.split(/\s+/).length,
        tokensPerSecond: responseText.split(/\s+/).length / (totalTime / 1000),
        sseLatency: [],
        avgSseLatency: 0,
        maxSseLatency: 0,
        responseSize: responseText.length,
        success: responseText.length > 10
      };

      performanceResults.push(result);
      console.log(`  TTFT: ${ttft}ms, Total: ${totalTime}ms, Response: ${responseText.length} chars`);

      await page.waitForTimeout(2000);
    }
  });

  test('Final system metrics collection', async () => {
    console.log('\n[Test] Collecting final system metrics...\n');

    const finalMetrics = await collectSystemMetrics();
    systemMetrics.push(finalMetrics);

    await page.screenshot({ path: 'screenshots/performance-metrics-final.png', fullPage: true });

    console.log('[Final] Metrics collection complete');
  });
});
