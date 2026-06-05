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
import { SectionBar, StatusDot, FormGrid, FormRow, EmptyInline } from '../../primitives-v3'
import {
  type DirectoryRow,
  CapPill,
  DIRECTORY_TYPE_META,
  fmtRel,
  normalizeType,
  statusColor,
  statusTone,
} from './types'

export interface DirectoryDetailProps {
  row: DirectoryRow
  tab: string
}

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' }

const PillList: React.FC<{ items: string[]; tone?: 'accent' | 'ok' | 'warn' | 'info' }> = ({
  items,
  tone = 'info',
}) => {
  if (!items || items.length === 0) return <span style={{ color: 'var(--fg-3)' }}>—</span>
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {items.map((i) => (
        <CapPill key={i} tone={tone}>
          {i}
        </CapPill>
      ))}
    </span>
  )
}

export const DirectoryDetail: React.FC<DirectoryDetailProps> = ({ row, tab }) => {
  if (tab === 'overview') return <OverviewTab row={row} />
  if (tab === 'groups') return <GroupsTab row={row} />
  if (tab === 'discovery') return <DiscoveryTab row={row} />
  return null
}

const OverviewTab: React.FC<{ row: DirectoryRow }> = ({ row }) => {
  const meta = DIRECTORY_TYPE_META[normalizeType(row.type)]
  return (
    <>
      <SectionBar title="status" />
      <FormGrid>
        <FormRow name="Status">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <StatusDot status={statusTone(row.status)} />
            <span style={{ color: statusColor(row.status) }}>{row.status}</span>
          </span>
        </FormRow>
        <FormRow name="Enabled">
          <span style={{ color: row.enabled ? 'var(--ok)' : 'var(--fg-3)' }}>
            {row.enabled ? 'yes' : 'no'}
          </span>
        </FormRow>
        <FormRow name="Priority">
          <span style={mono}>{row.priority}</span>
        </FormRow>
        <FormRow name="Updated">
          <span style={mono}>{fmtRel(row.updated_at)}</span>
        </FormRow>
      </FormGrid>

      <SectionBar title="provider" />
      <FormGrid>
        <FormRow name="Type" configKey="type">
          <span style={mono}>{meta.label}</span>
        </FormRow>
        {meta.needsTenant && (
          <FormRow name="Tenant" configKey="tenant_id">
            <span style={mono}>{row.tenantId ?? '—'}</span>
          </FormRow>
        )}
        {meta.needsAuthority && (
          <FormRow name="Authority" configKey="authority">
            <span style={mono}>{row.authority ?? '—'}</span>
          </FormRow>
        )}
        {meta.needsIssuer && (
          <FormRow name="Issuer" configKey="issuer">
            <span style={mono}>{row.issuer ?? '—'}</span>
          </FormRow>
        )}
        <FormRow name="Scopes" configKey="scopes">
          <PillList items={row.scopes} tone="info" />
        </FormRow>
        <FormRow name="Redirect URI" configKey="redirect_uri">
          <span style={{ ...mono, color: 'var(--fg-2)', wordBreak: 'break-all' }}>
            {row.redirectUri ?? '— (derived from PUBLIC_BASE_URL)'}
          </span>
        </FormRow>
      </FormGrid>

      <SectionBar title="credentials" />
      <FormGrid>
        <FormRow name="Client ID">
          <span style={{ color: row.hasClientId ? 'var(--ok)' : 'var(--fg-3)' }}>
            {row.hasClientId ? 'configured' : 'not set'}
          </span>
        </FormRow>
        <FormRow name="Client secret">
          {/* Write-only — the API never returns the value, only hasSecret. */}
          <span style={{ color: row.hasSecret ? 'var(--ok)' : 'var(--fg-3)' }}>
            {row.hasSecret ? '•••••••• (stored, redacted)' : 'not set'}
          </span>
        </FormRow>
      </FormGrid>
    </>
  )
}

const GroupsTab: React.FC<{ row: DirectoryRow }> = ({ row }) => {
  const mappings = Object.entries(row.groupRoleMappings ?? {})
  return (
    <>
      <SectionBar title="access gating" />
      <FormGrid>
        <FormRow name="Allowed domains" configKey="allowed_domains">
          <PillList items={row.allowedDomains} tone="info" />
        </FormRow>
        <FormRow name="Allow all authenticated" configKey="allow_all_authenticated">
          <span style={{ color: row.allowAllAuthenticated ? 'var(--warn)' : 'var(--fg-3)' }}>
            {row.allowAllAuthenticated ? 'yes — group validation skipped' : 'no'}
          </span>
        </FormRow>
        <FormRow name="Group claim" configKey="group_claim">
          <span style={mono}>{row.groupClaim ?? 'groups'}</span>
        </FormRow>
      </FormGrid>

      <SectionBar title="group membership" />
      <FormGrid>
        <FormRow name="Authorized groups" configKey="authorized_groups">
          <PillList items={row.authorizedGroups} tone="ok" />
        </FormRow>
        <FormRow name="Admin groups" configKey="admin_groups">
          <PillList items={row.adminGroups} tone="accent" />
        </FormRow>
        <FormRow name="External admin emails" configKey="external_admin_emails">
          <PillList items={row.externalAdminEmails} tone="accent" />
        </FormRow>
      </FormGrid>

      <SectionBar title="group → role mappings" count={mappings.length} />
      {mappings.length === 0 ? (
        <EmptyInline pad>no explicit group → role mappings configured</EmptyInline>
      ) : (
        <FormGrid>
          {mappings.map(([group, role]) => (
            <FormRow key={group} name={group}>
              <span style={{ ...mono, color: 'var(--color-accent)' }}>{String(role)}</span>
            </FormRow>
          ))}
        </FormGrid>
      )}
    </>
  )
}

const DiscoveryTab: React.FC<{ row: DirectoryRow }> = ({ row }) => {
  const d = row.discovery
  if (!d) {
    return (
      <EmptyInline pad>
        no cached OIDC discovery document — run <span className="accent">Test</span> to fetch
        and validate <span className="accent">.well-known/openid-configuration</span>.
      </EmptyInline>
    )
  }
  return (
    <>
      <SectionBar title="OIDC discovery" />
      <FormGrid>
        <FormRow name="Issuer" configKey="discovery.issuer">
          <span style={{ ...mono, wordBreak: 'break-all' }}>{d.issuer ?? '—'}</span>
        </FormRow>
        <FormRow name="Authorization endpoint" configKey="discovery.authorization_endpoint">
          <span style={{ ...mono, wordBreak: 'break-all' }}>{d.authorization_endpoint ?? '—'}</span>
        </FormRow>
        <FormRow name="Token endpoint" configKey="discovery.token_endpoint">
          <span style={{ ...mono, wordBreak: 'break-all' }}>{d.token_endpoint ?? '—'}</span>
        </FormRow>
        <FormRow name="JWKS URI" configKey="discovery.jwks_uri">
          <span style={{ ...mono, wordBreak: 'break-all' }}>{d.jwks_uri ?? '—'}</span>
        </FormRow>
      </FormGrid>
    </>
  )
}

export default DirectoryDetail
