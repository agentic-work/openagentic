/**
 * ProviderCapabilityService
 *
 * Phase 5 of the Data Layer Evolution Plan — provider-specific grounding capabilities.
 *
 * Determines what grounding/enhancement capabilities each LLM provider supports
 * and configures completion requests appropriately. Each provider has native features
 * that can improve response quality:
 *
 * - Gemini/Vertex AI: Google Search grounding, Vertex AI Search (enterprise)
 * - Claude/Anthropic: Citations API for document-based responses
 * - AWS Bedrock: Automated Reasoning (99% accuracy), contextual grounding guardrails
 * - Azure OpenAI: On Your Data (enterprise data), Data Zones (compliance)
 * - OpenAI: No native grounding features yet
 * - Ollama: No grounding features (local models)
 *
 * The service analyzes queries to determine grounding needs, maps them to available
 * provider capabilities, and enhances completion requests with the correct config.
 */

import { loggers } from '../utils/logger.js';

const logger = loggers.services;

// ============================================================================
// Types
// ============================================================================

export type GroundingType = 'web_search' | 'document_citations' | 'enterprise_data' | 'response_verification';

export interface ProviderCapability {
  provider: string;
  capability: GroundingType;
  feature: string;
  configKey: string;
  costPerQuery?: number;
  accuracy?: number;
  description: string;
}

export interface GroundingConfig {
  enabled: boolean;
  type: GroundingType;
  provider: string;
  config: Record<string, any>;
}

export interface GroundingStrategy {
  webGrounding?: GroundingConfig;
  documentCitations?: GroundingConfig;
  enterpriseGrounding?: GroundingConfig;
  verification?: GroundingConfig;
}

export interface GroundingSource {
  url?: string;
  title?: string;
  snippet?: string;
  document?: string;
  pageNumber?: number;
}

export interface GroundingResult {
  sources: GroundingSource[];
  confidence: number;
  citations: string[];
  provider: string;
  groundingType: GroundingType | null;
  raw?: any;
}

// ============================================================================
// Provider Capability Matrix
// ============================================================================

/**
 * Static registry of what each provider can do for grounding.
 * Keyed by the providerType values used across the codebase:
 *   azure-openai, vertex-ai, aws-bedrock, ollama, openai, anthropic
 */
const PROVIDER_CAPABILITIES: Record<string, ProviderCapability[]> = {
  'anthropic': [
    {
      provider: 'anthropic',
      capability: 'document_citations',
      feature: 'Citations API',
      configKey: 'citations',
      description: 'Extracts inline citations from documents provided in context. Returns source references alongside generated text.',
    },
  ],

  'vertex-ai': [
    {
      provider: 'vertex-ai',
      capability: 'web_search',
      feature: 'Google Search Grounding',
      configKey: 'googleSearchRetrieval',
      costPerQuery: 0.014, // $14 per 1K queries
      description: 'Grounds responses with real-time Google Search results. Provides search entry points and grounding chunks.',
    },
    {
      provider: 'vertex-ai',
      capability: 'enterprise_data',
      feature: 'Vertex AI Search',
      configKey: 'vertexAiSearch',
      description: 'Grounds responses against enterprise data indexed in Vertex AI Search datastores.',
    },
  ],

  'aws-bedrock': [
    {
      provider: 'aws-bedrock',
      capability: 'response_verification',
      feature: 'Automated Reasoning',
      configKey: 'automatedReasoning',
      accuracy: 0.99,
      description: 'Verifies LLM responses with 99% accuracy using formal reasoning checks via Bedrock guardrails.',
    },
    {
      provider: 'aws-bedrock',
      capability: 'response_verification',
      feature: 'Contextual Grounding',
      configKey: 'contextualGrounding',
      description: 'Checks response faithfulness against the provided context using Bedrock guardrail policies.',
    },
    {
      provider: 'aws-bedrock',
      capability: 'web_search',
      feature: 'Nova Web Grounding',
      configKey: 'novaWebGrounding',
      description: 'Real-time web access for Amazon Nova models to ground responses with current information.',
    },
    {
      provider: 'aws-bedrock',
      capability: 'document_citations',
      feature: 'Bedrock Citations (Anthropic)',
      configKey: 'bedrockCitations',
      description: 'Citations API available for Anthropic models running on Bedrock.',
    },
  ],

  'azure-openai': [
    {
      provider: 'azure-openai',
      capability: 'enterprise_data',
      feature: 'On Your Data',
      configKey: 'azureOnYourData',
      description: 'Grounds responses against enterprise data via Azure AI Search, Cosmos DB, or Blob Storage.',
    },
    {
      provider: 'azure-openai',
      capability: 'enterprise_data',
      feature: 'Data Zones',
      configKey: 'azureDataZones',
      description: 'Compliance-aware data processing ensuring data residency within specified geographic zones.',
    },
  ],

  'openai': [],

  'ollama': [],
};

