/**
 * Copyright (c) 2024-2026 AgenticWork LLC. All rights reserved.
 *
 * Per-leaf page registry — the dispatch table the AdminConsole uses to
 * render a leaf's REAL page when one has shipped, falling back to
 * PlaceholderLeaf (chrome + optionSpec) when it has not.
 *
 * Domain page modules (pages/models.tsx, pages/flows.tsx, …) each export a
 * `Record<leafId, ComponentType<LeafPageProps>>`; this barrel composes them
 * into LEAF_PAGES as they land. The two-part leaf contract (body +
 * optionSpec) is applied by AdminConsole — so a registered leaf page renders
 * ONLY its body and NEVER its own optionSpec.
 */
import type { ComponentType } from 'react'

export interface LeafPageProps {
  leafId: string
}

// Domain page modules — each exports Record<leafId, ComponentType<LeafPageProps>>.
// (LeafPageProps is a type-only import on their side, so no runtime import cycle.)
import { flowsPages } from './flows'
import { agentsPages } from './agents'
import { toolsPages } from './tools'
import { promptsPages } from './prompts'
import { contentPages } from './content'
import { modelsPages } from './models'
import { obsPages } from './obs'
import { integrationsPages } from './integrations'
import { systemPages } from './system'

/**
 * Canonical leaf id → real page component. Empty until a domain ships its
 * pages; a leaf absent here renders the PlaceholderLeaf fallback. Domain
 * modules are spread in here by the controller as each phase lands, e.g.:
 *   export const LEAF_PAGES = { ...modelsPages, ...flowsPages }
 */
export const LEAF_PAGES: Record<string, ComponentType<LeafPageProps>> = {
  // domains land here as they ship (Phase 2+)
  ...flowsPages,
  ...agentsPages,
  ...toolsPages,
  ...promptsPages,
  ...contentPages,
  ...modelsPages,
  ...obsPages,
  ...integrationsPages,
  ...systemPages,
}

/** Resolve a leaf's real page component, or undefined to fall back. */
export function getLeafPage(leafId: string): ComponentType<LeafPageProps> | undefined {
  return LEAF_PAGES[leafId]
}

export { HomePage } from './HomePage'
export type { HomePageProps } from './HomePage'
