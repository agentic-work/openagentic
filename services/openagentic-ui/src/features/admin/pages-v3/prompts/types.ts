export function fmtModuleDate(iso: string | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const d = new Date(t)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${z(d.getUTCMonth() + 1)}-${z(d.getUTCDate())}`
}

export function fmtNum(n: number | undefined | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(Math.round(n))
}

export function fmtPct(num: number, denom: number): string {
  if (!denom) return '—'
  return `${Math.round((num / denom) * 100)}%`
}

/** Aggregated effectiveness score per module (win rate × usage). */
export function moduleEffectivenessScore(row: {
  usageCount: number
  positiveCount: number
  negativeCount: number
}): number {
  const rated = row.positiveCount + row.negativeCount
  if (!rated) return 0
  return (row.positiveCount / rated) * 100
}
