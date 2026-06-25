/**
 * FlowsSidebar - Fully-realized sidebar for Flows mode
 * Sections: Active Agents, My Workflows, Templates, Connections
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
  ChevronRight,
  Play,
  Activity,
  Sparkles,
  Zap,
  Shield,
  Mail,
  Rocket,
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { useMCP } from '@/app/providers/MCPContext';
import { WorkflowApiService } from '../services/workflowApi';
// Templates now come exclusively from the API (seed-templates endpoint)
// Old frontend-only workflowTemplates.ts and marketplaceTemplates.ts are removed
// QA 2026-05-05 fix: useBackendNodes() called a /nodes endpoint that
// does not exist on workflows-svc; the fetch silently failed and the
// badge showed only the legacy nodeTypeConfigs count (~45) instead of
// the schema-driven registry merged total (~53). Swap to
// useMergedNodeConfigs which reads from /api/workflows/internal/node-schemas.
import { useMergedNodeConfigs } from '../hooks/useMergedNodeConfigs';
import { nodeTypeConfigs } from '../utils/nodeConfigs';
import type { Workflow as WorkflowType } from '../types/workflow.types';
import { LottieIcon } from '@/shared/components/LottieIcon';
import { workflowNodeAnimations } from '@/shared/animations/workflowAnimations';
import { TeamSection } from './sidebar/TeamSection';
import { ArtifactsSection } from './sidebar/ArtifactsSection';
import type { SidebarSectionType } from './sidebar/SidebarSectionModal';

interface FlowsSidebarProps {
  isExpanded: boolean;
  theme: string;
  onOpenWorkflow: (workflowId: string) => void;
  onOpenExecution?: (workflowId: string, executionId: string) => void;
  onCreateNew: () => void;
  onUseTemplate?: (template: any) => void;
  workflowId?: string;
  variables?: Record<string, any>;
  onVariablesChange?: (vars: Record<string, any>) => void;
  onOpenConfig?: (section: SidebarSectionType) => void;
  activeConfigView?: SidebarSectionType | null;
}

/** Collapsible section header */
const SectionHeader: React.FC<{
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  count?: number;
  action?: React.ReactNode;
}> = ({ title, isOpen, onToggle, count, action }) => (
  <button
    onClick={onToggle}
    className="eyebrow w-full flex items-center justify-between px-4 py-2.5 text-fg-subtle border-b border-rule transition-colors hover:bg-[var(--ctl-surf)] hover:text-fg"
  >
    <div className="flex items-center gap-1.5">
      <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.15 }}>
        <ChevronRight className="w-3 h-3" />
      </motion.div>
      {title}
      {count !== undefined && (
        <span className="eyebrow ml-1 px-1.5 py-0.5 rounded-[var(--radius-chip)] border border-rule bg-[var(--ctl-surf)] text-fg-muted">
          {count}
        </span>
      )}
    </div>
    {action && <div role="presentation" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>{action}</div>}
  </button>
);

const templateIcons: Record<string, React.ReactNode> = {
  Zap: <Zap className="w-4 h-4" />,
  Activity: <Activity className="w-4 h-4" />,
  Shield: <Shield className="w-4 h-4" />,
  Mail: <Mail className="w-4 h-4" />,
  Rocket: <Rocket className="w-4 h-4" />,
};

