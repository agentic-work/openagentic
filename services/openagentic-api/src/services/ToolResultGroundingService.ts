/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Tool Result Grounding Service
 *
 * Triggers background grounding validation after MCP tool execution.
 * This service:
 * 1. Runs in-process grounding (schema validation, anomaly detection)
 * 2. Tracks grounding metrics for observability
 * 3. Logs results for debugging and analysis
 *
 * Architecture:
 * - Fire-and-forget pattern (doesn't block user response)
 * - In-memory queue for simplicity (stateless per-pod)
 * - Local validation + pgvector storage via VerifiedToolResult model
 */

import type { Logger } from 'pino';
import { pino } from 'pino';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MAX_QUEUE_SIZE = 100;
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1000;

// =============================================================================
// TYPES
// =============================================================================

export interface GroundingRequest {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  result: unknown;
  userId: string;
  sessionId: string;
  tenantId: string;
  executionTimeMs: number;
  timestamp: number;
  retryCount: number;
}

export interface GroundingResult {
  requestId: string;
  status: 'verified' | 'anomalies_detected' | 'failed';
  schema?: {
    hasArray: boolean;
    itemCount: number;
    keyFields: string[];
  };
  anomalies?: Array<{
    type: string;
    severity: string;
    description: string;
  }>;
  hierarchy?: {
    provider: string;
    resourceType: string;
    path: string;
  };
  summary: string;
  processedAt: number;
}

export interface GroundingStats {
  queueSize: number;
  processedCount: number;
  verifiedCount: number;
  anomaliesCount: number;
  failedCount: number;
  avgProcessingTimeMs: number;
}

// =============================================================================
// SERVICE IMPLEMENTATION
// =============================================================================

export class ToolResultGroundingService {
  private logger: Logger;
  private isProcessing: boolean = false;
  private queue: GroundingRequest[] = [];
  private stats: GroundingStats = {
    queueSize: 0,
    processedCount: 0,
    verifiedCount: 0,
    anomaliesCount: 0,
    failedCount: 0,
    avgProcessingTimeMs: 0,
  };

  constructor(logger?: Logger) {
    this.logger = logger || pino({ name: 'ToolResultGroundingService' });
  }

  /**
   * Queue a tool result for background grounding
   * This is the main entry point - called after MCP tool execution
   */
  async queueForGrounding(params: {
    toolName: string;
    toolArgs: Record<string, unknown>;
    result: unknown;
    userId: string;
    sessionId: string;
    tenantId: string;
    executionTimeMs: number;
  }): Promise<string> {
    const requestId = `grnd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const request: GroundingRequest = {
      id: requestId,
      ...params,
      timestamp: Date.now(),
      retryCount: 0,
    };

    // Check queue size limit (in-memory, per-pod)
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.logger.warn({
        queueSize: this.queue.length,
        maxSize: MAX_QUEUE_SIZE,
        toolName: params.toolName,
      }, '[GROUNDING] Queue full - skipping');
      return requestId;
    }

    // Add to queue
    this.queue.push(request);
    this.stats.queueSize = this.queue.length;

    this.logger.info({
      requestId,
      toolName: params.toolName,
      queueSize: this.stats.queueSize,
    }, '[GROUNDING] Queued for background processing');

    // Trigger processing (non-blocking)
    this.processQueue().catch(err => {
      this.logger.warn({ err }, '[GROUNDING] Background processing error');
    });

    return requestId;
  }

  /**
   * Process the grounding queue
   * This runs in the background and processes requests one at a time
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        // Pop from queue (FIFO)
        const request = this.queue.shift();
        if (!request) break;

        // Process the request
        await this.processRequest(request);

        // Update queue size
        this.stats.queueSize = this.queue.length;
      }

    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single grounding request
   */
  private async processRequest(request: GroundingRequest): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.info({
        requestId: request.id,
        toolName: request.toolName,
        userId: request.userId,
        sessionId: request.sessionId,
      }, '[GROUNDING] Processing request');

      // Run local grounding validation
      const result = await this.invokeGroundingWorkflow(request);

      // Update stats
      this.stats.processedCount++;
      if (result.status === 'verified') {
        this.stats.verifiedCount++;
      } else if (result.status === 'anomalies_detected') {
        this.stats.anomaliesCount++;
      } else {
        this.stats.failedCount++;
      }

      const processingTime = Date.now() - startTime;
      this.stats.avgProcessingTimeMs = this.stats.processedCount === 1
        ? processingTime
        : (this.stats.avgProcessingTimeMs * (this.stats.processedCount - 1) + processingTime) / this.stats.processedCount;

      this.logger.info({
        requestId: request.id,
        status: result.status,
        anomalyCount: result.anomalies?.length || 0,
        processingTimeMs: processingTime,
        hierarchy: result.hierarchy,
      }, '[GROUNDING] Request processed');

    } catch (error) {
      this.logger.error({
        error,
        requestId: request.id,
        toolName: request.toolName,
        retryCount: request.retryCount,
      }, '[GROUNDING] Processing failed');

      // Retry if under limit
      if (request.retryCount < RETRY_ATTEMPTS) {
        request.retryCount++;
        // Re-add to queue with delay
        setTimeout(() => {
          this.queue.push(request);
          this.processQueue().catch(() => {});
        }, RETRY_DELAY_MS * request.retryCount);
      } else {
        this.stats.failedCount++;
      }
    }
  }

  /**
   * Invoke the grounding workflow (local, in-process)
   */
  private async invokeGroundingWorkflow(request: GroundingRequest): Promise<GroundingResult> {
    // Local grounding only — results are validated in-process
    // (schema validation, anomaly detection) and stored in pgvector
    // via the VerifiedToolResult model.
    const result = this.performLocalGrounding(request);

    // Store grounding results in pgvector (VerifiedToolResult table) for future reference
    try {
      const prisma = (await import('../utils/prisma.js')).default;
      const crypto = await import('crypto');
      const inputHash = crypto.createHash('sha256')
        .update(JSON.stringify(request.toolArgs || {}))
        .digest('hex');

      await prisma.$executeRawUnsafe(
        `INSERT INTO verified_tool_results (id, tool_name, server_id, input_hash, input_params, result, result_summary, is_verified, verification_type, quality_score, use_count, user_id, session_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, 1, $11, $12, NOW(), NOW())
         ON CONFLICT (tool_name, server_id, input_hash) DO UPDATE
         SET use_count = verified_tool_results.use_count + 1,
             last_used_at = NOW(),
             updated_at = NOW()`,
        crypto.randomUUID(),
        request.toolName,
        'mcp-proxy',
        inputHash,
        JSON.stringify(request.toolArgs || {}),
        JSON.stringify(typeof request.result === 'string' ? { text: request.result.substring(0, 10000) } : request.result),
        result.summary?.substring(0, 500) || 'Grounded via local validation',
        result.status === 'verified',
        'system',
        result.status === 'verified' ? 1.0 : 0.5,
        request.userId,      // User isolation: always associate results with originating user
        request.sessionId    // Session tracking for audit trail
      );
    } catch (storeError) {
      this.logger.debug({ error: storeError }, '[GROUNDING] pgvector storage failed (non-fatal)');
    }

    return result;
  }

  /**
   * Perform local grounding (in-process schema validation and anomaly detection)
   */
  private performLocalGrounding(request: GroundingRequest): GroundingResult {
    const result = request.result;
    const anomalies: Array<{ type: string; severity: string; description: string }> = [];

    // Basic schema inference
    let hasArray = false;
    let itemCount = 0;
    let keyFields: string[] = [];

    if (Array.isArray(result)) {
      hasArray = true;
      itemCount = result.length;
      if (result.length > 0 && typeof result[0] === 'object' && result[0] !== null) {
        keyFields = Object.keys(result[0]).slice(0, 10);
      }
    } else if (typeof result === 'object' && result !== null) {
      keyFields = Object.keys(result).slice(0, 10);
      // Check for nested arrays
      for (const key of keyFields) {
        const value = (result as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          hasArray = true;
          itemCount = value.length;
          break;
        }
      }
    }

    // Basic anomaly detection
    const resultStr = JSON.stringify(result);

    // Check for error patterns
    if (resultStr.toLowerCase().includes('error') || resultStr.toLowerCase().includes('failed')) {
      anomalies.push({
        type: 'error_detected',
        severity: 'warning',
        description: 'Result contains error indicators',
      });
    }

    // Check for unhealthy/degraded states
    if (resultStr.toLowerCase().includes('unhealthy') || resultStr.toLowerCase().includes('degraded')) {
      anomalies.push({
        type: 'unhealthy_resource',
        severity: 'high',
        description: 'Result contains unhealthy or degraded resources',
      });
    }

    // Check for empty results
    if (itemCount === 0 && hasArray) {
      anomalies.push({
        type: 'empty_result',
        severity: 'info',
        description: 'Result array is empty',
      });
    }

    // Extract hierarchy from tool name
    const hierarchy = this.extractHierarchy(request.toolName, request.toolArgs);

    return {
      requestId: request.id,
      status: anomalies.length > 0 ? 'anomalies_detected' : 'verified',
      schema: {
        hasArray,
        itemCount,
        keyFields,
      },
      anomalies: anomalies.length > 0 ? anomalies : undefined,
      hierarchy,
      summary: `Local grounding: ${hasArray ? `${itemCount} items` : 'single object'}, ${anomalies.length} anomalies`,
      processedAt: Date.now(),
    };
  }

  /**
   * Extract hierarchy from tool name and arguments
   */
  private extractHierarchy(
    toolName: string,
    toolArgs: Record<string, unknown>
  ): { provider: string; resourceType: string; path: string } | undefined {
    const lowerName = toolName.toLowerCase();

    // Azure tools
    if (lowerName.includes('azure') || lowerName.includes('arm')) {
      const subscription = toolArgs.subscriptionId as string || toolArgs.subscription as string || 'default';
      const resourceGroup = toolArgs.resourceGroup as string || toolArgs.resource_group as string || '';
      const resourceName = toolArgs.resourceName as string || toolArgs.name as string || '';

      // Extract resource type from tool name
      let resourceType = 'resource';
      if (lowerName.includes('appgw') || lowerName.includes('application_gateway')) {
        resourceType = 'appgw';
      } else if (lowerName.includes('aks') || lowerName.includes('kubernetes')) {
        resourceType = 'aks';
      } else if (lowerName.includes('vm') || lowerName.includes('virtual_machine')) {
        resourceType = 'vm';
      } else if (lowerName.includes('storage')) {
        resourceType = 'storage';
      }

      if (resourceGroup || resourceName) {
        return {
          provider: 'azure',
          resourceType,
          path: `azure/${resourceType}/${resourceGroup}/${resourceName}`.replace(/\/+$/, ''),
        };
      }
    }

    // AWS tools
    if (lowerName.includes('aws')) {
      const region = toolArgs.region as string || 'us-east-1';
      const resourceId = toolArgs.resourceId as string || toolArgs.id as string || '';

      let resourceType = 'resource';
      if (lowerName.includes('ec2')) {
        resourceType = 'ec2';
      } else if (lowerName.includes('s3')) {
        resourceType = 's3';
      } else if (lowerName.includes('lambda')) {
        resourceType = 'lambda';
      } else if (lowerName.includes('rds')) {
        resourceType = 'rds';
      }

      if (resourceId) {
        return {
          provider: 'aws',
          resourceType,
          path: `aws/${region}/${resourceType}/${resourceId}`,
        };
      }
    }

    // GCP tools
    if (lowerName.includes('gcp') || lowerName.includes('google')) {
      const project = toolArgs.project as string || toolArgs.projectId as string || '';
      const resourceName = toolArgs.resourceName as string || toolArgs.name as string || '';

      if (project || resourceName) {
        return {
          provider: 'gcp',
          resourceType: 'resource',
          path: `gcp/${project}/${resourceName}`.replace(/\/+$/, ''),
        };
      }
    }

    // K8s tools
    if (lowerName.includes('k8s') || lowerName.includes('kubernetes') || lowerName.includes('kubectl')) {
      const namespace = toolArgs.namespace as string || 'default';
      const kind = toolArgs.kind as string || 'resource';
      const name = toolArgs.name as string || '';

      if (name) {
        return {
          provider: 'kubernetes',
          resourceType: kind,
          path: `k8s/${namespace}/${kind}/${name}`,
        };
      }
    }

    return undefined;
  }

  /**
   * Get grounding statistics
   */
  getStats(): GroundingStats {
    return { ...this.stats };
  }

  /**
   * Force process the queue (for manual triggering)
   */
  async forceProcess(): Promise<void> {
    this.isProcessing = false;
    await this.processQueue();
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let serviceInstance: ToolResultGroundingService | null = null;

export function getToolResultGroundingService(logger?: Logger): ToolResultGroundingService {
  if (!serviceInstance) {
    serviceInstance = new ToolResultGroundingService(logger);
  }
  return serviceInstance;
}

/**
 * Queue a tool result for grounding (convenience function)
 * Call this after MCP tool execution completes
 */
export async function queueToolResultForGrounding(params: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  result: unknown;
  userId: string;
  sessionId: string;
  tenantId: string;
  executionTimeMs: number;
}): Promise<string> {
  const service = getToolResultGroundingService();
  return service.queueForGrounding(params);
}
