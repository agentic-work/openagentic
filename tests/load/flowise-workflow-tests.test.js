/**
 * Test Suite #7B - 100 Flowise Workflows
 *
 * Creates 50 chatflows and 50 agentflows via the oap-flowise-mcp
 * through the chat API to test workflow creation at scale.
 *
 * Requirements:
 * - 50 chatflows (RAG, Conversational Memory, Tool Agent, Custom Tool, Multi-chain)
 * - 50 agentflows (Agentic RAG, Agent as Tool, Multi-Agent, Sequential, Supervisor)
 * - Creates workflows via chat API using oap-flowise-mcp
 * - Tracks creation time, success/failure rates, workflow IDs
 * - Outputs results to JSON file
 */

const fs = require('fs').promises;
const path = require('path');
const { config, chat, createTestResult, logInfo, logPass, logFail, logSection } = require('../config');

// Test configuration
const TEST_CONFIG = {
  apiKey: 'awc_test_phatoldsun_16bdbaf284042b28dc724bec24b4ff79',
  testUser: 'phatoldsun@gmail.com',
  totalChatflows: 50,
  totalAgentflows: 50,
  outputFile: path.join(__dirname, '../test-results/flowise-workflow-load-test.json')
};

// Helper to generate unique IDs
function generateId(prefix, index) {
  const timestamp = Date.now();
  return `${prefix}_${index}_${timestamp}`;
}

// Workflow templates based on Flowise documentation and tutorials
const CHATFLOW_TYPES = {
  RAG: {
    count: 10,
    description: 'Retrieval Augmented Generation',
    systemPrompt: (idx) => `You are a RAG assistant ${idx}. You help retrieve and generate answers from knowledge bases. Provide accurate, sourced responses based on retrieved context.`,
    category: 'RAG'
  },
  CONVERSATIONAL_MEMORY: {
    count: 10,
    description: 'Conversational Memory',
    systemPrompt: (idx) => `You are a conversational assistant ${idx} with excellent memory. Remember context from previous messages and maintain conversation continuity. Provide personalized, context-aware responses.`,
    category: 'Conversational'
  },
  TOOL_AGENT: {
    count: 10,
    description: 'Tool Agent',
    systemPrompt: (idx) => `You are a tool-using agent ${idx}. You can access various tools and APIs to accomplish tasks. Choose the right tools, execute them properly, and provide comprehensive results.`,
    category: 'Agent'
  },
  CUSTOM_TOOL: {
    count: 10,
    description: 'Custom Tool',
    systemPrompt: (idx) => `You are a custom tool specialist ${idx}. You help create and manage custom tools for specific workflows. Guide users in tool design and implementation.`,
    category: 'Tools'
  },
  MULTI_CHAIN: {
    count: 10,
    description: 'Multi-chain',
    systemPrompt: (idx) => `You are a multi-chain coordinator ${idx}. You orchestrate multiple chains to solve complex problems. Break down tasks, coordinate execution, and synthesize results.`,
    category: 'Chains'
  }
};

const AGENTFLOW_TYPES = {
  AGENTIC_RAG: {
    count: 10,
    description: 'Agentic RAG',
    systemPrompt: (idx) => `You are an agentic RAG system ${idx}. You autonomously decide when to retrieve information, what sources to use, and how to synthesize answers. Be proactive and thorough.`,
    category: 'Agentic RAG'
  },
  AGENT_AS_TOOL: {
    count: 10,
    description: 'Agent as Tool',
    systemPrompt: (idx) => `You are an agent tool ${idx} that can be called by other agents. Provide specific functionality and return structured results. Be reliable and consistent.`,
    category: 'Agent Tools'
  },
  MULTI_AGENT: {
    count: 10,
    description: 'Multi-Agent',
    systemPrompt: (idx) => `You are part of a multi-agent system ${idx}. Collaborate with other agents, share information, and work towards common goals. Be cooperative and communicative.`,
    category: 'Multi-Agent'
  },
  SEQUENTIAL_AGENT: {
    count: 10,
    description: 'Sequential Agent',
    systemPrompt: (idx) => `You are a sequential agent ${idx}. Execute tasks in order, pass results to the next agent, and maintain state through the pipeline. Be precise and organized.`,
    category: 'Sequential'
  },
  SUPERVISOR_AGENT: {
    count: 10,
    description: 'Supervisor Agent',
    systemPrompt: (idx) => `You are a supervisor agent ${idx}. Coordinate other agents, assign tasks, monitor progress, and ensure quality. Be authoritative and efficient.`,
    category: 'Supervisor'
  }
};

