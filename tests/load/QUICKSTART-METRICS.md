# Quick Start Guide - Performance Metrics Test #7C

## Overview

Test #7C collects comprehensive performance metrics during load tests, measuring LLM, API, System, Redis, and Milvus performance.

## Quick Run

### Standalone Mode (Simulates Load)
```bash
cd /mnt/synology/Code/company/your-env/agentic/tests/load
node performance-metrics.test.js
```

### Concurrent with Load Tests (Recommended)
```bash
# Run all tests together
./run-load-test.sh
```

Or manually:
```bash
# Terminal 1: Metrics collection
node performance-metrics.test.js &

# Terminal 2: Chat load test
node concurrent-chat-sessions.test.js &

# Terminal 3: Flowise test
node flowise-workflow-tests.test.js &

# Wait for all
wait
```

## Configuration

```bash
# Custom duration (default: 30s)
TEST_DURATION=60000 node performance-metrics.test.js

# Custom sampling interval (default: 1000ms)
SAMPLING_INTERVAL=500 node performance-metrics.test.js

# Custom API endpoint
API_URL=http://production:8000 node performance-metrics.test.js
```

## Output Files

1. **Full Metrics**: `tests/test-results/performance-metrics-results.json`
   - All samples with timestamps
   - Raw metrics data
   - LLM, API, system, Redis, Milvus data

2. **Summary**: `tests/test-results/performance-metrics-summary.json`
   - Aggregated statistics
   - Percentiles (P50, P95, P99)
   - Averages and totals

## Real-Time Output

Watch metrics scroll by every second:
```
[12:34:56] [3.5s] RPS: 12.34 | Errors: 2.1% | P95: 2456ms | Mem: 45.2% | Requests: 43
[12:34:57] [4.5s] RPS: 13.21 | Errors: 1.8% | P95: 2398ms | Mem: 45.8% | Requests: 59
```

## Key Metrics

### LLM Metrics
- **TTFB**: Time to first byte (latency before streaming starts)
- **Token Latency**: Input/output token processing time
- **Response Time**: Total request duration
- **Model Usage**: Distribution across models

### API Metrics
- **RPS**: Requests per second
- **Error Rate**: % of failed requests
- **P50/P95/P99**: Response time percentiles
- **Endpoints**: Request distribution

### System Metrics
- **Memory**: Heap usage percentage
- **Uptime**: Process runtime
- **Status**: Health check status

### Redis Metrics
- **Hit Rate**: Cache effectiveness
- **Keys**: Total cached keys
- **Ops/Sec**: Redis throughput
- **Memory**: Redis memory usage

### Milvus Metrics
- **Collections**: Vector DB collections
- **Rows**: Total vectors stored
- **Index Types**: HNSW, IVF_FLAT, etc.

## Success Criteria

Test passes if:
- Error rate < 10%
- Avg response time < 10s
- P95 response time < 20s
- All samples collected

## Performance Baselines

### Excellent
- Error rate < 2%
- P95 < 2s
- TTFB < 200ms
- Memory < 50%
- Redis hit rate > 90%

### Good
- Error rate 2-5%
- P95 2-3s
- TTFB 200-300ms
- Memory 50-60%
- Redis hit rate 80-90%

### Acceptable
- Error rate 5-8%
- P95 3-5s
- TTFB 300-500ms
- Memory 60-75%
- Redis hit rate 60-80%

### Poor (Investigate!)
- Error rate > 8%
- P95 > 5s
- TTFB > 500ms
- Memory > 75%
- Redis hit rate < 60%

## Use as Library

```javascript
const { MetricsCollector } = require('./performance-metrics.test.js');

// Create and start
const collector = new MetricsCollector();
await collector.start();

// Your tests run here...

// Track custom requests
collector.trackRequest('/api/endpoint', 1234, true, 'model-name');

// Stop and save
collector.stop();
collector.saveResults();
```

## Common Issues

### High TTFB
- Check network latency
- Review API cold start time
- Check load balancer

### High Memory
- Look for memory leaks
- Review cache sizes
- Check heap growth

### Low Redis Hit Rate
- Review cache strategy
- Check TTL settings
- Verify cache warming

### High Error Rate
- Check API logs
- Review rate limits
- Verify auth tokens

## Next Steps

1. Run standalone test to verify setup
2. Run concurrent with Test #7A and #7B
3. Review metrics in JSON files
4. Compare against baselines
5. Investigate any anomalies

## Support

- Full docs: `tests/load/README.md`
- Test #7A: `concurrent-chat-sessions.test.js`
- Test #7B: `flowise-workflow-tests.test.js`
- Shell script: `run-load-test.sh`
