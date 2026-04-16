# Swagger/OpenAPI Documentation Setup

This document describes the automatic OpenAPI/Swagger documentation generation system for the OpenAgenticChat API.

## Overview

The API uses `@fastify/swagger` and `@fastify/swagger-ui` to provide:
- **Interactive API documentation** via Swagger UI
- **Automatic OpenAPI 3.1.0 spec generation** from route schemas
- **Static OpenAPI spec file** generated on server startup

## Accessing Documentation

### Interactive Swagger UI

When the server is running, access the interactive documentation at:

```
http://localhost:8005/api/swagger
```

This provides:
- Browse all API endpoints
- View request/response schemas
- Test API calls directly from the browser
- Authentication support (Bearer token or API key)

### OpenAPI JSON Specification

The OpenAPI spec is available in multiple ways:

1. **Static file** (auto-generated on startup):
   ```
   /docs/openapi.json
   ```

2. **Dynamic endpoint**:
   ```
   GET http://localhost:8005/api/swagger/json
   ```

3. **YAML format**:
   ```
   GET http://localhost:8005/api/swagger/yaml
   ```

## How It Works

### 1. Configuration

The Swagger configuration is defined in:
```
/src/config/swagger.config.ts
```

This includes:
- API metadata (title, version, description)
- Security schemes (Bearer auth, API keys)
- Reusable schemas for common data types
- Tags for organizing endpoints

### 2. Route Schemas

Routes define their schemas inline using Fastify's schema syntax:

```typescript
fastify.post('/stream', {
  schema: {
    tags: ['Chat'],
    summary: 'Stream chat completion',
    description: 'Send a message and receive streaming AI response',
    body: { $ref: '#/components/schemas/StreamChatRequest' },
    response: {
      200: { /* response schema */ },
      401: { $ref: '#/components/schemas/Error' }
    },
    security: [{ bearerAuth: [] }]
  }
}, handler);
```

### 3. Automatic Generation

The OpenAPI spec is automatically generated:

1. **On server startup** - Written to `/docs/openapi.json`
2. **On-demand via script** - Run `pnpm generate-swagger`

## Documented Endpoints

### Chat API
- `POST /api/chat/stream` - Stream chat completions (SSE)
- `GET /api/chat/models` - List available AI models
- `GET /api/chat/sessions` - List chat sessions
- `GET /api/chat/tools` - List available MCP tools

### Health Checks
- `GET /api/health` - Basic health check
- `GET /api/health/detailed` - Detailed health with statistics
- `GET /api/health/comprehensive` - Full system health (all services)

### MCP (Model Context Protocol)
- `POST /api/mcp` - Execute MCP tool
- `GET /api/admin/mcp/servers` - List MCP servers
- `GET /api/admin/mcp/tools-list` - List all available tools

### Admin & Management
- API token management
- User management
- System configuration
- And more...

## Adding Documentation to New Routes

When creating a new route, add schema documentation:

```typescript
fastify.get('/my-endpoint', {
  schema: {
    tags: ['MyCategory'],
    summary: 'Short description',
    description: 'Detailed description of what this endpoint does',
    querystring: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Filter results' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { /* ... */ } },
          total: { type: 'number' }
        }
      },
      404: { $ref: '#/components/schemas/Error' }
    },
    security: [{ bearerAuth: [] }]
  }
}, async (request, reply) => {
  // Handler implementation
});
```

### Using Shared Schemas

Reference schemas defined in `swagger.config.ts`:

```typescript
body: { $ref: '#/components/schemas/StreamChatRequest' }
response: {
  200: { $ref: '#/components/schemas/ModelInfo' }
}
```

### Adding New Shared Schemas

Edit `/src/config/swagger.config.ts` and add to `components.schemas`:

```typescript
components: {
  schemas: {
    MyNewSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' }
      },
      required: ['id', 'name']
    }
  }
}
```

## Manual Generation

Generate the OpenAPI spec without starting the server:

```bash
pnpm generate-swagger
```

This creates:
- `/docs/openapi.json` - JSON format
- `/docs/openapi.yaml` - YAML format

## Best Practices

1. **Always add schemas** to new endpoints
2. **Use descriptive summaries** (< 50 chars)
3. **Provide detailed descriptions** for complex endpoints
4. **Reference shared schemas** for common types
5. **Tag endpoints** appropriately for organization
6. **Document all response codes** (200, 400, 401, 403, 404, 500)
7. **Include security requirements** when needed

## Schema Validation Benefits

Adding schemas provides:
- **Automatic validation** of request/response data
- **Better performance** (Fastify compiles schemas with Ajv)
- **Type safety** for API consumers
- **Self-documenting code**
- **API client generation** support (OpenAPI Generator, etc.)

## Integration with Tools

The OpenAPI spec can be used with:

- **Postman** - Import collection from OpenAPI spec
- **Insomnia** - Import workspace from OpenAPI spec
- **OpenAPI Generator** - Generate client SDKs
- **Swagger Codegen** - Generate server stubs
- **API testing tools** - Automated API testing

## Troubleshooting

### Swagger UI not loading
- Check server logs for errors during Swagger registration
- Verify `/api/swagger` route is accessible
- Check browser console for JavaScript errors

### Missing endpoints in documentation
- Ensure route has `schema` property defined
- Check that route is registered before server starts
- Verify schema syntax is valid JSON Schema

### Schema validation errors
- Check request/response matches defined schema
- Use `/api/swagger/json` to inspect generated spec
- Enable debug logging: `LOG_LEVEL=debug`

## Files Modified

This documentation system includes:

1. `/src/config/swagger.config.ts` - Swagger configuration with schemas
2. `/src/server.ts` - Swagger registration and auto-generation
3. `/scripts/generate-swagger.ts` - Manual generation script
4. `/src/routes/**/*.ts` - Route schema definitions
5. `/docs/openapi.json` - Generated OpenAPI spec (auto-updated)

## Additional Resources

- [Fastify Swagger Documentation](https://github.com/fastify/fastify-swagger)
- [OpenAPI 3.1 Specification](https://spec.openapis.org/oas/v3.1.0)
- [JSON Schema Documentation](https://json-schema.org/)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)
