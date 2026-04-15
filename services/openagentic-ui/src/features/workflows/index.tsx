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
 * Workflows Feature - Main Export
 * Native visual workflow builder for OpenAgentic
 */

export { WorkflowsPage } from './components/WorkflowsPage';
export { WorkflowsContainer } from './components/WorkflowsContainer';
export { WorkflowList } from './components/WorkflowList';
export { NodePropertiesPanel } from './components/NodePropertiesPanel';
export { WorkflowApiService } from './services/workflowApi';

// Node components
export { CustomNode } from './components/nodes/CustomNode';

// Hooks
export { useWorkflowResources } from './hooks/useWorkflowResources';

// Types
export type {
  Workflow,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  WorkflowExecution,
  WorkflowTemplate,
  NodeData,
  NodeType,
  TriggerType,
  WorkflowStatus,
  ExecutionStatus,
  ExecutionLog,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  MCPToolNode as MCPToolNodeType,
} from './types/workflow.types';