// ============================================================================
// Query Analysis Patterns
// ============================================================================

const WEB_SEARCH_PATTERNS = [
  /\b(current|latest|recent|today|now|live|real-?time)\b/i,
  /\b(news|headlines|breaking|update)\b/i,
  /\b(price|stock|weather|forecast|score|result)\b/i,
  /\b(who is|what happened|when did|where is)\b/i,
  /\b(20[2-3]\d)\b/, // Year references (2020-2039)
  /\b(this (week|month|year|morning|afternoon))\b/i,
];

const DOCUMENT_CITATION_PATTERNS = [
  /\b(according to|based on|from the|in the (doc|document|file|paper|report|article))\b/i,
  /\b(cite|citation|reference|source|evidence)\b/i,
  /\b(the (attached|uploaded|provided) (doc|document|file|pdf))\b/i,
  /\b(page \d+|section \d+|chapter \d+)\b/i,
  /\b(quote|excerpt|passage)\b/i,
];

const ENTERPRISE_DATA_PATTERNS = [
  /\b(our (data|company|organization|team|department|system|database))\b/i,
  /\b(internal|proprietary|confidential|private)\b/i,
  /\b(company (policy|procedure|handbook|guideline))\b/i,
  /\b(employee|customer|client|vendor|partner) (data|record|info)\b/i,
  /\b(sharepoint|confluence|jira|salesforce)\b/i,
];

const VERIFICATION_PATTERNS = [
  /\b(verify|confirm|fact[- ]?check|validate|double[- ]?check)\b/i,
  /\b(is it true|is that correct|are you sure|can you confirm)\b/i,
  /\b(accurate|accuracy|truthful|reliable|trustworthy)\b/i,
  /\b(prove|proof|evidence|substantiate)\b/i,
];

// ============================================================================
// Service Implementation
// ============================================================================

export class ProviderCapabilityService {
  private static instance: ProviderCapabilityService;

  private constructor() {
    logger.info('[ProviderCapability] Service initialized');
  }

  static getInstance(): ProviderCapabilityService {
    if (!ProviderCapabilityService.instance) {
      ProviderCapabilityService.instance = new ProviderCapabilityService();
    }
    return ProviderCapabilityService.instance;
  }

  // ==========================================================================
  // 1. getCapabilities — what a provider supports
  // ==========================================================================

  /**
   * Return the full list of grounding capabilities for a given provider.
   * Accepts the providerType identifiers used across the codebase:
   *   anthropic, vertex-ai, aws-bedrock, azure-openai, openai, ollama
   *
   * Also accepts shorthand aliases (google, bedrock, vertex, azure) and
   * normalizes them to the canonical keys.
   */
  getCapabilities(provider: string): ProviderCapability[] {
    const normalized = this.normalizeProvider(provider);
    const capabilities = PROVIDER_CAPABILITIES[normalized] ?? [];

    logger.debug(
      { provider, normalized, count: capabilities.length },
      '[ProviderCapability] getCapabilities'
    );

    return capabilities;
  }

  /**
   * Check whether a specific provider supports a given grounding type.
   */
  hasCapability(provider: string, type: GroundingType): boolean {
    const capabilities = this.getCapabilities(provider);
    return capabilities.some(c => c.capability === type);
  }

