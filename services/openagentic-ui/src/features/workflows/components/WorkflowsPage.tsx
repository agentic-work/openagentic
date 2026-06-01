/**
 * Workflows Page - Container Component
 * Wires UI components to API and manages state
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/providers/AuthContext';
import { WorkflowApiService } from '../services/workflowApi';
import { WorkflowList } from './WorkflowList';
import { WorkflowsContainer } from './WorkflowsContainer';
import { FlowsSidebar } from './FlowsSidebar';
import { WhatsNewToast } from './WhatsNewToast';
import { ExecutionInputDialog } from './ExecutionInputDialog';
import { Workflow, WorkflowDefinition } from '../types/workflow.types';
import { useTheme } from '@/contexts/ThemeContext';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { ConfigPanel, SidebarSectionType } from './sidebar/SidebarSectionModal';
import { NodePaletteDrawer } from './NodePaletteDrawer';
import { TemplateLegend, type TemplateMeta } from './TemplateLegend';

type ViewMode = 'list' | 'builder';

/** Sections that open as a floating drawer over the canvas (not a full ConfigPanel) */
const DRAWER_SECTIONS: SidebarSectionType[] = ['nodes', 'agents'];

interface WorkflowsPageProps {
  /** When true, skip rendering FlowsSidebar (used when embedded inside ChatContainer which already has a sidebar) */
  embedded?: boolean;
  /** Callback to expose current workflow state to parent (for Flows Agent context) */
  onWorkflowStateChange?: (state: { workflowId: string; workflowName: string; nodes: any[]; edges: any[] } | null) => void;
}

