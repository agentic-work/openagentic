/**
 * types.ts — re-export shim.
 *
 * Canonical source: services/shared/workflow-engine/src/nodes/types.ts
 * Extracted in S0-11 (Task #18). Edit the shared file, never this shim.
 *
 * Re-exports the full surface used by the engine + executors. The shared
 * module owns the definitions for NodePlugin, NodeSchema,
 * NodeExecutionContext, OutputAssertionError, and WorkflowNode.
 */
export {
  OutputAssertionError,
  type NodePlugin,
  type NodeSchema,
  type NodeCategory,
  type NodeSetting,
  type NodePort,
  type NodeAiHints,
  type NodeOutputAssertion,
  type NodeExecutor,
  type NodeExecutionContext,
  type WorkflowNode,
  type SettingType,
} from '@openagentic/workflow-engine/nodes/types';
