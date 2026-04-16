/**
 * Azure SDK Knowledge Ingester
 *
 * Fetches and ingests Azure SDK/CLI documentation into Milvus
 * for automatic RAG retrieval during Azure-related queries.
 *
 * This allows the LLM to know HOW to use azure-sdk-mcp tools
 * WITHOUT requiring an MCP call to fetch documentation.
 */

import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { Logger } from 'pino';
import * as crypto from 'crypto';
import { getModelCapabilityDiscoveryService } from './ModelCapabilityDiscoveryService.js';
import { dynamicModelManager } from './DynamicModelManager.js';

interface AzureDocSource {
  name: string;
  url: string;
  type: 'cli_reference' | 'sdk_docs' | 'rest_api' | 'tutorial' | 'best_practices';
  category: 'azure-cli' | 'azure-sdk-python' | 'azure-rest-api' | 'azure-general';
  priority: number; // 1-10, higher = more important
}

interface AzureDocChunk {
  id: string;
  content: string;
  embedding?: number[];
  metadata: {
    source: string;
    sourceUrl: string;
    type: string;
    category: string;
    title: string;
    section?: string;
    commands?: string[];
    examples?: string[];
    priority: number;
    ingestedAt: number;
    version?: string;
  };
}

/**
 * Azure documentation sources to ingest
 * Prioritized by usefulness for LLM tool usage
 */
const AZURE_DOC_SOURCES: AzureDocSource[] = [
  // HIGH PRIORITY: Azure CLI Command Reference (most actionable)
  {
    name: 'Azure CLI Overview',
    url: 'https://learn.microsoft.com/en-us/cli/azure/',
    type: 'cli_reference',
    category: 'azure-cli',
    priority: 10
  },
  {
    name: 'Azure CLI - VM Commands',
    url: 'https://learn.microsoft.com/en-us/cli/azure/vm',
    type: 'cli_reference',
    category: 'azure-cli',
    priority: 9
  },
  {
    name: 'Azure CLI - Resource Group Commands',
    url: 'https://learn.microsoft.com/en-us/cli/azure/group',
    type: 'cli_reference',
    category: 'azure-cli',
    priority: 9
  },
  {
    name: 'Azure CLI - Account Commands',
    url: 'https://learn.microsoft.com/en-us/cli/azure/account',
    type: 'cli_reference',
    category: 'azure-cli',
    priority: 10
  },
  {
    name: 'Azure CLI - AKS Commands',
    url: 'https://learn.microsoft.com/en-us/cli/azure/aks',
    type: 'cli_reference',
    category: 'azure-cli',
    priority: 8
  },
  {
    name: 'Azure CLI - Storage Commands',
    url: 'https://learn.microsoft.com/en-us/cli/azure/storage',
    type: 'cli_reference',
    category: 'azure-cli',
    priority: 8
  },
  {
    name: 'Azure CLI - KeyVault Commands',
    url: 'https://learn.microsoft.com/en-us/cli/azure/keyvault',
    type: 'cli_reference',
    category: 'azure-cli',
    priority: 8
  },
  {
    name: 'Azure CLI - Network Commands',
    url: 'https://learn.microsoft.com/en-us/cli/azure/network',
    type: 'cli_reference',
    category: 'azure-cli',
    priority: 7
  },

  // MEDIUM PRIORITY: Azure SDK for Python
  {
    name: 'Azure SDK Python Overview',
    url: 'https://learn.microsoft.com/en-us/azure/developer/python/sdk/azure-sdk-overview',
    type: 'sdk_docs',
    category: 'azure-sdk-python',
    priority: 7
  },
  {
    name: 'Azure Identity Library',
    url: 'https://learn.microsoft.com/en-us/python/api/overview/azure/identity-readme',
    type: 'sdk_docs',
    category: 'azure-sdk-python',
    priority: 8
  },
  {
    name: 'Azure Resource Management',
    url: 'https://learn.microsoft.com/en-us/python/api/overview/azure/mgmt-resource-readme',
    type: 'sdk_docs',
    category: 'azure-sdk-python',
    priority: 7
  },

  // LOWER PRIORITY: REST API Reference
  {
    name: 'Azure Resource Manager REST API',
    url: 'https://learn.microsoft.com/en-us/rest/api/resources/',
    type: 'rest_api',
    category: 'azure-rest-api',
    priority: 5
  }
];

