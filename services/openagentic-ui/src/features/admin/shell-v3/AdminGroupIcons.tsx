import * as React from 'react'

interface IconProps {
  size?: number
  className?: string
}

const wrap = (paths: React.ReactNode) => {
  const Icon: React.FC<IconProps> = ({ size = 14, className }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      aria-hidden="true"
    >
      {paths}
    </svg>
  )
  return Icon
}

// Overview — 2×2 grid (dashboard tile glyph).
export const IconOverview = wrap(
  <>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </>,
)

// System Management — server stack.
export const IconSystem = wrap(
  <>
    <rect x="3" y="4" width="18" height="6" />
    <rect x="3" y="14" width="18" height="6" />
    <line x1="6" y1="7" x2="6.01" y2="7" />
    <line x1="6" y1="17" x2="6.01" y2="17" />
  </>,
)

// LLM — brain/network nodes.
export const IconLlm = wrap(
  <>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="12" cy="18" r="2.5" />
    <line x1="8" y1="7" x2="16" y2="7" />
    <line x1="7" y1="8" x2="11" y2="16" />
    <line x1="17" y1="8" x2="13" y2="16" />
  </>,
)

// Tools Management — wrench.
export const IconTools = wrap(
  <>
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5h-2v-2l2.5-2.5z" />
  </>,
)

// OpenAgentic Flows — branching workflow nodes.
export const IconFlows = wrap(
  <>
    <circle cx="5" cy="6" r="2" />
    <circle cx="19" cy="6" r="2" />
    <circle cx="5" cy="18" r="2" />
    <circle cx="19" cy="18" r="2" />
    <circle cx="12" cy="12" r="2" />
    <line x1="6.5" y1="7" x2="10.5" y2="11" />
    <line x1="17.5" y1="7" x2="13.5" y2="11" />
    <line x1="6.5" y1="17" x2="10.5" y2="13" />
    <line x1="17.5" y1="17" x2="13.5" y2="13" />
  </>,
)

// Code Mode — angle brackets.
export const IconCode = wrap(
  <>
    <polyline points="8 6 3 12 8 18" />
    <polyline points="16 6 21 12 16 18" />
    <line x1="14" y1="4" x2="10" y2="20" />
  </>,
)

// Agent Management — head silhouette.
export const IconAgents = wrap(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
  </>,
)

// Integrations — chain links.
export const IconIntegrations = wrap(
  <>
    <path d="M10 13a4 4 0 0 1 0-6l3-3a4 4 0 0 1 6 6l-1.5 1.5" />
    <path d="M14 11a4 4 0 0 1 0 6l-3 3a4 4 0 0 1-6-6l1.5-1.5" />
  </>,
)

// Prompts — chat bubble with line.
export const IconPrompts = wrap(
  <>
    <path d="M21 12c0 4-4 7-9 7-1.5 0-3-.3-4-.7L3 20l1.7-4C3.6 14.7 3 13.4 3 12c0-4 4-7 9-7s9 3 9 7z" />
    <line x1="8" y1="11" x2="16" y2="11" />
    <line x1="8" y1="14" x2="14" y2="14" />
  </>,
)

// Content — document with corner fold.
export const IconContent = wrap(
  <>
    <path d="M14 3H6v18h12V7l-4-4z" />
    <polyline points="14 3 14 7 18 7" />
    <line x1="9" y1="12" x2="15" y2="12" />
    <line x1="9" y1="16" x2="15" y2="16" />
  </>,
)

// Chargeback — dollar sign.
export const IconChargeback = wrap(
  <>
    <line x1="12" y1="2" x2="12" y2="22" />
    <path d="M17 6H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H7" />
  </>,
)

// Monitoring — pulse line.
export const IconMonitoring = wrap(
  <>
    <polyline points="2 12 6 12 9 5 13 19 16 12 22 12" />
  </>,
)

/**
 * Map admin group title → icon component. Title comparison is
 * case-insensitive so the data stays declarative.
 */
const ICON_BY_GROUP: Record<string, React.FC<IconProps>> = {
  'overview': IconOverview,
  'system management': IconSystem,
  'llm': IconLlm,
  'tools management': IconTools,
  'openagentic flows': IconFlows,
  'code mode': IconCode,
  'agent management': IconAgents,
  'integrations': IconIntegrations,
  'prompts': IconPrompts,
  'content': IconContent,
  'chargeback': IconChargeback,
  'monitoring': IconMonitoring,
}

export function getGroupIcon(title: string): React.FC<IconProps> | undefined {
  return ICON_BY_GROUP[title.toLowerCase()]
}
