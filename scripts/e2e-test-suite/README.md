# E2E Deployment Validation Suite

Comprehensive platform health validation after every deployment.

## Usage

```bash
# Set your API key
export OpenAgentic_API_KEY="your-api-key"

# Create/update all test flows
python3 scripts/e2e-test-suite/create-flows.py --base-url https://chat-dev.openagentic.io

# Create a specific tier
python3 scripts/e2e-test-suite/create-flows.py --tier 0

# Run full suite via GhostPilot or API
# Flows appear in Flows > My Workflows > "E2E Tier 0: Infrastructure" etc.
```

## Tiers

- **Tier 0: Infrastructure** (30s) -- PG, Redis, Milvus, k8s, admin_full_system_test
- **Tier 1: Services** (60s) -- All MCPs, embeddings, models, admin endpoints
- **Tier 2: Integration** (3-5min) -- RAG round-trip, TTFT, agents, code mode
- **Tier 3: Full Validation** (5-10min) -- Multi-agent, Prometheus/Loki pipeline, Grafana
- **Master** -- Chains all tiers, produces HTML dashboard
