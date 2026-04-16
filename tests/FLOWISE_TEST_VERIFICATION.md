# Test Suite #7B - Flowise Workflow Tests Verification

## ✅ Test Suite Created Successfully

### Files Created

1. **Main Test File**
   - Location: `/mnt/synology/Code/company/cdc/agentic/tests/load/flowise-workflow-tests.test.js`
   - Size: 564 lines
   - Functions: 7 async functions
   - Status: ✅ Syntax validated

2. **Documentation Files**
   - `/mnt/synology/Code/company/cdc/agentic/tests/load/README.md` - Updated with Test #7B section
   - `/mnt/synology/Code/company/cdc/agentic/tests/load/TEST_SUMMARY.md` - Comprehensive overview
   - `/mnt/synology/Code/company/cdc/agentic/tests/load/QUICKSTART.md` - Quick start guide
   - Status: ✅ All created

### Test Configuration Verified

✅ **Workflow Counts:**
- Chatflows: 50 (5 types × 10 each)
  - RAG: 10
  - Conversational Memory: 10
  - Tool Agent: 10
  - Custom Tool: 10
  - Multi-chain: 10

- Agentflows: 50 (5 types × 10 each)
  - Agentic RAG: 10
  - Agent as Tool: 10
  - Multi-Agent: 10
  - Sequential Agent: 10
  - Supervisor Agent: 10

✅ **API Configuration:**
- API Key: `awc_test_phatoldsun_16bdbaf284042b28dc724bec24b4ff79`
- Test User: phatoldsun@gmail.com
- Target: Uses config.apiUrl (default: http://localhost:8000)
- Model: Uses config.defaultModel (default: gemini-2.0-flash-001)

✅ **Test Features:**
- Creates workflows via chat API using MCP tools
- Tracks creation time per workflow
- Calculates success/failure rates
- Records all workflow IDs created
- Saves detailed JSON results
- Real-time progress display
- Comprehensive error reporting

### Test Flow

```
1. Initialize test configuration
2. Create 50 chatflows sequentially
   ├─ RAG (10)
   ├─ Conversational Memory (10)
   ├─ Tool Agent (10)
   ├─ Custom Tool (10)
   └─ Multi-chain (10)
3. Create 50 agentflows sequentially
   ├─ Agentic RAG (10)
   ├─ Agent as Tool (10)
   ├─ Multi-Agent (10)
   ├─ Sequential Agent (10)
   └─ Supervisor Agent (10)
4. Calculate metrics
5. Save results to JSON
6. Display summary
```

### How to Run

```bash
# Navigate to test directory
cd /mnt/synology/Code/company/cdc/agentic/tests/load

# Run the test
node flowise-workflow-tests.test.js

# Expected duration: 5-10 minutes
```

### Expected Output

```
╔═══════════════════════════════════════════════════════════╗
║  Test Suite #7B - 100 Flowise Workflows                  ║
║  Creating 50 Chatflows + 50 Agentflows via MCP          ║
╚═══════════════════════════════════════════════════════════╝

INFO Test User: phatoldsun@gmail.com
INFO API Key: awc_test_phatoldsun_16bdbaf28...
INFO Target: http://localhost:8000

=== Creating 50 Chatflows ===

INFO Creating 10 Retrieval Augmented Generation chatflows...
INFO   [1/50] Creating: Retrieval Augmented Generation 1
PASS     Created in 1234ms - ID: abc-123-def
...

=== Creating 50 Agentflows ===
...

=== Test Summary ===

Total Workflows Created: 100
  Successful: 98 (98.00%)
  Failed: 2

Chatflows: 49/50 (98.00%)
Agentflows: 49/50 (98.00%)

Timing:
  Average: 1234ms
  Min: 567ms
  Max: 3456ms
  Total: 123.40s

INFO Results saved to: .../test-results/flowise-workflow-load-test.json
INFO Total test duration: 156.78s
```

### Results File

**Location:** `tests/test-results/flowise-workflow-load-test.json`

**Contents:**
- Test metadata (suite name, user, API key, timestamp)
- Comprehensive metrics (counts, rates, timing)
- All chatflow results (success/failure, IDs, durations)
- All agentflow results (success/failure, IDs, durations)
- Error details for any failures

### Success Criteria

- ✅ All 100 workflows created successfully (100% success rate) - IDEAL
- ✅ ≥95% success rate (up to 5 failures allowed) - ACCEPTABLE
- ❌ <95% success rate or test errors - FAIL

### Dependencies Required

1. **Services Running:**
   - OpenAgenticChat API (port 8000)
   - MCP Proxy (embedded in API)
   - oap-flowise-mcp (MCP server)
   - Flowise (port 3000)
   - PostgreSQL (Flowise database)

2. **Node.js Modules:**
   - fs/promises
   - path
   - ../config (test configuration)

### Pre-Run Checklist

- [ ] API server is running
- [ ] MCP proxy is running
- [ ] Flowise is accessible
- [ ] Database is connected
- [ ] API key is valid
- [ ] Test user has permissions
- [ ] Required MCP servers are running

### Post-Run Checklist

- [ ] Test completed successfully
- [ ] Results file generated
- [ ] Success rate ≥95%
- [ ] Workflows verified in Flowise
- [ ] Results reviewed for errors
- [ ] Test data cleaned up (if needed)

### Integration with Test Suite

The test can be run:
1. **Standalone:** `node flowise-workflow-tests.test.js`
2. **Via test runner:** `node ../run-all.js` (if integrated)
3. **CI/CD pipeline:** Add to automated testing

### Documentation

- **Full Documentation:** `/mnt/synology/Code/company/cdc/agentic/tests/load/README.md`
- **Quick Start:** `/mnt/synology/Code/company/cdc/agentic/tests/load/QUICKSTART.md`
- **Summary:** `/mnt/synology/Code/company/cdc/agentic/tests/load/TEST_SUMMARY.md`
- **MCP Server:** `/mnt/synology/Code/company/cdc/agentic/services/mcps/oap-flowise-mcp/README.md`

### References

- [Flowise AgentFlowV2 Documentation](https://docs.flowiseai.com/using-flowise/agentflowv2)
- [Flowise Tutorials](https://docs.flowiseai.com/tutorials)
- oap-flowise-mcp Implementation: `services/mcps/oap-flowise-mcp/`

---

## ✅ VERIFICATION COMPLETE

**Test Suite #7B is ready for execution.**

All files created, configuration verified, and documentation complete.

**Created:** 2025-12-05
**Status:** ✅ READY
**Next Step:** Run the test with `node flowise-workflow-tests.test.js`
