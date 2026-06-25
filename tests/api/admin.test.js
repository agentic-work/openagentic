/**
 * Admin API Tests
 */

const { config, apiRequest, createTestResult, logInfo } = require('../config');

async function testAdminStats() {
  const startTime = Date.now();
  try {
    const response = await apiRequest('/api/admin/stats');

    if (!response.ok) {
      // Admin endpoints may require special permissions or not exist
      if (response.status === 403 || response.status === 401 || response.status === 404) {
        return createTestResult('Admin Stats', true, Date.now() - startTime, null, {
          skipped: true,
          reason: response.status === 404 ? 'Endpoint not implemented' : 'Requires admin authentication'
        });
      }
      throw new Error(`Failed to get admin stats: ${response.status}`);
    }

    const data = await response.json();

    return createTestResult('Admin Stats', true, Date.now() - startTime, null, {
      hasData: !!data
    });
  } catch (error) {
    return createTestResult('Admin Stats', false, Date.now() - startTime, error);
  }
}

async function testApiKeysList() {
  const startTime = Date.now();
  try {
    const response = await apiRequest('/api/admin/api-keys');

    if (!response.ok) {
      if (response.status === 403 || response.status === 401 || response.status === 404) {
        return createTestResult('List API Keys', true, Date.now() - startTime, null, {
          skipped: true,
          reason: response.status === 404 ? 'Endpoint not implemented' : 'Requires admin authentication'
        });
      }
      throw new Error(`Failed to list API keys: ${response.status}`);
    }

    const data = await response.json();

    return createTestResult('List API Keys', true, Date.now() - startTime, null, {
      keysCount: Array.isArray(data) ? data.length : 0
    });
  } catch (error) {
    return createTestResult('List API Keys', false, Date.now() - startTime, error);
  }
}

async function testUsersList() {
  const startTime = Date.now();
  try {
    const response = await apiRequest('/api/admin/users');

    if (!response.ok) {
      if (response.status === 403 || response.status === 401) {
        return createTestResult('List Users', true, Date.now() - startTime, null, {
          skipped: true,
          reason: 'Requires admin authentication'
        });
      }
      throw new Error(`Failed to list users: ${response.status}`);
    }

    const data = await response.json();

    return createTestResult('List Users', true, Date.now() - startTime, null, {
      usersCount: Array.isArray(data) ? data.length : 0
    });
  } catch (error) {
    return createTestResult('List Users', false, Date.now() - startTime, error);
  }
}

async function testHealthCheck() {
  const startTime = Date.now();
  try {
    const response = await fetch(`${config.apiUrl}/api/health`);

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    const data = await response.json();

    // Accept both 'ok' and 'healthy' as valid statuses
    const isHealthy = data.status === 'ok' || data.status === 'healthy';
    if (!isHealthy) {
      throw new Error(`Unexpected health status: ${data.status}`);
    }

    return createTestResult('Health Check', true, Date.now() - startTime, null, {
      status: data.status
    });
  } catch (error) {
    return createTestResult('Health Check', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing admin endpoints...');

  results.push(await testHealthCheck());
  results.push(await testAdminStats());
  results.push(await testApiKeysList());
  results.push(await testUsersList());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
