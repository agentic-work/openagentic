/**
 * Prompt Metrics Component
 * Displays which prompts/templates/injections are used per chat session
 * Shows system prompts, templates, and MCP context injections
 */

import React, { useState, useEffect, useCallback } from 'react';
// Keep basic/UI icons from lucide
import {
  FileText, MessageSquare, User, Calendar,
  ChevronDown, ChevronUp, Sparkles, Hash, Check, X
} from '@/shared/icons';
// Custom badass icons
import { Database, Timer as Clock } from '../Shared/AdminIcons';
import { AdminMetricCard } from '../Shared/AdminMetricCard';
import { AdminFilterBar } from '../Shared/AdminFilterBar';
import { InfoTooltip } from '../Shared/AdminTooltip';
import { AdminCard } from '../Shared/AdminCard';
import { CHART_COLORS } from '../Shared/chartColors';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import { apiRequest } from '@/utils/api';

// ── Helper components ─────────────────────────────────────────────────

const ChartTip: React.FC<{ active?: boolean; payload?: any[]; label?: string }> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        backgroundColor: 'var(--color-surfaceSecondary)',
        border: '1px solid var(--color-border)',
        color: 'var(--text-primary)',
      }}
    >
      <div className="font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || p.fill }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-semibold">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

const SectionHead: React.FC<{ icon: React.ReactNode; title: string; tip?: string }> = ({ icon, title, tip }) => (
  <div className="flex items-center gap-2 mb-4">
    <span style={{ color: 'var(--color-primary)' }}>{icon}</span>
    <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
    {tip && <InfoTooltip content={tip} />}
  </div>
);

// ── Interfaces ────────────────────────────────────────────────────────

interface PromptMetricsProps {
  theme: string;
}

interface PromptMetricData {
  id: string;
  sessionId: string;
  messageId?: string;
  userId: string;
  userName: string;
  userEmail: string;
  timestamp: string;

  // Template information
  baseTemplateId?: number;
  baseTemplateName?: string;
  domainTemplateId?: number;
  domainTemplateName?: string;

  // System prompt
  systemPrompt?: string;
  systemPromptLength?: number;

  // Techniques
  appliedTechniques: string[];
  tokensAdded: number;

  // Context injections
  hasFormatting: boolean;
  hasMcpContext: boolean;
  hasRAG: boolean;
  hasMemory: boolean;
  hasAzureSdkDocs: boolean;

  // Context counts
  ragDocsCount: number;
  ragChatsCount: number;
  memoryCount: number;
  mcpToolsCount: number;

  // Metadata
  metadata?: Record<string, any>;
}

interface AggregateStats {
  totalRequests: number;
  uniqueSessions: number;
  uniqueUsers: number;
  totalPrompts: number;
  mostUsedTechniques: Array<{ technique: string; count: number }>;
  avgTokensAdded: number;
  avgSystemPromptLength: number;

  // Template stats
  baseTemplatesUsed: number;
  domainTemplatesUsed: number;
  mostUsedBaseTemplate?: [string, number];
  mostUsedDomainTemplate?: [string, number];

  // Context injection stats
  formattingInjections: number;
  mcpContextInjections: number;
  ragContextInjections: number;
  memoryContextInjections: number;
  azureSdkDocsInjections: number;

  // Average context counts
  avgRagDocsCount: number;
  avgRagChatsCount: number;
  avgMemoryCount: number;
  avgMcpToolsCount: number;
}

// ══════════════════════════════════════════════════════════════════════

