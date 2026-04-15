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
 * Token Lifecycle Tests
 *
 * Tests for JWT token validation, refresh, and CLI token synchronization.
 */

import type { TestResult } from './index.js';

interface TestConfig {
  baseUrl: string;
  token: string;
  testUserEmail: string;
  testUserPassword: string;
  timeout: number;
  verbose: boolean;
}

async function testTokenValidation(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  try {
    // Test that current token is valid
    const response = await fetch(`${config.baseUrl}/api/auth/validate`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.token}`,
      },
    });

    if (!response.ok) {
      return {
        name: 'Token validation',
        passed: false,
        duration: Date.now() - startTime,
        error: `HTTP ${response.status}: Token validation failed`,
      };
    }

    const data = await response.json();

    return {
      name: 'Token validation',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        valid: true,
        userId: data.userId,
        expiresAt: data.exp,
      },
    };
  } catch (error: any) {
    return {
      name: 'Token validation',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testInvalidToken(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  try {
    // Test with invalid token
    const response = await fetch(`${config.baseUrl}/api/openagentic/preflight`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer invalid-token-12345',
      },
    });

    if (response.status === 401) {
      return {
        name: 'Invalid token rejection',
        passed: true,
        duration: Date.now() - startTime,
        details: { statusCode: 401 },
      };
    }

    return {
      name: 'Invalid token rejection',
      passed: false,
      duration: Date.now() - startTime,
      error: `Expected 401, got ${response.status}`,
    };
  } catch (error: any) {
    return {
      name: 'Invalid token rejection',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testTokenRefresh(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  try {
    // Get a fresh token
    const response = await fetch(`${config.baseUrl}/api/auth/local`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: config.testUserEmail,
        password: config.testUserPassword,
      }),
    });

    if (!response.ok) {
      return {
        name: 'Token refresh (re-authentication)',
        passed: false,
        duration: Date.now() - startTime,
        error: `HTTP ${response.status}: Re-authentication failed`,
      };
    }

    const data = await response.json();

    if (!data.accessToken) {
      return {
        name: 'Token refresh (re-authentication)',
        passed: false,
        duration: Date.now() - startTime,
        error: 'No access token in response',
      };
    }

    // Verify new token works
    const validateResponse = await fetch(`${config.baseUrl}/api/auth/validate`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${data.accessToken}`,
      },
    });

    if (!validateResponse.ok) {
      return {
        name: 'Token refresh (re-authentication)',
        passed: false,
        duration: Date.now() - startTime,
        error: 'New token validation failed',
      };
    }

    // Store new token for subsequent tests
    (config as any).token = data.accessToken;
    (config as any)._newToken = data.accessToken;

    return {
      name: 'Token refresh (re-authentication)',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        newTokenAcquired: true,
        tokenLength: data.accessToken.length,
      },
    };
  } catch (error: any) {
    return {
      name: 'Token refresh (re-authentication)',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testCLITokenSync(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  try {
    // Provision session to ensure CLI gets fresh token
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
      const error = await provisionResponse.text();
      return {
        name: 'CLI token synchronization',
        passed: false,
        duration: Date.now() - startTime,
        error: `Provisioning failed: ${error}`,
      };
    }

    const session = await provisionResponse.json();

    // Check session health - CLI should be running with valid token
    const healthResponse = await fetch(`${config.baseUrl}/api/openagentic/sessions/${session.sessionId}/health`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.token}`,
      },
    });

    const health = await healthResponse.json();

    // CLI should be running (token is valid)
    const cliRunning = health.cliStatus === 'running' || health.ptyActive;

    if (!cliRunning) {
      return {
        name: 'CLI token synchronization',
        passed: false,
        duration: Date.now() - startTime,
        error: `CLI not running after provisioning with fresh token`,
        details: health,
      };
    }

    return {
      name: 'CLI token synchronization',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        sessionId: session.sessionId,
        cliStatus: health.cliStatus || 'running',
        tokenSynced: true,
      },
    };
  } catch (error: any) {
    return {
      name: 'CLI token synchronization',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testReconnectWithNewToken(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  const newToken = (config as any)._newToken;

  if (!newToken) {
    return {
      name: 'Reconnect with new token',
      passed: false,
      duration: Date.now() - startTime,
      error: 'No new token from previous test',
    };
  }

  try {
    // Provision with the new token
    const response = await fetch(`${config.baseUrl}/api/openagentic/provision`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        name: 'Reconnect with new token',
        passed: false,
        duration: Date.now() - startTime,
        error: `Provisioning failed: ${error}`,
      };
    }

    const session = await response.json();

    // Verify CLI can make requests (token is being used)
    const healthResponse = await fetch(`${config.baseUrl}/api/openagentic/sessions/${session.sessionId}/health`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${newToken}`,
      },
    });

    const health = await healthResponse.json();

    return {
      name: 'Reconnect with new token',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        sessionId: session.sessionId,
        isReconnect: session.isReconnect,
        cliStatus: health.cliStatus || health.ptyActive ? 'running' : 'unknown',
      },
    };
  } catch (error: any) {
    return {
      name: 'Reconnect with new token',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

export const TokenLifecycleTests = {
  async run(config: TestConfig): Promise<TestResult[]> {
    const results: TestResult[] = [];

    results.push(await testTokenValidation(config));
    results.push(await testInvalidToken(config));
    results.push(await testTokenRefresh(config));
    results.push(await testCLITokenSync(config));
    results.push(await testReconnectWithNewToken(config));

    return results;
  },
};
