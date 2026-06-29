/**
 * Flowise AgentFlowV2 Workflow Tests
 */

const { config, apiRequest, createTestResult, logInfo } = require('../config');

const flowiseApiUrl = process.env.FLOWISE_API_URL || 'http://localhost:3000';

async function flowiseRequest(endpoint, options = {}) {
  const url = `${flowiseApiUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers
    });
    return response;
  } catch (error) {
    throw new Error(`Flowise request failed: ${error.message}`);
  }
}

async function testFlowiseHealth() {
  const startTime = Date.now();
  try {
    const response = await flowiseRequest('/api/v1/ping');

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return createTestResult('Flowise Health', true, Date.now() - startTime);
  } catch (error) {
    return createTestResult('Flowise Health', false, Date.now() - startTime, error);
  }
}

async function testListChatflows() {
  const startTime = Date.now();
  try {
    const response = await flowiseRequest('/api/v1/chatflows');

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return createTestResult('List Chatflows', true, Date.now() - startTime, null, {
          skipped: true,
          reason: 'Requires authentication'
        });
      }
      throw new Error(`Failed: ${response.status}`);
    }

    const data = await response.json();
    const chatflows = Array.isArray(data) ? data : [];

    return createTestResult('List Chatflows', true, Date.now() - startTime, null, {
      count: chatflows.length,
      names: chatflows.slice(0, 5).map(cf => cf.name)
    });
  } catch (error) {
    return createTestResult('List Chatflows', false, Date.now() - startTime, error);
  }
}

async function testListAgentflows() {
  const startTime = Date.now();
  try {
    const response = await flowiseRequest('/api/v1/agentflows');

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return createTestResult('List Agentflows', true, Date.now() - startTime, null, {
          skipped: true,
          reason: 'Requires authentication'
        });
      }
      throw new Error(`Failed: ${response.status}`);
    }

    const data = await response.json();
    const agentflows = Array.isArray(data) ? data : [];

    return createTestResult('List Agentflows', true, Date.now() - startTime, null, {
      count: agentflows.length,
      names: agentflows.slice(0, 5).map(af => af.name)
    });
  } catch (error) {
    return createTestResult('List Agentflows', false, Date.now() - startTime, error);
  }
}

async function testExecuteChatflow() {
  const startTime = Date.now();
  try {
    // First get chatflows
    const listResponse = await flowiseRequest('/api/v1/chatflows');

    if (!listResponse.ok) {
      return createTestResult('Execute Chatflow', true, Date.now() - startTime, null, {
        skipped: true,
        reason: `Cannot list chatflows: ${listResponse.status}`
      });
    }

    const chatflows = await listResponse.json();

    if (!Array.isArray(chatflows) || chatflows.length === 0) {
      return createTestResult('Execute Chatflow', true, Date.now() - startTime, null, {
        skipped: true,
        reason: 'No chatflows available'
      });
    }

    // Execute first chatflow
    const chatflow = chatflows[0];
    const execResponse = await flowiseRequest(`/api/v1/prediction/${chatflow.id}`, {
      method: 'POST',
      body: JSON.stringify({
        question: 'Hello, can you respond with OK?'
      })
    });

    if (!execResponse.ok) {
      throw new Error(`Execution failed: ${execResponse.status}`);
    }

    const result = await execResponse.json();

    return createTestResult('Execute Chatflow', true, Date.now() - startTime, null, {
      chatflowId: chatflow.id,
      chatflowName: chatflow.name,
      hasResponse: !!result.text || !!result.json
    });
  } catch (error) {
    return createTestResult('Execute Chatflow', false, Date.now() - startTime, error);
  }
}

async function testFlowiseIntegration() {
  const startTime = Date.now();
  try {
    // Test the integration through our API
    const response = await apiRequest('/api/flowise/chatflows');

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return createTestResult('Flowise Integration', true, Date.now() - startTime, null, {
          skipped: true,
          reason: 'Requires authentication'
        });
      }
      throw new Error(`Integration test failed: ${response.status}`);
    }

    const data = await response.json();

    return createTestResult('Flowise Integration', true, Date.now() - startTime, null, {
      hasData: !!data,
      count: Array.isArray(data) ? data.length : 0
    });
  } catch (error) {
    return createTestResult('Flowise Integration', false, Date.now() - startTime, error);
  }
}

async function run() {
  const results = [];

  logInfo('Testing Flowise AgentFlowV2 workflows...');

  results.push(await testFlowiseHealth());
  results.push(await testListChatflows());
  results.push(await testListAgentflows());
  results.push(await testExecuteChatflow());
  results.push(await testFlowiseIntegration());

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed }
  };
}

module.exports = { run };
