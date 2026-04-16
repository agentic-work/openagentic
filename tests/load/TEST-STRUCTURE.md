# Test #7A Structure - 100 Concurrent Chat Sessions

## Overview

This document provides a detailed breakdown of the test structure, message sequences, and MCP tool coverage.

## Test Architecture

```
100 Concurrent Sessions
├── Sessions 1-20:   Basic Questions (No MCP tools)
│   └── 20 messages each = 400 total messages
│
├── Sessions 21-40:  Azure Operations (oap-azure-mcp)
│   └── 20 messages each = 400 total messages
│
├── Sessions 41-60:  GCP Operations (oap-gcp-mcp)
│   └── 20 messages each = 400 total messages
│
├── Sessions 61-80:  Flowise Workflows (oap-flowise-mcp)
│   └── 20 messages each = 400 total messages
│
└── Sessions 81-100: Complex Multi-Tool Tasks
    └── 20 messages each = 400 total messages

Total: 2000 messages across 100 concurrent sessions
```

## MCP Tool Coverage

### Primary Tools (by session range)

| Sessions | Primary Tool | Operations Tested | Messages |
|----------|-------------|-------------------|----------|
| 1-20 | None | Baseline performance | 400 |
| 21-40 | oap-azure-mcp | Subscriptions, VMs, Storage, SQL, Key Vaults, NSGs, App Services | 400 |
| 41-60 | oap-gcp-mcp | Projects, Compute, Storage, SQL, Functions, GKE, BigQuery | 400 |
| 61-80 | oap-flowise-mcp | Chatflows, RAG workflows, Agents, Integrations | 400 |
| 81-100 | Multi-tool | Combined operations across 2-4 tools | 400 |

### Secondary Tools (used across sessions)

| Tool | Usage Pattern | Expected Calls |
|------|---------------|----------------|
| awc-formatting-mcp | Formatting results | ~200-300 |
| oap-web-mcp | Web searches, research | ~150-250 |
| oap-memory-mcp | Context storage | ~100-200 |
| oap-azure-cost-mcp | Cost queries | ~80-120 |
| oap-prometheus-mcp | Metrics queries | ~50-100 |
| admin-mcp | System queries | ~30-50 |
| oap-admin-mcp | Admin operations | ~20-40 |

### Total Expected Tool Calls

- **Minimum:** ~1,500 tool calls
- **Expected:** ~2,000-2,500 tool calls
- **Maximum:** ~3,000 tool calls

## Message Sequence Patterns

### Pattern 1: Basic Questions (Sessions 1-20)

```
Message 1: What is the capital of France?
Message 2: Explain quantum computing in simple terms
Message 3: What are the benefits of microservices architecture?
...
Message 20: How do you design a scalable web application?
```

**Purpose:** Establish baseline performance without MCP tool overhead

### Pattern 2: Azure Deep Dive (Sessions 21-40)

```
Message 1:  List all my Azure subscriptions and show their details
Message 2:  Can you provide more details about the first item?
Message 3:  What is the status and health of these resources?
Message 4:  Show me the configuration details
Message 5:  Are there any cost implications?
Message 6:  What security settings are applied?
Message 7:  How long have these resources been running?
Message 8:  What tags are associated with them?
Message 9:  Show me the resource dependencies
Message 10: What monitoring is configured?
Message 11: Are there any compliance issues?
Message 12: What backup policies are in place?
Message 13: Show me the access control settings
Message 14: What regions are these resources in?
Message 15: Are there any alerts configured?
Message 16: What is the utilization rate?
Message 17: Show me the recent activity logs
Message 18: Are there any recommendations for optimization?
Message 19: What is the estimated monthly cost?
Message 20: Format all this information as a markdown table
```

**Purpose:** Test comprehensive Azure resource queries with progressive detail

### Pattern 3: GCP Deep Dive (Sessions 41-60)

```
Message 1:  List all GCP projects I have access to
Message 2:  Tell me more about the configuration
Message 3:  What are the performance metrics?
Message 4:  Show me the IAM permissions
Message 5:  What are the networking settings?
Message 6:  Are there any security vulnerabilities?
Message 7:  What is the current resource utilization?
Message 8:  Show me the billing information
Message 9:  What labels or tags are applied?
Message 10: Are there any scaling policies?
Message 11: What monitoring alerts are set up?
Message 12: Show me the API usage statistics
Message 13: What are the backup configurations?
Message 14: Display the resource hierarchy
Message 15: What dependencies exist?
Message 16: Show me the audit logs
Message 17: Are there any quota limits?
Message 18: What is the service availability?
Message 19: Show optimization recommendations
Message 20: Create a summary report with charts
```

