import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'crypto';
import { DefaultAzureCredential } from '@azure/identity';
import { ModelConfigurationService } from './ModelConfigurationService.js';

interface RAGHealthResult {
  healthy: boolean;
  embeddingModel: string;
  responseTime: number;
  error?: string;
  testText?: string;
  embeddingDimension?: number;
  testUuid?: string;
}

export class RAGHealthCheckService {
  private logger: FastifyBaseLogger;
  private lastHealthCheck?: RAGHealthResult;
  private lastCheckTime?: Date;
  private checkIntervalMs = parseInt(process.env.RAG_HEALTH_CHECK_INTERVAL_MS || '30000'); // Check every 30 seconds

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  async checkRAGHealth(): Promise<RAGHealthResult> {
    const now = new Date();
    
    // Return cached result if check was recent (within 30 seconds)
    if (this.lastHealthCheck && this.lastCheckTime && 
        (now.getTime() - this.lastCheckTime.getTime()) < this.checkIntervalMs) {
      return this.lastHealthCheck;
    }

    const startTime = Date.now();
    // DB is SoT for embedding model — dropped env fallback chain and hardcoded literal.
    const embeddingAssignment = await ModelConfigurationService.getServiceModel('embedding').catch(() => null);
    const embeddingModel = embeddingAssignment?.modelId ?? '';
    
    // Generate unique UUID for each test to prevent caching
    const testUuid = randomUUID();
    const testText = `RAG health check test with unique identifier: ${testUuid}`;
    
    try {
      // Use MCP Proxy for embeddings
      const mcpProxyUrl = process.env.MCP_PROXY_ENDPOINT || 'http://openagentic-mcp-proxy:8080';
      const mcpProxyKey = process.env.MCP_PROXY_API_KEY;

      if (!mcpProxyUrl || !mcpProxyKey) {
        throw new Error('MCP Proxy not configured');
      }

      if (!embeddingModel || embeddingModel === 'unknown') {
        throw new Error('Embedding deployment not configured');
      }

      // Call MCP Proxy embeddings endpoint
      const modelPrefix = process.env.MODEL_PREFIX || process.env.DEFAULT_MODEL_PREFIX || '';
      const fullModelName = modelPrefix ? `${modelPrefix}/${embeddingModel}` : embeddingModel;

      const response = await fetch(`${mcpProxyUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${mcpProxyKey}`
        },
        body: JSON.stringify({
          model: fullModelName,
          input: testText,
          encoding_format: 'float'
        })
      });

      if (!response.ok) {
        throw new Error(`MCP Proxy embeddings failed: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json() as any;

      const responseTime = Date.now() - startTime;
      const embedding = responseData.data[0].embedding;

      // Validate the embedding
      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('Invalid embedding response: empty or invalid format');
      }

      // Check that we got reasonable numeric values
      const hasValidNumbers = embedding.every(val => typeof val === 'number' && !isNaN(val));
      if (!hasValidNumbers) {
        throw new Error('Invalid embedding response: contains non-numeric values');
      }

      // Check for reasonable dimension (common embedding dimensions)
      const expectedDimensions = [384, 512, 768, 1024, 1536, 3072];
      if (!expectedDimensions.includes(embedding.length)) {
        this.logger.warn({
          embeddingModel,
          dimension: embedding.length
        }, `Unusual embedding dimension: ${embedding.length}`);
      }

      const result: RAGHealthResult = {
        healthy: true,
        embeddingModel,
        responseTime,
        testText,
        embeddingDimension: embedding.length,
        testUuid
      };

      this.lastHealthCheck = result;
      this.lastCheckTime = now;
      
      this.logger.debug({ 
        embeddingModel, 
        responseTime,
        embeddingDimension: embedding.length,
        testUuid
      }, 'RAG health check passed');
      
      return result;

    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      const result: RAGHealthResult = {
        healthy: false,
        embeddingModel,
        responseTime,
        error: errorMessage,
        testText,
        testUuid
      };

      this.lastHealthCheck = result;
      this.lastCheckTime = now;
      
      this.logger.error({ 
        embeddingModel, 
        responseTime, 
        error: errorMessage,
        testUuid
      }, 'RAG health check failed');
      
      return result;
    }
  }

  getLastHealthCheck(): RAGHealthResult | undefined {
    return this.lastHealthCheck;
  }
}