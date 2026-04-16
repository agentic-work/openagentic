# API Schema Examples

Quick reference for adding Swagger/OpenAPI schemas to routes.

## Basic Route with Schema

```typescript
fastify.get('/my-endpoint', {
  schema: {
    tags: ['Category'],
    summary: 'Brief description',
    description: 'Detailed explanation of what this does',
    response: {
      200: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'string' }
        }
      }
    }
  }
}, async (request, reply) => {
  return { success: true, data: 'Hello' };
});
```

## Route with Query Parameters

```typescript
fastify.get('/search', {
  schema: {
    tags: ['Search'],
    summary: 'Search items',
    querystring: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query' },
        limit: { type: 'number', default: 10, minimum: 1, maximum: 100 },
        offset: { type: 'number', default: 0, minimum: 0 }
      },
      required: ['q']
    },
    response: {
      200: {
        type: 'object',
        properties: {
          results: { type: 'array', items: { type: 'object' } },
          total: { type: 'number' }
        }
      }
    }
  }
}, handler);
```

## Route with URL Parameters

```typescript
fastify.get('/users/:userId', {
  schema: {
    tags: ['Users'],
    summary: 'Get user by ID',
    params: {
      type: 'object',
      properties: {
        userId: { type: 'string', format: 'uuid' }
      },
      required: ['userId']
    },
    response: {
      200: { $ref: '#/components/schemas/User' },
      404: { $ref: '#/components/schemas/Error' }
    }
  }
}, handler);
```

## POST Route with Request Body

```typescript
fastify.post('/users', {
  schema: {
    tags: ['Users'],
    summary: 'Create user',
    body: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        name: { type: 'string', minLength: 1, maxLength: 100 },
        role: { type: 'string', enum: ['user', 'admin'] }
      },
      required: ['email', 'name']
    },
    response: {
      201: { $ref: '#/components/schemas/User' },
      400: { $ref: '#/components/schemas/Error' }
    }
  }
}, handler);
```

## Authenticated Route

```typescript
fastify.get('/protected', {
  preHandler: authMiddleware,
  schema: {
    tags: ['Protected'],
    summary: 'Protected endpoint',
    description: 'Requires authentication',
    response: {
      200: { type: 'object', properties: { data: { type: 'string' } } },
      401: { $ref: '#/components/schemas/Error' }
    },
    security: [
      { bearerAuth: [] },
      { apiKey: [] }
    ]
  }
}, handler);
```

## Streaming Endpoint (SSE)

```typescript
fastify.post('/stream', {
  schema: {
    tags: ['Streaming'],
    summary: 'Server-Sent Events stream',
    body: {
      type: 'object',
      properties: {
        message: { type: 'string' }
      },
      required: ['message']
    },
    response: {
      200: {
        description: 'SSE stream',
        content: {
          'text/event-stream': {
            schema: {
              type: 'string',
              description: 'Event stream with data: and event: lines'
            }
          }
        }
      }
    }
  }
}, handler);
```

## Using Shared Schema References

```typescript
// Reference a schema from swagger.config.ts
fastify.get('/model', {
  schema: {
    tags: ['AI'],
    summary: 'Get model info',
    response: {
      200: { $ref: '#/components/schemas/ModelInfo' },
      404: { $ref: '#/components/schemas/Error' }
    }
  }
}, handler);
```

## Array Response

```typescript
fastify.get('/items', {
  schema: {
    tags: ['Items'],
    summary: 'List all items',
    response: {
      200: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' }
              }
            }
          },
          total: { type: 'number' }
        }
      }
    }
  }
}, handler);
```

## File Upload

```typescript
fastify.post('/upload', {
  schema: {
    tags: ['Files'],
    summary: 'Upload file',
    consumes: ['multipart/form-data'],
    body: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        description: { type: 'string' }
      },
      required: ['file']
    },
    response: {
      200: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          url: { type: 'string', format: 'uri' }
        }
      }
    }
  }
}, handler);
```

## Headers

```typescript
fastify.get('/versioned', {
  schema: {
    tags: ['Versioning'],
    summary: 'API with custom headers',
    headers: {
      type: 'object',
      properties: {
        'x-api-version': { type: 'string', enum: ['v1', 'v2'] }
      },
      required: ['x-api-version']
    },
    response: {
      200: { type: 'object' }
    }
  }
}, handler);
```

## Multiple Response Types

```typescript
fastify.get('/status', {
  schema: {
    tags: ['System'],
    summary: 'Check status',
    response: {
      200: {
        type: 'object',
        properties: { status: { type: 'string', const: 'ok' } }
      },
      503: {
        type: 'object',
        properties: {
          status: { type: 'string', const: 'error' },
          message: { type: 'string' }
        }
      }
    }
  }
}, async (request, reply) => {
  const isHealthy = await checkHealth();
  if (isHealthy) {
    return reply.code(200).send({ status: 'ok' });
  }
  return reply.code(503).send({ status: 'error', message: 'Service unavailable' });
});
```

## Conditional Fields

```typescript
fastify.post('/conditional', {
  schema: {
    tags: ['Advanced'],
    summary: 'Conditional schema',
    body: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['email', 'sms'] },
        email: { type: 'string', format: 'email' },
        phone: { type: 'string' }
      },
      required: ['type'],
      // Use oneOf/anyOf/allOf for complex validation
      oneOf: [
        {
          properties: { type: { const: 'email' } },
          required: ['email']
        },
        {
          properties: { type: { const: 'sms' } },
          required: ['phone']
        }
      ]
    }
  }
}, handler);
```

## Nested Objects

```typescript
fastify.post('/complex', {
  schema: {
    tags: ['Complex'],
    summary: 'Complex nested object',
    body: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            address: {
              type: 'object',
              properties: {
                street: { type: 'string' },
                city: { type: 'string' },
                zip: { type: 'string', pattern: '^[0-9]{5}$' }
              }
            }
          }
        },
        preferences: {
          type: 'object',
          additionalProperties: { type: 'string' }
        }
      }
    }
  }
}, handler);
```

## Common JSON Schema Validations

```typescript
// String validations
{
  type: 'string',
  minLength: 1,
  maxLength: 255,
  pattern: '^[a-zA-Z0-9]+$',  // Regex
  format: 'email' | 'uri' | 'date' | 'date-time' | 'uuid'
}

// Number validations
{
  type: 'number' | 'integer',
  minimum: 0,
  maximum: 100,
  exclusiveMinimum: 0,
  multipleOf: 5
}

// Array validations
{
  type: 'array',
  items: { type: 'string' },
  minItems: 1,
  maxItems: 10,
  uniqueItems: true
}

// Enum
{
  type: 'string',
  enum: ['option1', 'option2', 'option3']
}

// Nullable
{
  type: ['string', 'null']
}

// Any type
{
  type: 'object',
  additionalProperties: true
}
```

## Adding to swagger.config.ts

To add a reusable schema:

```typescript
// In /src/config/swagger.config.ts
components: {
  schemas: {
    MyNewSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' }
      },
      required: ['id', 'name']
    }
  }
}
```

Then reference it:

```typescript
response: {
  200: { $ref: '#/components/schemas/MyNewSchema' }
}
```
