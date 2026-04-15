/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * SidebarSectionModal - Full-screen configurable modal for each sidebar section
 * Opens in the main content area with expanded configuration options
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Plus,
  Trash2,
  Check,
  Copy,
  RefreshCw,
  Search,
  ExternalLink,
  ChevronRight,
  Info,
  Settings,
  Key,
  Globe,
  Lock,
  Shield,
  Database,
  Users,
  Eye,
  Edit,
  Play,
  Clock,
  Link,
  ChevronDown,
  Download,
  Upload,
  FileText,
  Layers,
  Terminal,
  Rocket,
  GitBranch,
  Star,
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { useMCP } from '@/app/providers/MCPContext';
import { workflowEndpoint } from '@/utils/api';
import { nodeTypeConfigs } from '../../utils/nodeConfigs';
import { DataSection } from './DataSection';
import {
  Zap, Brain, Bot, Rocket as Rocket2, Sparkles, Target, Code, Terminal as Terminal2,
  GitBranch as GitBranch2, RotateCw, Hourglass, ArrowRightLeft,
  GitMerge, ShieldCheck, Hand, UserCheck, Layers as Layers2, Star as Star2, FlaskConical,
  MessageSquare, Mail, AlertTriangle, FileText as FileText2, Hash,
} from '@/shared/icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SidebarSectionType = 'nodes' | 'credentials' | 'agents' | 'artifacts' | 'data' | 'variables' | 'webhooks' | 'api' | 'team' | 'playground' | 'deployed' | 'my_workflows' | 'templates' | 'settings' | 'versions';

export interface SidebarSectionModalProps {
  section: SidebarSectionType | null;
  isOpen: boolean;
  onClose: () => void;
  workflowId?: string;
  variables?: Record<string, any>;
  onVariablesChange?: (vars: Record<string, any>) => void;
  workflowSettings?: any;
  onSettingsChange?: (settings: any) => void;
  versions?: any[];
  onRestoreVersion?: (versionId: string) => void;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const sectionTitles: Record<SidebarSectionType, string> = {
  nodes: 'Node Catalog',
  credentials: 'Credentials & Connections',
  agents: 'Agent Configuration',
  artifacts: 'Artifacts',
  data: 'Data Stores',
  variables: 'Workflow Variables',
  webhooks: 'Webhooks',
  api: 'API Endpoints',
  team: 'Team & Sharing',
  // marketplace removed — consolidated into templates
  playground: 'Agent Playground',
  deployed: 'Deployed Workflows',
  my_workflows: 'My Workflows',
  templates: 'Templates',
  settings: 'Workflow Settings',
  versions: 'Version History',
};

const inputClass =
  'w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 transition-colors';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-bg-primary)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

const btnPrimary =
  'px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50';

const btnPrimaryStyle: React.CSSProperties = {
  backgroundColor: 'var(--user-accent-primary, #2196f3)',
  color: '#fff',
};

const tableHeaderClass =
  'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider';

const tableHeaderStyle: React.CSSProperties = {
  color: 'var(--color-text-tertiary, #777)',
  borderBottom: '1px solid var(--color-border)',
};

const tableCellClass = 'px-3 py-2.5 text-sm';
const tableCellStyle: React.CSSProperties = {
  color: 'var(--color-text)',
  borderBottom: '1px solid var(--color-border)',
};

const scopeColors: Record<string, string> = {
  global: '#2196f3',
  group: '#9c27b0',
  workflow: '#ff9800',
};

const methodColors: Record<string, string> = {
  POST: '#22c55e',
  GET: '#2196f3',
  PUT: '#ff9800',
  DELETE: '#ef5350',
};

const roleColors: Record<string, string> = {
  viewer: '#9e9e9e',
  editor: '#2196f3',
  executor: '#ff9800',
  admin: '#9c27b0',
};

type VariableType = 'string' | 'number' | 'boolean' | 'json' | 'secret_ref';

const typeColors: Record<VariableType, string> = {
  string: '#2196f3',
  number: '#ff9800',
  boolean: '#22c55e',
  json: '#9c27b0',
  secret_ref: '#ef5350',
};

const COMMON_EXPRESSIONS = [
  { label: 'Trigger Body Field', expr: '{{trigger.body.field}}' },
  { label: 'Node Output', expr: '{{nodes.nodeId.output}}' },
  { label: 'Env Variable', expr: '{{env.KEY}}' },
  { label: 'Execution ID', expr: '{{execution.id}}' },
  { label: 'Current Timestamp', expr: '{{now}}' },
  { label: 'User ID', expr: '{{user.id}}' },
];

// ---------------------------------------------------------------------------
// Sub-tab button
// ---------------------------------------------------------------------------

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
    style={{
      backgroundColor: active ? 'var(--user-accent-primary, #2196f3)' : 'transparent',
      color: active ? '#fff' : 'var(--color-text-secondary, #999)',
    }}
  >
    {children}
  </button>
);

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

const StatusDot: React.FC<{ color: string }> = ({ color }) => (
  <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
);

// ---------------------------------------------------------------------------
// NODE TYPE ICONS
// ---------------------------------------------------------------------------

const nodeIconMap: Record<string, React.ComponentType<any>> = {
  trigger: Zap, llm_completion: Brain, a2a: Bot, agent_spawn: Rocket,
  openagentic_llm: Sparkles, multi_agent: Target, mcp_tool: Settings,
  code: Code, openagentic: Terminal, http_request: Globe,
  condition: GitBranch, loop: RotateCw, wait: Hourglass,
  transform: ArrowRightLeft, merge: GitMerge, approval: ShieldCheck,
  human_approval: Hand, synth: FlaskConical,
  agent_single: UserCheck, agent_pool: Layers, agent_supervisor: Star,
  slack_message: MessageSquare, teams_message: MessageSquare, outlook_email: Mail,
  send_email: Mail, pagerduty_incident: AlertTriangle, servicenow_ticket: FileText,
  jira_issue: FileText, discord_message: Hash,
  error_handler: AlertTriangle, user_context: Brain,
};

// ---------------------------------------------------------------------------
// NODES CONTENT — full browsable catalog of all node types
// ---------------------------------------------------------------------------

// Rich capability descriptions for each node type
const nodeCapabilities: Record<string, { capabilities: string[]; inputs: string[]; outputs: string[]; useCases: string[] }> = {
  trigger: {
    capabilities: ['Manual execution', 'Scheduled (cron)', 'Webhook-triggered', 'Event-driven'],
    inputs: ['Webhook payload', 'Schedule context', 'Manual input'],
    outputs: ['Trigger data', 'Timestamp', 'Source metadata'],
    useCases: ['Start a pipeline on schedule', 'Respond to webhook events', 'Manual workflow runs'],
  },
  llm_completion: {
    capabilities: ['Text generation', 'Prompt templating', 'System prompts', 'Temperature control', 'Token limits', 'Streaming output'],
    inputs: ['Prompt text', 'System prompt', 'Variables from upstream nodes'],
    outputs: ['Generated text', 'Token usage', 'Model info'],
    useCases: ['Summarize documents', 'Generate emails', 'Classify content', 'Extract structured data'],
  },
  a2a: {
    capabilities: ['Agent-to-Agent protocol', 'Cross-platform delegation', 'Context passing', 'Async task handoff'],
    inputs: ['Message/prompt', 'Agent endpoint', 'Context variables'],
    outputs: ['Agent response', 'Task status', 'Artifacts'],
    useCases: ['Delegate specialized tasks', 'Multi-agent collaboration', 'External agent integration'],
  },
  agent_spawn: {
    capabilities: ['Spawn autonomous child agents', 'Tool access', 'Independent reasoning loops', 'Timeout control'],
    inputs: ['Task description', 'Available tools', 'Max tokens', 'Agent configuration'],
    outputs: ['Agent result', 'Tool call history', 'Reasoning trace'],
    useCases: ['Complex research tasks', 'Multi-step problem solving', 'Autonomous code generation'],
  },
  openagentic_llm: {
    capabilities: ['Smart model routing via intelligence slider', 'All providers (Anthropic, OpenAI, Google, Azure, Ollama)', 'Extended thinking', 'Provider override', 'Cost optimization'],
    inputs: ['Prompt', 'System prompt', 'Slider override', 'Model override', 'Thinking budget'],
    outputs: ['Generated text', 'Thinking blocks', 'Token usage', 'Cost', 'Model used'],
    useCases: ['Route to cheapest model for simple tasks', 'Use premium models for critical decisions', 'Enable thinking for complex reasoning'],
  },
  multi_agent: {
    capabilities: ['Concurrent agent execution', 'Shared context', 'Result aggregation (merge/vote/first)', 'Concurrency limits', 'Timeout per agent'],
    inputs: ['Agent definitions', 'Shared context', 'Aggregation strategy'],
    outputs: ['Aggregated results', 'Per-agent outputs', 'Execution timeline'],
    useCases: ['Parallel research from multiple angles', 'Consensus-based decisions', 'Load-balanced processing'],
  },
  mcp_tool: {
    capabilities: ['Execute any of 244+ MCP tools', 'Server selection', 'Argument templating', 'Structured response parsing'],
    inputs: ['Tool name', 'Server', 'Arguments (templated)'],
    outputs: ['Tool result', 'Execution metadata', 'Error details'],
    useCases: ['Search the web', 'Query databases', 'Manage cloud resources', 'Read/write files', 'Send notifications'],
  },
  code: {
    capabilities: ['JavaScript execution', 'Python execution', 'Access to input data', 'Custom transformations', 'Library imports'],
    inputs: ['Code string', 'Language selection', 'Input data from upstream'],
    outputs: ['Return value', 'Console output', 'Error info'],
    useCases: ['Data transformation', 'Custom business logic', 'Format conversion', 'Calculations'],
  },
  openagentic: {
    capabilities: ['Isolated container execution', 'Full Python environment', 'Package installation', 'File I/O', 'Network access'],
    inputs: ['Python code', 'Input variables'],
    outputs: ['Execution result', 'Stdout/stderr', 'Generated files'],
    useCases: ['Data science pipelines', 'ML model inference', 'Heavy computation', 'File processing'],
  },
  http_request: {
    capabilities: ['GET/POST/PUT/DELETE/PATCH', 'Custom headers', 'JSON/form body', 'Auth (Bearer, Basic, API Key)', 'Response parsing', 'Timeout control'],
    inputs: ['URL', 'Method', 'Headers', 'Body', 'Auth config'],
    outputs: ['Response body', 'Status code', 'Response headers'],
    useCases: ['Call REST APIs', 'Fetch external data', 'Webhook delivery', 'Service integration'],
  },
  condition: {
    capabilities: ['If/else branching', 'Multiple operators (equals, contains, regex, gt, lt)', 'Expression evaluation', 'Multi-path routing'],
    inputs: ['Condition expression', 'Operator', 'Comparison value'],
    outputs: ['True branch', 'False branch'],
    useCases: ['Route based on API response', 'Filter by content type', 'Error handling branches'],
  },
  loop: {
    capabilities: ['Iterate over arrays', 'For-each processing', 'Index tracking', 'Break conditions'],
    inputs: ['Collection/array', 'Item variable name'],
    outputs: ['Current item', 'Index', 'Accumulated results'],
    useCases: ['Process batch items', 'Iterate over API results', 'Sequential multi-step processing'],
  },
  wait: {
    capabilities: ['Timed delay', 'Configurable duration (ms/sec/min)', 'Rate limiting between steps'],
    inputs: ['Duration', 'Unit'],
    outputs: ['Passthrough (original data)'],
    useCases: ['Rate limit API calls', 'Polling intervals', 'Timed sequences'],
  },
  transform: {
    capabilities: ['Map, filter, reduce operations', 'JSONPath expressions', 'Field renaming', 'Type conversion', 'Array flattening'],
    inputs: ['Input data', 'Transform expression', 'Transform type'],
    outputs: ['Transformed data'],
    useCases: ['Reshape API responses', 'Extract specific fields', 'Aggregate data', 'Format for downstream nodes'],
  },
  merge: {
    capabilities: ['Combine multiple inputs', 'Object merge', 'Array concatenation', 'Key-based join'],
    inputs: ['Multiple input streams'],
    outputs: ['Merged result'],
    useCases: ['Combine parallel branch results', 'Join data from multiple APIs', 'Aggregate agent outputs'],
  },
  approval: {
    capabilities: ['Pause execution', 'Approval request notification', 'Approve/reject actions', 'Timeout with auto-action'],
    inputs: ['Data to review', 'Approver config'],
    outputs: ['Approval decision', 'Approver identity', 'Comments'],
    useCases: ['Content review before publishing', 'Cost approval for expensive operations', 'Security gate checks'],
  },
  human_approval: {
    capabilities: ['Human-in-the-loop review', 'Detailed sign-off form', 'Audit trail', 'Escalation rules', 'Multi-approver support'],
    inputs: ['Review payload', 'Required approvers', 'Escalation config'],
    outputs: ['Approval status', 'Reviewer comments', 'Signatures'],
    useCases: ['Compliance review', 'Executive sign-off', 'Sensitive data access approval'],
  },
  synth: {
    capabilities: ['Multi-source synthesis', 'Quality scoring', 'Deduplication', 'Conflict resolution'],
    inputs: ['Multiple agent outputs', 'Synthesis strategy'],
    outputs: ['Synthesized result', 'Source attribution', 'Confidence scores'],
    useCases: ['Combine research from multiple agents', 'Generate consensus reports', 'Quality-ranked outputs'],
  },
  agent_single: {
    capabilities: ['Run any registered agent', 'Custom model selection', 'Tool whitelist', 'Turn limits', 'Cost budget', 'Timeout control'],
    inputs: ['Agent ID', 'Task prompt', 'Model override', 'Tool list'],
    outputs: ['Agent response', 'Tool call log', 'Token usage', 'Cost'],
    useCases: ['Specialized task execution', 'Reusable agent workflows', 'Budget-controlled processing'],
  },
  agent_pool: {
    capabilities: ['Parallel agent fan-out', 'Configurable concurrency', 'Result aggregation (merge/vote/first/all)', 'Per-agent timeouts'],
    inputs: ['Agent definitions', 'Concurrency limit', 'Aggregation strategy'],
    outputs: ['Aggregated result', 'Per-agent results', 'Timing data'],
    useCases: ['Parallel data analysis', 'Multi-perspective evaluation', 'Load-balanced processing'],
  },
  agent_supervisor: {
    capabilities: ['Supervisor-worker pattern', 'Dynamic task assignment', 'Progress monitoring', 'Re-delegation on failure', 'Quality checks'],
    inputs: ['Supervisor config', 'Worker pool', 'Master task'],
    outputs: ['Final result', 'Worker reports', 'Supervision log'],
    useCases: ['Complex project management', 'Quality-controlled pipelines', 'Adaptive task routing'],
  },
};

