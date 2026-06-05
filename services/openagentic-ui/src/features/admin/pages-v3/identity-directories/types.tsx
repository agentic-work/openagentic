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
import * as React from 'react'

// ============================================================
// Identity Directory row + helpers
//
// 1:1 analogue of pages-v3/llm-providers/types.tsx, applied to the
// runtime SSO identity-directory registry. The API
// (routes/admin/identity-directories.ts → toRedactedView) returns the
// shape below; clientSecret + clientId are NEVER returned (only the
// `hasSecret` / `hasClientId` presence flags), mirroring the provider
// route returning `hasApiKey`.
// ============================================================

export type DirectoryType = 'azure-ad' | 'google-oidc' | 'generic-oidc'

export type DirectoryTypeFilter = 'all' | DirectoryType
export type DirectoryStatus = 'active' | 'disabled' | 'error' | 'unknown'

/** The redacted directory view as returned by the API. */
export interface DirectoryRow {
  id: string
  name: string
  displayName: string
  type: DirectoryType
  enabled: boolean
  priority: number
  tenantId: string | null
  authority: string | null
  issuer: string | null
  redirectUri: string | null
  scopes: string[]
  groupClaim: string | null
  authorizedGroups: string[]
  adminGroups: string[]
  groupRoleMappings: Record<string, string>
  externalAdminEmails: string[]
  allowedDomains: string[]
  allowAllAuthenticated: boolean
  status: DirectoryStatus
  hasDiscovery: boolean
  discovery: Record<string, any> | null
  hasSecret: boolean
  hasClientId: boolean
  created_at?: string
  updated_at?: string
  created_by?: string | null
  updated_by?: string | null
}

export interface EnterpriseStatus {
  feature: string
  licensed: boolean
  licensee?: string
  message: string
}

export interface DirectoryListResponse {
  directories: DirectoryRow[]
  total: number
  enterprise?: EnterpriseStatus
}

// ------------------------------------------------------------
// Type metadata — labels, the "what extra fields does this type
// need" descriptor, and the provider-specific callback instructions
// fallback (the API also returns instructions on /callback-url, but
// we render a sensible default before the URL has been fetched).
// ------------------------------------------------------------
export interface DirectoryTypeMeta {
  label: string
  /** Whether this type needs tenantId + authority (Azure), issuer
   *  (generic-oidc), or nothing extra (Google). */
  needsTenant: boolean
  needsAuthority: boolean
  needsIssuer: boolean
  /** Short hint shown under the type picker. */
  hint: string
  /** Registration instructions shown next to the callback URL. */
  callbackInstructions: string
}

export const DIRECTORY_TYPE_META: Record<DirectoryType, DirectoryTypeMeta> = {
  'azure-ad': {
    label: 'Azure AD (Entra ID)',
    needsTenant: true,
    needsAuthority: true,
    needsIssuer: false,
    hint: 'Microsoft Entra ID app registration. Provide the tenant ID (or a full authority URL) plus the app client ID + secret.',
    callbackInstructions:
      'Azure: App Registration → Authentication → Redirect URIs (Web). Required API permissions: openid profile email offline_access + a "groups" optional claim.',
  },
  'google-oidc': {
    label: 'Google Workspace',
    needsTenant: false,
    needsAuthority: false,
    needsIssuer: false,
    hint: 'Google OAuth client. No tenant or issuer needed — Google uses a fixed well-known configuration. Gate access with allowed domains.',
    callbackInstructions:
      'Google: OAuth client → Authorized redirect URIs. Scopes: openid email profile.',
  },
  'generic-oidc': {
    label: 'Generic OIDC',
    needsTenant: false,
    needsAuthority: false,
    needsIssuer: true,
    hint: 'Any standards-compliant OIDC provider (Okta, Auth0, Keycloak, Ping…). Provide the issuer base — the .well-known/openid-configuration is validated on save.',
    callbackInstructions:
      'Generic OIDC: register this URL as an Authorized Redirect URI in your IdP.',
  },
}

export const DIRECTORY_TYPES: DirectoryType[] = ['azure-ad', 'google-oidc', 'generic-oidc']

/** Map the API `type` discriminator (which also tolerates the bare
 *  'google' alias) onto a canonical DirectoryType for the UI. */
export function normalizeType(t: string): DirectoryType {
  if (t === 'google' || t === 'google-oidc') return 'google-oidc'
  if (t === 'generic-oidc') return 'generic-oidc'
  return 'azure-ad'
}

// ------------------------------------------------------------
// Status helpers (mirror llm-providers/types.tsx)
// ------------------------------------------------------------
export function deriveStatus(d: DirectoryRow): DirectoryStatus {
  if (d.enabled === false) return 'disabled'
  if (d.status === 'error') return 'error'
  if (d.status === 'active') return 'active'
  return 'unknown'
}

export const statusTone = (s: DirectoryStatus): 'ok' | 'warn' | 'err' | 'idle' =>
  s === 'active' ? 'ok' : s === 'error' ? 'err' : s === 'disabled' ? 'idle' : 'warn'

export const statusColor = (s: DirectoryStatus): string =>
  s === 'active' ? 'var(--ok)' : s === 'error' ? 'var(--err)' : 'var(--fg-3)'

export const fmtRel = (iso?: string): string => {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function buildDirectoryRows(directories: DirectoryRow[] | undefined): DirectoryRow[] {
  return (directories ?? []).map((d) => ({
    ...d,
    type: normalizeType(d.type),
    status: deriveStatus(d),
  }))
}

// ============================================================
// CapPill — small capability tag used in the directory detail
// ============================================================
export const CapPill: React.FC<{
  tone: 'accent' | 'ok' | 'warn' | 'info'
  children: React.ReactNode
}> = ({ tone, children }) => (
  <span
    style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 9,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      padding: '1px 5px',
      border: '1px solid var(--glass-border)',
      color: `var(--${tone === 'accent' ? 'color-accent' : tone})`,
    }}
  >
    {children}
  </span>
)
