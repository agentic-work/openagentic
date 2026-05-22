# Test Suite #7B Summary

## Overview

**Test Suite #7B - 100 Flowise Workflows** is a comprehensive load test that creates 100 Flowise workflows through the oap-flowise-mcp via the chat API.

## Quick Facts

- **File:** `flowise-workflow-tests.test.js`
- **Lines of Code:** 564
- **Functions:** 7 async functions
- **Total Workflows:** 100 (50 chatflows + 50 agentflows)
- **Workflow Types:** 10 types (5 chatflow types, 5 agentflow types)
- **Expected Duration:** 5-10 minutes
- **API Key:** `awc_test_openagentic-test_16bdbaf284042b28dc724bec24b4ff79`
- **Test User:** admin@openagentic.local

## Test Architecture

### Workflow Type Distribution

#### Chatflows (50 total)
| Type | Count | Description |
|------|-------|-------------|
| RAG | 10 | Retrieval Augmented Generation flows |
| Conversational Memory | 10 | Flows with conversation context |
| Tool Agent | 10 | Agents that use external tools |
| Custom Tool | 10 | Custom tool integration flows |
| Multi-chain | 10 | Complex multi-step chain orchestration |

#### Agentflows (50 total)
| Type | Count | Description |
|------|-------|-------------|
| Agentic RAG | 10 | Autonomous retrieval and generation |
| Agent as Tool | 10 | Agents callable by other agents |
| Multi-Agent | 10 | Collaborative multi-agent systems |
| Sequential Agent | 10 | Pipeline-based sequential execution |
| Supervisor Agent | 10 | Coordinating supervisor patterns |

### Key Functions

1. **createChatflowViaMCP()** - Creates chatflows via chat API
2. **createAgentflowViaMCP()** - Creates agentflows via chat API
3. **verifyWorkflowCreation()** - Verifies workflows were created
4. **createChatflows()** - Orchestrates all chatflow creation
5. **createAgentflows()** - Orchestrates all agentflow creation
6. **calculateMetrics()** - Computes success rates and timing
7. **run()** - Main test runner

## Workflow Creation Process

### 1. Chatflow Creation Flow
```
User Request → Chat API → MCP Proxy → oap-flowise-mcp → flowise_create_chatflow → Flowise API → Database
```

### 2. Agentflow Creation Flow
```
User Request → Chat API → MCP Proxy → oap-flowise-mcp → flowise_create_chatflow_advanced → Flowise API → Database
```

## Metrics Collected

### Per-Workflow Metrics
- ✅ Success/failure status
- ⏱️ Creation duration (ms)
- 🆔 Workflow ID
- 📁 Category
- 📝 Response content
- ⚠️ Error details (if failed)
- 🕐 Timestamp

### Aggregate Metrics
- 📊 Total/successful/failed counts
- 📈 Success rate (%)
- ⚡ Average/min/max duration
- 🎯 Per-type success rates
- 📋 List of all workflow IDs
- ❌ Error summary

## Test Execution Timeline

```
Start
  │
  ├─► Create 50 Chatflows (sequential)
  │     ├─► RAG (10) - 0:00 to 0:30
  │     ├─► Conversational Memory (10) - 0:30 to 1:00
  │     ├─► Tool Agent (10) - 1:00 to 1:30
  │     ├─► Custom Tool (10) - 1:30 to 2:00
  │     └─► Multi-chain (10) - 2:00 to 2:30
  │
  ├─► Create 50 Agentflows (sequential)
  │     ├─► Agentic RAG (10) - 2:30 to 3:15
  │     ├─► Agent as Tool (10) - 3:15 to 4:00
  │     ├─► Multi-Agent (10) - 4:00 to 4:45
  │     ├─► Sequential Agent (10) - 4:45 to 5:30
  │     └─► Supervisor Agent (10) - 5:30 to 6:15
  │
  ├─► Calculate Metrics
  ├─► Save Results
  └─► Display Summary
```

## Output Files

### JSON Results File
**Location:** `tests/test-results/flowise-workflow-load-test.json`

**Structure:**
```json
{
  "testSuite": "Test Suite #7B - 100 Flowise Workflows",
  "testUser": "admin@openagentic.local",
  "apiKey": "awc_test_openagentic-test_16...",
  "timestamp": "ISO-8601 timestamp",
  "metrics": {
    "total": 100,
    "successful": 98,
    "failed": 2,
    "successRate": "98.00%",
    "chatflows": {...},
    "agentflows": {...},
    "timing": {...},
    "workflowIds": {...},
    "errors": [...]
  },
  "chatflowResults": [...],
  "agentflowResults": [...]
}
```

