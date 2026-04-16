import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { SharedMarkdownRenderer } from '../MessageContent/SharedMarkdownRenderer';
import {
  Check,
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Globe,
  FileText,
  Code,
  Terminal,
  Edit3,
  Eye,
  Folder,
  XCircle,
  Zap,
  // Rich-summary icons (resolved from RichSummary.icon name)
  Database,
  Brain,
  Cloud,
  Server,
  Lock,
  Coins,
  Shield,
  Cpu,
  HardDrive,
  Bot,
  FileCode,
  Sparkles,
  Image as ImageIcon,
  Search as SearchIcon,
  Package,
  GitBranch,
} from '@/shared/icons';
import ArtifactRenderer from '../MessageContent/ArtifactRenderer';
import ChartRenderer from '../MessageContent/ChartRenderer';
import StreamingArtifactRenderer from '../MessageContent/StreamingArtifactRenderer';
import { detectStreamingArtifact, hasStreamingArtifact } from '../../utils/streamingArtifactDetector';
import { MCPToolRenderer } from './MCPRenderers';
import { CollapsedThinkingBlock, ArtifactErrorBoundary } from '@/shared/components';
import { humanizeToolName, getCategoryColor } from '../../utils/toolNameHumanizer';
import { summarizeToolCall, type ToolSummary, type RichSummary } from '../../utils/toolSummarizer';
import { AgentExecutionTimeline } from '@/features/agents/components/AgentExecutionTimeline';
import type { ExecutionStep } from '@/features/agents/hooks/useAgentPlayground';
import { useAgentTreeStore } from '@/stores/useAgentTreeStore';

import type {
  AgenticActivityStreamProps,
  ToolCall,
  AgenticTask,
  ContentBlock,
  StreamingState,
  ThinkingProgress,
} from './types/activity.types';

// ============================================================================
// Utility Functions
// ============================================================================

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/**
 * Detect if tool output indicates an error (500, 4xx, error messages, etc.)
 * Used to show correct status icon on tool calls even when "complete"
 */
const detectErrorInOutput = (output: unknown): boolean => {
  if (!output) return false;

  // For structured objects, check explicit status fields FIRST.
  // Orchestration results (delegate_to_agents) include agent sub-results whose
  // output may contain HTML, URLs, or other content that accidentally matches
  // error keywords. Trust explicit status fields over regex scanning.
  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>;

    // MCP-style explicit error
    if (obj.error || obj.isError || obj.success === false) {
      return true;
    }

    // Orchestration result with explicit agent statuses — trust them
    const results = (obj as any).results || (obj as any).agents;
    if (Array.isArray(results) && results.length > 0) {
      // If all agents report explicit status, use that instead of regex
      const hasExplicitStatuses = results.every((r: any) => r.status);
      if (hasExplicitStatuses) {
        return results.some((r: any) => r.status === 'error' || r.status === 'failed');
      }
    }
  }

  const outputStr = typeof output === 'string'
    ? output
    : JSON.stringify(output);

  // Skip regex error detection for orchestration JSON that contains agent results
  // with explicit "status":"success" — the embedded HTML/output can false-positive
  if (/"status"\s*:\s*"success"/.test(outputStr) && /"results"\s*:\s*\[/.test(outputStr)) {
    // This looks like an orchestration result with successful agents — trust it
    // Only flag as error if there's an explicit error status in the results
    return /"status"\s*:\s*"(error|failed)"/.test(outputStr);
  }

  // Check for HTTP error status codes
  if (/\b(500|501|502|503|504|400|401|403|404|405|408|422|429)\b/.test(outputStr)) {
    if (/error|failed|failure|exception|status.*(500|4\d\d)|"code":\s*(500|4\d\d)/i.test(outputStr)) {
      return true;
    }
  }

  // Check for error keywords in output
  if (/\b(error|exception|failed|failure|unauthorized|forbidden|not found|timed?\s*out|refused|rejected)\b/i.test(outputStr)) {
    const lowered = outputStr.toLowerCase();
    if (
      lowered.includes('"error"') ||
      lowered.includes("'error'") ||
      lowered.includes('error:') ||
      lowered.includes('failed:') ||
      lowered.includes('exception:') ||
      /status["']?\s*:\s*["']?(error|failed)/i.test(outputStr) ||
      /Internal Server Error/i.test(outputStr)
    ) {
      return true;
    }
  }

  return false;
};

const getToolIcon = (toolName: string): React.ReactNode => {
  const iconProps = { size: 14, strokeWidth: 2 };
  const name = toolName.toLowerCase();

  if (name.includes('search') || name.includes('web')) return <Globe {...iconProps} />;
  if (name.includes('read') || name.includes('view')) return <Eye {...iconProps} />;
  if (name.includes('write') || name.includes('create')) return <FileText {...iconProps} />;
  if (name.includes('edit') || name.includes('modify')) return <Edit3 {...iconProps} />;
  if (name.includes('bash') || name.includes('shell') || name.includes('exec')) return <Terminal {...iconProps} />;
  if (name.includes('glob') || name.includes('grep') || name.includes('find')) return <Folder {...iconProps} />;
  return <Code {...iconProps} />;
};

/**
 * Generate a compact 1-line result summary from tool output.
 *
 * Delegates to the shared per-tool summarizer (toolSummarizer.ts) so every
 * place that renders tool chips (inline chip + grouped activity stream)
 * produces the same text. Web-search results return a links structure that
 * AgenticActivityStream still collapses to a text preview here (the grouped
 * view doesn't render favicons — only the individual chip does).
 */
/**
 * Compute the structured tool summary (text OR links). The richer-shape
 * counterpart to `getCompactSummary` for callers that want to render
 * favicons + clickable URL pills inline (web_search, web_fetch, etc).
 *
 * Why both? Most callsites in this file collapse the summary into a single
 * line of overflow-ellipsised text where rich link rendering would never
 * fit. Only the per-step tree row at the success branch has horizontal
 * room for favicons, so it consumes this structured form. Other callsites
 * stay on the string-flattened `getCompactSummary` to preserve their
 * existing layout assumptions.
 *
 * Closes openagentic-omhs#330 Tier 1 — the favicon URLs were already
 * being computed by `summarizeToolCall` and discarded by the string
 * collapse below; this helper exposes them.
 */
const getStructuredSummary = (toolCall: ToolCall): ToolSummary | null => {
  if (!toolCall.output && !toolCall.input) return null;

  const raw = String(toolCall.status || '');
  const status =
    raw === 'running' ? 'executing' :
    raw === 'success' ? 'completed' :
    raw === 'error' ? 'failed' :
    raw === 'pending' ? 'pending' :
    undefined;

  const looksLikeMcpId = (s?: string) =>
    !!s && /^[a-z][a-z0-9_]+$/i.test(s) && s.includes('_');
  const lookupName =
    (looksLikeMcpId(toolCall.displayName) && toolCall.displayName) ||
    (looksLikeMcpId(toolCall.toolName) && toolCall.toolName) ||
    toolCall.displayName ||
    toolCall.toolName;

  return summarizeToolCall(lookupName, toolCall.input, toolCall.output, status as any);
};

const getCompactSummary = (toolCall: ToolCall): string | null => {
  const summary = getStructuredSummary(toolCall);
  if (!summary) return null;
  if (summary.kind === 'text' && summary.text) return summary.text;
  if (summary.kind === 'links' && summary.items.length > 0) {
    // Grouped view has no room for favicons — collapse to title count + first title
    const first = summary.items[0];
    if (summary.items.length === 1) return first.title;
    return `${summary.items.length} results · ${first.title}`;
  }
  return null;
};

/**
 * Inline render: a compact "icon + headline + badges + items" row for
 * summarizers that return `kind: 'rich'`. Used by RAG retrieval, cloud
 * resource creation, cost queries, agent delegation, etc. Items render
 * as small chips with optional hint tooltips. Designed to fit on the
 * single-line success row alongside the duration timestamp.
 *
 * openagentic-omhs#330 Tier 2.
 */
/** Map a RichSummary.icon name to a component from `@/shared/icons`. */
const RICH_ICON_MAP = {
  database:    Database,
  brain:       Brain,
  cloud:       Cloud,
  package:     Package,
  server:      Server,
  globe:       Globe,
  lock:        Lock,
  coins:       Coins,
  shield:      Shield,
  cpu:         Cpu,
  'hard-drive': HardDrive,
  bot:         Bot,
  terminal:    Terminal,
  'file-code': FileCode,
  sparkles:    Sparkles,
  image:       ImageIcon,
  search:      SearchIcon,
} as const;

const SummaryRich: React.FC<{ summary: RichSummary }> = ({ summary }) => {
  const toneColor = (tone: 'default' | 'success' | 'warn' | 'danger' | 'info' | undefined) => {
    switch (tone) {
      case 'success': return { bg: 'color-mix(in srgb, #16a34a 18%, transparent)', fg: '#16a34a' };
      case 'warn':    return { bg: 'color-mix(in srgb, #d97706 18%, transparent)', fg: '#d97706' };
      case 'danger':  return { bg: 'color-mix(in srgb, #dc2626 18%, transparent)', fg: '#dc2626' };
      case 'info':    return { bg: 'color-mix(in srgb, var(--color-primary) 18%, transparent)', fg: 'var(--color-primary)' };
      default:        return { bg: 'color-mix(in srgb, var(--color-text) 8%, transparent)', fg: 'var(--color-text-secondary)' };
    }
  };
  const IconComp = RICH_ICON_MAP[summary.icon] || Cloud;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, overflow: 'hidden' }}>
      <IconComp size={13} style={{ flexShrink: 0, color: 'var(--color-text-secondary)' }} />
      <span
        style={{
          fontSize: 11,
          color: 'var(--color-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: 500,
          flexShrink: 0,
          maxWidth: '40%',
        }}
      >
        {summary.primary}
      </span>
      {summary.secondary && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            opacity: 0.8,
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          · {summary.secondary}
        </span>
      )}
      {summary.badges?.slice(0, 3).map((b, i) => {
        const c = toneColor(b.tone);
        return (
          <span
            key={i}
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 4,
              background: c.bg,
              color: c.fg,
              flexShrink: 0,
              letterSpacing: '0.2px',
              textTransform: 'uppercase' as const,
            }}
          >
            {b.label}
          </span>
        );
      })}
      {summary.items && summary.items.length > 0 && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 4,
            overflow: 'hidden',
            flexShrink: 1,
            minWidth: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {summary.items.slice(0, 3).map((item, i) => {
            const inner = (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: 'color-mix(in srgb, var(--color-text) 5%, transparent)',
                  color: 'var(--color-text-secondary)',
                  fontSize: 10,
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={item.hint ? `${item.title} — ${item.hint}` : item.title}
              >
                {item.favicon && (
                  <img
                    src={item.favicon}
                    alt=""
                    width={11}
                    height={11}
                    style={{ flexShrink: 0, borderRadius: 2 }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
                {item.badge && (() => {
                  // Per-item status pill (✓ / ✕ / running / etc) — used by
                  // delegate_to_agents to surface sub-agent outcomes at a
                  // glance. openagentic-omhs#330 Tier 4.
                  const c = toneColor(item.badgeTone);
                  return (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '0 4px',
                        borderRadius: 3,
                        background: c.bg,
                        color: c.fg,
                        flexShrink: 0,
                        marginLeft: 2,
                        letterSpacing: '0.2px',
                      }}
                    >
                      {item.badge}
                    </span>
                  );
                })()}
              </span>
            );
            return item.url ? (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                {inner}
              </a>
            ) : (
              <React.Fragment key={i}>{inner}</React.Fragment>
            );
          })}
          {summary.items.length > 3 && (
            <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', opacity: 0.6 }}>
              +{summary.items.length - 3}
            </span>
          )}
        </span>
      )}
    </span>
  );
};

