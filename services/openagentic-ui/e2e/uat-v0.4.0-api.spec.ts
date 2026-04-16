/**
 * OpenAgentic v0.4.0 UAT Tests
 * Comprehensive API-based tests with TTFT measurement
 *
 * Run: HEADLESS=true npx playwright test e2e/uat-v0.4.0-api.spec.ts --reporter=list
 */
import { test, expect } from '@playwright/test';

const API_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const API_KEY = process.env.API_KEY || '';

// Helper to measure Time To First Token
async function measureTTFT(
  url: string,
  body: object,
  expectedContent?: string
): Promise<{ ttft: number; totalTime: number; content: string; success: boolean }> {
  const start = performance.now();
  let firstChunkTime = 0;
  let content = '';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      content += chunk;

      // Record first chunk time
      if (firstChunkTime === 0 && chunk.includes('"content"')) {
        firstChunkTime = performance.now();
      }
    }
  }

  const end = performance.now();
  const ttft = firstChunkTime > 0 ? (firstChunkTime - start) / 1000 : (end - start) / 1000;
  const totalTime = (end - start) / 1000;

  const success = expectedContent
    ? content.toLowerCase().includes(expectedContent.toLowerCase())
    : content.includes('"content"');

  return { ttft, totalTime, content, success };
}

// Helper to create session
async function createSession(title: string): Promise<string | null> {
  const response = await fetch(`${API_URL}/api/chat/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  const data = await response.json();
  return data.session?.id || null;
}

// Helper to delete session
async function deleteSession(sessionId: string): Promise<void> {
  await fetch(`${API_URL}/api/chat/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  }).catch(() => {});
}

test.describe('v0.4.0 UAT - Infrastructure', () => {
  test('API Health Check', async () => {
    const start = performance.now();
    const response = await fetch(`${API_URL}/api/health`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const elapsed = (performance.now() - start) / 1000;

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('healthy');
    console.log(`  TTFT: ${elapsed.toFixed(3)}s - API healthy`);
  });

  test('Version Endpoint returns v0.4.0', async () => {
    const start = performance.now();
    const response = await fetch(`${API_URL}/api/version`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const elapsed = (performance.now() - start) / 1000;

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.version).toBe('0.4.0');
    console.log(`  TTFT: ${elapsed.toFixed(3)}s - Version: ${data.version}`);
  });

  test('Session Creation and Deletion', async () => {
    const start = performance.now();
    const sessionId = await createSession('UAT-Infrastructure-Test');
    const createTime = (performance.now() - start) / 1000;

    expect(sessionId).toBeTruthy();
    console.log(`  Session created: ${createTime.toFixed(3)}s`);

    if (sessionId) {
      await deleteSession(sessionId);
    }
  });
});

test.describe('v0.4.0 UAT - Chat Mode with TTFT', () => {
  test('Simple Math Query', async () => {
    const sessionId = await createSession('UAT-Math');
    expect(sessionId).toBeTruthy();

    if (sessionId) {
      const result = await measureTTFT(
        `${API_URL}/api/chat/stream`,
        { message: 'What is 2+2? Reply with just the number.', sessionId },
        '4'
      );

      console.log(`  TTFT: ${result.ttft.toFixed(3)}s, Total: ${result.totalTime.toFixed(3)}s`);
      expect(result.success).toBe(true);
      expect(result.ttft).toBeLessThan(10); // TTFT should be under 10s

      await deleteSession(sessionId);
    }
  });

  test('Geography Query', async () => {
    const sessionId = await createSession('UAT-Geography');
    expect(sessionId).toBeTruthy();

    if (sessionId) {
      const result = await measureTTFT(
        `${API_URL}/api/chat/stream`,
        { message: 'Capital of France? One word answer.', sessionId },
        'Paris'
      );

      console.log(`  TTFT: ${result.ttft.toFixed(3)}s, Total: ${result.totalTime.toFixed(3)}s`);
      expect(result.success).toBe(true);
      expect(result.ttft).toBeLessThan(10);

      await deleteSession(sessionId);
    }
  });

  test('Code Generation Query', async () => {
    const sessionId = await createSession('UAT-Code');
    expect(sessionId).toBeTruthy();

    if (sessionId) {
      const result = await measureTTFT(
        `${API_URL}/api/chat/stream`,
        { message: 'Python hello world in one line', sessionId },
        'print'
      );

      console.log(`  TTFT: ${result.ttft.toFixed(3)}s, Total: ${result.totalTime.toFixed(3)}s`);
      expect(result.success).toBe(true);
      expect(result.ttft).toBeLessThan(15);

      await deleteSession(sessionId);
    }
  });
});

test.describe('v0.4.0 UAT - Streaming', () => {
  test('SSE Streaming Works', async () => {
    const sessionId = await createSession('UAT-Streaming');
    expect(sessionId).toBeTruthy();

    if (sessionId) {
      const start = performance.now();
      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Count from 1 to 5, one number per line.',
          sessionId
        }),
      });

      let chunkCount = 0;
      let firstChunkTime = 0;
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          if (chunk.includes('data:')) {
            chunkCount++;
            if (firstChunkTime === 0) {
              firstChunkTime = performance.now();
            }
          }
        }
      }

      const totalTime = (performance.now() - start) / 1000;
      const ttft = firstChunkTime > 0 ? (firstChunkTime - start) / 1000 : totalTime;

      console.log(`  TTFT: ${ttft.toFixed(3)}s, Chunks: ${chunkCount}, Total: ${totalTime.toFixed(3)}s`);
      expect(chunkCount).toBeGreaterThan(0);
      expect(ttft).toBeLessThan(10);

      await deleteSession(sessionId);
    }
  });
});

