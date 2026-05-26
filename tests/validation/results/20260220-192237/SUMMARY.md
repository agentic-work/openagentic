# v0.5.0 Multi-Turn Validation Suite Results

**Date:** Fri Feb 20 07:50:33 PM EST 2026
**API:** https://chat-dev.openagentic.io
**Tests:** 10 (multi-turn interactive)

## Results

| Test | Status | Turns | Description |
|------|--------|-------|-------------|
| VAL-01 | FAIL | 2-3 |  Only  total tool calls across 3 turns |
| VAL-02 | PASS | 2-3 |  3-turn K8s lifecycle with 8 tool calls |
| VAL-03 | PASS | 2-3 |  2-turn research + gap analysis with 23 tool calls |
| VAL-04 | PARTIAL | 2-3 |  23 tool calls (expected 8+) |
| VAL-05 | PASS | 2-3 |  2-turn cost analysis with 17 tool calls |
| VAL-06 | PASS | 2-3 |  3-turn Flowise lifecycle with 12 tool calls |
| VAL-07 | PASS | 2-3 |  2-turn GitHub analysis with 23 tool calls |
| VAL-08 | PASS | 2-3 |  2-turn DB forensics with 30 tool calls |
| VAL-09 | PASS | 2-3 |  2-turn agent design with 8 tool calls |
| VAL-10 | PASS | 2-3 |  3-turn observability audit with 18 tool calls |

## Counts
- **PASS:** 8
- **PARTIAL:** 1
- **FAIL:** 1

## Multi-Turn Test Architecture
Each test follows this pattern:
1. **Turn 1**: Initial complex request with multiple tool calls
2. **Turn 2**: Follow-up based on actual response content (adaptive)
3. **Turn 3**: Verification/cleanup/synthesis request
4. **Log Check**: k8s logs scanned for errors during the test

## Test Descriptions
- **VAL-01**: Infrastructure health (3 turns: audit → deep-dive → scoring)
- **VAL-02**: K8s lifecycle (3 turns: create → inspect/modify → cleanup/verify)
- **VAL-03**: FedRAMP research (2 turns: search → gap analysis)
- **VAL-04**: Incident response (3 turns: create → investigate → resolve)
- **VAL-05**: Cloud cost analysis (2 turns: gather → analyze/optimize)
- **VAL-06**: Flowise workflow (3 turns: discover/create → validate → cleanup)
- **VAL-07**: GitHub CI/CD (2 turns: repos → CI/CD + issues)
- **VAL-08**: Database forensics (2 turns: enumerate → user activity)
- **VAL-09**: Agent architect (2 turns: discover → design 3 agents)
- **VAL-10**: Observability (3 turns: prometheus → loki → k8s + synthesis)
