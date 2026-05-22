# Load Testing Suite - Complete Index

## Quick Navigation

📋 **[QUICKSTART.md](QUICKSTART.md)** - Get started in 2 minutes
📖 **[README.md](README.md)** - Full documentation
🏗️ **[TEST-STRUCTURE.md](TEST-STRUCTURE.md)** - Detailed test architecture

## Test Files

### Main Test: #7A - 100 Concurrent Chat Sessions

**File:** `concurrent-chat-sessions.test.js` (697 lines)

**Quick Run:**
```bash
./run-load-test.sh --smoke    # Quick test
./run-load-test.sh            # Full test (default)
node concurrent-chat-sessions.test.js  # Direct execution
```

**What it does:**
- Runs 100 concurrent chat sessions
- 20 messages per session (2000 total)
- Tests all 10 MCP tools
- Tracks comprehensive metrics
- Generates JSON report

**Configuration:**
- API Key: `awc_test_openagentic-test_16bdbaf284042b28dc724bec24b4ff79`
- Test User: admin@openagentic.local
- API URL: http://localhost:8000
- Model: gemini-2.0-flash-001

## Test Coverage

### MCP Tools Tested (All 10)

✅ **admin-mcp** - System administration
✅ **awc-formatting-mcp** - Markdown, tables, charts
✅ **oap-admin-mcp** - Admin operations
✅ **oap-azure-cost-mcp** - Azure cost analysis
✅ **oap-azure-mcp** - Azure resources
✅ **oap-flowise-mcp** - Flowise workflows
✅ **oap-gcp-mcp** - GCP operations
✅ **oap-memory-mcp** - Memory storage
✅ **oap-prometheus-mcp** - Metrics
✅ **oap-web-mcp** - Web search

### Test Progression

```
Sessions 1-20:    Basic questions (no tools)
Sessions 21-40:   Azure operations
Sessions 41-60:   GCP operations
Sessions 61-80:   Flowise workflows
Sessions 81-100:  Complex multi-tool tasks
```

## Running Tests

### Option 1: Helper Script (Recommended)

```bash
# Smoke test (fast, 2-3 min)
./run-load-test.sh --smoke

# Quick test (medium, 5-10 min)
./run-load-test.sh --quick

# Full test (default, 15-30 min)
./run-load-test.sh

# Stress test (heavy, 45-60 min)
./run-load-test.sh --stress

# Custom
./run-load-test.sh --sessions 50 --messages 10
```

### Option 2: Direct Node Execution

```bash
# Default configuration
node concurrent-chat-sessions.test.js

# Custom via environment
API_URL=http://localhost:8000 \
API_KEY=your_key \
NUM_SESSIONS=50 \
node concurrent-chat-sessions.test.js
```

### Option 3: Via Test Runner

```bash
cd /mnt/synology/Code/company/your-env/agentic/tests
node run-all.js --category load
```

## Output & Results

### Console Output
Real-time progress with color-coded status:
- 🔵 Session progress
- 🟢 Success messages
- 🔴 Error messages
- 🟡 Warnings and info

### JSON Report
Location: `../test-results/concurrent-chat-sessions-results.json`

Contains:
- Session-by-session breakdown
- Message-level metrics
- Tool usage statistics
- Response time distributions
- Token usage
- Error details

### View Results

```bash
# Full results
cat ../test-results/concurrent-chat-sessions-results.json | jq

# Summary only
cat ../test-results/concurrent-chat-sessions-results.json | jq '.summary'

# Tool statistics
cat ../test-results/concurrent-chat-sessions-results.json | jq '.summary.toolCallStats'

# Failed messages
cat ../test-results/concurrent-chat-sessions-results.json | jq '.sessions[].messages[] | select(.success == false)'
```

## Metrics Tracked

### Response Metrics
- Response time (min, max, avg, p50, p90, p99)
- Time to first byte (TTFB)
- Success/failure rates
- Error rate percentage

### Token Metrics
- Input tokens per message
- Output tokens per message
- Total token consumption
- Cost estimation (if applicable)

### Tool Metrics
- Tools called per message
- Tool success/failure rates
- Tool usage distribution
- Tool performance

### Session Metrics
- Duration per session
- Messages per session
- Session success rate
- Concurrent execution stats

## Success Criteria

### Must Pass (Hard Requirements)
- ✅ Error rate < 10%
- ✅ All 100 sessions complete
- ✅ Results file generated
- ✅ No timeout errors

### Performance Goals (Soft Requirements)
- 🎯 P99 response time < 15s
- 🎯 Average TTFB < 1s
- 🎯 Tool success rate > 90%
- 🎯 No memory leaks

### Stretch Goals
- 🌟 Error rate < 5%
- 🌟 P99 < 10s
- 🌟 Tool success > 95%
- 🌟 Avg response < 3s

## Troubleshooting

### Quick Diagnostics