/**
 * Keywords that trigger Azure SDK documentation retrieval
 */
export const AZURE_KEYWORDS = [
  // Cloud provider
  'azure', 'microsoft azure', 'az ',

  // Resources
  'subscription', 'resource group', 'resource-group',
  'virtual machine', 'vm', 'vms',
  'storage account', 'blob', 'container',
  'keyvault', 'key vault', 'secret', 'certificate',
  'aks', 'kubernetes', 'k8s',
  'app service', 'function app', 'webapp',
  'sql database', 'cosmos', 'postgresql',
  'vnet', 'virtual network', 'subnet', 'nsg',
  'load balancer', 'application gateway',
  'acr', 'container registry',

  // Actions
  'az account', 'az vm', 'az group', 'az aks',
  'az storage', 'az keyvault', 'az network',

  // Concepts
  'entra', 'aad', 'active directory', 'rbac',
  'managed identity', 'service principal'
];

export class AzureSDKKnowledgeIngester {
  private milvus: MilvusClient;
  private logger: Logger;
  private collectionName = 'azure_sdk_documentation';
  private mcpProxyEndpoint: string;
  private fetchMcpAvailable = false;

  constructor(milvus: MilvusClient, logger: Logger) {
    this.milvus = milvus;
    this.logger = logger.child({ service: 'AzureSDKKnowledgeIngester' });
    this.mcpProxyEndpoint = process.env.MCP_PROXY_ENDPOINT || 'http://openagentic-mcp-proxy:8080';
  }

