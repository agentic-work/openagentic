# LLM Provider Configuration

This document describes the environment variables used to configure multiple LLM providers.

## Global Settings

```bash
# Default provider to use (if not specified, uses highest priority)
DEFAULT_LLM_PROVIDER=azure-openai

# Enable automatic failover to alternate providers
LLM_ENABLE_FAILOVER=true

# Timeout before failing over to next provider (milliseconds)
LLM_FAILOVER_TIMEOUT=30000

# Enable load balancing across providers
LLM_ENABLE_LOAD_BALANCING=false

# Load balancing strategy: priority | round-robin | least-latency
LLM_LOAD_BALANCING_STRATEGY=priority
```

## Azure OpenAI Provider

```bash
# Enable/disable Azure OpenAI (default: enabled if configured)
AZURE_OPENAI_ENABLED=true

# Priority (lower number = higher priority, default: 1)
AZURE_OPENAI_PRIORITY=1

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
AZURE_OPENAI_API_VERSION=2025-01-01-preview

# Azure AD Authentication
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
```

## AWS Bedrock Provider

```bash
# Enable/disable AWS Bedrock (default: disabled until implemented)
AWS_BEDROCK_ENABLED=false

# Priority (default: 2)
AWS_BEDROCK_PRIORITY=2

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Model ID (default: Claude 3.5 Sonnet v2)
AWS_BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
```

## Google Vertex AI Provider

```bash
# Enable/disable Vertex AI (default: disabled until implemented)
VERTEX_AI_ENABLED=false

# Priority (default: 3)
VERTEX_AI_PRIORITY=3

# GCP Configuration
GCP_PROJECT_ID=your-project-id
GCP_LOCATION=us-central1

# Service account JSON (base64 encoded or inline)
GCP_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

# Model ID (default: Gemini 2.0 Flash)
VERTEX_AI_MODEL_ID=gemini-2.0-flash-exp
```

## Priority System

Providers are selected based on their priority value:
- **Priority 1** (highest): Azure OpenAI (default)
- **Priority 2**: AWS Bedrock
- **Priority 3**: Google Vertex AI

Lower priority numbers are tried first. If failover is enabled, the system will automatically try the next provider if one fails.

## Load Balancing Strategies

### Priority (Default)
Always uses the highest priority provider first.

```bash
LLM_LOAD_BALANCING_STRATEGY=priority
```

### Round-Robin
Distributes requests evenly across all enabled providers.

```bash
LLM_ENABLE_LOAD_BALANCING=true
LLM_LOAD_BALANCING_STRATEGY=round-robin
```

### Least-Latency
Routes requests to the provider with the lowest average response time.

```bash
LLM_ENABLE_LOAD_BALANCING=true
LLM_LOAD_BALANCING_STRATEGY=least-latency
```

## Failover Behavior

When `LLM_ENABLE_FAILOVER=true`:

1. Request is sent to the selected provider
2. If the provider fails or times out (after `LLM_FAILOVER_TIMEOUT`):
   - System tries the next available provider in priority order
   - Process continues until a provider succeeds or all fail
3. Original error is logged for debugging

Example failover chain:
```
Azure OpenAI (Priority 1) -> AWS Bedrock (Priority 2) -> Vertex AI (Priority 3)
```

## Example Configurations

### Single Provider (Azure Only)
```bash
DEFAULT_LLM_PROVIDER=azure-openai
AZURE_OPENAI_ENABLED=true
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-4
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...
```

### Multi-Provider with Failover
```bash
# Global settings
LLM_ENABLE_FAILOVER=true
LLM_FAILOVER_TIMEOUT=30000

# Azure as primary
AZURE_OPENAI_ENABLED=true
AZURE_OPENAI_PRIORITY=1
AZURE_OPENAI_ENDPOINT=...

# Bedrock as backup
AWS_BEDROCK_ENABLED=true
AWS_BEDROCK_PRIORITY=2
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

### Load-Balanced Multi-Provider
```bash
# Enable load balancing
LLM_ENABLE_LOAD_BALANCING=true
LLM_LOAD_BALANCING_STRATEGY=round-robin

# Configure all providers with equal priority
AZURE_OPENAI_ENABLED=true
AZURE_OPENAI_PRIORITY=1

AWS_BEDROCK_ENABLED=true
AWS_BEDROCK_PRIORITY=1

VERTEX_AI_ENABLED=true
VERTEX_AI_PRIORITY=1
```

## Monitoring

Provider health and metrics are available at:
- `GET /api/admin/llm-providers/health` - Health status for all providers
- `GET /api/admin/llm-providers/metrics` - Performance metrics per provider
- `GET /api/admin/llm-providers` - List all configured providers

## Troubleshooting

### Provider not being used
1. Check if provider is enabled: `<PROVIDER>_ENABLED=true`
2. Verify all required environment variables are set
3. Check priority - lower numbers have higher priority
4. Review logs for initialization errors

### Failover not working
1. Verify `LLM_ENABLE_FAILOVER=true`
2. Check that backup providers are enabled and configured
3. Increase `LLM_FAILOVER_TIMEOUT` if requests are timing out too quickly

### High latency with load balancing
1. Use `least-latency` strategy instead of `round-robin`
2. Disable slower providers
3. Adjust provider priorities to prefer faster providers