```bash
# Check API health
curl http://localhost:8000/health

# Check MCP tools
curl -H "X-API-Key: awc_test_openagentic-test_16bdbaf284042b28dc724bec24b4ff79" \
  http://localhost:8000/api/chat/mcp/status

# Test single session
NUM_SESSIONS=1 MESSAGES_PER_SESSION=3 node concurrent-chat-sessions.test.js
```

### Common Issues

| Issue | Symptom | Solution |
|-------|---------|----------|
| API down | Connection refused | Start API server |
| Auth error | 401/403 responses | Verify API key |
| Rate limit | 429 responses | Reduce concurrency |
| Timeout | Slow/hanging | Check network, increase timeout |
| Tool failure | Specific tool fails | Check MCP server health |

## File Structure

```
tests/load/
├── concurrent-chat-sessions.test.js  # Main test (697 lines)
├── run-load-test.sh                  # Helper script
├── INDEX.md                          # This file
├── QUICKSTART.md                     # Quick start guide
├── README.md                         # Full documentation
└── TEST-STRUCTURE.md                 # Architecture details
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | http://localhost:8000 | API endpoint |
| `API_KEY` | awc_test_openagentic-test_... | Auth key |
| `NUM_SESSIONS` | 100 | Number of sessions |
| `MESSAGES_PER_SESSION` | 20 | Messages per session |
| `DEFAULT_MODEL` | gemini-2.0-flash-001 | LLM model |

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: Load Tests
on:
  schedule:
    - cron: '0 2 * * *'  # Nightly at 2 AM

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - name: Run Load Test
        run: |
          cd tests/load
          ./run-load-test.sh --quick
        env:
          API_URL: ${{ secrets.API_URL }}
          API_KEY: ${{ secrets.API_KEY }}
      - name: Upload Results
        uses: actions/upload-artifact@v2
        with:
          name: load-test-results
          path: tests/test-results/
```

## Best Practices

### Before Running
1. ✅ Verify API is running
2. ✅ Check MCP servers are healthy
3. ✅ Confirm API key is valid
4. ✅ Run smoke test first
5. ✅ Monitor system resources

### During Test
1. 👁️ Watch console output
2. 📊 Monitor system metrics (CPU, memory)
3. 📝 Check API logs for errors
4. 🔍 Look for patterns in failures
5. ⏱️ Note performance degradation

### After Test
1. 📈 Review JSON results
2. 🔍 Analyze failed messages
3. 📊 Compare with baseline
4. 💾 Save results for history
5. 🐛 File bugs for issues found

## Performance Baselines

### Typical Results (Good Performance)

```
Total Test Duration: 156s
Total Sessions: 100
Total Messages: 2000
Successful Messages: 1987
Failed Messages: 13
Error Rate: 0.65%

Response Time Statistics:
  Average: 2156ms
  P50:     1987ms
  P90:     3421ms
  P99:     6789ms

Token Usage:
  Input:   453,210
  Output:  1,234,567
  Total:   1,687,777
```

### Warning Signs

```
❌ Error Rate: > 5%
❌ P99: > 15 seconds
❌ TTFB: > 1 second
❌ Tool failure rate: > 10%
❌ Memory leaks (increasing over time)
```

## Related Documentation

### Test Documentation
- `/tests/README.md` - Main test suite documentation
- `/tests/config.js` - Shared test configuration
- `/tests/run-all.js` - Test runner

### API Documentation
- `/services/openagenticchat-api/README.md` - API docs
- `/services/mcps/` - MCP server implementations

### MCP Tools
- `/services/mcps/oap-azure-mcp/` - Azure MCP
- `/services/mcps/oap-gcp-mcp/` - GCP MCP
- `/services/mcps/oap-flowise-mcp/` - Flowise MCP
- (See `/services/mcps/` for all tools)

## Support & Contact

### Getting Help
1. 📖 Read the documentation (start with QUICKSTART.md)
2. 🔍 Check troubleshooting sections
3. 📊 Review test results and logs
4. 🐛 File issues with details

### Useful Commands

```bash
# Show help
./run-load-test.sh --help

# Check syntax
node --check concurrent-chat-sessions.test.js

# View test code
less concurrent-chat-sessions.test.js

# Follow results in real-time
tail -f ../test-results/concurrent-chat-sessions-results.json
```

## Version History

- **v1.0** (2025-12-05) - Initial release
  - 100 concurrent sessions
  - 20 messages per session
  - All 10 MCP tools
  - Comprehensive metrics

## Next Steps

1. 🚀 **Quick Start:** Read [QUICKSTART.md](QUICKSTART.md)
2. 🧪 **Run Smoke Test:** `./run-load-test.sh --smoke`
3. 📊 **Review Results:** Check the JSON output
4. 📖 **Deep Dive:** Read [TEST-STRUCTURE.md](TEST-STRUCTURE.md)
5. 🔧 **Customize:** Adjust parameters for your needs

---

**Ready?** Run your first test now:

```bash
./run-load-test.sh --smoke
```

---

**Last Updated:** 2025-12-05
**Test Version:** 7A
**Status:** ✅ Production Ready