  /**
   * Initialize the azure_sdk_documentation collection in Milvus
   */
  async initializeCollection(): Promise<void> {
    try {
      const exists = await this.milvus.hasCollection({ collection_name: this.collectionName });

      if (!exists.value) {
        this.logger.info(`Creating collection: ${this.collectionName}`);

        await this.milvus.createCollection({
          collection_name: this.collectionName,
          fields: [
            {
              name: 'id',
              data_type: 5, // Int64
              is_primary_key: true,
              autoID: true
            },
            {
              name: 'content',
              data_type: 21, // VarChar
              max_length: 65535
            },
            {
              name: 'embedding',
              data_type: 101, // FloatVector
              dim: 1536
            },
            {
              name: 'source',
              data_type: 21, // VarChar
              max_length: 500
            },
            {
              name: 'source_url',
              data_type: 21, // VarChar
              max_length: 1000
            },
            {
              name: 'type',
              data_type: 21, // VarChar
              max_length: 50
            },
            {
              name: 'category',
              data_type: 21, // VarChar
              max_length: 50
            },
            {
              name: 'priority',
              data_type: 5, // Int64
            },
            {
              name: 'metadata',
              data_type: 23, // JSON
            },
            {
              name: 'timestamp',
              data_type: 5, // Int64 (Unix timestamp)
            }
          ]
        });

        // Create vector index for similarity search
        await this.milvus.createIndex({
          collection_name: this.collectionName,
          field_name: 'embedding',
          index_type: 'IVF_FLAT',
          metric_type: 'COSINE',
          params: { nlist: 128 }
        });

        // Load collection into memory
        await this.milvus.loadCollection({ collection_name: this.collectionName });

        this.logger.info('Azure SDK documentation collection created and loaded');
      } else {
        // Ensure collection is loaded
        await this.milvus.loadCollection({ collection_name: this.collectionName });
        this.logger.info('Azure SDK documentation collection already exists, loaded');
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize Azure SDK documentation collection');
      throw error;
    }
  }

  /**
   * Get embedding model from discovery service
   */
  private async getEmbeddingModel(): Promise<string> {
    const discoveryService = getModelCapabilityDiscoveryService();
    if (discoveryService) {
      const models = await discoveryService.searchModelsByCapability('embedding');
      if (models && models.length > 0) {
        return models[0].modelId;
      }
    }

    const embeddingInfo = await dynamicModelManager.getEmbeddingModel();
    if (embeddingInfo) {
      return embeddingInfo.model;
    }

    // Fallback
    return 'text-embedding-3-large';
  }

  /**
   * Generate embedding for text
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.mcpProxyEndpoint}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.MCP_PROXY_API_KEY || ''}`
        },
        body: JSON.stringify({
          model: await this.getEmbeddingModel(),
          input: text.substring(0, 8000) // Limit input size
        })
      });

      if (!response.ok) {
        throw new Error(`Embedding generation failed: ${response.statusText}`);
      }

      const data = await response.json() as any;
      return data.data[0].embedding;
    } catch (error) {
      this.logger.error({ error }, 'Failed to generate embedding');
      throw error;
    }
  }

  /**
   * Fetch documentation using fetch MCP or direct HTTP
   */
  private async fetchDocumentation(source: AzureDocSource): Promise<string | null> {
    try {
      // Try direct HTTP fetch (more reliable than MCP for external sites)
      const response = await fetch(source.url, {
        headers: {
          'User-Agent': 'OpenAgenticChat-KnowledgeIngester/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9'
        }
      });

      if (!response.ok) {
        this.logger.warn({ url: source.url, status: response.status }, 'Failed to fetch documentation');
        return null;
      }

      const html = await response.text();

      // Convert HTML to plain text/markdown (simplified)
      const content = this.htmlToMarkdown(html);

      return content;
    } catch (error) {
      this.logger.error({ error, url: source.url }, 'Error fetching documentation');
      return null;
    }
  }

  /**
   * Simple HTML to Markdown converter
   * Extracts main content and converts to readable format
   */
  private htmlToMarkdown(html: string): string {
    // Remove script and style tags
    let content = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Remove navigation and footer
    content = content.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
    content = content.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
    content = content.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');

    // Extract main content area (Microsoft Learn specific)
    const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      content = mainMatch[1];
    }

    // Convert headings
    content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
    content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
    content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
    content = content.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');

    // Convert code blocks
    content = content.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
    content = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

    // Convert lists
    content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
    content = content.replace(/<ul[^>]*>|<\/ul>/gi, '\n');
    content = content.replace(/<ol[^>]*>|<\/ol>/gi, '\n');

    // Convert paragraphs
    content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');

    // Convert links (keep href)
    content = content.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

    // Convert bold/italic
    content = content.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
    content = content.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
    content = content.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
    content = content.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

    // Convert tables (simplified)
    content = content.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, tableContent) => {
      const rows = tableContent.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
      return rows.map((row: string) => {
        const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
        return '| ' + cells.map((cell: string) => cell.replace(/<[^>]+>/g, '').trim()).join(' | ') + ' |';
      }).join('\n');
    });

    // Remove remaining HTML tags
    content = content.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    content = content.replace(/&lt;/g, '<');
    content = content.replace(/&gt;/g, '>');
    content = content.replace(/&amp;/g, '&');
    content = content.replace(/&quot;/g, '"');
    content = content.replace(/&#39;/g, "'");
    content = content.replace(/&nbsp;/g, ' ');

    // Clean up whitespace
    content = content.replace(/\n{3,}/g, '\n\n');
    content = content.trim();

    return content;
  }

  /**
   * Chunk documentation into searchable segments
   */
  private chunkDocument(content: string, source: AzureDocSource): AzureDocChunk[] {
    const chunks: AzureDocChunk[] = [];
    const maxChunkSize = 1500;
    const overlap = 200;

    // Split by sections (## headings)
    const sections = content.split(/(?=^##\s)/m);

    for (const section of sections) {
      if (section.trim().length < 50) continue; // Skip tiny sections

      // Extract section title
      const titleMatch = section.match(/^##\s+(.+?)(?:\n|$)/);
      const sectionTitle = titleMatch ? titleMatch[1].trim() : source.name;

      // Extract commands mentioned
      const commands = this.extractCommands(section);

      // Extract code examples
      const examples = this.extractExamples(section);

      // If section is small enough, keep as one chunk
      if (section.length <= maxChunkSize) {
        chunks.push({
          id: crypto.randomBytes(16).toString('hex'),
          content: section.trim(),
          metadata: {
            source: source.name,
            sourceUrl: source.url,
            type: source.type,
            category: source.category,
            title: sectionTitle,
            commands,
            examples,
            priority: source.priority,
            ingestedAt: Date.now()
          }
        });
      } else {
        // Split large sections into smaller chunks with overlap
        const sentences = section.match(/[^.!?]+[.!?]+/g) || [section];
        let currentChunk = '';

        for (let i = 0; i < sentences.length; i++) {
          const sentence = sentences[i];

          if ((currentChunk + sentence).length > maxChunkSize && currentChunk) {
            chunks.push({
              id: crypto.randomBytes(16).toString('hex'),
              content: currentChunk.trim(),
              metadata: {
                source: source.name,
                sourceUrl: source.url,
                type: source.type,
                category: source.category,
                title: sectionTitle,
                section: `Part ${chunks.length + 1}`,
                commands: this.extractCommands(currentChunk),
                examples: this.extractExamples(currentChunk),
                priority: source.priority,
                ingestedAt: Date.now()
              }
            });

            // Start new chunk with overlap
            const overlapStart = Math.max(0, i - 2);
            currentChunk = sentences.slice(overlapStart, i + 1).join('');
          } else {
            currentChunk += sentence;
          }
        }

        // Add remaining chunk
        if (currentChunk.trim()) {
          chunks.push({
            id: crypto.randomBytes(16).toString('hex'),
            content: currentChunk.trim(),
            metadata: {
              source: source.name,
              sourceUrl: source.url,
              type: source.type,
              category: source.category,
              title: sectionTitle,
              section: `Part ${chunks.length + 1}`,
              commands: this.extractCommands(currentChunk),
              examples: this.extractExamples(currentChunk),
              priority: source.priority,
              ingestedAt: Date.now()
            }
          });
        }
      }
    }

    return chunks;
  }

  /**
   * Extract Azure CLI commands from content
   */
  private extractCommands(content: string): string[] {
    const commands: string[] = [];

    // Match az commands
    const azMatches = content.match(/\baz\s+[a-z-]+(?:\s+[a-z-]+)?/gi);
    if (azMatches) {
      commands.push(...new Set(azMatches.map(cmd => cmd.trim())));
    }

    return commands.slice(0, 10); // Limit to 10 commands per chunk
  }

  /**
   * Extract code examples from content
   */
  private extractExamples(content: string): string[] {
    const examples: string[] = [];

    // Match code blocks
    const codeBlocks = content.match(/```[\s\S]*?```/g);
    if (codeBlocks) {
      for (const block of codeBlocks.slice(0, 3)) { // Limit to 3 examples
        const code = block.replace(/```\w*\n?/g, '').trim();
        if (code.length > 10 && code.length < 500) {
          examples.push(code);
        }
      }
    }

    return examples;
  }

  /**
   * Store chunk in Milvus
   */
  private async storeChunk(chunk: AzureDocChunk): Promise<void> {
    try {
      // Generate embedding
      chunk.embedding = await this.generateEmbedding(chunk.content);

      await this.milvus.insert({
        collection_name: this.collectionName,
        data: [{
          content: chunk.content,
          embedding: chunk.embedding,
          source: chunk.metadata.source,
          source_url: chunk.metadata.sourceUrl,
          type: chunk.metadata.type,
          category: chunk.metadata.category,
          priority: chunk.metadata.priority,
          metadata: JSON.stringify(chunk.metadata),
          timestamp: Math.floor(chunk.metadata.ingestedAt / 1000)
        }]
      });
    } catch (error) {
      this.logger.error({ error, chunk: chunk.metadata.title }, 'Failed to store chunk in Milvus');
      throw error;
    }
  }

  /**
   * Main ingestion method - fetches and stores all Azure SDK documentation
   */
  async ingestAllDocumentation(): Promise<{
    success: boolean;
    sourcesProcessed: number;
    chunksStored: number;
    errors: string[];
  }> {
    this.logger.info('Starting Azure SDK documentation ingestion...');

    const results = {
      success: true,
      sourcesProcessed: 0,
      chunksStored: 0,
      errors: [] as string[]
    };

    // Initialize collection
    await this.initializeCollection();

    // Clear existing data for fresh ingestion
    try {
      // Delete old data (older than 1 day to allow for partial re-runs)
      const oneDayAgo = Math.floor((Date.now() - 86400000) / 1000);
      await this.milvus.delete({
        collection_name: this.collectionName,
        filter: `timestamp < ${oneDayAgo}`
      });
      this.logger.info('Cleared old Azure SDK documentation');
    } catch (error) {
      this.logger.warn({ error }, 'Could not clear old documentation (may not exist)');
    }

    // Process each documentation source
    for (const source of AZURE_DOC_SOURCES) {
      try {
        this.logger.info({ source: source.name, url: source.url }, 'Fetching documentation...');

        const content = await this.fetchDocumentation(source);

        if (!content) {
          results.errors.push(`Failed to fetch: ${source.name}`);
          continue;
        }

        // Chunk the documentation
        const chunks = this.chunkDocument(content, source);

        this.logger.info({ source: source.name, chunks: chunks.length }, 'Chunked documentation');

        // Store each chunk
        for (const chunk of chunks) {
          try {
            await this.storeChunk(chunk);
            results.chunksStored++;
          } catch (error) {
            results.errors.push(`Failed to store chunk from ${source.name}: ${(error as Error).message}`);
          }
        }

        results.sourcesProcessed++;

        // Rate limit to avoid overwhelming embedding service
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        const errorMsg = `Error processing ${source.name}: ${(error as Error).message}`;
        this.logger.error({ error, source: source.name }, errorMsg);
        results.errors.push(errorMsg);
      }
    }

    results.success = results.errors.length === 0;

    this.logger.info({
      sourcesProcessed: results.sourcesProcessed,
      chunksStored: results.chunksStored,
      errors: results.errors.length
    }, 'Azure SDK documentation ingestion completed');

    return results;
  }

  /**
   * Search Azure SDK documentation
   * Used by prompt.stage.ts for automatic knowledge retrieval
   */
  async search(query: string, options: {
    limit?: number;
    category?: string;
    minPriority?: number;
  } = {}): Promise<any[]> {
    try {
      const queryEmbedding = await this.generateEmbedding(query);

      // Build filter expression
      let filter = '';
      const filters: string[] = [];

      if (options.category) {
        filters.push(`category == "${options.category}"`);
      }
      if (options.minPriority) {
        filters.push(`priority >= ${options.minPriority}`);
      }

      if (filters.length > 0) {
        filter = filters.join(' && ');
      }

      const searchParams: any = {
        collection_name: this.collectionName,
        data: [queryEmbedding],
        limit: options.limit || 5,
        output_fields: ['content', 'source', 'source_url', 'type', 'category', 'priority', 'metadata']
      };

      if (filter) {
        searchParams.filter = filter;
      }

      const results = await this.milvus.search(searchParams);

      return results.results.map(result => ({
        content: result.content,
        score: result.score,
        source: result.source,
        sourceUrl: result.source_url,
        type: result.type,
        category: result.category,
        priority: result.priority,
        metadata: JSON.parse(result.metadata || '{}')
      }));

    } catch (error) {
      this.logger.error({ error, query }, 'Failed to search Azure SDK documentation');
      return [];
    }
  }

  /**
   * Check if a query is Azure-related
   * Used to determine whether to retrieve Azure SDK documentation
   */
  static isAzureQuery(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    return AZURE_KEYWORDS.some(keyword => lowerQuery.includes(keyword.toLowerCase()));
  }

  /**
   * Get collection statistics
   */
  async getStats(): Promise<{
    totalChunks: number;
    byCategory: Record<string, number>;
    lastIngested: Date | null;
  }> {
    try {
      const collectionInfo = await this.milvus.getCollectionStatistics({
        collection_name: this.collectionName
      });

      return {
        totalChunks: parseInt(collectionInfo.data.row_count) || 0,
        byCategory: {}, // Would require additional queries
        lastIngested: null // Would require additional queries
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to get Azure SDK documentation stats');
      return {
        totalChunks: 0,
        byCategory: {},
        lastIngested: null
      };
    }
  }
}

// Singleton instance
let azureSDKKnowledgeIngester: AzureSDKKnowledgeIngester | null = null;

export function getAzureSDKKnowledgeIngester(milvus?: MilvusClient, logger?: Logger): AzureSDKKnowledgeIngester | null {
  if (!azureSDKKnowledgeIngester && milvus && logger) {
    azureSDKKnowledgeIngester = new AzureSDKKnowledgeIngester(milvus, logger);
  }
  return azureSDKKnowledgeIngester;
}
