/**
 * secretAcl.ts
 *
 * Pure decision helper for WorkflowSecret access-control lists.
 *
 * Checks three orthogonal allow-lists (allowed_node_types, allowed_users,
 * allowed_groups) in a deterministic order:
 *
 *   1. node_type — if list non-empty AND ctx.nodeType not present → deny
 *   2. user      — if list non-empty AND ctx.userId not present → deny
 *   3. group     — if list non-empty AND no ctx.userGroups member present → deny
 *
 * An empty (or null) list means "no restriction" — not "deny all".
 *
 * All three checks use AND semantics: every non-empty list must pass.
 *
 * S0-9 / B5 — enforce WorkflowSecret ACLs at resolution.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AclDecisionContext {
  /** Type of the node requesting the secret (e.g. 'mcp_tool', 'http_request'). */
  nodeType: string;
  /** ID of the user whose workflow execution is running. */
  userId: string;
  /** Group IDs the user belongs to. */
  userGroups: readonly string[];
}

/**
 * The subset of a WorkflowSecret row that the ACL check needs.
 * Mirrors the Prisma model columns; null is treated identically to [].
 */
export interface AclSecretRow {
  allowed_node_types: string[] | null;
  allowed_users: string[] | null;
  allowed_groups: string[] | null;
}

export type AclDecision =
  | { allowed: true }
  | { allowed: false; reason: 'node_type' | 'user' | 'group'; details: string };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function isNonEmpty(arr: string[] | null | undefined): arr is string[] {
  return Array.isArray(arr) && arr.length > 0;
}

/**
 * Decide whether `ctx` satisfies the allow-lists on `secret`.
 *
 * Checks are applied in order: node_type → user → group.
 * The first failing check determines the denial reason.
 *
 * Any context field can be compared to an undefined-undefined list —
 * undefined / missing context fields are handled by the caller
 * (WorkflowSecretService) which skips specific checks when the context
 * field is not available (e.g. during pre-load with no current node).
 */
export function checkSecretAcl(
  secret: AclSecretRow,
  ctx: AclDecisionContext,
): AclDecision {
  // 1. Node-type check
  if (isNonEmpty(secret.allowed_node_types)) {
    if (!secret.allowed_node_types.includes(ctx.nodeType)) {
      return {
        allowed: false,
        reason: 'node_type',
        details: `nodeType '${ctx.nodeType}' not in allowed_node_types [${secret.allowed_node_types.join(', ')}]`,
      };
    }
  }

  // 2. User check
  if (isNonEmpty(secret.allowed_users)) {
    if (!secret.allowed_users.includes(ctx.userId)) {
      return {
        allowed: false,
        reason: 'user',
        details: `userId '${ctx.userId}' not in allowed_users`,
      };
    }
  }

  // 3. Group check — any intersection is sufficient
  if (isNonEmpty(secret.allowed_groups)) {
    const userGroupSet = new Set(ctx.userGroups);
    const hasGroup = secret.allowed_groups.some((g) => userGroupSet.has(g));
    if (!hasGroup) {
      return {
        allowed: false,
        reason: 'group',
        details: `user belongs to none of allowed_groups [${secret.allowed_groups.join(', ')}]`,
      };
    }
  }

  return { allowed: true };
}
