/**
 * approvalGate.ts — re-export shim.
 *
 * Canonical source: services/shared/workflow-engine/src/approvalGate.ts
 * Extracted in S0-11 (Task #18) to eliminate engine-copy drift.
 * Both openagentic-workflows and openagentic-api re-export from the same
 * shared module via the @openagentic/workflow-engine file: dep.
 * Edit the shared file, never this shim.
 */
export {
  canAutoApprove,
  type AutoApproveDecisionContext,
} from '@openagentic/workflow-engine/approvalGate';
