/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Admin Console (rewrite) — public barrel.
 *
 * The ground-up rewrite home. Phase 0 ships: the ADMIN_IA taxonomy SoT,
 * the ADMIN_INV option-spec inventory SoT, the Shell/TopBar/Sidebar/
 * PageHead chrome, the token-only shared primitives, and the per-leaf
 * two-part contract (body + optionSpecPanel). The 65 page bodies fill in
 * later phases.
 */
export { default as AdminConsole } from './AdminConsole'
export type { AdminConsoleProps } from './AdminConsole'

export * from './types'
export {
  ADMIN_DOMAINS,
  DOMAIN_ICONS,
  DOMAIN_BY_ID,
  LEAF_INDEX,
  LEAF_BY_MNEMONIC,
  LEAF_COUNT,
  DEFAULT_OPEN_GROUPS,
  HOME_DOMAIN_ID,
  domainOfLeaf,
} from './ADMIN_IA'
export { ADMIN_INV, ADMIN_INV_OPTION_COUNT } from './ADMIN_INV'
export { leafMode, leafModeLabel, leafPrimaryAction, leafOptionCount } from './leafMeta'

export * from './primitives'
export * from './chrome'
