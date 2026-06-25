/**
 * RailSurfaceModal — dedicated modal/settings surface per workspace rail item.
 *
 * Per user directive 2026-05-14:
 *   > the rail in flows workspaces per user should open its own modal /
 *   > settings page for each option
 *
 * The previous fix (commit 70e6dd0d) routed rail clicks into Flows-scoped
 * SidebarSectionType slots inside WorkflowsPage's ConfigPanel. That worked
 * RBAC-wise but used an inline canvas takeover for every item, which the
 * user explicitly rejected: each rail item must have its own dedicated
 * surface that opens ON TOP of whatever the user is doing.
 *
 * Design contract:
 *   - One window CustomEvent (`openFlowsRailSurface`) opens this modal.
 *     Detail: { section: SidebarSectionType }.
 *   - The modal mounts at the app-shell level (ChatContainer) so it
 *     overlays canvas, list view, OR chat — wherever the user is when
 *     they click the rail.
 *   - Per-section sizing:
 *       settings, variables, integrations → 'lg' (focused form/list)
 *       all browse surfaces (runs, library, agents, team, tools, etc.)
 *                                            → 'xl' (room to browse)
 *       data (data-stores with tabs)        → 'full' (sub-nav fits)
 *   - Dismissable: ESC, backdrop click, header X. No accidental close
 *     when clicking inside the surface body.
 *   - Theme-aware: every surface inside uses CSS vars (already wired by
 *     the existing section content components).
 *   - Accessible: BaseModal handles role=dialog, aria-modal, aria-labelledby.
 *
 * The modal RE-USES the existing section content components from
 * SidebarSectionModal.tsx via the exported `ConfigPanel` switch — we
 * just render those components inside our own BaseModal shell instead
 * of the full-screen ConfigPanel chrome. This keeps the source of truth
 * for "what each section looks like" in one place.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { BaseModal, type ModalSize } from '@/shared/components/BaseModal';
import { Layers, Key, Users, FileText, Database, Settings as SettingsIcon, Link, Terminal, Shield, Play, Rocket, GitBranch, Star, Clock, Activity, type IconProps } from '@/shared/icons';
import type { SidebarSectionType } from './sidebar/SidebarSectionModal';

// Lazy-import the section bodies so the rail modal doesn't pull the 3700-line
// SidebarSectionModal module on initial app load. The bodies themselves are
// rendered via a re-exported switch helper.
import { renderSectionBody, sectionTitleFor } from './sidebar/sectionRenderRegistry';

const sectionSize: Record<SidebarSectionType, ModalSize> = {
  // Focused single-purpose forms — medium modal
  settings: 'lg',
  variables: 'lg',
  credentials: 'lg',
  webhooks: 'lg',
  api: 'lg',
  // Browse / gallery — extra-large
  runs: 'xl',
  insights: 'xl',
  templates: 'xl',
  my_workflows: 'xl',
  deployed: 'xl',
  agents: 'xl',
  team: 'xl',
  artifacts: 'xl',
  versions: 'xl',
  // Builder-internal (already work as drawers, but if dispatched, give them room)
  nodes: 'xl',
  playground: 'full',
  // Data has tabbed sub-nav — needs full width
  data: 'full',
};

const sectionIcon: Record<SidebarSectionType, React.ComponentType<IconProps>> = {
  nodes: Layers,
  credentials: Key,
  agents: Users,
  artifacts: FileText,
  data: Database,
  variables: SettingsIcon,
  webhooks: Link,
  api: Terminal,
  team: Shield,
  playground: Play,
  deployed: Rocket,
  my_workflows: GitBranch,
  templates: Star,
  settings: SettingsIcon,
  versions: Clock,
  runs: Play,
  insights: Activity,
};

export interface RailSurfaceModalProps {
  /** Optional active workflow id — feeds workflow-scoped sections (credentials, webhooks, team, etc.) */
  workflowId?: string;
  /** Optional variables map — for the Variables section. */
  variables?: Record<string, any>;
  /** Variables change handler. */
  onVariablesChange?: (vars: Record<string, any>) => void;
}

/**
 * Listens for `openFlowsRailSurface` window events and renders the
 * matching section inside a centered BaseModal. Self-contained — mount
 * once at the app shell and forget.
 *
 * The component is a passive listener: it doesn't dispatch anything
 * itself, so adding it to the shell is zero-risk for sections that
 * already use the in-canvas ConfigPanel path.
 */
export const RailSurfaceModal: React.FC<RailSurfaceModalProps> = ({
  workflowId,
  variables,
  onVariablesChange,
}) => {
  const [activeSection, setActiveSection] = useState<SidebarSectionType | null>(null);

  // Open via window event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.section) {
        setActiveSection(detail.section as SidebarSectionType);
      }
    };
    window.addEventListener('openFlowsRailSurface', handler);
    return () => window.removeEventListener('openFlowsRailSurface', handler);
  }, []);

  const close = useCallback(() => setActiveSection(null), []);

  if (!activeSection) return null;

  const Icon = sectionIcon[activeSection] || SettingsIcon;
  const title = sectionTitleFor(activeSection);
  const size = sectionSize[activeSection] || 'xl';

  return (
    <BaseModal
      isOpen
      onClose={close}
      size={size}
      closeOnBackdropClick
      closeOnEscape
      showHeaderBorder
      customHeader={
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background:
                'linear-gradient(135deg, var(--user-accent-primary, #FF5722) 0%, var(--user-accent-secondary, #B83A0E) 100%)',
            }}
          >
            <Icon className="w-5 h-5 text-on-accent" />
          </div>
          <div className="flex flex-col">
            <span
              className="text-[10px] font-bold tracking-[0.14em] uppercase"
              style={{ color: 'var(--user-accent-primary, #FF5722)' }}
            >
              Workspace
            </span>
            <h2
              id="modal-title"
              className="text-lg font-semibold leading-tight"
              style={{ color: 'var(--color-text)' }}
            >
              {title}
            </h2>
          </div>
        </div>
      }
      className="max-h-[90vh]"
    >
      <div data-testid={`rail-surface-${activeSection}`}>
        {renderSectionBody({
          section: activeSection,
          workflowId,
          variables,
          onVariablesChange,
        })}
      </div>
    </BaseModal>
  );
};

export default RailSurfaceModal;
