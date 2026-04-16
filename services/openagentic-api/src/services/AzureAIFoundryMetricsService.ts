/**
 * Azure AI Foundry Metrics Service
 *
 * Collects metrics from Azure AI Foundry (Azure OpenAI) per model using Entra ID authentication.
 * Uses Azure SDK with DefaultAzureCredential for authentication (no API keys).
 */

import { DefaultAzureCredential } from '@azure/identity';
import { MetricsQueryClient, type Metric } from '@azure/monitor-query';
import type { Logger } from 'pino';
import pino from 'pino';

export interface AIFoundryModelMetrics {
  modelDeployment: string;
  resourceName: string;
  metrics: {
    // Request metrics
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    throttledRequests: number;

    // Token metrics
    totalTokens: number;
    promptTokens: number;      // Input tokens
    completionTokens: number;  // Output tokens

    // Latency metrics (in milliseconds)
    averageLatencyMs: number;
    timeToFirstByteMs: number;   // TTFB
    timeToLastByteMs: number;    // TTLB
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;

    // Time window
    timeWindowStart: Date;
    timeWindowEnd: Date;
  };
  costs?: {
    estimatedCost: number;
    currency: string;
  };
}

export interface AIFoundryMetricsConfig {
  subscriptionId: string;
  resourceGroupName: string;
  accountName: string;  // Azure OpenAI resource name
  metricsTimeRangeMinutes?: number;  // Default: 10080 (7 days)
  refreshIntervalMinutes?: number;   // Default: 5
}

export class AzureAIFoundryMetricsService {
  private logger: Logger;
  private metricsClient: MetricsQueryClient;
  private config: AIFoundryMetricsConfig;
  private credential: DefaultAzureCredential;
  private metricsCache: Map<string, AIFoundryModelMetrics> = new Map();
  private lastRefreshTime?: Date;
  private refreshInterval?: NodeJS.Timeout;

  constructor(config: AIFoundryMetricsConfig, logger?: Logger) {
    this.logger = logger || pino({ name: 'azure-aif-metrics' });
    this.config = {
      metricsTimeRangeMinutes: 10080, // 7 days by default
      refreshIntervalMinutes: 5,
      ...config
    };

    // Use DefaultAzureCredential - will use Managed Identity in Azure, or Azure CLI / VS Code locally
    this.credential = new DefaultAzureCredential();

    // Initialize Monitor query client for metrics
    this.metricsClient = new MetricsQueryClient(this.credential);

    this.logger.info({
      subscriptionId: this.config.subscriptionId,
      resourceGroup: this.config.resourceGroupName,
      account: this.config.accountName
    }, 'Azure AI Foundry Metrics Service initialized with Entra ID auth');
  }

  /**
   * Start periodic metrics collection
   */
  async startPeriodicCollection(): Promise<void> {
    // Initial collection
    await this.collectAllMetrics();

    // Schedule periodic collection
    const intervalMs = this.config.refreshIntervalMinutes! * 60 * 1000;
    this.refreshInterval = setInterval(async () => {
      try {
        await this.collectAllMetrics();
      } catch (error) {
        this.logger.error({ error }, 'Periodic metrics collection failed');
      }
    }, intervalMs);

    this.logger.info({
      intervalMinutes: this.config.refreshIntervalMinutes
    }, 'Started periodic metrics collection');
  }

