# Quick Start Guide - Load Test #7A

## TL;DR

```bash
# Run full test (100 sessions, 20 messages each = 2000 total messages)
node concurrent-chat-sessions.test.js

# Or use the helper script
./run-load-test.sh
```

## Quick Test Options

### Smoke Test (Fast)
```bash
# 10 sessions × 5 messages = 50 total messages (~2-3 minutes)
./run-load-test.sh --smoke
```

### Quick Test (Medium)
```bash
# 20 sessions × 10 messages = 200 total messages (~5-10 minutes)
./run-load-test.sh --quick
```

### Full Test (Default)
```bash
# 100 sessions × 20 messages = 2000 total messages (~15-30 minutes)
./run-load-test.sh
```

### Stress Test (Heavy)
```bash
# 200 sessions × 30 messages = 6000 total messages (~45-60 minutes)
./run-load-test.sh --stress
```

## Custom Configuration

```bash
# Custom number of sessions and messages
./run-load-test.sh --sessions 50 --messages 15

# Use different model
./run-load-test.sh --model gpt-4

# Custom API endpoint
./run-load-test.sh --api-url http://staging.example.com:8000

# Combine options
./run-load-test.sh --sessions 30 --messages 10 --model claude-3-opus
```

## Environment Variables

```bash
# Set via environment variables
API_URL=http://localhost:8000 \
API_KEY=your_key_here \
NUM_SESSIONS=50 \
MESSAGES_PER_SESSION=10 \
node concurrent-chat-sessions.test.js
```

## What Gets Tested

### Sessions 1-20: Basic Questions
- No MCP tools
- General knowledge
- Baseline performance

### Sessions 21-40: Azure Operations
- List subscriptions, VMs, storage
- Check costs and deployments
- Multi-step follow-ups

### Sessions 41-60: GCP Operations
- List projects, instances, buckets
- Query Cloud SQL, Functions, GKE
- Multi-step follow-ups

### Sessions 61-80: Flowise Workflows
- Create chatflows and agents
- Build RAG workflows
- Design custom integrations

### Sessions 81-100: Complex Multi-Tool
- Combine 2-4 MCP tools
- Cross-cloud analysis
- Automated workflows

## Output

### Console
Real-time progress and summary statistics

### JSON File
Detailed metrics saved to:
```
../test-results/concurrent-chat-sessions-results.json
```

### View Results
```bash
# Pretty print with jq
cat ../test-results/concurrent-chat-sessions-results.json | jq

# View summary only
cat ../test-results/concurrent-chat-sessions-results.json | jq '.summary'

# View tool stats
cat ../test-results/concurrent-chat-sessions-results.json | jq '.summary.toolCallStats'
```

## Success Criteria

✅ **Test Passes If:**
- Error rate < 10%
- All sessions complete
- Results file generated

❌ **Test Fails If:**
- Error rate ≥ 10%
- Any sessions timeout
- Critical errors occur

## Troubleshooting

### API Not Reachable
```bash
# Check if API is running
curl http://localhost:8000/health

# Check Docker containers
docker ps | grep agentic
```

### High Error Rate
1. Check API server logs
2. Verify MCP servers are running
3. Check rate limiting settings
4. Review authentication tokens

### Slow Performance
1. Check system resources (CPU, memory)
2. Review concurrent connection limits
3. Check database connection pool
4. Monitor network latency

## Common Issues

### "Connection refused"
- API server is not running
- Wrong API URL
- Firewall blocking connection

### "Unauthorized" errors
- Invalid API key
- Expired tokens
- Missing authentication

### "Rate limit exceeded"
- Too many concurrent requests
- Need to adjust rate limits
- Use fewer sessions for testing

## Tips

1. **Start Small:** Use `--smoke` first to verify setup
2. **Monitor Resources:** Watch CPU/memory during test
3. **Review Logs:** Check server logs for errors
4. **Save Baseline:** Keep first successful run as reference
5. **Test Off-Peak:** Run during low traffic periods

## Example Workflow

```bash
# 1. Verify API is up
curl http://localhost:8000/health

# 2. Run smoke test
./run-load-test.sh --smoke

# 3. If successful, run quick test
./run-load-test.sh --quick

# 4. If successful, run full test
./run-load-test.sh

# 5. Review results
cat ../test-results/concurrent-chat-sessions-results.json | jq '.summary'
```

## Getting Help

```bash
# Show all options
./run-load-test.sh --help

# View detailed documentation
cat README.md
```

---

**Ready to test?** Run `./run-load-test.sh --smoke` to get started!
