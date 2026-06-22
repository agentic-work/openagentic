# Load Testing Suite

This directory contains comprehensive load tests for the OpenAgentic Chat platform.

## Test #7A - 100 Concurrent Chat Sessions

**File:** `concurrent-chat-sessions.test.js`

### Overview

This test simulates real-world usage by running 100 concurrent chat sessions, each sending 20 messages, for a total of 2,000 messages. The test exercises all available MCP tools and tracks comprehensive metrics.

### Test Configuration

- **Total Sessions:** 100 concurrent sessions
- **Messages per Session:** 20 messages
- **Total Messages:** 2,000 messages
- **API Key:** `oa_test_PLACEHOLDER_REPLACE_WITH_REAL_KEY`
- **Test User:** loadtest@example.com
- **API URL:** http://localhost:8000
- **Default Model:** gemini-2.0-flash-001

### MCP Tools Tested

All available MCP tools are exercised during the test:

1. **admin-mcp** - System administration and configuration
2. **awc-formatting-mcp** - Markdown, tables, charts, mermaid diagrams
3. **oap-admin-mcp** - Admin portal operations
4. **oap-azure-cost-mcp** - Azure cost management and analysis
5. **oap-azure-mcp** - Azure resource queries and management
6. **oap-flowise-mcp** - Flowise workflow creation and management
7. **oap-gcp-mcp** - Google Cloud Platform operations
8. **oap-memory-mcp** - Persistent memory and context storage
9. **oap-prometheus-mcp** - Prometheus metrics and monitoring
10. **oap-web-mcp** - Web search and content retrieval

### Test Strategy

The test is organized into progressive difficulty levels:

#### Sessions 1-20: Basic Questions
- No MCP tool usage
- General knowledge questions
- Architecture and technology concepts
- Baseline performance measurement

#### Sessions 21-40: Azure Resource Queries
- **Primary Tool:** oap-azure-mcp
- List subscriptions, resource groups, VMs
- Query storage accounts, app services, SQL databases
- Check Azure service health and deployments
- Multi-step follow-up questions (20 per session)

#### Sessions 41-60: GCP Operations
- **Primary Tool:** oap-gcp-mcp
- List GCP projects and Compute Engine instances
- Query Cloud Storage, Cloud SQL, Cloud Functions
- Check GKE clusters, BigQuery datasets
- Multi-step follow-up questions (20 per session)

#### Sessions 61-80: Flowise Workflow Creation
- **Primary Tool:** oap-flowise-mcp
- Create chatflows, RAG workflows, agents
- Build document Q&A systems
- Design custom integrations
- Multi-step workflow development (20 per session)

#### Sessions 81-100: Complex Multi-Tool Tasks
- **Multiple Tools:** Combines 2-4 tools per session
- Cross-cloud resource analysis (Azure + GCP)
- Cost monitoring with workflow automation
- Security audits with web research
- Comprehensive reporting with formatting
- Multi-step complex scenarios (20 per session)

### Metrics Tracked

The test captures detailed metrics for each message and session:

#### Per-Message Metrics
- **Response Time:** Total time from request to completion
- **TTFB:** Time to first byte received
- **Token Usage:** Input and output tokens
- **Success/Failure:** Response status
- **Tools Called:** List of MCP tools invoked
- **Response Length:** Character count of response

#### Session Metrics
- **Duration:** Total session time
- **Message Count:** Total messages sent
- **Success Rate:** Percentage of successful messages
- **Average Response Time:** Mean response time per message
- **Tool Usage:** Tools called throughout session

#### Overall Summary
- **Total Sessions:** Number completed
- **Total Messages:** All messages sent
- **Success Rate:** Global success percentage
- **Error Rate:** Global failure percentage
- **Token Statistics:** Total input/output tokens
- **Response Time Distribution:** Min, Max, Avg, P50, P90, P99
- **TTFB Statistics:** Average time to first byte
- **Tool Call Statistics:** Usage count per tool
- **Memory Usage:** System memory consumption