## Success Criteria

| Metric | Pass | Acceptable | Fail |
|--------|------|------------|------|
| Success Rate | 100% | ≥95% | <95% |
| Chatflow Success | 50/50 | ≥48/50 | <48/50 |
| Agentflow Success | 50/50 | ≥48/50 | <48/50 |
| Test Completion | Yes | Yes | No |
| Results Generated | Yes | Yes | No |

## Dependencies

### Required Services
- ✅ OpenAgenticChat API (port 8000)
- ✅ MCP Proxy (embedded in API)
- ✅ oap-flowise-mcp (MCP server)
- ✅ Flowise (port 3000)
- ✅ PostgreSQL (Flowise database)

### Node.js Modules
- `fs/promises` - File system operations
- `path` - Path utilities
- `../config` - Test configuration and helpers

## Usage Examples

### Basic Run
```bash
node flowise-workflow-tests.test.js
```

### Custom Configuration
```bash
API_URL=http://localhost:8000 \
API_KEY=awc_test_openagentic-test_16bdbaf284042b28dc724bec24b4ff79 \
node flowise-workflow-tests.test.js
```

### View Results
```bash
cat ../test-results/flowise-workflow-load-test.json | jq .metrics
```

## Performance Benchmarks

### Expected Performance
- **Per-workflow creation:** 500-2000ms
- **Total test duration:** 5-10 minutes
- **Success rate:** ≥95%
- **Error rate:** ≤5%

### Typical Results
```
Total Workflows: 100
Successful: 98 (98%)
Failed: 2 (2%)

Timing:
  Average: 1234ms
  Min: 567ms
  Max: 3456ms
  Total: 123s (2.05 minutes)
```

## Troubleshooting Guide

### Common Issues

#### 1. High Failure Rate (>10%)
**Symptoms:** Multiple workflows fail to create
**Causes:**
- MCP server not running
- Flowise API unavailable
- Database connection issues
- Authentication problems

**Solutions:**
- Check MCP proxy status
- Verify Flowise is running
- Check database connectivity
- Validate API key

#### 2. Timeout Errors
**Symptoms:** Workflows timeout during creation
**Causes:**
- Slow API responses
- Database overload
- Network latency

**Solutions:**
- Increase timeout in config.js
- Reduce concurrent load
- Check system resources
- Optimize database queries

#### 3. Authentication Failures
**Symptoms:** "401 Unauthorized" or "403 Forbidden"
**Causes:**
- Invalid API key
- User permissions
- MCP proxy configuration

**Solutions:**
- Verify API key is correct
- Check user access rights
- Review MCP proxy logs

## Integration Points

### Chat API Integration
The test integrates with the chat API using natural language prompts:

```javascript
const prompt = `Create a new Flowise chatflow with the following details:
- Name: "RAG Assistant 1"
- Description: "Retrieval Augmented Generation assistant..."
- Category: "RAG"
- Deployed: false
- IsPublic: false`;
```

### MCP Tool Invocation
The chat API automatically invokes the appropriate MCP tools:
- `flowise_create_chatflow` - For basic chatflows
- `flowise_create_chatflow_advanced` - For agentflows with advanced features

### Flowise API
The MCP tools interact with Flowise API endpoints:
- `POST /api/v1/chatflows` - Create chatflow
- `GET /api/v1/chatflows` - List chatflows
- `GET /api/v1/chatflows/{id}` - Get chatflow details

## Future Enhancements

- [ ] Parallel workflow creation for faster execution
- [ ] Workflow execution testing (run predictions on created flows)
- [ ] Workflow update and deletion tests
- [ ] Advanced workflow configurations (memory, tools, etc.)
- [ ] Performance regression detection
- [ ] Automated cleanup of test workflows
- [ ] Integration with CI/CD pipeline
- [ ] Real-time progress visualization

## References

- **Test File:** `/mnt/synology/Code/company/cdc/agentic/tests/load/flowise-workflow-tests.test.js`
- **Documentation:** `/mnt/synology/Code/company/cdc/agentic/tests/load/README.md`
- **Quick Start:** `/mnt/synology/Code/company/cdc/agentic/tests/load/QUICKSTART.md`
- **MCP Server:** `/mnt/synology/Code/company/cdc/agentic/services/mcps/oap-flowise-mcp/`
- **Flowise Docs:** https://docs.flowiseai.com

---

**Created:** 2025-12-05
**Version:** 1.0
**Status:** Ready for Testing
