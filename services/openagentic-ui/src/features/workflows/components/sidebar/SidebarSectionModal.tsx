/**
 * SidebarSectionModal - Full-screen configurable modal for each sidebar section
 * Opens in the main content area with expanded configuration options.
 *
 * This file is a thin dispatcher: the per-section content bodies live in
 * ./SidebarSectionModal/content/* and the shared helpers/types/styles live in
 * ./SidebarSectionModal/sectionShared. The three near-duplicate section
 * switches below (ConfigPanel, the legacy SidebarSectionModal, and
 * renderSectionBody) are kept distinct on purpose — the `variables`
 * empty-state differs between them — so behavior stays identical.
 */

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ChevronRight, Settings, Key, Database, Users, Play, Clock,
  Link, FileText, Layers, Terminal, Rocket, GitBranch, Star, Activity, Shield,
  type LucideIcon,
} from '@/shared/icons';
import {
  sectionTitles,
  type SidebarSectionType,
  type WorkflowSettings,
  type WorkflowVersion,
} from './SidebarSectionModal/sectionShared';
import {
  NodesContent,
  CredentialsContent,
  AgentsContent,
  DataContent,
  VariablesContent,
  WebhooksContent,
  ApiEndpointContent,
  TeamContent,
  PlaygroundContent,
  WorkflowCardGridView,
  SettingsContent,
  RunsContent,
  InsightsContent,
  VersionsContent,
  ArtifactsModalContent,
} from './SidebarSectionModal/content';

export type { SidebarSectionType } from './SidebarSectionModal/sectionShared';

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface SidebarSectionModalProps {
  section: SidebarSectionType | null;
  isOpen: boolean;
  onClose: () => void;
  workflowId?: string;
  variables?: Record<string, unknown>;
  onVariablesChange?: (vars: Record<string, unknown>) => void;
  workflowSettings?: WorkflowSettings;
  onSettingsChange?: (settings: WorkflowSettings) => void;
  versions?: WorkflowVersion[];
  onRestoreVersion?: (versionId: string) => void;
}

// ---------------------------------------------------------------------------
// Section icon map
// ---------------------------------------------------------------------------

const sectionIcons: Record<SidebarSectionType, LucideIcon> = {
  nodes: Layers,
  credentials: Key,
  agents: Users,
  artifacts: FileText,
  data: Database,
  variables: Settings,
  webhooks: Link,
  api: Terminal,
  team: Shield,
  // marketplace removed
  playground: Play,
  deployed: Rocket,
  my_workflows: GitBranch,
  templates: Star,
  settings: Settings,
  versions: Clock,
  runs: Play,
  insights: Activity,
};

// ---------------------------------------------------------------------------
// INLINE CONFIG PANEL — replaces the canvas area (Flowise-style)
// ---------------------------------------------------------------------------

export interface ConfigPanelProps {
  section: SidebarSectionType;
  onClose: () => void;
  workflowId?: string;
  variables?: Record<string, unknown>;
  onVariablesChange?: (vars: Record<string, unknown>) => void;
  workflowSettings?: WorkflowSettings;
  onSettingsChange?: (settings: WorkflowSettings) => void;
  versions?: WorkflowVersion[];
  onRestoreVersion?: (versionId: string) => void;
}

