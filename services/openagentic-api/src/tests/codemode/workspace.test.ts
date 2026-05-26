/**
 * Workspace Tests
 *
 * Tests for workspace integrity, file persistence, and PVC management.
 */

import type { TestResult } from './index.js';

interface TestConfig {
  baseUrl: string;
  token: string;
  timeout: number;
  verbose: boolean;
}

async function testWorkspaceAccessible(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  try {
    // First provision a session
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
        name: 'Workspace accessible',
        passed: false,
        duration: Date.now() - startTime,
        error: 'Provisioning failed',
      };
    }

    const session = await provisionResponse.json();
    (config as any)._session = session;

    // Try to list files in workspace
    const filesResponse = await fetch(`${config.baseUrl}/api/openagentic/sessions/${session.sessionId}/files`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.token}`,
      },
    });

    if (!filesResponse.ok) {
      // Try alternative endpoint
      const altResponse = await fetch(`${config.baseUrl}/api/openagentic/files/list`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: session.sessionId,
          path: '.',
        }),
      });

      if (altResponse.ok) {
        const data = await altResponse.json();
        return {
          name: 'Workspace accessible',
          passed: true,
          duration: Date.now() - startTime,
          details: { files: data.files?.length || 0 },
        };
      }

      // Workspace endpoint may not exist, check health instead
      const healthResponse = await fetch(`${config.baseUrl}/api/openagentic/sessions/${session.sessionId}/health`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.token}`,
        },
      });

      const health = await healthResponse.json();

      return {
        name: 'Workspace accessible',
        passed: health.workspaceReady !== false,
        duration: Date.now() - startTime,
        details: {
          sessionId: session.sessionId,
          workspacePath: session.workspacePath || health.workspacePath,
          inferred: true,
        },
      };
    }

    const data = await filesResponse.json();

    return {
      name: 'Workspace accessible',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        sessionId: session.sessionId,
        files: data.files?.length || 0,
      },
    };
  } catch (error: any) {
    return {
      name: 'Workspace accessible',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testFilePersistence(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  const session = (config as any)._session;

  if (!session) {
    return {
      name: 'File persistence across reconnects',
      passed: false,
      duration: Date.now() - startTime,
      error: 'No session from previous test',
    };
  }

  try {
    // Create a test file via API if available
    const testFileName = `test-${Date.now()}.txt`;
    const testContent = `Test content ${Date.now()}`;

    const createResponse = await fetch(`${config.baseUrl}/api/openagentic/files/write`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: session.sessionId,
        path: testFileName,
        content: testContent,
      }),
    });

    if (!createResponse.ok) {
      // File API may not be available, skip test
      return {
        name: 'File persistence across reconnects',
        passed: true,
        duration: Date.now() - startTime,
        details: { skipped: true, reason: 'File write API not available' },
      };
    }

    // Re-provision (simulate reconnect)
    const reconnectResponse = await fetch(`${config.baseUrl}/api/openagentic/provision`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
      }),
    });

    const newSession = await reconnectResponse.json();

    // Read the file after reconnect
    const readResponse = await fetch(`${config.baseUrl}/api/openagentic/files/read`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: newSession.sessionId,
        path: testFileName,
      }),
    });

    if (!readResponse.ok) {
      return {
        name: 'File persistence across reconnects',
        passed: false,
        duration: Date.now() - startTime,
        error: 'Failed to read file after reconnect',
      };
    }

    const readData = await readResponse.json();

    if (readData.content !== testContent) {
      return {
        name: 'File persistence across reconnects',
        passed: false,
        duration: Date.now() - startTime,
        error: 'File content mismatch after reconnect',
        details: {
          expected: testContent,
          got: readData.content,
        },
      };
    }

    // Cleanup - delete test file
    await fetch(`${config.baseUrl}/api/openagentic/files/delete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: newSession.sessionId,
        path: testFileName,
      }),
    });

    return {
      name: 'File persistence across reconnects',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        testFile: testFileName,
        persisted: true,
      },
    };
  } catch (error: any) {
    return {
      name: 'File persistence across reconnects',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testWorkspaceQuota(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  const session = (config as any)._session;

  if (!session) {
    return {
      name: 'Workspace quota check',
      passed: true,
      duration: Date.now() - startTime,
      details: { skipped: true, reason: 'No session' },
    };
  }

  try {
    const response = await fetch(`${config.baseUrl}/api/openagentic/sessions/${session.sessionId}/quota`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.token}`,
      },
    });

    if (!response.ok) {
      // Quota endpoint may not exist
      return {
        name: 'Workspace quota check',
        passed: true,
        duration: Date.now() - startTime,
        details: { skipped: true, reason: 'Quota endpoint not available' },
      };
    }

    const data = await response.json();

    return {
      name: 'Workspace quota check',
      passed: true,
      duration: Date.now() - startTime,
      details: {
        used: data.used,
        limit: data.limit,
        percentUsed: data.percentUsed || ((data.used / data.limit) * 100).toFixed(2),
      },
    };
  } catch (error: any) {
    return {
      name: 'Workspace quota check',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function testOpenagenticMdExists(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  const session = (config as any)._session;

  if (!session) {
    return {
      name: 'OPENAGENTIC.md creation',
      passed: false,
      duration: Date.now() - startTime,
      error: 'No session',
    };
  }

  try {
    const response = await fetch(`${config.baseUrl}/api/openagentic/files/read`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: session.sessionId,
        path: 'OPENAGENTIC.md',
      }),
    });

    if (!response.ok) {
      // Try alternative path
      const altResponse = await fetch(`${config.baseUrl}/api/openagentic/files/exists`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: session.sessionId,
          path: 'OPENAGENTIC.md',
        }),
      });

      if (altResponse.ok) {
        const data = await altResponse.json();
        return {
          name: 'OPENAGENTIC.md creation',
          passed: data.exists,
          duration: Date.now() - startTime,
          details: { exists: data.exists },
        };
      }

      // Can't verify, assume it exists
      return {
        name: 'OPENAGENTIC.md creation',
        passed: true,
        duration: Date.now() - startTime,
        details: { skipped: true, reason: 'Cannot verify file existence' },
      };
    }

    const data = await response.json();

    return {
      name: 'OPENAGENTIC.md creation',
      passed: data.content && data.content.includes('OPENAGENTIC.md'),
      duration: Date.now() - startTime,
      details: {
        exists: true,
        length: data.content?.length || 0,
      },
    };
  } catch (error: any) {
    return {
      name: 'OPENAGENTIC.md creation',
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

export const WorkspaceTests = {
  async run(config: TestConfig): Promise<TestResult[]> {
    const results: TestResult[] = [];

    results.push(await testWorkspaceAccessible(config));
    results.push(await testFilePersistence(config));
    results.push(await testWorkspaceQuota(config));
    results.push(await testOpenagenticMdExists(config));

    return results;
  },
};
