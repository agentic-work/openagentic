# Azure AI Foundry Metrics

This service collects comprehensive per-model metrics from Azure AI Foundry (Azure OpenAI) using Entra ID authentication.

## Overview

The Azure AI Foundry Metrics Service provides:
- **7-day metrics view** matching Azure Portal
- **Per-model deployment metrics** with detailed breakdowns
- **Entra ID authentication** (no API keys required)
- **Automatic periodic collection** every 5 minutes
- **In-memory caching** for fast access
- **Admin API endpoints** for metrics access

## Configuration

### Required Environment Variables

```bash
# Azure subscription and resource information
AZURE_SUBSCRIPTION_ID=your-azure-subscription-id
AZURE_RESOURCE_GROUP=your-resource-group-name
AZURE_OPENAI_ACCOUNT_NAME=your-azure-openai-account-name
```

### Optional Environment Variables

```bash
# Metrics collection window (default: 10080 = 7 days)
AIF_METRICS_TIME_RANGE_MINUTES=10080

# How often to refresh metrics (default: 5 minutes)
AIF_METRICS_REFRESH_INTERVAL_MINUTES=5
```

## Authentication

The service uses **Entra ID (Azure AD) authentication** via `DefaultAzureCredential`:

- **In Production**: Uses Managed Identity assigned to the App Service
- **In Development**: Uses Azure CLI (`az login`) or VS Code Azure extension

**No API keys are stored or required.**

## Metrics Collected

### Request Metrics
- **Total Requests**: Total number of API requests
- **Successful Requests**: Completed successfully
- **Failed Requests**: Server errors (5xx) + Client errors (4xx)
- **Throttled Requests**: Rate-limited requests (429)

### Token Metrics
- **Total Tokens**: Input + Output tokens
- **Prompt Tokens**: Input tokens (ProcessedPromptTokens)
- **Completion Tokens**: Output tokens (GeneratedTokens)

### Latency Metrics
- **Average Latency**: Mean inference processing time
- **Time to First Byte (TTFB)**: Time until first token (EndToEndLatency)
- **Time to Last Byte (TTLB)**: Full response time (TimeToResponse)
- **P50/P95/P99 Latency**: Percentile metrics (future enhancement)

## API Endpoints

All endpoints require admin authentication.

### Get All Model Metrics

```http
GET /api/admin/aif-metrics
```

**Response:**
```json
{
  "metrics": [
    {
      "modelDeployment": "gpt-4o",
      "resourceName": "your-openai-account",
      "metrics": {
        "totalRequests": 1250,
        "successfulRequests": 1200,
        "failedRequests": 50,
        "throttledRequests": 15,
        "totalTokens": 450000,
        "promptTokens": 200000,
        "completionTokens": 250000,
        "averageLatencyMs": 1200,
        "timeToFirstByteMs": 150,
        "timeToLastByteMs": 1200,
        "p50LatencyMs": 0,
        "p95LatencyMs": 0,
        "p99LatencyMs": 0,
        "timeWindowStart": "2025-11-06T00:00:00Z",
        "timeWindowEnd": "2025-11-13T00:00:00Z"
      }
    }
  ],
  "summary": {
    "totalModels": 3,
    "totalRequests": 5000,
    "totalTokens": 1500000,
    "averageLatencyMs": 950,
    "lastRefresh": "2025-11-13T12:30:00Z"
  }
}
```

### Get Specific Model Metrics

```http
GET /api/admin/aif-metrics/:deploymentName
```

**Example:**
```http
GET /api/admin/aif-metrics/gpt-4o
```

### Force Refresh Metrics

```http
POST /api/admin/aif-metrics/refresh
```

Immediately collects fresh metrics from Azure (admin action).

### Get Metrics Summary

```http
GET /api/admin/aif-metrics-summary
```

**Response:**
```json
{
  "totalModels": 3,
  "totalRequests": 5000,
  "totalTokens": 1500000,
  "averageLatencyMs": 950,
  "lastRefresh": "2025-11-13T12:30:00Z"
}
```

## Service Architecture

### Initialization

The service is initialized in `src/server.ts` during startup:

```typescript
const aifMetricsService = initializeAIFoundryMetricsService({
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID,
  resourceGroupName: process.env.AZURE_RESOURCE_GROUP,
  accountName: process.env.AZURE_OPENAI_ACCOUNT_NAME,
  metricsTimeRangeMinutes: 10080, // 7 days
  refreshIntervalMinutes: 5
}, logger);

await aifMetricsService.startPeriodicCollection();
```

### Periodic Collection

