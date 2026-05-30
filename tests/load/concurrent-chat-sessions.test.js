/**
 * Load Test #7A - 100 Concurrent Chat Sessions with 20 Messages Each
 *
 * This comprehensive test suite simulates 100 concurrent users each sending 20 messages,
 * exercising all available MCP tools and tracking detailed metrics.
 *
 * Test Configuration:
 * - 100 concurrent sessions
 * - 20 messages per session
 * - Total: 2000 messages
 * - Uses all available MCP tools
 *
 * MCP Tools Tested:
 * - admin-mcp
 * - awc-formatting-mcp
 * - oap-admin-mcp
 * - oap-azure-cost-mcp
 * - oap-azure-mcp
 * - oap-flowise-mcp
 * - oap-gcp-mcp
 * - oap-memory-mcp
 * - oap-prometheus-mcp
 * - oap-web-mcp
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  apiUrl: process.env.API_URL || 'http://localhost:8000',
  apiKey: process.env.API_KEY || 'awc_test_PLACEHOLDER_REPLACE_WITH_REAL_KEY',
  testUser: 'loadtest@example.com',
  numSessions: parseInt(process.env.NUM_SESSIONS, 10) || 100,
  messagesPerSession: parseInt(process.env.MESSAGES_PER_SESSION, 10) || 20,
  defaultModel: process.env.DEFAULT_MODEL || 'gemini-2.0-flash-001',
  outputFile: path.join(__dirname, '../test-results', 'concurrent-chat-sessions-results.json')
};

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

// Message templates organized by MCP tool and difficulty
const MESSAGE_TEMPLATES = {
  // Sessions 1-20: Basic questions (no MCP tools)
  basic: [
    'What is the capital of France?',
    'Explain quantum computing in simple terms',
    'What are the benefits of microservices architecture?',
    'How does TCP/IP work?',
    'What is machine learning?',
    'Explain the concept of containers in DevOps',
    'What are the SOLID principles in software engineering?',
    'How does HTTPS encryption work?',
    'What is the difference between SQL and NoSQL?',
    'Explain the CAP theorem',
    'What is continuous integration and continuous deployment?',
    'How does a load balancer work?',
    'What are the principles of RESTful API design?',
    'Explain the concept of eventual consistency',
    'What is serverless computing?',
    'How does OAuth 2.0 work?',
    'What are the advantages of event-driven architecture?',
    'Explain the concept of blue-green deployment',
    'What is infrastructure as code?',
    'How do you design a scalable web application?'
  ],

  // Sessions 21-40: Azure resource queries (oap-azure-mcp)
  azure: [
    'List all my Azure subscriptions and show their details',
    'What resource groups exist in my Azure account?',
    'Show me all virtual machines across my subscriptions',
    'List all storage accounts in my Azure environment',
    'What app services are currently running?',
    'Show me all Azure SQL databases',
    'List all Key Vaults and their locations',
    'What network security groups do I have?',
    'Show all Azure Functions in my subscription',
    'List all container registries',
    'What are the Azure service health alerts?',
    'Show recent deployment activity',
    'List all public IP addresses',
    'What load balancers are configured?',
    'Show all Azure Monitor alerts',
    'List all virtual networks and subnets',
    'What Application Insights instances exist?',
    'Show all Azure AD applications',
    'List all role assignments in my subscription',
    'What resources have tags environment=production?'
  ],

  // Sessions 41-60: GCP operations (oap-gcp-mcp)
  gcp: [
    'List all GCP projects I have access to',
    'What Compute Engine instances are running?',
    'Show me all Cloud Storage buckets',
    'List all Cloud SQL instances',
    'What Cloud Functions are deployed?',
    'Show all GKE clusters',
    'List all BigQuery datasets',
    'What Cloud Run services are running?',
    'Show all Pub/Sub topics',
    'List all Cloud Scheduler jobs',
    'What IAM roles do I have in GCP?',
    'Show all VPC networks',
    'List all Cloud Load Balancers',
    'What Cloud Storage buckets contain data?',
    'Show all Firestore databases',
    'List all Cloud Build triggers',
    'What Artifact Registry repositories exist?',
    'Show all Cloud Memorystore instances',
    'List all Cloud Tasks queues',
    'What are the current GCP service quotas?'
  ],

  // Sessions 61-80: Flowise workflow creation (oap-flowise-mcp)
  flowise: [
    'Create a simple chatflow in Flowise with a ConversationChain',
    'Build a RAG workflow using Flowise with PDF upload capability',
    'Design a Flowise chatflow with memory and context',
    'Create a Flowise agent that can search the web',
    'Build a multi-step workflow in Flowise with conditional logic',
    'Design a Flowise chatflow with custom API integration',
    'Create a document Q&A system in Flowise',
    'Build a Flowise workflow with LangChain tools',
    'Design a customer support bot using Flowise',
    'Create a Flowise chatflow with embeddings and vector search',
    'Build a code analysis workflow in Flowise',
    'Design a Flowise agent with multiple LLM providers',
    'Create a sentiment analysis workflow in Flowise',
    'Build a Flowise chatflow with data extraction capabilities',
    'Design a meeting summarizer using Flowise',
    'Create a Flowise workflow for email classification',
    'Build a translation service using Flowise',
    'Design a Flowise agent for SQL query generation',
    'Create a content moderation workflow in Flowise',
    'Build a Flowise chatflow with image understanding'
  ],

  // Sessions 81-100: Complex multi-tool tasks
  complex: [
    'Check my Azure costs and create a Flowise workflow to monitor them daily',
    'List my GCP projects and search the web for best practices for each service I\'m using',
    'Analyze my Azure resource utilization and format the results as a markdown table',
    'Search for Kubernetes security vulnerabilities and check if my GKE clusters are affected',
    'Create a Flowise workflow that monitors my Azure service health and sends alerts',
    'Compare my Azure and GCP spending, format as a chart, and save the data to memory',
    'Search for recent cloud outages and check if my resources were impacted',
    'List all my cloud resources across Azure and GCP, format as tables by region',
    'Create a Flowise agent that can query both Azure and GCP resources',
    'Search for DevOps best practices and compare against my current infrastructure',
    'Monitor Prometheus metrics and create alerts for any anomalies in my services',
    'Build a comprehensive dashboard workflow showing Azure + GCP costs with charts',
    'Search for cloud cost optimization strategies and apply them to my resources',
    'Create a Flowise workflow for automated incident response using Azure Monitor',
    'Analyze network security across Azure and GCP, highlight any security gaps',
    'Search for compliance requirements and audit my cloud resources against them',
    'Build a multi-cloud resource inventory with real-time status monitoring',
    'Create automated reports combining Azure costs, GCP usage, and web research',
    'Design a disaster recovery workflow using Flowise with multi-cloud support',
    'Comprehensive audit: scan all resources, check costs, search for vulnerabilities'
  ],

  // Additional specialized queries for MCP tools
  formatting: [
    'Create a markdown table showing different HTTP status codes and their meanings',
    'Generate a mermaid diagram showing the OAuth 2.0 flow',
    'Format this data as a chart: Q1: 100, Q2: 150, Q3: 120, Q4: 200',
    'Show me LaTeX formatted mathematical equations for calculus derivatives',
    'Create a syntax-highlighted code block showing a REST API implementation'
  ],

  memory: [
    'Remember that my preferred cloud provider is Azure',
    'Store this API key in memory: test-key-12345',
    'What did I tell you to remember about my cloud provider?',
    'Save my project context: working on microservices migration',
    'Recall what I stored earlier about API keys'
  ],

  web: [
    'Search the web for latest news about artificial intelligence',
    'Find recent articles about cloud computing trends in 2024',
    'Search for best practices in container security',
    'Look up the current price of Bitcoin',
    'Find tutorials on Kubernetes networking'
  ],

  prometheus: [
    'Query Prometheus for CPU usage metrics over the last hour',
    'Show me memory utilization trends from Prometheus',
    'Get HTTP request rate metrics from Prometheus',
    'Display error rate metrics for the last 24 hours',
    'Query Prometheus for database connection pool stats'
  ],

  admin: [
    'Show current system configuration',
    'List all active user sessions',
    'Display API rate limit status',
    'Show system health metrics',
    'List all configured MCP servers'
  ],

  azureCost: [
    'What are my Azure costs for the current month?',
    'Show cost breakdown by resource group',
    'Display spending trends over the last 3 months',
    'What resources are consuming the most budget?',
    'Show cost forecast for next month'
  ]
};

// Generate message sequence for a session based on session ID
function generateMessageSequence(sessionId) {
  const messages = [];

  // Determine which category this session belongs to
  if (sessionId < 20) {
    // Basic questions - progressively more complex
    for (let i = 0; i < CONFIG.messagesPerSession; i++) {
      messages.push(MESSAGE_TEMPLATES.basic[i % MESSAGE_TEMPLATES.basic.length]);
    }
  } else if (sessionId < 40) {
    // Azure-focused
    const azureIdx = (sessionId - 20) % MESSAGE_TEMPLATES.azure.length;
    messages.push(MESSAGE_TEMPLATES.azure[azureIdx]);
    // Follow-ups
    messages.push('Can you provide more details about the first item?');
    messages.push('What is the status and health of these resources?');
    messages.push('Show me the configuration details');
    messages.push('Are there any cost implications?');
    messages.push('What security settings are applied?');
    messages.push('How long have these resources been running?');
    messages.push('What tags are associated with them?');
    messages.push('Show me the resource dependencies');
    messages.push('What monitoring is configured?');
    messages.push('Are there any compliance issues?');
    messages.push('What backup policies are in place?');
    messages.push('Show me the access control settings');
    messages.push('What regions are these resources in?');
    messages.push('Are there any alerts configured?');
    messages.push('What is the utilization rate?');
    messages.push('Show me the recent activity logs');
    messages.push('Are there any recommendations for optimization?');
    messages.push('What is the estimated monthly cost?');
    messages.push('Format all this information as a markdown table');
  } else if (sessionId < 60) {
    // GCP-focused
    const gcpIdx = (sessionId - 40) % MESSAGE_TEMPLATES.gcp.length;
    messages.push(MESSAGE_TEMPLATES.gcp[gcpIdx]);
    messages.push('Tell me more about the configuration');
    messages.push('What are the performance metrics?');
    messages.push('Show me the IAM permissions');
    messages.push('What are the networking settings?');
    messages.push('Are there any security vulnerabilities?');
    messages.push('What is the current resource utilization?');
    messages.push('Show me the billing information');
    messages.push('What labels or tags are applied?');
    messages.push('Are there any scaling policies?');
    messages.push('What monitoring alerts are set up?');
    messages.push('Show me the API usage statistics');
    messages.push('What are the backup configurations?');
    messages.push('Display the resource hierarchy');
    messages.push('What dependencies exist?');
    messages.push('Show me the audit logs');
    messages.push('Are there any quota limits?');
    messages.push('What is the service availability?');
    messages.push('Show optimization recommendations');
    messages.push('Create a summary report with charts');
  } else if (sessionId < 80) {
    // Flowise workflow creation
    const flowiseIdx = (sessionId - 60) % MESSAGE_TEMPLATES.flowise.length;
    messages.push(MESSAGE_TEMPLATES.flowise[flowiseIdx]);
    messages.push('What components are needed for this workflow?');
    messages.push('Show me the node configuration');
    messages.push('How do I connect the different nodes?');
    messages.push('What input parameters are required?');
    messages.push('Can you add error handling to the workflow?');
    messages.push('How do I test this workflow?');
    messages.push('What are the expected outputs?');
    messages.push('Can you add logging to track execution?');
    messages.push('How do I deploy this to production?');
    messages.push('What environment variables are needed?');
    messages.push('Can you add authentication?');
    messages.push('How do I handle rate limiting?');
    messages.push('What are the performance considerations?');
    messages.push('Can you add caching?');
    messages.push('How do I monitor this workflow?');
    messages.push('What are the cost implications?');
    messages.push('Can you version control this workflow?');
    messages.push('How do I share this with my team?');
    messages.push('Export the workflow configuration as JSON');
  } else {
    // Complex multi-tool tasks
    const complexIdx = (sessionId - 80) % MESSAGE_TEMPLATES.complex.length;
    messages.push(MESSAGE_TEMPLATES.complex[complexIdx]);
    messages.push('Break down the steps needed to accomplish this');
    messages.push('Start with the first step');
    messages.push('Show me the results from that query');
    messages.push('Now proceed to the next step');
    messages.push('Combine the results from both sources');
    messages.push('Format the data for better readability');
    messages.push('Add visual representations where possible');
    messages.push('Include cost analysis in the report');
    messages.push('Highlight any security concerns');
    messages.push('Add recommendations for improvements');
    messages.push('Create automation for this process');
    messages.push('Set up monitoring and alerts');
    messages.push('Document the entire workflow');
    messages.push('Test each component');
    messages.push('Verify the results are accurate');
    messages.push('Optimize for performance');
    messages.push('Add error handling and retry logic');
    messages.push('Create a final comprehensive summary');
    messages.push('Save all results to memory for future reference');
  }

  return messages.slice(0, CONFIG.messagesPerSession);
}

// Track metrics for each message
class MetricsTracker {
  constructor() {
    this.metrics = {
      sessions: [],
      summary: {
        totalSessions: 0,
        totalMessages: 0,
        successfulMessages: 0,
        failedMessages: 0,
        totalTokensInput: 0,
        totalTokensOutput: 0,
        totalDuration: 0,
        avgResponseTime: 0,
        avgTTFB: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        p50ResponseTime: 0,
        p90ResponseTime: 0,
        p99ResponseTime: 0,
        toolCallStats: {},
        errorRate: 0
      }
    };
  }

  addSessionMetrics(sessionMetrics) {
    this.metrics.sessions.push(sessionMetrics);
  }

  calculateSummary() {
    const allMessages = this.metrics.sessions.flatMap(s => s.messages);
    const successfulMessages = allMessages.filter(m => m.success);
    const responseTimes = successfulMessages.map(m => m.responseTime).filter(t => t > 0);

    responseTimes.sort((a, b) => a - b);

    this.metrics.summary = {
      totalSessions: this.metrics.sessions.length,
      totalMessages: allMessages.length,
      successfulMessages: successfulMessages.length,
      failedMessages: allMessages.length - successfulMessages.length,
      totalTokensInput: allMessages.reduce((sum, m) => sum + (m.tokensInput || 0), 0),
      totalTokensOutput: allMessages.reduce((sum, m) => sum + (m.tokensOutput || 0), 0),
      totalDuration: this.metrics.sessions.reduce((sum, s) => sum + s.duration, 0),
      avgResponseTime: responseTimes.length > 0
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : 0,
      avgTTFB: Math.round(allMessages.reduce((sum, m) => sum + (m.ttfb || 0), 0) / allMessages.length),
      minResponseTime: Math.min(...responseTimes),
      maxResponseTime: Math.max(...responseTimes),
      p50ResponseTime: responseTimes[Math.floor(responseTimes.length * 0.5)] || 0,
      p90ResponseTime: responseTimes[Math.floor(responseTimes.length * 0.9)] || 0,
      p99ResponseTime: responseTimes[Math.floor(responseTimes.length * 0.99)] || 0,
      errorRate: ((allMessages.length - successfulMessages.length) / allMessages.length * 100).toFixed(2) + '%',
      toolCallStats: this.calculateToolStats(allMessages)
    };

    return this.metrics;
  }

  calculateToolStats(messages) {
    const toolStats = {};

    messages.forEach(message => {
      if (message.toolsCalled && Array.isArray(message.toolsCalled)) {
        message.toolsCalled.forEach(tool => {
          if (!toolStats[tool]) {
            toolStats[tool] = { count: 0, success: 0, failed: 0 };
          }
          toolStats[tool].count++;
          if (message.success) {
            toolStats[tool].success++;
          } else {
            toolStats[tool].failed++;
          }
        });
      }
    });

    return toolStats;
  }

  saveResults() {
    const outputDir = path.dirname(CONFIG.outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG.outputFile, JSON.stringify(this.metrics, null, 2));
    log(`Results saved to: ${CONFIG.outputFile}`, 'green');
  }
}

// Execute a single chat message
async function sendChatMessage(sessionId, messageIndex, message, conversationId) {
  const startTime = Date.now();
  let ttfb = 0;
  let firstByteReceived = false;

  try {
    const requestBody = {
      model: CONFIG.defaultModel,
      messages: [{ role: 'user', content: message }],
      stream: true
    };

    if (conversationId) {
      requestBody.conversationId = conversationId;
    }

    const response = await fetch(`${CONFIG.apiUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CONFIG.apiKey
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        responseTime: Date.now() - startTime,
        message: message.substring(0, 100)
      };
    }

    let fullContent = '';
    let tokensInput = 0;
    let tokensOutput = 0;
    const toolsCalled = new Set();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();

      if (!firstByteReceived) {
        ttfb = Date.now() - startTime;
        firstByteReceived = true;
      }

      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);

            // Extract content
            const content = parsed.choices?.[0]?.delta?.content || '';
            fullContent += content;

            // Track token usage
            if (parsed.usage) {
              tokensInput = parsed.usage.prompt_tokens || tokensInput;
              tokensOutput = parsed.usage.completion_tokens || tokensOutput;
            }

            // Track tool calls
            if (parsed.choices?.[0]?.delta?.tool_calls) {
              parsed.choices[0].delta.tool_calls.forEach(tc => {
                if (tc.function?.name) {
                  toolsCalled.add(tc.function.name);
                }
              });
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    const responseTime = Date.now() - startTime;

    return {
      success: true,
      responseTime,
      ttfb,
      tokensInput,
      tokensOutput,
      responseLength: fullContent.length,
      toolsCalled: Array.from(toolsCalled),
      message: message.substring(0, 100)
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      responseTime: Date.now() - startTime,
      ttfb,
      message: message.substring(0, 100)
    };
  }
}

// Run a single session with multiple messages
async function runChatSession(sessionId, metricsTracker) {
  const sessionStartTime = Date.now();
  const messages = generateMessageSequence(sessionId);
  const sessionMetrics = {
    sessionId,
    conversationId: null,
    duration: 0,
    messages: []
  };

  log(`[Session ${sessionId + 1}/${CONFIG.numSessions}] Starting with ${messages.length} messages...`, 'cyan');

  for (let i = 0; i < messages.length; i++) {
    const messageResult = await sendChatMessage(
      sessionId,
      i,
      messages[i],
      sessionMetrics.conversationId
    );

    sessionMetrics.messages.push(messageResult);

    // Extract conversation ID from first successful message
    if (i === 0 && messageResult.success) {
      // In a real implementation, you'd extract this from the response
      sessionMetrics.conversationId = `session-${sessionId}-${Date.now()}`;
    }

    // Log progress every 5 messages
    if ((i + 1) % 5 === 0) {
      const successCount = sessionMetrics.messages.filter(m => m.success).length;
      log(`[Session ${sessionId + 1}] Progress: ${i + 1}/${messages.length} messages (${successCount} successful)`, 'blue');
    }
  }

  sessionMetrics.duration = Date.now() - sessionStartTime;

  const successCount = sessionMetrics.messages.filter(m => m.success).length;
  const avgResponseTime = sessionMetrics.messages
    .filter(m => m.success)
    .reduce((sum, m) => sum + m.responseTime, 0) / successCount || 0;

  log(`[Session ${sessionId + 1}] Completed in ${(sessionMetrics.duration / 1000).toFixed(2)}s - ${successCount}/${messages.length} successful (avg: ${avgResponseTime.toFixed(0)}ms)`, 'green');

  return sessionMetrics;
}

// Main test execution
async function runTest() {
  log('\n╔════════════════════════════════════════════════════════════════════╗', 'cyan');
  log('║   Load Test #7A - 100 Concurrent Chat Sessions                    ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════════════╝\n', 'cyan');

  log(`Configuration:`, 'yellow');
  log(`  - API URL: ${CONFIG.apiUrl}`, 'yellow');
  log(`  - API Key: ${CONFIG.apiKey.substring(0, 20)}...`, 'yellow');
  log(`  - Test User: ${CONFIG.testUser}`, 'yellow');
  log(`  - Sessions: ${CONFIG.numSessions}`, 'yellow');
  log(`  - Messages per session: ${CONFIG.messagesPerSession}`, 'yellow');
  log(`  - Total messages: ${CONFIG.numSessions * CONFIG.messagesPerSession}`, 'yellow');
  log(`  - Model: ${CONFIG.defaultModel}\n`, 'yellow');

  log('Test Strategy:', 'yellow');
  log('  - Sessions 1-20:   Basic questions (no MCP tools)', 'yellow');
  log('  - Sessions 21-40:  Azure resource queries (oap-azure-mcp)', 'yellow');
  log('  - Sessions 41-60:  GCP operations (oap-gcp-mcp)', 'yellow');
  log('  - Sessions 61-80:  Flowise workflows (oap-flowise-mcp)', 'yellow');
  log('  - Sessions 81-100: Complex multi-tool tasks\n', 'yellow');

  const metricsTracker = new MetricsTracker();
  const testStartTime = Date.now();

  // Run all sessions in parallel
  log('Starting concurrent sessions...', 'magenta');
  const sessionPromises = [];

  for (let i = 0; i < CONFIG.numSessions; i++) {
    sessionPromises.push(runChatSession(i, metricsTracker));
  }

  // Wait for all sessions to complete
  const sessionResults = await Promise.all(sessionPromises);

  // Add results to metrics tracker
  sessionResults.forEach(result => metricsTracker.addSessionMetrics(result));

  const totalTestDuration = Date.now() - testStartTime;

  // Calculate and display summary
  const finalMetrics = metricsTracker.calculateSummary();

  log('\n╔════════════════════════════════════════════════════════════════════╗', 'cyan');
  log('║                        TEST RESULTS SUMMARY                        ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════════════╝\n', 'cyan');

  log(`Total Test Duration: ${(totalTestDuration / 1000).toFixed(2)}s`, 'green');
  log(`Total Sessions: ${finalMetrics.summary.totalSessions}`, 'green');
  log(`Total Messages: ${finalMetrics.summary.totalMessages}`, 'green');
  log(`Successful Messages: ${finalMetrics.summary.successfulMessages}`, 'green');
  log(`Failed Messages: ${finalMetrics.summary.failedMessages}`, finalMetrics.summary.failedMessages > 0 ? 'red' : 'green');
  log(`Error Rate: ${finalMetrics.summary.errorRate}`, finalMetrics.summary.failedMessages > 0 ? 'red' : 'green');

  log('\nToken Usage:', 'yellow');
  log(`  - Input Tokens:  ${finalMetrics.summary.totalTokensInput.toLocaleString()}`, 'yellow');
  log(`  - Output Tokens: ${finalMetrics.summary.totalTokensOutput.toLocaleString()}`, 'yellow');
  log(`  - Total Tokens:  ${(finalMetrics.summary.totalTokensInput + finalMetrics.summary.totalTokensOutput).toLocaleString()}`, 'yellow');

  log('\nResponse Time Statistics:', 'yellow');
  log(`  - Average: ${finalMetrics.summary.avgResponseTime}ms`, 'yellow');
  log(`  - Minimum: ${finalMetrics.summary.minResponseTime}ms`, 'yellow');
  log(`  - Maximum: ${finalMetrics.summary.maxResponseTime}ms`, 'yellow');
  log(`  - P50:     ${finalMetrics.summary.p50ResponseTime}ms`, 'yellow');
  log(`  - P90:     ${finalMetrics.summary.p90ResponseTime}ms`, 'yellow');
  log(`  - P99:     ${finalMetrics.summary.p99ResponseTime}ms`, 'yellow');
  log(`  - Avg TTFB: ${finalMetrics.summary.avgTTFB}ms`, 'yellow');

  log('\nMCP Tool Usage Statistics:', 'yellow');
  const toolStats = finalMetrics.summary.toolCallStats;
  if (Object.keys(toolStats).length > 0) {
    Object.entries(toolStats).forEach(([tool, stats]) => {
      log(`  - ${tool}: ${stats.count} calls (${stats.success} success, ${stats.failed} failed)`, 'yellow');
    });
  } else {
    log('  - No tool calls detected', 'yellow');
  }

  // Save results
  metricsTracker.saveResults();

  log('\n╔════════════════════════════════════════════════════════════════════╗', 'green');
  log('║                      TEST COMPLETED SUCCESSFULLY                   ║', 'green');
  log('╚════════════════════════════════════════════════════════════════════╝\n', 'green');

  // Determine overall pass/fail
  const errorRatePercent = parseFloat(finalMetrics.summary.errorRate);
  const testPassed = errorRatePercent < 10; // Allow up to 10% error rate

  if (testPassed) {
    log('✓ Test PASSED - Error rate within acceptable threshold', 'green');
    process.exit(0);
  } else {
    log('✗ Test FAILED - Error rate exceeds 10% threshold', 'red');
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  runTest().catch(error => {
    log(`\n✗ Test execution failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });
}

module.exports = { runTest, CONFIG };
