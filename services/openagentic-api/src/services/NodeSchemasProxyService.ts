/**
 * NodeSchemasProxyService
 *
 * Proxies GET /node-schemas from the openagentic-workflows service and caches
 * the result in-memory for 60 seconds (the registry is static after service boot).
 *
 * Fail-open: if WORKFLOW_SERVICE_URL is unset OR the forward request fails,
 * returns an empty registry { schemas: [], aiPromptFragment: '' } rather than
 * propagating an error to the caller.
 */

import axios from 'axios';
import { loggers } from '../utils/logger.js';
import { getInternalKey } from '../utils/internalKeyReader.js';

const logger = loggers.services;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeSchemasPayload {
  schemas: unknown[];
  aiPromptFragment: string;
}

const EMPTY_REGISTRY: NodeSchemasPayload = {
  schemas: [],
  aiPromptFragment: '',
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  payload: NodeSchemasPayload;
  fetchedAt: number; // Date.now() ms
}

const CACHE_TTL_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class NodeSchemasProxyService {
  private cache: CacheEntry | null = null;

  /**
   * Returns the node-schemas payload, either from cache or by forwarding to
   * the workflows-service. Falls back to the empty registry on any error.
   */
  async getNodeSchemas(): Promise<NodeSchemasPayload> {
    // Return cached value if still fresh
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.payload;
    }

    const workflowServiceUrl = process.env.WORKFLOW_SERVICE_URL;

    // No service URL configured — return empty registry immediately
    if (!workflowServiceUrl) {
      return { ...EMPTY_REGISTRY };
    }

    try {
      const url = `${workflowServiceUrl}/node-schemas`;
      const internalKey = getInternalKey();
      const response = await axios.get<NodeSchemasPayload>(url, {
        timeout: 5_000,
        headers: internalKey ? { Authorization: `Bearer ${internalKey}` } : undefined,
      });

      const data = response.data;

      // Validate shape — guard against null / unexpected bodies
      if (!data || typeof data !== 'object' || !Array.isArray(data.schemas)) {
        logger.warn({ url }, '[NodeSchemasProxy] Malformed response from workflows-service; using empty registry');
        return { ...EMPTY_REGISTRY };
      }

      const payload: NodeSchemasPayload = {
        schemas: data.schemas,
        aiPromptFragment: typeof data.aiPromptFragment === 'string' ? data.aiPromptFragment : '',
      };

      // Store in cache
      this.cache = { payload, fetchedAt: Date.now() };
      logger.info({ url, count: payload.schemas.length }, '[NodeSchemasProxy] Fetched node schemas from workflows-service');

      return payload;
    } catch (err: unknown) {
      const error = err as Error & { code?: string; response?: { status: number } };
      logger.warn(
        {
          url: `${workflowServiceUrl}/node-schemas`,
          code: error.code,
          status: error.response?.status,
          message: error.message,
        },
        '[NodeSchemasProxy] Failed to fetch node schemas from workflows-service; falling back to empty registry',
      );
      return { ...EMPTY_REGISTRY };
    }
  }

  /** Invalidate the in-memory cache. Useful for testing and admin triggers. */
  invalidateCache(): void {
    this.cache = null;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

let _instance: NodeSchemasProxyService | null = null;

export function getNodeSchemasProxyService(): NodeSchemasProxyService {
  if (!_instance) {
    _instance = new NodeSchemasProxyService();
  }
  return _instance;
}
