/**
 * MultiModel Sankey Chart Component
 *
 * Visualizes multi-model orchestration flow showing how requests
 * are processed through Reasoning → Tool Execution → Synthesis stages
 * Uses Recharts Sankey with colorful, interactive visualization
 */

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// Keep X from lucide, use custom for feature icons
import { X } from '@/shared/icons';
import { Zap, TrendingUp, Cpu, Timer, DollarSign, GitBranch } from '../Shared/AdminIcons';
import { Sankey, Tooltip, Layer, Rectangle, ResponsiveContainer } from 'recharts';
import { useTheme } from '../../../../contexts/ThemeContext';

// Multi-model usage data structure from backend
export interface MultiModelUsageData {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  avgDuration: number;
  roleFlow: {
    role: string;
    model: string;
    tokens: number;
    cost: number;
    count: number;
  }[];
  orchestrations: {
    id: string;
    roles: string[];
    models: { role: string; model: string; tokens: number; cost: number }[];
    duration: number;
    complexity: string;
    timestamp: string;
  }[];
}

interface MultiModelSankeyChartProps {
  data: MultiModelUsageData | undefined;
  timeRange: string;
  isModal?: boolean;
  onOpenModal?: () => void;
}

interface SankeyNode {
  name: string;
  displayName?: string;
  tokens?: number;
  cost?: number;
  category?: 'request' | 'role' | 'model' | 'response';
}

interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

// Color palette for different roles and models
const ROLE_COLORS: Record<string, string> = {
  request: 'var(--color-warning)',      // Gold for incoming requests
  reasoning: 'var(--color-primary)',    // Purple for reasoning (Opus)
  tool_execution: 'var(--color-success)', // Green for tool execution (Haiku)
  synthesis: 'var(--accent-info)',      // Blue for synthesis (Sonnet)
  fallback: 'var(--color-error)',       // Red for fallback
  response: 'var(--color-secondary)',   // Pink for final response
};

// Model colors based on provider
const MODEL_COLORS: Record<string, string> = {
  opus: 'var(--color-primary)',
  sonnet: 'var(--accent-info)',
  haiku: 'var(--color-success)',
  gemini: 'var(--color-warning)',
  gpt: 'var(--color-secondary)',
};

// Gradient pairs for links
const GRADIENT_PAIRS = [
  ['var(--color-warning)', 'var(--color-primary)'],      // Request to Reasoning
  ['var(--color-primary)', 'var(--color-success)'],      // Reasoning to Tool Exec
  ['var(--color-success)', 'var(--accent-info)'],        // Tool Exec to Synthesis
  ['var(--accent-info)', 'var(--color-secondary)'],      // Synthesis to Response
  ['var(--color-error)', 'var(--color-secondary)'],      // Fallback to Response
];

// Get color for a model based on its name
const getModelColor = (modelName: string): string => {
  const lower = modelName.toLowerCase();
  if (lower.includes('opus')) return MODEL_COLORS.opus;
  if (lower.includes('sonnet')) return MODEL_COLORS.sonnet;
  if (lower.includes('haiku')) return MODEL_COLORS.haiku;
  if (lower.includes('gemini')) return MODEL_COLORS.gemini;
  if (lower.includes('gpt') || lower.includes('o1')) return MODEL_COLORS.gpt;
  return 'var(--color-textSecondary)';
};

// Format role name for display
const formatRoleName = (role: string): string => {
  const names: Record<string, string> = {
    reasoning: 'Reasoning',
    tool_execution: 'Tool Execution',
    synthesis: 'Synthesis',
    fallback: 'Fallback',
  };
  return names[role] || role;
};