**Purpose:** Test comprehensive GCP operations with visualization

### Pattern 4: Flowise Workflow Creation (Sessions 61-80)

```
Message 1:  Create a simple chatflow in Flowise with a ConversationChain
Message 2:  What components are needed for this workflow?
Message 3:  Show me the node configuration
Message 4:  How do I connect the different nodes?
Message 5:  What input parameters are required?
Message 6:  Can you add error handling to the workflow?
Message 7:  How do I test this workflow?
Message 8:  What are the expected outputs?
Message 9:  Can you add logging to track execution?
Message 10: How do I deploy this to production?
Message 11: What environment variables are needed?
Message 12: Can you add authentication?
Message 13: How do I handle rate limiting?
Message 14: What are the performance considerations?
Message 15: Can you add caching?
Message 16: How do I monitor this workflow?
Message 17: What are the cost implications?
Message 18: Can you version control this workflow?
Message 19: How do I share this with my team?
Message 20: Export the workflow configuration as JSON
```

**Purpose:** Test workflow creation, configuration, and deployment

### Pattern 5: Complex Multi-Tool (Sessions 81-100)

```
Message 1:  Check my Azure costs and create a Flowise workflow to monitor them
Message 2:  Break down the steps needed to accomplish this
Message 3:  Start with the first step
Message 4:  Show me the results from that query
Message 5:  Now proceed to the next step
Message 6:  Combine the results from both sources
Message 7:  Format the data for better readability
Message 8:  Add visual representations where possible
Message 9:  Include cost analysis in the report
Message 10: Highlight any security concerns
Message 11: Add recommendations for improvements
Message 12: Create automation for this process
Message 13: Set up monitoring and alerts
Message 14: Document the entire workflow
Message 15: Test each component
Message 16: Verify the results are accurate
Message 17: Optimize for performance
Message 18: Add error handling and retry logic
Message 19: Create a final comprehensive summary
Message 20: Save all results to memory for future reference
```

**Purpose:** Test orchestration across multiple MCP tools with complex workflows

## Metrics Collection

### Per-Message Metrics

```javascript
{
  success: boolean,
  responseTime: number,      // Total time (ms)
  ttfb: number,              // Time to first byte (ms)
  tokensInput: number,       // Input tokens
  tokensOutput: number,      // Output tokens
  responseLength: number,    // Character count
  toolsCalled: string[],     // List of MCP tools invoked
  message: string,           // Truncated message content
  error?: string            // Error message if failed
}
```

### Per-Session Metrics

```javascript
{
  sessionId: number,
  conversationId: string,
  duration: number,         // Total session time (ms)
  messages: Array<MessageMetrics>
}
```

### Summary Metrics

```javascript
{
  totalSessions: number,
  totalMessages: number,
  successfulMessages: number,
  failedMessages: number,
  totalTokensInput: number,
  totalTokensOutput: number,
  totalDuration: number,
  avgResponseTime: number,
  avgTTFB: number,
  minResponseTime: number,
  maxResponseTime: number,
  p50ResponseTime: number,
  p90ResponseTime: number,
  p99ResponseTime: number,
  errorRate: string,
  toolCallStats: {
    [toolName: string]: {
      count: number,
      success: number,
      failed: number
    }
  }
}
```

## Expected Performance Benchmarks

### Baseline (No MCP Tools)

- **Avg Response Time:** 500-1500ms
- **P99 Response Time:** < 3000ms
- **TTFB:** < 200ms
- **Token Usage:** 50-200 input, 200-800 output per message

### With MCP Tools

- **Avg Response Time:** 2000-4000ms
- **P99 Response Time:** < 10000ms
- **TTFB:** < 500ms
- **Token Usage:** 200-500 input, 500-1500 output per message

### Complex Multi-Tool

- **Avg Response Time:** 3000-6000ms
- **P99 Response Time:** < 15000ms
- **TTFB:** < 800ms
- **Token Usage:** 400-800 input, 1000-2500 output per message

## Success Criteria

### Hard Requirements (Must Pass)