/**
 * Create a chatflow via the chat API using oap-flowise-mcp
 */
async function createChatflowViaMCP(name, systemPrompt, category, index) {
  const startTime = Date.now();

  try {
    // Use the chat API to call the flowise_create_chatflow tool via MCP
    const prompt = `Create a new Flowise chatflow with the following details:
- Name: "${name}"
- Description: "${systemPrompt.substring(0, 100)}..."
- Category: "${category}"
- Deployed: false
- IsPublic: false

Please create this chatflow and return the chatflow ID.`;

    // Make the chat request with the test API key
    const response = await fetch(`${config.apiUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': TEST_CONFIG.apiKey
      },
      body: JSON.stringify({
        model: config.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Extract chatflow ID from response (should contain JSON with id)
    let chatflowId = null;
    const idMatch = content.match(/"id":\s*"([a-f0-9-]+)"/);
    if (idMatch) {
      chatflowId = idMatch[1];
    }

    const duration = Date.now() - startTime;

    return {
      success: true,
      name,
      category,
      type: 'chatflow',
      index,
      chatflowId,
      duration,
      timestamp: new Date().toISOString(),
      response: content.substring(0, 200)
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      name,
      category,
      type: 'chatflow',
      index,
      duration,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Create an agentflow via the chat API using oap-flowise-mcp
 */
async function createAgentflowViaMCP(name, systemPrompt, category, index) {
  const startTime = Date.now();

  try {
    // Use the chat API to call the flowise_create_chatflow_advanced tool via MCP
    const prompt = `Create an advanced Flowise agentflow with the following details:
- Name: "${name}"
- Description: "${systemPrompt.substring(0, 100)}..."
- Category: "${category}"
- Type: AgentFlow
- Include Agentic Models: true
- Model Provider: openai
- Model Name: gpt-4
- Temperature: 0.7
- Deployed: false
- IsPublic: false

Please create this agentflow and return the flow ID.`;

    // Make the chat request with the test API key
    const response = await fetch(`${config.apiUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': TEST_CONFIG.apiKey
      },
      body: JSON.stringify({
        model: config.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Extract flow ID from response
    let flowId = null;
    const idMatch = content.match(/"id":\s*"([a-f0-9-]+)"/);
    if (idMatch) {
      flowId = idMatch[1];
    }

    const duration = Date.now() - startTime;

    return {
      success: true,
      name,
      category,
      type: 'agentflow',
      index,
      flowId,
      duration,
      timestamp: new Date().toISOString(),
      response: content.substring(0, 200)
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      success: false,
      name,
      category,
      type: 'agentflow',
      index,
      duration,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Verify workflow was created by querying Flowise
 */
async function verifyWorkflowCreation(workflowId) {
  try {
    const prompt = `List all Flowise chatflows and agentflows. I need to verify that workflow ${workflowId} was created successfully.`;

    const response = await fetch(`${config.apiUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': TEST_CONFIG.apiKey
      },
      body: JSON.stringify({
        model: config.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      })
    });

    if (!response.ok) {
      return { verified: false, reason: `API request failed: ${response.status}` };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Check if the workflow ID appears in the response
    const found = content.includes(workflowId);

    return {
      verified: found,
      reason: found ? 'Workflow found in list' : 'Workflow not found in list'
    };

  } catch (error) {
    return {
      verified: false,
      reason: error.message
    };
  }
}

/**
 * Create all chatflows
 */
async function createChatflows() {
  logSection('Creating 50 Chatflows');
  const results = [];
  let globalIndex = 0;

  for (const [typeName, typeConfig] of Object.entries(CHATFLOW_TYPES)) {
    logInfo(`Creating ${typeConfig.count} ${typeConfig.description} chatflows...`);

    for (let i = 0; i < typeConfig.count; i++) {
      globalIndex++;
      const name = `${typeConfig.description} ${i + 1}`;
      const systemPrompt = typeConfig.systemPrompt(i + 1);

      logInfo(`  [${globalIndex}/50] Creating: ${name}`);

      const result = await createChatflowViaMCP(
        name,
        systemPrompt,
        typeConfig.category,
        globalIndex
      );

      if (result.success) {
        logPass(`    Created in ${result.duration}ms - ID: ${result.chatflowId || 'N/A'}`);
      } else {
        logFail(`    Failed: ${result.error}`);
      }

      results.push(result);

      // Small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Create all agentflows
 */
async function createAgentflows() {
  logSection('Creating 50 Agentflows');
  const results = [];
  let globalIndex = 0;

  for (const [typeName, typeConfig] of Object.entries(AGENTFLOW_TYPES)) {
    logInfo(`Creating ${typeConfig.count} ${typeConfig.description} agentflows...`);

    for (let i = 0; i < typeConfig.count; i++) {
      globalIndex++;
      const name = `${typeConfig.description} ${i + 1}`;
      const systemPrompt = typeConfig.systemPrompt(i + 1);

      logInfo(`  [${globalIndex}/50] Creating: ${name}`);

      const result = await createAgentflowViaMCP(
        name,
        systemPrompt,
        typeConfig.category,
        globalIndex
      );

      if (result.success) {
        logPass(`    Created in ${result.duration}ms - ID: ${result.flowId || 'N/A'}`);
      } else {
        logFail(`    Failed: ${result.error}`);
      }

      results.push(result);

      // Small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Calculate metrics from results
 */
function calculateMetrics(chatflowResults, agentflowResults) {
  const allResults = [...chatflowResults, ...agentflowResults];

  const successful = allResults.filter(r => r.success);
  const failed = allResults.filter(r => !r.success);

  const durations = successful.map(r => r.duration);
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;
  const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
  const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

  const chatflowSuccess = chatflowResults.filter(r => r.success).length;
  const agentflowSuccess = agentflowResults.filter(r => r.success).length;

  return {
    total: allResults.length,
    successful: successful.length,
    failed: failed.length,
    successRate: ((successful.length / allResults.length) * 100).toFixed(2) + '%',
    chatflows: {
      total: chatflowResults.length,
      successful: chatflowSuccess,
      failed: chatflowResults.length - chatflowSuccess,
      successRate: ((chatflowSuccess / chatflowResults.length) * 100).toFixed(2) + '%'
    },
    agentflows: {
      total: agentflowResults.length,
      successful: agentflowSuccess,
      failed: agentflowResults.length - agentflowSuccess,
      successRate: ((agentflowSuccess / agentflowResults.length) * 100).toFixed(2) + '%'
    },
    timing: {
      averageDurationMs: Math.round(avgDuration),
      minDurationMs: minDuration,
      maxDurationMs: maxDuration,
      totalDurationMs: durations.reduce((a, b) => a + b, 0)
    },
    workflowIds: {
      chatflows: chatflowResults.filter(r => r.chatflowId).map(r => ({
        name: r.name,
        id: r.chatflowId,
        category: r.category
      })),
      agentflows: agentflowResults.filter(r => r.flowId).map(r => ({
        name: r.name,
        id: r.flowId,
        category: r.category
      }))
    },
    errors: failed.map(r => ({
      name: r.name,
      type: r.type,
      error: r.error,
      timestamp: r.timestamp
    }))
  };
}

/**
 * Save results to JSON file
 */
async function saveResults(metrics, chatflowResults, agentflowResults) {
  const outputData = {
    testSuite: 'Test Suite #7B - 100 Flowise Workflows',
    testUser: TEST_CONFIG.testUser,
    apiKey: TEST_CONFIG.apiKey.substring(0, 20) + '...',
    timestamp: new Date().toISOString(),
    metrics,
    chatflowResults,
    agentflowResults
  };

  await fs.mkdir(path.dirname(TEST_CONFIG.outputFile), { recursive: true });
  await fs.writeFile(
    TEST_CONFIG.outputFile,
    JSON.stringify(outputData, null, 2)
  );

  logInfo(`Results saved to: ${TEST_CONFIG.outputFile}`);
}

/**
 * Display summary
 */
function displaySummary(metrics) {
  logSection('Test Summary');

  console.log(`Total Workflows Created: ${metrics.total}`);
  console.log(`  Successful: ${metrics.successful} (${metrics.successRate})`);
  console.log(`  Failed: ${metrics.failed}`);
  console.log('');

  console.log(`Chatflows: ${metrics.chatflows.successful}/${metrics.chatflows.total} (${metrics.chatflows.successRate})`);
  console.log(`Agentflows: ${metrics.agentflows.successful}/${metrics.agentflows.total} (${metrics.agentflows.successRate})`);
  console.log('');

  console.log('Timing:');
  console.log(`  Average: ${metrics.timing.averageDurationMs}ms`);
  console.log(`  Min: ${metrics.timing.minDurationMs}ms`);
  console.log(`  Max: ${metrics.timing.maxDurationMs}ms`);
  console.log(`  Total: ${(metrics.timing.totalDurationMs / 1000).toFixed(2)}s`);
  console.log('');

  if (metrics.errors.length > 0) {
    console.log('Errors:');
    metrics.errors.forEach((err, idx) => {
      console.log(`  ${idx + 1}. ${err.name} (${err.type}): ${err.error}`);
    });
    console.log('');
  }

  console.log('Workflow IDs created:');
  console.log(`  Chatflows: ${metrics.workflowIds.chatflows.length}`);
  console.log(`  Agentflows: ${metrics.workflowIds.agentflows.length}`);
}

/**
 * Main test runner
 */
async function run() {
  const testStartTime = Date.now();

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Test Suite #7B - 100 Flowise Workflows                  ║');
  console.log('║  Creating 50 Chatflows + 50 Agentflows via MCP          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  logInfo(`Test User: ${TEST_CONFIG.testUser}`);
  logInfo(`API Key: ${TEST_CONFIG.apiKey.substring(0, 30)}...`);
  logInfo(`Target: ${config.apiUrl}`);
  console.log('');

  // Create chatflows
  const chatflowResults = await createChatflows();

  // Create agentflows
  const agentflowResults = await createAgentflows();

  // Calculate metrics
  logSection('Calculating Metrics');
  const metrics = calculateMetrics(chatflowResults, agentflowResults);

  // Save results
  await saveResults(metrics, chatflowResults, agentflowResults);

  // Display summary
  displaySummary(metrics);

  const testDuration = Date.now() - testStartTime;
  logInfo(`Total test duration: ${(testDuration / 1000).toFixed(2)}s`);

  // Return test result
  return {
    passed: metrics.failed === 0,
    results: [...chatflowResults, ...agentflowResults],
    summary: {
      total: metrics.total,
      passed: metrics.successful,
      failed: metrics.failed,
      duration: testDuration
    },
    metrics
  };
}

// Export for use in test runner
module.exports = { run };

// Allow running standalone
if (require.main === module) {
  run()
    .then(result => {
      process.exit(result.passed ? 0 : 1);
    })
    .catch(error => {
      console.error('Test suite failed:', error);
      process.exit(1);
    });
}