- Metrics are collected **every 5 minutes** (configurable)
- Results are cached in memory for fast access
- Collection uses 1-hour granularity for 7-day time range
- Automatically aggregates metrics per model deployment

### Metric Mapping

Azure Monitor metrics are mapped to our interface:

| Azure Metric | Our Field |
|--------------|-----------|
| `Requests` | `totalRequests` |
| `SuccessfulCalls` | `successfulRequests` |
| `ServerErrors` + `ClientErrors` | `failedRequests` |
| `RateLimitEvents` | `throttledRequests` |
| `ProcessedPromptTokens` | `promptTokens` |
| `GeneratedTokens` | `completionTokens` |
| `TotalTokens` | `totalTokens` |
| `TimeToResponse` | `timeToLastByteMs` |
| `InferenceLatency` | `averageLatencyMs` |
| `EndToEndLatency` | `timeToFirstByteMs` |

## Azure Portal Comparison

This service provides **identical metrics** to what you see in the Azure Portal under:

```
Azure OpenAI Resource → Metrics → Model Deployments
```

- Same 7-day time range
- Same metric names and values
- Same per-deployment breakdown
- Same aggregation methods

## Setup Guide

### 1. Configure Azure Credentials

#### Production (Azure App Service)

Enable **Managed Identity** for your App Service:

```bash
az webapp identity assign \
  --name your-app-service \
  --resource-group your-resource-group
```

Grant **Monitoring Reader** role to the managed identity:

```bash
# Get the managed identity principal ID
PRINCIPAL_ID=$(az webapp identity show \
  --name your-app-service \
  --resource-group your-resource-group \
  --query principalId -o tsv)

# Grant Monitoring Reader role on the Azure OpenAI resource
az role assignment create \
  --assignee $PRINCIPAL_ID \
  --role "Monitoring Reader" \
  --scope /subscriptions/{subscription-id}/resourceGroups/{resource-group}/providers/Microsoft.CognitiveServices/accounts/{openai-account}
```

#### Development (Local)

Login with Azure CLI:

```bash
az login
az account set --subscription your-subscription-id
```

Ensure you have **Monitoring Reader** role on the Azure OpenAI resource.

### 2. Set Environment Variables

Add to your `.env` file:

```bash
AZURE_SUBSCRIPTION_ID=<your-subscription-id>
AZURE_RESOURCE_GROUP=<your-resource-group>
AZURE_OPENAI_ACCOUNT_NAME=<your-openai-account-name>
AIF_METRICS_TIME_RANGE_MINUTES=10080
AIF_METRICS_REFRESH_INTERVAL_MINUTES=5
```

### 3. Install Dependencies

```bash
npm install
```

Required packages:
- `@azure/identity@^4.5.0`
- `@azure/monitor-query@^1.3.3`

### 4. Restart Service

```bash
npm run build
npm start
```

You should see in the logs:

```
📊 Initializing Azure AI Foundry Metrics Service...
✅ Azure AI Foundry Metrics Service initialized and collecting metrics
```

## Troubleshooting

### Service Not Initialized

**Error**: `Azure AI Foundry metrics service not initialized`

**Solution**: Check that all required environment variables are set:
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_OPENAI_ACCOUNT_NAME`

### Authentication Failed

**Error**: `DefaultAzureCredential authentication failed`

**Solution**:
- **Production**: Ensure Managed Identity is enabled and has Monitoring Reader role
- **Development**: Run `az login` and verify you have access to the subscription

### No Metrics Returned

**Possible causes**:
1. No activity in the 7-day window
2. Deployment name mismatch
3. Insufficient permissions (need Monitoring Reader role)

**Solution**: Check Azure Portal metrics to verify data exists, then compare deployment names.

### High Latency on Metrics API

**Solution**: Metrics are cached in memory and refreshed every 5 minutes. If you need immediate updates, use the refresh endpoint:

```bash
POST /api/admin/aif-metrics/refresh
```

## Cost Considerations

Azure Monitor Query API calls are **free** for standard metrics. The service makes:

- **Initial query**: 1 API call on startup
- **Periodic queries**: 1 API call every 5 minutes (default)
- **Manual refresh**: 1 API call per refresh request

**Estimated monthly API calls**: ~8,640 (5-minute intervals for 30 days)

This is well within Azure's free tier limits.

## Future Enhancements

- [ ] Cost estimation per model deployment
- [ ] P50/P95/P99 latency percentiles (requires additional aggregation)
- [ ] Historical metrics storage in database
- [ ] Alerting on metric thresholds
- [ ] Metrics export to external monitoring systems
- [ ] Custom time ranges for metrics queries
- [ ] Comparative metrics across time periods
