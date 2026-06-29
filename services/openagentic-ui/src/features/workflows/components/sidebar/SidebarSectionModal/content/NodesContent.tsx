/**
 * NodesContent — full browsable catalog of all node types.
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Search, ChevronRight, Settings, Globe, Terminal, Layers, Rocket, Star,
  Zap, Brain, Bot, Sparkles, Target, Code, GitBranch, RotateCw, Hourglass,
  ArrowRightLeft, GitMerge, ShieldCheck, Hand, FlaskConical, UserCheck,
  MessageSquare, Mail, AlertTriangle, FileText, Hash,
  type LucideIcon,
} from '@/shared/icons';
import { onKeyActivate } from '@/utils/a11y';
import { nodeTypeConfigs } from '../../../../utils/nodeConfigs';
import { inputClass, inputStyle } from '../sectionShared';

// ---------------------------------------------------------------------------
// NODE TYPE ICONS
// ---------------------------------------------------------------------------

const nodeIconMap: Record<string, LucideIcon> = {
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
    capabilities: ['Smart model routing via SmartModelRouter', 'All providers (Anthropic, OpenAI, Google, Azure, Ollama)', 'Extended thinking', 'Provider override', 'Per-user × per-model budget caps'],
    inputs: ['Prompt', 'System prompt', 'Model override', 'Thinking budget'],
    outputs: ['Generated text', 'Thinking blocks', 'Token usage', 'Cost', 'Model used'],
    useCases: ['Route to cheapest capable model for simple tasks', 'Use premium models for critical decisions', 'Enable thinking for complex reasoning'],
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

export const NodesContent: React.FC = () => {
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
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
    color: 'var(--color-accent)',
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
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedType(isExpanded ? null : config.type)}
                  onKeyDown={onKeyActivate(() => setExpandedType(isExpanded ? null : config.type))}
                  className="rounded-lg border p-3 cursor-pointer transition-all hover:shadow-md"
                  style={{
                    borderColor: isExpanded ? 'var(--color-accent)' : 'var(--color-border)',
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
                                <span key={i} className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)' }}>{i}</span>
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
                                <span key={o} className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', color: 'var(--color-warning)' }}>{o}</span>
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
                                  <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
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
