/**
 * Shared request / param / query interfaces for the workflow routes.
 *
 * Extracted verbatim from the former monolithic routes/workflows.ts during the
 * per-domain decomposition. Behaviour-preserving: these are the exact shapes
 * the handlers destructured before — `any` value-bags were narrowed to typed
 * (`unknown` / structural) equivalents that compile identically at runtime.
 */

import type { UserPayload } from '../../types/index.js';

/**
 * `request.user` as the workflow handlers read it. The base augmentation types
 * `request.user` as `UserPayload | undefined`; several handlers additionally
 * read a `tenantId` claim the tenant-context middleware may stamp on the user,
 * so we widen with one optional field. Runtime-identical to the old
 * `(request as any).user` reads.
 */
export interface RequestUser extends UserPayload {
  tenantId?: string | null;
}

/** A single ReactFlow-style node in a workflow definition (opaque JSON bag). */
export interface FlowNodeData {
  type?: string;
  config?: Record<string, unknown>;
  label?: string;
  [key: string]: unknown;
}

export interface FlowNode {
  id?: string;
  type?: string;
  position?: { x?: number; y?: number };
  data?: FlowNodeData;
  [key: string]: unknown;
}

export interface FlowEdge {
  id?: string;
  source?: string;
  target?: string;
  [key: string]: unknown;
}

export interface FlowDefinition {
  nodes?: FlowNode[];
  edges?: FlowEdge[];
  [key: string]: unknown;
}

// Request interfaces ---------------------------------------------------------

export interface CreateWorkflowRequest {
  name: string;
  description?: string;
  definition: FlowDefinition;
  triggers?: unknown[];
  settings?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  tags?: string[];
  category?: string;
  icon?: string;
  color?: string;
  is_template?: boolean;
  is_public?: boolean;
  group_id?: string;
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  definition?: FlowDefinition;
  triggers?: unknown[];
  settings?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  tags?: string[];
  category?: string;
  icon?: string;
  color?: string;
  is_active?: boolean;
  is_template?: boolean;
  is_public?: boolean;
  visibility?: 'private' | 'team' | 'public';
  group_id?: string;
}

export interface ExecuteWorkflowRequest {
  input: Record<string, unknown>;
  trigger_type?: 'manual' | 'api';
  version_id?: string;
}

export interface CreateVersionRequest {
  changelog?: string;
  activate?: boolean;
}

export interface WorkflowIdParams {
  id: string;
}

export interface ExecutionDetailParams {
  id: string;
  execId: string;
}

export interface VersionIdParams {
  id: string;
  versionId: string;
}

export interface ListWorkflowsQuery {
  limit?: number;
  offset?: number;
  category?: string;
  tags?: string;
  is_active?: boolean;
  is_template?: boolean;
  search?: string;
}

export interface ListExecutionsQuery {
  limit?: number;
  offset?: number;
  status?: string;
}