/**
 * Inline render: a compact row of favicon + title pills, one per result
 * URL, opening in a new tab. Used for `summary.kind === 'links'` (web
 * search / web fetch). Defensively limits to 4 pills to keep the
 * single-line summary visually balanced; expanding the step still shows
 * the full result JSON.
 */
const SummaryLinks: React.FC<{ items: Array<{ title: string; url: string; favicon?: string }> }> = ({ items }) => {
  const visible = items.slice(0, 4);
  const overflow = items.length - visible.length;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {visible.map((item, i) => (
        <a
          key={`${item.url}-${i}`}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          title={item.url}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '1px 6px 1px 4px',
            borderRadius: 4,
            background: 'color-mix(in srgb, var(--color-text) 5%, transparent)',
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            fontSize: 11,
            lineHeight: 1.4,
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 1,
          }}
        >
          {item.favicon && (
            <img
              src={item.favicon}
              alt=""
              width={12}
              height={12}
              style={{ flexShrink: 0, borderRadius: 2 }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
        </a>
      ))}
      {overflow > 0 && (
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', opacity: 0.7 }}>
          +{overflow} more
        </span>
      )}
    </span>
  );
};

// ============================================================================
// Status Indicators
// ============================================================================

interface StatusDotProps {
  status: 'pending' | 'running' | 'success' | 'error';
  size?: number;
}

/**
 * Filled circle status indicator:
 * - success: filled green
 * - error: filled red
 * - running: animated spinner
 * - pending: hollow gray dot
 */
const StatusDot: React.FC<StatusDotProps> = memo(({ status, size = 14 }) => {
  if (status === 'running') {
    return <Loader2 size={size} className="animate-spin" style={{ color: 'var(--color-primary)' }} />;
  }
  if (status === 'success') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#2ea043',
        flexShrink: 0,
      }}>
        <Check size={size * 0.6} style={{ color: '#fff' }} />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#da3633',
        flexShrink: 0,
      }}>
        <XCircle size={size * 0.6} style={{ color: '#fff' }} />
      </span>
    );
  }
  // pending
  return (
    <span style={{
      display: 'inline-block',
      width: size * 0.5,
      height: size * 0.5,
      borderRadius: '50%',
      border: '1.5px solid var(--color-text-muted)',
      flexShrink: 0,
    }} />
  );
});

StatusDot.displayName = 'StatusDot';

// ============================================================================
// Category Badge — icon-led pill (icon + category name). Replaces the
// text-only badge so users can scan tool steps by category at a glance
// (☁️ AWS, ☁️ Azure, ⎈ Kubernetes, etc). openagentic-omhs#330.
// ============================================================================

const CATEGORY_ICON_MAP: Record<string, React.FC<any>> = {
  AWS:           Cloud,
  Azure:         Cloud,
  GCP:           Cloud,
  Kubernetes:    Cpu,
  Database:      Database,
  Memory:        Brain,
  Web:           Globe,
  GitHub:        GitBranch,
  Network:       Globe,
  Security:      Shield,
  Monitoring:    Eye,
  Diagrams:      Sparkles,
  Orchestration: Bot,
  Platform:      Server,
  Synth:         Sparkles,
  Tool:          Zap,
};

const CategoryBadge: React.FC<{ category: string; small?: boolean }> = memo(({ category, small }) => {
  const bgColor = getCategoryColor(category);
  const Icon = CATEGORY_ICON_MAP[category] || Zap;
  return (
    <span
      className="activity-category-badge"
      style={{
        background: bgColor,
        fontSize: small ? 9 : 10,
        padding: small ? '1px 5px 1px 4px' : '2px 7px 2px 5px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: small ? 3 : 4,
      }}
    >
      <Icon size={small ? 9 : 11} strokeWidth={2.25} style={{ flexShrink: 0 }} />
      <span>{category}</span>
    </span>
  );
});

CategoryBadge.displayName = 'CategoryBadge';

// ============================================================================
// Inline Thinking Display
// ============================================================================

interface InlineThinkingProps {
  content: string;
  isStreaming?: boolean;
  isComplete?: boolean;
  thinkingProgress?: ThinkingProgress;
}

