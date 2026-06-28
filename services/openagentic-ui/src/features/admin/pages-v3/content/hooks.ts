import { useAdminQuery } from '../../hooks/useAdminQuery'

// PromptTemplateRow + useTemplates() removed (Phase W 2026-05-19).
// /api/admin/prompts/templates returns 404 — PromptTemplate Prisma model dropped.
// TemplatesPane + TemplateModal deleted from ContentHubPage as well.

// ============================================================
// /api/admin/shared-kb/sources
// ============================================================
export type SharedKBType = 'webpage' | 'document' | 'rss' | 'http' | 'database' | 'agent'

export interface SharedKBSourceRow {
  id: string
  name: string
  description: string | null
  type: SharedKBType
  config: Record<string, unknown>
  enabled: boolean
  schedule: string | null
  last_ingest_at: string | null
  last_ingest_status: string | null
  last_ingest_error: string | null
  doc_count: number
  chunk_count: number
  created_at: string
  updated_at: string
}

export function useSharedKBSources() {
  return useAdminQuery<{ sources?: SharedKBSourceRow[] }>(
    ['content', 'shared-kb', 'sources'],
    '/api/admin/shared-kb/sources',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// Data layer — three pillars (Redis / Milvus / vector-usage)
// Server endpoints mirror v2 UnifiedDataLayerView.
// ============================================================
export interface RedisMetrics {
  memory?: { used?: number; peak?: number; total?: number; fragmentation_ratio?: number }
  keys?: number
  hit_rate?: number
  hits?: number
  misses?: number
  clients?: number
  commands_per_sec?: number
  evicted_keys?: number
  eviction_policy?: string
  aof_enabled?: boolean
  rdb_last_save?: string | null
  connected?: boolean
  uptime_seconds?: number
  version?: string
}

export interface MilvusMetrics {
  collections?: number
  queries?: number
  latency?: number
  inserts?: number
  connected?: boolean
  mode?: string
  healthy?: boolean
  minio_connected?: boolean
}

export interface VectorUsageRow {
  pgvectorTotals?: {
    userMemories?: number
    toolResultCache?: number
    verifiedToolResults?: number
    toolSuccessRecords?: number
    queryEmbeddingCache?: number
    userVectorCollections?: number
  }
  milvusCollections?: Array<{
    name: string
    rowCount: number
    dimension?: number
    indexType?: string
  }>
  milvusTotalRows?: number
  milvusTotalCollections?: number
}

export function useRedisMetrics() {
  return useAdminQuery<RedisMetrics>(
    ['content', 'data-layer', 'redis'],
    '/api/admin/metrics/redis',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

export function useMilvusMetrics() {
  return useAdminQuery<MilvusMetrics>(
    ['content', 'data-layer', 'milvus'],
    '/api/admin/metrics/milvus',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
}

export function useVectorUsage() {
  return useAdminQuery<VectorUsageRow>(
    ['content', 'data-layer', 'vector-usage'],
    '/api/admin/metrics/vector-usage',
    { staleTime: 60_000, refetchInterval: 120_000 },
  )
}

// ============================================================
// /api/admin/user-context/overview — User Memory pillar
// ============================================================
export interface UserContextOverview {
  totalEntries: number
  bySource: { chat: number; code: number; workflow: number; memory: number }
  totalUsers: number
  storageBytes: number
}

export interface UserContextSummary {
  userId: string
  email: string
  name: string
  chatEntries: number
  codeEntries: number
  workflowEntries: number
  memoryEntries: number
  totalEntries: number
  lastActivity: string
}

export interface UserContextOverviewResponse {
  overview?: UserContextOverview
  users?: Array<{
    userId?: string
    user_id?: string
    email?: string
    name?: string
    chatEntries?: number
    codeEntries?: number
    workflowEntries?: number
    memoryEntries?: number
    totalEntries?: number
    entryCount?: number
    lastActivity?: string
  }>
}

export function useUserContextOverview() {
  return useAdminQuery<UserContextOverviewResponse>(
    ['content', 'user-context', 'overview'],
    '/api/admin/user-context/overview',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
}

// ============================================================
// Format helpers
// ============================================================
export function fmtNum(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

export function fmtBytes(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(n) / Math.log(k))
  return `${(n / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function fmtRelTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return iso
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function normalizeUserContextUsers(
  rows: UserContextOverviewResponse['users'],
): UserContextSummary[] {
  if (!rows) return []
  return rows.map((u) => ({
    userId: u.userId ?? u.user_id ?? '',
    email: u.email ?? u.userId ?? u.user_id ?? '—',
    name: u.name ?? u.email ?? u.userId ?? u.user_id ?? '—',
    chatEntries: u.chatEntries ?? 0,
    codeEntries: u.codeEntries ?? 0,
    workflowEntries: u.workflowEntries ?? 0,
    memoryEntries: u.memoryEntries ?? 0,
    totalEntries: u.totalEntries ?? u.entryCount ?? 0,
    lastActivity: u.lastActivity ?? '',
  }))
}
