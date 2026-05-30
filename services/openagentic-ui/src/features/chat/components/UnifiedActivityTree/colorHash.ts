/**
 * colorHashForId — deterministic color derivation for agent avatars.
 *
 * v0.6.7 chat-polish fix 5. Given a stable string id (agent id, tool id,
 * etc) returns a hex color that reads well on both light and dark themes.
 * Same id → same color across reloads.
 *
 * Task #166 — picks from the mockup 4-anchor palette
 * (docs/release-plans/v0.6.7-ux-mockups/01-cloud-ops.html :root):
 *   --agent-c #f59e0b (amber)
 *   --agent-g #10b981 (emerald)
 *   --agent-s #ef4444 (red)
 *   --agent-k #3b82f6 (blue)
 *
 * A djb2 hash chooses an anchor deterministically so the same agent id
 * always renders the same color across reloads and is always drawn from
 * the canonical mockup palette.
 */

/** 4-anchor mockup palette for sub-agent avatars. */
const AGENT_PALETTE = [
  '#f59e0b', // agent-c (amber)
  '#10b981', // agent-g (emerald)
  '#ef4444', // agent-s (red)
  '#3b82f6', // agent-k (blue)
] as const;

/**
 * djb2-style 32-bit hash. Not cryptographic — just a fast mixer for UI
 * color assignment.
 */
export function hashStringToInt(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Convert an agent id into one of the 4 mockup palette anchors.
 * Falls back to a neutral slate when id is empty.
 */
export function colorHashForId(id: string, theme: 'light' | 'dark' = 'dark'): string {
  if (!id) return theme === 'dark' ? '#52525b' : '#a1a1aa';
  const idx = hashStringToInt(id) % AGENT_PALETTE.length;
  return AGENT_PALETTE[idx];
}

/**
 * Pick the first letter (upper-case) from a human-readable agent name.
 * Falls back to the first alphanumeric char of the id, then 'A'.
 */
export function avatarInitial(name: string | undefined, id: string): string {
  const src = (name && name.trim()) || id;
  const match = src.match(/[a-z0-9]/i);
  return (match?.[0] ?? 'A').toUpperCase();
}