  /**
   * Return the best capability of a given type for a provider, or null.
   * "Best" is determined by accuracy (if set), then by order in the registry.
   */
  getBestCapability(provider: string, type: GroundingType): ProviderCapability | null {
    const matches = this.getCapabilities(provider).filter(c => c.capability === type);
    if (matches.length === 0) return null;

    // Prefer highest accuracy if available
    const withAccuracy = matches.filter(m => m.accuracy != null);
    if (withAccuracy.length > 0) {
      return withAccuracy.sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))[0];
    }

    return matches[0];
  }

  // ==========================================================================
  // 2. getGroundingStrategy — determine which grounding to use
  // ==========================================================================

  /**
   * Analyze a query to determine what grounding is needed, then map those
   * needs onto the capabilities available for the given provider.
   *
   * Returns a GroundingStrategy with only the relevant fields populated.
   * Fields are omitted (undefined) when the need is not detected or the
   * provider does not support it.
   */
  getGroundingStrategy(provider: string, query: string): GroundingStrategy {
    const normalized = this.normalizeProvider(provider);
    const needs = this.analyzeQueryGroundingNeeds(query);
    const strategy: GroundingStrategy = {};

    // Web search grounding
    if (needs.webSearch) {
      const cap = this.getBestCapability(normalized, 'web_search');
      if (cap) {
        strategy.webGrounding = {
          enabled: true,
          type: 'web_search',
          provider: normalized,
          config: this.buildCapabilityConfig(cap),
        };
      }
    }

    // Document citations
    if (needs.documentCitations) {
      const cap = this.getBestCapability(normalized, 'document_citations');
      if (cap) {
        strategy.documentCitations = {
          enabled: true,
          type: 'document_citations',
          provider: normalized,
          config: this.buildCapabilityConfig(cap),
        };
      }
    }

    // Enterprise data grounding
    if (needs.enterpriseData) {
      const cap = this.getBestCapability(normalized, 'enterprise_data');
      if (cap) {
        strategy.enterpriseGrounding = {
          enabled: true,
          type: 'enterprise_data',
          provider: normalized,
          config: this.buildCapabilityConfig(cap),
        };
      }
    }

    // Response verification
    if (needs.verification) {
      const cap = this.getBestCapability(normalized, 'response_verification');
      if (cap) {
        strategy.verification = {
          enabled: true,
          type: 'response_verification',
          provider: normalized,
          config: this.buildCapabilityConfig(cap),
        };
      }
    }

    const activeCount = [
      strategy.webGrounding,
      strategy.documentCitations,
      strategy.enterpriseGrounding,
      strategy.verification,
    ].filter(Boolean).length;

    logger.debug(
      { provider: normalized, needs, activeGroundings: activeCount },
      '[ProviderCapability] getGroundingStrategy'
    );

    return strategy;
  }

  // ==========================================================================
  // 3. enhanceCompletionRequest — add provider-specific config
  // ==========================================================================

  /**
   * Mutate (and return) the completion request object with provider-specific
   * configuration for the grounding strategy.
   *
   * This method applies the correct SDK configuration for each provider so
   * the downstream LLM call picks up grounding features automatically.
   */
  enhanceCompletionRequest(provider: string, request: any, strategy: GroundingStrategy): any {
    const normalized = this.normalizeProvider(provider);

    // --- Gemini / Vertex AI: Google Search grounding ---
    if (strategy.webGrounding?.enabled && normalized === 'vertex-ai') {
      request.tools = [
        ...(request.tools || []),
        {
          googleSearchRetrieval: {
            dynamicRetrievalConfig: {
              mode: 'MODE_DYNAMIC',
              dynamicThreshold: 0.7,
            },
          },
        },
      ];
      logger.info('[ProviderCapability] Enhanced request with Gemini Google Search grounding');
    }

    // --- Vertex AI: Enterprise search grounding ---
    if (strategy.enterpriseGrounding?.enabled && normalized === 'vertex-ai') {
      const datastoreId = process.env.VERTEX_AI_SEARCH_DATASTORE_ID;
      if (datastoreId) {
        request.tools = [
          ...(request.tools || []),
          {
            retrieval: {
              vertexAiSearch: {
                datastore: datastoreId,
              },
            },
          },
        ];
        logger.info('[ProviderCapability] Enhanced request with Vertex AI Search enterprise grounding');
      } else {
        logger.warn('[ProviderCapability] VERTEX_AI_SEARCH_DATASTORE_ID not set — skipping enterprise grounding');
      }
    }

    // --- Claude / Anthropic: Citations ---
    if (strategy.documentCitations?.enabled && (normalized === 'anthropic' || normalized === 'aws-bedrock')) {
      request.metadata = {
        ...(request.metadata || {}),
        citations: { enabled: true },
      };
      logger.info('[ProviderCapability] Enhanced request with Anthropic Citations API');
    }

    // --- AWS Bedrock: Guardrails (Automated Reasoning / Contextual Grounding) ---
    if (strategy.verification?.enabled && normalized === 'aws-bedrock') {
      const guardrailId = process.env.BEDROCK_GROUNDING_GUARDRAIL_ID;
      const guardrailVersion = process.env.BEDROCK_GROUNDING_GUARDRAIL_VERSION || '1';
      if (guardrailId) {
        request.guardrailIdentifier = guardrailId;
        request.guardrailVersion = guardrailVersion;
        request.trace = 'enabled';
        logger.info(
          { guardrailId, guardrailVersion },
          '[ProviderCapability] Enhanced request with Bedrock guardrail verification'
        );
      } else {
        logger.warn('[ProviderCapability] BEDROCK_GROUNDING_GUARDRAIL_ID not set — skipping verification');
      }
    }

    // --- Azure OpenAI: On Your Data ---
    if (strategy.enterpriseGrounding?.enabled && normalized === 'azure-openai') {
      const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
      const searchKey = process.env.AZURE_SEARCH_KEY;
      const searchIndex = process.env.AZURE_SEARCH_INDEX;
      if (searchEndpoint && searchIndex) {
        request.dataSources = [
          ...(request.dataSources || []),
          {
            type: 'azure_search',
            parameters: {
              endpoint: searchEndpoint,
              index_name: searchIndex,
              authentication: searchKey
                ? { type: 'api_key', key: searchKey }
                : { type: 'system_assigned_managed_identity' },
              query_type: 'vector_semantic_hybrid',
              in_scope: true,
              strictness: 3,
              top_n_documents: 5,
            },
          },
        ];
        logger.info('[ProviderCapability] Enhanced request with Azure On Your Data');
      } else {
        logger.warn('[ProviderCapability] AZURE_SEARCH_ENDPOINT or AZURE_SEARCH_INDEX not set — skipping enterprise grounding');
      }
    }

    return request;
  }

  // ==========================================================================
  // 4. extractGroundingResults — parse grounding data from response
  // ==========================================================================

  /**
   * Extract and normalize grounding metadata from an LLM response.
   *
   * Each provider returns grounding data in a different shape. This method
   * normalizes it into a common GroundingResult so callers do not need to
   * know which provider was used.
   */
  extractGroundingResults(provider: string, response: any): GroundingResult {
    const normalized = this.normalizeProvider(provider);
    const empty: GroundingResult = {
      sources: [],
      confidence: 0,
      citations: [],
      provider: normalized,
      groundingType: null,
    };

    if (!response) return empty;

    try {
      switch (normalized) {
        case 'vertex-ai':
          return this.extractGeminiGrounding(response);

        case 'anthropic':
          return this.extractAnthropicCitations(response);

        case 'aws-bedrock':
          return this.extractBedrockGrounding(response);

        case 'azure-openai':
          return this.extractAzureGrounding(response);

        default:
          return empty;
      }
    } catch (err) {
      logger.warn(
        { provider: normalized, error: (err as Error).message },
        '[ProviderCapability] Failed to extract grounding results'
      );
      return empty;
    }
  }

  // ==========================================================================
  // Private: Provider-specific extraction
  // ==========================================================================

  private extractGeminiGrounding(response: any): GroundingResult {
    const metadata = response.groundingMetadata
      ?? response.candidates?.[0]?.groundingMetadata;

    if (!metadata) {
      return this.emptyResult('vertex-ai');
    }

    const sources: GroundingSource[] = [];
    const citations: string[] = [];

    // Extract grounding chunks (search results used)
    if (Array.isArray(metadata.groundingChunks)) {
      for (const chunk of metadata.groundingChunks) {
        const web = chunk.web ?? chunk.retrievedContext;
        if (web) {
          sources.push({
            url: web.uri ?? web.url,
            title: web.title ?? '',
            snippet: web.text ?? '',
          });
        }
      }
    }

    // Extract search entry point (rendered search widget)
    if (metadata.searchEntryPoint?.renderedContent) {
      citations.push(metadata.searchEntryPoint.renderedContent);
    }

    // Extract grounding supports (inline citations with confidence)
    let avgConfidence = 0;
    if (Array.isArray(metadata.groundingSupports)) {
      const confidences = metadata.groundingSupports
        .map((s: any) => s.confidenceScores?.[0] ?? s.confidenceScore ?? 0)
        .filter((c: number) => c > 0);
      if (confidences.length > 0) {
        avgConfidence = confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length;
      }
    }

    return {
      sources,
      confidence: avgConfidence || (sources.length > 0 ? 0.7 : 0),
      citations,
      provider: 'vertex-ai',
      groundingType: 'web_search',
      raw: metadata,
    };
  }

  private extractAnthropicCitations(response: any): GroundingResult {
    const sources: GroundingSource[] = [];
    const citations: string[] = [];

    // Citations appear in content blocks
    const contentBlocks = response.content ?? response.choices?.[0]?.message?.content;
    if (!Array.isArray(contentBlocks)) {
      return this.emptyResult('anthropic');
    }

    for (const block of contentBlocks) {
      if (block.type === 'text' && Array.isArray(block.citations)) {
        for (const cite of block.citations) {
          citations.push(cite.cited_text ?? cite.text ?? '');

          if (cite.type === 'document' || cite.document) {
            sources.push({
              document: cite.document?.title ?? cite.document_title ?? 'Document',
              snippet: cite.cited_text ?? '',
              pageNumber: cite.start_page ?? undefined,
            });
          } else if (cite.type === 'web' || cite.url) {
            sources.push({
              url: cite.url,
              title: cite.title ?? '',
              snippet: cite.cited_text ?? '',
            });
          }
        }
      }
    }

    return {
      sources,
      confidence: sources.length > 0 ? 0.85 : 0,
      citations,
      provider: 'anthropic',
      groundingType: 'document_citations',
      raw: contentBlocks,
    };
  }

  private extractBedrockGrounding(response: any): GroundingResult {
    const sources: GroundingSource[] = [];
    const citations: string[] = [];
    let confidence = 0;

    // Guardrail trace results
    const trace = response.trace ?? response.guardrailTrace ?? response.amazon_bedrock_guardrailAction;
    if (trace) {
      // Automated Reasoning results
      const reasoning = trace.automatedReasoning ?? trace.contextualGroundingPolicy;
      if (reasoning) {
        // Each assessment has a score and action (NONE, BLOCKED, etc.)
        const assessments = reasoning.assessments ?? reasoning.filters ?? [];
        for (const assessment of assessments) {
          const score = assessment.score ?? assessment.confidenceScore ?? 0;
          confidence = Math.max(confidence, score);

          if (assessment.groundingSources) {
            for (const src of assessment.groundingSources) {
              sources.push({
                snippet: src.text ?? src.content ?? '',
                title: src.identifier ?? '',
              });
            }
          }
        }

        // Extract the action taken
        const action = reasoning.action ?? reasoning.overallAction;
        if (action) {
          citations.push(`Bedrock guardrail action: ${action}`);
        }
      }
    }

    // Also handle Bedrock Citations (for Anthropic models on Bedrock)
    if (response.citations || response.content) {
      const anthropicResult = this.extractAnthropicCitations(response);
      sources.push(...anthropicResult.sources);
      citations.push(...anthropicResult.citations);
      if (anthropicResult.confidence > confidence) {
        confidence = anthropicResult.confidence;
      }
    }

    return {
      sources,
      confidence,
      citations,
      provider: 'aws-bedrock',
      groundingType: confidence > 0 ? 'response_verification' : null,
      raw: trace,
    };
  }

  private extractAzureGrounding(response: any): GroundingResult {
    const sources: GroundingSource[] = [];
    const citations: string[] = [];

    // Azure On Your Data returns citations in the response
    const azureCitations = response.choices?.[0]?.message?.context?.citations
      ?? response.citations
      ?? [];

    for (const cite of azureCitations) {
      sources.push({
        url: cite.url ?? cite.filepath,
        title: cite.title ?? cite.filepath ?? '',
        snippet: cite.content ?? '',
      });
      if (cite.content) {
        citations.push(cite.content);
      }
    }

    // Azure also includes an intent property for query rewriting
    const intent = response.choices?.[0]?.message?.context?.intent;
    if (intent) {
      citations.push(`Query intent: ${intent}`);
    }

    return {
      sources,
      confidence: sources.length > 0 ? 0.8 : 0,
      citations,
      provider: 'azure-openai',
      groundingType: sources.length > 0 ? 'enterprise_data' : null,
      raw: azureCitations,
    };
  }

  // ==========================================================================
  // Private: Query Analysis
  // ==========================================================================

  /**
   * Analyze a query string to determine which grounding types would be useful.
   */
  private analyzeQueryGroundingNeeds(query: string): {
    webSearch: boolean;
    documentCitations: boolean;
    enterpriseData: boolean;
    verification: boolean;
  } {
    return {
      webSearch: WEB_SEARCH_PATTERNS.some(p => p.test(query)),
      documentCitations: DOCUMENT_CITATION_PATTERNS.some(p => p.test(query)),
      enterpriseData: ENTERPRISE_DATA_PATTERNS.some(p => p.test(query)),
      verification: VERIFICATION_PATTERNS.some(p => p.test(query)),
    };
  }

  // ==========================================================================
  // Private: Helpers
  // ==========================================================================

  /**
   * Normalize provider aliases to canonical keys used in the capability matrix.
   */
  private normalizeProvider(provider: string): string {
    const lower = provider.toLowerCase().trim();

    const aliases: Record<string, string> = {
      'google': 'vertex-ai',
      'vertex': 'vertex-ai',
      'vertex-ai': 'vertex-ai',
      'gemini': 'vertex-ai',
      'vertex-claude': 'vertex-ai',
      'anthropic': 'anthropic',
      'claude': 'anthropic',
      'bedrock': 'aws-bedrock',
      'aws-bedrock': 'aws-bedrock',
      'bedrock_anthropic': 'aws-bedrock',
      'azure': 'azure-openai',
      'azure-openai': 'azure-openai',
      'azure_openai': 'azure-openai',
      'openai': 'openai',
      'ollama': 'ollama',
    };

    return aliases[lower] ?? lower;
  }

  /**
   * Build provider-specific configuration for a capability, pulling from
   * environment variables where needed.
   */
  private buildCapabilityConfig(cap: ProviderCapability): Record<string, any> {
    const base: Record<string, any> = {
      feature: cap.feature,
      configKey: cap.configKey,
    };

    switch (cap.configKey) {
      case 'googleSearchRetrieval':
        base.dynamicThreshold = parseFloat(process.env.GEMINI_GROUNDING_THRESHOLD || '0.7');
        base.mode = 'MODE_DYNAMIC';
        break;

      case 'vertexAiSearch':
        base.datastoreId = process.env.VERTEX_AI_SEARCH_DATASTORE_ID;
        base.projectId = process.env.GOOGLE_CLOUD_PROJECT;
        base.location = process.env.VERTEX_AI_SEARCH_LOCATION || 'global';
        break;

      case 'citations':
        base.enabled = true;
        break;

      case 'automatedReasoning':
        base.guardrailId = process.env.BEDROCK_GROUNDING_GUARDRAIL_ID;
        base.guardrailVersion = process.env.BEDROCK_GROUNDING_GUARDRAIL_VERSION || '1';
        base.accuracy = 0.99;
        break;

      case 'contextualGrounding':
        base.guardrailId = process.env.BEDROCK_GROUNDING_GUARDRAIL_ID;
        base.guardrailVersion = process.env.BEDROCK_GROUNDING_GUARDRAIL_VERSION || '1';
        break;

      case 'novaWebGrounding':
        base.enabled = true;
        break;

      case 'bedrockCitations':
        base.enabled = true;
        break;

      case 'azureOnYourData':
        base.searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT;
        base.searchIndex = process.env.AZURE_SEARCH_INDEX;
        base.queryType = 'vector_semantic_hybrid';
        base.strictness = parseInt(process.env.AZURE_SEARCH_STRICTNESS || '3', 10);
        base.topNDocuments = parseInt(process.env.AZURE_SEARCH_TOP_N || '5', 10);
        break;

      case 'azureDataZones':
        base.dataZone = process.env.AZURE_DATA_ZONE || 'us';
        break;
    }

    return base;
  }

  private emptyResult(provider: string): GroundingResult {
    return {
      sources: [],
      confidence: 0,
      citations: [],
      provider,
      groundingType: null,
    };
  }
}

// ============================================================================
// Singleton accessor
// ============================================================================

let _instance: ProviderCapabilityService | null = null;

export function getProviderCapabilityService(): ProviderCapabilityService {
  if (!_instance) {
    _instance = ProviderCapabilityService.getInstance();
  }
  return _instance;
}
