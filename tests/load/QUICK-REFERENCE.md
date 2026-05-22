# Quick Reference Card - Test Suite #7A

## 🚀 Run Test (One Command)

```bash
cd /mnt/synology/Code/company/cdc/agentic/tests/load && ./run-load-test.sh --smoke
```

---

## 📋 Common Commands

| Command | Duration | Purpose |
|---------|----------|---------|
| `./run-load-test.sh --smoke` | 2-3 min | Quick validation |
| `./run-load-test.sh --quick` | 5-10 min | Pre-commit test |
| `./run-load-test.sh` | 15-30 min | Full load test |
| `./run-load-test.sh --stress` | 45-60 min | Stress testing |
| `./run-load-test.sh --help` | - | Show all options |

---

## 📁 Key Files

| File | Purpose |
|------|---------|
| `concurrent-chat-sessions.test.js` | Main test (697 lines) |
| `run-load-test.sh` | Helper script |
| `QUICKSTART.md` | Quick start guide |
| `README.md` | Full documentation |
| `INDEX.md` | Complete navigation |

---

## ⚙️ Configuration

```bash
# Environment Variables
export API_URL=http://localhost:8000
export API_KEY=awc_test_phatoldsun_16bdbaf284042b28dc724bec24b4ff79
export NUM_SESSIONS=100
export MESSAGES_PER_SESSION=20
export DEFAULT_MODEL=gemini-2.0-flash-001
```

---

## 🔍 View Results

```bash
# Full results
cat ../test-results/concurrent-chat-sessions-results.json | jq

# Summary only
cat ../test-results/concurrent-chat-sessions-results.json | jq '.summary'

# Tool stats
cat ../test-results/concurrent-chat-sessions-results.json | jq '.summary.toolCallStats'
```

---

## 🎯 Test Coverage

**100 Sessions × 20 Messages = 2000 Total Messages**

| Sessions | Focus | MCP Tool |
|----------|-------|----------|
| 1-20 | Basic | None |
| 21-40 | Azure | oap-azure-mcp |
| 41-60 | GCP | oap-gcp-mcp |
| 61-80 | Flowise | oap-flowise-mcp |
| 81-100 | Complex | Multi-tool |

---

## ✅ Success Criteria

- Error rate < 10%
- All sessions complete
- Results file generated
- P99 < 15 seconds

---

## 🐛 Troubleshooting

```bash
# Check API
curl http://localhost:8000/health

# Check MCP status
curl -H "X-API-Key: awc_test_phatoldsun_16bdbaf284042b28dc724bec24b4ff79" \
  http://localhost:8000/api/chat/mcp/status

# Test single session
NUM_SESSIONS=1 MESSAGES_PER_SESSION=3 node concurrent-chat-sessions.test.js
```

---

## 📊 Metrics Tracked

- Response time (min, max, avg, P50, P90, P99)
- Time to first byte (TTFB)
- Token usage (input/output)
- Tool calls per message
- Success/failure rates
- Error details

---

## 🎓 First Time Setup

```bash
# 1. Navigate to directory
cd /mnt/synology/Code/company/cdc/agentic/tests/load

# 2. Verify API is running
curl http://localhost:8000/health

# 3. Run smoke test
./run-load-test.sh --smoke

# 4. View results
cat ../test-results/concurrent-chat-sessions-results.json | jq '.summary'
```

---

## 📖 Documentation

- **Quick Start:** [QUICKSTART.md](QUICKSTART.md)
- **Full Guide:** [README.md](README.md)
- **Architecture:** [TEST-STRUCTURE.md](TEST-STRUCTURE.md)
- **Complete Index:** [INDEX.md](INDEX.md)
- **Implementation:** [IMPLEMENTATION-SUMMARY.md](IMPLEMENTATION-SUMMARY.md)

---

## 💡 Pro Tips

1. Always run `--smoke` first to verify setup
2. Monitor system resources during test
3. Check API logs for detailed errors
4. Compare results with baseline metrics
5. Save successful runs for regression testing

---

**Need Help?** Start with [QUICKSTART.md](QUICKSTART.md) or run `./run-load-test.sh --help`
