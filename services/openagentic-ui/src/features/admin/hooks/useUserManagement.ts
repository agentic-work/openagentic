import { useAdminQuery, useAdminMutation } from './useAdminQuery'

// ============================================================
// Shapes returned by the API (camelCase wherever the route emits it)
// ============================================================
export interface ApiUserPermissions {
  userId: string
  allowedLlmProviders: string[]
  deniedLlmProviders: string[]
  allowedMcpServers: string[]
  deniedMcpServers: string[]
  dailyTokenLimit: number | null
  monthlyTokenLimit: number | null
  dailyRequestLimit: number | null
  monthlyRequestLimit: number | null
  canUseImageGeneration: boolean
  canUseCodeExecution: boolean
  canUseWebSearch: boolean
  canUseFileUpload: boolean
  canUseMemory: boolean
  canUseRag: boolean
  canUseAwcode: boolean
  source: 'user' | 'group' | 'default'
}

export interface ApiUser {
  id: string
  email: string
  name: string | null
  is_admin: boolean
  groups: string[]
  last_login_at: string | null
  created_at: string
  hasCustomPermissions: boolean
  customPermissions: ApiUserPermissions | null
  is_locked?: boolean
  scope_warning_count?: number
  locked_at?: string | null
  locked_reason?: string | null
}

export interface UserManagementResponse {
  users: ApiUser[]
  total: number
}

