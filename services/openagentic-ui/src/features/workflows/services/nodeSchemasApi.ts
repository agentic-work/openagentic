/**
 * nodeSchemasApi — fetches the /node-schemas registry endpoint.
 *
 * Returns all migrated node schemas + the auto-generated AI Flow Builder
 * system-prompt fragment. Handles 404/500/network errors gracefully.
 */

import { getWorkflowsApiUrl, getApiUrl } from '@/utils/api';

// ---------------------------------------------------------------------------
// Types (mirror the backend NodeSchema shape — no backend import needed)
// ---------------------------------------------------------------------------

export interface NodePort {
  name: string;
  type: string;
  required?: boolean;
  shape?: Record<string, string>;
}

export interface NodeSetting {
  name: string;
  label?: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'object' | 'code' | 'secret_ref';
  required?: boolean;
  values?: string[];
  default?: unknown;
  placeholder?: string;
  supportsTemplating?: boolean;
  min?: number;
  max?: number;
  validation?: {
    pattern?: string;
    errorMessage?: string;
  };
}

export interface NodeAiHints {
  shortDescription: string;
  whenToUse: string;
  examplePrompt?: string;
  promptHints?: string;
}

export interface NodeOutputAssertion {
  name: string;
  expression: string;
  errorMessage: string;
}

export interface RegistryNodeSchema {
  type: string;
  category: string;
  label: string;
  description: string;
  icon?: string;
  ports?: {
    inputs?: NodePort[];
    outputs?: NodePort[];
  };
  settings?: NodeSetting[];
  ai?: NodeAiHints;
  outputAssertions?: NodeOutputAssertion[];
}

export interface NodeSchemasResponse {
  schemas: RegistryNodeSchema[];
  aiPromptFragment: string;
}

// ---------------------------------------------------------------------------
// URL resolution — prefer workflows service URL if configured, fall back to
// the main API proxy (which routes through ingress to the workflows service)
// ---------------------------------------------------------------------------

function buildNodeSchemasUrl(): string {
  const workflowsUrl = getWorkflowsApiUrl();

  // If the workflows service URL is configured (non-localhost), use it directly.
  if (workflowsUrl && !workflowsUrl.includes('localhost')) {
    return `${workflowsUrl}/node-schemas`;
  }

  // Fall back to the main API proxy — ingress routes /api/workflows/* to
  // the openagentic-workflows service. getApiUrl() may return '/api' in
  // production (where the runtime config sets it that way) or '' for
  // relative URLs in dev. Strip a trailing /api to avoid the double
  // /api/api/workflows/internal prefix that 404s in prod (caught by
  // Playwright walk 2026-04-26).
  const apiBase = getApiUrl();
  const trimmed = apiBase.replace(/\/api$/, '');
  return `${trimmed}/api/workflows/internal/node-schemas`;
}

// ---------------------------------------------------------------------------
// API object (single exported singleton)
// ---------------------------------------------------------------------------

const EMPTY: NodeSchemasResponse = { schemas: [], aiPromptFragment: '' };

export const nodeSchemasApi = {
  /**
   * Fetch all migrated node schemas and the AI prompt fragment from the
   * workflow service registry endpoint.
   *
   * Never throws — returns an empty response and logs a warning on any failure
   * so the palette degrades gracefully to the legacy nodeConfigs fallback.
   */
  async fetchSchemas(): Promise<NodeSchemasResponse> {
    const url = buildNodeSchemasUrl();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        console.warn(
          `[nodeSchemasApi] GET ${url} → ${response.status} ${response.statusText}`,
        );
        return EMPTY;
      }
      const data = await response.json();
      return {
        schemas: Array.isArray(data.schemas) ? data.schemas : [],
        aiPromptFragment: typeof data.aiPromptFragment === 'string' ? data.aiPromptFragment : '',
      };
    } catch (err) {
      console.warn('[nodeSchemasApi] Failed to fetch node schemas:', err);
      return EMPTY;
    }
  },
};
