/**
 * Intent Linking Service
 *
 * Provides cross-collection intent linking to connect:
 * - Tool success patterns → Tool selection boosting
 * - Tool success patterns → Prompt template routing
 * - Prompt templates → Tool predictions
 *
 * This creates a feedback loop where past successful tool executions
 * inform future tool and prompt selections, improving relevance over time.
 */

import { loggers } from '../utils/logger.js';
import { getToolSuccessTrackingService, type ToolSuccessSearchResult } from './ToolSuccessTrackingService.js';

const serviceLogger = loggers.services.child({ service: 'intent-linking' });

/**
 * Intent analysis result combining tags from multiple sources
 */
export interface IntentAnalysis {
  cloudProviders: string[];    // aws, azure, gcp, kubernetes
  actions: string[];           // list, create, delete, update, etc.
  resourceTypes: string[];     // compute, storage, database, etc.
  domains: string[];           // devops, security, networking, etc.
  confidence: number;          // 0-1 confidence in intent detection
  rawTags: string[];           // All detected tags
}

/**
 * Cross-collection link result
 */
export interface IntentLink {
  toolName: string;
  serverName: string;
  successScore: number;
  similarity: number;
  intentMatch: number;        // How well intents match (0-1)
  combinedScore: number;      // Weighted combination of scores
}

/**
 * Tool-template compatibility
 */
export interface ToolTemplateLink {
  templateName: string;
  compatibleTools: string[];
  intentOverlap: number;      // How much intent overlap with tools
}

/**
 * Intent Linking Service
 * Connects intents across Milvus collections for improved routing
 */
export class IntentLinkingService {
  private static instance: IntentLinkingService | null = null;
  private _isInitialized: boolean = false;

  // Intent pattern matchers
  private readonly cloudPatterns: Record<string, string[]> = {
    'aws': ['aws', 'amazon', 's3', 'ec2', 'lambda', 'iam', 'dynamodb', 'rds', 'eks', 'cloudwatch', 'bedrock', 'sagemaker'],
    'azure': ['azure', 'microsoft', 'subscription', 'resource group', 'aks', 'blob', 'cosmos', 'entra', 'ad', 'active directory'],
    'gcp': ['gcp', 'google cloud', 'gke', 'bigquery', 'cloud run', 'vertex', 'compute engine', 'cloud storage'],
    'kubernetes': ['kubernetes', 'k8s', 'kubectl', 'pod', 'deployment', 'service', 'namespace', 'helm', 'container']
  };

  private readonly actionPatterns: Record<string, string[]> = {
    'list': ['list', 'show', 'get all', 'display', 'enumerate', 'fetch'],
    'create': ['create', 'make', 'new', 'add', 'provision', 'deploy', 'launch'],
    'delete': ['delete', 'remove', 'destroy', 'terminate', 'drop'],
    'update': ['update', 'modify', 'change', 'edit', 'patch', 'alter'],
    'describe': ['describe', 'details', 'info', 'information about', 'status'],
    'search': ['search', 'find', 'look for', 'query', 'browse', 'locate'],
    'analyze': ['analyze', 'audit', 'check', 'review', 'assess', 'evaluate', 'inspect']
  };

  private readonly resourcePatterns: Record<string, string[]> = {
    'compute': ['vm', 'virtual machine', 'instance', 'server', 'container', 'function'],
    'storage': ['storage', 'bucket', 'blob', 'disk', 'volume', 'file'],
    'database': ['database', 'db', 'sql', 'nosql', 'table', 'cosmos', 'dynamo'],
    'network': ['network', 'vpc', 'subnet', 'firewall', 'load balancer', 'dns', 'vnet'],
    'identity': ['user', 'role', 'permission', 'policy', 'identity', 'iam', 'rbac'],
    'monitoring': ['log', 'metric', 'alert', 'monitor', 'trace', 'insight']
  };

