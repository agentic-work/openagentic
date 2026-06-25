# OpenAgentic Chat Database Schema

This directory contains the comprehensive Prisma schema for the OpenAgentic Chat application, designed to manage all data across the distributed microservices architecture.

## Overview

The database schema is built using Prisma ORM with PostgreSQL as the primary database. It provides a type-safe, well-structured approach to data management with proper relations, indexing, and migration support.

## Schema Structure

### Core Entities

#### **Users & Authentication**
- `User` - Core user information and profile data
- `UserAuthToken` - Local authentication token storage
- `UserSetting` - Individual user preferences and settings
- `UserPromptAssignment` - Custom prompt templates per user

#### **Chat Management**
- `ChatSession` - Chat conversation sessions
- `ChatMessage` - Individual messages with full metadata
- `ConversationBranch` - Conversation branching and threading

#### **MCP (Model Context Protocol)**
- `MCPInstance` - MCP server instances
- `MCPUsage` - Detailed MCP function call tracking
- `MCPServerStatus` - Global MCP server health and configuration

#### **System Management**
- `SystemConfiguration` - Global application configuration
- `ApiKey` - API key management and authentication
- `AdminAuditLog` - Administrative action auditing
- `UsageAnalytics` - System usage tracking and analytics

#### **Advanced Features**
- `MemoryContext` - Long-term memory and context storage
- `CacheEntry` - Application-level caching
- `FileAttachment` - File upload and media management
- `SystemMetrics` - Performance and monitoring metrics

## Key Features

### 1. **Type Safety**
All database operations are fully type-safe using Prisma's generated client, eliminating runtime database errors and providing excellent IDE support.

### 2. **Soft Deletes**
Critical entities like chat sessions and messages support soft deletion with `deletedAt` timestamps, allowing for data recovery and audit trails.

### 3. **Rich Metadata Support**
JSON columns store complex data structures like:
- Token usage and cost tracking
- Tool call parameters and results
- MCP function call data
- Visualization configurations
- Prometheus metrics

### 4. **Comprehensive Indexing**
Strategic database indexes optimize query performance for:
- User lookups and authentication
- Chat session retrieval
- Message threading and branching
- MCP usage analytics
- Time-based queries

### 5. **Audit Trail**
Complete administrative action logging with:
- User identification
- Action details and context
- IP address and user agent tracking
- JSON metadata storage

## Database Operations

### Setup and Migration

```bash
# Generate Prisma client
npm run db:generate

# Apply migrations (development)
npm run db:migrate

# Deploy migrations (production)
npm run db:migrate:deploy

# Push schema changes (development only)
npm run db:push

# Seed database with initial data
npm run db:seed

# Open Prisma Studio for GUI management
npm run db:studio

# Reset database (development only)
npm run db:reset
```

### Environment Variables

Required environment variables:

```env
DATABASE_URL="postgresql://username:password@hostname:port/database_name"
NODE_ENV="development|production"
```

### Usage Examples

#### Creating a User
```typescript
import { prisma } from '../database/prisma.js';

const user = await prisma.user.create({
  data: {
    email: 'user@example.com',
    name: 'John Doe',
    isAdmin: false,
    groups: ['users']
  }
});
```

#### Creating a Chat Session with Messages
```typescript
const session = await prisma.chatSession.create({
  data: {
    userId: user.id,
    title: 'New Conversation',
    messages: {
      create: [
        {
          role: 'USER',
          content: 'Hello, how can you help me?'
        },
        {
          role: 'ASSISTANT',
          content: 'I can help you with various tasks...',
          tokenUsage: {
            promptTokens: 10,
            completionTokens: 25,
            totalTokens: 35
          }
        }
      ]
    }
  },
  include: {
    messages: true
  }
});
```

#### Recording MCP Usage
```typescript
await prisma.mCPUsage.create({
  data: {
    user_id: user.id,
    instance_id: instance.id,
    tool_name: 'azure-resource-list',
    request_metadata: { resourceType: 'vm' },
    success: true,
    execution_time_ms: 1250
  }
});
```

#### Complex Queries with Relations
```typescript
const userWithActivity = await prisma.user.findUnique({
  where: { email: 'user@example.com' },
  include: {
    chatSessions: {
      where: { isActive: true },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    },
    mcpInstances: {
      where: { status: 'RUNNING' }
    },
    usageAnalytics: {
      where: {
        date: {
          gte: new Date('2025-01-01')
        }
      }
    }
  }
});
```

## Advanced Features

### 1. **Full-Text Search**
The schema supports full-text search on message content and other text fields:

```typescript
const messages = await prisma.chatMessage.findMany({
  where: {
    content: {
      search: 'azure deployment'
    }
  }
});
```

### 2. **Vector Embeddings**
Memory contexts support vector embeddings for semantic search:

```typescript
const similarContexts = await prisma.memoryContext.findMany({
  where: {
    userId: user.id,
    embedding: {
      // Vector similarity search (requires PostgreSQL extension)
    }
  }
});
```

### 3. **Time-Series Analytics**
Built-in support for time-series data analysis:

```typescript
const dailyUsage = await prisma.usageAnalytics.groupBy({
  by: ['date'],
  where: {
    date: {
      gte: new Date('2025-01-01')
    }
  },
  _sum: {
    requestCount: true,
    tokenCount: true,
    estimatedCost: true
  }
});
```

## Migration Strategy

### Development
1. Make schema changes in `schema.prisma`
2. Run `npm run db:migrate` to create and apply migration
3. Test changes thoroughly
4. Commit migration files to version control

### Production
1. Review all pending migrations
2. Run `npm run db:migrate:deploy` in production environment
3. Monitor for any migration issues
4. Verify data integrity post-migration

## Monitoring and Maintenance

### Performance Monitoring
- Use Prisma's built-in query logging (enabled in development)
- Monitor slow queries through database logs
- Regular EXPLAIN ANALYZE on complex queries
- Index usage analysis

### Data Retention
- Implement automated cleanup for old cache entries
- Archive old usage analytics data
- Soft-delete cleanup for performance
- Regular VACUUM operations on PostgreSQL

### Backup Strategy
- Regular database backups
- Point-in-time recovery setup
- Migration rollback procedures
- Data export capabilities

## Best Practices

1. **Always use transactions** for multi-table operations
2. **Include proper error handling** for all database operations
3. **Use select carefully** to avoid N+1 queries
4. **Leverage Prisma's type safety** - avoid raw queries when possible
5. **Monitor query performance** regularly
6. **Use soft deletes** for user-generated content
7. **Implement proper indexing** for query patterns
8. **Regular schema validation** against production data

## Troubleshooting

### Common Issues

1. **Migration Conflicts**
   ```bash
   # Reset migrations (development only)
   npm run db:reset
   ```

2. **Schema Drift**
   ```bash
   # Generate new client after schema changes
   npm run db:generate
   ```

3. **Connection Issues**
   - Verify DATABASE_URL format
   - Check PostgreSQL service status
   - Validate network connectivity

4. **Performance Issues**
   - Review query patterns and indexing
   - Use Prisma Studio to inspect data
   - Enable query logging for analysis

For additional help, consult the [Prisma documentation](https://www.prisma.io/docs/) or the OpenAgentic development team.