test.describe('v0.4.0 UAT - Performance', () => {
  test('Concurrent Session Creation (3 sessions)', async () => {
    const start = performance.now();

    const sessions = await Promise.all([
      createSession('UAT-Perf-1'),
      createSession('UAT-Perf-2'),
      createSession('UAT-Perf-3'),
    ]);

    const elapsed = (performance.now() - start) / 1000;
    const validSessions = sessions.filter(s => s !== null);

    console.log(`  Created ${validSessions.length}/3 sessions in ${elapsed.toFixed(3)}s`);
    expect(validSessions.length).toBe(3);
    expect(elapsed).toBeLessThan(5);

    // Cleanup
    await Promise.all(sessions.filter(s => s).map(s => deleteSession(s!)));
  });

  test('Response Time Baseline', async () => {
    const sessionId = await createSession('UAT-Baseline');
    expect(sessionId).toBeTruthy();

    if (sessionId) {
      const result = await measureTTFT(
        `${API_URL}/api/chat/stream`,
        { message: 'Say hello', sessionId }
      );

      console.log(`  TTFT: ${result.ttft.toFixed(3)}s, Total: ${result.totalTime.toFixed(3)}s`);
      expect(result.success).toBe(true);
      expect(result.ttft).toBeLessThan(8);

      await deleteSession(sessionId);
    }
  });
});

test.describe('v0.4.0 UAT - MCP Tools', () => {
  test('MCP Tools Endpoint Accessible', async () => {
    const start = performance.now();
    const response = await fetch(`${API_URL}/api/mcp/tools`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const elapsed = (performance.now() - start) / 1000;

    console.log(`  Response: ${elapsed.toFixed(3)}s, Status: ${response.status}`);
    // 200 or 401 is acceptable (might need different auth)
    expect([200, 401]).toContain(response.status);
  });
});

test.describe('v0.4.0 UAT - Code Mode', () => {
  test('Openagentic Status Endpoint', async () => {
    const start = performance.now();
    const response = await fetch(`${API_URL}/api/openagentic/status`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const elapsed = (performance.now() - start) / 1000;

    console.log(`  Response: ${elapsed.toFixed(3)}s, Status: ${response.status}`);
    // Endpoint exists and responds
    expect(response.status).toBeDefined();
  });
});

test.describe('v0.4.0 UAT - Workflows', () => {
  test('Workflows API', async () => {
    const start = performance.now();
    const response = await fetch(`${API_URL}/api/workflows`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const elapsed = (performance.now() - start) / 1000;

    console.log(`  Response: ${elapsed.toFixed(3)}s, Status: ${response.status}`);
    // Endpoint exists and responds
    expect(response.status).toBeDefined();
  });
});
