/**
 * Admin Tool Inspector Panel
 * Shows agent/subagent task outputs and tool call request/response JSON
 * Only visible to admin users via toolbar icon
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronDown, Wrench, Copy, Check, Bot, Brain, CheckCircle, XCircle, Search } from '@/shared/icons';

interface MCPCall {
  id?: string;
  serverName?: string;
  toolName?: string;
  arguments?: Record<string, any>;
  result?: any;
  status?: string;
  error?: string;
  duration?: number;
}

interface ToolCall {
  id?: string;
  name?: string;
  function?: { name: string; arguments: string };
  arguments?: any;
  result?: any;
}

interface InspectorMessage {
  id: string;
  role: string;
  content?: string;
  model?: string;
  mcpCalls?: MCPCall[];
  toolCalls?: ToolCall[];
  toolResults?: any[];
  metadata?: Record<string, any>;
  timestamp?: string | Date;
}

interface AdminToolInspectorProps {
  visible: boolean;
  onClose: () => void;
  messages: InspectorMessage[];
}

const AdminToolInspector: React.FC<AdminToolInspectorProps> = ({ visible, onClose, messages }) => {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'tools' | 'agents' | 'all'>('all');

  // Extract all tool calls and agent data from messages
  const inspectorData = useMemo(() => {
    const tools: Array<{
      id: string;
      messageId: string;
      type: 'mcp' | 'tool';
      name: string;
      server?: string;
      arguments: any;
      result: any;
      status: string;
      error?: string;
      duration?: number;
      model?: string;
      timestamp?: string;
    }> = [];

    const agents: Array<{
      id: string;
      messageId: string;
      name: string;
      role?: string;
      status: string;
      tasks?: any[];
      plan?: any;
      metadata?: any;
    }> = [];

    messages.forEach((msg) => {
      // MCP calls
      if (msg.mcpCalls && msg.mcpCalls.length > 0) {
        msg.mcpCalls.forEach((call, idx) => {
          tools.push({
            id: `mcp-${msg.id}-${idx}`,
            messageId: msg.id,
            type: 'mcp',
            name: call.toolName || 'unknown',
            server: call.serverName,
            arguments: call.arguments || {},
            result: call.result,
            status: call.status || 'unknown',
            error: call.error,
            duration: call.duration,
            model: msg.model,
            timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : msg.timestamp?.toISOString(),
          });
        });
      }

      // Standard tool calls
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        msg.toolCalls.forEach((call, idx) => {
          const toolResult = msg.toolResults?.[idx];
          const name = call.function?.name || call.name || 'unknown';
          const args = call.function?.arguments || call.arguments;
          tools.push({
            id: `tool-${msg.id}-${idx}`,
            messageId: msg.id,
            type: 'tool',
            name,
            arguments: typeof args === 'string' ? safeJsonParse(args) : args,
            result: toolResult?.result || toolResult,
            status: toolResult?.error ? 'error' : 'success',
            error: toolResult?.error,
            model: msg.model,
            timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : msg.timestamp?.toISOString(),
          });
        });
      }

      // Agent/subagent data from metadata
      const meta = msg.metadata;
      if (meta?.agentState?.agents) {
        meta.agentState.agents.forEach((agent: any, idx: number) => {
          agents.push({
            id: `agent-${msg.id}-${idx}`,
            messageId: msg.id,
            name: agent.name || agent.role || `Agent ${idx + 1}`,
            role: agent.role,
            status: agent.status || 'unknown',
            tasks: agent.tasks,
            plan: agent.plan,
            metadata: agent,
          });
        });
      }

      // Pipeline metrics as agent-like data
      if (meta?.pipelineMetrics) {
        agents.push({
          id: `pipeline-${msg.id}`,
          messageId: msg.id,
          name: 'Pipeline Execution',
          role: 'orchestrator',
          status: 'completed',
          metadata: meta.pipelineMetrics,
        });
      }
    });

    return { tools, agents };
  }, [messages]);

  // Filter data based on search
  const filteredTools = useMemo(() => {
    if (!searchFilter) return inspectorData.tools;
    const lower = searchFilter.toLowerCase();
    return inspectorData.tools.filter(t =>
      t.name.toLowerCase().includes(lower) ||
      t.server?.toLowerCase().includes(lower) ||
      JSON.stringify(t.arguments).toLowerCase().includes(lower)
    );
  }, [inspectorData.tools, searchFilter]);

  const filteredAgents = useMemo(() => {
    if (!searchFilter) return inspectorData.agents;
    const lower = searchFilter.toLowerCase();
    return inspectorData.agents.filter(a =>
      a.name.toLowerCase().includes(lower) ||
      a.role?.toLowerCase().includes(lower)
    );
  }, [inspectorData.agents, searchFilter]);

  const toggleExpanded = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* ignore */ }
  };

  if (!visible) return null;

  const totalItems = inspectorData.tools.length + inspectorData.agents.length;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed right-0 top-0 h-full z-[90] flex flex-col"
        style={{
          width: '480px',
          maxWidth: '90vw',
          backgroundColor: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Tool Call Inspector
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              color: 'var(--color-textSecondary)',
            }}>
              {totalItems} items
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/10" aria-label="Close inspector">
            <X className="w-4 h-4" style={{ color: 'var(--color-textSecondary)' }} />
          </button>
        </div>

        {/* Search + Tabs */}
        <div className="px-4 py-2 space-y-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-textMuted)' }} />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter by tool name, server..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs"
              style={{
                backgroundColor: 'var(--color-surfaceSecondary)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
              }}
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            {(['all', 'tools', 'agents'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
                style={{
                  backgroundColor: activeTab === tab ? 'var(--color-primary)' : 'var(--color-surfaceSecondary)',
                  color: activeTab === tab ? 'white' : 'var(--color-textSecondary)',
                }}
              >
                {tab === 'all' ? `All (${totalItems})` :
                 tab === 'tools' ? `Tools (${filteredTools.length})` :
                 `Agents (${filteredAgents.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {totalItems === 0 && (
            <div className="text-center py-8" style={{ color: 'var(--color-textMuted)' }}>
              <Wrench className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No tool calls in this conversation yet.</p>
              <p className="text-xs mt-1">Tool calls and agent activity will appear here.</p>
            </div>
          )}

          {/* Tools Section */}
          {(activeTab === 'all' || activeTab === 'tools') && filteredTools.map((tool) => (
            <div key={tool.id} className="rounded-lg overflow-hidden" style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              border: '1px solid var(--color-border)',
            }}>
              {/* Tool Header */}
              <button
                onClick={() => toggleExpanded(tool.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:brightness-110"
              >
                {expandedItems.has(tool.id) ?
                  <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-textSecondary)' }} /> :
                  <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-textSecondary)' }} />
                }
                <Wrench className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }} />
                <span className="text-xs font-mono font-medium truncate" style={{ color: 'var(--color-text)' }}>
                  {tool.name}
                </span>
                {tool.server && (
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-textMuted)',
                  }}>
                    {tool.server}
                  </span>
                )}
                <span className="ml-auto flex-shrink-0">
                  {tool.status === 'success' || tool.status === 'completed' ?
                    <CheckCircle className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} /> :
                    tool.status === 'error' ?
                    <XCircle className="w-3.5 h-3.5" style={{ color: '#ef4444' }} /> :
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#f59e0b' }} />
                  }
                </span>
              </button>

              {/* Expanded Detail */}
              <AnimatePresence>
                {expandedItems.has(tool.id) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="border-t px-3 py-2 space-y-2"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    {/* Meta row */}
                    <div className="flex gap-3 text-[10px]" style={{ color: 'var(--color-textMuted)' }}>
                      {tool.model && <span>Model: {tool.model}</span>}
                      {tool.duration && <span>{tool.duration}ms</span>}
                      {tool.type === 'mcp' && <span className="uppercase font-semibold">MCP</span>}
                    </div>

                    {/* Request */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-textSecondary)' }}>
                          Request
                        </span>
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(tool.arguments, null, 2), `req-${tool.id}`)}
                          className="p-0.5 rounded hover:bg-white/10"
                          aria-label="Copy request JSON"
                        >
                          {copiedId === `req-${tool.id}` ?
                            <Check className="w-3 h-3" style={{ color: 'var(--color-success)' }} /> :
                            <Copy className="w-3 h-3" style={{ color: 'var(--color-textMuted)' }} />
                          }
                        </button>
                      </div>
                      <pre className="text-[11px] font-mono p-2 rounded-md overflow-x-auto max-h-[200px] overflow-y-auto" style={{
                        backgroundColor: 'var(--color-background)',
                        color: 'var(--color-text)',
                        border: '1px solid var(--color-border)',
                      }}>
                        {JSON.stringify(tool.arguments, null, 2)}
                      </pre>
                    </div>

                    {/* Response */}
                    {tool.result !== undefined && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-textSecondary)' }}>
                            Response
                          </span>
                          <button
                            onClick={() => copyToClipboard(JSON.stringify(tool.result, null, 2), `res-${tool.id}`)}
                            className="p-0.5 rounded hover:bg-white/10"
                            aria-label="Copy response JSON"
                          >
                            {copiedId === `res-${tool.id}` ?
                              <Check className="w-3 h-3" style={{ color: 'var(--color-success)' }} /> :
                              <Copy className="w-3 h-3" style={{ color: 'var(--color-textMuted)' }} />
                            }
                          </button>
                        </div>
                        <pre className="text-[11px] font-mono p-2 rounded-md overflow-x-auto max-h-[300px] overflow-y-auto" style={{
                          backgroundColor: 'var(--color-background)',
                          color: tool.error ? '#ef4444' : 'var(--color-text)',
                          border: `1px solid ${tool.error ? '#ef4444' : 'var(--color-border)'}`,
                        }}>
                          {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Error */}
                    {tool.error && (
                      <div className="p-2 rounded-md text-xs" style={{
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        color: '#ef4444',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                      }}>
                        {tool.error}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}

          {/* Agents Section */}
          {(activeTab === 'all' || activeTab === 'agents') && filteredAgents.map((agent) => (
            <div key={agent.id} className="rounded-lg overflow-hidden" style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              border: '1px solid var(--color-border)',
            }}>
              <button
                onClick={() => toggleExpanded(agent.id)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:brightness-110"
              >
                {expandedItems.has(agent.id) ?
                  <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-textSecondary)' }} /> :
                  <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-textSecondary)' }} />
                }
                <Bot className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#8b5cf6' }} />
                <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                  {agent.name}
                </span>
                {agent.role && (
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-textMuted)',
                  }}>
                    {agent.role}
                  </span>
                )}
                <span className="ml-auto">
                  {agent.status === 'completed' ?
                    <CheckCircle className="w-3.5 h-3.5" style={{ color: 'var(--color-success)' }} /> :
                    agent.status === 'failed' ?
                    <XCircle className="w-3.5 h-3.5" style={{ color: '#ef4444' }} /> :
                    <Brain className="w-3.5 h-3.5" style={{ color: '#3b82f6' }} />
                  }
                </span>
              </button>

              <AnimatePresence>
                {expandedItems.has(agent.id) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="border-t px-3 py-2 space-y-2"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    {/* Tasks */}
                    {agent.tasks && agent.tasks.length > 0 && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-textSecondary)' }}>
                          Tasks ({agent.tasks.length})
                        </span>
                        <div className="mt-1 space-y-1">
                          {agent.tasks.map((task: any, tIdx: number) => (
                            <div key={tIdx} className="p-2 rounded text-xs" style={{
                              backgroundColor: 'var(--color-background)',
                              border: '1px solid var(--color-border)',
                            }}>
                              <div className="font-medium" style={{ color: 'var(--color-text)' }}>
                                {task.description || task.name || `Task ${tIdx + 1}`}
                              </div>
                              {task.result && (
                                <pre className="mt-1 text-[10px] font-mono overflow-x-auto max-h-[150px] overflow-y-auto" style={{ color: 'var(--color-textSecondary)' }}>
                                  {typeof task.result === 'string' ? task.result : JSON.stringify(task.result, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Raw metadata */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-textSecondary)' }}>
                          Raw Data
                        </span>
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(agent.metadata, null, 2), `agent-${agent.id}`)}
                          className="p-0.5 rounded hover:bg-white/10"
                          aria-label="Copy agent data"
                        >
                          {copiedId === `agent-${agent.id}` ?
                            <Check className="w-3 h-3" style={{ color: 'var(--color-success)' }} /> :
                            <Copy className="w-3 h-3" style={{ color: 'var(--color-textMuted)' }} />
                          }
                        </button>
                      </div>
                      <pre className="text-[11px] font-mono p-2 rounded-md overflow-x-auto max-h-[300px] overflow-y-auto" style={{
                        backgroundColor: 'var(--color-background)',
                        color: 'var(--color-text)',
                        border: '1px solid var(--color-border)',
                      }}>
                        {JSON.stringify(agent.metadata, null, 2)}
                      </pre>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

export default AdminToolInspector;
