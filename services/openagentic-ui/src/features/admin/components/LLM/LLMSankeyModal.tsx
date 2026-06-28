/**
 * LLM Sankey Modal Component
 *
 * Stunning interactive Sankey diagram showing LLM token usage flow
 * Uses Recharts with custom styling for a dazzling visualization
 */

import React, { useMemo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// Keep X from lucide, use custom for feature icons
import { X } from '@/shared/icons';
import { Zap, TrendingUp } from '../Shared/AdminIcons';
import { Sankey, Tooltip, Layer, Rectangle, ResponsiveContainer } from 'recharts';
import { useTheme } from '../../../../contexts/ThemeContext';

interface ModelUsageData {
  model: string;
  count: number;
  tokens: number;
  cost: number;
}

interface LLMSankeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  modelUsage: ModelUsageData[];
  timeRange: string;
}

interface SankeyNode {
  name: string;
  displayName?: string;
  tokens?: number;
  category?: 'total' | 'provider' | 'model';
}

interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

// Color palette using CSS variables - no hardcoded colors
const COLORS = {
  anthropic: 'var(--color-warning)',     // Amber for Anthropic
  openai: 'var(--color-success)',        // Emerald for OpenAI
  google: 'var(--accent-info)',          // Blue for Google
  azure: 'var(--color-secondary)',       // Sky for Azure
  openSource: 'var(--color-primary)',    // Purple for Open Source
  other: 'var(--accent-info)',           // Indigo for Other
  total: 'var(--color-warning)',         // Golden for Total
};

// Gradient pairs using CSS variables
const GRADIENT_COLORS = [
  ['var(--color-warning)', 'var(--color-error)'],      // Gold to Red
  ['var(--color-primary)', 'var(--color-secondary)'],  // Purple to Pink
  ['var(--accent-info)', 'var(--color-secondary)'],    // Blue to Cyan
  ['var(--color-success)', 'var(--color-success)'],    // Emerald to Lime
  ['var(--color-warning)', 'var(--color-warning)'],    // Orange to Yellow
  ['var(--accent-info)', 'var(--color-primary)'],      // Indigo to Violet
];

// Custom node component with glow effect
const CustomNode = ({
  x,
  y,
  width,
  height,
  index,
  payload,
  containerWidth,
  isDark
}: any) => {
  const isOut = x + width + 6 > containerWidth - 180;
  const displayName = payload.displayName || payload.name;
  const tokens = payload.tokens || 0;
  const category = payload.category || 'model';

  // Get color based on category/provider
  const getNodeColor = () => {
    if (category === 'total') return COLORS.total;
    if (displayName === 'Anthropic') return COLORS.anthropic;
    if (displayName === 'OpenAI') return COLORS.openai;
    if (displayName === 'Google') return COLORS.google;
    if (displayName === 'Azure') return COLORS.azure;
    if (displayName === 'Open Source') return COLORS.openSource;
    if (category === 'provider') return COLORS.other;

    // Model colors based on provider detection
    const lower = displayName.toLowerCase();
    if (lower.includes('claude') || lower.includes('opus') || lower.includes('sonnet') || lower.includes('haiku')) return COLORS.anthropic;
    if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3')) return COLORS.openai;
    if (lower.includes('gemini')) return COLORS.google;
    return GRADIENT_COLORS[index % GRADIENT_COLORS.length][0];
  };

  const nodeColor = getNodeColor();
  const glowColor = nodeColor;

  // Truncate long names
  const truncatedName = displayName.length > 22
    ? displayName.substring(0, 19) + '...'
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
        <filter id={`glow-${index}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <linearGradient id={`nodeGradient-${index}`} x1="0%" y1="0%" x2="100%" y2="100%">
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
        fill={`url(#nodeGradient-${index})`}
        rx={4}
        ry={4}
        filter={`url(#glow-${index})`}
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
          fontFamily: 'var(--font-body)',
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
          fontFamily: 'var(--font-body)',
          fontWeight: 500
        }}
      >
        {tokenDisplay} tokens
      </text>
    </Layer>
  );
};

