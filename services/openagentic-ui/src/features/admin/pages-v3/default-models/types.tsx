import type { LlmRegistryRow, ModelUsageRow } from '../../hooks/useDashboardMetrics'

/**
 * The 5 conceptual roles the api accepts on the PUT body. The api
 * currently exposes exactly these keys; any future expansion (agents,
 * classifier, compaction…) needs both an api-side patch + a new entry
 * here. We keep the v2 vocabulary so existing operator muscle memory
 * still works.
 */
export type RoleKey = 'chat' | 'code' | 'embedding' | 'vision' | 'imageGen'

export const ROLE_KEYS: RoleKey[] = ['chat', 'code', 'embedding', 'vision', 'imageGen']

export interface RoleMeta {
  key: RoleKey
  label: string
  useCase: string
  description: string
  appliedTo: string[]
}

export const ROLE_META: Record<RoleKey, RoleMeta> = {
  chat: {
    key: 'chat',
    label: 'Chat',
    useCase: 'Conversation',
    description: 'New chat sessions with no explicit pin route here.',
    appliedTo: ['ChatCompletionService', 'session defaults'],
  },
  code: {
    key: 'code',
    label: 'Code mode',
    useCase: 'Coding',
    description: 'Openagentic / code-mode sessions fall back here.',
    appliedTo: ['Openagentic CLI', '/api/openagentic routes'],
  },
  embedding: {
    key: 'embedding',
    label: 'Embeddings',
    useCase: 'Retrieval',
    description: 'Semantic search, memory, RAG. Smart Router never touches this.',
    appliedTo: ['UniversalEmbeddingService', 'Milvus indexing', 'MemoryService', 'DocsRAGService'],
  },
  vision: {
    key: 'vision',
    label: 'Vision',
    useCase: 'Multimodal',
    description: 'Image-containing chat messages route here.',
    appliedTo: ['vision-capable chat messages'],
  },
  imageGen: {
    key: 'imageGen',
    label: 'Image Gen',
    useCase: 'Generation',
    description: '`generate_image` tool dispatches here.',
    appliedTo: ['generate_image tool'],
  },
}

export interface DefaultModels {
  chat: string | null
  code: string | null
  embedding: string | null
  vision: string | null
  imageGen: string | null
}

export interface DefaultModelsResponse {
  defaults: DefaultModels
  updatedAt?: string
  updatedBy?: string
}

/**
 * A row for the Roles table. `assignedModel` is the literal model id
 * persisted on the role (or `null` when unset / `auto` when smart-router).
 * `match` is the registry row that matched the assigned id — null when
 * the assignment is stale (still on a model that's no longer enabled).
 */
export interface RoleRow {
  key: RoleKey
  meta: RoleMeta
  assignedModel: string | null
  isAuto: boolean
  isStale: boolean
  match: LlmRegistryRow | null
  usage: ModelUsageRow | null
}

export type Tier = 't1' | 't2' | 't3'

/**
 * Heuristic tier guess from a model id. The api doesn't yet expose a
 * canonical tier on the registry row, so this lives client-side. Lines
 * up with the v2 DefaultModelsView.guessTier pills (frontier→t1, mid→t2,
 * local→t3) so operators see the same colors across pages.
 */
export function guessTier(model: string | null | undefined): Tier {
  if (!model) return 't3'
  const m = model.toLowerCase()
  if (m.includes('opus') || m.includes('o1') || m.includes('o3') || m.includes('sonnet') || m.includes('gpt-4') || m.includes('gemini-1.5-pro') || m.includes('gemini-2.5-pro')) return 't1'
  if (m.includes('haiku') || m.includes('flash') || m.includes('mini') || m.includes('lite') || m.includes('nano') || m.includes('small')) return 't2'
  return 't3'
}

export const fmtUsd = (n?: number | null): string =>
  typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—'
export const fmtNum = (n?: number | null): string =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—'
export const fmtPct = (n?: number | null): string =>
  typeof n === 'number' && Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—'

export const AUTO_VALUE = 'auto'

/**
 * Build the cross-referenced row set the panes actually consume.
 *
 * - `defaults` may be null (loading) — treated as all-unset.
 * - `registryRows` may be empty (loading or error) — match falls to null.
 * - `modelUsage` may be missing — usage falls to null.
 */
export function buildRoleRows(
  defaults: DefaultModels | null,
  registryRows: LlmRegistryRow[] | undefined,
  modelUsage: ModelUsageRow[] | undefined,
): RoleRow[] {
  const usageByModel = new Map<string, ModelUsageRow>()
  for (const u of modelUsage ?? []) {
    if (u?.model) usageByModel.set(u.model, u)
  }
  const registryByModel = new Map<string, LlmRegistryRow>()
  for (const r of registryRows ?? []) {
    if (r?.model) {
      // Last write wins — same model under multiple roles is fine, the
      // assignment row determines what role uses it. We just need any
      // enriched row to back the table.
      registryByModel.set(r.model, r)
    }
  }
  return ROLE_KEYS.map<RoleRow>((key) => {
    const assigned = defaults?.[key] ?? null
    const isAuto = assigned === AUTO_VALUE
    const match = assigned && !isAuto ? registryByModel.get(assigned) ?? null : null
    const usage = assigned && !isAuto ? usageByModel.get(assigned) ?? null : null
    const isStale = !!assigned && !isAuto && match == null
    return {
      key,
      meta: ROLE_META[key],
      assignedModel: assigned,
      isAuto,
      isStale,
      match,
      usage,
    }
  })
}

/**
 * Light-weight client-side simulation: rank registry models for a role.
 * Mirrors the v2 RouterTuningView score formula but stripped to the
 * fields actually present on a registry row. Returned in score-desc.
 */
export interface AltScore {
  model: string
  provider: string
  fca: number | null
  inputCostPer1k: number | null
  score: number
}

export function rankAltModels(
  rows: LlmRegistryRow[] | undefined,
  currentModel: string | null,
  costWeight = 0.5,
  qualityWeight = 0.5,
): AltScore[] {
  if (!rows || rows.length === 0) return []
  const candidates = rows.filter((r) => r.enabled !== false && r.model !== currentModel)
  const ranked = candidates.map((r) => {
    const fca = (r.functionCallingAccuracy as number | undefined) ?? null
    const cost = (r.inputCostPer1k as number | undefined) ?? null
    // Cheaper-is-better: higher score for lower cost (clamped at $0.02/1k ceiling).
    const costScore = cost == null ? 0 : Math.max(0, 1 - cost / 0.02) * 25
    // Quality bonus mirrors RouterTuningLab: max(0, fca - 0.75) * 100
    const qualityScore = fca == null ? 0 : Math.max(0, fca - 0.75) * 100
    const score = costScore * costWeight + qualityScore * qualityWeight
    return {
      model: r.model,
      provider: (r as any).provider_display_name ?? r.provider,
      fca,
      inputCostPer1k: cost,
      score,
    }
  })
  ranked.sort((a, b) => b.score - a.score)
  return ranked
}
