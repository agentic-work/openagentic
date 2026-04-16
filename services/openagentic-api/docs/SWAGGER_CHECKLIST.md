# Swagger Documentation Checklist

Use this checklist when adding or modifying API endpoints to ensure proper documentation.

## Adding a New Endpoint

- [ ] Define route schema with `schema` property
- [ ] Add appropriate `tags` array (e.g., `['Chat']`, `['Admin']`, `['MCP']`)
- [ ] Write clear `summary` (< 50 characters)
- [ ] Write detailed `description` explaining what the endpoint does
- [ ] Document all parameters:
  - [ ] `params` for URL parameters (`:id`, `:sessionId`, etc.)
  - [ ] `querystring` for query parameters (`?limit=10&offset=0`)
  - [ ] `headers` for custom headers
  - [ ] `body` for request body (POST/PUT/PATCH)
- [ ] Document all response codes:
  - [ ] `200` - Success response
  - [ ] `201` - Created (for POST endpoints)
  - [ ] `204` - No Content (for DELETE endpoints)
  - [ ] `400` - Bad Request (validation errors)
  - [ ] `401` - Unauthorized (authentication required)
  - [ ] `403` - Forbidden (insufficient permissions)
  - [ ] `404` - Not Found
  - [ ] `500` - Internal Server Error
- [ ] Add `security` array if authentication is required
- [ ] Use schema references (`$ref`) for common types
- [ ] Test in Swagger UI at `/api/swagger`

## Example Template

```typescript
fastify.METHOD('/path', {
  schema: {
    tags: ['Category'],
    summary: 'Brief description',
    description: 'Detailed explanation',
    // Parameters (choose what applies)
    params: { /* ... */ },
    querystring: { /* ... */ },
    headers: { /* ... */ },
    body: { /* ... */ },
    // Responses
    response: {
      200: { /* success schema */ },
      400: { $ref: '#/components/schemas/Error' },
      401: { $ref: '#/components/schemas/Error' }
    },
    // Security (if needed)
    security: [{ bearerAuth: [] }]
  }
}, handler);
```

## Modifying an Existing Endpoint

- [ ] Update schema if request/response format changed
- [ ] Update `description` if behavior changed
- [ ] Add `deprecated: true` if endpoint is being phased out
- [ ] Update examples if provided
- [ ] Test changes in Swagger UI

## Creating Shared Schemas

When creating reusable schemas in `swagger.config.ts`:

- [ ] Add to `components.schemas` object
- [ ] Use descriptive schema name (PascalCase)
- [ ] Document all properties with `description`
- [ ] Mark required fields in `required` array
- [ ] Use appropriate JSON Schema types
- [ ] Consider validation rules (min/max, pattern, format)
- [ ] Test schema with actual data

## Quality Checks

- [ ] All endpoints in your route file have schemas
- [ ] Schema matches actual request/response format
- [ ] All required fields are marked as `required`
- [ ] Enums include all possible values
- [ ] Response codes match what the handler actually returns
- [ ] Authentication requirements are documented
- [ ] No typos in property names or descriptions

## Testing

- [ ] Start server: `pnpm dev`
- [ ] Open Swagger UI: `http://localhost:8005/api/swagger`
- [ ] Find your endpoint in the list
- [ ] Click to expand and verify documentation
- [ ] Try "Try it out" button to test
- [ ] Verify request schema validation works
- [ ] Verify response matches schema
- [ ] Check console for validation errors

## After Implementation

- [ ] Generate static spec: `pnpm generate-swagger`
- [ ] Review `docs/openapi.json` for your changes
- [ ] Commit schema changes with code changes
- [ ] Update API documentation if needed
- [ ] Consider adding examples to schema

## Common Mistakes to Avoid

❌ Forgetting to add `schema` property entirely
❌ Not marking required fields
❌ Using wrong response status codes
❌ Inconsistent property names (camelCase vs snake_case)
❌ Missing authentication requirements
❌ Overly generic descriptions ("Get data", "Update thing")
❌ Not testing in Swagger UI before committing
❌ Breaking changes without version bump
❌ Forgetting to document error responses

## Tags by Category

Use these standard tags for consistency:

- **Health** - Health checks and monitoring
- **Auth** - Authentication and authorization
- **Chat** - Chat completions and conversations
- **MCP** - Model Context Protocol operations
- **RAG** - Retrieval Augmented Generation
- **Files** - File uploads and management
- **Users** - User management (Admin)
- **Admin** - Administrative operations
- **Settings** - User and system settings
- **Prompts** - Prompt templates
- **Azure** - Azure service integrations
- **Monitoring** - System monitoring and metrics

## Quick Reference

### Required Field
```typescript
{
  type: 'object',
  properties: {
    field: { type: 'string' }
  },
  required: ['field']
}
```

### Optional Field with Default
```typescript
{
  properties: {
    limit: { type: 'number', default: 10 }
  }
}
```

### Enum
```typescript
{
  type: 'string',
  enum: ['value1', 'value2']
}
```

### Array
```typescript
{
  type: 'array',
  items: { type: 'string' }
}
```

### Nested Object
```typescript
{
  type: 'object',
  properties: {
    nested: {
      type: 'object',
      properties: {
        field: { type: 'string' }
      }
    }
  }
}
```

### Reference Shared Schema
```typescript
{
  $ref: '#/components/schemas/SchemaName'
}
```

### Multiple Status Codes
```typescript
response: {
  200: { /* success */ },
  400: { $ref: '#/components/schemas/Error' },
  404: { $ref: '#/components/schemas/Error' }
}
```

## Resources

- Full Setup Guide: `docs/SWAGGER_SETUP.md`
- Schema Examples: `docs/API_SCHEMA_EXAMPLES.md`
- Implementation Summary: `docs/SWAGGER_IMPLEMENTATION_SUMMARY.md`
- Fastify Swagger: https://github.com/fastify/fastify-swagger
- OpenAPI 3.1 Spec: https://spec.openapis.org/oas/v3.1.0
- JSON Schema: https://json-schema.org/
