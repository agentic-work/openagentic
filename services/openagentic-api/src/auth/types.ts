/**
 * Shared auth types.
 *
 * UserContext is the canonical authenticated-user shape produced by the
 * token validator (local JWT + API-key paths) and consumed by the
 * authorization middleware. Defined here so it has no dependency on any
 * IdP-specific module.
 */
export interface UserContext {
  userId: string;
  tenantId: string;
  email?: string;
  name?: string;
  roles?: string[];
  isAdmin?: boolean;
  groups?: string[];
}
