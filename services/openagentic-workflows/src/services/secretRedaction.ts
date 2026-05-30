/**
 * secretRedaction.ts — re-export shim.
 *
 * Canonical source: services/shared/workflow-engine/src/secretRedaction.ts
 * Extracted in S0-11 (Task #18). Edit the shared file, never this shim.
 */
export {
  redactSecrets,
  redactString,
  redactLogMeta,
  type RedactionMap,
} from '@openagentic/workflow-engine/secretRedaction';
