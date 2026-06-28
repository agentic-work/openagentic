/**
 * Synthetic constants for SoT-rule (CLAUDE.md #7) test fixtures.
 *
 * Test files must never use real model IDs, deployment names, or production
 * provider-type identifiers as string literals. These symbolic names give
 * tests stable values that won't accidentally match a production string and
 * won't trigger rule-#7 audits.
 *
 * Use these in any test that needs to populate a `ModelAssignment.provider`
 * or similar typed string field where the actual value doesn't matter —
 * only that it's a valid-shape string.
 */
export const TEST_PROVIDER_TYPE = 'test-provider' as const;
export const TEST_MODEL_ID = 'test-model' as const;
export const TEST_EMBEDDING_MODEL_ID = 'test-embedding' as const;