  /**
   * Stop periodic collection
   */
  stopPeriodicCollection(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
      this.logger.info('Stopped periodic metrics collection');
    }
  }

  /**
   * Collect metrics for all models
   */
  async collectAllMetrics(): Promise<AIFoundryModelMetrics[]> {
    const endTime = new Date();
    const startTime = new Date();
    startTime.setMinutes(startTime.getMinutes() - this.config.metricsTimeRangeMinutes!);

    try {
      // Get resource ID for Azure OpenAI
      const resourceId = `/subscriptions/${this.config.subscriptionId}/resourceGroups/${this.config.resourceGroupName}/providers/Microsoft.CognitiveServices/accounts/${this.config.accountName}`;

      // Collect all Azure OpenAI metrics (matching Azure Portal view)
      const metricNames = [
        // Request metrics
        'Requests',                  // Total requests
        'SuccessfulCalls',           // Successful completions
        'ServerErrors',              // Server errors (5xx)
        'ClientErrors',              // Client errors (4xx)
        'RateLimitEvents',           // Throttled requests

        // Token metrics
        'ProcessedPromptTokens',     // Input/Prompt tokens
        'GeneratedTokens',           // Output/Completion tokens
        'TotalTokens',               // Total tokens (input + output)

        // Latency metrics
        'TimeToResponse',            // Time to last byte (TTLB) - full response time
        'InferenceLatency',          // Inference processing time
        'EndToEndLatency'            // End to end latency
      ];

      // Query metrics using duration (ISO 8601 format)
      const metricsResponse = await this.metricsClient.queryResource(
        resourceId,
        metricNames,
        {
          timespan: { duration: `PT${this.config.metricsTimeRangeMinutes}M` },
          granularity: 'PT1H',  // 1 hour granularity for 7 days
          aggregations: ['Total', 'Average', 'Count', 'Minimum', 'Maximum']
        }
      );

      // Process metrics by deployment (model)
      const modelMetricsMap = new Map<string, AIFoundryModelMetrics>();

      for (const metric of metricsResponse.metrics) {
        for (const timeseries of metric.timeseries) {
          // Extract deployment name from metadata
          const deploymentName = this.extractDeploymentName(timeseries.metadataValues);

          if (!deploymentName) continue;

          // Initialize metrics for this deployment
          if (!modelMetricsMap.has(deploymentName)) {
            modelMetricsMap.set(deploymentName, {
              modelDeployment: deploymentName,
              resourceName: this.config.accountName,
              metrics: {
                // Request metrics
                totalRequests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                throttledRequests: 0,

                // Token metrics
                totalTokens: 0,
                promptTokens: 0,
                completionTokens: 0,

                // Latency metrics
                averageLatencyMs: 0,
                timeToFirstByteMs: 0,
                timeToLastByteMs: 0,
                p50LatencyMs: 0,
                p95LatencyMs: 0,
                p99LatencyMs: 0,

                // Time window
                timeWindowStart: startTime,
                timeWindowEnd: endTime
              }
            });
          }

          const modelMetrics = modelMetricsMap.get(deploymentName)!;

          // Aggregate metric values
          this.aggregateMetricValues(metric.name, timeseries.data || [], modelMetrics);
        }
      }

      // Update cache
      this.metricsCache.clear();
      modelMetricsMap.forEach((metrics, deployment) => {
        this.metricsCache.set(deployment, metrics);
      });

      this.lastRefreshTime = new Date();

      const results = Array.from(modelMetricsMap.values());

      this.logger.info({
        deploymentsFound: results.length,
        deployments: results.map(m => m.modelDeployment)
      }, 'Collected metrics for all AI Foundry models');

      return results;

    } catch (error) {
      this.logger.error({ error }, 'Failed to collect Azure AI Foundry metrics');
      throw error;
    }
  }

  /**
   * Get metrics for a specific model deployment
   */
  async getModelMetrics(deploymentName: string): Promise<AIFoundryModelMetrics | null> {
    // Return cached if available
    if (this.metricsCache.has(deploymentName)) {
      return this.metricsCache.get(deploymentName)!;
    }

    // Otherwise collect fresh metrics
    await this.collectAllMetrics();
    return this.metricsCache.get(deploymentName) || null;
  }

  /**
   * Get all cached metrics
   */
  getAllCachedMetrics(): AIFoundryModelMetrics[] {
    return Array.from(this.metricsCache.values());
  }

  /**
   * Get metrics summary across all models
   */
  getMetricsSummary(): {
    totalModels: number;
    totalRequests: number;
    totalTokens: number;
    averageLatencyMs: number;
    lastRefresh?: Date;
  } {
    const allMetrics = this.getAllCachedMetrics();

    const summary = allMetrics.reduce((acc, model) => ({
      totalModels: acc.totalModels + 1,
      totalRequests: acc.totalRequests + model.metrics.totalRequests,
      totalTokens: acc.totalTokens + model.metrics.totalTokens,
      averageLatencyMs: acc.averageLatencyMs + model.metrics.averageLatencyMs
    }), {
      totalModels: 0,
      totalRequests: 0,
      totalTokens: 0,
      averageLatencyMs: 0
    });

    if (summary.totalModels > 0) {
      summary.averageLatencyMs = summary.averageLatencyMs / summary.totalModels;
    }

    return {
      ...summary,
      lastRefresh: this.lastRefreshTime
    };
  }

  /**
   * Extract deployment name from metric metadata
   */
  private extractDeploymentName(metadataValues: any[] | undefined): string | null {
    if (!metadataValues) return null;

    for (const metadata of metadataValues) {
      if (metadata.name?.value === 'DeploymentName' ||
          metadata.name?.value === 'ModelDeploymentName' ||
          metadata.name?.value === 'Deployment') {
        return metadata.value;
      }
    }

    return null;
  }

  /**
   * Aggregate metric values into model metrics
   */
  private aggregateMetricValues(
    metricName: string,
    data: any[],
    modelMetrics: AIFoundryModelMetrics
  ): void {
    let sum = 0;
    let count = 0;
    let avgSum = 0;

    for (const point of data) {
      const totalValue = point.total || 0;
      const avgValue = point.average || 0;

      if (totalValue > 0) {
        sum += totalValue;
        count++;
      }
      if (avgValue > 0) {
        avgSum += avgValue;
      }
    }

    // Map Azure metric names to our model
    switch (metricName) {
      // Request metrics
      case 'Requests':
        modelMetrics.metrics.totalRequests += sum;
        break;
      case 'SuccessfulCalls':
        modelMetrics.metrics.successfulRequests += sum;
        break;
      case 'ServerErrors':
      case 'ClientErrors':
        // Accumulate errors for failed requests
        if (!modelMetrics.metrics.failedRequests) {
          modelMetrics.metrics.failedRequests = 0;
        }
        modelMetrics.metrics.failedRequests += sum;
        break;
      case 'RateLimitEvents':
        modelMetrics.metrics.throttledRequests += sum;
        break;

      // Token metrics
      case 'ProcessedPromptTokens':
        modelMetrics.metrics.promptTokens += sum;
        break;
      case 'GeneratedTokens':
        modelMetrics.metrics.completionTokens += sum;
        break;
      case 'TotalTokens':
        modelMetrics.metrics.totalTokens += sum;
        break;

      // Latency metrics (convert to milliseconds if needed)
      case 'TimeToResponse':
        if (count > 0) {
          modelMetrics.metrics.timeToLastByteMs = avgSum / count;
        }
        break;
      case 'InferenceLatency':
        if (count > 0) {
          modelMetrics.metrics.averageLatencyMs = avgSum / count;
        }
        break;
      case 'EndToEndLatency':
        if (count > 0) {
          // Use this as an estimate for TTFB (first token latency)
          modelMetrics.metrics.timeToFirstByteMs = avgSum / count;
        }
        break;
    }

    // If total requests not set yet, calculate from successful + failed
    if (modelMetrics.metrics.totalRequests === 0) {
      modelMetrics.metrics.totalRequests =
        modelMetrics.metrics.successfulRequests + (modelMetrics.metrics.failedRequests || 0);
    }
  }
}

// Singleton instance
let metricsServiceInstance: AzureAIFoundryMetricsService | null = null;

export function initializeAIFoundryMetricsService(config: AIFoundryMetricsConfig, logger?: Logger): AzureAIFoundryMetricsService {
  if (!metricsServiceInstance) {
    metricsServiceInstance = new AzureAIFoundryMetricsService(config, logger);
  }
  return metricsServiceInstance;
}

export function getAIFoundryMetricsService(): AzureAIFoundryMetricsService | null {
  return metricsServiceInstance;
}