// Custom node component with glow effect
const CustomNode = ({
  x,
  y,
  width,
  height,
  index,
  payload,
  containerWidth,
}: any) => {
  const isOut = x + width + 6 > containerWidth - 180;
  const displayName = payload.displayName || payload.name;
  const tokens = payload.tokens || 0;
  const cost = payload.cost || 0;
  const category = payload.category || 'model';

  // Get color based on category
  const getNodeColor = () => {
    if (category === 'request') return ROLE_COLORS.request;
    if (category === 'response') return ROLE_COLORS.response;
    if (category === 'role') {
      const roleName = payload.name?.replace('role-', '') || '';
      return ROLE_COLORS[roleName] || 'var(--color-textSecondary)';
    }
    // Model nodes - color based on model name
    return getModelColor(displayName);
  };

  const nodeColor = getNodeColor();

  // Truncate long names
  const truncatedName = displayName.length > 20
    ? displayName.substring(0, 17) + '...'
    : displayName;

  // Format tokens for display
  const tokenDisplay = tokens >= 1000000
    ? `${(tokens / 1000000).toFixed(1)}M`
    : tokens >= 1000
    ? `${(tokens / 1000).toFixed(1)}K`
    : tokens.toString();

  return (
    <Layer key={`node-${index}`}>
      {/* Glow effect */}
      <defs>
        <filter id={`mmglow-${index}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <linearGradient id={`mmNodeGradient-${index}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={nodeColor} stopOpacity={1} />
          <stop offset="100%" stopColor={nodeColor} stopOpacity={0.7} />
        </linearGradient>
      </defs>

      {/* Node rectangle with gradient and glow */}
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={`url(#mmNodeGradient-${index})`}
        rx={4}
        ry={4}
        filter={`url(#mmglow-${index})`}
        style={{
          transition: 'all 0.3s ease',
          cursor: 'pointer'
        }}
      />

      {/* Node label */}
      <text
        textAnchor={isOut ? 'end' : 'start'}
        x={isOut ? x - 8 : x + width + 8}
        y={y + height / 2 - 6}
        fontSize="12"
        fontWeight="600"
        fill="var(--color-text)"
        dominantBaseline="middle"
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          textShadow: '0 1px 2px color-mix(in srgb, black 50%, transparent)'
        }}
      >
        {truncatedName}
      </text>

      {/* Token count label */}
      <text
        textAnchor={isOut ? 'end' : 'start'}
        x={isOut ? x - 8 : x + width + 8}
        y={y + height / 2 + 8}
        fontSize="10"
        fill={nodeColor}
        dominantBaseline="middle"
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 500
        }}
      >
        {tokens > 0 ? `${tokenDisplay} tokens` : cost > 0 ? `$${cost.toFixed(2)}` : ''}
      </text>
    </Layer>
  );
};

// Custom link with gradient
const CustomLink = (props: any) => {
  const {
    sourceX,
    targetX,
    sourceY,
    targetY,
    sourceControlX,
    targetControlX,
    linkWidth,
    index,
  } = props;

  const gradientColors = GRADIENT_PAIRS[index % GRADIENT_PAIRS.length];
  const gradientId = `mmLinkGradient-${index}-${Date.now()}`;

  return (
    <Layer key={`mmlink-${index}`}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={gradientColors[0]} stopOpacity={0.6} />
          <stop offset="50%" stopColor={gradientColors[1]} stopOpacity={0.4} />
          <stop offset="100%" stopColor={gradientColors[1]} stopOpacity={0.6} />
        </linearGradient>
      </defs>
      <path
        d={`
          M${sourceX},${sourceY}
          C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}
        `}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={Math.max(linkWidth, 2)}
        strokeOpacity={0.8}
        style={{
          transition: 'stroke-width 0.3s ease, stroke-opacity 0.3s ease',
          cursor: 'pointer'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.strokeOpacity = '1';
          e.currentTarget.style.strokeWidth = `${Math.max(linkWidth * 1.2, 3)}`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.strokeOpacity = '0.8';
          e.currentTarget.style.strokeWidth = `${Math.max(linkWidth, 2)}`;
        }}
      />
    </Layer>
  );
};

