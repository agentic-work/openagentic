/**
 * Shared Milvus Service
 *
 * Provides consistent Milvus collection management for both API and MCP Orchestrator
 * Handles collection creation, validation, and recovery
 */

import { MilvusClient, DataType, ErrorCode } from '@zilliz/milvus2-sdk-node';
import { Logger } from 'pino';
import { EmbeddingService } from './EmbeddingService.js';

export interface CollectionSchema {
  name: string;
  fields: FieldSchema[];
  description?: string;
}

export interface FieldSchema {
  name: string;
  type: 'int64' | 'varchar' | 'float_vector' | 'json' | 'array' | 'bool' | 'float';
  isPrimary?: boolean;
  autoId?: boolean;
  maxLength?: number;
  dimension?: number;
  elementType?: string;
  maxCapacity?: number;
}

export class MilvusService {
  private client: MilvusClient;
  private logger: Logger;
  private embeddingService: EmbeddingService;
  private isConnected: boolean = false;

  constructor(logger: Logger, embeddingService: EmbeddingService) {
    this.logger = logger.child({ component: 'MilvusService' });
    this.embeddingService = embeddingService;

    // Initialize Milvus client
    const host = process.env.MILVUS_HOST || 'openagentic-milvus';
    const port = process.env.MILVUS_PORT || '19530';
    const address = `${host}:${port}`;
    const username = process.env.MILVUS_USERNAME;
    const password = process.env.MILVUS_PASSWORD;

    this.logger.info({
      host,
      port,
      address,
      hasAuth: !!(username && password)
    }, 'Initializing Milvus client');

    this.client = new MilvusClient({
      address,
      username,
      password,
      timeout: 30000 // 30 second timeout
    });
  }