export const FlowsSidebar: React.FC<FlowsSidebarProps> = ({
  isExpanded,
  theme,
  onOpenWorkflow,
  onOpenExecution,
  onCreateNew,
  onUseTemplate,
  workflowId,
  variables,
  onVariablesChange,
  onOpenConfig,
  activeConfigView,
}) => {
  const { getAuthHeaders } = useAuth();
  const { mcps } = useMCP();
  const [workflows, setWorkflows] = useState<WorkflowType[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [providerCount, setProviderCount] = useState<number | null>(null);

  // Compute total MCP tool count from MCPContext
  const mcpToolCount = useMemo(() => {
    if (!mcps || mcps.length === 0) return 0;
    return mcps.reduce((sum, s) => sum + (s.tools?.length || 0), 0);
  }, [mcps]);

  const mcpServerCount = mcps?.length || 0;

  // Fetch LLM provider count
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const headers = getAuthHeaders();
        const res = await fetch('/api/admin/llm-providers', { headers });
        if (res.ok) {
          const data = await res.json();
          setProviderCount(Array.isArray(data) ? data.length : data.providers?.length || 0);
        }
      } catch { /* ignore - non-admin users may not have access */ }
    };
    fetchProviders();
  }, [getAuthHeaders]);

  // Node palette configs for drag-and-drop (schema-driven + legacy merged).
  const { merged: activeNodeConfigs } = useMergedNodeConfigs(nodeTypeConfigs as any);

  // API service (must be declared before useEffects that reference it)
  const api = useMemo(() => new WorkflowApiService(getAuthHeaders), [getAuthHeaders]);

  // Starter flows from templates API
  const [starterFlows, setStarterFlows] = useState<WorkflowType[]>([]);
  const [starterSeeded, setStarterSeeded] = useState(false);

  // Fetch ALL templates (not just starter-tagged ones)
  useEffect(() => {
    const fetchStarters = async () => {
      try {
        const templates = await api.listTemplates();
        if (templates.length === 0 && !starterSeeded) {
          // Auto-seed templates on first visit
          try {
            await api.seedTemplates();
            setStarterSeeded(true);
            const retried = await api.listTemplates();
            setStarterFlows(retried);
          } catch { /* seed may fail if already seeded */ }
        } else {
          setStarterFlows(templates);
        }
      } catch { /* ignore template fetch errors */ }
    };
    fetchStarters();
  }, [api, starterSeeded]);

  // Agent definitions from API
  const [agents, setAgents] = useState<any[]>([]);
  // Fetch agent definitions from admin API (which merges openagentic-proxy + DB)
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch('/api/admin/agents', {
          credentials: 'include',
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : (data.agents || []);
          // Normalize to consistent shape with DB id as primary key
          const normalized = list.map((a: any) => ({
            ...a,
            id: a.id,  // DB UUID
            display_name: a.display_name || a.name || a.id,
            agent_type: a.agent_type || a.role || 'custom',
            model: a.model || a.model_config?.primaryModel || 'auto',
            tools: a.tools || a.tools_whitelist || [],
            maxTurns: a.maxTurns || a.max_turns || 5,
            category: a.category || 'platform',
          }));
          setAgents(normalized);
        }
      } catch { /* non-admin users may not have access */ }
    };
    fetchAgents();
  }, [getAuthHeaders]);

  // Clicking a config-capable section header opens its config panel in the main content area
  const openConfig = (section: SidebarSectionType) => {
    onOpenConfig?.(section);
  };

  // Section collapse state - all closed by default
  const [sectionsOpen, setSectionsOpen] = useState({
    nodes: false,
    active: false,
    executions: false,
    workflows: false,
    templates: false,
    // marketplace removed — consolidated into templates
    agents: false,
    artifacts: false,
    credentials: false,
    variables: false,
    data: false,
    webhooks: false,
    team: false,
  });

  // Recent executions across all workflows for current user
  const [userExecutions, setUserExecutions] = useState<any[]>([]);
  const [executionsLoading, setExecutionsLoading] = useState(false);

  const fetchUserExecutions = useCallback(async () => {
    try {
      setExecutionsLoading(true);
      const execs = await api.getUserExecutions(10);
      setUserExecutions(execs);
    } catch {
      /* ignore errors */
    } finally {
      setExecutionsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (sectionsOpen.executions) {
      fetchUserExecutions();
    }
  }, [sectionsOpen.executions, fetchUserExecutions]);

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const executionStatusIcon = (status: string) => {
    if (status === 'completed') {
      return <span className="text-success font-bold text-xs leading-none">✓</span>;
    }
    if (status === 'failed') {
      return <span className="text-error font-bold text-xs leading-none">✗</span>;
    }
    // running / pending
    return (
      <span className="inline-block w-3 h-3 rounded-full border-2 border-warning border-t-transparent animate-spin" />
    );
  };

  const toggleSection = (key: keyof typeof sectionsOpen) => {
    setSectionsOpen(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Fetch workflows
  const fetchWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.listWorkflows();
      setWorkflows(data);
    } catch (err) {
      console.error('FlowsSidebar: failed to fetch workflows', err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  // Filter: My Workflows = all user-owned non-template workflows (includes both draft and active)
  const filteredWorkflows = useMemo(() => {
    const mine = workflows.filter(w => !w.is_template);
    if (!search) return mine;
    const q = search.toLowerCase();
    return mine.filter(w => w.name.toLowerCase().includes(q) || w.description?.toLowerCase().includes(q));
  }, [workflows, search]);

  const filteredAgents = useMemo(() => {
    if (!search) return agents;
    const q = search.toLowerCase();
    return agents.filter((a: any) =>
      (a.display_name || a.name || '').toLowerCase().includes(q) ||
      (a.agent_type || '').toLowerCase().includes(q)
    );
  }, [agents, search]);

  // Deployed workflows = non-template workflows that have been deployed (status: active)
  const deployedWorkflows = useMemo(() => workflows.filter(w => w.status === 'active' && !w.is_template), [workflows]);

  const statusDot = (status: string) => {
    const colors: Record<string, string> = { active: 'var(--color-success)', running: 'var(--color-warning)', paused: 'var(--color-accent)', draft: 'var(--color-fg-muted)', archived: 'var(--color-fg-subtle)' };
    return (
      <span
        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: colors[status] || 'var(--color-fg-muted)' }}
      />
    );
  };

  // Collapsed mode: just show icons
  if (!isExpanded) {
    return (
      <div className="w-12 flex-shrink-0 flex flex-col items-center gap-2 pt-2">
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onCreateNew}
          className="glass-newchat p-2"
          title="New Flow"
        >
          <Plus className="w-5 h-5" />
        </motion.button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* New Flow Button */}
      <div className="px-3 mb-1 mt-2">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onCreateNew}
          className="glass-newchat flex items-center gap-3 px-3 py-2.5 w-full justify-start"
        >
          <Plus className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-semibold whitespace-nowrap">New flow</span>
        </motion.button>
      </div>

      {/* Search */}
      <div className="px-3 mb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search flows..."
            className="glass-field pl-8 pr-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {/* Scrollable sections */}
      <div className="flex-1 overflow-y-auto wf-scrollbar">
        {/* Section 0: Node Palette — opens as floating drawer over canvas */}
        <SectionHeader
          title="Nodes"
          isOpen={activeConfigView === 'nodes'}
          onToggle={() => openConfig('nodes')}
          count={Object.keys(activeNodeConfigs).length}
        />

        {/* Section 0.5: Recent Executions — inline accordion */}
        <SectionHeader
          title="Executions"
          isOpen={sectionsOpen.executions}
          onToggle={() => toggleSection('executions')}
          count={userExecutions.length > 0 ? userExecutions.length : undefined}
        />
        <AnimatePresence>
          {sectionsOpen.executions && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="px-2 pb-2">
                {executionsLoading && (
                  <div className="text-xs px-2 py-1 text-fg-subtle">
                    Loading…
                  </div>
                )}
                {!executionsLoading && userExecutions.length === 0 && (
                  <div className="text-xs px-2 py-1 text-fg-subtle">
                    No recent executions
                  </div>
                )}
                {!executionsLoading && userExecutions.map((exec: any) => (
                  <button
                    key={exec.id}
                    onClick={() => {
                      if (exec.workflow_id) {
                        if (onOpenExecution) {
                          onOpenExecution(exec.workflow_id, exec.id);
                        } else {
                          onOpenWorkflow(exec.workflow_id);
                        }
                      }
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--ctl-radius-sm)] border border-transparent text-left text-xs transition-[background,border-color] glass-row-hover"
                  >
                    <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                      {executionStatusIcon(exec.status)}
                    </span>
                    <span className="flex-1 truncate text-fg">
                      {exec.workflow?.name || exec.workflow_name || exec.workflow_id || 'Workflow'}
                    </span>
                    <span className="flex-shrink-0 text-fg-subtle">
                      {exec.created_at ? timeAgo(exec.created_at) : ''}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Section 1: Deployed Workflows — opens full ConfigPanel */}
        <SectionHeader
          title="Deployed"
          isOpen={activeConfigView === 'deployed'}
          onToggle={() => openConfig('deployed')}
          count={deployedWorkflows.length}
        />

        {/* Section 2: My Workflows — opens full ConfigPanel */}
        <SectionHeader
          title="My Workflows"
          isOpen={activeConfigView === 'my_workflows'}
          onToggle={() => openConfig('my_workflows')}
          count={filteredWorkflows.length}
        />

        {/* Section 3: Templates — opens full ConfigPanel with card grid */}
        <SectionHeader
          title="Templates"
          isOpen={activeConfigView === 'templates'}
          onToggle={() => openConfig('templates')}
          count={starterFlows.length}
        />

        {/* Section 4: Agents — opens floating drawer over canvas (parity with Nodes
         * so agents are dragged onto the flow the same way every node is). The
         * old inline-accordion list was removed in favour of the drawer; keeping
         * sectionsOpen.agents as a state flag has no effect now. */}
        <SectionHeader
          title="Agents"
          isOpen={activeConfigView === 'agents'}
          onToggle={() => openConfig('agents')}
          count={filteredAgents.length}
        />

        {/* Section 6: Credentials — opens full ConfigPanel (lists are long once
         * a tenant has a few connectors; the inline accordion was dead code). */}
        <SectionHeader
          title="Credentials"
          isOpen={activeConfigView === 'credentials'}
          onToggle={() => openConfig('credentials')}
        />

        {/* Section 7: Variables — always visible, opens config panel */}
        <SectionHeader
          title="Variables"
          isOpen={activeConfigView === 'variables'}
          onToggle={() => openConfig('variables')}
          count={variables ? Object.keys(variables).length : undefined}
        />

        {/* Section 8: Data Stores — opens full ConfigPanel */}
        <SectionHeader
          title="Data Stores"
          isOpen={activeConfigView === 'data'}
          onToggle={() => openConfig('data')}
        />

        {/* Section 9: Artifacts — workflow-generated outputs stored in Milvus */}
        <SectionHeader
          title="Artifacts"
          isOpen={sectionsOpen.artifacts}
          onToggle={() => toggleSection('artifacts')}
        />
        <AnimatePresence>
          {sectionsOpen.artifacts && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <ArtifactsSection />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Section 10: Webhooks (only when a workflow is open) — ConfigPanel */}
        {workflowId && (
          <SectionHeader
            title="Webhooks"
            isOpen={activeConfigView === 'webhooks'}
            onToggle={() => openConfig('webhooks')}
          />
        )}

        {/* Section 10: API Endpoints (only when a workflow is open) */}
        {workflowId && (
          <SectionHeader
            title="API"
            isOpen={activeConfigView === 'api'}
            onToggle={() => openConfig('api')}
          />
        )}

        {/* Section 11: Team (only when a workflow is open) */}
        {workflowId && (
          <>
            <SectionHeader
              title="Team"
              isOpen={sectionsOpen.team || activeConfigView === 'team'}
              onToggle={() => openConfig('team')}
            />
            <AnimatePresence>
              {sectionsOpen.team && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <TeamSection workflowId={workflowId} />
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* Section 12: Settings (only when a workflow is open) */}
        {workflowId && (
          <SectionHeader
            title="Settings"
            isOpen={activeConfigView === 'settings'}
            onToggle={() => openConfig('settings')}
          />
        )}

        {/* Section 13: Versions (only when a workflow is open) */}
        {workflowId && (
          <SectionHeader
            title="Versions"
            isOpen={activeConfigView === 'versions'}
            onToggle={() => openConfig('versions')}
          />
        )}

      </div>

    </div>
  );
};