const ThinkingGlobeIndicator: React.FC<{
  isAnimating: boolean;
  size?: number;
  progress?: number;
  phase?: 'thinking' | 'tools' | 'generating';
  layoutId?: string;
}> = ({ isAnimating, size = 16, progress, phase = 'thinking', layoutId }) => {
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressOffset = progress !== undefined
    ? circumference - (progress / 100) * circumference
    : circumference;

  const phaseColors = {
    thinking: { primary: '#A855F7', glow: 'rgba(168, 85, 247, 0.4)' },
    tools: { primary: '#0A84FF', glow: 'rgba(10, 132, 255, 0.4)' },
    generating: { primary: '#22C55E', glow: 'rgba(34, 197, 94, 0.4)' },
  };
  const colors = phaseColors[phase];

  const containerStyle = { width: size, height: size, position: 'relative' as const, flexShrink: 0 };

  const content = (
    <>
      <svg width={size} height={size} style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="var(--color-border)" strokeWidth={strokeWidth} />
        <circle
          cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={colors.primary} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={progress !== undefined ? progressOffset : 0}
          style={{
            transition: progress !== undefined ? 'stroke-dashoffset 0.3s ease-out' : 'none',
            filter: isAnimating ? `drop-shadow(0 0 2px ${colors.glow})` : 'none',
            animation: isAnimating && progress === undefined ? 'thinking-spin 2s linear infinite' : 'none',
          }}
        />
      </svg>
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: size * 0.5,
        height: size * 0.5,
      }}>
        <img
          src="/think.svg"
          alt="Thinking"
          style={{
            width: '100%',
            height: '100%',
            filter: isAnimating ? `drop-shadow(0 0 2px ${colors.glow})` : 'none',
            animation: isAnimating ? 'thinking-pulse 2s ease-in-out infinite' : 'none',
          }}
        />
      </div>
      <style>{`
        @keyframes thinking-spin { from { stroke-dashoffset: 0; } to { stroke-dashoffset: ${circumference}; } }
        @keyframes thinking-pulse { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.1); } }
      `}</style>
    </>
  );

  if (layoutId) {
    return (
      <motion.div
        layoutId={layoutId}
        style={containerStyle}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {content}
      </motion.div>
    );
  }

  return <div style={containerStyle}>{content}</div>;
};

const InlineThinking: React.FC<InlineThinkingProps> = memo(({
  content,
  isStreaming,
  isComplete,
  thinkingProgress,
}) => {
  const [showFull, setShowFull] = useState(false);
  const layoutId = useMemo(() => `thinking-globe-${Math.random().toString(36).slice(2, 9)}`, []);

  if (!content) return null;

  const shouldShowContent = isStreaming || showFull;
  const preview = content.split('\n')[0].substring(0, 100) + (content.length > 100 ? '...' : '');

  return (
    <LayoutGroup>
      <div
        className="inline-thinking-block"
        style={{
          marginBottom: 8,
          opacity: isComplete && !showFull ? 0.6 : 1,
          transition: 'opacity 0.2s ease',
        }}
      >
        {!shouldShowContent && (
          <button
            onClick={() => setShowFull(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 12,
              width: '100%',
              textAlign: 'left',
            }}
          >
            <ChevronRight size={12} style={{ flexShrink: 0, marginTop: 2 }} />
            <ThinkingGlobeIndicator
              isAnimating={false}
              size={12}
              phase="thinking"
              layoutId={layoutId}
            />
            <span style={{
              fontStyle: 'italic',
              flex: 1,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical' as const,
              lineHeight: '1.4',
              fontSize: 12,
              color: 'var(--color-text-secondary)',
            }}>
              {(() => {
                // Extract first meaningful sentence from thinking content
                // Skip internal reasoning like tool signatures, JSON, code
                const lines = content.split('\n').filter(l => l.trim().length > 10);
                const meaningful = lines.find(l =>
                  !l.includes('signature') && !l.includes('function(') &&
                  !l.includes('{') && !l.includes('args:') && !l.includes('::') &&
                  /[A-Z]/.test(l.charAt(0))
                ) || lines[0] || content.substring(0, 150);
                return meaningful.substring(0, 150) + (meaningful.length > 150 ? '...' : '');
              })()}
            </span>
            {thinkingProgress && (
              <span style={{ flexShrink: 0, fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap' }}>
                ~{(thinkingProgress.tokensUsed / 1000).toFixed(1)}k tokens
              </span>
            )}
          </button>
        )}

        {shouldShowContent && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              padding: '10px 14px',
              background: 'var(--thinking-bg, rgba(139, 92, 246, 0.05))',
              border: '1px solid var(--thinking-border, rgba(139, 92, 246, 0.2))',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 8,
            }}>
              <ThinkingGlobeIndicator
                isAnimating={!!isStreaming}
                size={18}
                progress={thinkingProgress?.percentage}
                phase={thinkingProgress?.phase || 'thinking'}
                layoutId={layoutId}
              />

              <span style={{
                fontWeight: 500,
                fontSize: 13,
                color: isStreaming ? 'var(--color-primary, #A855F7)' : 'var(--color-text-muted)',
              }}>
                {isStreaming ? 'Thinking...' : 'Thought process'}
              </span>

              {isStreaming && thinkingProgress && (
                <span style={{
                  fontSize: 11,
                  color: 'var(--color-primary, #A855F7)',
                  fontWeight: 500,
                }}>
                  {thinkingProgress.percentage.toFixed(0)}%
                </span>
              )}

              {thinkingProgress && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                }}>
                  {thinkingProgress.tokensUsed.toLocaleString()} tokens
                </span>
              )}

              {!isStreaming && (
                <button
                  onClick={() => setShowFull(false)}
                  style={{
                    marginLeft: thinkingProgress ? 8 : 'auto',
                    padding: 2,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  <ChevronDown size={14} />
                </button>
              )}
            </div>

            <pre style={{
              margin: 0,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontStyle: 'italic',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: isStreaming ? 200 : 150,
              overflowY: 'auto',
              lineHeight: 1.6,
              borderLeft: '2px solid var(--thinking-accent, rgba(139, 92, 246, 0.3))',
              paddingLeft: 12,
              opacity: 0.85,
            }}>
              {content}
              {isStreaming && (
                <span className="thinking-cursor" style={{
                  color: 'var(--color-primary, #A855F7)',
                  animation: 'blink 1s infinite',
                  marginLeft: 2,
                }}>|</span>
              )}
            </pre>
            <style>{`
              @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
            `}</style>
          </motion.div>
        )}
      </div>
    </LayoutGroup>
  );
});

InlineThinking.displayName = 'InlineThinking';

// Legacy ThinkingBlock kept for non-interleaved mode (backward compat)
interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
  duration?: number;
  isExpanded: boolean;
  onToggle: () => void;
}

const ThinkingBlock: React.FC<ThinkingBlockProps> = memo(({
  content,
  isStreaming,
  duration,
  isExpanded,
  onToggle
}) => {
  if (!content) return null;

  return (
    <div style={{ marginBottom: 12 }} className="thinking-block-container">
      <button
        onClick={onToggle}
        className="thinking-block-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: isExpanded ? '8px 8px 0 0' : 8,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
        <ThinkingGlobeIndicator isAnimating={!!isStreaming} size={14} phase="thinking" />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          {isStreaming ? 'Reasoning...' : 'Thought process'}
        </span>
        <span style={{ flex: 1 }} />
        {duration && !isStreaming && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {formatDuration(duration)}
          </span>
        )}
      </button>

      {isExpanded && (
        <div
          className="thinking-block-content"
          style={{
            padding: '12px 16px',
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
          }}
        >
          <pre style={{
            margin: 0,
            fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflowY: 'auto',
            lineHeight: 1.6,
          }}>
            {content}
            {isStreaming && (
              <span className="animate-pulse" style={{
                display: 'inline-block',
                width: 2,
                height: 14,
                marginLeft: 2,
                backgroundColor: 'var(--color-primary)',
                verticalAlign: 'text-bottom',
              }} />
            )}
          </pre>
        </div>
      )}
    </div>
  );
});

ThinkingBlock.displayName = 'ThinkingBlock';

// ============================================================================
// Thinking Budget Utilization Badge
// ============================================================================

interface ThinkingBudgetBadgeProps {
  tokensUsed: number;
  tokenBudget: number;
  isStreaming: boolean;
}

const ThinkingBudgetBadge: React.FC<ThinkingBudgetBadgeProps> = memo(({
  tokensUsed,
  tokenBudget,
  isStreaming,
}) => {
  if (isStreaming || tokenBudget <= 0) return null;

  const percentage = Math.min(100, Math.round((tokensUsed / tokenBudget) * 100));
  const formattedUsed = tokensUsed >= 1000
    ? `${(tokensUsed / 1000).toFixed(1)}K`
    : String(tokensUsed);
  const formattedBudget = tokenBudget >= 1000
    ? `${(tokenBudget / 1000).toFixed(0)}K`
    : String(tokenBudget);

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--color-text-muted)',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        marginTop: 4,
        marginBottom: 4,
      }}
    >
      <Zap size={10} style={{ color: percentage > 75 ? 'var(--color-warning, #F97316)' : 'var(--color-text-muted)' }} />
      <span>{formattedUsed}/{formattedBudget} thinking tokens</span>
      <span style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>({percentage}%)</span>
    </motion.div>
  );
});

