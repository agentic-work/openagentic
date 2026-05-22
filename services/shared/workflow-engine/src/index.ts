/**
 * @openagentic/workflow-engine — public re-exports.
 *
 * Consumers can `import { canAutoApprove } from '@openagentic/workflow-engine'`,
 * or use deep imports like `'@openagentic/workflow-engine/approvalGate'` for
 * tree-shaking where appropriate. Both forms are supported by the
 * tsconfig path mapping in each consumer.
 *
 * NOTE: this re-export does NOT re-bind any side-effects; the registry's
 * `register()` calls run at import time of `nodes/registry.ts` regardless of
 * whether you go through this index or import the registry directly.
 */

// Helpers — security-critical, byte-identical across both engine copies.
export { canAutoApprove } from './approvalGate.js';
export type { AutoApproveDecisionContext } from './approvalGate.js';

// V1.1 flow_tool — derive an agent-tool catalog entry from a saved Workflow row.
export { deriveFlowToolSchema, sanitizeToolName } from './flowToolSchema.js';
export type { FlowToolSchema, JsonSchemaObject } from './flowToolSchema.js';

export { createApprovalRecord } from './approvalRecord.js';
export type {
  ApprovalRecordPayload,
  ApprovalRow,
  PrismaApprovalClient,
} from './approvalRecord.js';

export {
  redactSecrets,
  redactString,
  redactLogMeta,
} from './secretRedaction.js';
export type { RedactionMap } from './secretRedaction.js';

export { checkSecretAcl } from './secretAcl.js';
export type {
  AclSecretRow,
  AclDecisionContext,
} from './secretAcl.js';

export { runSandboxed } from './sandbox.js';
export type {
  SandboxOptions,
  SandboxResult,
} from './sandbox.js';

export {
  abortableAxios,
  abortableAxiosGet,
  abortableAxiosPost,
} from './abortableAxios.js';

export { PricingLookup } from './pricingLookup.js';
export type {
  LLMCostRateRow,
  PricingPrismaLike,
  PricingLogger,
} from './pricingLookup.js';

// Node plugin system — schema-driven registry + 23 migrated nodes.
export {
  registry,
  getRegisteredTypes,
  getAllSchemas,
  generateAiPromptFragment,
  runWithAssertions,
} from './nodes/registry.js';

export type {
  NodePlugin,
  NodeSchema,
  NodeCategory,
  NodeSetting,
  NodePort,
  NodeAiHints,
  NodeOutputAssertion,
  NodeExecutor,
  NodeExecutionContext,
  WorkflowNode,
  SettingType,
} from './nodes/types.js';

export { OutputAssertionError } from './nodes/types.js';

// Runtime / wire-format types (Phase B prep — replaces the duplicate
// definitions in api/workflows engines so consumers can import from
// one place).
export type {
  WorkflowEdge,
  WorkflowDefinition,
  ExecutionEvent,
  ExecutionEventType,
} from './runtime/types.js';

// Test mocks — wire format + resolver (Phase B #17). Lets the api proxy
// HTTP-friendly mocks to workflows-svc instead of constructing the
// engine in-process via WorkflowTestRunner.
export type {
  TestMocks,
  MockMcpToolEntry,
  MockLLMResponseEntry,
  ResolvedMcpMock,
} from './runtime/testMocks.js';
export { resolveMockMcpResponse } from './runtime/testMocks.js';
