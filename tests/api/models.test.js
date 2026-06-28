/**
 * Models API Tests
 */

const { config, apiRequest, createTestResult, logInfo } = require('../config');

async function testListModels() {
  const startTime = Date.now();
  try {
    const response = await apiRequest('/api/models');

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data.models)) {
      throw new Error('Expected models array in response');
    }

    return createTestResult('List Models', true, Date.now() - startTime, null, {
      modelsCount: data.models.length,
      models: data.models.map(m => m.id)
    });
  } catch (error) {
    return createTestResult('List Models', false, Date.now() - startTime, error);
  }
}

async function testModelDetails() {
  const startTime = Date.now();
  try {
    // First get models list
    const listResponse = await apiRequest('/api/models');
    if (!listResponse.ok) {
      throw new Error('Failed to list models');
    }

    const listData = await listResponse.json();
    const models = listData.models || [];

    if (models.length === 0) {
      return createTestResult('Model Details', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'No models available'
      });
    }

    // Check model structure - our API uses custom format (id, name, provider)
    // instead of OpenAI format (id, object)
    const model = models[0];
    const requiredFields = ['id', 'name', 'provider'];
    const missingFields = requiredFields.filter(f => !model[f]);

    if (missingFields.length > 0) {
      throw new Error(`Missing fields: ${missingFields.join(', ')}`);
    }

    return createTestResult('Model Details', true, Date.now() - startTime, null, {
      modelId: model.id,
      hasRequiredFields: true
    });
  } catch (error) {
    return createTestResult('Model Details', false, Date.now() - startTime, error);
  }
}

async function testModelCategories() {
  const startTime = Date.now();
  try {
    const response = await apiRequest('/api/models');
    if (!response.ok) {
      throw new Error('Failed to list models');
    }

    const data = await response.json();
    const models = data.models || [];

    // Categorize models by provider
    const categories = {};
    for (const model of models) {
      const provider = model.id.split('/')[0] || 'unknown';
      if (!categories[provider]) {
        categories[provider] = [];
      }
      categories[provider].push(model.id);
    }

    return createTestResult('Model Categories', true, Date.now() - startTime, null, {
      providers: Object.keys(categories),
      categoryCounts: Object.fromEntries(
        Object.entries(categories).map(([k, v]) => [k, v.length])
      )
    });
  } catch (error) {
    return createTestResult('Model Categories', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing models endpoints...');

  results.push(await testListModels());
  results.push(await testModelDetails());
  results.push(await testModelCategories());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
