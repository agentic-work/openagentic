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
 * Session Lifecycle Tests
 *
 * Tests for Code Mode session creation, reconnection, and pod management.
 */

import type { TestResult } from './index.js';

interface TestConfig {
  baseUrl: string;
  token: string;
  timeout: number;
  verbose: boolean;
}

interface SessionResponse {
  sessionId: string;
  podName: string;
  podIP?: string;
  status: string;
  wsUrl: string;
  codeServerUrl?: string;
  isReconnect?: boolean;
  isNewPod?: boolean;
}

async function testPreflightValidation(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${config.baseUrl}/api/openagentic/preflight`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.token}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        name: 'Preflight validation',
        passed: false,
        duration: Date.now() - startTime,
        error: `HTTP ${response.status}: ${JSON.stringify(data)}`,
      };
    }

    if (!data.ready) {
      return {
        name: 'Preflight validation',
        passed: false,
        duration: Date.now() - startTime,
        error: `Preflight checks failed: ${JSON.stringify(data.checks)}`,
        details: data.checks,
      };
    }

    return {
      name: 'Preflight validation',
      passed: true,
      duration: Date.now() - startTime,
      details: data,
    };
  } catch (error: any) {
    return {
      name: 'Preflight validation',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testSessionProvisioning(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  try {
    const response = await fetch(`${config.baseUrl}/api/openagentic/provision`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
      }),
    });

    const data = await response.json() as SessionResponse;

    if (!response.ok) {
      return {
        name: 'Session provisioning',
        passed: false,
        duration: Date.now() - startTime,
        error: `HTTP ${response.status}: ${JSON.stringify(data)}`,
      };
    }

    if (!data.sessionId) {
      return {
        name: 'Session provisioning',
        passed: false,
        duration: Date.now() - startTime,
        error: 'No sessionId in response',
        details: data,
      };
    }

    if (!data.wsUrl) {
      return {
        name: 'Session provisioning',
        passed: false,
        duration: Date.now() - startTime,
        error: 'No wsUrl in response',
        details: data,
      };
    }

    // Store session for later tests
    (config as any)._session = data;

    return {
      name: 'Session provisioning',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        sessionId: data.sessionId,
        podName: data.podName,
        status: data.status,
        isNewPod: data.isNewPod,
      },
    };
  } catch (error: any) {
    return {
      name: 'Session provisioning',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testSessionReconnection(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  const existingSession = (config as any)._session as SessionResponse;

  if (!existingSession) {
    return {
      name: 'Session reconnection',
      passed: false,
      duration: Date.now() - startTime,
      error: 'No existing session from previous test',
    };
  }

  try {
    // Provision again - should reconnect to same session
    const response = await fetch(`${config.baseUrl}/api/openagentic/provision`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
      }),
    });

    const data = await response.json() as SessionResponse;

    if (!response.ok) {
      return {
        name: 'Session reconnection',
        passed: false,
        duration: Date.now() - startTime,
        error: `HTTP ${response.status}: ${JSON.stringify(data)}`,
      };
    }

    // Should reconnect to same pod (permanent pod per user)
    if (data.podName !== existingSession.podName) {
      return {
        name: 'Session reconnection',
        passed: false,
        duration: Date.now() - startTime,
        error: `Different pod: expected ${existingSession.podName}, got ${data.podName}`,
        details: { expected: existingSession.podName, got: data.podName },
      };
    }

    return {
      name: 'Session reconnection',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        sessionId: data.sessionId,
        podName: data.podName,
        isReconnect: data.isReconnect,
        samePod: data.podName === existingSession.podName,
      },
    };
  } catch (error: any) {
    return {
      name: 'Session reconnection',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testSessionHealth(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  const session = (config as any)._session as SessionResponse;

  if (!session) {
    return {
      name: 'Session health check',
      passed: false,
      duration: Date.now() - startTime,
      error: 'No session from previous test',
    };
  }

  try {
    const response = await fetch(`${config.baseUrl}/api/openagentic/sessions/${session.sessionId}/health`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.token}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        name: 'Session health check',
        passed: false,
        duration: Date.now() - startTime,
        error: `HTTP ${response.status}: ${JSON.stringify(data)}`,
      };
    }

    const cliRunning = data.cliStatus === 'running' || data.ptyActive;
    if (!cliRunning) {
      return {
        name: 'Session health check',
        passed: false,
        duration: Date.now() - startTime,
        error: `CLI not running: ${data.cliStatus || 'unknown'}`,
        details: data,
      };
    }

    return {
      name: 'Session health check',
      passed: true,
      duration: Date.now() - startTime,
      details: data,
    };
  } catch (error: any) {
    return {
      name: 'Session health check',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testPodStatus(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  const session = (config as any)._session as SessionResponse;

  if (!session?.podName) {
    return {
      name: 'Pod status verification',
      passed: false,
      duration: Date.now() - startTime,
      error: 'No pod name from previous test',
    };
  }

  try {
    const response = await fetch(`${config.baseUrl}/api/openagentic/admin/pods/${session.podName}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.token}`,
      },
    });

    // Admin endpoint might not be accessible, that's OK
    if (response.status === 403 || response.status === 404) {
      return {
        name: 'Pod status verification',
        passed: true, // Skip if admin endpoint not accessible
        duration: Date.now() - startTime,
        details: { skipped: true, reason: 'Admin endpoint not accessible' },
      };
    }

    const data = await response.json();

    if (data.status !== 'Running') {
      return {
        name: 'Pod status verification',
        passed: false,
        duration: Date.now() - startTime,
        error: `Pod not running: ${data.status}`,
        details: data,
      };
    }

    return {
      name: 'Pod status verification',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        podName: session.podName,
        status: data.status,
        ready: data.ready,
      },
    };
  } catch (error: any) {
    return {
      name: 'Pod status verification',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

export const SessionLifecycleTests = {
  async run(config: TestConfig): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Run tests in order (some depend on previous)
    results.push(await testPreflightValidation(config));
    results.push(await testSessionProvisioning(config));
    results.push(await testSessionReconnection(config));
    results.push(await testSessionHealth(config));
    results.push(await testPodStatus(config));

    return results;
  },
};