  private readonly domainPatterns: Record<string, string[]> = {
    'devops': ['deploy', 'ci', 'cd', 'pipeline', 'build', 'release', 'gitops'],
    'security': ['security', 'credential', 'secret', 'key', 'certificate', 'encryption'],
    'cost': ['cost', 'billing', 'spend', 'budget', 'pricing', 'expense'],
    'performance': ['performance', 'latency', 'throughput', 'optimization', 'scaling']
  };

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): IntentLinkingService {
    if (!IntentLinkingService.instance) {
      IntentLinkingService.instance = new IntentLinkingService();
    }
    return IntentLinkingService.instance;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) return;

    serviceLogger.info('[IntentLinking] Initializing service...');

    // Ensure dependent services are available
    try {
      const tracker = getToolSuccessTrackingService();
      if (!tracker.isInitialized) {
        await tracker.initialize();
      }
    } catch (error) {
      serviceLogger.warn({ error }, '[IntentLinking] Tool success tracking not available');
    }

    this._isInitialized = true;
    serviceLogger.info('[IntentLinking] Service initialized');
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Analyze query to extract structured intents
   */
  analyzeIntent(query: string): IntentAnalysis {
    const queryLower = query.toLowerCase();

    const cloudProviders = this.matchPatterns(queryLower, this.cloudPatterns);
    const actions = this.matchPatterns(queryLower, this.actionPatterns);
    const resourceTypes = this.matchPatterns(queryLower, this.resourcePatterns);
    const domains = this.matchPatterns(queryLower, this.domainPatterns);

    const rawTags = [...cloudProviders, ...actions, ...resourceTypes, ...domains];

    // Calculate confidence based on how many patterns matched
    const totalPatterns = Object.keys(this.cloudPatterns).length +
                          Object.keys(this.actionPatterns).length +
                          Object.keys(this.resourcePatterns).length +
                          Object.keys(this.domainPatterns).length;

    const matchedPatterns = rawTags.length;
    const confidence = Math.min(1, matchedPatterns / 4); // Expect ~4 matches for high confidence

    return {
      cloudProviders,
      actions,
      resourceTypes,
      domains,
      confidence,
      rawTags
    };
  }

  /**
   * Match query against pattern dictionary
   */
  private matchPatterns(query: string, patterns: Record<string, string[]>): string[] {
    const matches: string[] = [];

    for (const [category, keywords] of Object.entries(patterns)) {
      if (keywords.some(kw => query.includes(kw))) {
        matches.push(category);
      }
    }

    return matches;
  }

  /**
   * Get intent-boosted tool recommendations
   * Combines semantic search with intent-based success patterns
   */
  async getIntentLinkedTools(
    query: string,
    userId: string,
    limit: number = 10
  ): Promise<IntentLink[]> {
    try {
      // Analyze query intent
      const intent = this.analyzeIntent(query);

      // Search tool success patterns
      const tracker = getToolSuccessTrackingService();
      const successPatterns = await tracker.searchSuccessfulTools({
        query,
        userId,
        limit: limit * 2, // Get more to filter
        minScore: 0.5,
        includeAllUsers: false
      });

      if (successPatterns.length === 0) {
        serviceLogger.debug('[IntentLinking] No success patterns found');
        return [];
      }

      // Calculate intent match scores
      const linkedTools: IntentLink[] = successPatterns.map(pattern => {
        const intentMatch = this.calculateIntentMatch(intent.rawTags, pattern.intentTags);

        // Combined score weights: 40% success, 30% similarity, 30% intent match
        const combinedScore = (
          pattern.successScore * 0.4 +
          pattern.similarity * 0.3 +
          intentMatch * 0.3
        );

        return {
          toolName: pattern.toolName,
          serverName: pattern.serverName,
          successScore: pattern.successScore,
          similarity: pattern.similarity,
          intentMatch,
          combinedScore
        };
      });

      // Sort by combined score and return top results
      return linkedTools
        .sort((a, b) => b.combinedScore - a.combinedScore)
        .slice(0, limit);

    } catch (error) {
      serviceLogger.error({ error }, '[IntentLinking] Failed to get linked tools');
      return [];
    }
  }

  /**
   * Calculate how well two sets of intent tags match
   */
  private calculateIntentMatch(queryTags: string[], patternTags: string[]): number {
    if (queryTags.length === 0 || patternTags.length === 0) {
      return 0;
    }

    const intersection = queryTags.filter(tag => patternTags.includes(tag));
    const union = [...new Set([...queryTags, ...patternTags])];

    // Jaccard similarity
    return intersection.length / union.length;
  }

  /**
   * Get tool names to boost in semantic search based on past success
   */
  async getToolBoostList(
    query: string,
    userId: string,
    maxTools: number = 5
  ): Promise<string[]> {
    const linkedTools = await this.getIntentLinkedTools(query, userId, maxTools);

    return linkedTools
      .filter(t => t.combinedScore > 0.5)
      .map(t => t.toolName);
  }

  /**
   * Link prompt template to predicted tools
   * Helps select prompts that work well with tools needed for the query
   */
  async linkTemplateToTools(
    templateName: string,
    templateDescription: string,
    query: string,
    userId: string
  ): Promise<ToolTemplateLink> {
    // Get predicted tools for this query
    const linkedTools = await this.getIntentLinkedTools(query, userId, 5);

    // Analyze template intent
    const templateIntent = this.analyzeIntent(templateDescription);

    // Calculate overlap between template intent and tool intents
    let totalOverlap = 0;
    const compatibleTools: string[] = [];

    for (const tool of linkedTools) {
      const toolIntent = this.analyzeIntent(tool.toolName);
      const overlap = this.calculateIntentMatch(templateIntent.rawTags, toolIntent.rawTags);

      if (overlap > 0.2) {
        compatibleTools.push(tool.toolName);
        totalOverlap += overlap;
      }
    }

    return {
      templateName,
      compatibleTools,
      intentOverlap: linkedTools.length > 0 ? totalOverlap / linkedTools.length : 0
    };
  }

  /**
   * Get statistics about intent patterns
   */
  async getIntentStats(userId: string): Promise<{
    topCloudProviders: { provider: string; count: number }[];
    topActions: { action: string; count: number }[];
    topResources: { resource: string; count: number }[];
  }> {
    try {
      const tracker = getToolSuccessTrackingService();
      const patterns = await tracker.getUserToolPatterns(userId, 100);

      // Aggregate intent tags
      const cloudCounts = new Map<string, number>();
      const actionCounts = new Map<string, number>();
      const resourceCounts = new Map<string, number>();

      for (const pattern of patterns) {
        for (const tag of pattern.topIntentTags) {
          if (Object.keys(this.cloudPatterns).includes(tag)) {
            cloudCounts.set(tag, (cloudCounts.get(tag) || 0) + pattern.usageCount);
          } else if (Object.keys(this.actionPatterns).includes(tag)) {
            actionCounts.set(tag, (actionCounts.get(tag) || 0) + pattern.usageCount);
          } else if (Object.keys(this.resourcePatterns).includes(tag)) {
            resourceCounts.set(tag, (resourceCounts.get(tag) || 0) + pattern.usageCount);
          }
        }
      }

      const sortByCount = (map: Map<string, number>) =>
        Array.from(map.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([key, count]) => ({ provider: key, action: key, resource: key, count }));

      return {
        topCloudProviders: sortByCount(cloudCounts).map(x => ({ provider: x.provider, count: x.count })),
        topActions: sortByCount(actionCounts).map(x => ({ action: x.action, count: x.count })),
        topResources: sortByCount(resourceCounts).map(x => ({ resource: x.resource, count: x.count }))
      };
    } catch (error) {
      serviceLogger.error({ error }, '[IntentLinking] Failed to get intent stats');
      return {
        topCloudProviders: [],
        topActions: [],
        topResources: []
      };
    }
  }
}

// Export singleton getter
export function getIntentLinkingService(): IntentLinkingService {
  return IntentLinkingService.getInstance();
}
