/**
 * registry.ts — re-export shim.
 *
 * Canonical source: services/shared/workflow-engine/src/nodes/registry.ts
 * Extracted in S0-11 (Task #18). Edit the shared file, never this shim.
 *
 * The `register()` calls run at module-load time of the shared registry
 * module — importing from here triggers the same one-time registration.
 */
export {
  registry,
  getRegisteredTypes,
  getAllSchemas,
  generateAiPromptFragment,
  runWithAssertions,
} from '@openagentic/workflow-engine/nodes/registry';