// Custom link with gradient — gradientId is DETERMINISTIC (was
// `linkGradient-${index}-${Date.now()}` which forced a new <defs>
// every render, causing the gradient to flicker on hover/resize and
// orphaning <linearGradient> nodes in the SVG. Stable id keys to
// (index + source + target) so React reconciliation reuses the
// existing <defs> entry.
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
    payload,
  } = props;

  const gradientColors = GRADIENT_COLORS[index % GRADIENT_COLORS.length];
  const stableKey =
    payload && typeof payload.source === 'number' && typeof payload.target === 'number'
      ? `${payload.source}-${payload.target}`
      : `idx-${index}`;
  const gradientId = `linkGradient-${stableKey}`;

  // Guard: if Sankey hands us a NaN width (single-node degenerate
  // graphs) clamp to a visible 2px so the user still sees the link.
  const safeWidth = Number.isFinite(linkWidth) && linkWidth > 0 ? linkWidth : 2;

  return (
    <Layer key={`link-${stableKey}`}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={gradientColors[0]} stopOpacity={0.6} />
          <stop offset="50%" stopColor={gradientColors[1]} stopOpacity={0.4} />
          <stop offset="100%" stopColor={gradientColors[0]} stopOpacity={0.6} />
        </linearGradient>
      </defs>
      <path
        d={`
          M${sourceX},${sourceY}
          C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}
        `}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={Math.max(safeWidth, 2)}
        strokeOpacity={0.8}
        style={{
          transition: 'stroke-width 0.3s ease, stroke-opacity 0.3s ease',
          cursor: 'pointer'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.strokeOpacity = '1';
          e.currentTarget.style.strokeWidth = `${Math.max(safeWidth * 1.2, 3)}`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.strokeOpacity = '0.8';
          e.currentTarget.style.strokeWidth = `${Math.max(safeWidth, 2)}`;
        }}
      />
    </Layer>
  );
};

// Build the sankey graph data from a flat ModelUsageData[]. Exported
// so the inline dashboard sankey card can call it with the same shape
// the modal uses, no logic divergence.
//
// Value selection: prefers tokens (the natural unit for an LLM flow
// diagram). If every row has tokens === 0 but request counts are
// present, falls back to using count — operators still see a sankey
// shape that encodes relative volume, instead of a degenerate empty
// graph that the host then replaces with a bar list. The user wants
// a sankey, always.
export function buildSankeyData(modelUsage: ModelUsageData[]): {
  nodes: SankeyNode[]
  links: SankeyLink[]
} {
  if (!modelUsage || modelUsage.length === 0) {
    return { nodes: [], links: [] }
  }
  const allTokensZero = modelUsage.every((m) => (m.tokens ?? 0) <= 0)
  const valueOf = (m: ModelUsageData) =>
    allTokensZero ? (m.count ?? 0) : (m.tokens ?? 0)
  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []
  const nodeIndex: Map<string, number> = new Map()
  const addNode = (name: string, displayName: string, value: number, category: 'total' | 'provider' | 'model') => {
    if (!nodeIndex.has(name)) {
      nodeIndex.set(name, nodes.length)
      nodes.push({ name, displayName, tokens: value, category })
    }
    return nodeIndex.get(name)!
  }
  const providerGroups: { [key: string]: ModelUsageData[] } = {}
  modelUsage.forEach((m) => {
    let provider = 'Other'
    const ml = m.model.toLowerCase()
    if (ml.includes('claude') || ml.includes('anthropic') || ml.includes('opus') || ml.includes('sonnet') || ml.includes('haiku')) provider = 'Anthropic'
    else if (ml.includes('gpt') || ml.includes('o1') || ml.includes('o3') || ml.includes('openai') || ml.includes('chatgpt')) provider = 'OpenAI'
    else if (ml.includes('gemini') || ml.includes('google') || ml.includes('palm') || ml.includes('bard')) provider = 'Google'
    else if (ml.includes('llama') || ml.includes('mistral') || ml.includes('mixtral') || ml.includes('qwen') || ml.includes('deepseek') || ml.includes('phi')) provider = 'Open Source'
    else if (ml.includes('azure')) provider = 'Azure'
    if (!providerGroups[provider]) providerGroups[provider] = []
    providerGroups[provider].push(m)
  })
  const totalValue = modelUsage.reduce((s, m) => s + valueOf(m), 0)
  const rootLabel = allTokensZero ? 'Total Request Flow' : 'Total Token Flow'
  const rootIdx = addNode('total-tokens', rootLabel, totalValue, 'total')
  Object.entries(providerGroups)
    .sort((a, b) => b[1].reduce((s, m) => s + valueOf(m), 0) - a[1].reduce((s, m) => s + valueOf(m), 0))
    .forEach(([provider, models]) => {
      const providerValue = models.reduce((s, m) => s + valueOf(m), 0)
      if (providerValue > 0) {
        const providerIdx = addNode(`provider-${provider}`, provider, providerValue, 'provider')
        links.push({ source: rootIdx, target: providerIdx, value: providerValue })
        models
          .sort((a, b) => valueOf(b) - valueOf(a))
          .forEach((m) => {
            const v = valueOf(m)
            if (v > 0) {
              const modelIdx = addNode(`model-${m.model}`, m.model, v, 'model')
              links.push({ source: providerIdx, target: modelIdx, value: v })
            }
          })
      }
    })
  return { nodes, links }
}