const PromptMetrics: React.FC<PromptMetricsProps> = ({ theme }) => {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<PromptMetricData[]>([]);
  const [aggregateStats, setAggregateStats] = useState<AggregateStats | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState('7d');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTechnique, setFilterTechnique] = useState('all');

  const fetchPromptMetrics = useCallback(async () => {
    try {
      setLoading(true);

      const response = await apiRequest(`/api/admin/analytics/prompt-metrics?timeRange=${timeRange}`);

      if (response.ok) {
        const data = await response.json();
        setMetrics(data.metrics || []);
        setAggregateStats(data.aggregate || null);
      }
    } catch (error) {
      console.error('Failed to fetch prompt metrics:', error);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchPromptMetrics();
  }, [fetchPromptMetrics]);

  // Filter metrics based on search and technique filter
  const filteredMetrics = metrics.filter(metric => {
    const matchesSearch = searchTerm === '' ||
      metric.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      metric.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
      metric.sessionId.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesTechnique = filterTechnique === 'all' ||
      metric.appliedTechniques.includes(filterTechnique);

    return matchesSearch && matchesTechnique;
  });

  // Get all unique techniques for filter dropdown
  const allTechniques = Array.from(
    new Set(metrics.flatMap(m => m.appliedTechniques))
  ).sort((a, b) => a.localeCompare(b));

  const formatNumber = (num: number) => {
    return num.toLocaleString('en-US');
  };

  // ── Chart data ────────────────────────────────────────────────────

  const techniqueChartData = aggregateStats?.mostUsedTechniques.map(t => ({
    name: t.technique.length > 18 ? t.technique.slice(0, 16) + '...' : t.technique,
    fullName: t.technique,
    count: t.count,
  })) || [];

  const contextInjectionData = aggregateStats ? [
    { name: 'Formatting', value: aggregateStats.formattingInjections },
    { name: 'MCP', value: aggregateStats.mcpContextInjections },
    { name: 'RAG', value: aggregateStats.ragContextInjections },
    { name: 'Memory', value: aggregateStats.memoryContextInjections },
    { name: 'Azure SDK', value: aggregateStats.azureSdkDocsInjections },
  ].filter(d => d.value > 0) : [];

  const totalInjections = contextInjectionData.reduce((s, d) => s + d.value, 0);

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        <span className="ml-4 text-lg text-text-secondary">Loading prompt metrics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + Filter Bar */}
      <div>
        <h2 className="text-3xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
          Prompt Metrics
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Track which prompts, templates, and injections are used per chat session
        </p>

        <AdminFilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          onRefresh={fetchPromptMetrics}
          refreshing={loading}
          extraFilters={
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Technique:</span>
              <select
                value={filterTechnique}
                onChange={(e) => setFilterTechnique(e.target.value)}
                className="px-2.5 py-1.5 rounded-md text-xs outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="all">All Techniques</option>
                {allTechniques.map(tech => (
                  <option key={tech} value={tech}>{tech}</option>
                ))}
              </select>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {filteredMetrics.length} session{filteredMetrics.length !== 1 ? 's' : ''}
              </span>
            </div>
          }
        />
      </div>

      {/* Aggregate Statistics - AdminMetricCard grid */}
      {aggregateStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <AdminMetricCard
            label="Total Requests"
            value={formatNumber(aggregateStats.totalRequests)}
            subtext={`Across ${formatNumber(aggregateStats.uniqueSessions)} sessions`}
            icon={<MessageSquare size={18} />}
            tooltip="Total number of prompt-instrumented requests in this time range"
          />
          <AdminMetricCard
            label="Unique Users"
            value={formatNumber(aggregateStats.uniqueUsers)}
            icon={<User size={18} />}
            tooltip="Distinct users who triggered prompt instrumentation"
          />
          <AdminMetricCard
            label="Templates Used"
            value={formatNumber(aggregateStats.domainTemplatesUsed)}
            subtext="Domain templates"
            icon={<FileText size={18} />}
            tooltip="Number of distinct domain templates applied to prompts"
          />
          <AdminMetricCard
            label="Avg Tokens Added"
            value={formatNumber(Math.round(aggregateStats.avgTokensAdded))}
            icon={<Sparkles size={18} />}
            tooltip="Average number of tokens injected into prompts (templates, context, techniques)"
          />
        </div>
      )}

      {/* Charts row */}
      {aggregateStats && (techniqueChartData.length > 0 || contextInjectionData.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Technique Distribution Bar Chart */}
          {techniqueChartData.length > 0 && (
            <AdminCard>
              <SectionHead
                icon={<Sparkles size={16} />}
                title="Technique Distribution"
                tip="How often each prompt engineering technique is applied across all requests"
              />
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <BarChart
                    data={techniqueChartData}
                    margin={{ top: 8, right: 12, left: 0, bottom: 40 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--color-border)' }}
                      angle={-35}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis
                      tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <RechartsTooltip
                      content={<ChartTip />}
                      cursor={{ fill: 'var(--color-border)', opacity: 0.3 }}
                    />
                    <Bar dataKey="count" name="Uses" radius={[4, 4, 0, 0]} maxBarSize={48}>
                      {techniqueChartData.map((_, idx) => (
                        <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </AdminCard>
          )}

          {/* Context Injection Pie Chart */}
          {contextInjectionData.length > 0 && (
            <AdminCard>
              <SectionHead
                icon={<Database size={16} />}
                title="Context Injection Breakdown"
                tip="Distribution of context sources injected into prompts (formatting, MCP tools, RAG docs, memory, Azure SDK)"
              />
              <div className="flex items-center" style={{ height: 280 }}>
                <div style={{ width: '60%', height: '100%' }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={contextInjectionData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                        nameKey="name"
                        strokeWidth={0}
                      >
                        {contextInjectionData.map((_, idx) => (
                          <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend */}
                <div className="flex-1 space-y-2 pl-2">
                  {contextInjectionData.map((d, idx) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                      />
                      <span style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                      <span className="ml-auto font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {d.value}
                      </span>
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        ({totalInjections > 0 ? Math.round((d.value / totalInjections) * 100) : 0}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </AdminCard>
          )}
        </div>
      )}

      {/* Session Rows */}
      <AdminCard>
        <SectionHead
          icon={<MessageSquare size={16} />}
          title="Session Details"
          tip="Expandable rows showing per-session prompt instrumentation data"
        />

        {filteredMetrics.length === 0 ? (
          <div className="py-12 text-center">
            <FileText size={40} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>No prompt metrics found for the selected filters</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredMetrics.map((metric) => (
              <div
                key={metric.sessionId}
                className="rounded-lg transition-all duration-150"
                style={{
                  backgroundColor: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {/* Row header */}
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-4 mb-3">
                        <div className="flex items-center gap-3 flex-1">
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)' }}
                          >
                            <MessageSquare size={18} style={{ color: 'var(--color-primary)' }} />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                              {metric.userName}
                            </h3>
                            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {metric.userEmail}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => setExpandedSessionId(expandedSessionId === metric.sessionId ? null : metric.sessionId)}
                          className="p-1.5 rounded-md transition-colors"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {expandedSessionId === metric.sessionId ? (
                            <ChevronUp size={18} />
                          ) : (
                            <ChevronDown size={18} />
                          )}
                        </button>
                      </div>

                      {/* Quick Stats Row */}
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                        <div>
                          <p className="text-xs mb-0.5 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                            <Hash size={12} />
                            Session ID
                          </p>
                          <p className="text-xs font-mono font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={metric.sessionId}>
                            {metric.sessionId.substring(0, 8)}...
                          </p>
                        </div>
                        <div>
                          <p className="text-xs mb-0.5 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                            <Calendar size={12} />
                            Timestamp
                          </p>
                          <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                            {new Date(metric.timestamp).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-xs mb-0.5 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                            <FileText size={12} />
                            Templates Used
                          </p>
                          <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                            {metric.baseTemplateName && (
                              <span
                                className="inline-block px-1.5 py-0.5 rounded text-xs mr-1.5"
                                style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)', color: 'var(--color-primary)' }}
                              >
                                Base: {metric.baseTemplateName}
                              </span>
                            )}
                            {metric.domainTemplateName && (
                              <span
                                className="inline-block px-1.5 py-0.5 rounded text-xs"
                                style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)', color: 'var(--color-success)' }}
                              >
                                Domain: {metric.domainTemplateName}
                              </span>
                            )}
                            {!metric.baseTemplateName && !metric.domainTemplateName && 'N/A'}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs mb-0.5 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                            <Clock size={12} />
                            Tokens Added
                          </p>
                          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{metric.tokensAdded || 0}</p>
                        </div>
                        <div>
                          <p className="text-xs mb-0.5 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                            <MessageSquare size={12} />
                            Prompt Length
                          </p>
                          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{formatNumber(metric.systemPromptLength || 0)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedSessionId === metric.sessionId && (
                  <div className="px-4 pb-4 space-y-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                    <div className="pt-3" />

                    {/* System Prompt */}
                    {metric.systemPrompt && (
                      <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-surface)' }}>
                        <h4 className="text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                          <FileText size={14} />
                          System Prompt
                        </h4>
                        <div className="rounded p-3 max-h-40 overflow-y-auto" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                          <pre className="text-xs whitespace-pre-wrap font-mono" style={{ color: 'var(--text-primary)' }}>
                            {metric.systemPrompt}
                          </pre>
                        </div>
                      </div>
                    )}

                    {/* Applied Techniques */}
                    {metric.appliedTechniques && metric.appliedTechniques.length > 0 && (
                      <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-surface)' }}>
                        <h4 className="text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                          <Sparkles size={14} />
                          Applied Techniques
                        </h4>
                        <div className="flex flex-wrap gap-1.5">
                          {metric.appliedTechniques.map((technique, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-1 rounded-full text-xs font-medium"
                              style={{
                                backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
                                color: 'var(--color-primary)',
                              }}
                            >
                              {technique}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Injections & Context */}
                    <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-surface)' }}>
                      <h4 className="text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Database size={14} />
                        Context Injections
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        <div className="rounded p-2.5" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Formatting</p>
                          <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                            {metric.hasFormatting ? (
                              <Check size={18} style={{ color: 'var(--color-success)' }} />
                            ) : (
                              <X size={18} style={{ color: 'var(--color-error)' }} />
                            )}
                          </p>
                        </div>
                        <div className="rounded p-2.5" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>MCP Context</p>
                          <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                            {metric.hasMcpContext ? (
                              <Check size={18} style={{ color: 'var(--color-success)' }} />
                            ) : (
                              <X size={18} style={{ color: 'var(--color-error)' }} />
                            )}
                          </p>
                          {metric.mcpToolsCount > 0 && (
                            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{metric.mcpToolsCount} tools</p>
                          )}
                        </div>
                        <div className="rounded p-2.5" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>RAG Context</p>
                          <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                            {metric.hasRAG ? (
                              <Check size={18} style={{ color: 'var(--color-success)' }} />
                            ) : (
                              <X size={18} style={{ color: 'var(--color-error)' }} />
                            )}
                          </p>
                          {metric.ragDocsCount > 0 && (
                            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                              {metric.ragDocsCount} docs, {metric.ragChatsCount} chats
                            </p>
                          )}
                        </div>
                        <div className="rounded p-2.5" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Memory</p>
                          <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                            {metric.hasMemory ? (
                              <Check size={18} style={{ color: 'var(--color-success)' }} />
                            ) : (
                              <X size={18} style={{ color: 'var(--color-error)' }} />
                            )}
                          </p>
                          {metric.memoryCount > 0 && (
                            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{metric.memoryCount} items</p>
                          )}
                        </div>
                        <div className="rounded p-2.5" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                          <p className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>Azure SDK Docs</p>
                          <p className="font-bold" style={{ color: 'var(--text-primary)' }}>
                            {metric.hasAzureSdkDocs ? (
                              <Check size={18} style={{ color: 'var(--color-success)' }} />
                            ) : (
                              <X size={18} style={{ color: 'var(--color-error)' }} />
                            )}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Message ID */}
                    {metric.messageId && (
                      <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-surface)' }}>
                        <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Message ID</h4>
                        <p className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>{metric.messageId}</p>
                      </div>
                    )}

                    {/* Additional Metadata */}
                    {metric.metadata && Object.keys(metric.metadata).length > 0 && (
                      <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-surface)' }}>
                        <h4 className="text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                          <Database size={14} />
                          Additional Metadata
                        </h4>
                        <pre
                          className="text-xs rounded p-3 overflow-auto max-h-40"
                          style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--text-primary)' }}
                        >
                          {JSON.stringify(metric.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </AdminCard>
    </div>
  );
};

export default PromptMetrics;
