/**
 * AgenticActivityStream — status / category indicators.
 *
 * Extracted verbatim from AgenticActivityStream.tsx (behavior-preserving):
 * StatusDot (filled status circle / spinner), CategoryBadge (icon-led pill)
 * and the legacy getToolIcon helper.
 */
import React, { memo } from 'react';
import {
  Check,
  Loader2,
  XCircle,
  Globe,
  FileText,
  Code,
  Terminal,
  Edit3,
  Eye,
  Folder,
  Zap,
  Database,
  Brain,
  Cloud,
  Server,
  Shield,
  Cpu,
  Bot,
  GitBranch,
  Book,
  Sparkles,
  type LucideIcon,
} from '@/shared/icons';
import { getCategoryColor } from '../../utils/toolNameHumanizer';

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
export const StatusDot: React.FC<StatusDotProps> = memo(({ status, size = 14 }) => {
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
        background: 'var(--cm-success)',
        flexShrink: 0,
      }}>
        <Check size={size * 0.6} style={{ color: 'var(--cm-bg)' }} />
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
        background: 'var(--cm-error)',
        flexShrink: 0,
      }}>
        <XCircle size={size * 0.6} style={{ color: 'var(--cm-bg)' }} />
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
// (☁️ AWS, ☁️ Azure, ⎈ Kubernetes, etc). openagentic#330.
// ============================================================================

const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  AWS:           Cloud,
  Azure:         Cloud,
  GCP:           Cloud,
  Kubernetes:    Cpu,
  Database:      Database,
  Knowledge:     Book,
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

export const CategoryBadge: React.FC<{ category: string; small?: boolean }> = memo(({ category, small }) => {
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


export const getToolIcon = (toolName: string): React.ReactNode => {
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

