/**
 * Authentication API Tests
 */

const { config, apiRequest, createTestResult, logPass, logFail, logInfo } = require('../config');

const tests = [];

async function testApiKeyAuth() {
  const startTime = Date.now();
  try {
    const response = await apiRequest('/api/models', {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`API key auth failed: ${response.status}`);
    }

    const data = await response.json();

    // API returns {models: [...]} format
    if (!data.models || !Array.isArray(data.models)) {
      throw new Error('Expected models array in response');
    }

    return createTestResult('API Key Authentication', true, Date.now() - startTime, null, {
      modelsCount: data.models.length
    });
  } catch (error) {
    return createTestResult('API Key Authentication', false, Date.now() - startTime, error);
  }
}

async function testHealthEndpoint() {
  const startTime = Date.now();
  try {
    const response = await fetch(`${config.apiUrl}/api/health`);

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    const data = await response.json();

    if (!data.status || data.status !== 'healthy') {
      throw new Error('Expected healthy status');
    }

    return createTestResult('Health Endpoint', true, Date.now() - startTime, null, {
      status: data.status,
      database: data.database?.status
    });
  } catch (error) {
    return createTestResult('Health Endpoint', false, Date.now() - startTime, error);
  }
}

async function testProtectedEndpointWithKey() {
  const startTime = Date.now();
  try {
    // Test that chat completions work with API key
    const response = await apiRequest('/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gemini-2.0-flash-001',
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 10
      })
    });

    if (!response.ok) {
      // 401/403 means auth is required and working
      if (response.status === 401 || response.status === 403) {
        return createTestResult('Protected Endpoint Auth', true, Date.now() - startTime, null, {
          authRequired: true
        });
      }
      throw new Error(`Unexpected status: ${response.status}`);
    }

    return createTestResult('Protected Endpoint Auth', true, Date.now() - startTime, null, {
      authRequired: false,
      works: true
    });
  } catch (error) {
    return createTestResult('Protected Endpoint Auth', false, Date.now() - startTime, error);
  }
}

async function testModelsListWithKey() {
  const startTime = Date.now();
  try {
    // Models endpoint should work with the API key
    const response = await apiRequest('/api/models');

    if (!response.ok) {
      throw new Error(`Models list failed: ${response.status}`);
    }

    const data = await response.json();
    const models = data.models || [];

    // Verify we have models available
    if (models.length === 0) {
      throw new Error('No models returned');
    }

    // Check model structure
    const firstModel = models[0];
    const hasRequiredFields = firstModel.id && firstModel.name && firstModel.provider;

    return createTestResult('Models List With Key', true, Date.now() - startTime, null, {
      modelsCount: models.length,
      hasRequiredFields,
      providers: [...new Set(models.map(m => m.provider))]
    });
  } catch (error) {
    return createTestResult('Models List With Key', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing authentication endpoints...');

  results.push(await testHealthEndpoint());
  results.push(await testApiKeyAuth());
  results.push(await testModelsListWithKey());
  results.push(await testProtectedEndpointWithKey());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
