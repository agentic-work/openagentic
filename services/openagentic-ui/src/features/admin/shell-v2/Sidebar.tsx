import React, { useMemo, useState } from 'react'
import { SIDEBAR_GROUPS, TOP_LEVEL_ITEMS, SidebarLeaf } from './sidebar-items'
import { featureFlags } from '../../../config/featureFlags'
import { useUIVisibilityStore } from '../../../stores/useUIVisibilityStore'
import { useTheme } from '../../../contexts/ThemeContext'
import SettingsMenu from '../../chat/components/SettingsMenu'
import {
  DashboardOverviewIcon,
  SystemManagementIcon,
  LLMSparkleIcon,
  MCPToolsIcon,
  WorkflowFlowIcon,
  AgentOrchestrationIcon,
  SparkleIcon,
  ContentDataIcon,
  ChargebackCoinIcon,
  MonitoringPulseIcon,
  SecurityFortressIcon,
  CogIcon,
} from '../components/Shared/AdminIcons'
import { Globe, X } from 'lucide-react'

type Flags = typeof featureFlags

function groupVisible(featureGate: 'mcp' | undefined, flags: Flags): boolean {
  if (!featureGate) return true
  return Boolean((flags as any)[featureGate])
}

function childVisible(_leafId: string, _flags: Flags): boolean {
  return true
}

// Custom icons per sidebar group — mirrors v1 AdminPortal.sidebarItems exactly.
const GROUP_ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
  system: SystemManagementIcon,
  llm: LLMSparkleIcon,
  tools: MCPToolsIcon,
  'native-workflows': WorkflowFlowIcon,
  'agent-management': AgentOrchestrationIcon,
  integrations: Globe as any,
  'prompt-engineering': SparkleIcon,
  content: ContentDataIcon,
  chargeback: ChargebackCoinIcon,
  monitoring: MonitoringPulseIcon,
  security: SecurityFortressIcon,
}

export function Sidebar({ active, onNavigate }: { active: string; onNavigate: (id: string) => void }) {
  const closeAdmin = useUIVisibilityStore(s => s.close)
  const { theme } = useTheme()

  const groupOfActive = useMemo(
    () => SIDEBAR_GROUPS.find(g => g.children.some(c => c.id === active))?.id,
    [active],
  )
  const [open, setOpen] = useState<Set<string>>(() => new Set(groupOfActive ? [groupOfActive] : ['llm']))

  const toggle = (id: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const renderLeaf = (leaf: SidebarLeaf) => (
    <button
      key={leaf.id}
      data-section-id={leaf.id}
      data-testid="sidebar-leaf"
      onClick={() => onNavigate(leaf.id)}
      aria-current={active === leaf.id ? 'page' : undefined}
      className={[
        'w-full text-left pl-10 pr-4 py-1 flex items-center justify-between text-[12px]',
        active === leaf.id
          ? 'text-fg-0 bg-bg-2 border-l-2 border-pri'
          : 'text-fg-2 hover:text-fg-0 hover:bg-bg-2',
      ].join(' ')}
    >
      <span>{leaf.label}</span>
      {leaf.badge && (
        <span
          className={[
            'text-[9px] font-mono px-1 py-0 rounded',
            leaf.badge === 'Live' && 'bg-ok/20 text-ok',
            leaf.badge === 'Beta' && 'bg-info/20 text-info',
            leaf.badge === 'deprecated' && 'bg-warn/20 text-warn',
          ].filter(Boolean).join(' ')}
        >
          {leaf.badge}
        </span>
      )}
    </button>
  )

  return (
    <aside className="h-full bg-bg-0 border-r border-ln-2 font-ui flex flex-col overflow-hidden">
      {/* Sidebar header — matches v1: Cog + "Admin Console" + close X on the right */}
      <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between border-b border-ln-2">
        <div className="flex items-center gap-2.5">
          <CogIcon size={18} className="text-pri" />
          <span className="font-semibold text-fg-0 text-[14px] tracking-tight">Admin Console</span>
        </div>
        <button
          data-testid="admin-close"
          onClick={() => closeAdmin('showAdminPortal')}
          className="p-1.5 rounded text-fg-3 hover:bg-bg-2 hover:text-fg-0 transition-colors"
          title="Close admin (back to chat)"
          aria-label="Close admin portal"
        >
          <X size={16} />
        </button>
      </div>
      {/* Scrollable nav — takes all space above the fixed footer */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-fg-3 font-bold font-mono">
          overview
        </div>
        {TOP_LEVEL_ITEMS.map(item => (
          <button
            key={item.id}
            data-section-id={item.id}
            data-testid="sidebar-top-level"
            onClick={() => onNavigate(item.id)}
            aria-current={active === item.id ? 'page' : undefined}
            className={[
              'w-full text-left px-4 py-1.5 text-[12px] flex items-center gap-2',
              active === item.id
                ? 'text-fg-0 bg-bg-2 border-l-2 border-pri'
                : 'text-fg-2 hover:text-fg-0 hover:bg-bg-2',
            ].join(' ')}
          >
            <DashboardOverviewIcon size={14} />
            <span>{item.label}</span>
          </button>
        ))}

        {SIDEBAR_GROUPS.filter(g => groupVisible(g.featureGate, featureFlags)).map(group => {
          const isOpen = open.has(group.id)
          const Icon = GROUP_ICONS[group.id]
          return (
            <div key={group.id}>
              <button
                data-group-id={group.id}
                data-group-open={isOpen ? 'true' : 'false'}
                data-testid="sidebar-group-toggle"
                onClick={() => toggle(group.id)}
                className="w-full text-left px-4 py-2 text-fg-2 hover:text-fg-0 hover:bg-bg-2 flex items-center gap-2 text-[12px] border-t border-ln-1 mt-1"
              >
                {Icon ? <Icon size={14} /> : <span className="w-[14px]"/>}
                <span className="flex-1">{group.label}</span>
                <span className="text-fg-3 text-[10px]">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen &&
                group.children
                  .filter(c => childVisible(c.id, featureFlags))
                  .map(renderLeaf)}
            </div>
          )
        })}
      </div>

      {/* Footer — pinned to viewport bottom; NOT inside the scroll container.
          Uses v1's SettingsMenu (full dropdown: user / help / themes / logout),
          same props v1 AdminPortal passes: isExpanded=true, isAdmin=true. */}
      <div className="flex-shrink-0 border-t border-ln-2 bg-bg-0 px-3 py-3" data-testid="admin-settings-and-more">
        <SettingsMenu
          isExpanded={true}
          currentTheme={theme}
          isAdmin={true}
          onLogout={() => { window.location.href = '/' }}
        />
      </div>
    </aside>
  )
}
