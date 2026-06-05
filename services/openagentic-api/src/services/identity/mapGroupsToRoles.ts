/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  OpenAgentic Enterprise — Runtime Identity Directory (SSO) registry
 *  Copyright © Agenticwork™ LLC. All rights reserved.
 *
 *  ENTERPRISE SOFTWARE — licensed ONLY under the OpenAgentic Enterprise License
 *  (/ee/LICENSE), NOT the repository's Apache-2.0 license. A paid Agenticwork LLC
 *  subscription is required to use this in production. Reading the source grants no
 *  license. Using, selling, hosting as a service, redistributing, or modifying it
 *  without a subscription — or removing the license gate — is a breach of
 *  /ee/LICENSE §4 and an infringement of Agenticwork's copyright.
 *  Licensing: licensing@agenticwork.io
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
/**
 * mapGroupsToRoles — pure group→role/admin mapping for SSO directories.
 *
 * Extracted verbatim-in-spirit from the inline group/admin block in
 * `auth/azureADAuth.ts` `validateToken` (~:250-366). The original read its
 * configuration from `process.env` (AZURE_AD_AUTHORIZED_GROUPS,
 * AZURE_ADMIN_GROUPS, AZURE_GROUP_MAPPINGS, SKIP_GROUP_VALIDATION,
 * EXTERNAL_ADMIN_EMAILS) at call time. In the runtime-IDP registry, every one
 * of those env knobs becomes a per-directory column on `identity_directories`,
 * so this logic is lifted into a side-effect-free function that both the Azure
 * callback and the generic-OIDC callback call with the row's config. Mapping is
 * therefore identical across IdP types.
 *
 * Semantics (mirrors the source + plan §2):
 *   - The login gate is the UNION of `authorizedGroups` + `adminGroups` (the
 *     source built `authorizedGroups = [...userGroups, ...adminGroups]`). If that
 *     union is empty, no group gate is enforced and the user is authorized.
 *   - Membership is an exact-value check against the user's groups (values are
 *     GUIDs or names stored directly on the row — no name→GUID indirection,
 *     unlike the old AZURE_GROUP_MAPPINGS resolution).
 *   - `adminGroups` membership → `isAdmin = true`.
 *   - `groupRoleMappings` ({ "<groupIdOrName>": "role" }) → extra roles for each
 *     of the user's groups that has a mapping.
 *   - `allowAllAuthenticated` (the per-row replacement for SKIP_GROUP_VALIDATION)
 *     → bypasses the group gate AND grants admin (the source set
 *     `user.isAdmin = true` when group validation was disabled).
 *   - `externalAdminEmails` (case-insensitive) → if the user's email matches,
 *     bypass the group gate AND grant admin (the source's EXTERNAL_ADMIN_EMAILS
 *     bypass, checked before group validation).
 *
 * PURE: no env reads, no logging, no I/O. Returns the decision only.
 */

export interface GroupRoleMapping {
  /** Login gate + admin source. Values are group GUIDs or names. */
  authorizedGroups: string[];
  /** Membership grants isAdmin. Also counts toward the login gate. */
  adminGroups: string[];
  /** { "<groupIdOrName>": "role" } — extra roles beyond 'admin'. */
  groupRoleMappings: Record<string, string>;
  /** Per-row replacement for SKIP_GROUP_VALIDATION — grants authorized + admin. */
  allowAllAuthenticated: boolean;
  /** Case-insensitive admin bypass list (EXTERNAL_ADMIN_EMAILS, per-row). */
  externalAdminEmails: string[];
  /** The authenticating user's email (used only for the external-admin check). */
  email?: string;
}

export interface GroupRoleResult {
  /** Whether the user passes the login gate. */
  authorized: boolean;
  /** Whether the user is granted admin. */
  isAdmin: boolean;
  /** Resolved role set (includes 'admin' when isAdmin). */
  roles: string[];
}

/**
 * Map a user's directory groups (+ email) to an authorization decision.
 *
 * @param userGroups - group claims from the validated IdP token (GUIDs/names).
 * @param cfg - the directory's group→role configuration.
 */
export function mapGroupsToRoles(
  userGroups: string[] | undefined | null,
  cfg: GroupRoleMapping
): GroupRoleResult {
  const groups = Array.isArray(userGroups) ? userGroups : [];

  const authorizedGroups = Array.isArray(cfg.authorizedGroups) ? cfg.authorizedGroups : [];
  const adminGroups = Array.isArray(cfg.adminGroups) ? cfg.adminGroups : [];
  const roleMappings = cfg.groupRoleMappings || {};
  const allowAll = cfg.allowAllAuthenticated === true;

  // The login gate is the union of authorized + admin groups (source :253).
  const loginGateGroups = [...authorizedGroups, ...adminGroups];

  // External / guest admin bypass — checked BEFORE group validation (source :316-329).
  const normalizedEmail = (cfg.email || '').toLowerCase();
  const externalAdmins = (Array.isArray(cfg.externalAdminEmails) ? cfg.externalAdminEmails : [])
    .map((e) => (e || '').trim().toLowerCase())
    .filter((e) => e.length > 0);
  const isExternalAdmin = normalizedEmail.length > 0 && externalAdmins.includes(normalizedEmail);

  // Membership in the login gate (source :309-311).
  const isInLoginGate = groups.some((g) => loginGateGroups.includes(g));

  // Authorization: an empty gate enforces no group requirement (source built the
  // gate from env and only denied when it was non-empty + unmatched, :335).
  const passesGroupGate = loginGateGroups.length === 0 || isInLoginGate;
  const authorized = allowAll || isExternalAdmin || passesGroupGate;

  // Admin: in an admin group, OR allowAll (SKIP_GROUP_VALIDATION granted admin,
  // source :345/:366), OR external admin (source :366).
  const isInAdminGroup = groups.some((g) => adminGroups.includes(g));
  const isAdmin = isInAdminGroup || allowAll || isExternalAdmin;

  // Role resolution: 'admin' when admin, plus any per-group role mappings for
  // the user's groups. De-duplicated, stable order (admin first, then mappings).
  const roles: string[] = [];
  if (isAdmin) {
    roles.push('admin');
  }
  for (const g of groups) {
    const mapped = roleMappings[g];
    if (mapped && !roles.includes(mapped)) {
      roles.push(mapped);
    }
  }

  return { authorized, isAdmin, roles };
}
