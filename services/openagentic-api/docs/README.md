# OpenAgentic Chat API Documentation

This directory contains comprehensive documentation for the OpenAgentic Chat API service.

## API Reference

The authoritative, always-current API reference is the generated OpenAPI spec
(`./openapi.json` in this directory) and the interactive Swagger UI served by the
running API. Browse the live spec rather than static prose — the endpoint list
below is a convenience summary.

## Quick Links

### Interactive API Documentation

🚀 **[Swagger UI](http://localhost:8080/api/swagger)** - Browse and test all API endpoints
📄 **[OpenAPI Spec (JSON)](http://localhost:8080/api/swagger/json)** - Download API specification
📝 **[OpenAPI Spec (YAML)](http://localhost:8080/api/swagger/yaml)** - YAML format

### API Endpoints

> **Note**: For complete, interactive endpoint documentation, see [Swagger UI](http://localhost:8080/api/swagger)

#### Chat API
- `POST /api/chat/stream` - Stream AI chat completions (SSE)
- `GET /api/chat/models` - List available AI models
- `GET /api/chat/sessions` - List user chat sessions
- `POST /api/chat/sessions` - Create new chat session

#### Health Checks
- `GET /api/health` - Basic health check
- `GET /api/health/comprehensive` - Full system health status

#### MCP (Model Context Protocol)
- `POST /api/mcp` - Execute MCP tool
- `GET /api/admin/mcp/servers` - List MCP servers
- `GET /api/admin/mcp/tools-list` - List all available tools

#### Admin Analytics
- `GET /api/admin/aif-metrics` - Get all Azure AI Foundry model metrics
- `GET /api/admin/aif-metrics/:deploymentName` - Get specific model metrics
- `POST /api/admin/aif-metrics/refresh` - Force refresh metrics
- `GET /api/admin/aif-metrics-summary` - Get metrics summary

#### MCP Logging
- `POST /api/mcp-logs` - Submit single MCP call log
- `POST /api/mcp-logs/batch` - Submit batch of MCP logs
- `GET /api/mcp-logs/stats` - Get MCP usage statistics

#### Provider Management
- `GET /api/admin/llm-providers/health` - Health status for all providers
- `GET /api/admin/llm-providers/metrics` - Performance metrics per provider
- `GET /api/admin/llm-providers` - List all configured providers

### Environment Variables

#### Azure AI Foundry Metrics
```bash
AZURE_SUBSCRIPTION_ID=your-subscription-id
AZURE_RESOURCE_GROUP=your-resource-group
AZURE_OPENAI_ACCOUNT_NAME=your-openai-account
AIF_METRICS_TIME_RANGE_MINUTES=10080  # 7 days
AIF_METRICS_REFRESH_INTERVAL_MINUTES=5
```

#### MCP Logging
```bash
API_BASE_URL=http://openagentic-api:3000  # In mcp-proxy service
```

#### LLM Providers
```bash
# Azure OpenAI
AZURE_OPENAI_ENABLED=true
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret

# AWS Bedrock
AWS_BEDROCK_ENABLED=false
AWS_REGION=us-east-1

# Google Vertex AI
VERTEX_AI_ENABLED=false
GCP_PROJECT_ID=your-project-id
```

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                    OpenAgentic Chat API                     │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐       ┌──────────────────┐           │
│  │  LLM Providers  │       │  Azure AI Foundry │           │
│  │  - Azure OpenAI │       │  Metrics Service  │           │
│  │  - AWS Bedrock  │       │  (Entra ID Auth)  │           │
│  │  - Vertex AI    │       └──────────────────┘           │
│  └─────────────────┘                                        │
│                                                             │
│  ┌─────────────────┐       ┌──────────────────┐           │
│  │  MCP Logging    │       │   Chat Pipeline   │           │
│  │  Endpoint       │       │   - Completion    │           │
│  │                 │       │   - Tool Exec     │           │
│  └─────────────────┘       └──────────────────┘           │
│                                                             │
└────────────────────────────────────────────────────────────┘
         │                            │
         ▼                            ▼
   ┌──────────┐              ┌────────────────┐
   │ MCP Proxy│              │ Azure Monitor  │
   │ Service  │              │ Query API      │
   └──────────┘              └────────────────┘
```

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

Required packages:
- `@azure/identity@^4.5.0` - Azure authentication
- `@azure/monitor-query@^1.3.3` - Azure metrics collection
- `fastify@^5.2.1` - Web framework
- `@prisma/client@^6.16.2` - Database ORM

### 2. Configure Environment

Copy `.env.template` to `.env` and configure:

```bash
cp .env.template .env
# Edit .env with your configuration
```

### 3. Set Up Azure Authentication

**Production**: Enable Managed Identity for your App Service

**Development**: Login with Azure CLI
```bash
az login
az account set --subscription your-subscription-id
```

### 4. Run Database Migrations

```bash
npm run db:migrate:deploy
```

### 5. Start the Service

```bash
npm run build
npm start
```

## Features

### OpenAPI/Swagger Documentation
- Automatic schema generation from route definitions
- Interactive testing via Swagger UI at `/api/swagger`
- Request/response validation with JSON Schema
- Static OpenAPI spec generation on server startup
- Support for API client generation (TypeScript, Python, Go, etc.)

### Multi-Provider LLM Support
- Automatic failover between Azure OpenAI, AWS Bedrock, and Google Vertex AI
- Priority-based or round-robin load balancing
- Real-time health monitoring
- Per-provider performance metrics

### Azure AI Foundry Integration
- Automatic metrics collection every 5 minutes
- 7-day historical view matching Azure Portal
- Per-model deployment breakdown
- Request, token, and latency metrics
- No API keys required (Entra ID authentication)

### MCP Tool Execution Logging
- Fire-and-forget asynchronous logging
- Comprehensive execution details
- Per-user and per-tool analytics
- Batch submission support
- Zero performance impact on tool execution

### Admin Analytics
- Real-time metrics dashboards
- Per-user cost tracking
- Model usage statistics
- Tool execution analytics

## Troubleshooting

### Azure AI Foundry Metrics Not Available

1. Check environment variables are set
2. Verify Managed Identity has Monitoring Reader role
3. Check service initialization logs
4. Use `/api/admin/aif-metrics/refresh` to force collection

### MCP Logs Not Appearing

1. Verify `API_BASE_URL` in mcp-proxy service
2. Check network connectivity between services
3. Review mcp-proxy logs for errors
4. Test endpoint: `curl http://api:3000/api/mcp-logs`

### LLM Provider Failover Not Working

1. Verify `LLM_ENABLE_FAILOVER=true`
2. Check backup providers are enabled and configured
3. Review provider health status
4. Increase `LLM_FAILOVER_TIMEOUT` if needed

## Contributing

When adding new features, please:

1. Update relevant documentation
2. Add environment variables to `.env.template`
3. Include API endpoint documentation
4. Add troubleshooting section if applicable

## Support

For issues and questions:
- Check the troubleshooting sections in each doc
- Review service logs for error details
- Contact the development team

## Version History

- **v1.0.0** (2025-11-13)
  - Added Azure AI Foundry metrics collection
  - Added MCP call logging
  - Multi-provider LLM support
  - Comprehensive admin analytics
