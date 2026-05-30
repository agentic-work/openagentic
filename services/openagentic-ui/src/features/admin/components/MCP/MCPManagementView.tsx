/**
 * MCP Management View - Comprehensive MCP Proxy Management with Tool Testing
 *
 * Features:
 * - Dynamic MCP Server Configuration (JSON-based)
 * - Server Lifecycle Management (Start/Stop/Restart)
 * - Real-time Health Monitoring
 * - Tool Registry & Discovery
 * - **Tool Testing Interface** (like MCP Inspector)
 * - MCP Marketplace/Registry Integration
 * - Redis-backed Configuration Persistence
 */

import React, { useState, useEffect, useCallback } from 'react';
// Basic UI icons from lucide
import {
  Play, Square, Plus, Trash2, Eye, ChevronDown, ChevronRight,
  Code, Send, Copy, Check, Terminal, File, Search
} from '@/shared/icons';
// Custom badass OpenAgentic icons
import {
  Server, RotateCw, Activity, CheckCircle, XCircle, AlertCircle,
  Timer as Clock, TrendingUp, Loader2
} from '../Shared/AdminIcons';
import { apiRequest, apiEndpoint } from '@/utils/api';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { parseNDJSONStream } from '@/utils/ndjsonStream';
import { PageHeader } from '../../primitives-v2';

interface MCPTool {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, {
      type: string;
      description?: string;
      default?: any;
      enum?: string[];
    }>;
    required?: string[];
  };
}

interface MCPServerConfig {
  id: string;
  name: string;
  command: string[];
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  status: 'running' | 'stopped' | 'error' | 'starting' | 'stopping' | 'unknown';
  health?: {
    lastCheck: string;
    uptime: number;
    responseTime: number;
    errors: number;
  };
  tools?: MCPTool[];
  toolCount: number;
  createdAt: string;
  updatedAt: string;
  source?: 'manual' | 'marketplace' | 'npm' | 'pypi';
}

interface ToolTestResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTime: number;
  timestamp: string;
}

interface MCPManagementViewProps {
  theme: string;
}

