/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Admin Console primitives — barrel.
 *
 * Single import surface for every console page + chrome:
 *   import { PageHead, KpiStrip, DataTable, OptionSpec, ... }
 *     from '@/features/admin/console/primitives'
 *
 * Every primitive is token-only (CLAUDE.md Rule 8b). Charts pass theme
 * tokens, never literals.
 */
export * from './atoms'
export * from './charts'
export * from './layout'
export * from './DataTable'
export * from './OptionSpec'