export const MultiModelSankeyChart: React.FC<MultiModelSankeyChartProps> = ({
  data,
  timeRange,
  isModal = false,
  onOpenModal,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Theme colors using CSS variables
  const colors = useMemo(() => ({
    background: 'var(--color-background)',
    cardBg: 'var(--color-surface)',
    glassBg: 'var(--color-surfaceSecondary)',
    border: 'var(--color-border)',
    textPrimary: 'var(--color-text)',
    textSecondary: 'var(--color-textSecondary)',
    textMuted: 'var(--color-textMuted)',
    accent: 'var(--color-primary)',
  }), []);

  // Build Sankey data structure for multi-model flow
  const sankeyData = useMemo(() => {
    if (!data || !data.roleFlow || data.roleFlow.length === 0) {
      return { nodes: [], links: [] };
    }

    const nodes: SankeyNode[] = [];
    const links: SankeyLink[] = [];
    const nodeIndex: Map<string, number> = new Map();

    // Helper to add node if not exists
    const addNode = (
      name: string,
      displayName: string,
      tokens: number,
      cost: number,
      category: 'request' | 'role' | 'model' | 'response'
    ): number => {
      if (!nodeIndex.has(name)) {
        nodeIndex.set(name, nodes.length);
        nodes.push({ name, displayName, tokens, cost, category });
      }
      return nodeIndex.get(name)!;
    };

    // Calculate totals
    const totalTokens = data.roleFlow.reduce((sum, r) => sum + r.tokens, 0);
    const totalCost = data.roleFlow.reduce((sum, r) => sum + r.cost, 0);

    // Add request source node
    const requestIdx = addNode('request', `Requests (${data.totalRequests})`, totalTokens, totalCost, 'request');

    // Group roleFlow by role
    const roleGroups = new Map<string, typeof data.roleFlow>();
    for (const rf of data.roleFlow) {
      const existing = roleGroups.get(rf.role) || [];
      existing.push(rf);
      roleGroups.set(rf.role, existing);
    }

    // Define role order for flow
    const roleOrder = ['reasoning', 'tool_execution', 'synthesis', 'fallback'];
    const processedRoles: string[] = [];

    // Add role nodes and connect to request
    for (const role of roleOrder) {
      const roleData = roleGroups.get(role);
      if (!roleData || roleData.length === 0) continue;

      const roleTokens = roleData.reduce((sum, r) => sum + r.tokens, 0);
      const roleCost = roleData.reduce((sum, r) => sum + r.cost, 0);
      const roleCount = roleData.reduce((sum, r) => sum + r.count, 0);

      if (roleTokens === 0 && roleCount === 0) continue;

      const roleIdx = addNode(
        `role-${role}`,
        `${formatRoleName(role)} (${roleCount})`,
        roleTokens,
        roleCost,
        'role'
      );

      // Link from request or previous role
      const sourceIdx = processedRoles.length === 0
        ? requestIdx
        : nodeIndex.get(`role-${processedRoles[processedRoles.length - 1]}`) || requestIdx;

      links.push({
        source: sourceIdx,
        target: roleIdx,
        value: Math.max(roleTokens, 1) // Ensure non-zero value for visibility
      });

      // Add model nodes for this role
      for (const rf of roleData) {
        if (rf.tokens === 0 && rf.count === 0) continue;

        const modelIdx = addNode(
          `model-${role}-${rf.model}`,
          rf.model,
          rf.tokens,
          rf.cost,
          'model'
        );

        links.push({
          source: roleIdx,
          target: modelIdx,
          value: Math.max(rf.tokens, 1)
        });
      }

      processedRoles.push(role);
    }

    // Add response node and link from last role's models
    if (processedRoles.length > 0) {
      const responseIdx = addNode('response', 'Response', 0, 0, 'response');
      const lastRole = processedRoles[processedRoles.length - 1];
      const lastRoleData = roleGroups.get(lastRole) || [];

      for (const rf of lastRoleData) {
        const modelNodeName = `model-${lastRole}-${rf.model}`;
        const modelIdx = nodeIndex.get(modelNodeName);
        if (modelIdx !== undefined && rf.tokens > 0) {
          links.push({
            source: modelIdx,
            target: responseIdx,
            value: Math.max(rf.tokens, 1)
          });
        }
      }
    }

    return { nodes, links };
  }, [data]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const nodeData = payload[0]?.payload?.payload || payload[0]?.payload || {};
      const tokens = nodeData.tokens || 0;
      const cost = nodeData.cost || 0;
      const displayName = nodeData.displayName || nodeData.name || 'Flow';

      return (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            background: colors.glassBg,
            backdropFilter: 'blur(12px)',
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            padding: '14px 18px',
            boxShadow: 'var(--color-shadow)',
            minWidth: '180px'
          }}
        >
          <p style={{
            color: colors.textPrimary,
            fontWeight: 700,
            fontSize: '14px',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <Cpu size={14} style={{ color: colors.accent }} />
            {displayName}
          </p>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            {tokens > 0 && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ color: colors.textSecondary, fontSize: '12px' }}>Tokens:</span>
                <span style={{
                  color: colors.accent,
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: 'monospace'
                }}>
                  {tokens.toLocaleString()}
                </span>
              </div>
            )}
            {cost > 0 && (
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ color: colors.textSecondary, fontSize: '12px' }}>Cost:</span>
                <span style={{
                  color: 'var(--color-success)',
                  fontSize: '13px',
                  fontWeight: 600
                }}>
                  ${cost.toFixed(3)}
                </span>
              </div>
            )}
          </div>
        </motion.div>
      );
    }
    return null;
  };

  // Format numbers for display
  const formatTokens = (num: number): string => {
    if (num >= 1000000000) return `${(num / 1000000000).toFixed(2)}B`;
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  // If no data
  if (!data || !data.roleFlow || data.roleFlow.length === 0 || sankeyData.nodes.length === 0) {
    return (
      <div
        className="rounded-xl p-4"
        style={{
          background: colors.cardBg,
          border: `1px solid ${colors.border}`,
          backdropFilter: 'blur(8px)'
        }}
      >
        <h3
          className="text-sm font-medium mb-4 flex items-center gap-2"
          style={{ color: colors.textSecondary }}
        >
          <GitBranch size={16} />
          Multi-Model Orchestration
        </h3>
        <div
          className="flex flex-col items-center justify-center py-8 gap-3"
          style={{ color: colors.textMuted }}
        >
          <Cpu size={32} style={{ opacity: 0.4 }} />
          <p className="text-sm">No multi-model orchestration data available</p>
          <p className="text-xs">Multi-model mode activates for complex queries with intelligence slider &gt; 70%</p>
        </div>
      </div>
    );
  }

  // Inline chart (non-modal)
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: colors.cardBg,
        border: `1px solid ${colors.border}`,
        backdropFilter: 'blur(8px)'
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3
          className={`text-sm font-medium flex items-center gap-2 ${onOpenModal ? 'cursor-pointer hover:underline' : ''}`}
          style={{ color: colors.textSecondary }}
          onClick={onOpenModal}
          title={onOpenModal ? "Click for detailed view" : undefined}
        >
          <GitBranch size={16} style={{ color: colors.accent }} />
          Multi-Model Orchestration Flow
          {onOpenModal && (
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                color: colors.accent
              }}
            >
              Click to explore
            </span>
          )}
        </h3>
        <div className="flex items-center gap-4 text-xs" style={{ color: colors.textMuted }}>
          <span className="flex items-center gap-1">
            <Zap size={12} /> {data.totalRequests} requests
          </span>
          <span className="flex items-center gap-1">
            <DollarSign size={12} /> ${data.totalCost.toFixed(2)}
          </span>
          <span className="flex items-center gap-1">
            <Timer size={12} /> {(data.avgDuration / 1000).toFixed(1)}s avg
          </span>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total Tokens', value: formatTokens(data.totalTokens), color: ROLE_COLORS.request },
          { label: 'Reasoning', value: data.roleFlow.filter(r => r.role === 'reasoning').reduce((s, r) => s + r.count, 0), color: ROLE_COLORS.reasoning },
          { label: 'Tool Exec', value: data.roleFlow.filter(r => r.role === 'tool_execution').reduce((s, r) => s + r.count, 0), color: ROLE_COLORS.tool_execution },
          { label: 'Synthesis', value: data.roleFlow.filter(r => r.role === 'synthesis').reduce((s, r) => s + r.count, 0), color: ROLE_COLORS.synthesis },
        ].map((stat) => (
          <div
            key={stat.label}
            className="text-center p-2 rounded-lg"
            style={{ background: 'color-mix(in srgb, var(--color-text) 3%, transparent)' }}
          >
            <div
              className="text-lg font-bold"
              style={{ color: stat.color }}
            >
              {stat.value}
            </div>
            <div className="text-xs" style={{ color: colors.textMuted }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Sankey Chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={sankeyData}
            node={<CustomNode containerWidth={800} />}
            link={<CustomLink />}
            nodePadding={24}
            nodeWidth={10}
            margin={{ top: 10, right: 180, bottom: 10, left: 10 }}
            sort={false}
          >
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: colors.accent, strokeWidth: 2, strokeOpacity: 0.3 }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-3 flex-wrap">
        {[
          { label: 'Reasoning', color: ROLE_COLORS.reasoning },
          { label: 'Tool Exec', color: ROLE_COLORS.tool_execution },
          { label: 'Synthesis', color: ROLE_COLORS.synthesis },
          { label: 'Fallback', color: ROLE_COLORS.fallback },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{
                background: item.color,
                boxShadow: `0 0 6px ${item.color}50`
              }}
            />
            <span className="text-xs" style={{ color: colors.textSecondary }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MultiModelSankeyChart;
