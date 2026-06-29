/**
 * sandbox.ts — re-export shim.
 *
 * Canonical source: services/shared/workflow-engine/src/sandbox.ts
 * Extracted in S0-11 (Task #18). Edit the shared file, never this shim.
 */
export {
  runSandboxed,
  type SandboxOptions,
  type SandboxResult,
  type SandboxErrorType,
} from '@openagentic/workflow-engine/sandbox';