### Running the Test

#### Basic Usage

```bash
# Run with default settings
node concurrent-chat-sessions.test.js
```

#### Custom Configuration

Use environment variables to customize the test:

```bash
# Custom API URL and key
API_URL=http://localhost:8000 \
API_KEY=your_api_key_here \
node concurrent-chat-sessions.test.js

# Adjust session count
NUM_SESSIONS=50 \
MESSAGES_PER_SESSION=10 \
node concurrent-chat-sessions.test.js

# Use different model
DEFAULT_MODEL=gpt-4 \
node concurrent-chat-sessions.test.js
```

#### Environment Variables

- `API_URL` - API endpoint (default: http://localhost:8000)
- `API_KEY` - Authentication key (default: oa_test_PLACEHOLDER_REPLACE_WITH_REAL_KEY)
- `NUM_SESSIONS` - Number of concurrent sessions (default: 100)
- `MESSAGES_PER_SESSION` - Messages per session (default: 20)
- `DEFAULT_MODEL` - LLM model to use (default: gemini-2.0-flash-001)

### Output

#### Console Output

The test provides real-time progress updates:

```
╔════════════════════════════════════════════════════════════════════╗
║   Load Test #7A - 100 Concurrent Chat Sessions                    ║
╚════════════════════════════════════════════════════════════════════╝

Configuration:
  - API URL: http://localhost:8000
  - Sessions: 100
  - Messages per session: 20
  - Total messages: 2000

[Session 1/100] Starting with 20 messages...
[Session 1/100] Progress: 5/20 messages (5 successful)
[Session 1/100] Completed in 45.23s - 20/20 successful (avg: 2261ms)

╔════════════════════════════════════════════════════════════════════╗
║                        TEST RESULTS SUMMARY                        ║
╚════════════════════════════════════════════════════════════════════╝

Total Test Duration: 156.45s
Total Sessions: 100
Total Messages: 2000
Successful Messages: 1987
Failed Messages: 13
Error Rate: 0.65%

Token Usage:
  - Input Tokens:  453,210
  - Output Tokens: 1,234,567
  - Total Tokens:  1,687,777

Response Time Statistics:
  - Average: 2156ms
  - Minimum: 345ms
  - Maximum: 8932ms
  - P50:     1987ms
  - P90:     3421ms
  - P99:     6789ms
  - Avg TTFB: 234ms

MCP Tool Usage Statistics:
  - oap-azure-mcp: 456 calls (452 success, 4 failed)
  - oap-gcp-mcp: 389 calls (389 success, 0 failed)
  - oap-flowise-mcp: 367 calls (361 success, 6 failed)
  - oap-web-mcp: 234 calls (232 success, 2 failed)
  ...
```

#### JSON Results File

Detailed metrics are saved to:
```
tests/test-results/concurrent-chat-sessions-results.json
```

The JSON file contains:
- Complete session-by-session breakdown
- Every message's metrics
- Detailed error information
- Tool usage statistics
- Response time distributions
- Token usage per session

### Success Criteria

The test passes if:
- **Error Rate < 10%** - Less than 10% of messages fail
- **All Sessions Complete** - All 100 sessions finish
- **Results Generated** - JSON output file created

### Interpreting Results

#### Good Performance Indicators
- Error rate < 5%
- P99 response time < 10 seconds
- TTFB < 500ms
- High tool success rate (> 95%)
- No session timeouts

#### Warning Signs
- Error rate 5-10%
- P99 response time > 10 seconds
- TTFB > 1 second
- Tool success rate < 90%
- Intermittent session failures

#### Critical Issues
- Error rate > 10%
- Frequent timeouts
- Tool success rate < 80%
- Memory leaks (increasing over time)
- Cascading failures

### Troubleshooting

#### High Error Rates
1. Check API server logs for errors
2. Verify API key is valid
3. Check network connectivity
4. Review rate limiting settings
5. Check MCP server health

#### Slow Response Times
1. Check database connection pool
2. Review MCP server performance
3. Check network latency
4. Monitor system resources (CPU, memory)
5. Review concurrent connection limits

#### Tool Call Failures
1. Verify MCP servers are running
2. Check authentication tokens
3. Review MCP server logs
4. Check Azure/GCP credentials
5. Verify network access to cloud APIs

### Example Use Cases

#### Performance Baseline
```bash
# Run test to establish baseline performance
node concurrent-chat-sessions.test.js
# Save results as baseline
cp test-results/concurrent-chat-sessions-results.json baseline-results.json
```

#### Stress Testing
```bash
# Increase load to test limits
NUM_SESSIONS=200 MESSAGES_PER_SESSION=30 node concurrent-chat-sessions.test.js
```

#### Tool-Specific Testing
```bash
# Focus on Azure tools (sessions 21-40)
NUM_SESSIONS=40 node concurrent-chat-sessions.test.js
```

#### Quick Smoke Test
```bash
# Reduced test for quick validation
NUM_SESSIONS=10 MESSAGES_PER_SESSION=5 node concurrent-chat-sessions.test.js
```

### Integration with CI/CD

Add to your CI/CD pipeline:

```yaml
# .github/workflows/load-tests.yml
name: Load Tests

on:
  schedule:
    - cron: '0 2 * * *'  # Run nightly at 2 AM
  workflow_dispatch:  # Manual trigger

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'

      - name: Run Load Test
        run: |
          cd tests/load
          node concurrent-chat-sessions.test.js
        env:
          API_URL: ${{ secrets.API_URL }}
          API_KEY: ${{ secrets.API_KEY }}

      - name: Upload Results
        uses: actions/upload-artifact@v2
        with:
          name: load-test-results
          path: tests/test-results/concurrent-chat-sessions-results.json
```

### Monitoring and Alerting

Set up monitoring for:
- Error rate thresholds (alert if > 5%)
- Response time degradation (alert if P99 > 15s)
- Tool failure rates (alert if any tool > 10% failure)
- Token usage trends (monitor cost implications)
- Memory usage patterns (detect leaks)

### Best Practices

1. **Run During Low Traffic** - Minimize impact on production users
2. **Monitor System Resources** - Watch CPU, memory, disk, network
3. **Gradual Ramp-Up** - Start with fewer sessions, increase gradually
4. **Save Baseline Results** - Compare against historical data
5. **Review Logs** - Correlate test results with server logs
6. **Test MCP Health First** - Verify all MCP servers before load test
7. **Use Dedicated Test User** - Isolate test data from production
8. **Clean Up After Tests** - Remove test sessions and data

### Future Enhancements

Planned improvements:
- [ ] Real-time metrics dashboard
- [ ] Progressive load ramping
- [ ] Configurable message templates
- [ ] Per-tool performance reports
- [ ] Memory leak detection
- [ ] Automated regression detection
- [ ] Distributed load generation
- [ ] Custom scenario definitions
- [ ] Results comparison tool
- [ ] Performance trend analysis

### Related Tests

- `parallel-sessions.test.js` - Simpler 20-session test
- `../mcp/azure.test.js` - Azure MCP-specific tests
- `../mcp/web.test.js` - Web search MCP tests
- `../api/chat.test.js` - Basic chat API tests

### Support

For issues or questions:
- Review test logs in `tests/test-results/`
- Check MCP server health at `/api/chat/mcp/status`
- Review API server logs
- Contact platform team

---

## Test Suite #7B - 100 Flowise Workflows

**File:** `flowise-workflow-tests.test.js`

### Overview

This comprehensive load test creates 100 Flowise workflows (50 chatflows + 50 agentflows) via the `oap-flowise-mcp` through the chat API to validate workflow creation at scale.

### Test Configuration

- **Total Workflows:** 100 (50 chatflows + 50 agentflows)
- **API Key:** `oa_test_PLACEHOLDER_REPLACE_WITH_REAL_KEY`
- **Test User:** loadtest@example.com
- **Method:** Creates workflows via chat API using MCP tools

### Workflow Types

#### Chatflows (50 total)
1. **RAG (10)** - Retrieval Augmented Generation flows
2. **Conversational Memory (10)** - Flows with conversation context
3. **Tool Agent (10)** - Agents that use external tools
4. **Custom Tool (10)** - Custom tool integration flows
5. **Multi-chain (10)** - Complex multi-step chain orchestration

#### Agentflows (50 total)
1. **Agentic RAG (10)** - Autonomous retrieval and generation
2. **Agent as Tool (10)** - Agents callable by other agents
3. **Multi-Agent (10)** - Collaborative multi-agent systems
4. **Sequential Agent (10)** - Pipeline-based sequential execution
5. **Supervisor Agent (10)** - Coordinating supervisor patterns

### Features

- **Sequential Creation:** Creates workflows with rate limiting (500ms delay)
- **Real-time Progress:** Shows creation progress with visual feedback
- **Metrics Tracking:**
  - Creation time per workflow
  - Success/failure rates by type
  - Average, min, max durations
  - Total test duration
- **Detailed Results:** Saves comprehensive JSON report with:
  - All workflow IDs created
  - Error details for failures
  - Timing statistics
  - Category breakdowns

### Running the Test

#### Standalone Execution
```bash
cd tests/load
node flowise-workflow-tests.test.js
```

#### With Test Runner
```bash
cd tests
node run-all.js
```

### Environment Variables

```bash
# Optional overrides
export API_URL=http://localhost:8000
export API_KEY=oa_test_PLACEHOLDER_REPLACE_WITH_REAL_KEY
export DEFAULT_MODEL=gemini-2.0-flash-001
```

### Output

The test generates a JSON report at:
```
tests/test-results/flowise-workflow-load-test.json
```

#### Report Structure
```json
{
  "testSuite": "Test Suite #7B - 100 Flowise Workflows",
  "testUser": "loadtest@example.com",
  "timestamp": "2025-12-05T12:00:00.000Z",
  "metrics": {
    "total": 100,
    "successful": 95,
    "failed": 5,
    "successRate": "95.00%",
    "chatflows": {
      "total": 50,
      "successful": 48,
      "failed": 2,
      "successRate": "96.00%"
    },
    "agentflows": {
      "total": 50,
      "successful": 47,
      "failed": 3,
      "successRate": "94.00%"
    },
    "timing": {
      "averageDurationMs": 1234,
      "minDurationMs": 456,
      "maxDurationMs": 5678,
      "totalDurationMs": 123400
    },
    "workflowIds": {
      "chatflows": [...],
      "agentflows": [...]
    },
    "errors": [...]
  }
}
```

### Success Criteria

- **Pass:** All 100 workflows created successfully (100% success rate)
- **Acceptable:** ≥95% success rate (up to 5 failures allowed)
- **Fail:** <95% success rate or test errors

### Expected Duration

- **Per Workflow:** ~500-2000ms (depends on API response time)
- **Total Test:** ~5-10 minutes for 100 workflows (with 500ms delays)

### Troubleshooting

#### Common Issues

1. **Authentication Errors**
   - Verify API key is valid: `oa_test_PLACEHOLDER_REPLACE_WITH_REAL_KEY`
   - Check user permissions in the system

2. **Rate Limiting**
   - Increase delay between requests (default: 500ms)
   - Reduce batch size or run in phases

3. **Timeout Errors**
   - Increase API timeout in config.js
   - Check API server health and capacity

4. **MCP Tool Not Available**
   - Verify oap-flowise-mcp is running
   - Check MCP proxy configuration
   - Ensure user has access to Flowise tools

### Implementation Details

The test uses natural language prompts to the chat API to invoke MCP tools:

```javascript
// Example chatflow creation
const prompt = `Create a new Flowise chatflow with the following details:
- Name: "RAG Assistant 1"
- Description: "Retrieval Augmented Generation assistant..."
- Category: "RAG"
- Deployed: false
- IsPublic: false`;

// The chat API will invoke flowise_create_chatflow via oap-flowise-mcp
```

### Related Tests

- `tests/flowise/agent-flow.test.js` - Basic Flowise integration tests
- `tests/api/chat.test.js` - Chat API functionality tests
- `tests/load/concurrent-chat-sessions.test.js` - Load test #7A

### References

- [Flowise AgentFlowV2 Documentation](https://docs.flowiseai.com/using-flowise/agentflowv2)
- [Flowise Tutorials](https://docs.flowiseai.com/tutorials)
- [oap-flowise-mcp Implementation](../../services/mcps/oap-flowise-mcp/)

---

## Test Suite #7C - Performance Metrics Collection

**File:** `performance-metrics.test.js`

### Overview

This test suite collects comprehensive performance metrics during concurrent load tests. It samples system, API, LLM, Redis, and Milvus metrics at 1-second intervals to provide detailed performance analysis. The test is designed to run concurrently with Tests #7A and #7B to measure actual load performance.

### Test Configuration

- **API Key:** `oa_test_PLACEHOLDER_REPLACE_WITH_REAL_KEY`
- **Sampling Interval:** 1 second (1000ms)
- **Default Test Duration:** 30 seconds (configurable)
- **Output Files:**
  - `tests/test-results/performance-metrics-results.json` - Full metrics data with all samples
  - `tests/test-results/performance-metrics-summary.json` - Aggregated summary report

### Metrics Collected

#### LLM Metrics
- **TTFB (Time to First Byte)** - SSE stream startup latency
- **Token Input Latency** - Time to process input tokens
- **Token Output Latency** - Time to generate output tokens
- **Total Response Time** - End-to-end request duration
- **Model Distribution** - Usage count per model

#### System Metrics (via `/api/health`)
- **Memory Usage** - Heap used/total, percentage
- **Uptime** - Process uptime in seconds
- **Status** - Overall system health status

#### Redis/Cache Metrics (via `/api/admin/redis/stats`)
- **Hit Rate** - Percentage of cache hits
- **Miss Rate** - Calculated from hits and misses
- **Memory Usage** - Redis memory consumption
- **Key Count** - Total keys in Redis
- **Operations/Second** - Redis throughput

#### Milvus/Vector DB Metrics (via `/api/admin/system/milvus/collections`)
- **Collection Count** - Number of vector collections
- **Total Rows** - Total vectors stored across all collections
- **Collection Details** - Per-collection stats (name, rows, index type)
- **Index Types** - HNSW, IVF_FLAT, etc.

#### API Metrics
- **Requests Per Second (RPS)** - Request throughput
- **Error Rate** - Percentage of failed requests
- **Response Time Percentiles** - P50, P95, P99
- **Min/Max/Avg Response Time** - Distribution statistics
- **Endpoint Distribution** - Request count per endpoint

### Running the Test

#### Standalone Mode

Run the performance metrics test by itself (simulates load):

```bash
# Run with default settings (30 seconds)
node performance-metrics.test.js

# Custom test duration
TEST_DURATION=60000 node performance-metrics.test.js  # 60 seconds

# Custom API endpoint
API_URL=http://production-server:8000 node performance-metrics.test.js
```

#### Concurrent with Other Tests (Recommended)

The primary use case is running alongside Tests #7A and #7B to measure performance under actual load:

**Option 1: Manual parallel execution**
```bash
# Terminal 1: Start performance metrics collection
node performance-metrics.test.js &
METRICS_PID=$!

# Terminal 2: Run chat load test
node concurrent-chat-sessions.test.js &

# Terminal 3: Run Flowise tests
node flowise-workflow-tests.test.js &

# Wait for all tests to complete
wait
```

**Option 2: Using the shell script**
```bash
# Runs all three tests concurrently
./run-load-test.sh
```

### Output

#### Real-Time Console Output

The test displays metrics every second:

```
[12:34:56] [3.5s] RPS: 12.34 | Errors: 2.1% | P95: 2456ms | Mem: 45.2% | Requests: 43
[12:34:57] [4.5s] RPS: 13.21 | Errors: 1.8% | P95: 2398ms | Mem: 45.8% | Requests: 59
[12:34:58] [5.5s] RPS: 14.02 | Errors: 1.5% | P95: 2301ms | Mem: 46.1% | Requests: 77
```

#### Summary Report

```
╔════════════════════════════════════════════════════════════════════╗
║                  PERFORMANCE METRICS SUMMARY                       ║
╚════════════════════════════════════════════════════════════════════╝

=== LLM METRICS ===
Average TTFB: 234ms
TTFB P50: 198ms | P95: 456ms | P99: 678ms
Min TTFB: 145ms | Max TTFB: 892ms
Avg Token Input Latency: 67ms
Avg Token Output Latency: 123ms
Avg Response Time: 2156ms

Model Distribution:
  - gemini-2.0-flash-001: 45 requests
  - gpt-4o-mini: 32 requests
  - claude-3-5-sonnet-20241022: 28 requests

=== API METRICS ===
Total Requests: 105
Successful: 103 | Failed: 2
Error Rate: 1.90%
Average RPS: 3.50
Response Times - Avg: 2156ms
  P50: 1987ms | P95: 3421ms | P99: 4567ms
  Min: 345ms | Max: 5432ms

Endpoint Distribution:
  - /api/v1/chat/completions: 105 requests

=== SYSTEM METRICS ===
Samples Collected: 30 (30 available)
Average Memory Usage: 45.6%
Peak Memory Usage: 52.3%
Average Memory: 234.5 MB

=== REDIS/CACHE METRICS ===
Samples Collected: 30
Average Hit Rate: 87.3%
Average Keys: 1,234
Average Ops/Sec: 156.2

=== MILVUS/VECTOR DB METRICS ===
Samples Collected: 30
Collections: 5
Total Rows: 45,678

Collection Details:
  - chat_memories: 12,345 rows (HNSW)
  - knowledge_base: 23,456 rows (IVF_FLAT)
  - user_preferences: 9,877 rows (HNSW)
```

#### JSON Output Files

**Full Metrics** (`performance-metrics-results.json`):
```json
{
  "config": {
    "apiUrl": "http://localhost:8000",
    "apiKey": "oa_test_PLACEHOLDER_...",
    "samplingInterval": 1000
  },
  "startTime": 1733404800000,
  "endTime": 1733404830000,
  "samples": [
    {
      "timestamp": 1733404801000,
      "elapsed": 1000,
      "system": {
        "available": true,
        "memory": { "used": 123456789, "total": 268435456, "percentage": "46.0" },
        "uptime": 12345,
        "status": "healthy"
      },
      "redis": {
        "available": true,
        "memory": 12345678,
        "keys": 1234,
        "hitRate": "87.3",
        "ops": 156
      },
      "milvus": {
        "available": true,
        "collections": 5,
        "totalRows": 45678,
        "collectionStats": [...]
      },
      "api": {
        "totalRequests": 43,
        "successful": 42,
        "errors": 1,
        "errorRate": "2.33",
        "avgResponseTime": "2156",
        "p50": 1987,
        "p95": 3421,
        "p99": 4567,
        "rps": "12.34",
        "endpoints": {
          "/api/v1/chat/completions": 43
        }
      }
    }
  ],
  "llmMetrics": {
    "ttfbSamples": [234, 198, 345, ...],
    "tokenInputLatencies": [67, 54, 89, ...],
    "tokenOutputLatencies": [123, 109, 156, ...],
    "responseTimes": [2156, 1987, 2345, ...],
    "modelUsage": {
      "gemini-2.0-flash-001": 45,
      "gpt-4o-mini": 32
    }
  },
  "summary": { ... }
}
```

**Summary Report** (`performance-metrics-summary.json`):
```json
{
  "testDuration": 30000,
  "samplesCollected": 30,
  "llm": {
    "avgTTFB": 234,
    "p50TTFB": 198,
    "p95TTFB": 456,
    "p99TTFB": 678,
    "minTTFB": 145,
    "maxTTFB": 892,
    "avgTokenInputLatency": 67,
    "avgTokenOutputLatency": 123,
    "avgResponseTime": 2156,
    "modelDistribution": { ... }
  },
  "api": {
    "totalRequests": 105,
    "successfulRequests": 103,
    "failedRequests": 2,
    "errorRate": "1.90%",
    "avgRPS": "3.50",
    "avgResponseTime": 2156,
    "p50": 1987,
    "p95": 3421,
    "p99": 4567,
    "minResponseTime": 345,
    "maxResponseTime": 5432,
    "endpointDistribution": { ... }
  },
  "system": {
    "samplesCollected": 30,
    "availableSamples": 30,
    "avgMemoryUsage": "45.60",
    "peakMemoryUsage": "52.30",
    "avgMemoryMB": "234.50"
  },
  "redis": {
    "samplesCollected": 30,
    "avgHitRate": "87.30%",
    "avgKeys": 1234,
    "avgOpsPerSec": "156.20"
  },
  "milvus": {
    "samplesCollected": 30,
    "collections": 5,
    "totalRows": 45678,
    "collectionDetails": [...]
  }
}
```

### Environment Variables

- `API_URL` - API endpoint (default: http://localhost:8000)
- `API_KEY` - Authentication key (default: oa_test_PLACEHOLDER_REPLACE_WITH_REAL_KEY)
- `TEST_DURATION` - Test duration in milliseconds (default: 30000)
- `SAMPLING_INTERVAL` - Sampling interval in milliseconds (default: 1000)

### Using as a Library

Import and use the metrics collector in your own tests:

```javascript
const { MetricsCollector } = require('./performance-metrics.test.js');

// Create collector
const collector = new MetricsCollector();

// Start collection (samples every 1 second)
await collector.start();

// Run your tests...
// The collector automatically samples system metrics

// Optionally track requests manually
collector.trackRequest('/api/v1/chat/completions', 1234, true, 'gemini-2.0-flash-001');
collector.trackLLMMetrics(234, 67, 123, 1234);

// Stop collection
collector.stop();

// Get summary
const summary = collector.getSummary();
console.log(JSON.stringify(summary, null, 2));

// Save results to files
collector.saveResults();
```

### Success Criteria

The test passes if:
- **Error Rate < 10%** - Less than 10% of API requests fail
- **Avg Response Time < 10s** - Average response time under 10 seconds
- **P95 Response Time < 20s** - 95th percentile under 20 seconds
- **Metrics Collection Complete** - All samples collected successfully

### Performance Baselines

#### Excellent Performance
- Error rate < 2%
- P95 response time < 2 seconds
- TTFB < 200ms
- Memory usage < 50%
- Redis hit rate > 90%

#### Good Performance
- Error rate 2-5%
- P95 response time 2-3 seconds
- TTFB 200-300ms
- Memory usage 50-60%
- Redis hit rate 80-90%

#### Acceptable Performance
- Error rate 5-8%
- P95 response time 3-5 seconds
- TTFB 300-500ms
- Memory usage 60-75%
- Redis hit rate 60-80%

#### Poor Performance (Needs Investigation)
- Error rate > 8%
- P95 response time > 5 seconds
- TTFB > 500ms
- Memory usage > 75%
- Redis hit rate < 60%

### Troubleshooting

#### High TTFB
1. Check network latency to API server
2. Review API server cold start time
3. Check load balancer configuration
4. Review SSL/TLS handshake overhead
5. Verify DNS resolution time

#### High Memory Usage
1. Check for memory leaks in application
2. Review cache size configurations
3. Monitor heap growth over time
4. Check for large object allocations
5. Review garbage collection frequency

#### Low Redis Hit Rate
1. Review cache key strategies
2. Check TTL configurations
3. Verify cache warming processes
4. Review cache invalidation logic
5. Check cache key naming conventions

#### Milvus Query Latency
1. Check index type (HNSW vs IVF_FLAT vs FLAT)
2. Review collection size and vector dimensions
3. Check query batch sizes
4. Monitor Milvus resource usage (CPU, memory)
5. Consider index optimization

#### High Error Rates
1. Check API server logs for errors
2. Review rate limiting configurations
3. Verify authentication tokens
4. Check connection pool exhaustion
5. Monitor database connection health

### Integration with CI/CD

Add performance metrics collection to your CI/CD pipeline:

```yaml
# .github/workflows/performance-tests.yml
name: Performance Tests

on:
  schedule:
    - cron: '0 2 * * *'  # Nightly at 2 AM
  workflow_dispatch:  # Manual trigger

jobs:
  performance-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'

      - name: Run All Load Tests Concurrently
        run: |
          cd tests/load

          # Start metrics collection
          TEST_DURATION=300000 node performance-metrics.test.js &
          METRICS_PID=$!

          # Start chat load test
          node concurrent-chat-sessions.test.js &
          CHAT_PID=$!

          # Start Flowise test
          node flowise-workflow-tests.test.js &
          FLOWISE_PID=$!

          # Wait for all to complete
          wait $METRICS_PID $CHAT_PID $FLOWISE_PID
        env:
          API_URL: ${{ secrets.API_URL }}
          API_KEY: ${{ secrets.API_KEY }}

      - name: Upload Metrics
        uses: actions/upload-artifact@v2
        with:
          name: performance-metrics
          path: |
            tests/test-results/performance-metrics-results.json
            tests/test-results/performance-metrics-summary.json
            tests/test-results/concurrent-chat-sessions-results.json
            tests/test-results/flowise-workflow-load-test.json

      - name: Check Performance Thresholds
        run: |
          cd tests/load
          node -e "
            const summary = require('../test-results/performance-metrics-summary.json');
            const errorRate = parseFloat(summary.api.errorRate);
            const p95 = summary.api.p95;

            console.log('Error Rate:', errorRate, '%');
            console.log('P95 Response Time:', p95, 'ms');

            if (errorRate > 5) {
              console.error('FAIL: Error rate exceeds 5%');
              process.exit(1);
            }

            if (p95 > 5000) {
              console.error('FAIL: P95 response time exceeds 5s');
              process.exit(1);
            }

            console.log('PASS: All thresholds met');
          "
```

### Monitoring and Alerting

Set up alerts based on metrics:

1. **Error Rate Alerts**
   - Warning: > 5%
   - Critical: > 10%

2. **Response Time Alerts**
   - Warning: P95 > 3s
   - Critical: P95 > 5s

3. **Memory Alerts**
   - Warning: > 70%
   - Critical: > 85%

4. **Redis Alerts**
   - Warning: Hit rate < 70%
   - Critical: Hit rate < 50%

### Best Practices

1. **Establish Baselines** - Run metrics tests regularly to establish performance baselines
2. **Compare Trends** - Track metrics over time to identify performance degradation
3. **Run During Load** - Always run metrics collection concurrently with actual load tests
4. **Monitor All Layers** - Track LLM, API, system, cache, and database metrics together
5. **Set Realistic Thresholds** - Base thresholds on actual usage patterns
6. **Investigate Anomalies** - Any sudden changes warrant investigation
7. **Document Changes** - Note configuration changes that affect metrics

### Related Tests

- `concurrent-chat-sessions.test.js` - Test #7A: 100 concurrent chat sessions
- `flowise-workflow-tests.test.js` - Test #7B: 100 Flowise workflow creation
- `run-load-test.sh` - Shell script to run all load tests concurrently
- `parallel-sessions.test.js` - Simpler 20-session concurrent test
- `../api/admin.test.js` - Admin API tests including health/stats endpoints

---

**Last Updated:** 2025-12-05
**Test Versions:** 7A, 7B, 7C
**Author:** OpenAgentic Platform Team
