/**
 * Workflow API Service
 * Handles all workflow-related API calls
 * Routes to OpenAgenticflows microservice
 */

import { workflowEndpoint } from '@/utils/api';
import type { Workflow, WorkflowDefinition } from '../types/workflow.types';

export interface CreateWorkflowRequest {
  name: string;
  description?: string;
  definition: {
    nodes: any[];
    edges: any[];
  };
  tags?: string[];
  category?: string;
  is_template?: boolean;
  status?: 'draft' | 'active' | 'paused' | 'archived';
  is_public?: boolean;
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  definition?: {
    nodes: any[];
    edges: any[];
  };
  tags?: string[];
  category?: string;
  status?: 'draft' | 'active' | 'paused' | 'archived';
  is_public?: boolean;
  visibility?: 'private' | 'team' | 'public';
  group_id?: string;
}

export interface ExecuteWorkflowRequest {
  input?: Record<string, any>;
}

export interface WorkflowExecution {
  id: string;
  workflow_id?: string;
  user_id?: string;
  status: 'running' | 'completed' | 'failed' | 'completed_with_errors';
  trigger_type?: string;
  total_nodes?: number;
  completed_nodes?: number;
  execution_time_ms?: number;
  input?: Record<string, any>;
  output?: Record<string, any>;
  node_outputs?: Record<string, { status: string; output?: any; input?: any; error?: string; duration?: number; nodeType?: string }>;
  cost?: number;
  error?: string;
  created_at: string;
  completed_at?: string;
  started_at?: string;
}

/**
 * Strip ReactFlow internal properties and execution state from nodes/edges
 * to prevent "cyclic object value" errors during JSON.stringify.
 */
function sanitizeDefinition(def?: { nodes: any[]; edges: any[] }) {
  if (!def) return def;
  const nodes = Array.isArray(def.nodes) ? def.nodes : [];
  const edges = Array.isArray(def.edges) ? def.edges : [];
  return {
    nodes: nodes.map((node: any) => {
      const { positionAbsolute, dragging, width, height, resizing, selected, measured, ...clean } = node;
      if (clean.data) {
        const { executionState, executionOutput, executionTimeMs, executionError, ...cleanData } = clean.data;
        clean.data = cleanData;
      }
      return clean;
    }),
    edges: edges.map((edge: any) => {
      const { selected, ...clean } = edge;
      return clean;
    }),
  };
}

export class WorkflowApiService {
  private getAuthHeaders: () => Record<string, string>;

  constructor(getAuthHeaders: () => Record<string, string>) {
    this.getAuthHeaders = getAuthHeaders;
  }

  /**
   * List all workflows for current user
   */
  async listWorkflows(): Promise<Workflow[]> {
    const response = await fetch(workflowEndpoint('/workflows'), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to list workflows' }));
      throw new Error(error.error || error.message || 'Failed to list workflows');
    }

    const data = await response.json();
    // Ensure we always return an array, even if API returns unexpected format
    return Array.isArray(data.workflows) ? data.workflows : [];
  }

  /**
   * Get workflow by ID
   */
  async getWorkflow(id: string): Promise<Workflow> {
    const response = await fetch(workflowEndpoint(`/workflows/${id}`), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get workflow');
    }

    const data = await response.json();
    return data.workflow;
  }

  /**
   * Create new workflow
   */
  async createWorkflow(workflow: CreateWorkflowRequest): Promise<Workflow> {
    const sanitized = { ...workflow, definition: sanitizeDefinition(workflow.definition) };
    const response = await fetch(workflowEndpoint('/workflows'), {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sanitized),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create workflow');
    }

    const data = await response.json();
    return data.workflow;
  }

  /**
   * Update existing workflow
   */
  async updateWorkflow(id: string, updates: UpdateWorkflowRequest): Promise<Workflow> {
    const sanitized = updates.definition
      ? { ...updates, definition: sanitizeDefinition(updates.definition) }
      : updates;
    const response = await fetch(workflowEndpoint(`/workflows/${id}`), {
      method: 'PUT',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sanitized),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update workflow');
    }

    const data = await response.json();
    return data.workflow;
  }

