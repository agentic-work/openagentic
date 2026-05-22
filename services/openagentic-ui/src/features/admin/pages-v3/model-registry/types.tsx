import type { LlmRegistryRow, LlmProviderRow } from '../../hooks/useDashboardMetrics'

export interface ModelCapabilities {
  chat: boolean
  embeddings: boolean
  tools: boolean
  vision: boolean
  streaming: boolean
  thinking: boolean
  imageGeneration: boolean
}

export interface ModelRow {
  id: string                 // registry row id (PK on admin.model_role_assignments)
  model: string              // model id (e.g. 'gpt-4o', 'claude-sonnet-4')
  provider: string           // provider name (internal id)
  providerDisplay: string    // provider display name
  providerType: string       // provider type token (anthropic / openai / azure / …) — drives B'-30 rail color
  role: string               // 'chat' | 'embeddings' | 'reasoning' | …
  enabled: boolean
  priority: number
  caps: ModelCapabilities
  maxTokens: number | null
  fca: number | null         // function-calling accuracy (MCR-derived)
  inputCostPer1k: number | null
  outputCostPer1k: number | null
  costSource: 'registry' | 'mcr-estimate' | 'unknown'
  avgLatencyMs: number | null
  family: string | null
  raw: LlmRegistryRow
}

export type StatusFilter = 'all' | 'enabled' | 'disabled'

export const fmtUsd = (n?: number | null): string =>
  typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—'
export const fmtNum = (n?: number | null): string =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—'
export const fmtCostPer1M = (per1k: number | null | undefined): string => {
  if (per1k == null || !Number.isFinite(per1k)) return '—'
  // The api returns USD/1k tokens; UI shows USD/1M for readability.
  return `$${(per1k * 1000).toFixed(2)}`
}

export type Tier = 't1' | 't2' | 't3'
export function guessTier(model: string | null | undefined): Tier {
  if (!model) return 't3'
  const m = model.toLowerCase()
  if (m.includes('opus') || m.includes('o1') || m.includes('o3') || m.includes('sonnet') || m.includes('gpt-4') || m.includes('gemini-1.5-pro') || m.includes('gemini-2.5-pro')) return 't1'
  if (m.includes('haiku') || m.includes('flash') || m.includes('mini') || m.includes('lite') || m.includes('nano') || m.includes('small')) return 't2'
  return 't3'
}

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1
}

function decodeCaps(raw: any): ModelCapabilities {
  const c = raw?.capabilities ?? {}
  return {
    chat: bool(c.chat),
    embeddings: bool(c.embeddings),
    tools: bool(c.tools),
    vision: bool(c.vision),
    streaming: bool(c.streaming),
    thinking: bool(c.thinking),
    imageGeneration: bool(c.imageGeneration),
  }
}

export function buildModelRows(
  registry: LlmRegistryRow[] | undefined,
  providers: LlmProviderRow[] | undefined,
): ModelRow[] {
  const providerByName = new Map<string, LlmProviderRow>()
  for (const p of providers ?? []) {
    if (p?.name) providerByName.set(p.name, p)
  }
  return (registry ?? []).map<ModelRow>((r) => {
    const raw = r as any
    const provDisplay =
      raw.provider_display_name ?? providerByName.get(r.provider)?.displayName ?? r.provider
    const fca = (raw.functionCallingAccuracy as number | undefined) ?? null
    const costSource = (raw.costSource as ModelRow['costSource'] | undefined) ?? 'unknown'
    const provType = (
      (raw.provider_type as string | undefined) ??
      providerByName.get(r.provider)?.type ??
      r.provider ?? ''
    ).toLowerCase()
    return {
      id: r.id,
      model: r.model,
      provider: r.provider,
      providerDisplay: provDisplay,
      providerType: provType,
      role: r.role,
      enabled: r.enabled !== false,
      priority: typeof r.priority === 'number' ? r.priority : 0,
      caps: decodeCaps(raw),
      maxTokens: typeof raw.max_tokens === 'number' ? raw.max_tokens : null,
      fca,
      inputCostPer1k: typeof raw.inputCostPer1k === 'number' ? raw.inputCostPer1k : null,
      outputCostPer1k: typeof raw.outputCostPer1k === 'number' ? raw.outputCostPer1k : null,
      costSource,
      avgLatencyMs: typeof raw.avgLatencyMs === 'number' ? raw.avgLatencyMs : null,
      family: typeof raw.family === 'string' ? raw.family : null,
      raw: r,
    }
  })
}

export function computeAvgCostPer1k(rows: ModelRow[]): number | null {
  const costs = rows
    .map((r) => r.inputCostPer1k)
    .filter((n): n is number => typeof n === 'number' && n > 0)
  if (costs.length === 0) return null
  return costs.reduce((a, b) => a + b, 0) / costs.length
}

import * as React from 'react'

export const CapPill: React.FC<{
  tone: 'accent' | 'ok' | 'warn' | 'info' | 'dim'
  children: React.ReactNode
}> = ({ tone, children }) => (
  <span
    style={{
      fontFamily: 'var(--font-v3-mono)',
      fontSize: 9,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      padding: '1px 5px',
      border: '1px solid var(--line-2)',
      color: tone === 'dim' ? 'var(--fg-3)' : `var(--${tone})`,
    }}
  >
    {children}
  </span>
)

/**
 * Compact capability tag list — used in the catalog row + capabilities matrix.
 *
 * B'-30: emit `<span class="aw-cap" data-cap="...">` instead of generic
 * tone-pills so the per-capability brand colors in primitives-v3/styles.css
 * (--cap-chat / --cap-tools / --cap-vision / --cap-thinking / --cap-embeddings
 * / --cap-streaming / --cap-image-gen) light up the chips at a glance.
 */
export const CapList: React.FC<{ caps: ModelCapabilities }> = ({ caps }) => (
  <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
    {caps.chat && <span className="aw-cap" data-cap="chat">chat</span>}
    {caps.tools && <span className="aw-cap" data-cap="tools">tools</span>}
    {caps.vision && <span className="aw-cap" data-cap="vision">vision</span>}
    {caps.embeddings && <span className="aw-cap" data-cap="embeddings">embed</span>}
    {caps.streaming && <span className="aw-cap" data-cap="streaming">stream</span>}
    {caps.thinking && <span className="aw-cap" data-cap="thinking">think</span>}
    {caps.imageGeneration && <span className="aw-cap" data-cap="image-gen">image-gen</span>}
  </span>
)