export const MCPManagementView: React.FC<MCPManagementViewProps> = ({ theme }) => {
  const confirm = useConfirm();
  const [servers, setServers] = useState<MCPServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedServer, setSelectedServer] = useState<MCPServerConfig | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [configJson, setConfigJson] = useState('');
  const [activeTab, setActiveTab] = useState<'server-management' | 'registry' | 'tools' | 'health' | 'logs'>('server-management');

  // Live MCP server states from proxy health
  interface LiveMCPServer {
    id: string;
    status: 'running' | 'stopped' | 'error';
    enabled: boolean;
    lastError: string | null;
    transport: string;
    pid: number | null;
  }
  const [liveMCPServers, setLiveMCPServers] = useState<Record<string, LiveMCPServer>>({});
  const [liveMCPLoading, setLiveMCPLoading] = useState(false);
  const [enabledStates, setEnabledStates] = useState<Record<string, boolean>>({});
  const [togglingServer, setTogglingServer] = useState<string | null>(null);

  // Tool Testing State
  const [allTools, setAllTools] = useState<Array<MCPTool & { server: string }>>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [selectedTool, setSelectedTool] = useState<(MCPTool & { server: string }) | null>(null);
  const [toolArgs, setToolArgs] = useState<Record<string, any>>({});
  const [testResult, setTestResult] = useState<ToolTestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [toolSearchQuery, setToolSearchQuery] = useState('');
  const [copiedResult, setCopiedResult] = useState(false);

  // Load MCP servers from proxy
  const loadServers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiRequest('/admin/mcp/servers');

      if (!response.ok) {
        throw new Error(`Failed to load MCP servers: ${response.statusText}`);
      }

      const data = await response.json();
      setServers(data.servers || []);
    } catch (err: any) {
      console.error('Failed to load MCP servers:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load live MCP server status from proxy health endpoint
  const loadLiveMCPServers = useCallback(async () => {
    try {
      setLiveMCPLoading(true);
      const response = await apiRequest('/admin/mcp/health');

      if (!response.ok) {
        throw new Error(`Failed to load MCP health: ${response.statusText}`);
      }

      const data = await response.json();
      const serverStatuses = data.proxy?.servers?.statuses || {};

      // Transform to our format
      const liveServers: Record<string, LiveMCPServer> = {};
      Object.entries(serverStatuses).forEach(([name, info]: [string, any]) => {
        liveServers[name] = {
          id: name,
          status: info.status || 'unknown',
          enabled: info.enabled ?? true,
          lastError: info.last_error || null,
          transport: info.transport || 'stdio',
          pid: info.pid || null
        };
        // Track enabled states
        setEnabledStates(prev => ({ ...prev, [name]: info.enabled ?? true }));
      });

      setLiveMCPServers(liveServers);
    } catch (err: any) {
      console.error('Failed to load live MCP servers:', err);
    } finally {
      setLiveMCPLoading(false);
    }
  }, []);

  // Toggle MCP server enabled/disabled
  const toggleServerEnabled = useCallback(async (serverId: string, enabled: boolean) => {
    try {
      setTogglingServer(serverId);
      const response = await apiRequest(`/admin/mcp/servers/${serverId}/enabled`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled })
      });

      if (!response.ok) {
        throw new Error(`Failed to toggle server: ${response.statusText}`);
      }

      // Update local state immediately
      setEnabledStates(prev => ({ ...prev, [serverId]: enabled }));
      setLiveMCPServers(prev => ({
        ...prev,
        [serverId]: { ...prev[serverId], enabled }
      }));

      // Refresh to get latest state
      await loadLiveMCPServers();
    } catch (err: any) {
      console.error('Failed to toggle server enabled:', err);
      setError(err.message);
    } finally {
      setTogglingServer(null);
    }
  }, [loadLiveMCPServers]);

  // Load all tools from MCP Proxy
  const loadAllTools = useCallback(async () => {
    try {
      setToolsLoading(true);
      const response = await apiRequest('/admin/mcp/tools-list');

      if (!response.ok) {
        throw new Error(`Failed to load tools: ${response.statusText}`);
      }

      const data = await response.json();
      const toolsList = data.tools || [];
      setAllTools(toolsList);
    } catch (err: any) {
      console.error('Failed to load tools:', err);
      // Don't set error for tools - just log it
    } finally {
      setToolsLoading(false);
    }
  }, []);

  // Server lifecycle actions
  const handleServerAction = useCallback(async (serverId: string, action: 'start' | 'stop' | 'restart') => {
    try {
      const response = await apiRequest(`/admin/mcp/servers/${serverId}/${action}`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} server: ${response.statusText}`);
      }

      await loadServers();
    } catch (err: any) {
      console.error(`Failed to ${action} server:`, err);
      setError(err.message);
    }
  }, [loadServers]);

  // Add new MCP server from JSON config
  const handleAddServer = useCallback(async () => {
    try {
      const config = JSON.parse(configJson);
      const response = await apiRequest('/admin/mcp/servers', {
        method: 'POST',
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        throw new Error(`Failed to add server: ${response.statusText}`);
      }

      setShowAddModal(false);
      setConfigJson('');
      await loadServers();
    } catch (err: any) {
      console.error('Failed to add server:', err);
      setError(err.message);
    }
  }, [configJson, loadServers]);

  // Delete MCP server
  const handleDeleteServer = useCallback(async (serverId: string) => {
    if (!await confirm('Are you sure you want to delete this MCP server? This action cannot be undone.', { variant: 'danger', title: 'Delete MCP Server' })) {
      return;
    }

    try {
      const response = await apiRequest(`/admin/mcp/servers/${serverId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Failed to delete server: ${response.statusText}`);
      }

      await loadServers();
    } catch (err: any) {
      console.error('Failed to delete server:', err);
      setError(err.message);
    }
  }, [confirm, loadServers]);

  // Test a tool with given arguments
  const handleTestTool = useCallback(async () => {
    if (!selectedTool) return;

    setTestLoading(true);
    setTestResult(null);
    const startTime = Date.now();

    try {
      const response = await apiRequest('/mcp', {
        method: 'POST',
        body: JSON.stringify({
          method: 'tools/call',
          params: {
            name: selectedTool.name,
            arguments: toolArgs
          },
          server: selectedTool.server,
          id: `test-${Date.now()}`
        })
      });

      const executionTime = Date.now() - startTime;
      const data = await response.json();

      if (data.error) {
        setTestResult({
          success: false,
          error: data.error.message || JSON.stringify(data.error),
          executionTime,
          timestamp: new Date().toISOString()
        });
      } else {
        setTestResult({
          success: true,
          result: data.result,
          executionTime,
          timestamp: new Date().toISOString()
        });
      }
    } catch (err: any) {
      const executionTime = Date.now() - startTime;
      setTestResult({
        success: false,
        error: err.message,
        executionTime,
        timestamp: new Date().toISOString()
      });
    } finally {
      setTestLoading(false);
    }
  }, [selectedTool, toolArgs]);

  // Initialize tool arguments when selecting a tool
  const selectTool = useCallback((tool: MCPTool & { server: string }) => {
    setSelectedTool(tool);
    setTestResult(null);

    // Initialize arguments with defaults
    const initialArgs: Record<string, any> = {};
    if (tool.inputSchema?.properties) {
      Object.entries(tool.inputSchema.properties).forEach(([key, prop]) => {
        if (prop.default !== undefined) {
          initialArgs[key] = prop.default;
        } else if (prop.type === 'string') {
          initialArgs[key] = '';
        } else if (prop.type === 'number' || prop.type === 'integer') {
          initialArgs[key] = 0;
        } else if (prop.type === 'boolean') {
          initialArgs[key] = false;
        } else if (prop.type === 'array') {
          initialArgs[key] = [];
        } else if (prop.type === 'object') {
          initialArgs[key] = {};
        }
      });
    }
    setToolArgs(initialArgs);
  }, []);

  // Copy result to clipboard
  const copyResultToClipboard = useCallback(() => {
    if (testResult) {
      navigator.clipboard.writeText(JSON.stringify(testResult.result || testResult.error, null, 2));
      setCopiedResult(true);
      setTimeout(() => setCopiedResult(false), 2000);
    }
  }, [testResult]);

  // Load servers, tools, and live status on mount
  useEffect(() => {
    loadServers();
    loadAllTools();
    loadLiveMCPServers();
  }, [loadServers, loadAllTools, loadLiveMCPServers]);

  const isDark = theme === 'dark';

  // Group tools by server
  const toolsByServer = allTools.reduce((acc, tool) => {
    if (!acc[tool.server]) {
      acc[tool.server] = [];
    }
    acc[tool.server].push(tool);
    return acc;
  }, {} as Record<string, Array<MCPTool & { server: string }>>);

  // Filter tools by search query
  const filteredToolsByServer = Object.entries(toolsByServer).reduce((acc, [server, tools]) => {
    const filtered = tools.filter(tool =>
      tool.name.toLowerCase().includes(toolSearchQuery.toLowerCase()) ||
      tool.description?.toLowerCase().includes(toolSearchQuery.toLowerCase())
    );
    if (filtered.length > 0) {
      acc[server] = filtered;
    }
    return acc;
  }, {} as Record<string, Array<MCPTool & { server: string }>>);

  // Toggle server expansion in tools list
  const toggleServerExpanded = (serverId: string) => {
    const newExpanded = new Set(expandedServers);
    if (newExpanded.has(serverId)) {
      newExpanded.delete(serverId);
    } else {
      newExpanded.add(serverId);
    }
    setExpandedServers(newExpanded);
  };

  // Status badge component
  const StatusBadge: React.FC<{ status: MCPServerConfig['status'] }> = ({ status }) => {
    const statusConfig = {
      running: { icon: CheckCircle, color: 'ap-text-success', bg: 'bg-success-500/10', label: 'Running' },
      stopped: { icon: Square, color: 'text-text-secondary', bg: 'bg-surface-secondary0/10', label: 'Stopped' },
      error: { icon: XCircle, color: 'ap-text-error', bg: 'bg-error-500/10', label: 'Error' },
      starting: { icon: Activity, color: 'text-primary-500', bg: 'ap-bg-primary0/10', label: 'Starting' },
      stopping: { icon: Activity, color: 'ap-text-warning', bg: 'bg-warning-500/10', label: 'Stopping' },
      unknown: { icon: AlertCircle, color: 'text-text-secondary', bg: 'bg-surface-secondary0/10', label: 'Unknown' }
    };

    const config = statusConfig[status] || statusConfig.unknown;
    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.color}`}>
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </span>
    );
  };

  // Server card component
  const ServerCard: React.FC<{ server: MCPServerConfig }> = ({ server }) => (
    <div className="p-4 rounded-lg border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <Server className="w-5 h-5" style={{ color: 'var(--color-textMuted)' }} />
            <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              {server.name}
            </h3>
            <StatusBadge status={server.status} />
          </div>
          <p className="text-sm mb-2" style={{ color: 'var(--color-textSecondary)' }}>
            ID: <code className="text-xs">{server.id}</code>
          </p>
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5" style={{ color: 'var(--color-textSecondary)' }}>
              <Code className="w-4 h-4" />
              {server.toolCount} tools
            </span>
            {server.health && (
              <>
                <span className="flex items-center gap-1.5" style={{ color: 'var(--color-textSecondary)' }}>
                  <Clock className="w-4 h-4" />
                  {Math.floor(server.health.uptime / 60)}m uptime
                </span>
                <span className="flex items-center gap-1.5" style={{ color: 'var(--color-textSecondary)' }}>
                  <TrendingUp className="w-4 h-4" />
                  {server.health.responseTime}ms
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {server.status === 'running' ? (
            <>
              <button
                onClick={() => handleServerAction(server.id, 'restart')}
                className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-surface-hover text-text-secondary hover:text-primary-500' : 'hover:bg-surface-secondary text-text-secondary hover:text-primary-600'}`}
                title="Restart"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleServerAction(server.id, 'stop')}
                className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-surface-hover text-text-secondary hover:ap-text-warning' : 'hover:bg-surface-secondary text-text-secondary hover:ap-text-warning'}`}
                title="Stop"
              >
                <Square className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              onClick={() => handleServerAction(server.id, 'start')}
              className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-surface-hover text-text-secondary hover:ap-text-success' : 'hover:bg-surface-secondary text-text-secondary hover:ap-text-success'}`}
              title="Start"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setSelectedServer(server)}
            className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-surface-hover text-text-secondary hover:text-primary-500' : 'hover:bg-surface-secondary text-text-secondary hover:text-primary-600'}`}
            title="View Details"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleDeleteServer(server.id)}
            className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-surface-hover text-text-secondary hover:ap-text-error' : 'hover:bg-surface-secondary text-text-secondary hover:ap-text-error'}`}
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Server command display */}
      <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-xs mb-1" style={{ color: 'var(--color-textMuted)' }}>Command:</p>
        <code className="block text-xs p-2 rounded" style={{ color: 'var(--color-textSecondary)', background: 'var(--color-surfaceSecondary)' }}>
          {server.command.join(' ')} {server.args?.join(' ')}
        </code>
      </div>
    </div>
  );

  // Tool Testing Panel
  const ToolTestingPanel = () => (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-300px)] min-h-[500px]">
      {/* Tools List - Left Panel */}
      <div className="col-span-4 rounded-lg border flex flex-col" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="p-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Terminal className={`w-4 h-4 ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`} />
            <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-text-primary'}`}>
              Available Tools
            </h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${isDark ? 'bg-surface-hover text-text-secondary' : 'bg-surface-secondary text-text-secondary'}`}>
              {allTools.length}
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-textMuted)' }} />
            <input
              type="text"
              placeholder="Search tools..."
              value={toolSearchQuery}
              onChange={(e) => setToolSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border"
              style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {toolsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className={`w-6 h-6 animate-spin ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`} />
            </div>
          ) : Object.keys(filteredToolsByServer).length === 0 ? (
            <div className={`text-center py-8 ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
              <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No tools found</p>
            </div>
          ) : (
            Object.entries(filteredToolsByServer).map(([server, tools]) => (
              <div key={server} className="mb-2">
                <button
                  onClick={() => toggleServerExpanded(server)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left ${
                    isDark ? 'hover:bg-surface-hover/50' : 'hover:bg-surface-secondary'
                  }`}
                >
                  {expandedServers.has(server) ? (
                    <ChevronDown className={`w-4 h-4 ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`} />
                  ) : (
                    <ChevronRight className={`w-4 h-4 ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`} />
                  )}
                  <Server className={`w-3.5 h-3.5 ${isDark ? 'text-primary-500' : 'text-primary-600'}`} />
                  <span className={`text-sm font-medium flex-1 ${isDark ? 'text-text-tertiary' : 'text-text-primary'}`}>
                    {server}
                  </span>
                  <span className={`text-xs ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                    {tools.length}
                  </span>
                </button>

                {expandedServers.has(server) && (
                  <div className="ml-4 mt-1 space-y-1">
                    {tools.map((tool) => (
                      <button
                        key={`${server}-${tool.name}`}
                        onClick={() => selectTool(tool)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          selectedTool?.name === tool.name && selectedTool?.server === server
                            ? isDark
                              ? 'bg-primary-600/20 border border-primary/30 text-primary-500'
                              : 'ap-bg-primary border border-primary text-primary-600'
                            : isDark
                              ? 'hover:bg-surface-hover/50 text-text-tertiary'
                              : 'hover:bg-surface-secondary text-text-primary'
                        }`}
                      >
                        <div className="font-medium truncate">{tool.name}</div>
                        {tool.description && (
                          <div className={`text-xs truncate mt-0.5 ${
                            selectedTool?.name === tool.name && selectedTool?.server === server
                              ? isDark ? 'text-primary-500/70' : 'text-primary-600/70'
                              : isDark ? 'text-text-secondary' : 'text-text-secondary'
                          }`}>
                            {tool.description}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Tool Details & Testing - Right Panel */}
      <div className="col-span-8 rounded-lg border flex flex-col" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        {!selectedTool ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-textMuted)' }}>
            <div className="text-center">
              <File className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">Select a tool to test</p>
            </div>
          </div>
        ) : (
          <>
            {/* Tool Header */}
            <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                    {selectedTool.name}
                  </h3>
                  <p className="text-sm mt-1" style={{ color: 'var(--color-textSecondary)' }}>
                    {selectedTool.description}
                  </p>
                  <p className="text-xs mt-2" style={{ color: 'var(--color-textMuted)' }}>
                    Server: <code className="px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surfaceTertiary)' }}>{selectedTool.server}</code>
                  </p>
                </div>
                <button
                  onClick={handleTestTool}
                  disabled={testLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-600/50 text-white rounded-lg transition-colors"
                >
                  {testLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Execute
                </button>
              </div>
            </div>

            {/* Parameters & Result */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Input Parameters */}
              {selectedTool.inputSchema?.properties && Object.keys(selectedTool.inputSchema.properties).length > 0 ? (
                <div>
                  <h4 className={`text-sm font-medium mb-3 ${isDark ? 'text-text-tertiary' : 'text-text-primary'}`}>
                    Input Parameters
                  </h4>
                  <div className="space-y-3">
                    {Object.entries(selectedTool.inputSchema.properties).map(([key, prop]) => {
                      const isRequired = selectedTool.inputSchema?.required?.includes(key);
                      return (
                        <div key={key}>
                          <label className={`block text-sm mb-1 ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                            <span className="font-medium">{key}</span>
                            {isRequired && <span className="ap-text-error ml-1">*</span>}
                            <span className={`ml-2 text-xs ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                              ({prop.type})
                            </span>
                          </label>
                          {prop.description && (
                            <p className={`text-xs mb-1.5 ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                              {prop.description}
                            </p>
                          )}
                          {prop.enum ? (
                            <select
                              value={toolArgs[key] || ''}
                              onChange={(e) => setToolArgs({ ...toolArgs, [key]: e.target.value })}
                              className={`w-full px-3 py-2 rounded-lg border text-sm ${
                                isDark
                                  ? 'bg-surface border-border-hover text-text-tertiary'
                                  : 'bg-white border-border text-text-primary'
                              }`}
                            >
                              <option value="">Select...</option>
                              {prop.enum.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : prop.type === 'boolean' ? (
                            <select
                              value={String(toolArgs[key] || false)}
                              onChange={(e) => setToolArgs({ ...toolArgs, [key]: e.target.value === 'true' })}
                              className={`w-full px-3 py-2 rounded-lg border text-sm ${
                                isDark
                                  ? 'bg-surface border-border-hover text-text-tertiary'
                                  : 'bg-white border-border text-text-primary'
                              }`}
                            >
                              <option value="false">false</option>
                              <option value="true">true</option>
                            </select>
                          ) : prop.type === 'number' || prop.type === 'integer' ? (
                            <input
                              type="number"
                              value={toolArgs[key] || 0}
                              onChange={(e) => setToolArgs({ ...toolArgs, [key]: Number(e.target.value) })}
                              className={`w-full px-3 py-2 rounded-lg border text-sm ${
                                isDark
                                  ? 'bg-surface border-border-hover text-text-tertiary'
                                  : 'bg-white border-border text-text-primary'
                              }`}
                            />
                          ) : prop.type === 'object' || prop.type === 'array' ? (
                            <textarea
                              value={typeof toolArgs[key] === 'object' ? JSON.stringify(toolArgs[key], null, 2) : toolArgs[key] || ''}
                              onChange={(e) => {
                                try {
                                  setToolArgs({ ...toolArgs, [key]: JSON.parse(e.target.value) });
                                } catch {
                                  setToolArgs({ ...toolArgs, [key]: e.target.value });
                                }
                              }}
                              rows={3}
                              placeholder={prop.type === 'array' ? '[]' : '{}'}
                              className={`w-full px-3 py-2 rounded-lg border text-sm font-mono ${
                                isDark
                                  ? 'bg-surface border-border-hover text-text-tertiary'
                                  : 'bg-white border-border text-text-primary'
                              }`}
                            />
                          ) : (
                            <input
                              type="text"
                              value={toolArgs[key] || ''}
                              onChange={(e) => setToolArgs({ ...toolArgs, [key]: e.target.value })}
                              placeholder={prop.default !== undefined ? String(prop.default) : ''}
                              className={`w-full px-3 py-2 rounded-lg border text-sm ${
                                isDark
                                  ? 'bg-surface border-border-hover text-text-tertiary'
                                  : 'bg-white border-border text-text-primary'
                              }`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className={`p-4 rounded-lg ${isDark ? 'bg-surface/50' : 'bg-surface-secondary'}`}>
                  <p className={`text-sm ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                    This tool has no input parameters
                  </p>
                </div>
              )}

              {/* Result Display */}
              {testResult && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className={`text-sm font-medium ${isDark ? 'text-text-tertiary' : 'text-text-primary'}`}>
                      Result
                    </h4>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                        {testResult.executionTime}ms
                      </span>
                      <button
                        onClick={copyResultToClipboard}
                        className={`p-1.5 rounded transition-colors ${
                          isDark ? 'hover:bg-surface-hover text-text-secondary' : 'hover:bg-surface-secondary text-text-secondary'
                        }`}
                        title="Copy to clipboard"
                      >
                        {copiedResult ? (
                          <Check className="w-4 h-4 ap-text-success" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className={`rounded-lg overflow-hidden border ${
                    testResult.success
                      ? isDark ? 'border-success/30' : 'border-success'
                      : isDark ? 'border-error/30' : 'border-error'
                  }`}>
                    <div className={`px-3 py-2 text-xs font-medium ${
                      testResult.success
                        ? isDark ? 'bg-success-500/10 ap-text-success' : 'ap-bg-success ap-text-success'
                        : isDark ? 'bg-error-500/10 ap-text-error' : 'ap-bg-error ap-text-error'
                    }`}>
                      {testResult.success ? '✓ Success' : '✗ Error'}
                    </div>
                    <pre className={`p-3 text-sm font-mono overflow-x-auto max-h-64 ${
                      isDark ? 'bg-surface text-text-tertiary' : 'bg-surface-secondary text-text-primary'
                    }`}>
                      {JSON.stringify(testResult.success ? testResult.result : testResult.error, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  // Server Management Panel - Live MCP status with enable/disable toggles
  const ServerManagementPanel = () => {
    const serverEntries = Object.entries(liveMCPServers);
    const runningCount = serverEntries.filter(([, s]) => s.status === 'running').length;
    const enabledCount = serverEntries.filter(([, s]) => s.enabled).length;

    return (
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className={`p-4 rounded-lg ${isDark ? 'bg-surface/50' : 'bg-surface-secondary'} border`} style={{ borderColor: 'var(--color-border)' }}>
            <p className={`text-sm ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Total MCPs</p>
            <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-text-primary'}`}>
              {serverEntries.length}
            </p>
          </div>
          <div className={`p-4 rounded-lg ${isDark ? 'bg-surface/50' : 'bg-surface-secondary'} border`} style={{ borderColor: 'var(--color-border)' }}>
            <p className={`text-sm ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Running</p>
            <p className="text-2xl font-bold ap-text-success">{runningCount}</p>
          </div>
          <div className={`p-4 rounded-lg ${isDark ? 'bg-surface/50' : 'bg-surface-secondary'} border`} style={{ borderColor: 'var(--color-border)' }}>
            <p className={`text-sm ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Enabled</p>
            <p className="text-2xl font-bold text-primary-500">{enabledCount}</p>
          </div>
          <div className={`p-4 rounded-lg ${isDark ? 'bg-surface/50' : 'bg-surface-secondary'} border`} style={{ borderColor: 'var(--color-border)' }}>
            <p className={`text-sm ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Total Tools</p>
            <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-text-primary'}`}>
              {allTools.length}
            </p>
          </div>
        </div>

        {/* Server List with Enable/Disable Toggles */}
        <div className={`rounded-lg border ${isDark ? 'bg-surface/30' : 'bg-white'} overflow-hidden`} style={{ borderColor: 'var(--color-border)' }}>
          <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
            <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-text-primary'}`}>
              Live MCP Servers
            </h3>
            <button
              onClick={loadLiveMCPServers}
              className={`p-2 rounded-lg transition-colors ${
                isDark ? 'hover:bg-surface-hover text-text-secondary' : 'hover:bg-surface-secondary text-text-secondary'
              }`}
              title="Refresh"
            >
              <RotateCw className={`w-4 h-4 ${liveMCPLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {liveMCPLoading && serverEntries.length === 0 ? (
            <div className="p-8 text-center">
              <Loader2 className={`w-8 h-8 animate-spin mx-auto mb-4 ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`} />
              <p className={isDark ? 'text-text-secondary' : 'text-text-secondary'}>Loading MCP servers...</p>
            </div>
          ) : serverEntries.length === 0 ? (
            <div className={`p-8 text-center ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
              <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No MCP servers found</p>
              <p className="text-sm mt-1">Check MCP proxy connection</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {serverEntries.map(([serverName, server]) => {
                const isEnabled = enabledStates[serverName] ?? server.enabled;
                const isToggling = togglingServer === serverName;
                const toolCount = allTools.filter(t => t.server === serverName).length;

                return (
                  <div
                    key={serverName}
                    className={`p-4 flex items-center justify-between transition-colors ${
                      isDark ? 'hover:bg-surface/50' : 'hover:bg-surface-secondary'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Status Indicator */}
                      <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                        server.status === 'running' && isEnabled
                          ? 'bg-success-500'
                          : server.status === 'error'
                          ? 'bg-error-500'
                          : 'bg-surface-secondary0'
                      }`} />

                      <div>
                        <div className="flex items-center gap-2">
                          <p className={`font-medium ${isDark ? 'text-white' : 'text-text-primary'}`}>
                            {serverName.replace(/_/g, ' ').replace(/awp /i, '')}
                          </p>
                          <code className={`text-xs px-1.5 py-0.5 rounded ${
                            isDark ? 'bg-surface-hover text-text-secondary' : 'bg-surface-secondary text-text-secondary'
                          }`}>
                            {serverName}
                          </code>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className={`text-xs ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                            {server.transport}
                          </span>
                          {server.pid && (
                            <span className={`text-xs ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                              PID: {server.pid}
                            </span>
                          )}
                          <span className={`text-xs ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                            {toolCount} tools
                          </span>
                        </div>
                        {server.lastError && (
                          <p className="text-xs ap-text-error mt-1 truncate max-w-md">
                            {server.lastError}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Status Badge */}
                      <StatusBadge status={server.status} />

                      {/* Enable/Disable Toggle */}
                      <button
                        onClick={() => toggleServerEnabled(serverName, !isEnabled)}
                        disabled={isToggling}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          isEnabled ? 'bg-primary-600' : isDark ? 'bg-surface-hover' : 'bg-surface-secondary'
                        } ${isToggling ? 'opacity-50 cursor-wait' : ''}`}
                        role="switch"
                        aria-checked={isEnabled}
                        title={isEnabled ? 'Click to disable' : 'Click to enable'}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            isEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        >
                          {isToggling && (
                            <Loader2 className="w-3 h-3 animate-spin absolute top-1 left-1 text-text-secondary" />
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    );
  };

  // Server Logs Panel - Live log streaming with search and filter
  const ServerLogsPanel = ({
    servers: serverList,
    isDark: darkMode,
  }: {
    servers: MCPServerConfig[];
    isDark: boolean;
  }) => {
    const [logs, setLogs] = React.useState<Array<{ timestamp: string; server: string; level: string; message: string }>>([]);
    const [selectedLogServer, setSelectedLogServer] = React.useState<string>('all');
    const [logSearch, setLogSearch] = React.useState('');
    const [autoScroll, setAutoScroll] = React.useState(true);
    const [isStreaming, setIsStreaming] = React.useState(false);
    const [logLevel, setLogLevel] = React.useState<string>('all');
    const logsEndRef = React.useRef<HTMLDivElement>(null);
    const abortRef = React.useRef<AbortController | null>(null);

    // Scroll to bottom when new logs arrive
    React.useEffect(() => {
      if (autoScroll && logsEndRef.current) {
        logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }, [logs, autoScroll]);

    // Start log streaming — v0.6.7 NDJSON via shared parser.
    const startStreaming = React.useCallback(async () => {
      if (abortRef.current) abortRef.current.abort();
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const token = localStorage.getItem('auth_token') || '';
        const url = new URL(apiEndpoint('/admin/mcp/logs/stream'));
        url.searchParams.set('token', token);
        if (selectedLogServer !== 'all') {
          url.searchParams.set('server', selectedLogServer);
        }

        const resp = await fetch(url.toString(), {
          method: 'GET',
          headers: { 'Accept': 'application/x-ndjson' },
          signal: abort.signal,
        });
        setIsStreaming(true);

        for await (const event of parseNDJSONStream<{ type: string; timestamp?: string; server?: string; level?: string; message?: string }>(resp)) {
          if (event.type === 'log') {
            const logEntry = {
              timestamp: event.timestamp || new Date().toISOString(),
              server: event.server || 'mcp-proxy',
              level: event.level || 'info',
              message: event.message || '',
            };
            setLogs(prev => [...prev.slice(-500), logEntry]);
          } else if (event.type === 'close') {
            break;
          }
          // heartbeat events: ignore
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          console.error('Failed to stream logs:', error);
        }
      } finally {
        setIsStreaming(false);
      }
    }, [selectedLogServer]);

    // Fetch recent logs on mount or server change
    React.useEffect(() => {
      const fetchLogs = async () => {
        try {
          const endpoint = selectedLogServer === 'all'
            ? '/admin/mcp/logs?lines=200'
            : `/admin/mcp/logs?lines=200&server=${selectedLogServer}`;

          const response = await apiRequest(endpoint);
          if (response.ok) {
            const data = await response.json();
            setLogs(data.logs || []);
          }
        } catch (error) {
          console.error('Failed to fetch logs:', error);
        }
      };

      fetchLogs();
    }, [selectedLogServer]);

    // Cleanup on unmount
    React.useEffect(() => {
      return () => {
        if (abortRef.current) {
          abortRef.current.abort();
        }
      };
    }, []);

    // Filter logs
    const filteredLogs = logs.filter(log => {
      const matchesSearch = logSearch === '' ||
        log.message.toLowerCase().includes(logSearch.toLowerCase()) ||
        log.server.toLowerCase().includes(logSearch.toLowerCase());
      const matchesLevel = logLevel === 'all' || log.level === logLevel;
      return matchesSearch && matchesLevel;
    });

    const getLevelColor = (level: string) => {
      switch (level.toLowerCase()) {
        case 'error': return 'ap-text-error';
        case 'warn': case 'warning': return 'ap-text-warning';
        case 'info': return 'text-primary-500';
        case 'debug': return 'text-text-secondary';
        default: return darkMode ? 'text-text-tertiary' : 'text-text-secondary';
      }
    };

    return (
      <div className="rounded-lg border flex flex-col h-[calc(100vh-300px)] min-h-[500px]" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        {/* Controls */}
        <div className="p-4 border-b flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--color-border)' }}>
          {/* Server Filter */}
          <select
            value={selectedLogServer}
            onChange={(e) => setSelectedLogServer(e.target.value)}
            className={`px-3 py-2 rounded-lg text-sm ${
              darkMode
                ? 'bg-surface border-border-hover text-text-tertiary'
                : 'bg-surface-secondary border-border text-text-primary'
            } border`}
          >
            <option value="all">All Servers</option>
            <option value="mcp-proxy">MCP Proxy</option>
            {serverList.map(server => (
              <option key={server.id} value={server.name}>{server.name}</option>
            ))}
          </select>

          {/* Level Filter */}
          <select
            value={logLevel}
            onChange={(e) => setLogLevel(e.target.value)}
            className={`px-3 py-2 rounded-lg text-sm ${
              darkMode
                ? 'bg-surface border-border-hover text-text-tertiary'
                : 'bg-surface-secondary border-border text-text-primary'
            } border`}
          >
            <option value="all">All Levels</option>
            <option value="error">Error</option>
            <option value="warn">Warning</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>

          {/* Search */}
          <div className="flex-1 relative min-w-[200px]">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${darkMode ? 'text-text-secondary' : 'text-text-secondary'}`} />
            <input
              type="text"
              placeholder="Search logs..."
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg ${
                darkMode
                  ? 'bg-surface border-border-hover text-text-tertiary placeholder-gray-500'
                  : 'bg-surface-secondary border-border text-text-primary placeholder-gray-400'
              } border`}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => isStreaming ? abortRef.current?.abort() : startStreaming()}
              className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${
                isStreaming
                  ? 'bg-error-500 hover:bg-error-500 text-white'
                  : 'bg-success-500 hover:bg-success-500 text-white'
              }`}
            >
              {isStreaming ? (
                <>
                  <Square className="w-4 h-4" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Stream
                </>
              )}
            </button>

            <button
              onClick={() => setLogs([])}
              className={`px-3 py-2 rounded-lg text-sm ${
                darkMode
                  ? 'bg-surface-hover hover:bg-surface-hover text-text-tertiary'
                  : 'bg-surface-secondary hover:bg-surface-secondary text-text-primary'
              }`}
            >
              Clear
            </button>

            <label className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer ${
              darkMode ? 'hover:bg-surface-hover' : 'hover:bg-surface-secondary'
            }`}>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded"
              />
              <span className={`text-sm ${darkMode ? 'text-text-tertiary' : 'text-text-primary'}`}>Auto-scroll</span>
            </label>
          </div>
        </div>

        {/* Status Bar */}
        <div className="px-4 py-2 border-b flex items-center gap-4 text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-success-500 animate-pulse' : ''}`} style={!isStreaming ? { background: 'var(--color-textMuted)' } : {}} />
            <span style={{ color: 'var(--color-textSecondary)' }}>
              {isStreaming ? 'Streaming live logs...' : 'Not streaming'}
            </span>
          </div>
          <span style={{ color: 'var(--color-textMuted)' }}>
            {filteredLogs.length} entries
          </span>
        </div>

        {/* Logs Display */}
        <div className="flex-1 overflow-y-auto font-mono text-xs" style={{ background: 'var(--color-surfaceSecondary)' }}>
          {filteredLogs.length === 0 ? (
            <div className={`flex items-center justify-center h-full ${darkMode ? 'text-text-secondary' : 'text-text-secondary'}`}>
              <div className="text-center">
                <Terminal className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No logs to display</p>
                <p className="text-sm mt-1">Click "Stream" to start receiving live logs</p>
              </div>
            </div>
          ) : (
            <div className="p-2">
              {filteredLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={`py-1 px-2 hover:${darkMode ? 'bg-surface' : 'bg-surface-secondary'} rounded flex gap-3 items-start`}
                >
                  <span className={darkMode ? 'text-text-secondary' : 'text-text-secondary'}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`uppercase font-bold w-12 ${getLevelColor(log.level)}`}>
                    {log.level.substring(0, 4)}
                  </span>
                  <span className={`${darkMode ? 'text-primary-500' : 'text-primary-500'} w-24 truncate`}>
                    [{log.server}]
                  </span>
                  <span className={darkMode ? 'text-text-tertiary' : 'text-text-primary'}>
                    {log.message}
                  </span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={['Admin', 'Tools', 'Server Management']}
        title="MCP Server Management"
        explainer="Manage Model Context Protocol servers and test tools."
        actions={[
          { label: 'Refresh', onClick: () => { loadServers(); loadAllTools(); } },
          { label: 'Add Server', primary: true, onClick: () => setShowAddModal(true) },
        ]}
      />

      {/* Tabs */}
      <div className={`flex gap-2 border-b ${isDark ? 'border-border-hover' : 'border-border'}`}>
        <button
          onClick={() => setActiveTab('server-management')}
          className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'server-management'
              ? 'border-b-2 border-primary text-primary-500'
              : isDark ? 'text-text-secondary hover:text-text-tertiary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <Server className="w-4 h-4" />
          Server Management
        </button>
        <button
          onClick={() => setActiveTab('registry')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'registry'
              ? 'border-b-2 border-primary text-primary-500'
              : isDark ? 'text-text-secondary hover:text-text-tertiary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Registry
        </button>
        <button
          onClick={() => setActiveTab('tools')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'tools'
              ? 'border-b-2 border-primary text-primary-500'
              : isDark ? 'text-text-secondary hover:text-text-tertiary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Tool Testing
        </button>
        <button
          onClick={() => setActiveTab('health')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'health'
              ? 'border-b-2 border-primary text-primary-500'
              : isDark ? 'text-text-secondary hover:text-text-tertiary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Health
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'logs'
              ? 'border-b-2 border-primary text-primary-500'
              : isDark ? 'text-text-secondary hover:text-text-tertiary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <Terminal className="w-4 h-4" />
          Server Logs
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 bg-error-500/10 border border-error/20 rounded-lg flex items-start gap-3">
          <XCircle className="w-5 h-5 ap-text-error flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="ap-text-error font-medium">Error</p>
            <p className={`text-sm ${isDark ? 'ap-text-error' : 'ap-text-error'}`}>{error}</p>
          </div>
        </div>
      )}

      {/* Server Management Tab - Live status with enable/disable */}
      {activeTab === 'server-management' && <ServerManagementPanel />}

      {/* Registry Tab - Static configuration */}
      {activeTab === 'registry' && (
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-12">
              <Activity className={`w-8 h-8 animate-spin mx-auto mb-4 ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`} />
              <p className={isDark ? 'text-text-secondary' : 'text-text-secondary'}>Loading MCP servers...</p>
            </div>
          ) : servers.length === 0 ? (
            <div className={`text-center py-12 rounded-lg border ${isDark ? 'bg-surface/50 border-border-hover' : 'bg-surface-secondary border-border'}`}>
              <Server className={`w-12 h-12 mx-auto mb-4 ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`} />
              <p className={`text-lg font-medium mb-2 ${isDark ? 'text-text-tertiary' : 'text-text-primary'}`}>
                No MCP servers configured
              </p>
              <p className={`text-sm mb-4 ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                Add your first MCP server to get started
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add MCP Server
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {servers.map(server => (
                <ServerCard key={server.id} server={server} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tools Testing Tab */}
      {activeTab === 'tools' && <ToolTestingPanel />}

      {/* Health Monitoring Tab */}
      {activeTab === 'health' && (
        <div className="space-y-4">
          {/* System Health Overview */}
          <div className={`p-6 rounded-lg border ${isDark ? 'bg-surface/50 border-border-hover' : 'bg-white border-border'}`}>
            <h3 className={`text-lg font-semibold mb-4 flex items-center gap-2 ${isDark ? 'text-white' : 'text-text-primary'}`}>
              <Activity className="w-5 h-5 text-primary-500" />
              System Health Overview
            </h3>
            <div className="grid grid-cols-4 gap-4">
              <div className={`p-4 rounded-lg ${isDark ? 'bg-surface/50' : 'bg-surface-secondary'}`}>
                <p className={`text-sm ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Total Servers</p>
                <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-text-primary'}`}>
                  {servers.length}
                </p>
              </div>
              <div className={`p-4 rounded-lg ${isDark ? 'bg-surface/50' : 'bg-surface-secondary'}`}>
                <p className={`text-sm ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Running</p>
                <p className="text-2xl font-bold ap-text-success">
                  {servers.filter(s => s.status === 'running').length}
                </p>
              </div>
              <div className={`p-4 rounded-lg ${isDark ? 'bg-surface/50' : 'bg-surface-secondary'}`}>
                <p className={`text-sm ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Stopped/Error</p>
                <p className="text-2xl font-bold ap-text-warning">
                  {servers.filter(s => s.status !== 'running').length}
                </p>
              </div>
              <div className={`p-4 rounded-lg ${isDark ? 'bg-surface/50' : 'bg-surface-secondary'}`}>
                <p className={`text-sm ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Total Tools</p>
                <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-text-primary'}`}>
                  {allTools.length}
                </p>
              </div>
            </div>
          </div>

          {/* Per-Server Health */}
          <div className={`rounded-lg border ${isDark ? 'bg-surface/50 border-border-hover' : 'bg-white border-border'} overflow-hidden`}>
            <div className="p-4 border-b border-border-hover">
              <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-text-primary'}`}>
                Server Health Status
              </h3>
            </div>
            <div className="divide-y divide-gray-700">
              {servers.length === 0 ? (
                <div className={`p-8 text-center ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                  <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No servers configured</p>
                </div>
              ) : (
                servers.map(server => (
                  <div key={server.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${
                        server.status === 'running' ? 'bg-success-500' :
                        server.status === 'error' ? 'bg-error-500' : 'bg-surface-secondary0'
                      }`} />
                      <div>
                        <p className={`font-medium ${isDark ? 'text-white' : 'text-text-primary'}`}>
                          {server.name}
                        </p>
                        <p className={`text-xs ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>
                          {server.id}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <p className={`text-xs ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Tools</p>
                        <p className={`font-medium ${isDark ? 'text-text-tertiary' : 'text-text-primary'}`}>
                          {server.toolCount}
                        </p>
                      </div>
                      {server.health && (
                        <>
                          <div className="text-center">
                            <p className={`text-xs ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Uptime</p>
                            <p className={`font-medium ${isDark ? 'text-text-tertiary' : 'text-text-primary'}`}>
                              {Math.floor(server.health.uptime / 60)}m
                            </p>
                          </div>
                          <div className="text-center">
                            <p className={`text-xs ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Response</p>
                            <p className={`font-medium ${isDark ? 'text-text-tertiary' : 'text-text-primary'}`}>
                              {server.health.responseTime}ms
                            </p>
                          </div>
                          <div className="text-center">
                            <p className={`text-xs ${isDark ? 'text-text-secondary' : 'text-text-secondary'}`}>Errors</p>
                            <p className={`font-medium ${server.health.errors > 0 ? 'ap-text-error' : 'ap-text-success'}`}>
                              {server.health.errors}
                            </p>
                          </div>
                        </>
                      )}
                      <StatusBadge status={server.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Server Logs Tab */}
      {activeTab === 'logs' && <ServerLogsPanel servers={servers} isDark={isDark} />}

      {/* Add Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-2xl rounded-lg shadow-xl" style={{ background: 'var(--color-surface)' }}>
            <div className="p-6 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <h3 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
                Add MCP Server
              </h3>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-textSecondary)' }}>
                Server Configuration (JSON)
              </label>
              <textarea
                value={configJson}
                onChange={(e) => setConfigJson(e.target.value)}
                placeholder={`{
  "name": "my-mcp-server",
  "command": ["node", "/path/to/server.js"],
  "env": {
    "API_KEY": "your-api-key"
  },
  "enabled": true
}`}
                rows={12}
                className="w-full px-3 py-2 rounded-lg border font-mono text-sm"
                style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div className="p-6 border-t flex justify-end gap-3" style={{ borderColor: 'var(--color-border)' }}>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setConfigJson('');
                }}
                className="px-4 py-2 rounded-lg transition-colors"
                style={{ background: 'var(--color-surfaceTertiary)', color: 'var(--color-text)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddServer}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
              >
                Add Server
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Server Details Modal */}
      {selectedServer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-4xl rounded-lg shadow-xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--color-surface)' }}>
            <div className="p-6 border-b flex items-start justify-between" style={{ borderColor: 'var(--color-border)' }}>
              <div>
                <h3 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
                  {selectedServer.name}
                </h3>
                <p className="mt-1 text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                  Server Details
                </p>
              </div>
              <button
                onClick={() => setSelectedServer(null)}
                className="p-2 rounded-lg transition-colors hover:opacity-80"
                style={{ background: 'var(--color-surfaceTertiary)' }}
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--color-textSecondary)' }}>
                  Tools ({selectedServer.toolCount})
                </h4>
                <div className="space-y-2">
                  {selectedServer.tools?.map((tool, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg"
                      style={{ background: 'var(--color-surfaceSecondary)' }}
                    >
                      <p className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>
                        {tool.name}
                      </p>
                      <p className="text-xs mt-1" style={{ color: 'var(--color-textSecondary)' }}>
                        {tool.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