const NodesContent: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedType, setExpandedType] = useState<string | null>(null);

  const configs = Object.values(nodeTypeConfigs);
  const categoryOrder = ['trigger', 'ai', 'action', 'logic', 'data', 'http', 'code', 'approval', 'agents'];
  const categoryLabels: Record<string, string> = {
    trigger: 'Triggers', ai: 'AI / LLM', action: 'Actions', logic: 'Logic & Control Flow',
    data: 'Data Processing', http: 'HTTP & API', code: 'Code Execution',
    approval: 'Human-in-the-Loop', agents: 'Agent Orchestration',
  };

  const filtered = searchQuery
    ? configs.filter(c =>
        c.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.type.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : configs;

  // Group by category
  const grouped: Record<string, typeof configs> = {};
  filtered.forEach(c => {
    const cat = c.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(c);
  });
  const orderedCats = categoryOrder.filter(c => grouped[c]);
  const remaining = Object.keys(grouped).filter(c => !categoryOrder.includes(c));
  const allCats = [...orderedCats, ...remaining];

  const capBadgeStyle: React.CSSProperties = {
    backgroundColor: 'color-mix(in srgb, var(--user-accent-primary, #2196f3) 12%, transparent)',
    color: 'var(--user-accent-primary, #2196f3)',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {configs.length} node types available
        </span>
        <span className="text-xs px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>
          Read-only — drag nodes from sidebar to canvas
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
        <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search nodes by name, type, or capability..." className={`${inputClass} pl-9`} style={inputStyle} />
      </div>

      {allCats.map(cat => (
        <div key={cat}>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--color-text-secondary)' }}>
            <Layers className="w-4 h-4" />
            {categoryLabels[cat] || cat}
            <span className="text-xs font-normal" style={{ color: 'var(--color-text-tertiary)' }}>({(grouped[cat] || []).length})</span>
          </h3>
          <div className="space-y-2 mb-6">
            {(grouped[cat] || []).map(config => {
              const IconComp = nodeIconMap[config.type] || Settings;
              const isExpanded = expandedType === config.type;
              const caps = nodeCapabilities[config.type];
              return (
                <div
                  key={config.type}
                  onClick={() => setExpandedType(isExpanded ? null : config.type)}
                  className="rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md"
                  style={{
                    borderColor: isExpanded ? 'var(--user-accent-primary, #2196f3)' : 'var(--color-border)',
                    backgroundColor: isExpanded ? 'var(--color-surface)' : 'var(--color-bg-primary)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center shadow-sm"
                      style={{ backgroundColor: config.color }}
                    >
                      <IconComp size={20} color="white" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{config.label}</span>
                        <code className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>{config.type}</code>
                      </div>
                      <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
                        {config.description}
                      </p>

                      {/* Expanded: full capabilities */}
                      {isExpanded && caps && (
                        <div className="mt-3 space-y-3 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
                          {/* Capabilities */}
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                              Capabilities
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {caps.capabilities.map(c => (
                                <span key={c} className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={capBadgeStyle}>{c}</span>
                              ))}
                            </div>
                          </div>

                          {/* Inputs */}
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                              Inputs
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {caps.inputs.map(i => (
                                <span key={i} className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(34, 197, 94, 0.12)', color: 'var(--color-success)' }}>{i}</span>
                              ))}
                            </div>
                          </div>

                          {/* Outputs */}
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                              Outputs
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {caps.outputs.map(o => (
                                <span key={o} className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b' }}>{o}</span>
                              ))}
                            </div>
                          </div>

                          {/* Use Cases */}
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                              Use Cases
                            </div>
                            <ul className="space-y-1">
                              {caps.useCases.map(u => (
                                <li key={u} className="text-xs flex items-start gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                                  <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: 'var(--user-accent-primary, #2196f3)' }} />
                                  {u}
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Config Fields */}
                          {config.defaultData && Object.keys(config.defaultData).length > 0 && (
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                                Configuration
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {Object.keys(config.defaultData).map(k => (
                                  <span key={k} className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>
                                    {k}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Collapsed: show capability count hint */}
                      {!isExpanded && caps && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                            {caps.capabilities.length} capabilities · Click to see details
                          </span>
                        </div>
                      )}
                    </div>
                    <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
                      <ChevronRight className="w-4 h-4 flex-shrink-0 mt-1" style={{ color: 'var(--color-text-tertiary)' }} />
                    </motion.div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// CREDENTIALS CONTENT
// ---------------------------------------------------------------------------

const CredentialsContent: React.FC<{ workflowId?: string }> = ({ workflowId }) => {
  const { getAuthHeaders } = useAuth();
  const { mcps } = useMCP();
  const [tab, setTab] = useState<'secrets' | 'mcp' | 'providers'>('secrets');

  // Secrets
  const [secrets, setSecrets] = useState<any[]>([]);
  const [secretsLoading, setSecretsLoading] = useState(false);
  const [showAddSecret, setShowAddSecret] = useState(false);
  const [newSecret, setNewSecret] = useState({ name: '', value: '', scope: 'workflow' as string, description: '' });
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Providers
  const [providers, setProviders] = useState<any[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);

  // MCP health check
  const [healthChecking, setHealthChecking] = useState<string | null>(null);

  const fetchSecrets = useCallback(async () => {
    try {
      setSecretsLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint('/workflows/secrets'), { headers });
      if (res.ok) {
        const data = await res.json();
        setSecrets(Array.isArray(data) ? data : data.secrets || []);
      }
    } catch { /* silently handle */ }
    finally { setSecretsLoading(false); }
  }, [getAuthHeaders]);

  const fetchProviders = useCallback(async () => {
    try {
      setProvidersLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch('/api/admin/providers', { headers });
      if (res.ok) {
        const data = await res.json();
        setProviders(Array.isArray(data) ? data : data.providers || []);
      }
    } catch { /* non-admin */ }
    finally { setProvidersLoading(false); }
  }, [getAuthHeaders]);

  useEffect(() => { fetchSecrets(); fetchProviders(); }, [fetchSecrets, fetchProviders]);

  const handleAddSecret = useCallback(async () => {
    if (!newSecret.name.trim() || !newSecret.value.trim()) return;
    try {
      setSaving(true);
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch(workflowEndpoint('/workflows/secrets'), {
        method: 'POST', headers,
        body: JSON.stringify({ ...newSecret, workflow_id: workflowId }),
      });
      if (res.ok) {
        setNewSecret({ name: '', value: '', scope: 'workflow', description: '' });
        setShowAddSecret(false);
        fetchSecrets();
      }
    } catch { /* silently handle */ }
    finally { setSaving(false); }
  }, [newSecret, workflowId, getAuthHeaders, fetchSecrets]);

  const handleDeleteSecret = useCallback(async (id: string) => {
    try {
      const headers = getAuthHeaders();
      await fetch(workflowEndpoint(`/workflows/secrets/${id}`), { method: 'DELETE', headers });
      fetchSecrets();
    } catch { /* silently handle */ }
  }, [getAuthHeaders, fetchSecrets]);

  const handleCopy = useCallback((name: string, id: string) => {
    navigator.clipboard.writeText(`{{secret:${name}}}`).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handleHealthCheck = useCallback(async (serverId: string) => {
    setHealthChecking(serverId);
    // Health check is implicit via MCP context refresh; simulate delay
    setTimeout(() => setHealthChecking(null), 1500);
  }, []);

  const mcpToolCount = useMemo(() => {
    if (!mcps || mcps.length === 0) return 0;
    return mcps.reduce((sum, s) => sum + (s.tools?.length || 0), 0);
  }, [mcps]);

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
        <TabButton active={tab === 'secrets'} onClick={() => setTab('secrets')}>Secrets</TabButton>
        <TabButton active={tab === 'mcp'} onClick={() => setTab('mcp')}>MCP Servers</TabButton>
        <TabButton active={tab === 'providers'} onClick={() => setTab('providers')}>LLM Providers</TabButton>
      </div>

      {/* Secrets Tab */}
      {tab === 'secrets' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {secrets.length} secret{secrets.length !== 1 ? 's' : ''} configured
            </span>
            <button onClick={() => setShowAddSecret(!showAddSecret)} className={btnPrimary} style={btnPrimaryStyle}>
              <span className="flex items-center gap-1.5">
                {showAddSecret ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {showAddSecret ? 'Cancel' : 'Add Secret'}
              </span>
            </button>
          </div>

          {/* Add form */}
          <AnimatePresence>
            {showAddSecret && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden mb-4"
              >
                <div className="p-4 rounded-lg border space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" value={newSecret.name} onChange={e => setNewSecret(s => ({ ...s, name: e.target.value }))} placeholder="Secret name" className={inputClass} style={inputStyle} />
                    <input type="password" value={newSecret.value} onChange={e => setNewSecret(s => ({ ...s, value: e.target.value }))} placeholder="Secret value" className={inputClass} style={inputStyle} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <select value={newSecret.scope} onChange={e => setNewSecret(s => ({ ...s, scope: e.target.value }))} className={inputClass} style={inputStyle}>
                      <option value="workflow">Workflow scope</option>
                      <option value="group">Group scope</option>
                      <option value="global">Global scope</option>
                    </select>
                    <input type="text" value={newSecret.description} onChange={e => setNewSecret(s => ({ ...s, description: e.target.value }))} placeholder="Description (optional)" className={inputClass} style={inputStyle} />
                  </div>
                  <button onClick={handleAddSecret} disabled={saving || !newSecret.name.trim() || !newSecret.value.trim()} className={`${btnPrimary} w-full`} style={btnPrimaryStyle}>
                    {saving ? 'Saving...' : 'Add Secret'}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Secrets table */}
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface)' }}>
                  <th className={tableHeaderClass} style={tableHeaderStyle}>Name</th>
                  <th className={tableHeaderClass} style={tableHeaderStyle}>Scope</th>
                  <th className={tableHeaderClass} style={tableHeaderStyle}>Description</th>
                  <th className={tableHeaderClass} style={tableHeaderStyle}>Created</th>
                  <th className={`${tableHeaderClass} text-right`} style={tableHeaderStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {secretsLoading ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading...</td></tr>
                ) : secrets.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No secrets configured</td></tr>
                ) : (
                  secrets.map(secret => (
                    <tr key={secret.id} className="transition-colors hover:bg-[var(--color-surface)]">
                      <td className={tableCellClass} style={tableCellStyle}>
                        <div className="flex items-center gap-2">
                          <Key className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                          <span className="font-medium">{secret.name}</span>
                        </div>
                      </td>
                      <td className={tableCellClass} style={tableCellStyle}>
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: `${scopeColors[secret.scope]}20`, color: scopeColors[secret.scope] }}>
                          {secret.scope === 'global' && <Globe className="w-3 h-3" />}
                          {secret.scope === 'group' && <Shield className="w-3 h-3" />}
                          {secret.scope === 'workflow' && <Lock className="w-3 h-3" />}
                          {secret.scope}
                        </span>
                      </td>
                      <td className={tableCellClass} style={{ ...tableCellStyle, color: 'var(--color-text-secondary)' }}>
                        {secret.description || '-'}
                      </td>
                      <td className={tableCellClass} style={{ ...tableCellStyle, color: 'var(--color-text-tertiary)' }}>
                        {secret.created_at ? new Date(secret.created_at).toLocaleDateString() : '-'}
                      </td>
                      <td className={tableCellClass} style={tableCellStyle}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleCopy(secret.name, secret.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title={`Copy {{secret:${secret.name}}}`} style={{ color: 'var(--color-text-tertiary)' }}>
                            {copiedId === secret.id ? <Check className="w-4 h-4" style={{ color: '#22c55e' }} /> : <Copy className="w-4 h-4" />}
                          </button>
                          <button onClick={() => setEditingId(editingId === secret.id ? null : secret.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title="Edit" style={{ color: 'var(--color-text-tertiary)' }}>
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteSecret(secret.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title="Delete" style={{ color: '#ef5350' }}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MCP Servers Tab */}
      {tab === 'mcp' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {mcpToolCount} tools across {mcps?.length || 0} servers
            </span>
          </div>
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface)' }}>
                  <th className={tableHeaderClass} style={tableHeaderStyle}>Server</th>
                  <th className={tableHeaderClass} style={tableHeaderStyle}>Status</th>
                  <th className={tableHeaderClass} style={tableHeaderStyle}>Tools</th>
                  <th className={`${tableHeaderClass} text-right`} style={tableHeaderStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(!mcps || mcps.length === 0) ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No MCP servers available</td></tr>
                ) : (
                  mcps.map(server => (
                    <tr key={server.id} className="transition-colors hover:bg-[var(--color-surface)]">
                      <td className={tableCellClass} style={tableCellStyle}>
                        <span className="font-medium">{server.name}</span>
                      </td>
                      <td className={tableCellClass} style={tableCellStyle}>
                        <div className="flex items-center gap-2">
                          <StatusDot color={server.status === 'connected' || server.isConnected ? '#22c55e' : '#ef5350'} />
                          <span className="text-xs" style={{ color: server.status === 'connected' || server.isConnected ? '#22c55e' : '#ef5350' }}>
                            {server.status === 'connected' || server.isConnected ? 'Connected' : 'Disconnected'}
                          </span>
                        </div>
                      </td>
                      <td className={tableCellClass} style={tableCellStyle}>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                          {server.tools?.length || 0}
                        </span>
                      </td>
                      <td className={tableCellClass} style={tableCellStyle}>
                        <div className="flex items-center justify-end">
                          <button
                            onClick={() => handleHealthCheck(server.id)}
                            disabled={healthChecking === server.id}
                            className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]"
                            title="Health check"
                            style={{ color: 'var(--color-text-tertiary)' }}
                          >
                            <RefreshCw className={`w-4 h-4 ${healthChecking === server.id ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LLM Providers Tab */}
      {tab === 'providers' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {providers.length} provider{providers.length !== 1 ? 's' : ''} configured
            </span>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('openAdminPortal'))}
              className="flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: 'var(--user-accent-primary, #2196f3)' }}
            >
              <Settings className="w-4 h-4" />
              Manage in Admin
            </button>
          </div>
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-surface)' }}>
                  <th className={tableHeaderClass} style={tableHeaderStyle}>Provider</th>
                  <th className={tableHeaderClass} style={tableHeaderStyle}>Type</th>
                  <th className={tableHeaderClass} style={tableHeaderStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {providersLoading ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading...</td></tr>
                ) : providers.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No providers configured</td></tr>
                ) : (
                  providers.map((p, i) => (
                    <tr key={p.id || i} className="transition-colors hover:bg-[var(--color-surface)]">
                      <td className={tableCellClass} style={tableCellStyle}>
                        <span className="font-medium">{p.name || p.provider_name || p.display_name || 'Unknown'}</span>
                      </td>
                      <td className={tableCellClass} style={tableCellStyle}>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                          {p.type || p.provider_type || '-'}
                        </span>
                      </td>
                      <td className={tableCellClass} style={tableCellStyle}>
                        <div className="flex items-center gap-2">
                          <StatusDot color={p.enabled !== false ? '#22c55e' : '#9e9e9e'} />
                          <span className="text-xs">{p.enabled !== false ? 'Active' : 'Disabled'}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// AGENTS CONTENT
// ---------------------------------------------------------------------------

const AgentsContent: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newAgent, setNewAgent] = useState({
    display_name: '',
    system_prompt: '',
    model: '',
    tools_whitelist: '' as string,
    max_turns: 15,
    budget: 0,
  });
  const [testingId, setTestingId] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      // Try workflow-scoped agents endpoint first (non-admin), fall back to admin endpoint
      let res = await fetch(workflowEndpoint('/workflows/agents'), { headers });
      if (!res.ok) {
        res = await fetch('/api/admin/agents', { headers });
      }
      if (res.ok) {
        const data = await res.json();
        // Normalize openagentic-proxy format (name/role/model/tools) to UI format
        const normalized = (data.agents || []).map((a: any) => ({
          ...a,
          display_name: a.display_name || a.name || a.id,
          agent_type: a.agent_type || a.role || 'custom',
          model_config: a.model_config || (a.model ? { primaryModel: a.model } : {}),
          tools_whitelist: a.tools_whitelist || a.tools || [],
          system_prompt: a.system_prompt || '',
          category: a.category || 'platform',
          enabled: a.enabled !== false,
        }));
        setAgents(normalized);
      }
    } catch { /* non-admin */ }
    finally { setLoading(false); }
  }, [getAuthHeaders]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const handleCreate = useCallback(async () => {
    if (!newAgent.display_name.trim()) return;
    try {
      setSaving(true);
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const body = {
        display_name: newAgent.display_name.trim(),
        system_prompt: newAgent.system_prompt.trim(),
        model_config: { model: newAgent.model || undefined },
        tools_whitelist: newAgent.tools_whitelist ? newAgent.tools_whitelist.split(',').map(t => t.trim()).filter(Boolean) : [],
        max_turns: newAgent.max_turns,
        budget: newAgent.budget || undefined,
        category: 'custom',
        agent_type: 'worker',
        enabled: true,
      };
      const res = await fetch('/api/admin/agents', { method: 'POST', headers, body: JSON.stringify(body) });
      if (res.ok) {
        setNewAgent({ display_name: '', system_prompt: '', model: '', tools_whitelist: '', max_turns: 15, budget: 0 });
        setShowCreate(false);
        fetchAgents();
      }
    } catch { /* silently handle */ }
    finally { setSaving(false); }
  }, [newAgent, getAuthHeaders, fetchAgents]);

  const handleToggle = useCallback(async (agent: any) => {
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      await fetch(`/api/admin/agents/${agent.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ enabled: !agent.enabled }),
      });
      fetchAgents();
    } catch { /* silently handle */ }
  }, [getAuthHeaders, fetchAgents]);

  const [testResult, setTestResult] = useState<{ agentId: string; success: boolean; output?: string; error?: string } | null>(null);

  const handleTest = useCallback(async (agentId: string) => {
    setTestingId(agentId);
    setTestResult(null);
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch(`/api/agents/${agentId}/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ task: 'Briefly describe what you can do in 2-3 sentences.' }),
      });
      if (res.ok) {
        const data = await res.json();
        setTestResult({ agentId, success: true, output: data.output || data.result || JSON.stringify(data).substring(0, 500) });
      } else {
        const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setTestResult({ agentId, success: false, error: errorData.error || errorData.message || `HTTP ${res.status}` });
      }
    } catch (err: any) {
      setTestResult({ agentId, success: false, error: err.message || 'Network error' });
    } finally {
      setTestingId(null);
    }
  }, [getAuthHeaders]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {agents.length} agent{agents.length !== 1 ? 's' : ''} configured
        </span>
        <button onClick={() => setShowCreate(!showCreate)} className={btnPrimary} style={btnPrimaryStyle}>
          <span className="flex items-center gap-1.5">
            {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showCreate ? 'Cancel' : 'Create Agent'}
          </span>
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="p-4 rounded-lg border space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <input type="text" value={newAgent.display_name} onChange={e => setNewAgent(a => ({ ...a, display_name: e.target.value }))} placeholder="Agent name" className={inputClass} style={inputStyle} />
              <textarea value={newAgent.system_prompt} onChange={e => setNewAgent(a => ({ ...a, system_prompt: e.target.value }))} placeholder="System prompt..." rows={3} className={`${inputClass} resize-none`} style={inputStyle} />
              <div className="grid grid-cols-2 gap-3">
                <input type="text" value={newAgent.model} onChange={e => setNewAgent(a => ({ ...a, model: e.target.value }))} placeholder="Model (e.g. claude-sonnet-4-6)" className={inputClass} style={inputStyle} />
                <input type="text" value={newAgent.tools_whitelist} onChange={e => setNewAgent(a => ({ ...a, tools_whitelist: e.target.value }))} placeholder="Tools whitelist (comma-separated)" className={inputClass} style={inputStyle} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Max turns</label>
                  <input type="number" value={newAgent.max_turns} onChange={e => setNewAgent(a => ({ ...a, max_turns: Number(e.target.value) }))} className={inputClass} style={inputStyle} />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Budget (tokens, 0 = unlimited)</label>
                  <input type="number" value={newAgent.budget} onChange={e => setNewAgent(a => ({ ...a, budget: Number(e.target.value) }))} className={inputClass} style={inputStyle} />
                </div>
              </div>
              <button onClick={handleCreate} disabled={saving || !newAgent.display_name.trim()} className={`${btnPrimary} w-full`} style={btnPrimaryStyle}>
                {saving ? 'Creating...' : 'Create Agent'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Agents table */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ backgroundColor: 'var(--color-surface)' }}>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Agent</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Type</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Category</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Tools</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Model</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Enabled</th>
              <th className={`${tableHeaderClass} text-right`} style={tableHeaderStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading...</td></tr>
            ) : agents.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No agents configured</td></tr>
            ) : (
              agents.map(agent => (
                <tr key={agent.id} className="transition-colors hover:bg-[var(--color-surface)]">
                  <td className={tableCellClass} style={tableCellStyle}>
                    <div className="flex items-center gap-2">
                      <span className="text-base">{agent.icon || '\uD83E\uDD16'}</span>
                      <span className="font-medium">{agent.display_name}</span>
                    </div>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                      {agent.agent_type}
                    </span>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <span className="text-xs">{agent.category || '-'}</span>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <span className="text-xs">{agent.tools_whitelist?.length || 0}</span>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <span className="text-xs font-mono" style={{ color: 'var(--color-text-secondary)' }}>
                      {agent.model_config?.model || 'auto'}
                    </span>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <button onClick={() => handleToggle(agent)} className="relative w-9 h-5 rounded-full transition-colors" style={{ backgroundColor: agent.enabled !== false ? '#22c55e' : 'var(--color-surface-secondary, #555)' }}>
                      <motion.div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow" animate={{ left: agent.enabled !== false ? 18 : 2 }} transition={{ duration: 0.15 }} />
                    </button>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => handleTest(agent.id)}
                        disabled={testingId === agent.id}
                        className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]"
                        title="Test agent"
                        style={{ color: 'var(--user-accent-primary, #2196f3)' }}
                      >
                        {testingId === agent.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Test result display */}
      <AnimatePresence>
        {testResult && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={{
              padding: '10px 14px', borderRadius: 8, marginTop: 8,
              background: testResult.success ? 'rgba(34, 197, 94,0.08)' : 'rgba(244,67,54,0.08)',
              border: `1px solid ${testResult.success ? 'rgba(34, 197, 94,0.3)' : 'rgba(244,67,54,0.3)'}`,
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span style={{ fontSize: 11, fontWeight: 600, color: testResult.success ? '#22c55e' : '#f44336' }}>
                {testResult.success ? 'Test Passed' : 'Test Failed'}
              </span>
              <button onClick={() => setTestResult(null)} style={{ color: 'var(--color-text-tertiary)', padding: 2 }}>
                <X className="w-3 h-3" />
              </button>
            </div>
            <div style={{
              fontSize: 10, fontFamily: "'SF Mono', Monaco, monospace",
              color: 'var(--color-text-secondary)', maxHeight: 120, overflowY: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {testResult.output || testResult.error || 'No output'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DATA CONTENT
// ---------------------------------------------------------------------------

const DataContent: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const { mcps } = useMCP();
  const mcpServers = (mcps || []).map((s: any) => ({
    name: s.name || s.id,
    status: s.status,
    tools: (s.tools || []).map((t: any) => ({ name: t.name, description: t.description })),
  }));

  return <DataSection getAuthHeaders={getAuthHeaders} mcpServers={mcpServers} />;
};

// Legacy DataContent kept as _LegacyDataContent for reference
const _LegacyDataContent: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string } | null>(null);
  const [uploadCollection, setUploadCollection] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Create collection state
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creating, setCreating] = useState(false);

  // User documents from backend
  const [userDocuments, setUserDocuments] = useState<any[]>([]);

  const fetchStores = useCallback(async () => {
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint('/workflows/data/collections'), { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.stores) {
          setStores(data.stores);
        } else if (Array.isArray(data)) {
          const grouped: Record<string, any[]> = {};
          data.forEach((col: any) => {
            const store = col.store || 'pgvector';
            if (!grouped[store]) grouped[store] = [];
            grouped[store].push(col);
          });
          setStores(Object.entries(grouped).map(([store, collections]) => ({
            store, status: 'connected', collections,
          })));
        } else {
          const result: any[] = [];
          for (const key of ['milvus', 'pgvector', 'redis']) {
            if (data[key]) result.push({ store: key, status: data[key].status || 'configured', collections: data[key].collections || [] });
          }
          setStores(result);
        }
        // Capture user documents if available
        if (data.documents) {
          setUserDocuments(data.documents);
        }
      }
    } catch { /* silently handle */ }
    finally { setLoading(false); }
  }, [getAuthHeaders]);

  useEffect(() => { fetchStores(); }, [fetchStores]);

  // File upload handler
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedExts = ['txt', 'csv', 'json', 'md', 'pdf', 'markdown'];
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!allowedExts.includes(ext)) {
      setUploadResult({ success: false, message: `Unsupported file type: .${ext}. Allowed: ${allowedExts.join(', ')}` });
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(`Uploading ${file.name}...`);
      setUploadResult(null);

      const formData = new FormData();
      formData.append('file', file);
      if (uploadCollection.trim()) {
        formData.append('collectionName', uploadCollection.trim());
      }

      const headers = getAuthHeaders();
      // Remove Content-Type so browser sets multipart boundary automatically
      const hdrs: Record<string, string> = {};
      Object.entries(headers).forEach(([k, v]) => {
        if (k.toLowerCase() !== 'content-type') hdrs[k] = v as string;
      });

      const res = await fetch(workflowEndpoint('/workflows/data/upload'), {
        method: 'POST',
        headers: hdrs,
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setUploadResult({ success: true, message: data.message || `Uploaded ${file.name}: ${data.chunks} chunks` });
        fetchStores();
      } else {
        setUploadResult({ success: false, message: data.error || 'Upload failed' });
      }
    } catch (err: any) {
      setUploadResult({ success: false, message: err.message || 'Upload failed' });
    } finally {
      setUploading(false);
      setUploadProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [getAuthHeaders, uploadCollection, fetchStores]);

  // Create collection handler
  const handleCreateCollection = useCallback(async () => {
    if (!newCollectionName.trim()) return;
    try {
      setCreating(true);
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint('/workflows/data/collections'), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCollectionName.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNewCollectionName('');
        setShowCreateCollection(false);
        fetchStores();
      } else {
        alert(data.error || 'Failed to create collection');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to create collection');
    } finally {
      setCreating(false);
    }
  }, [getAuthHeaders, newCollectionName, fetchStores]);

  const storeLabels: Record<string, string> = { milvus: 'Milvus (Vector)', pgvector: 'pgvector (SQL+Vector)', redis: 'Redis (Cache)' };
  const storeColors: Record<string, string> = { milvus: '#9c27b0', pgvector: '#2196f3', redis: '#ef5350' };
  const statusColors: Record<string, string> = { connected: '#22c55e', configured: '#ff9800', disconnected: '#ef5350' };

  return (
    <div className="space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {stores.length} data store{stores.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCreateCollection(!showCreateCollection)}
            className="p-2 rounded-lg transition-colors hover:bg-[var(--color-surface)]"
            style={{ color: 'var(--color-accent)' }}
            title="Create Collection"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button onClick={fetchStores} disabled={loading} className="p-2 rounded-lg transition-colors hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-text-tertiary)' }}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Create Collection Form */}
      <AnimatePresence>
        {showCreateCollection && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 rounded-lg border space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>New Collection</div>
              <input
                type="text"
                value={newCollectionName}
                onChange={e => setNewCollectionName(e.target.value)}
                placeholder="Collection name (e.g. my_documents)"
                className={inputClass}
                style={inputStyle}
                onKeyDown={e => e.key === 'Enter' && handleCreateCollection()}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreateCollection}
                  disabled={creating || !newCollectionName.trim()}
                  className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'white' }}
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
                <button
                  onClick={() => { setShowCreateCollection(false); setNewCollectionName(''); }}
                  className="px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-[var(--color-surface-hover)]"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File Upload Section */}
      <div className="p-3 rounded-lg border space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Upload File</div>
        <input
          type="text"
          value={uploadCollection}
          onChange={e => setUploadCollection(e.target.value)}
          placeholder="Target collection (optional, auto-generated if empty)"
          className={inputClass}
          style={inputStyle}
        />
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv,.json,.md,.pdf,.markdown"
            onChange={handleFileUpload}
            className="hidden"
            id="data-file-upload"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)', color: 'white' }}
          >
            <Upload className="w-3.5 h-3.5" />
            {uploading ? 'Uploading...' : 'Choose File'}
          </button>
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>.txt, .csv, .json, .md, .pdf</span>
        </div>
        {uploading && uploadProgress && (
          <div className="flex items-center gap-2">
            <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: 'var(--color-accent)' }}
                initial={{ width: '10%' }}
                animate={{ width: '90%' }}
                transition={{ duration: 10, ease: 'linear' }}
              />
            </div>
            <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>{uploadProgress}</span>
          </div>
        )}
        {uploadResult && (
          <div
            className="text-xs px-2 py-1.5 rounded"
            style={{
              backgroundColor: uploadResult.success ? 'rgba(34, 197, 94,0.1)' : 'rgba(239,83,80,0.1)',
              color: uploadResult.success ? '#22c55e' : '#ef5350',
            }}
          >
            {uploadResult.message}
          </div>
        )}
      </div>

      {/* Simple filter */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
        <input type="text" value={filterQuery} onChange={e => setFilterQuery(e.target.value)} placeholder="Filter collections..." className={`${inputClass} pl-9`} style={inputStyle} />
      </div>

      {loading && stores.length === 0 ? (
        <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading data stores...</div>
      ) : stores.length === 0 ? (
        <div className="py-8 text-center">
          <Database className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-text-tertiary)' }} />
          <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No data stores found</span>
        </div>
      ) : (
        <div className="space-y-3">
          {stores.map((store: any) => {
            const storeKey = store.store || store.type;
            const collections = (store.collections || store.tables?.map((t: string) => ({ name: t })) || []).filter((c: any) =>
              !filterQuery || c.name?.toLowerCase().includes(filterQuery.toLowerCase())
            );
            return (
              <div key={storeKey} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                {/* Store header */}
                <button
                  onClick={() => setExpandedStore(expandedStore === storeKey ? null : storeKey)}
                  className="w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-surface)]"
                  style={{ backgroundColor: 'var(--color-surface)' }}
                >
                  <Database className="w-5 h-5 flex-shrink-0" style={{ color: storeColors[storeKey] || '#999' }} />
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      {storeLabels[storeKey] || storeKey}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      {collections.length} collection{collections.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusDot color={statusColors[store.status] || '#9e9e9e'} />
                    <span className="text-xs capitalize" style={{ color: statusColors[store.status] || '#9e9e9e' }}>
                      {store.status}
                    </span>
                  </div>
                  <motion.div animate={{ rotate: expandedStore === storeKey ? 90 : 0 }} transition={{ duration: 0.15 }}>
                    <ChevronRight className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                  </motion.div>
                </button>

                {/* Collections table */}
                <AnimatePresence>
                  {expandedStore === storeKey && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                      <table className="w-full">
                        <thead>
                          <tr>
                            <th className={tableHeaderClass} style={tableHeaderStyle}>Collection</th>
                            <th className={tableHeaderClass} style={tableHeaderStyle}>Documents</th>
                            <th className={tableHeaderClass} style={tableHeaderStyle}>Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {collections.length === 0 ? (
                            <tr><td colSpan={3} className="px-3 py-4 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No collections</td></tr>
                          ) : (
                            collections.map((col: any) => (
                              <tr key={col.name} className="transition-colors hover:bg-[var(--color-surface)]">
                                <td className={tableCellClass} style={tableCellStyle}>
                                  <span className="font-medium">{col.name}</span>
                                </td>
                                <td className={tableCellClass} style={{ ...tableCellStyle, color: 'var(--color-text-secondary)' }}>
                                  {col.documentCount !== undefined ? col.documentCount.toLocaleString() : col.entity_count !== undefined ? col.entity_count.toLocaleString() : '-'}
                                </td>
                                <td className={tableCellClass} style={{ ...tableCellStyle, color: 'var(--color-text-tertiary)' }}>
                                  {col.updatedAt ? new Date(col.updatedAt).toLocaleDateString() : '-'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {/* User Documents Section */}
      {userDocuments.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Your Documents ({userDocuments.length})
          </div>
          <div className="space-y-1">
            {userDocuments.map((doc: any) => (
              <div
                key={doc.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(156,39,176,0.1)' }}>
                  <Database className="w-4 h-4" style={{ color: '#9c27b0' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {doc.name}
                  </div>
                  <div className="text-[11px] flex items-center gap-2" style={{ color: 'var(--color-text-tertiary)' }}>
                    <span>{doc.type}</span>
                    <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// VARIABLES CONTENT
// ---------------------------------------------------------------------------

interface VariablesContentProps {
  variables: Record<string, any>;
  onVariablesChange: (vars: Record<string, any>) => void;
}

interface VarEntry {
  key: string;
  value: any;
  type: VariableType;
  description: string;
}

function inferType(value: any): VariableType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && value.startsWith('{{secret:')) return 'secret_ref';
  if (typeof value === 'object' && value !== null) return 'json';
  return 'string';
}

function coerceValue(value: string, type: VariableType): any {
  switch (type) {
    case 'number': { const n = Number(value); return isNaN(n) ? 0 : n; }
    case 'boolean': return value === 'true' || value === '1';
    case 'json': try { return JSON.parse(value); } catch { return value; }
    default: return value;
  }
}

const VariablesContent: React.FC<VariablesContentProps> = ({ variables, onVariablesChange }) => {
  const [entries, setEntries] = useState<VarEntry[]>(() =>
    Object.entries(variables).map(([key, value]) => ({ key, value, type: inferType(value), description: '' }))
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showExpressions, setShowExpressions] = useState(false);

  const commitChanges = useCallback((updated: VarEntry[]) => {
    const vars: Record<string, any> = {};
    updated.forEach(e => { if (e.key.trim()) vars[e.key.trim()] = e.value; });
    onVariablesChange(vars);
  }, [onVariablesChange]);

  const handleAdd = useCallback(() => {
    const updated = [...entries, { key: '', value: '', type: 'string' as VariableType, description: '' }];
    setEntries(updated);
  }, [entries]);

  const handleDelete = useCallback((index: number) => {
    const updated = entries.filter((_, i) => i !== index);
    setEntries(updated);
    commitChanges(updated);
  }, [entries, commitChanges]);

  const handleChange = useCallback((index: number, field: keyof VarEntry, val: string) => {
    const updated = [...entries];
    if (field === 'key') updated[index] = { ...updated[index], key: val };
    else if (field === 'type') {
      const newType = val as VariableType;
      updated[index] = { ...updated[index], type: newType, value: coerceValue(String(updated[index].value), newType) };
    }
    else if (field === 'value') updated[index] = { ...updated[index], value: coerceValue(val, updated[index].type) };
    else if (field === 'description') updated[index] = { ...updated[index], description: val };
    setEntries(updated);
  }, [entries]);

  const handleBlur = useCallback(() => { commitChanges(entries); }, [entries, commitChanges]);

  const handleCopy = useCallback((key: string) => {
    navigator.clipboard.writeText(`{{variables.${key}}}`).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }, []);

  const handleExport = useCallback(() => {
    const vars: Record<string, any> = {};
    entries.forEach(e => { if (e.key.trim()) vars[e.key.trim()] = e.value; });
    const blob = new Blob([JSON.stringify(vars, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'variables.json'; a.click();
    URL.revokeObjectURL(url);
  }, [entries]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (typeof data === 'object' && data !== null) {
            const imported = Object.entries(data).map(([key, value]) => ({
              key, value, type: inferType(value), description: '',
            }));
            setEntries(imported);
            commitChanges(imported);
          }
        } catch { /* invalid JSON */ }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [commitChanges]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {entries.length} variable{entries.length !== 1 ? 's' : ''} defined
        </span>
        <div className="flex items-center gap-2">
          <button onClick={handleImport} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border transition-colors hover:bg-[var(--color-surface)]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <Upload className="w-3.5 h-3.5" /> Import
          </button>
          <button onClick={handleExport} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border transition-colors hover:bg-[var(--color-surface)]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button onClick={handleAdd} className={btnPrimary} style={btnPrimaryStyle}>
            <span className="flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add Variable</span>
          </button>
        </div>
      </div>

      {/* Variables table */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ backgroundColor: 'var(--color-surface)' }}>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Name</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Type</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Default Value</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Description</th>
              <th className={`${tableHeaderClass} text-right`} style={tableHeaderStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No variables defined</td></tr>
            ) : (
              entries.map((entry, index) => (
                <tr key={index} className="transition-colors hover:bg-[var(--color-surface)]">
                  <td className={tableCellClass} style={tableCellStyle}>
                    <input type="text" value={entry.key} onChange={e => handleChange(index, 'key', e.target.value)} onBlur={handleBlur} placeholder="name" className="w-full bg-transparent text-sm font-medium focus:outline-none" style={{ color: 'var(--color-text)' }} />
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <select value={entry.type} onChange={e => { handleChange(index, 'type', e.target.value); commitChanges(entries); }} className="text-xs px-2 py-1 rounded-lg border-none cursor-pointer focus:outline-none" style={{ backgroundColor: `${typeColors[entry.type]}20`, color: typeColors[entry.type] }}>
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="json">json</option>
                      <option value="secret_ref">secret_ref</option>
                    </select>
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <input
                      type={entry.type === 'secret_ref' ? 'password' : 'text'}
                      value={entry.type === 'boolean' ? String(entry.value) : (typeof entry.value === 'object' ? JSON.stringify(entry.value) : String(entry.value ?? ''))}
                      onChange={e => handleChange(index, 'value', e.target.value)}
                      onBlur={handleBlur}
                      placeholder="value"
                      className="w-full bg-transparent text-sm focus:outline-none"
                      style={{ color: 'var(--color-text)' }}
                    />
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <input type="text" value={entry.description} onChange={e => handleChange(index, 'description', e.target.value)} onBlur={handleBlur} placeholder="description" className="w-full bg-transparent text-sm focus:outline-none" style={{ color: 'var(--color-text-secondary)' }} />
                  </td>
                  <td className={tableCellClass} style={tableCellStyle}>
                    <div className="flex items-center justify-end gap-1">
                      {entry.key.trim() && (
                        <button onClick={() => handleCopy(entry.key)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title={`Copy {{variables.${entry.key}}}`} style={{ color: 'var(--color-text-tertiary)' }}>
                          {copiedKey === entry.key ? <Check className="w-4 h-4" style={{ color: '#22c55e' }} /> : <Copy className="w-4 h-4" />}
                        </button>
                      )}
                      <button onClick={() => handleDelete(index)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" style={{ color: '#ef5350' }}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Expression helper */}
      <div className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <button onClick={() => setShowExpressions(!showExpressions)} className="flex items-center gap-2 w-full text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          <motion.div animate={{ rotate: showExpressions ? 180 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronDown className="w-4 h-4" />
          </motion.div>
          <Info className="w-4 h-4" />
          Expression Helpers
        </button>
        <AnimatePresence>
          {showExpressions && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden mt-3">
              <div className="grid grid-cols-2 gap-2">
                {COMMON_EXPRESSIONS.map(ce => (
                  <button
                    key={ce.expr}
                    onClick={() => { navigator.clipboard.writeText(ce.expr).catch(() => {}); setCopiedKey(ce.expr); setTimeout(() => setCopiedKey(null), 1500); }}
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors hover:bg-[var(--color-bg-primary)]"
                  >
                    <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{ce.label}</span>
                    <span className="flex items-center gap-1.5">
                      <code className="text-xs font-mono" style={{ color: 'var(--user-accent-primary, #2196f3)' }}>{ce.expr}</code>
                      {copiedKey === ce.expr ? <Check className="w-3.5 h-3.5" style={{ color: '#22c55e' }} /> : <Copy className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// WEBHOOKS CONTENT
// ---------------------------------------------------------------------------

const WebhooksContent: React.FC<{ workflowId?: string }> = ({ workflowId }) => {
  const { getAuthHeaders } = useAuth();
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newWebhook, setNewWebhook] = useState({ name: '', method: 'POST', response_mode: 'async' });
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    if (!workflowId) return;
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/webhooks`), { headers });
      if (res.ok) {
        const data = await res.json();
        setWebhooks(Array.isArray(data) ? data : data.webhooks || []);
      }
    } catch { /* silently handle */ }
    finally { setLoading(false); }
  }, [workflowId, getAuthHeaders]);

  useEffect(() => { fetchWebhooks(); }, [fetchWebhooks]);

  const handleAdd = useCallback(async () => {
    if (!workflowId || !newWebhook.name.trim()) return;
    try {
      setSaving(true);
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/webhooks`), {
        method: 'POST', headers,
        body: JSON.stringify(newWebhook),
      });
      if (res.ok) { setNewWebhook({ name: '', method: 'POST', response_mode: 'async' }); setShowAdd(false); fetchWebhooks(); }
    } catch { /* silently handle */ }
    finally { setSaving(false); }
  }, [workflowId, newWebhook, getAuthHeaders, fetchWebhooks]);

  const handleDelete = useCallback(async (webhookId: string) => {
    if (!workflowId) return;
    try {
      const headers = getAuthHeaders();
      await fetch(workflowEndpoint(`/workflows/${workflowId}/webhooks/${webhookId}`), { method: 'DELETE', headers });
      fetchWebhooks();
    } catch { /* silently handle */ }
  }, [workflowId, getAuthHeaders, fetchWebhooks]);

  const handleTest = useCallback(async (wh: any) => {
    setTestingId(wh.id);
    setTestResult(null);
    const start = performance.now();
    try {
      const res = await fetch(wh.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test: true, timestamp: new Date().toISOString() }) });
      setTestResult({ id: wh.id, status: res.status, time: Math.round(performance.now() - start) });
    } catch {
      setTestResult({ id: wh.id, status: 0, time: Math.round(performance.now() - start) });
    }
    finally { setTestingId(null); }
  }, []);

  const handleCopy = useCallback((url: string, id: string) => {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  if (!workflowId) {
    return <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Save workflow first to configure webhooks</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {webhooks.length} webhook{webhooks.length !== 1 ? 's' : ''} configured
        </span>
        <button onClick={() => setShowAdd(!showAdd)} className={btnPrimary} style={btnPrimaryStyle}>
          <span className="flex items-center gap-1.5">
            {showAdd ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showAdd ? 'Cancel' : 'Add Webhook'}
          </span>
        </button>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="p-4 rounded-lg border space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <input type="text" value={newWebhook.name} onChange={e => setNewWebhook(w => ({ ...w, name: e.target.value }))} placeholder="Webhook name" className={inputClass} style={inputStyle} />
              <div className="grid grid-cols-2 gap-3">
                <select value={newWebhook.method} onChange={e => setNewWebhook(w => ({ ...w, method: e.target.value }))} className={inputClass} style={inputStyle}>
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
                <select value={newWebhook.response_mode} onChange={e => setNewWebhook(w => ({ ...w, response_mode: e.target.value }))} className={inputClass} style={inputStyle}>
                  <option value="async">Async</option>
                  <option value="sync">Sync</option>
                </select>
              </div>
              <button onClick={handleAdd} disabled={saving || !newWebhook.name.trim()} className={`${btnPrimary} w-full`} style={btnPrimaryStyle}>
                {saving ? 'Creating...' : 'Add Webhook'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Webhooks list */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ backgroundColor: 'var(--color-surface)' }}>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Name</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Method</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>URL</th>
              <th className={tableHeaderClass} style={tableHeaderStyle}>Status</th>
              <th className={`${tableHeaderClass} text-right`} style={tableHeaderStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading...</td></tr>
            ) : webhooks.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No webhooks configured</td></tr>
            ) : (
              webhooks.map(wh => (
                <React.Fragment key={wh.id}>
                  <tr className="transition-colors hover:bg-[var(--color-surface)]">
                    <td className={tableCellClass} style={tableCellStyle}>
                      <div className="flex items-center gap-2">
                        <Link className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                        <span className="font-medium">{wh.name}</span>
                      </div>
                    </td>
                    <td className={tableCellClass} style={tableCellStyle}>
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded" style={{ backgroundColor: `${methodColors[wh.method]}20`, color: methodColors[wh.method] }}>
                        {wh.method}
                      </span>
                    </td>
                    <td className={tableCellClass} style={tableCellStyle}>
                      <code className="text-xs font-mono truncate max-w-[200px] block" style={{ color: 'var(--color-text-tertiary)' }}>
                        {wh.url}
                      </code>
                    </td>
                    <td className={tableCellClass} style={tableCellStyle}>
                      <div className="flex items-center gap-2">
                        <StatusDot color={wh.status === 'active' ? '#22c55e' : '#9e9e9e'} />
                        <span className="text-xs">{wh.status}</span>
                      </div>
                    </td>
                    <td className={tableCellClass} style={tableCellStyle}>
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleTest(wh)} disabled={testingId === wh.id} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title="Test webhook" style={{ color: 'var(--user-accent-primary, #2196f3)' }}>
                          {testingId === wh.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        </button>
                        <button onClick={() => handleCopy(wh.url, wh.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title="Copy URL" style={{ color: 'var(--color-text-tertiary)' }}>
                          {copiedId === wh.id ? <Check className="w-4 h-4" style={{ color: '#22c55e' }} /> : <Copy className="w-4 h-4" />}
                        </button>
                        {wh.stats?.last_calls?.length > 0 && (
                          <button onClick={() => setExpandedId(expandedId === wh.id ? null : wh.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title="Request history" style={{ color: 'var(--color-text-tertiary)' }}>
                            <Clock className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => handleDelete(wh.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--color-surface)]" title="Delete" style={{ color: '#ef5350' }}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* Test result + history */}
                  {(testResult?.id === wh.id || expandedId === wh.id) && (
                    <tr>
                      <td colSpan={5} className="px-4 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {testResult?.id === wh.id && (
                          <div className="text-xs font-mono mb-2" style={{ color: testResult.status >= 200 && testResult.status < 300 ? '#22c55e' : '#ef5350' }}>
                            Test: {testResult.status === 0 ? 'Failed' : `${testResult.status}`} ({testResult.time}ms)
                          </div>
                        )}
                        {expandedId === wh.id && wh.stats?.last_calls && (
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Recent Calls</div>
                            <div className="space-y-1">
                              {wh.stats.last_calls.slice(0, 10).map((call: any, i: number) => (
                                <div key={i} className="flex items-center gap-3 text-xs">
                                  <span style={{ color: 'var(--color-text-tertiary)' }}>{new Date(call.timestamp).toLocaleString()}</span>
                                  <span className="font-mono font-bold" style={{ color: call.status_code >= 200 && call.status_code < 300 ? '#22c55e' : '#ef5350' }}>{call.status_code}</span>
                                  <span style={{ color: 'var(--color-text-tertiary)' }}>{call.response_time_ms}ms</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// API ENDPOINT CONTENT
// ---------------------------------------------------------------------------

const ApiEndpointContent: React.FC<{ workflowId?: string }> = ({ workflowId }) => {
  const { getAuthHeaders } = useAuth();
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: number; time: number; preview: string } | null>(null);

  useEffect(() => {
    if (!workflowId) return;
    fetch(workflowEndpoint(`/workflows/${workflowId}/webhooks`), { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setWebhooks(Array.isArray(data) ? data : data.webhooks || []); })
      .catch(() => {});
  }, [workflowId, getAuthHeaders]);

  const baseUrl = window.location.origin;
  const executeUrl = `${baseUrl}/api/workflows/${workflowId}/execute`;
  const curlDirect = `curl -sN -X POST '${executeUrl}' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"input":{"message":"Hello"}}'`;

  const copy = (text: string, field: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const handleTest = async () => {
    if (!workflowId) return;
    setTesting(true);
    setTestResult(null);
    const start = performance.now();
    try {
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/execute`), {
        method: 'POST',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      });
      const time = Math.round(performance.now() - start);
      const text = await res.text();
      setTestResult({ status: res.status, time, preview: text.slice(0, 500) });
    } catch (e: any) {
      setTestResult({ status: 0, time: Math.round(performance.now() - start), preview: e.message });
    } finally {
      setTesting(false);
    }
  };

  if (!workflowId) {
    return <div className="py-12 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Save workflow first to see API endpoints</div>;
  }

  const CopyBtn: React.FC<{ field: string; text: string }> = ({ field, text }) => (
    <button onClick={() => copy(text, field)} className="p-1 rounded transition-colors hover:bg-[var(--color-surface)]" style={{ color: 'var(--color-text-tertiary)' }}>
      {copiedField === field ? <Check className="w-3.5 h-3.5" style={{ color: '#2ea043' }} /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Direct Execute */}
      <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4" style={{ color: '#2ea043' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Direct Execute</h3>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full font-mono font-bold" style={{ backgroundColor: '#2ea04315', color: '#2ea043' }}>POST</span>
        </div>

        <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: 'var(--color-bg-primary)' }}>
          <code className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{executeUrl}</code>
          <CopyBtn field="exec-url" text={executeUrl} />
        </div>

        <div className="text-xs space-y-1" style={{ color: 'var(--color-text-tertiary)' }}>
          <p><strong style={{ color: 'var(--color-text-secondary)' }}>Authentication:</strong> <code className="font-mono px-1" style={{ color: '#bc8cff' }}>Authorization: Bearer &lt;api_key&gt;</code></p>
          <p><strong style={{ color: 'var(--color-text-secondary)' }}>Content-Type:</strong> <code className="font-mono px-1">application/json</code></p>
          <p><strong style={{ color: 'var(--color-text-secondary)' }}>Response:</strong> SSE stream (<code className="font-mono px-1">text/event-stream</code>)</p>
        </div>

        <div className="relative">
          <pre className="text-xs font-mono p-3 rounded-lg overflow-x-auto" style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{curlDirect}</pre>
          <div className="absolute top-2 right-2"><CopyBtn field="curl" text={curlDirect} /></div>
        </div>

        <button onClick={handleTest} disabled={testing} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50" style={{ backgroundColor: 'var(--user-accent-primary, #2196f3)', color: '#fff' }}>
          <Play className="w-3 h-3" />
          {testing ? 'Running...' : 'Try it'}
        </button>

        {testResult && (
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-3 text-xs">
              <span className="font-mono font-bold" style={{ color: testResult.status >= 200 && testResult.status < 300 ? '#2ea043' : '#f85149' }}>{testResult.status || 'Error'}</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>{testResult.time}ms</span>
            </div>
            <pre className="text-[10px] font-mono p-2 rounded-lg overflow-auto max-h-48" style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-tertiary)' }}>{testResult.preview}</pre>
          </div>
        )}
      </div>

      {/* Webhook Endpoints */}
      {webhooks.length > 0 && (
        <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex items-center gap-2">
            <Link className="w-4 h-4" style={{ color: '#d29922' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Webhook Endpoints</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-tertiary)' }}>No auth required</span>
          </div>
          {webhooks.map((wh: any) => {
            const whCurl = `curl -sN -X POST '${wh.url}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"input":{"message":"Hello"}}'`;
            return (
              <div key={wh.id} className="p-3 rounded-lg border space-y-2" style={{ borderColor: 'var(--color-border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{wh.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#2196f315', color: '#58a6ff' }}>{wh.response_mode}</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--color-bg-primary)' }}>
                  <code className="text-[11px] font-mono flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{wh.url}</code>
                  <CopyBtn field={`wh-${wh.id}`} text={wh.url} />
                </div>
                <div className="relative">
                  <pre className="text-[10px] font-mono p-2 rounded overflow-x-auto" style={{ backgroundColor: 'var(--color-bg-primary)', color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>{whCurl}</pre>
                  <div className="absolute top-1 right-1"><CopyBtn field={`wh-curl-${wh.id}`} text={whCurl} /></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Workflow ID */}
      <div className="flex items-center justify-between text-xs p-3 rounded-lg" style={{ background: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>
        <span>Workflow ID</span>
        <div className="flex items-center gap-1 font-mono">{workflowId}<CopyBtn field="wfid" text={workflowId} /></div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// TEAM CONTENT
// ---------------------------------------------------------------------------

const TeamContent: React.FC<{ workflowId?: string }> = ({ workflowId }) => {
  const { getAuthHeaders } = useAuth();
  const [shares, setShares] = useState<any[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddUser, setShowAddUser] = useState(false);
  const [newShare, setNewShare] = useState({ email: '', role: 'viewer' });
  const [saving, setSaving] = useState(false);

  const fetchShares = useCallback(async () => {
    if (!workflowId) return;
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/shares`), { headers });
      if (res.ok) {
        const data = await res.json();
        setShares(Array.isArray(data) ? data : data.shares || []);
        if (data.owner) setOwner(data.owner);
      }
    } catch { /* silently handle */ }
    finally { setLoading(false); }
  }, [workflowId, getAuthHeaders]);

  const fetchActivity = useCallback(async () => {
    if (!workflowId) return;
    try {
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/executions?limit=10`), { headers });
      if (res.ok) {
        const data = await res.json();
        const execs = Array.isArray(data) ? data : data.executions || [];
        setActivity(execs.slice(0, 10).map((ex: any) => ({
          id: ex.id,
          user_name: ex.user_name || ex.user_email || 'Unknown',
          status: ex.status,
          started_at: ex.started_at || ex.created_at,
          duration_ms: ex.duration_ms,
        })));
      }
    } catch { /* silently handle */ }
  }, [workflowId, getAuthHeaders]);

  useEffect(() => { fetchShares(); fetchActivity(); }, [fetchShares, fetchActivity]);

  const handleAddShare = useCallback(async () => {
    if (!workflowId || !newShare.email.trim()) return;
    try {
      setSaving(true);
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/shares`), {
        method: 'POST', headers,
        body: JSON.stringify({ email: newShare.email.trim(), role: newShare.role }),
      });
      if (res.ok) { setNewShare({ email: '', role: 'viewer' }); setShowAddUser(false); fetchShares(); }
    } catch { /* silently handle */ }
    finally { setSaving(false); }
  }, [workflowId, newShare, getAuthHeaders, fetchShares]);

  const handleUpdateRole = useCallback(async (shareId: string, role: string) => {
    if (!workflowId) return;
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      await fetch(workflowEndpoint(`/workflows/${workflowId}/shares/${shareId}`), {
        method: 'PATCH', headers, body: JSON.stringify({ role }),
      });
      fetchShares();
    } catch { /* silently handle */ }
  }, [workflowId, getAuthHeaders, fetchShares]);

  const statusColors: Record<string, string> = { completed: '#22c55e', failed: '#ef5350', running: '#ff9800' };

  if (!workflowId) {
    return <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Save workflow first to manage team access</div>;
  }

  return (
    <div className="space-y-4">
      {/* Owner */}
      {owner && (
        <div className="flex items-center gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Owner:</span>
          <span className="text-sm font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--user-accent-primary, #2196f3)' + '20', color: 'var(--user-accent-primary, #2196f3)' }}>
            {owner}
          </span>
        </div>
      )}

      {/* Shares */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Shared with {shares.length} user{shares.length !== 1 ? 's' : ''}
          </span>
          <button onClick={() => setShowAddUser(!showAddUser)} className={btnPrimary} style={btnPrimaryStyle}>
            <span className="flex items-center gap-1.5">
              {showAddUser ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showAddUser ? 'Cancel' : 'Add User'}
            </span>
          </button>
        </div>

        {/* Add user form */}
        <AnimatePresence>
          {showAddUser && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden mb-4">
              <div className="p-4 rounded-lg border space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input type="text" value={newShare.email} onChange={e => setNewShare(s => ({ ...s, email: e.target.value }))} placeholder="Search by email..." className={`${inputClass} pl-9`} style={inputStyle} />
                </div>
                <select value={newShare.role} onChange={e => setNewShare(s => ({ ...s, role: e.target.value }))} className={inputClass} style={inputStyle}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="executor">Executor</option>
                  <option value="admin">Admin</option>
                </select>
                <button onClick={handleAddShare} disabled={saving || !newShare.email.trim()} className={`${btnPrimary} w-full`} style={btnPrimaryStyle}>
                  {saving ? 'Adding...' : 'Add User'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Shares table */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface)' }}>
                <th className={tableHeaderClass} style={tableHeaderStyle}>User / Group</th>
                <th className={tableHeaderClass} style={tableHeaderStyle}>Email</th>
                <th className={tableHeaderClass} style={tableHeaderStyle}>Role</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading...</td></tr>
              ) : shares.length === 0 ? (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No shares yet</td></tr>
              ) : (
                shares.map(share => (
                  <tr key={share.id} className="transition-colors hover:bg-[var(--color-surface)]">
                    <td className={tableCellClass} style={tableCellStyle}>
                      <div className="flex items-center gap-2">
                        {share.type === 'group' ? (
                          <Users className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
                        ) : (
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold" style={{ backgroundColor: 'var(--color-surface-secondary, #444)', color: 'var(--color-text-secondary)' }}>
                            {share.name?.charAt(0)?.toUpperCase() || '?'}
                          </span>
                        )}
                        <span className="font-medium">{share.name}</span>
                      </div>
                    </td>
                    <td className={tableCellClass} style={{ ...tableCellStyle, color: 'var(--color-text-secondary)' }}>
                      {share.email || '-'}
                    </td>
                    <td className={tableCellClass} style={tableCellStyle}>
                      <select
                        value={share.role}
                        onChange={e => handleUpdateRole(share.id, e.target.value)}
                        className="text-xs px-2 py-1 rounded-lg border-none cursor-pointer focus:outline-none"
                        style={{ backgroundColor: `${roleColors[share.role]}20`, color: roleColors[share.role] }}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                        <option value="executor">Executor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Activity feed */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Activity Feed</span>
        </div>
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          {activity.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No recent activity</div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {activity.map(entry => (
                <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-surface)]">
                  <StatusDot color={statusColors[entry.status] || '#9e9e9e'} />
                  <span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>{entry.user_name}</span>
                  <span className="text-xs capitalize" style={{ color: statusColors[entry.status] || '#9e9e9e' }}>{entry.status}</span>
                  {entry.duration_ms !== undefined && (
                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      {entry.duration_ms < 1000 ? `${entry.duration_ms}ms` : `${(entry.duration_ms / 1000).toFixed(1)}s`}
                    </span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    {new Date(entry.started_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// MARKETPLACE CONTENT removed — templates consolidated into API-seeded templates

// ---------------------------------------------------------------------------
// Section icon map
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AGENT PLAYGROUND CONTENT — Lazy-loaded agent playground
// ---------------------------------------------------------------------------

const LazyAgentPlayground = React.lazy(() =>
  import('@/features/agents/components/AgentPlayground').then(mod => ({ default: mod.AgentPlayground }))
);

const PlaygroundContent: React.FC = () => (
  <React.Suspense
    fallback={
      <div className="py-12 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Loading Agent Playground...
      </div>
    }
  >
    <LazyAgentPlayground />
  </React.Suspense>
);

// ---------------------------------------------------------------------------
// TAG COLORS — consistent palette for workflow tags
// ---------------------------------------------------------------------------

const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'aws':              { bg: '#ff990010', text: '#ff9900', border: '#ff990030' },
  'azure':            { bg: '#008ad710', text: '#008ad7', border: '#008ad730' },
  'gcp':              { bg: '#4285f410', text: '#4285f4', border: '#4285f430' },
  'kubernetes':       { bg: '#326ce510', text: '#326ce5', border: '#326ce530' },
  'github':           { bg: '#8b5cf610', text: '#8b5cf6', border: '#8b5cf630' },
  'security':         { bg: '#ef444410', text: '#ef4444', border: '#ef444430' },
  'multi-agent':      { bg: '#f59e0b10', text: '#f59e0b', border: '#f59e0b30' },
  'ai-analysis':      { bg: '#8b5cf610', text: '#8b5cf6', border: '#8b5cf630' },
  'web-research':     { bg: '#06b6d410', text: '#06b6d4', border: '#06b6d430' },
  'mcp-tool':         { bg: '#10b98110', text: '#10b981', border: '#10b98130' },
  'monitoring':       { bg: '#f9731610', text: '#f97316', border: '#f9731630' },
  'cost-analysis':    { bg: '#eab30810', text: '#eab308', border: '#eab30830' },
  'seo':              { bg: '#ec489910', text: '#ec4899', border: '#ec489930' },
  'competitive-intel':{ bg: '#6366f110', text: '#6366f1', border: '#6366f130' },
  'content':          { bg: '#14b8a610', text: '#14b8a6', border: '#14b8a630' },
  'feedback':         { bg: '#a855f710', text: '#a855f7', border: '#a855f730' },
  'compliance':       { bg: '#dc262610', text: '#dc2626', border: '#dc262630' },
  'devops':           { bg: '#2563eb10', text: '#2563eb', border: '#2563eb30' },
  'research':         { bg: '#0ea5e910', text: '#0ea5e9', border: '#0ea5e930' },
  'code-execution':   { bg: '#84cc1610', text: '#84cc16', border: '#84cc1630' },
};

const defaultTagColor = { bg: 'var(--color-surface)', text: 'var(--color-text-secondary)', border: 'var(--color-border)' };

function getTagColor(tag: string) {
  return TAG_COLORS[tag] || defaultTagColor;
}

const TagPill: React.FC<{ tag: string; selected?: boolean; onClick?: () => void }> = ({ tag, selected, onClick }) => {
  const colors = getTagColor(tag);
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border transition-all"
      style={{
        backgroundColor: selected ? colors.text : colors.bg,
        color: selected ? '#fff' : colors.text,
        borderColor: colors.border,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {tag}
    </button>
  );
};

// ---------------------------------------------------------------------------
// WORKFLOW CARD GRID VIEW — shared between Deployed and My Workflows
// ---------------------------------------------------------------------------

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    ops: '#ff9800', data: '#2196f3', security: '#f44336', cloud: '#00bcd4',
    engineering: '#4caf50', gov: '#7c3aed', research: '#ec4899', starter: '#64748b',
  };
  return colors[category?.toLowerCase()] || '#64748b';
}

const WorkflowCardGridView: React.FC<{ filter: 'deployed' | 'my' | 'templates' }> = ({ filter }) => {
  const { getAuthHeaders } = useAuth();
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'name' | 'updated' | 'runs'>('updated');
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getAuthHeaders();
      if (filter === 'templates') {
        // Fetch from templates endpoint, fall back to main list
        let templates: any[] = [];
        try {
          const tplRes = await fetch('/api/workflows/templates', { headers });
          if (tplRes.ok) {
            const tplData = await tplRes.json();
            templates = tplData.templates || tplData || [];
          }
        } catch { /* ignore */ }
        // Also include starter flows and is_template from main list
        if (templates.length === 0) {
          const res = await fetch('/api/workflows', { headers });
          if (res.ok) {
            const data = await res.json();
            const all = data.workflows || data || [];
            templates = all.filter((w: any) => w.is_template || w.is_public || w.category === 'starter' || (w.tags || []).includes('starter'));
          }
        }
        setWorkflows(templates);
      } else {
        const res = await fetch('/api/workflows', { headers });
        if (res.ok) {
          const data = await res.json();
          const all = data.workflows || data || [];
          if (filter === 'deployed') {
            setWorkflows(all.filter((w: any) => w.status === 'active'));
          } else {
            // My Workflows: show ALL non-template workflows (both active and draft)
            setWorkflows(all.filter((w: any) => !w.is_template));
          }
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [getAuthHeaders, filter]);

  useEffect(() => { fetchWorkflows(); }, [fetchWorkflows]);

  // Collect all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    workflows.forEach(w => (w.tags || []).forEach((t: string) => tags.add(t)));
    return Array.from(tags).sort();
  }, [workflows]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  // Filter and sort
  const filtered = useMemo(() => {
    let result = workflows;

    // Text search (name + description + tags)
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(w =>
        w.name?.toLowerCase().includes(q) ||
        w.description?.toLowerCase().includes(q) ||
        (w.tags || []).some((t: string) => t.toLowerCase().includes(q))
      );
    }

    // Tag filter
    if (selectedTags.size > 0) {
      result = result.filter(w =>
        (w.tags || []).some((t: string) => selectedTags.has(t))
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      if (sortBy === 'runs') return (b.executionCount || 0) - (a.executionCount || 0);
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    });

    return result;
  }, [workflows, searchTerm, selectedTags, sortBy]);

  const handleUndeploy = async (id: string) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      if (res.ok) setWorkflows(prev => prev.filter(w => w.id !== id));
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE', headers });
      if (res.ok) setWorkflows(prev => prev.filter(w => w.id !== id));
    } catch { /* ignore */ }
    setDeleting(null);
  };

  if (loading) {
    return <div className="py-12 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading workflows...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {filter === 'deployed'
          ? 'Manage deployed workflows. Undeploy to move back to draft, or delete permanently.'
          : filter === 'templates'
          ? 'Pre-built workflow templates. Double-click to create a new flow from any template.'
          : 'Your draft and saved workflows. Open in canvas to edit, deploy when ready.'}
      </p>

      {/* Search + Sort bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by name, description, or tag..."
            className={inputClass}
            style={{ ...inputStyle, paddingLeft: '2.25rem' }}
          />
        </div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as any)}
          className="px-3 py-2 text-sm rounded-lg border"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}
        >
          <option value="updated">Recently Updated</option>
          <option value="name">Name A-Z</option>
          <option value="runs">Most Runs</option>
        </select>
      </div>

      {/* Tag filter bar */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map(tag => (
            <TagPill key={tag} tag={tag} selected={selectedTags.has(tag)} onClick={() => toggleTag(tag)} />
          ))}
          {selectedTags.size > 0 && (
            <button
              onClick={() => setSelectedTags(new Set())}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div className="py-8 text-center">
          <Rocket className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            {searchTerm || selectedTags.size > 0 ? 'No matching workflows' : filter === 'deployed' ? 'No deployed workflows yet' : filter === 'templates' ? 'No templates available' : 'No workflows yet'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)', opacity: 0.7 }}>
            {filter === 'deployed' ? 'Deploy a workflow from the canvas to see it here.' : filter === 'templates' ? 'Templates will appear here once seeded.' : 'Create a new flow from the sidebar to get started.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(wf => (
            <div
              key={wf.id}
              className="group relative p-4 rounded-xl border transition-all hover:shadow-md cursor-pointer"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-bg-secondary)',
              }}
              onDoubleClick={async () => {
                if (filter === 'templates') {
                  // Clone template to user workspace via duplicate API
                  try {
                    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                    const token = localStorage.getItem('auth_token');
                    if (token) headers['Authorization'] = `Bearer ${token}`;
                    const resp = await fetch(`/api/workflows/${wf.id}/duplicate`, { method: 'POST', headers });
                    if (resp.ok) {
                      const data = await resp.json();
                      const newId = data.workflow?.id || data.id;
                      if (newId) {
                        window.dispatchEvent(new CustomEvent('openWorkflow', { detail: { workflowId: newId } }));
                      }
                    } else {
                      console.error('Failed to clone template:', resp.status, await resp.text());
                    }
                  } catch (err) {
                    console.error('Failed to clone template:', err);
                  }
                } else {
                  window.dispatchEvent(new CustomEvent('openWorkflow', { detail: { workflowId: wf.id } }));
                }
              }}
              title={filter === 'templates' ? 'Double-click to use this template' : 'Double-click to open in canvas'}
            >
              {/* Header row */}
              <div className="flex items-start gap-3 mb-2">
                {/* Status indicator */}
                <span className="relative flex-shrink-0 mt-1">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: filter === 'deployed' ? '#22c55e' : filter === 'templates' ? '#7c3aed' : '#94a3b8' }}
                  />
                  {filter === 'deployed' && (
                    <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: '#22c55e', opacity: 0.3, width: 10, height: 10 }} />
                  )}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                    {wf.name || 'Untitled Workflow'}
                  </div>
                  {wf.description && (
                    <div className="text-xs mt-0.5" style={{
                      color: 'var(--color-text-tertiary)',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical' as any,
                    }}>
                      {wf.description}
                    </div>
                  )}
                  {/* Complexity indicator */}
                  {(() => {
                    const nodes = wf.nodes || wf.definition?.nodes || [];
                    const agentCount = nodes.filter((n: any) =>
                      ['multi_agent', 'agent_spawn', 'agent_single', 'agent_pool', 'agent_supervisor'].includes(n.type)
                    ).length;
                    const toolCount = nodes.filter((n: any) => n.type === 'mcp_tool').length;
                    const llmCount = nodes.filter((n: any) => n.type === 'openagentic_llm').length;
                    if (agentCount === 0 && toolCount === 0 && llmCount === 0) return null;
                    return (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                        {agentCount > 0 && <span>{agentCount} agent{agentCount > 1 ? 's' : ''}</span>}
                        {toolCount > 0 && <span>{toolCount} tool{toolCount > 1 ? 's' : ''}</span>}
                        {llmCount > 0 && <span>{llmCount} LLM</span>}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Category badge + Tags */}
              {wf.category && (
                <div className="mb-1.5">
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    background: getCategoryColor(wf.category) + '20',
                    color: getCategoryColor(wf.category),
                    border: `1px solid ${getCategoryColor(wf.category)}40`,
                  }}>
                    {wf.category}
                  </span>
                </div>
              )}

              {/* Tags */}
              {(wf.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {(wf.tags as string[]).slice(0, 6).map((tag: string) => (
                    <TagPill key={tag} tag={tag} onClick={() => toggleTag(tag)} />
                  ))}
                  {(wf.tags as string[]).length > 6 && (
                    <span className="text-[10px] px-1.5 py-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                      +{(wf.tags as string[]).length - 6} more
                    </span>
                  )}
                </div>
              )}

              {/* Meta row */}
              <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                <div className="flex items-center gap-3">
                  <span>{wf.nodes?.length || 0} nodes</span>
                  <span>{wf.executionCount || 0} runs</span>
                  {wf.updated_at && (
                    <span>{new Date(wf.updated_at).toLocaleDateString()}</span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {filter === 'deployed' && (
                    <button
                      onClick={() => handleUndeploy(wf.id)}
                      className="px-2 py-0.5 text-[11px] font-medium rounded border transition-colors hover:bg-[var(--color-surface)]"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
                    >
                      Undeploy
                    </button>
                  )}
                  {filter === 'templates' ? (
                    <button
                      onClick={async () => {
                        try {
                          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                          const token = localStorage.getItem('auth_token');
                          if (token) headers['Authorization'] = `Bearer ${token}`;
                          const resp = await fetch(`/api/workflows/${wf.id}/duplicate`, { method: 'POST', headers });
                          if (resp.ok) {
                            const data = await resp.json();
                            const newId = data.workflow?.id || data.id;
                            if (newId) {
                              window.dispatchEvent(new CustomEvent('openWorkflow', { detail: { workflowId: newId } }));
                            }
                          } else {
                            console.error('Failed to clone template:', resp.status, await resp.text());
                          }
                        } catch (err) {
                          console.error('Failed to clone template:', err);
                        }
                      }}
                      className="px-2 py-0.5 text-[11px] font-medium rounded border transition-colors"
                      style={{ borderColor: 'var(--user-accent-primary, #7c3aed)', color: 'var(--user-accent-primary, #7c3aed)' }}
                    >
                      Use Template
                    </button>
                  ) : (
                    <button
                      onClick={() => handleDelete(wf.id, wf.name)}
                      disabled={deleting === wf.id}
                      className="p-1 rounded transition-colors hover:bg-red-500/10"
                      style={{ color: '#ef4444' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        {filtered.length} of {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
        {selectedTags.size > 0 && ` (filtered by ${selectedTags.size} tag${selectedTags.size !== 1 ? 's' : ''})`}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// LEGACY DEPLOYED WORKFLOWS CONTENT — kept for backwards compatibility
// ---------------------------------------------------------------------------

const DeployedContent: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchDeployed = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/workflows', { headers });
      if (res.ok) {
        const data = await res.json();
        const all = data.workflows || data || [];
        setWorkflows(all.filter((w: any) => w.status === 'active'));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [getAuthHeaders]);

  useEffect(() => { fetchDeployed(); }, [fetchDeployed]);

  const handleUndeploy = async (id: string) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/workflows/${id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      });
      if (res.ok) {
        setWorkflows(prev => prev.filter(w => w.id !== id));
      }
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE', headers });
      if (res.ok) {
        setWorkflows(prev => prev.filter(w => w.id !== id));
      }
    } catch { /* ignore */ }
    setDeleting(null);
  };

  const filtered = searchTerm
    ? workflows.filter(w => w.name?.toLowerCase().includes(searchTerm.toLowerCase()))
    : workflows;

  if (loading) {
    return <div className="py-12 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Loading deployed workflows...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Manage workflows that are currently deployed and active. Undeploy to move back to draft, or delete permanently.
      </p>

      {workflows.length > 3 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search deployed workflows..."
            className={inputClass}
            style={{ ...inputStyle, paddingLeft: '2.25rem' }}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="py-8 text-center">
          <Rocket className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            {searchTerm ? 'No matching deployed workflows' : 'No deployed workflows yet'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)', opacity: 0.7 }}>
            Deploy a workflow from the canvas to see it here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(wf => (
            <div
              key={wf.id}
              className="flex items-center gap-3 p-3 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}
            >
              {/* Status dot */}
              <span className="relative flex-shrink-0">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#22c55e' }} />
                <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: '#22c55e', opacity: 0.3, width: 10, height: 10 }} />
              </span>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                  {wf.name || 'Untitled Workflow'}
                </div>
                <div className="text-xs flex items-center gap-2" style={{ color: 'var(--color-text-tertiary)' }}>
                  <span>{wf.executionCount || 0} runs</span>
                  {wf.updatedAt && (
                    <>
                      <span>·</span>
                      <span>Updated {new Date(wf.updatedAt).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => handleUndeploy(wf.id)}
                  className="px-2.5 py-1 text-xs font-medium rounded-md border transition-colors hover:bg-[var(--color-surface)]"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
                  title="Move back to draft"
                >
                  Undeploy
                </button>
                <button
                  onClick={() => handleDelete(wf.id, wf.name)}
                  disabled={deleting === wf.id}
                  className="p-1.5 rounded-md transition-colors hover:bg-red-500/10"
                  style={{ color: '#ef4444' }}
                  title="Delete permanently"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        {workflows.length} deployed workflow{workflows.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SETTINGS CONTENT — Per-workflow configuration
// ---------------------------------------------------------------------------

const SettingsContent: React.FC<{
  workflowSettings?: any;
  onSettingsChange?: (settings: any) => void;
}> = ({ workflowSettings, onSettingsChange }) => {
  const [settings, setSettings] = useState<any>(workflowSettings || {});
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>(
    settings.environmentVariables
      ? Object.entries(settings.environmentVariables).map(([key, value]) => ({ key, value: String(value) }))
      : [{ key: '', value: '' }]
  );

  useEffect(() => {
    if (workflowSettings) {
      setSettings(workflowSettings);
      const vars = workflowSettings.environmentVariables;
      if (vars && typeof vars === 'object') {
        setEnvVars(Object.entries(vars).map(([key, value]) => ({ key, value: String(value) })));
      }
    }
  }, [workflowSettings]);

  const updateSetting = (path: string, value: any) => {
    const newSettings = { ...settings };
    const keys = path.split('.');
    let current: any = newSettings;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]] || typeof current[keys[i]] !== 'object') current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    setSettings(newSettings);
    onSettingsChange?.(newSettings);
  };

  const updateEnvVars = (newVars: Array<{ key: string; value: string }>) => {
    setEnvVars(newVars);
    const envObj: Record<string, string> = {};
    newVars.forEach(v => { if (v.key.trim()) envObj[v.key.trim()] = v.value; });
    updateSetting('environmentVariables', envObj);
  };

  const sectionHeaderStyle: React.CSSProperties = { color: 'var(--color-text-secondary)' };
  const fieldLabelStyle: React.CSSProperties = { color: 'var(--color-text-secondary)' };

  return (
    <div className="space-y-8">
      {/* Execution Defaults */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <Zap className="w-4 h-4" /> Execution Defaults
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Default Model</label>
            <input type="text" value={settings.execution?.defaultModel || ''} onChange={e => updateSetting('execution.defaultModel', e.target.value)}
              placeholder="auto (platform routing)" className={inputClass} style={inputStyle} />
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Leave empty to use platform-level intelligent routing.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2" style={fieldLabelStyle}>
              Intelligence Level: {settings.execution?.intelligenceLevel ?? 50}%
            </label>
            <input type="range" min="0" max="100" step="5" value={settings.execution?.intelligenceLevel ?? 50}
              onChange={e => updateSetting('execution.intelligenceLevel', parseInt(e.target.value))} className="w-full" />
            <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              <span>Economical (0-40)</span><span>Balanced (41-60)</span><span>Premium (61-100)</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Default Timeout (s)</label>
              <input type="number" value={settings.execution?.defaultTimeout || 60} onChange={e => updateSetting('execution.defaultTimeout', parseInt(e.target.value) || 60)}
                min={1} className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Max Execution Time (s)</label>
              <input type="number" value={settings.execution?.maxExecutionTime || 3600} onChange={e => updateSetting('execution.maxExecutionTime', parseInt(e.target.value) || 3600)}
                min={1} className={inputClass} style={inputStyle} />
            </div>
          </div>
        </div>
      </div>

      {/* Cost Controls */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <ShieldCheck className="w-4 h-4" /> Cost Controls
        </h3>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Per-Execution Budget ($)</label>
              <input type="number" value={settings.costs?.perExecution || ''} onChange={e => updateSetting('costs.perExecution', parseFloat(e.target.value) || undefined)}
                min={0} step={0.01} placeholder="No limit" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Daily Budget ($)</label>
              <input type="number" value={settings.costs?.daily || ''} onChange={e => updateSetting('costs.daily', parseFloat(e.target.value) || undefined)}
                min={0} step={0.01} placeholder="No limit" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Monthly Budget ($)</label>
              <input type="number" value={settings.costs?.monthly || ''} onChange={e => updateSetting('costs.monthly', parseFloat(e.target.value) || undefined)}
                min={0} step={0.01} placeholder="No limit" className={inputClass} style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2" style={fieldLabelStyle}>On Budget Exceeded</label>
            <select value={settings.costs?.onExceeded || 'pause'} onChange={e => updateSetting('costs.onExceeded', e.target.value)} className={inputClass} style={inputStyle}>
              <option value="pause">Pause Execution</option>
              <option value="downgrade">Downgrade Model Tier</option>
              <option value="abort">Abort Workflow</option>
            </select>
          </div>
        </div>
      </div>

      {/* Retry Policy */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <RotateCw className="w-4 h-4" /> Default Retry Policy
        </h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Default Retry Count</label>
              <input type="number" value={settings.retry?.count || 3} onChange={e => updateSetting('retry.count', parseInt(e.target.value) || 3)}
                min={0} max={10} className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Default Delay (ms)</label>
              <input type="number" value={settings.retry?.delayMs || 1000} onChange={e => updateSetting('retry.delayMs', parseInt(e.target.value) || 1000)}
                min={100} className={inputClass} style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2" style={fieldLabelStyle}>Backoff Strategy</label>
            <select value={settings.retry?.backoff || 'fixed'} onChange={e => updateSetting('retry.backoff', e.target.value)} className={inputClass} style={inputStyle}>
              <option value="fixed">Fixed</option>
              <option value="exponential">Exponential</option>
            </select>
          </div>
        </div>
      </div>

      {/* Environment Variables */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <Terminal className="w-4 h-4" /> Environment Variables
        </h3>
        <div className="space-y-2">
          {envVars.map((v, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input type="text" value={v.key} onChange={e => { const nv = [...envVars]; nv[idx] = { ...nv[idx], key: e.target.value }; updateEnvVars(nv); }}
                placeholder="KEY" className={`${inputClass} flex-1 font-mono`} style={inputStyle} />
              <span className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>=</span>
              <input type="text" value={v.value} onChange={e => { const nv = [...envVars]; nv[idx] = { ...nv[idx], value: e.target.value }; updateEnvVars(nv); }}
                placeholder="value" className={`${inputClass} flex-1 font-mono`} style={inputStyle} />
              <button onClick={() => { const nv = envVars.filter((_, i) => i !== idx); updateEnvVars(nv.length ? nv : [{ key: '', value: '' }]); }}
                className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10" style={{ color: '#ef5350' }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button onClick={() => { const nv = [...envVars, { key: '', value: '' }]; setEnvVars(nv); }}
            className="flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-80 mt-2" style={{ color: 'var(--user-accent-primary, #2196f3)' }}>
            <Plus className="w-3.5 h-3.5" /> Add Variable
          </button>
        </div>
      </div>

      {/* Tags */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <Hash className="w-4 h-4" /> Tags
        </h3>
        <input type="text" value={settings.tags || ''} onChange={e => updateSetting('tags', e.target.value)}
          placeholder="e.g., production, finance, nightly" className={inputClass} style={inputStyle} />
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Comma-separated tags for categorization and filtering.</p>
      </div>

      {/* Visibility */}
      <div>
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={sectionHeaderStyle}>
          <Eye className="w-4 h-4" /> Visibility
        </h3>
        <select value={settings.visibility || 'private'} onChange={e => updateSetting('visibility', e.target.value)} className={inputClass} style={inputStyle}>
          <option value="private">Private - Only you</option>
          <option value="team">Team - Your team members</option>
          <option value="public">Public - All platform users</option>
        </select>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// VERSIONS CONTENT — Version history & restore
// ---------------------------------------------------------------------------

const VersionsContent: React.FC<{
  versions?: any[];
  onRestoreVersion?: (versionId: string) => void;
}> = ({ versions = [], onRestoreVersion }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {versions.length} version{versions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {versions.length === 0 ? (
        <div className="py-12 text-center">
          <Clock className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No version history yet.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Versions are created when you save or deploy a workflow.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {versions.map((version, idx) => (
            <div key={version.id || idx} className="rounded-lg border p-4 transition-colors hover:bg-[var(--color-surface)]"
              style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold px-2 py-0.5 rounded-full" style={{
                    backgroundColor: idx === 0 ? 'rgba(33,150,243,0.12)' : 'var(--color-surface)',
                    color: idx === 0 ? 'var(--user-accent-primary, #2196f3)' : 'var(--color-text-secondary)',
                  }}>
                    v{version.version || versions.length - idx}
                  </span>
                  {idx === 0 && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(34, 197, 94,0.12)', color: '#22c55e' }}>
                      Current
                    </span>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  {version.created_at ? new Date(version.created_at).toLocaleString() : 'Unknown'}
                </span>
              </div>
              {version.changelog && (
                <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>{version.changelog}</p>
              )}
              <div className="flex items-center gap-2">
                {idx !== 0 && (
                  <button onClick={() => onRestoreVersion?.(version.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors hover:bg-[var(--color-surface)]"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--user-accent-primary, #2196f3)' }}>
                    <RotateCw className="w-3 h-3" /> Restore
                  </button>
                )}
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors hover:bg-[var(--color-surface)] opacity-50 cursor-not-allowed"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }} disabled>
                  <ArrowRightLeft className="w-3 h-3" /> Compare
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const sectionIcons: Record<SidebarSectionType, React.ComponentType<any>> = {
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
};

// ---------------------------------------------------------------------------
// INLINE CONFIG PANEL — replaces the canvas area (Flowise-style)
// ---------------------------------------------------------------------------

export interface ConfigPanelProps {
  section: SidebarSectionType;
  onClose: () => void;
  workflowId?: string;
  variables?: Record<string, any>;
  onVariablesChange?: (vars: Record<string, any>) => void;
  workflowSettings?: any;
  onSettingsChange?: (settings: any) => void;
  versions?: any[];
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
      default:
        return null;
    }
  };

  const SectionIcon = sectionIcons[section] || Settings;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Top bar — matches the toolbar style of WorkflowsContainer */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary, var(--color-bg-primary))' }}
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
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--user-accent-primary, #2196f3)' }}>
              <SectionIcon className="w-4 h-4 text-white" />
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
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
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
              className="w-full h-full flex flex-col rounded-xl border shadow-2xl pointer-events-auto"
              style={{
                backgroundColor: 'var(--color-bg-primary)',
                borderColor: 'var(--color-border)',
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
