import type { ApiUser } from '../../hooks/useUserManagement'

export type UserStatus = 'active' | 'warned' | 'locked'
export type UserRole = 'admin' | 'user'

export function statusOf(u: ApiUser): UserStatus {
  if (u.is_locked) return 'locked'
  if ((u.scope_warning_count ?? 0) > 0) return 'warned'
  return 'active'
}

export function roleOf(u: ApiUser): UserRole {
  return u.is_admin ? 'admin' : 'user'
}

/**
 * 2-letter initials from name (preferred) or email local-part.
 *  "Trent Cuthbert" → "TC"
 *  "alice@example.com" → "AL"
 *  "" → "?"
 */
export function initialsFor(u: ApiUser): string {
  const src = (u.name && u.name.trim()) || u.email.split('@')[0] || ''
  const parts = src
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  if (parts.length === 1) {
    const p = parts[0]
    return (p[0] + (p[1] ?? '')).toUpperCase()
  }
  return '?'
}

/**
 * Compact relative time ("2m", "3h", "5d", "12d") — used in dense
 * tables where there's no room for "2 minutes ago".
 */
export function relativeTimeShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const now = Date.now()
  const diffMs = Math.max(0, now - t)
  const sec = Math.round(diffMs / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d`
  const mo = Math.round(day / 30)
  if (mo < 12) return `${mo}mo`
  const yr = Math.round(mo / 12)
  return `${yr}y`
}

/**
 * "Active in last 7 days" filter — used by the KPI row.
 */
export function isActiveInLastDays(u: ApiUser, days: number, now = Date.now()): boolean {
  if (!u.last_login_at) return false
  const t = new Date(u.last_login_at).getTime()
  if (!Number.isFinite(t)) return false
  return now - t <= days * 24 * 60 * 60 * 1000
}
