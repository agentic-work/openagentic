/**
 * WebSocket Tests
 *
 * Tests for PTY WebSocket connection, output streaming, and reconnection.
 */

import type { TestResult } from './index.js';

interface TestConfig {
  baseUrl: string;
  token: string;
  timeout: number;
  verbose: boolean;
}

// Simple WebSocket-like interface for Node.js
async function createWebSocket(url: string, timeout: number): Promise<{
  connected: boolean;
  output: string;
  error?: string;
  close: () => void;
}> {
  return new Promise(async (resolve) => {
    try {
      // Dynamic import of ws
      const { WebSocket } = await import('ws');

      let output = '';
      let connected = false;
      let ws: any;

      const timeoutId = setTimeout(() => {
        if (ws) ws.close();
        resolve({ connected, output, error: 'Timeout', close: () => {} });
      }, timeout);

      ws = new WebSocket(url);

      ws.on('open', () => {
        connected = true;
      });

      ws.on('message', (data: any) => {
        output += data.toString();
      });

      ws.on('error', (err: any) => {
        clearTimeout(timeoutId);
        resolve({ connected: false, output, error: err.message, close: () => ws?.close() });
      });

      ws.on('close', () => {
        clearTimeout(timeoutId);
        resolve({ connected, output, close: () => {} });
      });

      // Resolve after collecting some output
      setTimeout(() => {
        clearTimeout(timeoutId);
        resolve({ connected, output, close: () => ws?.close() });
      }, 3000);

    } catch (error: any) {
      resolve({ connected: false, output: '', error: error.message, close: () => {} });
    }
  });
}

async function testWebSocketConnection(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  try {
    // First provision a session to get WebSocket URL
    const provisionResponse = await fetch(`${config.baseUrl}/api/openagentic/provision`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
      }),
    });

    if (!provisionResponse.ok) {
      return {
        name: 'WebSocket connection',
        passed: false,
        duration: Date.now() - startTime,
        error: 'Provisioning failed',
      };
    }

    const session = await provisionResponse.json();
    (config as any)._session = session;

    if (!session.wsUrl) {
      return {
        name: 'WebSocket connection',
        passed: false,
        duration: Date.now() - startTime,
        error: 'No wsUrl in session response',
      };
    }

    // Add auth to WebSocket URL if needed
    let wsUrl = session.wsUrl;
    if (!wsUrl.includes('token=')) {
      const separator = wsUrl.includes('?') ? '&' : '?';
      wsUrl = `${wsUrl}${separator}token=${config.token}`;
    }

    const result = await createWebSocket(wsUrl, config.timeout);

    if (!result.connected) {
      return {
        name: 'WebSocket connection',
        passed: false,
        duration: Date.now() - startTime,
        error: result.error || 'Connection failed',
        details: { wsUrl: session.wsUrl },
      };
    }

    result.close();

    return {
      name: 'WebSocket connection',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        sessionId: session.sessionId,
        connected: true,
        outputLength: result.output.length,
      },
    };
  } catch (error: any) {
    return {
      name: 'WebSocket connection',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testWebSocketOutput(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  const session = (config as any)._session;

  if (!session?.wsUrl) {
    return {
      name: 'WebSocket receives CLI output',
      passed: false,
      duration: Date.now() - startTime,
      error: 'No session/wsUrl from previous test',
    };
  }

  try {
    let wsUrl = session.wsUrl;
    if (!wsUrl.includes('token=')) {
      const separator = wsUrl.includes('?') ? '&' : '?';
      wsUrl = `${wsUrl}${separator}token=${config.token}`;
    }

    const result = await createWebSocket(wsUrl, config.timeout);
    result.close();

    // Check if we received any output
    if (result.output.length === 0) {
      return {
        name: 'WebSocket receives CLI output',
        passed: false,
        duration: Date.now() - startTime,
        error: 'No output received',
      };
    }

    // Check for CLI banner/prompt indicators
    const hasCliIndicator = /claude|openagentic|>|$/i.test(result.output);

    return {
      name: 'WebSocket receives CLI output',
      passed: result.output.length > 0,
      duration: Date.now() - startTime,
      details: {
        outputLength: result.output.length,
        hasCliIndicator,
        sample: result.output.substring(0, 200),
      },
    };
  } catch (error: any) {
    return {
      name: 'WebSocket receives CLI output',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testWebSocketReconnect(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  const session = (config as any)._session;

  if (!session?.wsUrl) {
    return {
      name: 'WebSocket reconnection',
      passed: false,
      duration: Date.now() - startTime,
      error: 'No session/wsUrl from previous test',
    };
  }

  try {
    let wsUrl = session.wsUrl;
    if (!wsUrl.includes('token=')) {
      const separator = wsUrl.includes('?') ? '&' : '?';
      wsUrl = `${wsUrl}${separator}token=${config.token}`;
    }

    // First connection
    const result1 = await createWebSocket(wsUrl, 5000);
    const connected1 = result1.connected;
    result1.close();

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Second connection (reconnect)
    const result2 = await createWebSocket(wsUrl, 5000);
    const connected2 = result2.connected;
    result2.close();

    return {
      name: 'WebSocket reconnection',
      passed: connected1 && connected2,
      duration: Date.now() - startTime,
      details: {
        firstConnection: connected1,
        secondConnection: connected2,
      },
    };
  } catch (error: any) {
    return {
      name: 'WebSocket reconnection',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testWebSocketNoAuth(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  const session = (config as any)._session;

  if (!session?.wsUrl) {
    return {
      name: 'WebSocket rejects unauthenticated',
      passed: false,
      duration: Date.now() - startTime,
      error: 'No session/wsUrl from previous test',
    };
  }

  try {
    // Try connecting without auth token
    let wsUrl = session.wsUrl;
    // Remove any existing token
    wsUrl = wsUrl.replace(/[?&]token=[^&]+/, '');

    const result = await createWebSocket(wsUrl, 5000);
    result.close();

    // Should either fail to connect or close quickly
    // Some implementations accept and then close, others reject outright
    // Consider test passing if we DON'T get normal CLI output

    const hasCliOutput = /claude|openagentic|>|$/i.test(result.output);

    return {
      name: 'WebSocket rejects unauthenticated',
      passed: !hasCliOutput || !result.connected,
      duration: Date.now() - startTime,
      details: {
        connected: result.connected,
        outputLength: result.output.length,
        hasCliOutput,
      },
    };
  } catch (error: any) {
    // Connection error is expected for unauthenticated
    return {
      name: 'WebSocket rejects unauthenticated',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        error: error.message,
        expectedBehavior: true,
      },
    };
  }
}

export const WebSocketTests = {
  async run(config: TestConfig): Promise<TestResult[]> {
    const results: TestResult[] = [];

    results.push(await testWebSocketConnection(config));
    results.push(await testWebSocketOutput(config));
    results.push(await testWebSocketReconnect(config));
    results.push(await testWebSocketNoAuth(config));

    return results;
  },
};
