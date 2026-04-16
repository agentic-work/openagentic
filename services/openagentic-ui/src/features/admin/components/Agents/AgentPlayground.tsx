/**
 * AgentPlayground — Interactive multi-agent testing console
 *
 * Lets admins:
 * 1. Pick agents from the registry (or create ad-hoc agents)
 * 2. Choose an orchestration pattern (parallel, sequential, supervisor, hierarchical)
 * 3. Send a prompt and watch agents execute in real-time
 * 4. See each agent's ReAct loop: tool calls, thinking, output
 * 5. See aggregated result + cost/token metrics
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Play, Square, Plus, X, ChevronDown, ChevronRight, Trash2 } from '@/shared/icons';

interface AgentDef {
  id: string;
  display_name: string;
  agent_type: string;
  model_config: { primaryModel?: string };
  tools_whitelist: string[];
  system_prompt: string;
}

interface AgentSlot {
  key: string; // unique key for React
  agentId: string; // from registry or ''
  role: string;
  task: string;
  model: string;
  tools: string[];
}

interface StepEvent {
  type: string;
  agentId?: string;
  data: any;
  timestamp: number;
}

interface PlaygroundProps {
  theme: string;
  agents: AgentDef[];
}

const ORCHESTRATION_PATTERNS = [
  { value: 'parallel', label: 'Parallel', desc: 'All agents run concurrently — best for independent tasks' },
  { value: 'sequential', label: 'Sequential', desc: 'Output chains from one agent to the next' },
  { value: 'supervisor', label: 'Supervisor', desc: 'First agent plans, then dispatches workers' },
  { value: 'hierarchical', label: 'Hierarchical', desc: 'Multi-level supervisor tree for large teams' },
];

const AGGREGATION_STRATEGIES = [
  { value: 'synthesize', label: 'Synthesize', desc: 'LLM combines all results intelligently' },
  { value: 'merge', label: 'Merge', desc: 'Concatenate all outputs' },
  { value: 'first', label: 'First Success', desc: 'Return first successful result' },
  { value: 'vote', label: 'Vote', desc: 'Consensus from multiple agents' },
];

const ROLE_OPTIONS = ['reasoning', 'data_query', 'code_execution', 'tool_orchestration', 'summarization', 'planning', 'validation', 'synthesis', 'custom'];

const ROLE_COLORS: Record<string, string> = {
  reasoning: 'var(--color-secondary)',
  data_query: 'var(--color-primary)',
  code_execution: 'var(--color-success)',
  tool_orchestration: 'var(--color-warning)',
  summarization: 'var(--color-secondary)',
  planning: 'var(--color-primary)',
  validation: 'var(--color-error)',
  synthesis: 'var(--color-secondary)',
  custom: 'var(--color-text-tertiary)',
};

let slotCounter = 0;

export const AgentPlayground: React.FC<PlaygroundProps> = ({ theme, agents }) => {
  const [userMessage, setUserMessage] = useState('');
  const [orchestration, setOrchestration] = useState('parallel');
  const [aggregation, setAggregation] = useState('synthesize');
  const [slots, setSlots] = useState<AgentSlot[]>([
    { key: `slot-${++slotCounter}`, agentId: '', role: 'reasoning', task: '', model: 'auto', tools: [] },
    { key: `slot-${++slotCounter}`, agentId: '', role: 'data_query', task: '', model: 'auto', tools: [] },
  ]);

  // Execution state
  const [running, setRunning] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [finalOutput, setFinalOutput] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll events
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const addSlot = () => {
    setSlots(prev => [...prev, {
      key: `slot-${++slotCounter}`,
      agentId: '',
      role: 'custom',
      task: '',
      model: 'auto',
      tools: [],
    }]);
  };

  const removeSlot = (key: string) => {
    setSlots(prev => prev.filter(s => s.key !== key));
  };

  const updateSlot = (key: string, field: keyof AgentSlot, value: any) => {
    setSlots(prev => prev.map(s => {
      if (s.key !== key) return s;
      const updated = { ...s, [field]: value };
      // If selecting a registry agent, pre-fill from its definition
      if (field === 'agentId' && value) {
        const def = agents.find(a => a.id === value);
        if (def) {
          updated.role = def.agent_type;
          updated.model = def.model_config?.primaryModel || 'auto';
          updated.tools = def.tools_whitelist || [];
          if (!updated.task) {
            updated.task = `Execute ${def.display_name} task`;
          }
        }
      }
      return updated;
    }));
  };

  const handleRun = useCallback(async () => {
    if (!userMessage.trim() || slots.length < 1) return;
    setRunning(true);
    setEvents([]);
    setFinalOutput(null);
    setMetrics(null);
    setError(null);
    setExpandedAgents(new Set());

    const agentSpecs = slots.map(s => ({
      role: s.role,
      task: s.task || userMessage,
      model: s.model || 'auto',
      tools: s.tools.length > 0 ? s.tools : undefined,
      agentId: s.agentId || undefined,
    }));

    try {
      // Use the chat stream API with delegate_to_agents — this goes through the full pipeline
      // First create a session
      const sessionResp = await fetch('/api/chat/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Agent Playground: ${orchestration}` }),
      });
      const sessionData = await sessionResp.json();
      const sessionId = sessionData.session?.id;

      if (!sessionId) {
        setError('Failed to create test session');
        setRunning(false);
        return;
      }

      // Build a prompt that forces delegate_to_agents usage
      const agentDescs = agentSpecs.map((a, i) =>
        `Agent ${i + 1}: role=${a.role}, task="${a.task}"${a.model !== 'auto' ? `, model=${a.model}` : ''}`
      ).join('\n');

      const forcedPrompt = `IMPORTANT: You MUST use the delegate_to_agents tool to handle this request. Do NOT answer directly.

Use these exact agent specifications:
${agentDescs}

Orchestration: ${orchestration}
Aggregation: ${aggregation}

User request: ${userMessage}`;

      // Stream the response
      const resp = await fetch('/api/chat/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: forcedPrompt,
          sessionId,
          autoApproveTools: true,
        }),
      });

      if (!resp.ok) {
        setError(`Stream failed: ${resp.status} ${resp.statusText}`);
        setRunning(false);
        return;
      }

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);
            const eventType = data.type || data.event || 'unknown';

            // Track events for the timeline
            setEvents(prev => [...prev, {
              type: eventType,
              agentId: data.agentId || data.agent_id,
              data,
              timestamp: Date.now(),
            }]);

            // Capture text content
            if (eventType === 'content' || eventType === 'text_delta') {
              const text = data.text || data.content || data.delta?.content || '';
              fullText += text;
            }

            // Capture tool progress (agent heartbeats)
            if (eventType === 'tool_progress' && data.name === 'delegate_to_agents') {
              // Update execution status
            }

            // Capture final content
            if (eventType === 'message_complete' || eventType === 'done') {
              if (data.content) fullText = data.content;
            }

          } catch {
            // Non-JSON SSE data, skip
          }
        }
      }

      setFinalOutput(fullText || 'No output received');

      // Fetch execution metrics from the session
      try {
        const metricsResp = await fetch(`/api/admin/agents/executions/stats`, { credentials: 'include' });
        if (metricsResp.ok) {
          setMetrics(await metricsResp.json());
        }
      } catch {}

    } catch (err: any) {
      setError(err.message || 'Execution failed');
    } finally {
      setRunning(false);
    }
  }, [userMessage, slots, orchestration, aggregation, agents]);

  const handleStop = useCallback(async () => {
    if (executionId) {
      try {
        await fetch(`/api/admin/agents/executions/${executionId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      } catch {}
    }
    setRunning(false);
  }, [executionId]);

  const toggleAgent = (agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      next.has(agentId) ? next.delete(agentId) : next.add(agentId);
      return next;
    });
  };

  // Group events by agent
  const eventsByAgent = new Map<string, StepEvent[]>();
  const globalEvents: StepEvent[] = [];
  for (const ev of events) {
    if (ev.agentId) {
      const list = eventsByAgent.get(ev.agentId) || [];
      list.push(ev);
      eventsByAgent.set(ev.agentId, list);
    } else {
      globalEvents.push(ev);
    }
  }

  const surface = 'var(--color-bg-surface, var(--color-surface))';
  const border = 'var(--color-border, var(--color-border-default))';
  const textPrimary = 'var(--color-text-primary)';
  const textSecondary = 'var(--color-text-secondary)';
  const accent = 'var(--color-accent, var(--color-accent-primary))';

  return (
    <div className="space-y-4 mt-2">
      {/* ─── Prompt ─── */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: accent }}>
          User Message
        </label>
        <textarea
          value={userMessage}
          onChange={e => setUserMessage(e.target.value)}
          placeholder="Enter a complex request that benefits from multiple agents working together...&#10;&#10;Example: &quot;Research the latest Kubernetes security best practices, check our cluster configuration against them, and generate a remediation plan with cost estimates.&quot;"
          className="w-full h-24 px-3 py-2 rounded-lg text-sm resize-none outline-none"
          style={{ backgroundColor: surface, border: `1px solid ${border}`, color: textPrimary }}
        />
      </div>

      {/* ─── Orchestration + Aggregation ─── */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: accent }}>
            Orchestration Pattern
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {ORCHESTRATION_PATTERNS.map(p => (
              <button
                key={p.value}
                onClick={() => setOrchestration(p.value)}
                className="px-2 py-1.5 rounded-lg text-xs text-left transition-all"
                style={{
                  backgroundColor: orchestration === p.value ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)' : surface,
                  border: `1px solid ${orchestration === p.value ? 'var(--color-primary)' : border}`,
                  color: orchestration === p.value ? 'var(--color-primary)' : textSecondary,
                }}
                title={p.desc}
              >
                <div className="font-medium">{p.label}</div>
                <div className="text-xs opacity-70 mt-0.5 line-clamp-1">{p.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: accent }}>
            Result Aggregation
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {AGGREGATION_STRATEGIES.map(s => (
              <button
                key={s.value}
                onClick={() => setAggregation(s.value)}
                className="px-2 py-1.5 rounded-lg text-xs text-left transition-all"
                style={{
                  backgroundColor: aggregation === s.value ? 'color-mix(in srgb, var(--color-success) 15%, transparent)' : surface,
                  border: `1px solid ${aggregation === s.value ? 'var(--color-success)' : border}`,
                  color: aggregation === s.value ? 'var(--color-success)' : textSecondary,
                }}
                title={s.desc}
              >
                <div className="font-medium">{s.label}</div>
                <div className="text-xs opacity-70 mt-0.5 line-clamp-1">{s.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Agent Slots ─── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: accent }}>
            Agents ({slots.length})
          </label>
          <button
            onClick={addSlot}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)', color: 'var(--color-primary)' }}
          >
            <Plus size={12} /> Add Agent
          </button>
        </div>

        <div className="space-y-2">
          {slots.map((slot, idx) => (
            <div
              key={slot.key}
              className="rounded-lg p-3"
              style={{ backgroundColor: surface, border: `1px solid ${border}` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: ROLE_COLORS[slot.role] || ROLE_COLORS.custom }}
                >
                  {idx + 1}
                </div>
                <select
                  value={slot.agentId}
                  onChange={e => updateSlot(slot.key, 'agentId', e.target.value)}
                  className="flex-1 px-2 py-1 rounded text-xs outline-none"
                  style={{ backgroundColor: 'var(--color-bg-primary, var(--color-bg))', border: `1px solid ${border}`, color: textPrimary }}
                >
                  <option value="">Ad-hoc agent (custom)</option>
                  <optgroup label="Registry Agents">
                    {agents.filter(a => !a.agent_type?.includes('background')).map(a => (
                      <option key={a.id} value={a.id}>{a.display_name} ({a.agent_type})</option>
                    ))}
                  </optgroup>
                </select>
                <select
                  value={slot.role}
                  onChange={e => updateSlot(slot.key, 'role', e.target.value)}
                  className="w-36 px-2 py-1 rounded text-xs outline-none"
                  style={{ backgroundColor: 'var(--color-bg-primary, var(--color-bg))', border: `1px solid ${border}`, color: ROLE_COLORS[slot.role] || textPrimary }}
                >
                  {ROLE_OPTIONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {slots.length > 1 && (
                  <button
                    onClick={() => removeSlot(slot.key)}
                    className="p-1 rounded transition-opacity hover:opacity-70"
                    style={{ color: 'var(--color-error)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <input
                value={slot.task}
                onChange={e => updateSlot(slot.key, 'task', e.target.value)}
                placeholder={`Task for agent ${idx + 1} (leave empty to use the user message)...`}
                className="w-full px-2 py-1.5 rounded text-xs outline-none"
                style={{ backgroundColor: 'var(--color-bg-primary, var(--color-bg))', border: `1px solid ${border}`, color: textPrimary }}
              />
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs" style={{ color: textSecondary }}>Model:</span>
                <input
                  value={slot.model}
                  onChange={e => updateSlot(slot.key, 'model', e.target.value)}
                  placeholder="auto"
                  className="w-32 px-2 py-0.5 rounded text-xs outline-none"
                  style={{ backgroundColor: 'var(--color-bg-primary, var(--color-bg))', border: `1px solid ${border}`, color: textSecondary }}
                />
                <span className="text-xs" style={{ color: textSecondary }}>
                  {slot.tools.length > 0 ? `${slot.tools.length} tools` : 'all tools'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Run Button ─── */}
      <div className="flex items-center gap-3">
        {!running ? (
          <button
            onClick={handleRun}
            disabled={!userMessage.trim() || slots.length < 1}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-40"
            style={{
              background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%)',
            }}
          >
            <Play size={16} />
            Run {slots.length} Agent{slots.length !== 1 ? 's' : ''} ({orchestration})
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ backgroundColor: 'var(--color-error)' }}
          >
            <Square size={16} />
            Stop Execution
          </button>
        )}
        {running && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs" style={{ color: textSecondary }}>
              Agents executing... ({events.length} events)
            </span>
          </div>
        )}
      </div>

      {/* ─── Error ─── */}
      {error && (
        <div className="px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--color-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 30%, transparent)', color: 'var(--color-error)' }}>
          {error}
        </div>
      )}

      {/* ─── Live Event Timeline ─── */}
      {events.length > 0 && (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: accent }}>
            Execution Timeline ({events.length} events)
          </label>
          <div
            className="rounded-lg overflow-auto max-h-80 p-3 space-y-1"
            style={{ backgroundColor: surface, border: `1px solid ${border}` }}
          >
            {events.map((ev, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="flex-shrink-0 font-mono" style={{ color: textSecondary }}>
                  {new Date(ev.timestamp).toLocaleTimeString()}
                </span>
                <span
                  className="flex-shrink-0 px-1.5 py-0.5 rounded font-medium"
                  style={{
                    backgroundColor: getEventColor(ev.type, 0.12),
                    color: getEventColor(ev.type, 1),
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  {ev.type}
                </span>
                {ev.agentId && (
                  <span className="flex-shrink-0" style={{ color: 'var(--color-secondary)' }}>
                    [{ev.agentId.slice(0, 12)}]
                  </span>
                )}
                <span className="truncate" style={{ color: textPrimary }}>
                  {formatEventData(ev)}
                </span>
              </div>
            ))}
            <div ref={eventsEndRef} />
          </div>
        </div>
      )}

      {/* ─── Final Output ─── */}
      {finalOutput && (
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: accent }}>
            Aggregated Result
          </label>
          <pre
            className="rounded-lg p-3 text-xs overflow-auto max-h-96 whitespace-pre-wrap"
            style={{ backgroundColor: surface, border: `1px solid ${border}`, color: textPrimary }}
          >
            {finalOutput}
          </pre>
        </div>
      )}
    </div>
  );
};

function getEventColor(type: string, alpha: number): string {
  const pct = Math.round(alpha * 100);
  const colors: Record<string, string> = {
    tool_progress: `color-mix(in srgb, var(--color-warning) ${pct}%, transparent)`,
    tool_call: `color-mix(in srgb, var(--color-primary) ${pct}%, transparent)`,
    tool_calls_required: `color-mix(in srgb, var(--color-primary) ${pct}%, transparent)`,
    tool_executing: `color-mix(in srgb, var(--color-primary) ${pct}%, transparent)`,
    tool_execution: `color-mix(in srgb, var(--color-success) ${pct}%, transparent)`,
    tool_result: `color-mix(in srgb, var(--color-success) ${pct}%, transparent)`,
    content: `color-mix(in srgb, var(--color-text-tertiary) ${pct}%, transparent)`,
    text_delta: `color-mix(in srgb, var(--color-text-tertiary) ${pct}%, transparent)`,
    thinking: `color-mix(in srgb, var(--color-secondary) ${pct}%, transparent)`,
    agent_spawn_plan: `color-mix(in srgb, var(--color-secondary) ${pct}%, transparent)`,
    agent_start: `color-mix(in srgb, var(--color-primary) ${pct}%, transparent)`,
    agent_complete: `color-mix(in srgb, var(--color-success) ${pct}%, transparent)`,
    agent_delegation: `color-mix(in srgb, var(--color-warning) ${pct}%, transparent)`,
    agent_tool_call: `color-mix(in srgb, var(--color-primary) ${pct}%, transparent)`,
    agent_tool_result: `color-mix(in srgb, var(--color-success) ${pct}%, transparent)`,
    execution_complete: `color-mix(in srgb, var(--color-success) ${pct}%, transparent)`,
    error: `color-mix(in srgb, var(--color-error) ${pct}%, transparent)`,
    done: `color-mix(in srgb, var(--color-text-tertiary) ${pct}%, transparent)`,
  };
  return colors[type] || `color-mix(in srgb, var(--color-text-tertiary) ${pct}%, transparent)`;
}

function formatEventData(ev: StepEvent): string {
  const d = ev.data;
  switch (ev.type) {
    case 'tool_progress':
      return d.message || `${d.name} — ${d.status} (${d.elapsed}s)`;
    case 'tool_calls_required':
    case 'tool_call':
      return `${d.name || d.toolName || 'tool'} called`;
    case 'tool_executing':
      return `Executing ${d.toolName || d.name || 'tool'}...`;
    case 'tool_execution':
    case 'tool_result':
      return `${d.toolName || d.name || 'tool'} ${d.status || 'done'} (${d.executionTimeMs || 0}ms)`;
    case 'agent_spawn_plan':
      return `Spawning ${d.agents?.length || '?'} agents (${d.strategy})`;
    case 'agent_start':
      return `Agent ${d.agentId?.slice(0, 12) || '?'} started (${d.role}, ${d.model})`;
    case 'agent_complete':
      return `Agent ${d.agentId?.slice(0, 12) || '?'} ${d.status} (${d.durationMs || 0}ms)`;
    case 'agent_delegation':
      return `Supervisor dispatched: ${d.plan?.join(', ') || 'workers'}`;
    case 'agent_tool_call':
      return `Agent tool: ${d.toolName || d.tool || 'unknown'}`;
    case 'agent_tool_result':
      return `Tool result: ${d.toolName || d.tool} (${d.executionTimeMs || 0}ms)`;
    case 'execution_complete':
      return `Orchestration complete`;
    case 'content':
    case 'text_delta':
      return (d.text || d.content || d.delta?.content || '').slice(0, 120);
    case 'thinking':
      return `Thinking: ${(d.text || d.content || '').slice(0, 80)}...`;
    default:
      return JSON.stringify(d).slice(0, 120);
  }
}

export default AgentPlayground;