ThinkingBudgetBadge.displayName = 'ThinkingBudgetBadge';

// ============================================================================
// Tree Step Item - REDESIGNED with left-border, category badge, compact summary
// ============================================================================

interface TreeStepItemProps {
  toolCall: ToolCall;
  isLast: boolean;
  isStreamingDone: boolean;
  childAgents?: ToolCall[];
  depth?: number;
}

const TreeStepItem: React.FC<TreeStepItemProps> = memo(({
  toolCall,
  isLast,
  isStreamingDone,
  childAgents = [],
  depth = 0,
}) => {
  const [showDetail, setShowDetail] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Determine effective status
  const rawStatus = toolCall.status === 'calling' ? 'running' : toolCall.status;
  // If streaming is done and tool is still 'running', it either succeeded silently or failed.
  // Check output for errors; default to 'success' for historical (not 'error' — that shows red X everywhere).
  const effectiveStatus = (rawStatus === 'running' && isStreamingDone)
    ? (detectErrorInOutput(toolCall.output) ? 'error' : 'success')
    : rawStatus;
  const hasError = effectiveStatus === 'error' || detectErrorInOutput(toolCall.output);
  const finalStatus = hasError ? 'error' : effectiveStatus;

  const hasOutput = Boolean(toolCall.output);
  const hasInput = Boolean(toolCall.input);
  const isExpandable = hasOutput || hasInput; // Allow expanding for running tools too
  const isAgentSpawn = toolCall.toolName === 'spawn_parallel_agents';

  // Live elapsed time counter for running tools
  useEffect(() => {
    if (finalStatus !== 'running') return;
    const start = toolCall.startTime || Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [finalStatus, toolCall.startTime]);

  // Humanize the tool name
  const humanized = useMemo(() => humanizeToolName(toolCall.toolName), [toolCall.toolName]);

  // Compact summary — structured form preserves favicon/link items so the
  // success row can render them as pills (web_search, web_fetch). Falls
  // back to the flat string for tools that return text-only summaries.
  const structuredSummary = useMemo(() => getStructuredSummary(toolCall), [toolCall.output, toolCall.toolName]);
  const summary = useMemo(() => getCompactSummary(toolCall), [toolCall.output, toolCall.toolName]);

  // Brief input preview for running tools (e.g. "resourceGroupName: myRG, ...")
  const inputPreview = useMemo(() => {
    if (!toolCall.input || finalStatus !== 'running') return null;
    try {
      const obj = typeof toolCall.input === 'string' ? JSON.parse(toolCall.input) : toolCall.input;
      if (typeof obj === 'object' && obj !== null) {
        const entries = Object.entries(obj);
        if (entries.length === 0) return null;
        // Show first 2 key=value pairs as a compact preview
        const preview = entries.slice(0, 2).map(([k, v]) => {
          const val = typeof v === 'string' ? v : JSON.stringify(v);
          const truncVal = val && val.length > 40 ? val.slice(0, 40) + '...' : val;
          return `${k}: ${truncVal}`;
        }).join(', ');
        return entries.length > 2 ? preview + ` (+${entries.length - 2} more)` : preview;
      }
    } catch { /* ignore */ }
    return null;
  }, [toolCall.input, finalStatus]);

  // Error message extraction
  const errorMessage = useMemo(() => {
    if (!hasError || !toolCall.output) return null;
    const outStr = typeof toolCall.output === 'string'
      ? toolCall.output
      : JSON.stringify(toolCall.output);
    // Extract first line of error
    const match = outStr.match(/(?:error|failed|exception)[:\s]*(.{1,80})/i);
    return match ? match[1].trim() : 'error';
  }, [hasError, toolCall.output]);

  // Formatted output for detail view
  const outputForDetail = useMemo(() => {
    if (!toolCall.output) return null;
    if (typeof toolCall.output === 'string') return toolCall.output;
    return JSON.stringify(toolCall.output, null, 2);
  }, [toolCall.output]);

  // Input for detail view
  const inputForDetail = useMemo(() => {
    if (!toolCall.input) return null;
    if (typeof toolCall.input === 'string') return toolCall.input;
    return JSON.stringify(toolCall.input, null, 2);
  }, [toolCall.input]);

  // CSS class for the step border
  const stepClass = finalStatus === 'running'
    ? 'activity-step activity-step--running'
    : finalStatus === 'error'
      ? 'activity-step activity-step--error'
      : finalStatus === 'success'
        ? 'activity-step activity-step--success'
        : 'activity-step activity-step--pending';

  // Display label — use activeForm during execution for Claude Code-style "Fetching Azure costs..." labels
  const baseLabel = toolCall.agentId
    ? toolCall.agentRole || toolCall.toolName
    : isAgentSpawn && childAgents.length > 0
      ? `Orchestrating ${childAgents.length} agent${childAgents.length !== 1 ? 's' : ''}`
      : humanized.label;
  const displayLabel = finalStatus === 'running' && humanized.activeForm && !toolCall.agentId
    ? humanized.activeForm
    : baseLabel;

  const isAgent = toolCall.agentId || isAgentSpawn;

  // Format elapsed seconds to Xm Ys or Xs
  const elapsedStr = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`;

  return (
    <div style={{ position: 'relative' }}>
      {/* Main step row */}
      <div
        className={stepClass}
        style={{
          paddingTop: depth > 0 ? 2 : 4,
          paddingBottom: depth > 0 ? 2 : 4,
          cursor: isExpandable ? 'pointer' : 'default',
        }}
        onClick={() => isExpandable && setShowDetail(!showDetail)}
        role={isExpandable ? 'button' : undefined}
        tabIndex={isExpandable ? 0 : undefined}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: depth > 0 ? 22 : 26,
        }}>
          {/* Status dot */}
          <StatusDot
            status={finalStatus as 'pending' | 'running' | 'success' | 'error'}
            size={depth > 0 ? 12 : 14}
          />

          {/* Category badge */}
          {!isAgent && (
            <CategoryBadge category={humanized.category} small={depth > 0} />
          )}

          {/* Agent indicator */}
          {isAgent && (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
              color: 'var(--color-primary)',
              border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
            }}>
              Agent
            </span>
          )}

          {/* Tool label */}
          <span style={{
            fontSize: depth > 0 ? 12 : 13,
            fontWeight: 500,
            color: depth > 0 ? 'var(--color-text-secondary)' : 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            maxWidth: finalStatus === 'running' ? '40%' : undefined,
            flex: finalStatus === 'running' ? undefined : 1,
          }}>
            {displayLabel}
          </span>

          {/* Running: show progress message if different from activeForm */}
          {finalStatus === 'running' && toolCall.progressMessage && (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              opacity: 0.8,
            }}>
              {toolCall.progressMessage}
            </span>
          )}

          {/* Completed: show compact result preview inline. Dispatch by
              summary kind so each tool gets the richest representation
              its summarizer produces:
                - 'rich'  → SummaryRich (icon + headline + badges + items)
                - 'links' → SummaryLinks (favicon + title pills)
                - 'text'  → flat text span
              Anything else (kind 'none' or null) renders nothing.
              See openagentic-omhs#330. */}
          {finalStatus === 'success' && structuredSummary?.kind === 'rich' ? (
            <SummaryRich summary={structuredSummary} />
          ) : finalStatus === 'success' && structuredSummary?.kind === 'links' && structuredSummary.items.length > 0 ? (
            <SummaryLinks items={structuredSummary.items} />
          ) : finalStatus === 'success' && summary ? (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              opacity: 0.7,
            }}>
              {summary}
            </span>
          ) : null}

          {/* Compact result summary or error message */}
          {finalStatus === 'error' && errorMessage && (
            <span style={{
              fontSize: 11,
              color: '#da3633',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '30%',
              flexShrink: 1,
            }}>
              {errorMessage}
            </span>
          )}
          {finalStatus === 'success' && summary && (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '30%',
              flexShrink: 1,
            }}>
              {summary}
            </span>
          )}

          {/* Duration / Elapsed timer */}
          <span style={{
            fontSize: depth > 0 ? 10 : 11,
            color: finalStatus === 'error' ? '#da3633' : finalStatus === 'running' ? 'var(--color-primary)' : 'var(--color-text-muted)',
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
            fontWeight: finalStatus === 'running' ? 500 : 400,
          }}>
            {finalStatus === 'running' ? elapsedStr :
             toolCall.duration ? formatDuration(toolCall.duration) : ''}
          </span>

          {/* Expand indicator */}
          {isExpandable && !showDetail && (
            <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
          {showDetail && (
            <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
        </div>
      </div>

      {/* Nested agent children */}
      {childAgents.length > 0 && (
        <div style={{ paddingLeft: 16 }}>
          {childAgents.map((agent, aIdx) => (
            <TreeStepItem
              key={agent.id}
              toolCall={agent}
              isLast={aIdx === childAgents.length - 1}
              isStreamingDone={isStreamingDone}
              depth={depth + 1}
            />
          ))}
        </div>
      )}

      {/* Expanded detail: structured key-value view */}
      {showDetail && (inputForDetail || outputForDetail) && (
        <div className="activity-detail-panel" style={{ marginLeft: 16 }}>
          {inputForDetail && (
            <div style={{ borderBottom: outputForDetail ? '1px solid color-mix(in srgb, var(--color-border) 30%, transparent)' : 'none' }}>
              <div className="activity-detail-panel__section-label">Request</div>
              <pre className="activity-detail-panel__content">
                {inputForDetail.length > 1500 ? inputForDetail.slice(0, 1500) + '\n...' : inputForDetail}
              </pre>
            </div>
          )}
          {outputForDetail && (
            <div>
              <div className="activity-detail-panel__section-label" style={{ color: hasError ? '#da3633' : undefined }}>
                Response
              </div>
              <pre className="activity-detail-panel__content" style={{ color: hasError ? '#da3633' : undefined }}>
                {outputForDetail.length > 2000 ? outputForDetail.slice(0, 2000) + '\n...' : outputForDetail}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

TreeStepItem.displayName = 'TreeStepItem';

// ============================================================================
// Tree Steps Container - REDESIGNED with category chips in collapsed state
// ============================================================================

interface TreeStepsContainerProps {
  toolCalls: ToolCall[];
  isStreaming: boolean;
  totalDuration?: number;
  isHistorical?: boolean;
}

const TreeStepsContainer: React.FC<TreeStepsContainerProps> = memo(({
  toolCalls,
  isStreaming,
  totalDuration,
  isHistorical = false,
}) => {
  const runningCount = toolCalls.filter(t => t.status === 'calling').length;
  const errorCount = toolCalls.filter(t => t.status === 'error' || detectErrorInOutput(t.output)).length;
  const successCount = toolCalls.filter(t => t.status === 'success' && !detectErrorInOutput(t.output)).length;
  const allComplete = runningCount === 0 && !isStreaming;
  // Historical loads (session switch, page reload) ALWAYS start collapsed.
  // Active streaming starts expanded so user can watch progress.
  const [isExpanded, setIsExpanded] = useState(isHistorical ? false : !allComplete);

  // Auto-collapse 300ms after all complete
  useEffect(() => {
    if (allComplete && toolCalls.length > 0) {
      const t = setTimeout(() => setIsExpanded(false), 300);
      return () => clearTimeout(t);
    }
  }, [allComplete, toolCalls.length]);

  // Build grouped category summary for collapsed state: "4x Azure . 3x K8s . 2x Web"
  const categorySummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tc of toolCalls) {
      if (tc.parentToolId) continue; // skip nested
      const h = humanizeToolName(tc.toolName);
      counts[h.category] = (counts[h.category] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count }));
  }, [toolCalls]);

  // Summary icon
  const summaryIcon = errorCount > 0 ? (
    <StatusDot status="error" size={16} />
  ) : allComplete ? (
    <StatusDot status="success" size={16} />
  ) : (
    <StatusDot status="running" size={16} />
  );

  // Summary text
  const stepCount = toolCalls.filter(tc => !tc.parentToolId).length;
  const summaryText = isStreaming
    ? `Running ${stepCount} step${stepCount !== 1 ? 's' : ''}...`
    : `${stepCount} step${stepCount !== 1 ? 's' : ''} completed`;

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Header line */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 0',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {summaryIcon}
        <span style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
        }}>
          {summaryText}
        </span>
        {errorCount > 0 && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#fff',
            background: '#da3633',
            padding: '0 6px',
            borderRadius: 8,
          }}>
            {errorCount} failed
          </span>
        )}
        {!isStreaming && totalDuration != null && totalDuration > 0 && (
          <span style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            ({formatDuration(totalDuration)})
          </span>
        )}
        <span style={{ flex: 1 }} />
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
      </button>

      {/* Collapsed: per-tool one-line summary (Claude Code style) */}
      {!isExpanded && toolCalls.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          paddingLeft: 24,
          paddingBottom: 4,
        }}>
          {toolCalls.filter(tc => !tc.parentToolId).slice(0, 6).map((tc) => {
            const h = humanizeToolName(tc.toolName);
            const sum = getCompactSummary(tc);
            const isErr = tc.status === 'error' || detectErrorInOutput(tc.output);
            return (
              <div key={tc.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--color-text-secondary)',
                lineHeight: '18px',
              }}>
                <StatusDot status={isErr ? 'error' : tc.status === 'calling' ? 'running' : 'success'} size={11} />
                <CategoryBadge category={h.category} small />
                <span style={{ fontWeight: 500, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>{h.label}</span>
                {sum && <span style={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{sum}</span>}
                {tc.duration != null && tc.duration > 0 && (
                  <span style={{ opacity: 0.4, fontSize: 11, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    {formatDuration(tc.duration)}
                  </span>
                )}
              </div>
            );
          })}
          {toolCalls.filter(tc => !tc.parentToolId).length > 6 && (
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', paddingLeft: 17 }}>
              +{toolCalls.filter(tc => !tc.parentToolId).length - 6} more
            </span>
          )}
        </div>
      )}

      {/* Expanded: full step list */}
      {isExpanded && (
        <div style={{ paddingLeft: 4, paddingTop: 2 }}>
          {toolCalls.filter(tc => !tc.parentToolId).map((toolCall, idx, filtered) => {
            const children = toolCall.toolName === 'spawn_parallel_agents'
              ? toolCalls.filter(tc => tc.parentToolId === toolCall.id && tc.agentId)
              : [];
            return (
              <TreeStepItem
                key={toolCall.id}
                toolCall={toolCall}
                isLast={idx === filtered.length - 1}
                isStreamingDone={!isStreaming}
                childAgents={children}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

TreeStepsContainer.displayName = 'TreeStepsContainer';

// ============================================================================
// Grouped Tool Calls - Tree style (consecutive tool_use blocks)
// ============================================================================

interface ToolCallGroupProps {
  blocks: ContentBlock[];
  toolCalls: ToolCall[];
  theme: string;
  isStreaming?: boolean;
  isHistorical?: boolean;
}

/** Tree node for building hierarchical tool call structure */
interface ToolTreeNode {
  block: ContentBlock;
  children: ToolTreeNode[];
}

/** Expandable tool item with category badge, summary, and structured detail */
const ExpandableToolItem: React.FC<{
  block: any;
  toolCall: any;
  isRunning: boolean;
  hasError: boolean;
  isLastRunning: boolean;
  children?: ToolTreeNode[];
  allToolCalls: ToolCall[];
  depth?: number;
  isHistorical?: boolean;
}> = memo(({ block, toolCall, isRunning, hasError, isLastRunning, children = [], allToolCalls, depth = 0, isHistorical = false }) => {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isChildrenOpen, setIsChildrenOpen] = useState(!isHistorical);
  const toolName = block.toolName || toolCall?.toolName || 'Tool';
  const isAgentSpawn = toolName === 'spawn_parallel_agents';
  const isAgentBlock = !!block.agentId;
  const hasChildren = children.length > 0;

  // Humanize
  const humanized = useMemo(() => humanizeToolName(toolName), [toolName]);

  // Compact summary
  const summary = useMemo(() => {
    if (!toolCall) return null;
    return getCompactSummary(toolCall);
  }, [toolCall]);

  // Error message
  const errorMsg = useMemo(() => {
    if (!hasError || !toolCall?.output) return null;
    const outStr = typeof toolCall.output === 'string'
      ? toolCall.output
      : JSON.stringify(toolCall.output);
    const match = outStr.match(/(?:error|failed|exception)[:\s]*(.{1,60})/i);
    return match ? match[1].trim() : 'error';
  }, [hasError, toolCall?.output]);

  // Format tool input/output for display
  const toolInput = toolCall?.input || toolCall?.arguments;
  const toolOutput = toolCall?.output;
  const inputStr = toolInput
    ? (typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput, null, 2))
    : null;
  const outputStr = toolOutput
    ? (typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput, null, 2))
    : null;

  // Determine step status
  const status: 'running' | 'success' | 'error' | 'pending' = isRunning
    ? 'running'
    : hasError
      ? 'error'
      : 'success';

  const stepClass = `activity-step activity-step--${status}`;

  return (
    <div>
      <div
        className={stepClass}
        style={{
          paddingTop: depth > 0 ? 2 : 4,
          paddingBottom: depth > 0 ? 2 : 4,
          cursor: (hasChildren || (!isRunning && (inputStr || outputStr))) ? 'pointer' : 'default',
        }}
        onClick={() => {
          if (hasChildren) {
            setIsChildrenOpen(!isChildrenOpen);
          } else if (!isRunning) {
            setIsDetailOpen(!isDetailOpen);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: depth > 0 ? 22 : 26,
        }}>
          {/* Status */}
          <StatusDot status={status} size={depth > 0 ? 12 : 14} />

          {/* Category badge or Agent badge */}
          {isAgentBlock ? (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
              color: 'var(--color-primary)',
              border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
            }}>
              Agent
            </span>
          ) : isAgentSpawn ? (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
              color: 'var(--color-primary)',
              border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
            }}>
              Orchestration
            </span>
          ) : (
            <CategoryBadge category={humanized.category} small={depth > 0} />
          )}

          {/* Label */}
          <span style={{
            fontSize: depth > 1 ? 12 : 13,
            fontWeight: 500,
            color: depth > 1 ? 'var(--color-text-secondary)' : 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {isAgentBlock
              ? (block.agentRole || toolName)
              : isAgentSpawn
                ? `Delegate to ${children.length} Agent${children.length !== 1 ? 's' : ''}`
                : humanized.label}
          </span>

          {/* Summary or error */}
          {hasError && errorMsg && (
            <span style={{
              fontSize: 11,
              color: '#da3633',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '30%',
              flexShrink: 1,
            }}>
              {errorMsg}
            </span>
          )}
          {!isRunning && !hasError && summary && (
            <span style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '30%',
              flexShrink: 1,
            }}>
              {summary}
            </span>
          )}

          {/* Duration */}
          <span style={{
            fontSize: 11,
            color: hasError ? '#da3633' : 'var(--color-text-muted)',
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
          }}>
            {isRunning ? 'running...' :
             toolCall?.duration ? formatDuration(toolCall.duration) : ''}
          </span>

          {/* Expand indicator */}
          {!isRunning && !hasChildren && (inputStr || outputStr) && (
            isDetailOpen
              ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          )}
          {hasChildren && (
            isChildrenOpen
              ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              : <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                  <ChevronRight size={12} style={{ color: 'var(--color-text-muted)' }} />
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{children.length}</span>
                </span>
          )}
        </div>
      </div>

      {/* Agent streamed content */}
      {isAgentBlock && block.content && block.content.trim() && (isRunning || isDetailOpen || isChildrenOpen) && (
        <div style={{
          marginLeft: 16,
          padding: '4px 10px',
          borderLeft: '2px solid var(--color-border)',
          marginBottom: 4,
          fontSize: 13,
          color: 'var(--color-text-secondary)',
          maxHeight: 200,
          overflowY: 'auto',
        }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit' }}>
            {block.content.length > 2000 ? block.content.slice(0, 2000) + '...' : block.content}
          </pre>
        </div>
      )}

      {/* Nested children */}
      {hasChildren && isChildrenOpen && (
        <div style={{ paddingLeft: 16 }}>
          {children.map((child, cIdx) => {
            const childToolCall = allToolCalls.find(tc => tc.id === child.block.toolId);
            const childHasError = child.block.isComplete ? detectErrorInOutput(childToolCall?.output) : false;
            const childIsRunning = !child.block.isComplete;
            const childIsLast = cIdx === children.length - 1;
            return (
              <ExpandableToolItem
                key={child.block.id}
                block={child.block}
                toolCall={childToolCall}
                isRunning={childIsRunning}
                hasError={childHasError}
                isLastRunning={childIsRunning && childIsLast}
                children={child.children}
                allToolCalls={allToolCalls}
                depth={depth + 1}
                isHistorical={isHistorical}
              />
            );
          })}
        </div>
      )}

      {/* Expandable detail panel */}
      {isDetailOpen && !isRunning && !isAgentBlock && !hasChildren && (
        <div className="activity-detail-panel" style={{ marginLeft: 16 }}>
          {inputStr && (
            <div style={{ borderBottom: outputStr ? '1px solid color-mix(in srgb, var(--color-border) 30%, transparent)' : 'none' }}>
              <div className="activity-detail-panel__section-label">Request</div>
              <pre className="activity-detail-panel__content">
                {inputStr.length > 1000 ? inputStr.slice(0, 1000) + '...' : inputStr}
              </pre>
            </div>
          )}
          {outputStr && (
            <div>
              <div className="activity-detail-panel__section-label" style={{ color: hasError ? '#da3633' : undefined }}>
                Response
              </div>
              <pre className="activity-detail-panel__content" style={{ color: hasError ? '#da3633' : undefined }}>
                {outputStr.length > 2000 ? outputStr.slice(0, 2000) + '...' : outputStr}
              </pre>
            </div>
          )}
          {!inputStr && !outputStr && (
            <div style={{ padding: '8px 12px', color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>No data available</div>
          )}
        </div>
      )}
    </div>
  );
});
ExpandableToolItem.displayName = 'ExpandableToolItem';

const ToolCallGroup: React.FC<ToolCallGroupProps> = memo(({ blocks, toolCalls, theme, isStreaming, isHistorical = false }) => {
  const allComplete = blocks.every(b => b.isComplete);
  // Historical loads ALWAYS start collapsed. Active streaming starts expanded.
  const [isExpanded, setIsExpanded] = useState(isHistorical ? false : !allComplete);

  // Auto-collapse 300ms after all complete
  useEffect(() => {
    if (allComplete) {
      const t = setTimeout(() => setIsExpanded(false), 300);
      return () => clearTimeout(t);
    }
  }, [allComplete]);

  // Build tree structure
  const tree = useMemo((): ToolTreeNode[] => {
    const toolIdSet = new Set(blocks.map(b => b.toolId).filter(Boolean));
    const childMap = new Map<string, ToolTreeNode[]>();
    const roots: ToolTreeNode[] = [];

    for (const block of blocks) {
      const node: ToolTreeNode = { block, children: [] };
      if (block.parentToolId && toolIdSet.has(block.parentToolId)) {
        const siblings = childMap.get(block.parentToolId) || [];
        siblings.push(node);
        childMap.set(block.parentToolId, siblings);
      } else {
        roots.push(node);
      }
    }

    const attachChildren = (node: ToolTreeNode): void => {
      if (node.block.toolId) {
        const children = childMap.get(node.block.toolId);
        if (children) {
          node.children = children;
          children.forEach(attachChildren);
        }
      }
    };
    roots.forEach(attachChildren);
    return roots;
  }, [blocks]);

  const totalCount = blocks.length;
  const errorCount = blocks.filter(b => {
    const tc = toolCalls.find(t => t.id === b.toolId);
    return detectErrorInOutput(tc?.output);
  }).length;

  const totalDuration = blocks.reduce((sum, b) => {
    const tc = toolCalls.find(t => t.id === b.toolId);
    return sum + (tc?.duration || 0);
  }, 0);

  // Category summary for collapsed view
  const categorySummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of blocks) {
      if (b.parentToolId) continue;
      const name = b.toolName || toolCalls.find(tc => tc.id === b.toolId)?.toolName || '';
      const h = humanizeToolName(name);
      counts[h.category] = (counts[h.category] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => ({ category: cat, count }));
  }, [blocks, toolCalls]);

  const summaryIcon = errorCount > 0 ? (
    <StatusDot status="error" size={16} />
  ) : allComplete ? (
    <StatusDot status="success" size={16} />
  ) : (
    <StatusDot status="running" size={16} />
  );

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 0',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {summaryIcon}
        <span style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
        }}>
          {totalCount === 1
            ? (() => {
                const singleTool = blocks[0];
                const singleName = singleTool.toolName || toolCalls.find(tc => tc.id === singleTool.toolId)?.toolName || 'Tool';
                const h = humanizeToolName(singleName);
                return allComplete
                  ? errorCount > 0 ? `${h.label} failed` : h.label
                  : `${h.label}...`;
              })()
            : allComplete
              ? errorCount > 0
                ? `${totalCount} tools completed (${totalCount - errorCount} succeeded, ${errorCount} failed)`
                : `${totalCount} tools completed`
              : `Running ${totalCount} tools...`}
        </span>
        {errorCount > 0 && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#fff',
            background: '#da3633',
            padding: '0 6px',
            borderRadius: 8,
          }}>
            {errorCount} failed
          </span>
        )}
        {totalDuration > 0 && (
          <span style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}>
            ({formatDuration(totalDuration)})
          </span>
        )}
        <span style={{ flex: 1 }} />
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)' }} />
        )}
      </button>

      {/* Collapsed: per-tool one-line summary (Claude Code style) */}
      {!isExpanded && blocks.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          paddingLeft: 24,
          paddingBottom: 4,
        }}>
          {blocks.slice(0, 6).map((block) => {
            const name = block.toolName || 'Tool';
            const h = humanizeToolName(name);
            const tc = toolCalls.find(t => t.id === block.toolId);
            const sum = tc ? getCompactSummary(tc) : null;
            const isErr = block.isComplete && (block.error || (tc && detectErrorInOutput(tc.output)));
            return (
              <div key={block.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--color-text-secondary)',
                lineHeight: '18px',
              }}>
                <StatusDot status={isErr ? 'error' : !block.isComplete ? 'running' : 'success'} size={11} />
                <CategoryBadge category={h.category} small />
                <span style={{ fontWeight: 500, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>{h.label}</span>
                {sum && <span style={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{sum}</span>}
                {block.duration != null && block.duration > 0 && (
                  <span style={{ opacity: 0.4, fontSize: 11, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                    {formatDuration(block.duration)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Expanded: hierarchical step list */}
      {isExpanded && (
        <div style={{ paddingLeft: 4, paddingTop: 2 }}>
          {tree.map((node, idx) => {
            const toolCall = toolCalls.find(tc => tc.id === node.block.toolId);
            const isRunning = !node.block.isComplete && isStreaming !== false;
            const hasError = node.block.isComplete
              ? detectErrorInOutput(toolCall?.output)
              : (!node.block.isComplete && isStreaming === false);
            const isLast = idx === tree.length - 1;

            return (
              <ExpandableToolItem
                key={node.block.id}
                block={node.block}
                toolCall={toolCall}
                isRunning={isRunning}
                hasError={hasError}
                isLastRunning={isRunning && isLast}
                children={node.children}
                allToolCalls={toolCalls}
                depth={0}
                isHistorical={isHistorical}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

ToolCallGroup.displayName = 'ToolCallGroup';

// ============================================================================
// Main Component
// ============================================================================

export const AgenticActivityStream: React.FC<AgenticActivityStreamProps> = ({
  isStreaming,
  streamingState,
  contentBlocks,
  tasks = [],
  toolCalls = [],
  theme = 'dark',
  thinkingProgress,
  onInterrupt,
  className = '',
}) => {
  // Historical = not currently streaming (loaded from session history or page reload)
  const isHistorical = !isStreaming;
  const [isExpanded, setIsExpanded] = useState(!isHistorical);
  const [thinkingExpanded, setThinkingExpanded] = useState(!isHistorical);

  const hasInterleavedContent = useMemo(() => {
    const hasThinking = contentBlocks.some(b => b.type === 'thinking');
    const hasText = contentBlocks.some(b => b.type === 'text');
    const hasToolUse = contentBlocks.some(b => b.type === 'tool_use' || b.type === 'tool_call');
    return hasThinking || hasText || hasToolUse;
  }, [contentBlocks]);

  const thinkingContent = useMemo(() => {
    if (hasInterleavedContent) return '';
    return contentBlocks
      .filter(b => b.type === 'thinking')
      .map(b => b.content)
      .join('\n');
  }, [contentBlocks, hasInterleavedContent]);

  const isThinkingActive = streamingState === 'thinking';

  const totalDuration = useMemo(() => {
    return toolCalls.reduce((sum, t) => sum + (t.duration || 0), 0);
  }, [toolCalls]);

  // Auto-collapse tool details after streaming completes (thinking blocks stay visible)
  useEffect(() => {
    if (!isStreaming && streamingState === 'complete') {
      const timer = setTimeout(() => {
        // Only collapse tool expansion, NOT thinking — thinking blocks should persist
        setIsExpanded(false);
        // setThinkingExpanded(false); // REMOVED: thinking blocks must persist after streaming
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, streamingState]);

  // Nothing to show
  if (toolCalls.length === 0 && !thinkingContent && !hasInterleavedContent) return null;

  // Render a single content block (thinking, text, or tool_use)
  const renderContentBlock = (block: ContentBlock, index: number) => {
    if (block.type === 'thinking') {
      const isLastBlock = index === contentBlocks.length - 1;
      const isActivelyStreaming = isStreaming && isLastBlock && !block.isComplete;
      return (
        <div key={block.id}>
          <CollapsedThinkingBlock
            content={block.content}
            isStreaming={isActivelyStreaming}
            isComplete={block.isComplete}
            progress={isActivelyStreaming && thinkingProgress ? {
              percentage: thinkingProgress.percentage,
              tokensUsed: thinkingProgress.tokensUsed,
              phase: thinkingProgress.phase === 'tools' ? 'processing' : thinkingProgress.phase === 'generating' ? 'complete' : 'thinking',
            } : undefined}
            variant="standard"
            theme="dark"
          />
          {block.isComplete && !isActivelyStreaming && thinkingProgress && thinkingProgress.tokenBudget > 0 && (
            <ThinkingBudgetBadge
              tokensUsed={thinkingProgress.tokensUsed}
              tokenBudget={thinkingProgress.tokenBudget}
              isStreaming={false}
            />
          )}
        </div>
      );
    } else if (block.type === 'text') {
      const blockIsComplete = block.isComplete === true;
      const isLastBlock = index === contentBlocks.length - 1;
      const isActiveTextBlock = isStreaming && isLastBlock && !blockIsComplete;

      // Detect streaming artifacts (HTML, SVG, Mermaid, etc.) for live preview
      if (isActiveTextBlock && block.content && hasStreamingArtifact(block.content)) {
        const artifact = detectStreamingArtifact(block.content);
        if (artifact.isInArtifact && artifact.artifactType) {
          return (
            <div key={block.id} className="interleaved-text-block space-y-4">
              {artifact.contentBefore.trim() && (
                <SharedMarkdownRenderer
                  content={artifact.contentBefore}
                  theme={theme}
                  isStreaming={true}
                />
              )}
              <StreamingArtifactRenderer
                content={artifact.partialContent}
                type={artifact.artifactType}
                theme={theme}
                isStreaming={true}
                height={350}
              />
            </div>
          );
        }
      }

      return (
        <div key={block.id} className="interleaved-text-block">
          <SharedMarkdownRenderer
            content={block.content}
            theme={theme}
            isStreaming={isActiveTextBlock}
          />
        </div>
      );
    } else if (block.type === 'tool_use' || block.type === 'tool_call') {
      const toolCall = toolCalls.find(tc => tc.id === block.toolId);
      const toolName = block.toolName || toolCall?.toolName || 'Tool';
      const hasError = detectErrorInOutput(toolCall?.output);
      const isRunning = !block.isComplete;
      const isAgentBlock = !!(block as any).agentId;
      const agentContent = isAgentBlock ? block.content : null;
      const humanized = humanizeToolName(toolName);
      const summary = toolCall ? getCompactSummary(toolCall) : null;

      const status: 'running' | 'success' | 'error' = isRunning
        ? 'running'
        : hasError
          ? 'error'
          : 'success';

      const stepClass = `activity-step activity-step--${status}`;

      return (
        <div key={block.id}>
          <div
            className={stepClass}
            style={{ paddingTop: 4, paddingBottom: 4 }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 26,
            }}>
              <StatusDot status={status} size={14} />

              {isAgentBlock ? (
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                  color: 'var(--color-primary)',
                  border: '1px solid color-mix(in srgb, var(--color-primary) 30%, transparent)',
                }}>
                  Agent
                </span>
              ) : (
                <CategoryBadge category={humanized.category} />
              )}

              <span style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--color-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}>
                {isAgentBlock ? ((block as any).agentRole || toolName) : humanized.label}
              </span>

              {!isRunning && !hasError && summary && (
                <span style={{
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '30%',
                  flexShrink: 1,
                }}>
                  {summary}
                </span>
              )}

              <span style={{
                fontSize: 11,
                color: hasError ? '#da3633' : 'var(--color-text-muted)',
                flexShrink: 0,
                fontFamily: 'var(--font-mono)',
              }}>
                {isRunning ? 'running...' :
                 hasError ? 'error' :
                 toolCall?.duration ? formatDuration(toolCall.duration) : ''}
              </span>
            </div>
          </div>

          {/* Show agent's streamed content below the agent line */}
          {isAgentBlock && agentContent && agentContent.trim() && (
            <div style={{
              marginLeft: 24,
              padding: '4px 10px',
              borderLeft: '2px solid var(--color-border)',
              marginBottom: 4,
            }}>
              <SharedMarkdownRenderer
                content={agentContent}
                theme={theme}
                isStreaming={isRunning}
              />
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div
      className={className}
      data-theme={theme}
      style={{ marginBottom: 16 }}
    >
      {/* Interrupt button during streaming */}
      {isStreaming && onInterrupt && streamingState !== 'complete' && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: 8,
        }}>
          <button
            onClick={onInterrupt}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid var(--color-border, #333)',
              borderRadius: 6,
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 12,
            }}
          >
            <XCircle size={14} />
            Stop
          </button>
        </div>
      )}

      {/* Interleaved content - render blocks in order like Claude */}
      {hasInterleavedContent ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(() => {
            // Build groups: consecutive tool blocks merge, consecutive thinking blocks merge,
            // agent blocks (with agentId) merge into agent_group, everything else stays solo
            const groups: Array<
              | { type: 'single'; block: ContentBlock; index: number }
              | { type: 'tool_group'; blocks: ContentBlock[]; startIndex: number }
              | { type: 'thinking_group'; blocks: ContentBlock[]; startIndex: number }
              | { type: 'agent_group'; blocks: ContentBlock[]; startIndex: number }
            > = [];
            let i = 0;
            while (i < contentBlocks.length) {
              const block = contentBlocks[i];
              const isToolBlock = block.type === 'tool_use' || block.type === 'tool_call';
              const isAgentBlock = isToolBlock && !!block.agentId;

              if (isAgentBlock) {
                // Collect consecutive agent blocks (blocks with agentId) into an agent_group
                const agentGroup: ContentBlock[] = [block];
                const startIdx = i;
                while (i + 1 < contentBlocks.length) {
                  const next = contentBlocks[i + 1];
                  const nextIsTool = next.type === 'tool_use' || next.type === 'tool_call';
                  if (nextIsTool && !!next.agentId) {
                    i++;
                    agentGroup.push(contentBlocks[i]);
                  } else {
                    break;
                  }
                }
                groups.push({ type: 'agent_group', blocks: agentGroup, startIndex: startIdx });
              } else if (isToolBlock) {
                // ALWAYS group tool blocks — even singles get the collapsed ToolCallGroup treatment
                // This ensures consistent Claude Code-style presentation
                const toolGroup: ContentBlock[] = [block];
                const startIdx = i;
                while (i + 1 < contentBlocks.length && (contentBlocks[i + 1].type === 'tool_use' || contentBlocks[i + 1].type === 'tool_call') && !contentBlocks[i + 1].agentId) {
                  i++;
                  toolGroup.push(contentBlocks[i]);
                }
                groups.push({ type: 'tool_group', blocks: toolGroup, startIndex: startIdx });
              } else if (block.type === 'thinking') {
                // Merge consecutive thinking blocks into one
                const thinkingGroup: ContentBlock[] = [block];
                const startIdx = i;
                while (i + 1 < contentBlocks.length && contentBlocks[i + 1].type === 'thinking') {
                  i++;
                  thinkingGroup.push(contentBlocks[i]);
                }
                groups.push({ type: 'thinking_group', blocks: thinkingGroup, startIndex: startIdx });
              } else {
                groups.push({ type: 'single', block, index: i });
              }
              i++;
            }

            return groups.map((group) => {
              if (group.type === 'agent_group') {
                // Convert agent content blocks into ExecutionStep[] for AgentExecutionTimeline
                const agentSteps: ExecutionStep[] = group.blocks.map((b) => {
                  const tc = toolCalls.find(t => t.id === b.toolId);
                  // Determine step type from block state
                  let stepType: ExecutionStep['type'] = 'agent_start';
                  if (b.toolName && b.toolName !== (b.agentRole || b.agentId)) {
                    // This is a tool call within an agent, not the agent start itself
                    stepType = b.isComplete ? 'tool_result' : 'tool_call';
                  } else if (b.isComplete) {
                    stepType = b.content === 'error' ? 'agent_error' : 'agent_complete';
                  }
                  // For agent_start steps, include the task from the agent tree store
                  let stepData = tc ? { arguments: tc.input, result: tc.output, cost: 0, tokensUsed: 0 } : undefined;
                  if (stepType === 'agent_start' && b.agentId) {
                    // Try to get agent's task from the tree store
                    try {
                      const trees = (window as any).__agentTrees || useAgentTreeStore?.getState?.()?.trees;
                      if (trees) {
                        for (const tree of Object.values(trees) as any[]) {
                          const agent = tree?.agents?.[b.agentId];
                          if (agent?.task) {
                            stepData = { task: agent.task, cost: 0, tokensUsed: 0 } as any;
                            break;
                          }
                        }
                      }
                    } catch {}
                  }
                  return {
                    type: stepType,
                    agentId: b.agentId || '',
                    agentRole: b.agentRole,
                    toolName: b.toolName,
                    data: stepData,
                    timestamp: b.timestamp,
                  };
                });
                const stillExecuting = group.blocks.some(b => !b.isComplete);
                return (
                  <div key={`agent-group-${group.startIndex}`} style={{
                    borderLeft: '2px solid var(--color-primary, #7c4dff)',
                    paddingLeft: 12,
                    marginTop: 4,
                    marginBottom: 4,
                  }}>
                    <AgentExecutionTimeline
                      steps={agentSteps}
                      executing={stillExecuting}
                    />
                  </div>
                );
              }

              if (group.type === 'tool_group') {
                return (
                  <ToolCallGroup
                    key={`tool-group-${group.startIndex}`}
                    blocks={group.blocks}
                    toolCalls={toolCalls}
                    theme={theme}
                    isStreaming={isStreaming}
                    isHistorical={isHistorical}
                  />
                );
              }

              if (group.type === 'thinking_group') {
                // Render each thinking block individually (Claude Code style — each thinking round persists)
                return (
                  <div key={`thinking-group-${group.startIndex}`}>
                    {group.blocks.map((block, blockIdx) => {
                      const globalIdx = group.startIndex + blockIdx;
                      const isLastContentBlock = globalIdx === contentBlocks.length - 1;
                      const isActivelyStreaming = isStreaming && isLastContentBlock && !block.isComplete;
                      const tokenCount = Math.ceil((block.content?.length || 0) / 4);
                      if (!block.content && !isActivelyStreaming) return null;
                      return (
                        <CollapsedThinkingBlock
                          key={block.id || `thinking-${globalIdx}`}
                          content={block.content}
                          isStreaming={isActivelyStreaming}
                          isComplete={!isActivelyStreaming && block.isComplete}
                          tokenCount={tokenCount}
                          variant="standard"
                          theme="dark"
                        />
                      );
                    })}
                  </div>
                );
              }

              const { block, index } = group;
              return renderContentBlock(block, index);
            });
          })()}
        </div>
      ) : (
        /* Legacy: Single merged thinking block */
        thinkingContent && (
          <CollapsedThinkingBlock
            content={thinkingContent}
            isStreaming={isThinkingActive}
            isComplete={!isThinkingActive}
            variant="standard"
            theme="dark"
          />
        )
      )}

      {/* Tree steps container - ONLY show if NOT using interleaved content */}
      {toolCalls.length > 0 && !hasInterleavedContent && (
        <TreeStepsContainer
          toolCalls={toolCalls}
          isStreaming={isStreaming}
          totalDuration={totalDuration}
          isHistorical={isHistorical}
        />
      )}
    </div>
  );
};

export default AgenticActivityStream;