  /**
   * Connect to Milvus and verify connection
   */
  async connect(): Promise<boolean> {
    try {
      // Check server status
      const health = await this.client.checkHealth();
      this.isConnected = health.isHealthy;

      if (this.isConnected) {
        this.logger.info('Successfully connected to Milvus');

        // Get server version for debugging
        const version = await this.client.getVersion();
        this.logger.info({
          version: version.version
        }, 'Milvus server info');
      } else {
        this.logger.warn('Milvus server is not healthy');
      }

      return this.isConnected;
    } catch (error) {
      this.logger.error({ error }, 'Failed to connect to Milvus');
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Create or update a collection with proper error handling
   */
  async createCollection(schema: CollectionSchema): Promise<boolean> {
    try {
      // Check if collection exists
      const hasCollection = await this.client.hasCollection({
        collection_name: schema.name
      });

      if (hasCollection.value) {
        this.logger.info({
          collection: schema.name
        }, 'Collection already exists, validating schema');

        // Validate existing collection schema
        const isValid = await this.validateCollectionSchema(schema);

        if (!isValid) {
          this.logger.warn({
            collection: schema.name
          }, 'Existing collection schema mismatch, recreating');

          // Drop and recreate
          await this.dropCollection(schema.name);
          return await this.createNewCollection(schema);
        }

        // Ensure collection is loaded
        await this.loadCollection(schema.name);
        return true;
      }

      // Create new collection
      return await this.createNewCollection(schema);

    } catch (error) {
      this.logger.error({
        error,
        collection: schema.name
      }, 'Failed to create/update collection');
      return false;
    }
  }

  /**
   * Create a new collection
   */
  private async createNewCollection(schema: CollectionSchema): Promise<boolean> {
    try {
      // Convert schema to Milvus format
      const fields = schema.fields.map(field => {
        const milvusField: any = {
          name: field.name,
          is_primary_key: field.isPrimary || false,
          autoID: field.autoId || false
        };

        // Set data type
        switch (field.type) {
          case 'int64':
            milvusField.data_type = DataType.Int64;
            break;
          case 'varchar':
            milvusField.data_type = DataType.VarChar;
            milvusField.max_length = field.maxLength || 256;
            break;
          case 'float_vector':
            milvusField.data_type = DataType.FloatVector;
            milvusField.dim = field.dimension || this.embeddingService.getDimension();
            break;
          case 'json':
            milvusField.data_type = DataType.JSON;
            break;
          case 'array':
            milvusField.data_type = DataType.Array;
            milvusField.element_type = DataType.VarChar;
            milvusField.max_capacity = field.maxCapacity || 100;
            milvusField.max_length = field.maxLength || 256;
            break;
          case 'bool':
            milvusField.data_type = DataType.Bool;
            break;
          case 'float':
            milvusField.data_type = DataType.Float;
            break;
        }

        return milvusField;
      });

      // Create collection
      await this.client.createCollection({
        collection_name: schema.name,
        description: schema.description || '',
        fields
      });

      this.logger.info({
        collection: schema.name,
        fields: fields.length
      }, 'Created new collection');

      // Create index for vector fields
      for (const field of schema.fields) {
        if (field.type === 'float_vector') {
          await this.createVectorIndex(schema.name, field.name);
        }
      }

      // Load collection
      await this.loadCollection(schema.name);

      return true;

    } catch (error) {
      this.logger.error({
        error,
        collection: schema.name
      }, 'Failed to create new collection');
      return false;
    }
  }

  /**
   * Create vector index for similarity search
   */
  private async createVectorIndex(collection: string, field: string): Promise<void> {
    try {
      await this.client.createIndex({
        collection_name: collection,
        field_name: field,
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 128 }
      });

      this.logger.info({
        collection,
        field
      }, 'Created vector index');

    } catch (error) {
      // Index might already exist
      this.logger.warn({
        error,
        collection,
        field
      }, 'Failed to create vector index (may already exist)');
    }
  }

  /**
   * Load collection into memory
   */
  async loadCollection(name: string): Promise<void> {
    try {
      // Check if already loaded
      const info = await this.client.getLoadState({
        collection_name: name
      });

      if (info.state === 'LoadStateLoaded') {
        this.logger.debug({
          collection: name
        }, 'Collection already loaded');
        return;
      }

      // Load collection
      await this.client.loadCollection({
        collection_name: name
      });

      this.logger.info({
        collection: name
      }, 'Loaded collection into memory');

    } catch (error) {
      this.logger.warn({
        error,
        collection: name
      }, 'Failed to load collection');
    }
  }

  /**
   * Drop a collection
   */
  async dropCollection(name: string): Promise<void> {
    try {
      await this.client.dropCollection({
        collection_name: name
      });

      this.logger.info({
        collection: name
      }, 'Dropped collection');

    } catch (error) {
      this.logger.warn({
        error,
        collection: name
      }, 'Failed to drop collection');
    }
  }

  /**
   * Validate collection schema matches expected
   */
  private async validateCollectionSchema(schema: CollectionSchema): Promise<boolean> {
    try {
      const info = await this.client.describeCollection({
        collection_name: schema.name
      });

      // Check field count
      if (info.schema.fields.length !== schema.fields.length) {
        return false;
      }

      // Check each field
      for (const expectedField of schema.fields) {
        const actualField = info.schema.fields.find(
          (f: any) => f.name === expectedField.name
        );

        if (!actualField) {
          return false;
        }

        // Check vector dimension
        if (expectedField.type === 'float_vector') {
          const expectedDim = expectedField.dimension || this.embeddingService.getDimension();
          if (actualField.type_params?.find((p: any) => p.key === 'dim')?.value !== String(expectedDim)) {
            this.logger.warn({
              field: expectedField.name,
              expected: expectedDim,
              actual: actualField.type_params?.find((p: any) => p.key === 'dim')?.value
            }, 'Vector dimension mismatch');
            return false;
          }
        }
      }

      return true;

    } catch (error) {
      this.logger.error({
        error,
        collection: schema.name
      }, 'Failed to validate collection schema');
      return false;
    }
  }

  /**
   * Insert data into collection
   */
  async insert(collection: string, data: any[]): Promise<boolean> {
    try {
      const result = await this.client.insert({
        collection_name: collection,
        data
      });

      this.logger.info({
        collection,
        count: data.length,
        insertCount: result.insert_cnt
      }, 'Inserted data into collection');

      return true;

    } catch (error) {
      this.logger.error({
        error,
        collection,
        count: data.length
      }, 'Failed to insert data');
      return false;
    }
  }

  /**
   * Search for similar vectors
   */
  async search(
    collection: string,
    vectors: number[][],
    topK: number = 10,
    outputFields?: string[]
  ): Promise<any[]> {
    try {
      const result = await this.client.search({
        collection_name: collection,
        vectors,
        limit: topK,
        output_fields: outputFields,
        metric_type: 'COSINE'
      });

      return result.results;

    } catch (error) {
      this.logger.error({
        error,
        collection
      }, 'Search failed');
      return [];
    }
  }

  /**
   * Delete all entities in a collection
   */
  async deleteAll(collection: string): Promise<void> {
    try {
      await this.client.deleteEntities({
        collection_name: collection,
        expr: 'id >= 0' // Delete all
      });

      this.logger.info({
        collection
      }, 'Deleted all entities from collection');

    } catch (error) {
      this.logger.warn({
        error,
        collection
      }, 'Failed to delete entities');
    }
  }

  /**
   * Get collection statistics
   */
  async getStats(collection: string): Promise<any> {
    try {
      const stats = await this.client.getCollectionStatistics({
        collection_name: collection
      });

      return {
        rowCount: parseInt(String(stats.stats.find((s: any) => s.key === 'row_count')?.value || '0'), 10)
      };

    } catch (error) {
      this.logger.error({
        error,
        collection
      }, 'Failed to get collection stats');
      return { rowCount: 0 };
    }
  }

  /**
   * Check if connected to Milvus
   */
  isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Get client for direct operations
   */
  getClient(): MilvusClient {
    return this.client;
  }
}