- ✅ Error rate < 10%
- ✅ All 100 sessions complete
- ✅ Results file generated
- ✅ No sessions timeout

### Soft Requirements (Performance)

- 🎯 P99 response time < 15 seconds
- 🎯 Average TTFB < 1 second
- 🎯 Tool success rate > 90%
- 🎯 No memory leaks detected

### Stretch Goals

- 🌟 Error rate < 5%
- 🌟 P99 response time < 10 seconds
- 🌟 Tool success rate > 95%
- 🌟 Average response time < 3 seconds

## Test Progression Strategy

### Phase 1: Smoke Test (10 sessions, 5 messages)

- Verify basic connectivity
- Test each MCP tool category once
- Validate metrics collection
- Expected duration: 2-3 minutes

### Phase 2: Quick Test (20 sessions, 10 messages)

- Test representative sample from each category
- Verify tool orchestration works
- Check error handling
- Expected duration: 5-10 minutes

### Phase 3: Full Test (100 sessions, 20 messages)

- Comprehensive coverage of all tools
- Full stress test of system
- Detailed metrics collection
- Expected duration: 15-30 minutes

### Phase 4: Stress Test (200 sessions, 30 messages)

- Maximum load testing
- Identify breaking points
- Performance under extreme load
- Expected duration: 45-60 minutes

## Failure Analysis

### Common Failure Patterns

1. **Network Timeouts**
   - Symptom: High error rate in specific session ranges
   - Likely cause: Network connectivity issues
   - Investigation: Check network logs, API gateway timeouts

2. **MCP Server Failures**
   - Symptom: Specific tool has high failure rate
   - Likely cause: MCP server down or overloaded
   - Investigation: Check MCP server health, logs

3. **Rate Limiting**
   - Symptom: Errors increase over time
   - Likely cause: Rate limits exceeded
   - Investigation: Check rate limit settings, adjust concurrency

4. **Memory Issues**
   - Symptom: Performance degrades over time
   - Likely cause: Memory leaks, resource exhaustion
   - Investigation: Monitor memory usage, check for leaks

5. **Authentication Failures**
   - Symptom: Consistent failures for specific tools
   - Likely cause: Invalid or expired credentials
   - Investigation: Verify API keys, Azure/GCP tokens

## Debugging Guide

### Low-Level Debugging

```bash
# Enable debug logging
DEBUG=* node concurrent-chat-sessions.test.js

# Test single session
NUM_SESSIONS=1 MESSAGES_PER_SESSION=5 node concurrent-chat-sessions.test.js

# Test specific session range (modify test code)
# Sessions 21-25 (Azure only)
NUM_SESSIONS=5 node concurrent-chat-sessions.test.js
```

### Analyzing Results

```bash
# View overall summary
cat test-results/concurrent-chat-sessions-results.json | jq '.summary'

# View failed messages
cat test-results/concurrent-chat-sessions-results.json | jq '.sessions[].messages[] | select(.success == false)'

# View tool statistics
cat test-results/concurrent-chat-sessions-results.json | jq '.summary.toolCallStats'

# View slowest responses
cat test-results/concurrent-chat-sessions-results.json | jq '.sessions[].messages[] | select(.responseTime > 10000)'

# View session summaries
cat test-results/concurrent-chat-sessions-results.json | jq '.sessions[] | {sessionId, duration, successCount: [.messages[] | select(.success == true)] | length}'
```

## Maintenance

### Updating Message Templates

To add new questions or modify existing ones:

1. Edit the `MESSAGE_TEMPLATES` object in `concurrent-chat-sessions.test.js`
2. Ensure each category has enough variety (20+ unique messages)
3. Test with smoke test first
4. Run full test to validate

### Adding New MCP Tools

To test a new MCP tool:

1. Add tool to the header documentation
2. Create message templates in appropriate category
3. Update expected tool call counts
4. Run smoke test to verify tool integration
5. Document tool usage in README

### Adjusting Thresholds

Performance thresholds can be adjusted in the test file:

```javascript
// Adjust error rate threshold (line ~900)
const testPassed = errorRatePercent < 10; // Change from 10

// Adjust timeout settings
const CONFIG = {
  // Add timeout configuration
  messageTimeout: 30000, // 30 seconds per message
  sessionTimeout: 600000 // 10 minutes per session
};
```

---

**Document Version:** 1.0
**Last Updated:** 2025-12-05
**Test Version:** 7A