  /**
   * Delete workflow
   */
  async deleteWorkflow(id: string): Promise<void> {
    const response = await fetch(workflowEndpoint(`/workflows/${id}`), {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete workflow');
    }
  }

  /**
   * Execute workflow (with SSE streaming via EventSource)
   *
   * Uses async mode: POST returns { executionId } immediately,
   * then EventSource subscribes to GET /executions/:id/stream for real-time updates.
   * This avoids proxy buffering issues with POST response body streaming.
   */
  async executeWorkflow(
    id: string,
    input?: Record<string, any>,
    onProgress?: (event: { type: string; data: any }) => void
  ): Promise<void> {
    const url = workflowEndpoint(`/workflows/${id}/execute?async=true`);
    console.log(`[WorkflowAPI] POST ${url} (async mode)`, { input: input || {} });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: input || {} }),
    });

    console.log(`[WorkflowAPI] Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const error = await response.json();
      console.error('[WorkflowAPI] Execute failed:', JSON.stringify(error, null, 2));
      const details = error.errors?.map((e: any) => `[${e.code}] ${e.message} (node: ${e.nodeId || 'n/a'})`).join('; ') || '';
      throw new Error(details || error.error || 'Failed to execute workflow');
    }

    const { executionId } = await response.json();
    console.log(`[WorkflowAPI] Execution started: ${executionId}`);

    if (!onProgress || !executionId) return;

    // Subscribe to real-time events via EventSource (GET endpoint)
    return new Promise<void>((resolve) => {
      let resolved = false;
      const streamUrl = workflowEndpoint(`/workflows/executions/${executionId}/stream`);
      console.log(`[WorkflowAPI] Opening EventSource: ${streamUrl}`);
      const eventSource = new EventSource(streamUrl);

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          eventSource.close();
          resolve();
        }
      };

      const handleEvent = (eventType: string, data: any) => {
        onProgress!({ type: eventType, data });
        if (eventType === 'execution_complete' || eventType === 'execution_error') {
          cleanup();
        }
      };

      // Named event handlers for each execution event type
      for (const eventType of [
        'execution_start', 'node_start', 'node_complete', 'node_error',
        'execution_complete', 'execution_error', 'execution_paused',
      ]) {
        eventSource.addEventListener(eventType, (evt: any) => {
          try {
            const data = JSON.parse(evt.data);
            handleEvent(eventType, data);
          } catch { /* skip malformed */ }
        });
      }

      // Fallback for unnamed events
      eventSource.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          handleEvent(data.type || 'unknown', data);
        } catch { /* skip */ }
      };

      eventSource.onerror = () => {
        console.warn('[WorkflowAPI] EventSource error/closed');
        cleanup();
      };

      // Safety timeout: 5 minutes
      setTimeout(cleanup, 300000);
    });
  }

  /**
   * Test workflow without saving to database
   */
  async testWorkflow(
    definition: WorkflowDefinition,
    input?: Record<string, any>,
    onProgress?: (event: { type: string; data: any }) => void
  ): Promise<void> {
    const url = workflowEndpoint('/workflows/test');
    console.log(`[WorkflowAPI] POST ${url}`, { nodes: definition.nodes?.length, edges: definition.edges?.length, input });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nodes: definition.nodes,
        edges: definition.edges,
        input: input || {},
      }),
    });

    console.log(`[WorkflowAPI] Test response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const error = await response.json();
      console.error('[WorkflowAPI] Test failed:', JSON.stringify(error, null, 2));
      const details = error.errors?.map((e: any) => `[${e.code}] ${e.message} (node: ${e.nodeId || 'n/a'})`).join('; ') || '';
      throw new Error(details || error.error || 'Failed to test workflow');
    }

    // Handle SSE streaming — buffer partial lines across chunks
    if (onProgress && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          const lines = event.split('\n');
          let eventType = '';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventType = line.substring(6).trim();
            else if (line.startsWith('data:')) dataStr = line.substring(5).trim();
          }
          if (eventType && dataStr) {
            try {
              const data = JSON.parse(dataStr);
              onProgress({ type: eventType, data });
            } catch (parseErr) {
              console.warn('[WorkflowAPI] SSE parse error:', (parseErr as Error).message?.slice(0, 100), 'data length:', dataStr.length);
            }
          }
        }
      }
    }
  }

  /**
   * Get workflow execution history
   */
  async getExecutions(workflowId: string): Promise<WorkflowExecution[]> {
    const response = await fetch(workflowEndpoint(`/workflows/${workflowId}/executions`), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get executions');
    }

    const data = await response.json();
    return data.executions;
  }

  /**
   * Update workflow visibility (private/team/public)
   */
  async updateVisibility(id: string, visibility: 'private' | 'team' | 'public'): Promise<Workflow> {
    return this.updateWorkflow(id, { visibility });
  }

  /**
   * Duplicate workflow
   */
  async duplicateWorkflow(id: string): Promise<Workflow> {
    const original = await this.getWorkflow(id);
    return this.createWorkflow({
      name: `${original.name} (Copy)`,
      description: original.description,
      definition: {
        nodes: original.nodes || [],
        edges: original.edges || [],
      },
      status: 'draft',
      is_public: false,
    });
  }

  // =========================================================================
  // Execution Detail
  // =========================================================================

  async getExecutionDetail(workflowId: string, execId: string): Promise<{
    execution: any;
    logs: any[];
    nodeSummary: Record<string, any>;
  }> {
    const response = await fetch(workflowEndpoint(`/workflows/${workflowId}/executions/${execId}`), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to get execution detail' }));
      throw new Error(error.error || 'Failed to get execution detail');
    }
    return response.json();
  }

  // =========================================================================
  // Sharing
  // =========================================================================

  async getShares(workflowId: string): Promise<{ shares: WorkflowShare[]; owner: string }> {
    const response = await fetch(workflowEndpoint(`/workflows/${workflowId}/shares`), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to get shares' }));
      throw new Error(error.error || 'Failed to get shares');
    }
    return response.json();
  }

  async addShare(workflowId: string, share: { share_type: 'user' | 'group'; target_id: string; role: string }): Promise<any> {
    const response = await fetch(workflowEndpoint(`/workflows/${workflowId}/shares`), {
      method: 'POST',
      headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(share),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to add share' }));
      throw new Error(error.error || 'Failed to add share');
    }
    return response.json();
  }

  async updateShare(workflowId: string, shareId: string, role: string): Promise<any> {
    const response = await fetch(workflowEndpoint(`/workflows/${workflowId}/shares/${shareId}`), {
      method: 'PUT',
      headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update share' }));
      throw new Error(error.error || 'Failed to update share');
    }
    return response.json();
  }

  async removeShare(workflowId: string, shareId: string): Promise<void> {
    const response = await fetch(workflowEndpoint(`/workflows/${workflowId}/shares/${shareId}`), {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to remove share' }));
      throw new Error(error.error || 'Failed to remove share');
    }
  }

  // =========================================================================
  // API Keys (self-service)
  // =========================================================================

  async listApiKeys(): Promise<any[]> {
    const response = await fetch(workflowEndpoint('/workflows/user/api-keys'), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.keys || [];
  }

  async createApiKey(name: string): Promise<{ key: any; warning: string }> {
    const response = await fetch(workflowEndpoint('/workflows/user/api-keys'), {
      method: 'POST',
      headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create API key' }));
      throw new Error(error.error || 'Failed to create API key');
    }
    return response.json();
  }

  async revokeApiKey(keyId: string): Promise<void> {
    const response = await fetch(workflowEndpoint(`/workflows/user/api-keys/${keyId}`), {
      method: 'DELETE',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to revoke API key' }));
      throw new Error(error.error || 'Failed to revoke API key');
    }
  }

  // =========================================================================
  // User Groups
  // =========================================================================

  async getUserGroups(): Promise<any[]> {
    const response = await fetch(workflowEndpoint('/workflows/user/groups'), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.groups || [];
  }

  /**
   * List public workflow templates (starter flows + marketplace)
   */
  async listTemplates(): Promise<Workflow[]> {
    const response = await fetch(workflowEndpoint('/workflows/templates'), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.templates) ? data.templates : [];
  }

  /**
   * Test a single node in isolation (no full workflow execution)
   */
  async testNode(
    nodeDefinition: { type: string; data: Record<string, any> },
    input?: Record<string, any>,
  ): Promise<{ output: any; duration: number; error?: string }> {
    const url = workflowEndpoint('/workflows/test-node');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ node: nodeDefinition, input: input || {} }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to test node' }));
      throw new Error(error.error || 'Failed to test node');
    }

    return response.json();
  }

  /**
   * Dry-run / pre-flight check: compile + validate without executing
   */
  async dryRunWorkflow(workflowId: string): Promise<{
    valid: boolean;
    nodeChecks: Record<string, { ready: boolean; errors: string[]; warnings: string[] }>;
    compilation: { valid: boolean; errors: any[] };
  }> {
    const url = workflowEndpoint(`/workflows/${workflowId}/execute?dryRun=true`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: {} }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Dry run failed' }));
      throw new Error(error.error || 'Dry run failed');
    }

    return response.json();
  }

  /**
   * Validate workflow runtime readiness
   * Checks all node dependencies: secrets, models, MCP tools, URLs, etc.
   */
  async validateWorkflow(workflowId: string): Promise<{
    ready: boolean;
    compilation: { valid: boolean; errors: any[]; warnings: any[]; metadata?: any };
    runtime: { ready: boolean; issues: any[] };
  }> {
    const response = await fetch(workflowEndpoint(`/workflows/${workflowId}/validate`), {
      method: 'POST',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Validation request failed');
    return response.json();
  }

  // =========================================================================
  // Version Management (Phase 15)
  // =========================================================================

  /**
   * List all versions for a workflow
   */
  async getVersions(workflowId: string): Promise<any[]> {
    const response = await fetch(workflowEndpoint(`/workflows/${workflowId}/versions`), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to load versions' }));
      throw new Error(error.error || 'Failed to load versions');
    }
    const data = await response.json();
    return data.versions || [];
  }

  /**
   * Restore a specific version
   */
  async restoreVersion(workflowId: string, versionId: string): Promise<void> {
    const response = await fetch(workflowEndpoint(`/workflows/${workflowId}/versions/${versionId}/restore`), {
      method: 'POST',
      headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to restore version' }));
      throw new Error(error.error || 'Failed to restore version');
    }
  }

  // =========================================================================
  // Admin Workflow Settings (Phase 15)
  // =========================================================================

  /**
   * Get admin-level workflow settings
   */
  async getAdminWorkflowSettings(): Promise<any> {
    const response = await fetch(workflowEndpoint('/admin/workflow-settings'), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to load admin workflow settings' }));
      throw new Error(error.error || 'Failed to load admin workflow settings');
    }
    const data = await response.json();
    return data.settings || {};
  }

  /**
   * Save admin-level workflow settings
   */
  async saveAdminWorkflowSettings(settings: any): Promise<void> {
    const response = await fetch(workflowEndpoint('/admin/workflow-settings'), {
      method: 'PUT',
      headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to save admin workflow settings' }));
      throw new Error(error.error || 'Failed to save admin workflow settings');
    }
  }

  /**
   * Seed built-in templates to database
   */
  async seedTemplates(): Promise<{ created: number; skipped: number; errors: number }> {
    const response = await fetch(workflowEndpoint('/workflows/seed-templates'), {
      method: 'POST',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Failed to seed templates');
    return response.json();
  }

  /**
   * Get recent executions for the current user across all workflows
   */
  async getUserExecutions(limit = 10): Promise<any[]> {
    const response = await fetch(workflowEndpoint(`/workflows/executions/mine?limit=${limit}`), {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.executions || [];
  }
}

// =========================================================================
// Types
// =========================================================================

export interface WorkflowShare {
  id: string;
  workflow_id: string;
  share_type: 'user' | 'group';
  target_id: string;
  role: string;
  shared_by: string;
  created_at: string;
}
