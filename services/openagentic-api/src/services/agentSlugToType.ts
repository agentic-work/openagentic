/**
 * agentSlugToType / agentTypeToSlug — bridge the markdown filename
 * convention (hyphens) and the DB column convention (underscores) for
 * agent identifiers.
 *
 * Markdown registry (`src/agents/built-in/*.md`) uses hyphenated filenames
 * — e.g. `cloud-operations.md` produces `agent_type='cloud-operations'`.
 *
 * `prisma.agent.agent_type` uses underscores — e.g. `cloud_operations`.
 *
 * Per the Option B unification (2026-05-13), the DB is the SoT. The seeder
 * (`14-agent-md-to-db-seeder.ts`) converts hyphenated slugs to underscored
 * types on upsert. This helper is the single bridge point.
 *
 * Plan: docs/superpowers/plans/2026-05-13-option-b-db-sot-unification.md.
 */

/**
 * Convert a markdown slug (`cloud-operations`) to a DB agent_type
 * (`cloud_operations`). Underscores stay underscores; hyphens become
 * underscores.
 */
export function agentSlugToType(slug: string): string {
  return slug.replace(/-/g, '_');
}

/**
 * Convert a DB agent_type (`cloud_operations`) to a markdown slug
 * (`cloud-operations`). Inverse of `agentSlugToType`.
 */
export function agentTypeToSlug(type: string): string {
  return type.replace(/_/g, '-');
}
