/**
 * Artifact Registry — id-based supersession for iterative artifacts.
 *
 * When a model emits two artifacts that share the same `id` (e.g. the user
 * asks to iterate on "the dashboard" over three messages), the Claude.ai
 * convention is to update-in-place rather than stack. Our UI achieves
 * this with a reducer pass: given the ordered list of content blocks in
 * a session, annotate the earlier artifacts whose `id` was reused later
 * so the renderer can hide them.
 *
 * This module is pure (easy to test) and framework-agnostic — the React
 * side just calls `markSupersededArtifacts(blocks)` before mapping.
 */

export interface ArtifactBlock {
  /** Unique per-message block id (not the artifact id). */
  id: string;
  /** The user-facing artifact identifier parsed from the code fence. */
  artifactId?: string;
  /** All other block fields are opaque to this module. */
  [key: string]: unknown;
}

export interface SupersededFlag {
  isSupersededArtifact: boolean;
  supersededBy?: string; // block.id of the later artifact with the same artifactId
}

/**
 * Mark earlier artifact blocks as superseded when a later block in the
 * same session reuses their `artifactId`. Blocks without `artifactId`
 * are never marked (they are independent one-offs).
 *
 * The input is NOT mutated; a new array is returned.
 */
export function markSupersededArtifacts<T extends ArtifactBlock>(
  blocks: T[],
): Array<T & SupersededFlag> {
  // Build lookup: artifactId -> id of LAST block carrying it
  const lastBlockIdByArtifactId = new Map<string, string>();
  for (const b of blocks) {
    if (b.artifactId) {
      lastBlockIdByArtifactId.set(b.artifactId, b.id);
    }
  }

  return blocks.map((b) => {
    if (!b.artifactId) {
      return { ...b, isSupersededArtifact: false };
    }
    const lastId = lastBlockIdByArtifactId.get(b.artifactId);
    if (lastId && lastId !== b.id) {
      return { ...b, isSupersededArtifact: true, supersededBy: lastId };
    }
    return { ...b, isSupersededArtifact: false };
  });
}

/**
 * Return only the non-superseded blocks — convenience for a renderer that
 * wants to drop superseded artifacts entirely rather than style them as
 * "updated".
 */
export function filterActiveArtifacts<T extends ArtifactBlock>(blocks: T[]): T[] {
  const annotated = markSupersededArtifacts(blocks);
  return annotated.filter((b) => !b.isSupersededArtifact) as T[];
}
