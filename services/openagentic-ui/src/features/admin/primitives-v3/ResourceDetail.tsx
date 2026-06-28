import * as React from 'react'
import './styles.css'

export type ResourceTabId =
  | 'overview'
  | 'details'
  | 'permissions'
  | 'logs'
  | 'monitoring'
  | 'history'

export interface ResourceTab {
  id: ResourceTabId
  label: string
  body: React.ReactNode
}

export interface ResourceDetailProps {
  title: string
  meta: React.ReactNode
  tabs: ResourceTab[]
  activeTab: ResourceTabId
  onTabChange: (id: ResourceTabId) => void
  headerActions?: React.ReactNode
}

const CANONICAL_ORDER: ResourceTabId[] = [
  'overview',
  'details',
  'permissions',
  'logs',
  'monitoring',
  'history',
]

const ORDER_INDEX: Record<ResourceTabId, number> = CANONICAL_ORDER.reduce(
  (acc, id, i) => {
    acc[id] = i
    return acc
  },
  {} as Record<ResourceTabId, number>,
)

export const ResourceDetail: React.FC<ResourceDetailProps> = ({
  title,
  meta,
  tabs,
  activeTab,
  onTabChange,
  headerActions,
}) => {
  const orderedTabs = React.useMemo(
    () => [...tabs].sort((a, b) => ORDER_INDEX[a.id] - ORDER_INDEX[b.id]),
    [tabs],
  )
  const active = orderedTabs.find((t) => t.id === activeTab)

  return (
    <div className="aw-resource-detail">
      <div className="aw-resource-detail__head">
        <div className="aw-resource-detail__head__left">
          <div className="aw-resource-detail__title">{title}</div>
          <div className="aw-resource-detail__meta">{meta}</div>
        </div>
        {headerActions && (
          <div className="aw-resource-detail__head__right">{headerActions}</div>
        )}
      </div>
      <div className="aw-resource-detail__tabs">
        {orderedTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="aw-resource-detail__tab"
            data-tab-id={t.id}
            data-active={t.id === activeTab ? 'true' : undefined}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="aw-resource-detail__body">
        {active?.body ?? null}
      </div>
    </div>
  )
}