// Number formatter shared between modal + inline sankey.
export function formatTokensCompact(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toLocaleString()
}

/**
 * SankeyChartHost — renders the actual Sankey OR a graceful fallback.
 *
 * Three cases handled:
 *   1. modelUsage empty / nodes empty → empty state with copy
 *   2. nodes present but every link value === 0 → fallback bar list
 *      (recharts Sankey throws on all-zero links; this keeps the
 *      modal from going blank)
 *   3. healthy data → full Sankey diagram with measured width so node
 *      labels flip side correctly at any viewport
 *
 * Width is measured via ResizeObserver on the container ref. The
 * CustomNode reads `containerWidth` from the prop passed in here, so
 * label `isOut` math is now actually correct.
 */
export const SankeyChartHost: React.FC<{
  modelUsage: ModelUsageData[]
  sankeyData: { nodes: SankeyNode[]; links: SankeyLink[] }
  colors: any
  isDark: boolean
  formatTokens: (n: number) => string
  /** Override the default 480px modal-sized height for inline use. */
  height?: number
  /** Hide the outer padding for inline embedding. */
  flush?: boolean
}> = ({ modelUsage, sankeyData, colors, isDark, formatTokens, height = 480, flush = false }) => {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = React.useState(1100)

  React.useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  // The sankey can't render meaningfully when:
  //   - there are no links at all (single root node — happens when all
  //     models have tokens=0 because the provider loop skips zero-total
  //     providers, leaving only the synthetic root)
  //   - every link has a zero/negative value (recharts crashes)
  // In either case we drop to the per-model fallback bar list so the
  // modal NEVER goes blank.
  const noSankeyPossible =
    sankeyData.links.length === 0 ||
    sankeyData.links.every((l) => !l.value || l.value <= 0)

  // Case 1: nothing to show at all (no models in window)
  if (modelUsage.length === 0 || sankeyData.nodes.length === 0) {
    return (
      <div className={flush ? 'relative' : 'px-8 py-6 relative'} style={{ height }}>
        <div
          className="flex flex-col items-center justify-center h-full gap-4"
          style={{ color: colors.textSecondary }}
        >
          <Zap size={48} style={{ opacity: 0.3 }} />
          <p>No token usage data available for the selected time range</p>
        </div>
      </div>
    )
  }

  // Case 2: sankey can't render (sparse / all-zero / single-node) —
  // fall back to a per-model bar list so the modal never goes blank.
  if (noSankeyPossible) {
    // Use tokens as the primary metric; if every row has tokens=0 but
    // there ARE requests, fall back to using the request count so the
    // bars still encode relative volume (rather than rendering a row
    // of all-zero-width bars that look identical).
    const allTokensZero = modelUsage.every((m) => (m.tokens ?? 0) <= 0)
    const useRequests = allTokensZero
    const valueOf = (m: ModelUsageData) =>
      useRequests ? (m.count ?? 0) : (m.tokens ?? 0)

    const sorted = [...modelUsage]
      .filter((m) => valueOf(m) > 0)
      .sort((a, b) => valueOf(b) - valueOf(a))

    if (sorted.length === 0) {
      return (
        <div className={flush ? 'relative' : 'px-8 py-6 relative'} style={{ height }}>
          <div className="flex flex-col items-center justify-center h-full gap-4" style={{ color: colors.textSecondary }}>
            <Zap size={48} style={{ opacity: 0.3 }} />
            <p>Models present but no token or request activity in the selected window</p>
          </div>
        </div>
      )
    }

    const max = sorted.reduce((m, r) => Math.max(m, valueOf(r)), 0) || 1
    return (
      <div className={flush ? 'relative' : 'px-8 py-6 relative'} style={{ height, overflow: 'auto' }}>
        <div style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 12 }}>
          token-flow detail (
          {useRequests
            ? 'showing per-model REQUEST counts — token telemetry returned 0 for every row in this window'
            : 'showing per-model TOKEN totals — sankey requires multi-edge non-zero data to render'}
          )
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sorted.map((m) => {
            const v = valueOf(m)
            const pct = (v / max) * 100
            return (
              <div key={m.model} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: '0 0 200px', color: colors.textPrimary, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {m.model}
                </span>
                <div style={{ flex: 1, height: 14, background: 'color-mix(in srgb, var(--color-text) 5%, transparent)', borderRadius: 2, position: 'relative', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, var(--color-primary), var(--color-secondary))',
                      transition: 'width .3s ease',
                    }}
                  />
                </div>
                <span style={{ flex: '0 0 90px', textAlign: 'right', color: colors.textSecondary, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {useRequests ? `${v} req` : formatTokens(v)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Case 3: healthy sankey
  return (
    <div ref={ref} className="px-8 py-6 relative" style={{ height: '480px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={sankeyData}
          node={<CustomNode isDark={isDark} containerWidth={width} />}
          link={<CustomLink />}
          nodePadding={30}
          nodeWidth={12}
          margin={{ top: 20, right: 220, bottom: 20, left: 20 }}
          sort={false}
        />
      </ResponsiveContainer>
    </div>
  )
}

export const LLMSankeyModal: React.FC<LLMSankeyModalProps> = ({
  isOpen,
  onClose,
  modelUsage,
  timeRange
}) => {
  const { resolvedTheme, accentColor } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [hoveredNode, setHoveredNode] = useState<any>(null);

  // Theme colors using CSS variables - no hardcoded colors
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

  // Build Sankey data structure for token flow
  const sankeyData = useMemo(() => {
    if (!modelUsage || modelUsage.length === 0) {
      return { nodes: [], links: [] };
    }

    const nodes: SankeyNode[] = [];
    const links: SankeyLink[] = [];
    const nodeIndex: Map<string, number> = new Map();

    // Helper to add node if not exists
    const addNode = (name: string, displayName: string, tokens: number, category: 'total' | 'provider' | 'model'): number => {
      if (!nodeIndex.has(name)) {
        nodeIndex.set(name, nodes.length);
        nodes.push({ name, displayName, tokens, category });
      }
      return nodeIndex.get(name)!;
    };

    // Group models by provider
    const providerGroups: { [key: string]: ModelUsageData[] } = {};

    modelUsage.forEach(m => {
      let provider = 'Other';
      const modelLower = m.model.toLowerCase();

      if (modelLower.includes('claude') || modelLower.includes('anthropic') || modelLower.includes('opus') || modelLower.includes('sonnet') || modelLower.includes('haiku')) {
        provider = 'Anthropic';
      } else if (modelLower.includes('gpt') || modelLower.includes('o1') || modelLower.includes('o3') || modelLower.includes('openai') || modelLower.includes('chatgpt')) {
        provider = 'OpenAI';
      } else if (modelLower.includes('gemini') || modelLower.includes('google') || modelLower.includes('palm') || modelLower.includes('bard')) {
        provider = 'Google';
      } else if (modelLower.includes('llama') || modelLower.includes('mistral') || modelLower.includes('mixtral') || modelLower.includes('qwen') || modelLower.includes('deepseek') || modelLower.includes('phi')) {
        provider = 'Open Source';
      } else if (modelLower.includes('azure')) {
        provider = 'Azure';
      }

      if (!providerGroups[provider]) {
        providerGroups[provider] = [];
      }
      providerGroups[provider].push(m);
    });

    // Calculate total tokens
    const totalTokens = modelUsage.reduce((sum, m) => sum + m.tokens, 0);

    // Add root node
    const rootIdx = addNode('total-tokens', 'Total Token Flow', totalTokens, 'total');

    // Level 1: Total -> Providers
    Object.entries(providerGroups)
      .sort((a, b) => {
        const aTokens = a[1].reduce((sum, m) => sum + m.tokens, 0);
        const bTokens = b[1].reduce((sum, m) => sum + m.tokens, 0);
        return bTokens - aTokens;
      })
      .forEach(([provider, models]) => {
        const providerTokens = models.reduce((sum, m) => sum + m.tokens, 0);
        if (providerTokens > 0) {
          const providerIdx = addNode(`provider-${provider}`, provider, providerTokens, 'provider');
          links.push({
            source: rootIdx,
            target: providerIdx,
            value: providerTokens
          });

          // Level 2: Provider -> Models (sorted by tokens)
          models
            .sort((a, b) => b.tokens - a.tokens)
            .forEach(m => {
              if (m.tokens > 0) {
                const modelIdx = addNode(`model-${m.model}`, m.model, m.tokens, 'model');
                links.push({
                  source: providerIdx,
                  target: modelIdx,
                  value: m.tokens
                });
              }
            });
        }
      });

    return { nodes, links };
  }, [modelUsage]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Calculate summary stats
  const totalTokens = modelUsage.reduce((sum, m) => sum + m.tokens, 0);
  const totalRequests = modelUsage.reduce((sum, m) => sum + m.count, 0);
  const totalCost = modelUsage.reduce((sum, m) => sum + m.cost, 0);

  // Custom tooltip with detailed info
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const nodeData = data.payload || data;
      const tokens = nodeData.tokens || data.value || 0;
      const displayName = nodeData.displayName || nodeData.name || 'Flow';

      // Calculate percentage of total
      const percentage = totalTokens > 0 ? ((tokens / totalTokens) * 100).toFixed(1) : '0';

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
            <Zap size={14} style={{ color: colors.accent }} />
            {displayName}
          </p>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
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
                fontFamily: 'var(--font-mono)'
              }}>
                {tokens.toLocaleString()}
              </span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ color: colors.textSecondary, fontSize: '12px' }}>Share:</span>
              <span style={{
                color: colors.textPrimary,
                fontSize: '13px',
                fontWeight: 600
              }}>
                {percentage}%
              </span>
            </div>
          </div>
        </motion.div>
      );
    }
    return null;
  };

  // Format numbers
  const formatTokens = (num: number): string => {
    if (num >= 1000000000) return `${(num / 1000000000).toFixed(2)}B`;
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{
            backdropFilter: 'blur(8px)',
            backgroundColor: 'color-mix(in srgb, black 70%, transparent)'
          }}
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 30 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 30 }}
            transition={{
              duration: 0.3,
              ease: [0.16, 1, 0.3, 1] // Custom spring-like easing
            }}
            className="relative w-[96vw] max-w-6xl max-h-[92vh] overflow-hidden rounded-2xl"
            style={{
              background: colors.cardBg,
              border: `1px solid ${colors.border}`,
              boxShadow: 'var(--color-shadow)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Decorative gradient orbs */}
            <div
              className="absolute -top-32 -right-32 w-64 h-64 rounded-full opacity-20 blur-3xl pointer-events-none"
              style={{ background: `radial-gradient(circle, ${COLORS.anthropic}, transparent)` }}
            />
            <div
              className="absolute -bottom-32 -left-32 w-64 h-64 rounded-full opacity-20 blur-3xl pointer-events-none"
              style={{ background: `radial-gradient(circle, ${COLORS.openai}, transparent)` }}
            />

            {/* Header */}
            <div
              className="relative flex items-center justify-between px-8 py-5"
              style={{
                borderBottom: `1px solid ${colors.border}`,
                background: 'color-mix(in srgb, var(--color-background) 50%, transparent)'
              }}
            >
              <div className="flex items-center gap-4">
                <motion.div
                  animate={{
                    boxShadow: [
                      `0 0 20px ${colors.accent}40`,
                      `0 0 40px ${colors.accent}60`,
                      `0 0 20px ${colors.accent}40`
                    ]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="p-3 rounded-xl"
                  style={{ background: `${colors.accent}20` }}
                >
                  <Zap size={24} style={{ color: colors.accent }} />
                </motion.div>
                <div>
                  <h2
                    className="text-2xl font-bold tracking-tight"
                    style={{ color: colors.textPrimary }}
                  >
                    Token Usage Flow
                  </h2>
                  <p className="text-sm mt-0.5 flex items-center gap-2" style={{ color: colors.textSecondary }}>
                    <TrendingUp size={14} />
                    {timeRange} • {modelUsage.length} models across {Object.keys(
                      modelUsage.reduce((acc, m) => {
                        const lower = m.model.toLowerCase();
                        let provider = 'Other';
                        if (lower.includes('claude') || lower.includes('opus') || lower.includes('sonnet') || lower.includes('haiku')) provider = 'Anthropic';
                        else if (lower.includes('gpt') || lower.includes('o1')) provider = 'OpenAI';
                        else if (lower.includes('gemini')) provider = 'Google';
                        acc[provider] = true;
                        return acc;
                      }, {} as Record<string, boolean>)
                    ).length} providers
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2.5 rounded-xl transition-all hover:scale-105"
                style={{
                  color: colors.textSecondary,
                  background: 'color-mix(in srgb, var(--color-text) 5%, transparent)'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Summary Stats */}
            <div
              className="grid grid-cols-4 gap-6 px-8 py-5"
              style={{
                borderBottom: `1px solid ${colors.border}`,
                background: 'color-mix(in srgb, var(--color-background) 10%, transparent)'
              }}
            >
              {[
                { label: 'Active Models', value: modelUsage.length, color: COLORS.anthropic },
                { label: 'Total Tokens', value: formatTokens(totalTokens), color: COLORS.total, isMain: true },
                { label: 'Total Requests', value: formatNumber(totalRequests), color: COLORS.openai },
                { label: 'Total Cost', value: `$${totalCost.toFixed(2)}`, color: COLORS.google },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="text-center p-4 rounded-xl"
                  style={{
                    background: stat.isMain
                      ? `linear-gradient(135deg, ${stat.color}15, ${stat.color}05)`
                      : 'transparent',
                    border: stat.isMain ? `1px solid ${stat.color}30` : 'none'
                  }}
                >
                  <div
                    className="text-3xl font-bold"
                    style={{
                      color: stat.color,
                      textShadow: stat.isMain ? `0 0 30px ${stat.color}40` : 'none'
                    }}
                  >
                    {stat.value}
                  </div>
                  <div className="text-xs mt-1 font-medium" style={{ color: colors.textSecondary }}>
                    {stat.label}
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Chart Container — measured width via ref so CustomNode
                can flip label-side based on actual rendered space (was
                hardcoded 1100, which mis-positioned labels at any
                viewport != 1100px wide).

                Sparse-data guard: if there are nodes but every link
                is zero (recharts Sankey crashes on 0-value links),
                skip the Sankey and render a fallback bar list so the
                chart "always works" per the user's mandate. */}
            <SankeyChartHost
              modelUsage={modelUsage}
              sankeyData={sankeyData}
              colors={colors}
              isDark={isDark}
              formatTokens={formatTokens}
            />
            {/* (host renders empty-state OR sankey OR fallback bar) */}

            {/* Footer Legend */}
            <div
              className="flex items-center justify-between px-8 py-4"
              style={{
                borderTop: `1px solid ${colors.border}`,
                background: 'color-mix(in srgb, var(--color-background) 20%, transparent)'
              }}
            >
              <div className="flex items-center gap-6">
                {[
                  { label: 'Total', color: COLORS.total },
                  { label: 'Anthropic', color: COLORS.anthropic },
                  { label: 'OpenAI', color: COLORS.openai },
                  { label: 'Google', color: COLORS.google },
                  { label: 'Open Source', color: COLORS.openSource },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{
                        background: item.color,
                        boxShadow: `0 0 8px ${item.color}60`
                      }}
                    />
                    <span className="text-xs font-medium" style={{ color: colors.textSecondary }}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-xs" style={{ color: colors.textMuted }}>
                Hover over flows for detailed token counts
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default LLMSankeyModal;
