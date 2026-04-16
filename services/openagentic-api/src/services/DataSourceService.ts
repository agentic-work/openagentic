import type { Logger } from 'pino';
import { Client as PgClient } from 'pg';
import { prisma } from '../utils/prisma.js';
import { workflowSecretService } from '../services/WorkflowSecretService.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DataSourceConfig {
  host?: string;
  port?: number;
  database?: string;
  ssl?: boolean;
  baseUrl?: string;
  headers?: Record<string, string>;
  authType?: 'none' | 'bearer' | 'basic' | 'api_key';
  endpoint?: string;
  bucket?: string;
  region?: string;
  connectionString?: string;
}

export interface SchemaTable {
  name: string;
  schema?: string;
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    primaryKey?: boolean;
  }>;
  rowCount?: number;
}

export interface ProbeResult {
  success: boolean;
  tables?: SchemaTable[];
  error?: string;
  probedAt: Date;
}

export interface QueryResult {
  success: boolean;
  rows?: any[];
  columns?: string[];
  rowCount?: number;
  error?: string;
  executionTimeMs?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DataSourceService {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'DataSourceService' });
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  async list(userId: string): Promise<any[]> {
    this.logger.debug({ userId }, 'Listing data sources');
    return prisma.dataSource.findMany({
      where: {
        OR: [
          { created_by: userId },
          { is_shared: true },
        ],
      },
      orderBy: { updated_at: 'desc' },
    });
  }

  async getById(id: string, userId: string): Promise<any | null> {
    this.logger.debug({ id, userId }, 'Getting data source by id');
    return prisma.dataSource.findFirst({
      where: {
        id,
        OR: [
          { created_by: userId },
          { is_shared: true },
        ],
      },
    });
  }

  async create(
    userId: string,
    input: {
      name: string;
      description?: string;
      type: string;
      connection_config: DataSourceConfig;
      secret_id?: string;
      is_shared?: boolean;
      tags?: string[];
    },
  ): Promise<any> {
    this.logger.info({ userId, name: input.name, type: input.type }, 'Creating data source');
    return prisma.dataSource.create({
      data: {
        name: input.name,
        description: input.description,
        type: input.type,
        connection_config: input.connection_config as any,
        secret_id: input.secret_id,
        is_shared: input.is_shared ?? false,
        tags: input.tags ?? [],
        created_by: userId,
      },
    });
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<{
      name: string;
      description: string;
      type: string;
      connection_config: DataSourceConfig;
      secret_id: string | null;
      is_shared: boolean;
      tags: string[];
    }>,
  ): Promise<any> {
    this.logger.info({ id, userId }, 'Updating data source');

    // If connection_config changes, invalidate cached schema
    const data: any = { ...updates };
    if (updates.connection_config !== undefined) {
      data.schema_cache = null;
      data.schema_probed_at = null;
      data.status = 'untested';
      data.status_message = null;
      data.connection_config = updates.connection_config as any;
    }

    return prisma.dataSource.updateMany({
      where: { id, created_by: userId },
      data,
    }).then(async () => {
      return prisma.dataSource.findUnique({ where: { id } });
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    this.logger.info({ id, userId }, 'Deleting data source');
    await prisma.dataSource.deleteMany({
      where: { id, created_by: userId },
    });
  }

  // -------------------------------------------------------------------------
  // Schema Probing
  // -------------------------------------------------------------------------

  async probeSchema(id: string, userId: string): Promise<ProbeResult> {
    const ds = await this.getById(id, userId);
    if (!ds) {
      return { success: false, error: 'Data source not found', probedAt: new Date() };
    }

    this.logger.info({ id, type: ds.type }, 'Probing schema');

    // Resolve credential if secret_id is set
    let credential: string | null = null;
    if (ds.secret_id) {
      credential = await workflowSecretService.resolveSecretValue(ds.secret_id, {});
    }

    const config = ds.connection_config as DataSourceConfig;
    let result: ProbeResult;

    try {
      switch (ds.type) {
        case 'postgres':
          result = await this.probeSQLSchema(ds.type, config, credential ?? undefined);
          break;
        case 'rest_api':
          result = await this.probeRESTSchema(config, credential ?? undefined);
          break;
        default:
          result = {
            success: false,
            error: `Schema probing not supported for type: ${ds.type}`,
            probedAt: new Date(),
          };
      }
    } catch (err: any) {
      this.logger.error({ id, error: err.message }, 'Schema probe failed');
      result = { success: false, error: err.message, probedAt: new Date() };
    }

    // Persist probe results
    await prisma.dataSource.update({
      where: { id },
      data: {
        schema_cache: result.success && result.tables ? (result.tables as any) : undefined,
        schema_probed_at: result.probedAt,
        status: result.success ? 'connected' : 'failed',
        status_message: result.error ?? null,
      },
    });

    return result;
  }

  private async probeSQLSchema(
    type: string,
    config: DataSourceConfig,
    credential?: string,
  ): Promise<ProbeResult> {
    const connectionConfig: any = config.connectionString
      ? { connectionString: config.connectionString }
      : {
          host: config.host,
          port: config.port ?? 5432,
          database: config.database,
          ssl: config.ssl ? { rejectUnauthorized: false } : false,
        };

    // Apply credential as password if provided
    if (credential) {
      connectionConfig.password = credential;
    }

    connectionConfig.connectionTimeoutMillis = 5000;

    const client = new PgClient(connectionConfig);
    try {
      await client.connect();

      const tablesRes = await client.query(`
        SELECT
          t.table_schema,
          t.table_name,
          c.column_name,
          c.data_type,
          c.is_nullable,
          CASE WHEN kcu.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
        FROM information_schema.tables t
        JOIN information_schema.columns c
          ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        LEFT JOIN information_schema.table_constraints tc
          ON tc.table_schema = t.table_schema
          AND tc.table_name = t.table_name
          AND tc.constraint_type = 'PRIMARY KEY'
        LEFT JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
          AND kcu.table_name = tc.table_name
          AND kcu.column_name = c.column_name
        WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_schema, t.table_name, c.ordinal_position
        LIMIT 200
      `);

      // Group rows into tables
      const tableMap = new Map<string, SchemaTable>();
      for (const row of tablesRes.rows) {
        const key = `${row.table_schema}.${row.table_name}`;
        if (!tableMap.has(key)) {
          tableMap.set(key, {
            name: row.table_name,
            schema: row.table_schema,
            columns: [],
          });
        }
        tableMap.get(key)!.columns.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === 'YES',
          primaryKey: row.is_primary_key === true || row.is_primary_key === 't',
        });
      }

      const tables = Array.from(tableMap.values());
      this.logger.info({ tableCount: tables.length }, 'SQL schema probe complete');

      return { success: true, tables, probedAt: new Date() };
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'SQL schema probe error');
      return { success: false, error: err.message, probedAt: new Date() };
    } finally {
      await client.end().catch(() => {});
    }
  }

  private async probeRESTSchema(
    config: DataSourceConfig,
    credential?: string,
  ): Promise<ProbeResult> {
    const url = config.baseUrl;
    if (!url) {
      return { success: false, error: 'baseUrl is required for REST API probing', probedAt: new Date() };
    }

    const headers: Record<string, string> = { ...(config.headers ?? {}) };

    if (credential && config.authType) {
      switch (config.authType) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${credential}`;
          break;
        case 'basic':
          headers['Authorization'] = `Basic ${Buffer.from(credential).toString('base64')}`;
          break;
        case 'api_key':
          headers['X-API-Key'] = credential;
          break;
      }
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });

      return {
        success: response.ok,
        tables: [{
          name: 'endpoint',
          columns: [
            { name: 'status', type: String(response.status) },
            { name: 'content_type', type: response.headers.get('content-type') ?? 'unknown' },
          ],
        }],
        error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`,
        probedAt: new Date(),
      };
    } catch (err: any) {
      return { success: false, error: err.message, probedAt: new Date() };
    }
  }

  // -------------------------------------------------------------------------
  // Query Execution
  // -------------------------------------------------------------------------

  async executeQuery(id: string, userId: string, query: string): Promise<QueryResult> {
    const ds = await this.getById(id, userId);
    if (!ds) {
      return { success: false, error: 'Data source not found' };
    }

    this.logger.info({ id, type: ds.type }, 'Executing query');

    let credential: string | null = null;
    if (ds.secret_id) {
      credential = await workflowSecretService.resolveSecretValue(ds.secret_id, {});
    }

    const config = ds.connection_config as DataSourceConfig;
    const startTime = Date.now();

    try {
      switch (ds.type) {
        case 'postgres':
          return await this.executePostgresQuery(config, credential ?? undefined, query, startTime);
        case 'rest_api':
          return await this.executeRESTQuery(config, credential ?? undefined, query, startTime);
        default:
          return { success: false, error: `Query execution not supported for type: ${ds.type}` };
      }
    } catch (err: any) {
      this.logger.error({ id, error: err.message }, 'Query execution failed');
      return {
        success: false,
        error: err.message,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  private async executePostgresQuery(
    config: DataSourceConfig,
    credential: string | undefined,
    query: string,
    startTime: number,
  ): Promise<QueryResult> {
    const connectionConfig: any = config.connectionString
      ? { connectionString: config.connectionString }
      : {
          host: config.host,
          port: config.port ?? 5432,
          database: config.database,
          ssl: config.ssl ? { rejectUnauthorized: false } : false,
        };

    if (credential) {
      connectionConfig.password = credential;
    }

    connectionConfig.connectionTimeoutMillis = 5000;
    connectionConfig.statement_timeout = 30000;

    const client = new PgClient(connectionConfig);
    try {
      await client.connect();

      // Set statement timeout as a safety net
      await client.query('SET statement_timeout = 30000');

      const result = await client.query(query);

      // Cap results at 1000 rows
      const rows = Array.isArray(result.rows) ? result.rows.slice(0, 1000) : [];
      const columns = result.fields ? result.fields.map((f: any) => f.name) : [];

      return {
        success: true,
        rows,
        columns,
        rowCount: result.rowCount ?? rows.length,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Postgres query error');
      return {
        success: false,
        error: err.message,
        executionTimeMs: Date.now() - startTime,
      };
    } finally {
      await client.end().catch(() => {});
    }
  }

  private async executeRESTQuery(
    config: DataSourceConfig,
    credential: string | undefined,
    query: string,
    startTime: number,
  ): Promise<QueryResult> {
    const baseUrl = config.baseUrl;
    if (!baseUrl) {
      return { success: false, error: 'baseUrl is required for REST API queries' };
    }

    // query is the path appended to baseUrl
    const url = new URL(query, baseUrl).toString();

    const headers: Record<string, string> = { ...(config.headers ?? {}) };

    if (credential && config.authType) {
      switch (config.authType) {
        case 'bearer':
          headers['Authorization'] = `Bearer ${credential}`;
          break;
        case 'basic':
          headers['Authorization'] = `Basic ${Buffer.from(credential).toString('base64')}`;
          break;
        case 'api_key':
          headers['X-API-Key'] = credential;
          break;
      }
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(30000),
      });

      const contentType = response.headers.get('content-type') ?? '';
      let rows: any[] = [];

      if (contentType.includes('application/json')) {
        const body = await response.json();
        rows = Array.isArray(body) ? body.slice(0, 1000) : [body];
      } else {
        const text = await response.text();
        rows = [{ body: text.slice(0, 10000) }];
      }

      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      return {
        success: response.ok,
        rows,
        columns,
        rowCount: rows.length,
        error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
