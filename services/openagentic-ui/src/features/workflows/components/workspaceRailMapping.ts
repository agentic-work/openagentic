/**
 * Workspace nav-rail → Flows-config section mapping.
 *
 * Per user directive 2026-05-14: "the left side rail needs to stay
 * within the flows workspace and not just open an admin console/version
 * some users WILL NOT HAVE access to admin so the rail needs to be the
 * settings for the USER and their workspace."
 *
 * Each rail item (other than home / flows) is rerouted to a Flows-scoped
 * SidebarSectionType — these surface in WorkflowsPage's ConfigPanel area
 * via the `openFlowsConfig` window CustomEvent (already wired). No more
 * cross-feature jump into the admin portal; non-admin users get a
 * coherent experience.
 *
 * Mapping rationale:
 *   - agents   → 'agents'       (user-callable agent catalog, drag onto canvas)
 *   - tools    → 'data'         (data stores / tools surface inside Flows)
 *   - runs     → 'runs'         (user's recent workflow executions — new pane)
 *   - insights → 'insights'     (per-user run stats — new pane)
 *   - library  → 'templates'    (template gallery is the user's library)
 *   - team     → 'team'         (workflow sharing, scoped to user's workflows)
 *   - settings → 'settings'     (workflow settings — user/workspace scoped)
 *
 * `home` and `flows` are intentionally NOT in this map — they're handled
 * upstream by ChatContainer (home returns to chat mode, flows is a no-op
 * since we're already in Flows).
 */

import type { SidebarSectionType } from './sidebar/SidebarSectionModal';

/**
 * Maps every leaking rail item to its Flows-scoped section. If a rail id
 * is missing from this map, the click should be a no-op — NEVER a fallback
 * into the admin portal.
 */
export const WORKSPACE_RAIL_TO_FLOWS_SECTION: Record<string, SidebarSectionType> = {
  agents:   'agents',
  tools:    'data',
  runs:     'runs',
  insights: 'insights',
  library:  'templates',
  team:     'team',
  settings: 'settings',
};

/**
 * Returns the Flows-scoped section for a rail id, or null if the click
 * should be handled by the caller (home / flows / unknown).
 */
export function railIdToFlowsSection(id: string): SidebarSectionType | null {
  return WORKSPACE_RAIL_TO_FLOWS_SECTION[id] ?? null;
}

/**
 * Asserts every entry in this map resolves to a Flows-scoped section —
 * never an `/admin/*` path. Used by the unit test to pin the regression.
 */
export function isFlowsScopedSection(section: SidebarSectionType): boolean {
  // Every value of SidebarSectionType is by construction Flows-scoped —
  // the type itself excludes admin paths. The runtime check is just a
  // belt-and-suspenders guard so future contributors can't sneak in a
  // string like 'admin/observability' that satisfies a widened type.
  return typeof section === 'string' && !section.includes('/');
}