export const ConfigPanel: React.FC<ConfigPanelProps> = ({
  section,
  onClose,
  workflowId,
  variables,
  onVariablesChange,
  workflowSettings,
  onSettingsChange,
  versions,
  onRestoreVersion,
}) => {
  const renderContent = () => {
    switch (section) {
      case 'nodes':
        return <NodesContent />;
      case 'credentials':
        return <CredentialsContent workflowId={workflowId} />;
      case 'agents':
        return <AgentsContent />;
      case 'data':
        return <DataContent />;
      case 'variables':
        if (variables && onVariablesChange) {
          return <VariablesContent variables={variables} onVariablesChange={onVariablesChange} />;
        }
        return <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Open a workflow to manage variables</div>;
      case 'webhooks':
        return <WebhooksContent workflowId={workflowId} />;
      case 'api':
        return <ApiEndpointContent workflowId={workflowId} />;
      case 'team':
        return <TeamContent workflowId={workflowId} />;
      case 'playground':
        return <PlaygroundContent />;
      case 'deployed':
        return <WorkflowCardGridView filter="deployed" />;
      case 'my_workflows':
        return <WorkflowCardGridView filter="my" />;
      case 'templates':
        return <WorkflowCardGridView filter="templates" />;
      case 'settings':
        return <SettingsContent workflowSettings={workflowSettings} onSettingsChange={onSettingsChange} />;
      case 'versions':
        return <VersionsContent versions={versions} onRestoreVersion={onRestoreVersion} />;
      case 'runs':
        return <RunsContent />;
      case 'insights':
        return <InsightsContent />;
      case 'artifacts':
        return <ArtifactsModalContent />;
      default:
        return null;
    }
  };

  const SectionIcon = sectionIcons[section] || Settings;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg)' }}>
      {/* Top bar — matches the toolbar style of WorkflowsContainer */}
      <div
        className="glass-surface flex items-center justify-between px-6 py-3 border-b flex-shrink-0"
        style={{ borderRadius: 0, borderColor: 'var(--glass-border)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-colors hover:bg-[var(--color-surface)]"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            Back to Canvas
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-accent)' }}>
              <SectionIcon className="w-4 h-4 text-text" />
            </div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              {sectionTitles[section]}
            </h1>
          </div>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className={`flex-1 ${section === 'playground' ? 'flex flex-col' : 'overflow-y-auto wf-scrollbar'}`}>
        <div className={section === 'playground' ? 'flex-1 flex flex-col' : 'max-w-4xl mx-auto px-8 py-6'}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// LEGACY MODAL COMPONENT (kept for sidebar quick-peek usage)
// ---------------------------------------------------------------------------

export const SidebarSectionModal: React.FC<SidebarSectionModalProps> = ({
  section,
  isOpen,
  onClose,
  workflowId,
  variables,
  onVariablesChange,
  workflowSettings,
  onSettingsChange,
  versions,
  onRestoreVersion,
}) => {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const renderContent = () => {
    if (!section) return null;
    switch (section) {
      case 'nodes':
        return <NodesContent />;
      case 'credentials':
        return <CredentialsContent workflowId={workflowId} />;
      case 'agents':
        return <AgentsContent />;
      case 'data':
        return <DataContent />;
      case 'variables':
        if (variables && onVariablesChange) {
          return <VariablesContent variables={variables} onVariablesChange={onVariablesChange} />;
        }
        return <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Open a workflow to manage variables</div>;
      case 'webhooks':
        return <WebhooksContent workflowId={workflowId} />;
      case 'api':
        return <ApiEndpointContent workflowId={workflowId} />;
      case 'team':
        return <TeamContent workflowId={workflowId} />;
      case 'playground':
        return <PlaygroundContent />;
      case 'deployed':
        return <WorkflowCardGridView filter="deployed" />;
      case 'my_workflows':
        return <WorkflowCardGridView filter="my" />;
      case 'templates':
        return <WorkflowCardGridView filter="templates" />;
      case 'settings':
        return <SettingsContent workflowSettings={workflowSettings} onSettingsChange={onSettingsChange} />;
      case 'versions':
        return <VersionsContent versions={versions} onRestoreVersion={onRestoreVersion} />;
      case 'runs':
        return <RunsContent />;
      case 'insights':
        return <InsightsContent />;
      case 'artifacts':
        return <ArtifactsModalContent />;
      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && section && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50"
            style={{ backgroundColor: 'color-mix(in srgb, #000000 60%, transparent)' }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
            style={{ padding: section === 'data' ? '2vh 2vw' : '3vh 4vw' }}
          >
            <div
              className="glass w-full h-full flex flex-col pointer-events-auto"
              style={{
                maxWidth: section === 'data' ? '96vw' : section === 'nodes' ? '80vw' : '60vw',
                maxHeight: section === 'data' ? '96vh' : '90vh',
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-8 py-5 border-b flex-shrink-0"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <h2 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>
                  {sectionTitles[section]}
                </h2>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg transition-colors hover:bg-[var(--color-surface)]"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-8 py-6 wf-scrollbar">
                {renderContent()}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

// ---------------------------------------------------------------------------
// PUBLIC HELPERS — used by RailSurfaceModal so it can render any section
// body inside its OWN BaseModal shell without duplicating the switch.
//
// Per user directive 2026-05-14 (round 2): each rail item must open its
// own dedicated modal/settings page — not an inline canvas takeover.
// RailSurfaceModal owns the modal chrome; we own the bodies. These two
// helpers (renderSectionBody + sectionTitleFor) are the API surface
// between them so the modal stays decoupled from this file.
// ---------------------------------------------------------------------------

/**
 * Returns the human-readable title for a section — same one shown
 * inside ConfigPanel's header bar. Re-uses the shared `sectionTitles` map.
 */
export function sectionTitleFor(section: SidebarSectionType): string {
  return sectionTitles[section] || section;
}

interface RenderSectionBodyArgs {
  section: SidebarSectionType;
  workflowId?: string;
  variables?: Record<string, unknown>;
  onVariablesChange?: (vars: Record<string, unknown>) => void;
  workflowSettings?: WorkflowSettings;
  onSettingsChange?: (settings: WorkflowSettings) => void;
  versions?: WorkflowVersion[];
  onRestoreVersion?: (versionId: string) => void;
}

/**
 * Renders just the BODY of a section (no header / no chrome). The
 * RailSurfaceModal wraps this in a BaseModal; ConfigPanel wraps it
 * in a full-screen canvas takeover. Both call this helper so they
 * stay in sync.
 */
export function renderSectionBody(args: RenderSectionBodyArgs): React.ReactNode {
  const { section, workflowId, variables, onVariablesChange, workflowSettings, onSettingsChange, versions, onRestoreVersion } = args;
  switch (section) {
    case 'nodes':
      return <NodesContent />;
    case 'credentials':
      return <CredentialsContent workflowId={workflowId} />;
    case 'agents':
      return <AgentsContent />;
    case 'data':
      return <DataContent />;
    case 'variables':
      if (variables && onVariablesChange) {
        return <VariablesContent variables={variables} onVariablesChange={onVariablesChange} />;
      }
      return (
        <div className="py-12 text-center">
          <div className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
            Open a workflow to manage variables
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            Variables are scoped to the workflow you're editing. Open one from the Flows list first.
          </div>
        </div>
      );
    case 'webhooks':
      return <WebhooksContent workflowId={workflowId} />;
    case 'api':
      return <ApiEndpointContent workflowId={workflowId} />;
    case 'team':
      return <TeamContent workflowId={workflowId} />;
    case 'playground':
      return <PlaygroundContent />;
    case 'deployed':
      return <WorkflowCardGridView filter="deployed" />;
    case 'my_workflows':
      return <WorkflowCardGridView filter="my" />;
    case 'templates':
      return <WorkflowCardGridView filter="templates" />;
    case 'settings':
      return <SettingsContent workflowSettings={workflowSettings} onSettingsChange={onSettingsChange} />;
    case 'versions':
      return <VersionsContent versions={versions} onRestoreVersion={onRestoreVersion} />;
    case 'runs':
      return <RunsContent />;
    case 'insights':
      return <InsightsContent />;
    case 'artifacts':
      return <ArtifactsModalContent />;
    default:
      return null;
  }
}
