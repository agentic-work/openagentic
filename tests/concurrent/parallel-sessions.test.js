/**
 * Concurrent Load Tests - 20 Parallel Sessions
 */

const { config, apiRequest, createTestResult, logInfo, logPass, logFail } = require('../config');

const NUM_SESSIONS = parseInt(process.env.NUM_SESSIONS) || 20;

// Complex MCP questions for load testing
const mcpQuestions = [
  'List my Azure subscriptions and their details',
  'What resource groups do I have in my default subscription?',
  'Show me the cost breakdown for the last month',
  'Search the web for latest Kubernetes best practices',
  'What are the current Azure service health alerts?',
  'List all virtual machines across my subscriptions',
  'Search for news about cloud computing trends',
  'What storage accounts do I have?',
  'Show recent Azure activity logs',
  'List all app services and their status',
  'Search for Node.js performance optimization tips',
  'What is my current Azure spending vs budget?',
  'List all SQL databases in my subscription',
  'Search web for Docker security best practices',
  'Show all network security groups',
  'What containers are running in my AKS clusters?',
  'Search for TypeScript 5.0 new features',
  'List all Azure Key Vaults',
  'Show recent deployments across all resources',
  'What are the top cloud providers by market share?'
];

async function runSingleSession(sessionId) {
  const question = mcpQuestions[sessionId % mcpQuestions.length];
  const startTime = Date.now();

  try {
    const body = {
      model: config.defaultModel,
      messages: [{ role: 'user', content: question }],
      stream: false
    };

    const response = await apiRequest('/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      return {
        sessionId,
        passed: false,
        duration,
        error: `HTTP ${response.status}`,
        question
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return {
      sessionId,
      passed: true,
      duration,
      responseLength: content.length,
      question,
      hasContent: content.length > 50
    };
  } catch (error) {
    return {
      sessionId,
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
      question
    };
  }
}

async function run() {
  logInfo(`Starting ${NUM_SESSIONS} concurrent chat sessions...`);

  const startTime = Date.now();

  // Launch all sessions in parallel
  const sessionPromises = [];
  for (let i = 0; i < NUM_SESSIONS; i++) {
    sessionPromises.push(runSingleSession(i));
  }

  // Wait for all sessions to complete
  const sessionResults = await Promise.all(sessionPromises);

  const totalDuration = Date.now() - startTime;

  // Calculate statistics
  const passed = sessionResults.filter(r => r.passed).length;
  const failed = sessionResults.filter(r => !r.passed).length;
  const durations = sessionResults.map(r => r.duration);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);

  // Sort by duration for percentile calculation
  durations.sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)];
  const p90 = durations[Math.floor(durations.length * 0.9)];
  const p99 = durations[Math.floor(durations.length * 0.99)];

  // Log results
  logInfo(`Completed ${NUM_SESSIONS} sessions in ${(totalDuration / 1000).toFixed(2)}s`);
  logInfo(`Statistics:`);
  logInfo(`  - Average: ${avgDuration.toFixed(0)}ms`);
  logInfo(`  - Min: ${minDuration}ms`);
  logInfo(`  - Max: ${maxDuration}ms`);
  logInfo(`  - P50: ${p50}ms`);
  logInfo(`  - P90: ${p90}ms`);
  logInfo(`  - P99: ${p99}ms`);

  // Log failures
  const failures = sessionResults.filter(r => !r.passed);
  if (failures.length > 0) {
    logInfo(`Failures:`);
    failures.forEach(f => {
      logFail(`  Session ${f.sessionId}: ${f.error}`);
    });
  }

  // Create result
  const errorRate = (failed / NUM_SESSIONS) * 100;

  return createTestResult(
    `${NUM_SESSIONS} Concurrent Sessions`,
    errorRate <= 10, // Allow up to 10% error rate
    totalDuration,
    errorRate > 10 ? new Error(`Error rate ${errorRate.toFixed(1)}% exceeds 10% threshold`) : null,
    {
      totalSessions: NUM_SESSIONS,
      passed,
      failed,
      errorRate: `${errorRate.toFixed(1)}%`,
      statistics: {
        avgDuration: `${avgDuration.toFixed(0)}ms`,
        minDuration: `${minDuration}ms`,
        maxDuration: `${maxDuration}ms`,
        p50: `${p50}ms`,
        p90: `${p90}ms`,
        p99: `${p99}ms`
      },
      failures: failures.map(f => ({
        sessionId: f.sessionId,
        error: f.error,
        question: f.question.substring(0, 50)
      }))
    }
  );
}

module.exports = { run };