export const WorkflowsPage: React.FC<WorkflowsPageProps> = ({ embedded = false, onWorkflowStateChange }) => {
  const { workflowId: urlWorkflowId } = useParams<{ workflowId?: string }>();
  const navigate = useNavigate();
  const { getAuthHeaders } = useAuth();
  const { resolvedTheme } = useTheme();
  const confirm = useConfirm();
  const [viewMode, setViewMode] = useState<ViewMode>(urlWorkflowId ? 'builder' : 'list');
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [currentWorkflow, setCurrentWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const urlLoadedRef = useRef(false);
  const hasUnsavedChangesRef = useRef(false);
  const [workflowVariables, setWorkflowVariables] = useState<Record<string, any>>({});
  const [activeConfigView, setActiveConfigView] = useState<SidebarSectionType | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [showExecutionInput, setShowExecutionInput] = useState(false);
  const [pendingExecDefinition, setPendingExecDefinition] = useState<WorkflowDefinition | null>(null);
  const [pendingExecProgress, setPendingExecProgress] = useState<((event: any) => void) | null>(null);
  const pendingExecProgressRef = useRef<((event: any) => void) | null>(null);
  const [lastExecutionInput, setLastExecutionInput] = useState<Record<string, any>>({});

  // Notify parent (ChatContainer) when the current workflow changes -- for Flows Agent context
  useEffect(() => {
    if (onWorkflowStateChange) {
      if (currentWorkflow) {
        onWorkflowStateChange({
          workflowId: currentWorkflow.id,
          workflowName: currentWorkflow.name,
          nodes: (currentWorkflow.definition as any)?.nodes || [],
          edges: (currentWorkflow.definition as any)?.edges || [],
        });
      } else {
        onWorkflowStateChange(null);
      }
    }
  }, [currentWorkflow, onWorkflowStateChange]);
  const [pendingExecutionId, setPendingExecutionId] = useState<string | null>(null);

  // Fetch agents for the palette drawer.
  // SOT: /api/admin/agents (prisma.agent table). Legacy /api/workflows/agents
  // (openagentic-proxy only, skipped DB) was removed 2026-04-26.
  useEffect(() => {
    const loadAgents = async () => {
      try {
        const headers = getAuthHeaders();
        const res = await fetch('/api/admin/agents', { headers });
        if (res.ok) {
          const data = await res.json();
          const raw = Array.isArray(data) ? data : (data.agents || []);
          setAgents(raw.map((a: any) => ({
            ...a,
            display_name: a.display_name || a.name || a.id,
            agent_type: a.agent_type || a.role || 'custom',
            model_config: a.model_config || (a.model ? { primaryModel: a.model } : {}),
            tools_whitelist: a.tools_whitelist || a.tools || [],
            category: a.category || 'platform',
          })));
        }
      } catch { /* ignore */ }
    };
    loadAgents();
  }, [getAuthHeaders]);

  // Memoize API service to avoid re-creating each render
  const apiService = useMemo(() => new WorkflowApiService(getAuthHeaders), [getAuthHeaders]);

  // Load workflows
  const loadWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiService.listWorkflows();
      setWorkflows(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load workflows');
      console.error('Error loading workflows:', err);
    } finally {
      setLoading(false);
    }
  }, [apiService]);

  const handleCreateNew = useCallback(async (templateDef?: WorkflowDefinition, templateName?: string) => {
    try {
      const newWorkflow = await apiService.createWorkflow({
        name: templateName || 'Untitled Workflow',
        description: '',
        definition: templateDef || { nodes: [], edges: [] },
        status: 'draft',
      });
      setCurrentWorkflow(newWorkflow);
      setViewMode('builder');
      await loadWorkflows();
    } catch (err: any) {
      setError(err.message || 'Failed to create workflow');
      console.error('Error creating workflow:', err);
    }
  }, [apiService, loadWorkflows]);

  const handleEdit = useCallback(async (workflowId: string) => {
    // If we have unsaved changes in the current workflow, confirm before switching
    if (currentWorkflow && hasUnsavedChangesRef.current) {
      const proceed = await confirm('You have unsaved changes. Discard and open another workflow?', {
        variant: 'danger',
        title: 'Unsaved Changes',
      });
      if (!proceed) return;
    }

    try {
      const workflow = await apiService.getWorkflow(workflowId);
      setCurrentWorkflow(workflow);
      setViewMode('builder');
      hasUnsavedChangesRef.current = false;
      // Load workflow variables
      setWorkflowVariables((workflow as any).variables || {});
      // Only update URL when standalone (not embedded in ChatContainer)
      // Embedded mode: navigation would leave ChatContainer and lose the sidebar
      if (!embedded && window.location.pathname !== `/workflows/${workflowId}`) {
        navigate(`/workflows/${workflowId}`, { replace: true });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load workflow');
      console.error('Error loading workflow:', err);
    }
  }, [apiService, navigate, currentWorkflow, confirm]);

  // Open a workflow AND load a specific execution's detail view
  const handleOpenExecution = useCallback(async (wfId: string, executionId: string) => {
    try {
      const workflow = await apiService.getWorkflow(wfId);
      setPendingExecutionId(executionId);
      setCurrentWorkflow(workflow);
      setViewMode('builder');
      hasUnsavedChangesRef.current = false;
      setWorkflowVariables((workflow as any).variables || {});
      if (!embedded && window.location.pathname !== `/workflows/${wfId}`) {
        navigate(`/workflows/${wfId}`, { replace: true });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load workflow');
      console.error('Error loading workflow for execution:', err);
    }
  }, [apiService, navigate, embedded]);

  const handleSave = useCallback(async (definition: WorkflowDefinition) => {
    if (!currentWorkflow) return;

    try {
      const updated = await apiService.updateWorkflow(currentWorkflow.id, {
        name: (definition as any).name || currentWorkflow.name,
        description: currentWorkflow.description,
        definition: {
          nodes: definition.nodes || [],
          edges: definition.edges || [],
        },
      });
      setCurrentWorkflow(updated);
      hasUnsavedChangesRef.current = false;
      await loadWorkflows();
    } catch (err: any) {
      setError(err.message || 'Failed to save workflow');
      console.error('Error saving workflow:', err);
      throw err;
    }
  }, [currentWorkflow, apiService, loadWorkflows]);

  const handleExecute = useCallback(async (definition: WorkflowDefinition, onProgress?: (event: any) => void) => {
    if (!currentWorkflow) return;

    // Store callback in ref for immediate access
    pendingExecProgressRef.current = onProgress || null;
    setPendingExecDefinition(definition);
    setPendingExecProgress(() => onProgress || null);

    // Skip the input dialog — execute immediately with last input (or empty)
    // The dialog was causing the execute promise to resolve before the actual
    // API call, breaking the SSE event flow back to WorkflowsContainer
    const input = lastExecutionInput || {};
    console.log('[Workflows] Direct execute (no dialog):', currentWorkflow.id, input);

    try {
      await apiService.executeWorkflow(
        currentWorkflow.id,
        input,
        (event) => {
          console.log(`[Workflows] SSE event: ${event.type}`, event.data);
          const progressFn = pendingExecProgressRef.current;
          if (progressFn) {
            progressFn({ type: event.type, ...event.data });
          }
        }
      );
    } catch (err: any) {
      console.error('[Workflows] Execution FAILED:', err.message);
      setError(err.message || 'Failed to execute workflow');
      throw err;
    } finally {
      setPendingExecDefinition(null);
      setPendingExecProgress(null);
      pendingExecProgressRef.current = null;
    }
  }, [currentWorkflow, apiService, lastExecutionInput]);

  const executeWithInput = useCallback(async (input: Record<string, any>) => {
    if (!currentWorkflow || !pendingExecDefinition) return;
    setShowExecutionInput(false);
    setLastExecutionInput(input);

    console.group('[Workflows] Execute workflow:', currentWorkflow.id, currentWorkflow.name);
    console.log('[Workflows] Input:', input);
    console.log('[Workflows] Definition:', { nodes: pendingExecDefinition.nodes?.length, edges: pendingExecDefinition.edges?.length });

    try {
      await apiService.executeWorkflow(
        currentWorkflow.id,
        input,
        (event) => {
          console.log(`[Workflows] SSE event: ${event.type}`, event.data);
          // Use ref to avoid stale closure — state may not be committed yet
          const progressFn = pendingExecProgressRef.current;
          if (progressFn) {
            progressFn({ type: event.type, ...event.data });
          }
        }
      );
      console.log('[Workflows] Execution completed successfully');
    } catch (err: any) {
      console.error('[Workflows] Execution FAILED:', err.message);
      setError(err.message || 'Failed to execute workflow');
      throw err;
    } finally {
      console.groupEnd();
      setPendingExecDefinition(null);
      setPendingExecProgress(null);
      pendingExecProgressRef.current = null;
    }
  }, [currentWorkflow, apiService, pendingExecDefinition]);

  const handleExecuteFromList = useCallback(async (workflowId: string) => {
    console.group('[Workflows] Execute from list:', workflowId);
    try {
      await apiService.executeWorkflow(
        workflowId,
        {},
        (event) => {
          console.log(`[Workflows] SSE event: ${event.type}`, event.data);
        }
      );
      console.log('[Workflows] Execution completed');
    } catch (err: any) {
      console.error('[Workflows] Execution FAILED:', err.message);
      setError(err.message || 'Failed to execute workflow');
    } finally {
      console.groupEnd();
    }
  }, [apiService]);

  const handleDelete = useCallback(async (workflowId: string) => {
    if (!(await confirm('Are you sure you want to delete this workflow?', { variant: 'danger', title: 'Delete Workflow' }))) {
      return;
    }

    try {
      await apiService.deleteWorkflow(workflowId);
      await loadWorkflows();
    } catch (err: any) {
      setError(err.message || 'Failed to delete workflow');
      console.error('Error deleting workflow:', err);
    }
  }, [apiService, loadWorkflows, confirm]);

  const handleDuplicate = useCallback(async (workflowId: string) => {
    try {
      await apiService.duplicateWorkflow(workflowId);
      await loadWorkflows();
    } catch (err: any) {
      setError(err.message || 'Failed to duplicate workflow');
      console.error('Error duplicating workflow:', err);
    }
  }, [apiService, loadWorkflows]);

  const handleToggleStatus = useCallback(async (workflowId: string, status: any) => {
    try {
      await apiService.updateWorkflow(workflowId, { status });
      await loadWorkflows();
    } catch (err: any) {
      setError(err.message || 'Failed to update workflow status');
      console.error('Error updating status:', err);
    }
  }, [apiService, loadWorkflows]);

  const handleTestNode = useCallback(async (nodeId: string, nodeDef: { type: string; data: Record<string, any> }) => {
    try {
      const result = await apiService.testNode(nodeDef, nodeDef.data?.lastInput);
      console.log(`[Workflows] Node test result for ${nodeId}:`, result);
      // The result will show in the node's execution state via the container
    } catch (err: any) {
      console.error(`[Workflows] Node test FAILED for ${nodeId}:`, err.message);
      setError(err.message || 'Node test failed');
    }
  }, [apiService]);

  const handleBack = useCallback(() => {
    setViewMode('list');
    setCurrentWorkflow(null);
    if (!embedded) {
      navigate('/workflows', { replace: true });
    }
  }, [navigate, embedded]);

  // Load workflows on mount
  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  // Load workflow from URL param
  useEffect(() => {
    if (urlWorkflowId && !urlLoadedRef.current) {
      urlLoadedRef.current = true;
      handleEdit(urlWorkflowId);
    }
  }, [urlWorkflowId, handleEdit]);

  // Use refs for event listener handlers to avoid stale closures
  const handleEditRef = useRef(handleEdit);
  const handleCreateNewRef = useRef(handleCreateNew);
  const handleOpenExecutionRef = useRef(handleOpenExecution);
  handleEditRef.current = handleEdit;
  handleCreateNewRef.current = handleCreateNew;
  handleOpenExecutionRef.current = handleOpenExecution;

  // Listen for sidebar events (FlowsSidebar dispatches these instead of navigating)
  useEffect(() => {
    const onOpenWorkflow = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.workflowId) {
        setActiveConfigView(null);
        handleEditRef.current(detail.workflowId);
      }
    };
    const onCreateNew = () => {
      handleCreateNewRef.current();
    };
    const onUseTemplate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.template?.definition) {
        handleCreateNewRef.current(detail.template.definition, detail.template.name);
      }
    };
    const onOpenConfig = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.section) setActiveConfigView(detail.section);
    };
    const onOpenExecution = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.workflowId && detail?.executionId) {
        setActiveConfigView(null);
        handleOpenExecutionRef.current(detail.workflowId, detail.executionId);
      }
    };

    window.addEventListener('openWorkflow', onOpenWorkflow);
    window.addEventListener('createNewWorkflow', onCreateNew);
    window.addEventListener('useWorkflowTemplate', onUseTemplate);
    window.addEventListener('openFlowsConfig', onOpenConfig);
    window.addEventListener('openWorkflowExecution', onOpenExecution);
    return () => {
      window.removeEventListener('openWorkflow', onOpenWorkflow);
      window.removeEventListener('createNewWorkflow', onCreateNew);
      window.removeEventListener('useWorkflowTemplate', onUseTemplate);
      window.removeEventListener('openFlowsConfig', onOpenConfig);
      window.removeEventListener('openWorkflowExecution', onOpenExecution);
    };
  }, []); // No deps needed - refs always point to latest handlers

  // Sidebar is only rendered in standalone mode (not when embedded in ChatContainer)
  const sidebarElement = embedded ? null : (
    <div className="w-64 flex-shrink-0 h-full border-r" style={{ borderColor: 'var(--color-border)' }}>
      <FlowsSidebar
        isExpanded={true}
        theme={resolvedTheme}
        onOpenWorkflow={(id) => { setPendingExecutionId(null); handleEditRef.current(id); }}
        onOpenExecution={(wfId, execId) => handleOpenExecution(wfId, execId)}
        onCreateNew={() => handleCreateNewRef.current()}
        onUseTemplate={(tpl) => {
          if (tpl.definition) {
            handleCreateNewRef.current(tpl.definition, tpl.name);
          }
        }}
        workflowId={currentWorkflow?.id}
        variables={workflowVariables}
        onVariablesChange={(vars) => {
          setWorkflowVariables(vars);
          hasUnsavedChangesRef.current = true;
        }}
        onOpenConfig={(section) => setActiveConfigView(section)}
        activeConfigView={activeConfigView}
      />
    </div>
  );

  // Is a floating drawer section active? (nodes/agents open over the canvas, not as a full panel)
  const isDrawerSection = activeConfigView && DRAWER_SECTIONS.includes(activeConfigView);
  const isConfigPanelSection = activeConfigView && !isDrawerSection;

  // Determine content area based on view mode
  let content: React.ReactNode;

  if (isConfigPanelSection) {
    content = (
      <ConfigPanel
        section={activeConfigView!}
        onClose={() => setActiveConfigView(null)}
        workflowId={currentWorkflow?.id}
        variables={workflowVariables}
        onVariablesChange={(vars) => {
          setWorkflowVariables(vars);
          hasUnsavedChangesRef.current = true;
        }}
      />
    );
  } else if (loading && viewMode === 'list') {
    content = (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto mb-4"></div>
          <p style={{ color: 'var(--color-text-tertiary)' }}>Loading workflows...</p>
        </div>
      </div>
    );
  } else if (error && viewMode === 'list') {
    content = (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="text-center">
          <p className="text-error mb-4">{error}</p>
          <button
            onClick={loadWorkflows}
            className="px-4 py-2 bg-accent-primary text-text rounded-lg hover:bg-accent-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  } else if (viewMode === 'builder' && currentWorkflow) {
    // Canvas-side "About this workflow" legend — surfaces meta.purpose /
    // how_it_works etc. Per user 2026-05-14 round 2: ALWAYS visible,
    // locked top-LEFT corner of canvas, on EVERY flow (including
    // user-created flows without meta — they get an empty-state
    // prompt). Collapsible (header click) but never dismissable, so
    // operators always see what the flow is for.
    const workflowMeta: TemplateMeta | null = ((currentWorkflow as any)?.meta as TemplateMeta | null) ?? null;
    const collapseKey = `wf-legend-collapsed-${currentWorkflow.id}`;
    content = (
      <div className="w-full h-full relative">
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-[color-mix(in_srgb,var(--color-error)_90%,transparent)] text-text px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-lg">
            <span className="text-sm">{error}</span>
            <button onClick={() => setError(null)} className="text-text/80 hover:text-text font-bold">x</button>
          </div>
        )}
        <WorkflowAboutPanel
          meta={workflowMeta}
          title={currentWorkflow.name}
          description={currentWorkflow.description}
          collapseKey={collapseKey}
        />
        <WorkflowsContainer
          key={`${currentWorkflow.id}-${pendingExecutionId || ''}`}
          workflowId={currentWorkflow.id}
          workflowName={currentWorkflow.name}
          workflowDescription={currentWorkflow.description}
          initialExecutionId={pendingExecutionId || undefined}
          initialWorkflow={{
            nodes: currentWorkflow.nodes || [],
            edges: currentWorkflow.edges || [],
          }}
          onSave={async (def) => {
            await handleSave(def);
            hasUnsavedChangesRef.current = false;
          }}
          onExecute={handleExecute}
          onTestNode={handleTestNode}
          onBack={handleBack}
          theme={resolvedTheme as 'light' | 'dark'}
        />
      </div>
    );
  } else {
    content = (
      <div className="w-full h-full relative">
        <WorkflowList
          workflows={workflows}
          onCreateNew={handleCreateNew}
          onEdit={handleEdit}
          onExecute={handleExecuteFromList}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onToggleStatus={handleToggleStatus}
          theme={resolvedTheme}
        />
      </div>
    );
  }

  // Find trigger node for execution input dialog
  const triggerNode = useMemo(() => {
    if (!currentWorkflow?.nodes) return null;
    const trigger = currentWorkflow.nodes.find((n: any) => n.type === 'trigger');
    return trigger ? { id: trigger.id, type: trigger.type || 'trigger', data: trigger.data || {} } : null;
  }, [currentWorkflow]);

  // Workspace nav rail (#61) is now mounted by ChatContainer at the
  // app shell level — see ChatContainer.tsx — so it sits LEFT of the
  // chat sidebar (NavRail | ChatSidebar | Canvas). It's no longer
  // rendered here.

  return (
    <div className="flex w-full h-full overflow-hidden">
      {sidebarElement}
      <div className="flex-1 relative overflow-hidden">
        {/* Floating node/agent palette drawer — overlays content area */}
        <NodePaletteDrawer
          isOpen={!!isDrawerSection}
          onClose={() => setActiveConfigView(null)}
          mode={activeConfigView === 'agents' ? 'agents' : 'nodes'}
          agents={agents}
        />
        {content}
      </div>

      {/* 0.7.0 What's-new toast — bottom-right, dismissable, version-keyed.
       * Renders to document.body via portal so parent transforms don't
       * affect position:fixed. Version 0.7.0-r2 forces re-show for users
       * who dismissed the earlier preview build. */}
      <WhatsNewToast version="0.7.0-r2" />

      {/* Execution Input Dialog */}
      <ExecutionInputDialog
        isOpen={showExecutionInput}
        onClose={() => {
          setShowExecutionInput(false);
          setPendingExecDefinition(null);
          setPendingExecProgress(null);
          pendingExecProgressRef.current = null;
        }}
        onExecute={executeWithInput}
        workflowName={currentWorkflow?.name || 'Untitled Workflow'}
        triggerNode={triggerNode}
        lastInput={lastExecutionInput}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// WorkflowAboutPanel — canvas-side legend, LOCKED top-LEFT, ALWAYS visible.
//
// Per user 2026-05-14 round 2: legends were a first-visit-only popover
// in the top-right that auto-disappeared after localStorage dismissal.
// New contract:
//   - position: absolute; top: 16; left: 16; z-index: 30 (over canvas,
//     under modals)
//   - rendered on EVERY flow — template-originating OR user-created
//   - collapsible by clicking the header (collapsed = 1-line summary
//     pinned in the same spot); state remembered per-workflow via
//     localStorage so collapse choice survives reload
//   - NEVER dismissable — there is no close button anywhere
//   - flows without meta get an empty-state prompting the user to add
//     a description, so the legend slot is always present
// ---------------------------------------------------------------------------

const LEGEND_ACCENT = 'var(--user-accent-primary, #FF5722)';

const WorkflowAboutPanel: React.FC<{
  meta: TemplateMeta | null;
  title: string;
  description?: string;
  collapseKey: string;
}> = ({ meta, title, description, collapseKey }) => {
  // Default expanded; persisted collapse choice survives reload.
  const initialCollapsed = typeof window !== 'undefined'
    && window.localStorage.getItem(collapseKey) === '1';
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { window.localStorage.setItem(collapseKey, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }, [collapseKey]);

  const hasMeta = !!meta && !!(
    meta.purpose || (meta.how_it_works && meta.how_it_works.length > 0)
    || meta.expected_output || meta.useful_when
  );

  // Container — locked top-left of the CANVAS area, never moves with the
  // canvas pan/zoom because it sits in the absolute-positioned overlay
  // layer above ReactFlow's transformed viewport (its parent is
  // `relative`). top: 72 clears the 56px workflow toolbar (h-14) + 16px
  // gap so the legend doesn't overlap the toolbar header row.
  const wrapperStyle: React.CSSProperties = {
    position: 'absolute',
    top: 72,
    left: 16,
    zIndex: 30,
    width: 320,
    maxWidth: 'calc(100% - 32px)',
    maxHeight: collapsed ? undefined : 'calc(100% - 88px)',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--color-bg-secondary, #161b22)',
    border: '1px solid var(--color-border, #30363d)',
    borderRadius: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
    overflow: 'hidden',
    color: 'var(--color-text, #e6edf3)',
  };

  return (
    <div
      data-testid="workflow-about-panel"
      data-collapsed={collapsed ? 'true' : 'false'}
      style={wrapperStyle}
    >
      <button
        type="button"
        data-testid="workflow-about-header"
        onClick={toggle}
        title={collapsed ? 'Expand legend' : 'Collapse legend'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          borderBottom: collapsed ? 'none' : '1px solid var(--color-border, #30363d)',
          textAlign: 'left',
          cursor: 'pointer',
          color: 'inherit',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: LEGEND_ACCENT,
          }}>
            About this workflow
          </span>
          <span style={{
            fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {title || 'Untitled workflow'}
          </span>
        </div>
        <span aria-hidden="true" style={{
          fontSize: 10, color: 'var(--color-text-tertiary, #8b949e)',
          transform: collapsed ? 'rotate(-90deg)' : 'none',
          transition: 'transform 0.15s ease',
          marginLeft: 8,
        }}>
          v
        </span>
      </button>

      {!collapsed && (
        <div
          data-testid="workflow-about-body"
          style={{ padding: '12px 14px 14px', overflowY: 'auto', flex: 1 }}
        >
          {hasMeta ? (
            <TemplateLegend meta={meta as TemplateMeta} variant="card" />
          ) : (
            <WorkflowLegendEmptyState description={description} />
          )}
        </div>
      )}
    </div>
  );
};

// Empty-state for flows that don't have an authored meta block — user-
// created flows or older flows that pre-date the legend feature. Prompts
// the user to add a description via the workflow settings (instead of
// hiding the legend slot entirely, which is what made the prior version
// invisible on most flows).
const WorkflowLegendEmptyState: React.FC<{ description?: string }> = ({ description }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {description ? (
      <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--color-text-secondary, #c9d1d9)' }}>
        {description}
      </div>
    ) : (
      <div style={{
        fontSize: 12, lineHeight: 1.55,
        color: 'var(--color-text-tertiary, #8b949e)',
        fontStyle: 'italic',
      }}>
        No description yet — add Purpose, How it works, and Expected output
        in the workflow Settings so anyone opening this flow knows what
        it's for.
      </div>
    )}
    <div style={{
      fontSize: 10, color: 'var(--color-text-tertiary, #8b949e)',
      letterSpacing: '0.04em',
    }}>
      Tip: legends help operators triage flows at a glance.
    </div>
  </div>
);