export function useUserManagement() {
  // route returns either { users, total } or a bare array — accept both.
  return useAdminQuery<UserManagementResponse | ApiUser[]>(
    ['user-management'],
    '/api/admin/user-management',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// Per-user resolved permissions (for the Permissions sub-tab)
// ============================================================
export interface UserPermissionsDetail {
  user?: { id: string; email: string; name: string | null; groups: string[]; isAdmin: boolean }
  permissions?: ApiUserPermissions
  // Some routes return permissions at the top level; keep flexible shape.
  [k: string]: any
}

export function useUserPermissions(userId: string | null) {
  return useAdminQuery<UserPermissionsDetail>(
    ['user-permissions', userId ?? 'none'],
    userId ? `/api/admin/user-management/${userId}/permissions` : '/api/admin/user-management/_/permissions',
    { staleTime: 30_000, enabled: !!userId },
  )
}

export interface EffectivePermissionEntry {
  value: any
  source: 'user' | 'default' | 'group'
}

export interface EffectivePermissionsResponse {
  userId: string
  email: string
  name: string | null
  isAdmin: boolean
  effectivePermissions: Record<string, EffectivePermissionEntry>
  effectiveRateLimits?: {
    tier: string
    source: string
    limits?: {
      requestsPerMinute?: number
      requestsPerHour?: number
      requestsPerDay?: number
      tokensPerDay?: number
      workflowExecutionsPerHour?: number
      codeExecutionsPerHour?: number
    }
  }
}

export function useEffectivePermissions(userId: string | null) {
  return useAdminQuery<EffectivePermissionsResponse>(
    ['effective-permissions', userId ?? 'none'],
    userId ? `/api/admin/user-management/${userId}/effective-permissions` : '/api/admin/user-management/_/effective-permissions',
    { staleTime: 30_000, enabled: !!userId },
  )
}

// ============================================================
// Catalog endpoints (used by the Permissions tab summary)
// ============================================================
export interface AvailableLLM {
  id: string
  name: string
  display_name?: string
  provider_type: string
}
export interface AvailableLLMsResponse {
  providers?: AvailableLLM[]
}
export function useAvailableLLMs() {
  return useAdminQuery<AvailableLLMsResponse | AvailableLLM[]>(
    ['available-llms'],
    '/api/admin/permissions/available-llms',
    { staleTime: 5 * 60_000 },
  )
}

export interface AvailableMCP {
  id: string
  name: string
  description?: string | null
}
export interface AvailableMCPsResponse {
  servers?: AvailableMCP[]
}
export function useAvailableMCPs() {
  return useAdminQuery<AvailableMCPsResponse | AvailableMCP[]>(
    ['available-mcps'],
    '/api/admin/permissions/available-mcps',
    { staleTime: 5 * 60_000 },
  )
}

// ============================================================
// Tokens (per-user via /api/admin/tokens?userId=…)
// ============================================================
export interface ApiToken {
  id: string
  userId: string
  userName?: string
  userEmail?: string
  isAdmin?: boolean
  name: string
  lastUsedAt: string | null
  expiresAt: string | null
  isActive: boolean
  isExpired: boolean
  createdAt: string
  rateLimitTier?: string
}
export interface TokensResponse {
  success?: boolean
  tokens: ApiToken[]
  count?: number
}

export function useUserTokens(userId: string | null) {
  return useAdminQuery<TokensResponse>(
    ['tokens', userId ?? 'none'],
    userId
      ? `/api/admin/tokens?userId=${encodeURIComponent(userId)}&includeExpired=true`
      : '/api/admin/tokens?userId=_',
    { staleTime: 30_000, enabled: !!userId },
  )
}

// ============================================================
// Sessions (chat sessions per user — wraps /api/admin/audit-logs/sessions)
// ============================================================
export interface SessionRow {
  id: string
  title?: string | null
  user?: { id: string; name: string | null; email: string } | null
  message_count?: number | null
  total_tokens?: number | null
  total_cost?: number | null
  created_at: string
  last_activity_at?: string | null
  messages?: Array<{
    id: string
    role: string
    model?: string | null
    tokens?: any
    cost?: number | null
    created_at: string
  }>
}
export interface SessionsResponse {
  sessions?: SessionRow[]
  total?: number
}
export function useUserSessions(userId: string | null) {
  return useAdminQuery<SessionsResponse | SessionRow[]>(
    ['user-sessions', userId ?? 'none'],
    userId
      ? `/api/admin/audit-logs/sessions?userId=${encodeURIComponent(userId)}&limit=25`
      : '/api/admin/audit-logs/sessions?userId=_',
    { staleTime: 60_000, enabled: !!userId },
  )
}

// ============================================================
// Audit log filtered to a single user
// ============================================================
export interface UserAuditEntry {
  id: string
  type?: string
  userId?: string | null
  userName?: string
  userEmail?: string
  action?: string
  resourceType?: string
  resourceId?: string
  ipAddress?: string
  success?: boolean
  timestamp: string
}
export interface UserAuditResponse {
  success?: boolean
  logs: UserAuditEntry[]
  pagination?: { page: number; limit: number; totalPages: number; totalItems: number }
}

export function useUserAuditLogs(userId: string | null, limit = 25) {
  return useAdminQuery<UserAuditResponse>(
    ['user-audit-logs', userId ?? 'none', String(limit)],
    userId
      ? `/api/admin/audit-logs?userId=${encodeURIComponent(userId)}&logType=all&page=1&limit=${limit}`
      : `/api/admin/audit-logs?userId=_`,
    { staleTime: 30_000, enabled: !!userId },
  )
}

// ============================================================
// Helpers — normalize array-or-wrapped responses + computed totals
// ============================================================
export function asUsers(data?: UserManagementResponse | ApiUser[]): ApiUser[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  return data.users ?? []
}
export function asLLMs(data?: AvailableLLMsResponse | AvailableLLM[]): AvailableLLM[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  return data.providers ?? []
}
export function asMCPs(data?: AvailableMCPsResponse | AvailableMCP[]): AvailableMCP[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  return data.servers ?? []
}
export function asSessions(data?: SessionsResponse | SessionRow[]): SessionRow[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  return data.sessions ?? []
}

// ============================================================
// MUTATIONS — wire 2026-05-06
// ============================================================

export interface InviteAllowedUserBody {
  email: string
  is_admin?: boolean
  display_name?: string
  notes?: string
}

/**
 * "Invite user" in v3 = add to the auth allow-list. The actual User
 * row is created by SSO on first sign-in; this gates who is permitted
 * to log in. Mirrors v2 UserPermissionsView semantics.
 */
export function useInviteAllowedUser() {
  return useAdminMutation<{ user: any }, InviteAllowedUserBody>(
    '/api/admin/auth/users',
    {
      method: 'POST',
      invalidateKeys: [['auth', 'users'], ['user-management']],
    },
  )
}

export interface UpdateAllowedUserBody {
  email?: string
  is_admin?: boolean
  display_name?: string | null
  notes?: string | null
  is_active?: boolean
}

export function useUpdateAllowedUser(allowedUserId: string | null) {
  return useAdminMutation<{ user: any }, UpdateAllowedUserBody>(
    allowedUserId ? `/api/admin/auth/users/${allowedUserId}` : '/api/admin/auth/users/_',
    {
      method: 'PUT',
      invalidateKeys: [['auth', 'users']],
    },
  )
}

export function useDeleteAllowedUser(allowedUserId: string | null) {
  return useAdminMutation<{ success: boolean }, void>(
    allowedUserId ? `/api/admin/auth/users/${allowedUserId}` : '/api/admin/auth/users/_',
    {
      method: 'DELETE',
      invalidateKeys: [['auth', 'users']],
    },
  )
}

export function useUnlockUser(userId: string | null) {
  return useAdminMutation<{ message: string; userId: string }, void>(
    userId ? `/api/admin/user-management/${userId}/unlock` : '/api/admin/user-management/_/unlock',
    {
      method: 'POST',
      invalidateKeys: [
        ['user-management'],
        ['user-management', 'locked'],
      ],
    },
  )
}

export function useResetUserWarnings(userId: string | null) {
  return useAdminMutation<{ message: string }, void>(
    userId ? `/api/admin/user-management/${userId}/reset-warnings` : '/api/admin/user-management/_/reset-warnings',
    {
      method: 'POST',
      invalidateKeys: [
        ['user-management'],
        ['user-management', 'locked'],
      ],
    },
  )
}

/**
 * Body shape mirrors PermissionUpdate from
 * services/openagentic-api/src/services/UserPermissionsService.ts —
 * every field optional; only present keys are mutated.
 */
export interface SetUserPermissionsBody {
  allowedLlmProviders?: string[]
  deniedLlmProviders?: string[]
  allowedMcpServers?: string[]
  deniedMcpServers?: string[]
  dailyTokenLimit?: number | null
  monthlyTokenLimit?: number | null
  dailyRequestLimit?: number | null
  monthlyRequestLimit?: number | null
  canUseImageGeneration?: boolean
  canUseCodeExecution?: boolean
  canUseWebSearch?: boolean
  canUseFileUpload?: boolean
  canUseMemory?: boolean
  canUseRag?: boolean
  canUseAwcode?: boolean
}

export function useSetUserPermissions(userId: string | null) {
  return useAdminMutation<{ message: string; permissions: any }, SetUserPermissionsBody>(
    userId
      ? `/api/admin/user-management/${userId}/permissions`
      : '/api/admin/user-management/_/permissions',
    {
      method: 'PUT',
      invalidateKeys: [
        ['user-permissions', userId ?? 'none'],
        ['effective-permissions', userId ?? 'none'],
        ['user-management'],
      ],
    },
  )
}

/**
 * Hard-delete a user record. v2 forces `?confirm=true` query param —
 * we follow the same contract so the back-end guard stays honored.
 */
export function useDeleteUser(userId: string | null) {
  return useAdminMutation<{ message: string }, void>(
    userId ? `/api/admin/users/${userId}?confirm=true` : '/api/admin/users/_?confirm=true',
    {
      method: 'DELETE',
      invalidateKeys: [['user-management']],
    },
  )
}
