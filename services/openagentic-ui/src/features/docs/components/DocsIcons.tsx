// theme-allow: this file is decorative SVG illustration artwork (multi-stop gradient
// doc glyphs). Like the diagram/illustration palettes on the theme allowlist, these
// hues are intentional art with no semantic theme meaning and are NOT themeable surfaces.
import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

// ============================================================================
// DOCUMENTATION ICONS
// ============================================================================

/**
 * DocsBookIcon - Gradient blue to cyan, open book shape
 * Use: Documentation home, general docs, wiki
 */
export const DocsBookIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="docsBookGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
      <filter id="docsBookGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Left page */}
    <path
      d="M4 19V5a2 2 0 012-2h4l2 2"
      stroke="url(#docsBookGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#docsBookGlow)"
    />
    {/* Right page */}
    <path
      d="M12 5l2-2h4a2 2 0 012 2v14"
      stroke="url(#docsBookGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#docsBookGlow)"
    />
    {/* Spine */}
    <path
      d="M12 5v16"
      stroke="url(#docsBookGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Bottom cover */}
    <path
      d="M4 19a2 2 0 012-2h14a2 2 0 012 2"
      stroke="url(#docsBookGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Page lines */}
    <line x1="7" y1="8" x2="10" y2="8" stroke="#06b6d4" strokeWidth="1" opacity="0.6" />
    <line x1="7" y1="11" x2="10" y2="11" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
    <line x1="14" y1="8" x2="17" y2="8" stroke="#06b6d4" strokeWidth="1" opacity="0.6" />
    <line x1="14" y1="11" x2="17" y2="11" stroke="#06b6d4" strokeWidth="1" opacity="0.4" />
  </svg>
);

/**
 * DocsAgentIcon - Gradient purple to blue, brain/circuit pattern
 * Use: Agent documentation, AI agents, orchestration
 */
export const DocsAgentIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="docsAgentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#3b82f6" />
      </linearGradient>
      <filter id="docsAgentGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Head circle */}
    <circle cx="12" cy="8" r="5" stroke="url(#docsAgentGrad)" strokeWidth="2" filter="url(#docsAgentGlow)" />
    {/* Circuit lines inside head */}
    <circle cx="10" cy="7" r="1" fill="#a78bfa" opacity="0.8" />
    <circle cx="14" cy="7" r="1" fill="#a78bfa" opacity="0.8" />
    <line x1="10" y1="7" x2="14" y2="7" stroke="#a78bfa" strokeWidth="0.8" opacity="0.6" />
    <circle cx="12" cy="9.5" r="0.8" fill="#818cf8" opacity="0.7" />
    <line x1="12" y1="7" x2="12" y2="9.5" stroke="#818cf8" strokeWidth="0.8" opacity="0.5" />
    {/* Body/torso */}
    <path
      d="M7 21v-2a5 5 0 0110 0v2"
      stroke="url(#docsAgentGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Pulse indicator */}
    <circle cx="12" cy="5" r="1" fill="#8b5cf6">
      <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
    </circle>
  </svg>
);

/**
 * DocsToolIcon - Gradient orange to yellow, wrench/gear shape
 * Use: MCP tools, utilities, integrations
 */
export const DocsToolIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="docsToolGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#eab308" />
      </linearGradient>
      <filter id="docsToolGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Gear outer */}
    <path
      d="M12 15a3 3 0 100-6 3 3 0 000 6z"
      stroke="url(#docsToolGrad)"
      strokeWidth="2"
      filter="url(#docsToolGlow)"
    />
    {/* Gear teeth */}
    <path
      d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
      stroke="url(#docsToolGrad)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.7"
    />
  </svg>
);

/**
 * DocsFlowIcon - Gradient green to teal, flow/nodes shape
 * Use: Workflows, pipelines, orchestration flows
 */
export const DocsFlowIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="docsFlowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#22c55e" />
        <stop offset="100%" stopColor="#14b8a6" />
      </linearGradient>
      <filter id="docsFlowGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Node 1 - top left */}
    <rect x="2" y="3" width="6" height="5" rx="1.5" fill="url(#docsFlowGrad)" filter="url(#docsFlowGlow)" opacity="0.9" />
    {/* Node 2 - middle right */}
    <rect x="16" y="3" width="6" height="5" rx="1.5" fill="url(#docsFlowGrad)" filter="url(#docsFlowGlow)" opacity="0.9" />
    {/* Node 3 - bottom center */}
    <rect x="9" y="16" width="6" height="5" rx="1.5" fill="url(#docsFlowGrad)" filter="url(#docsFlowGlow)" opacity="0.9" />
    {/* Connectors */}
    <path d="M8 5.5h8" stroke="#14b8a6" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
    <path d="M5 8v5l7 3" stroke="#14b8a6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    <path d="M19 8v5l-7 3" stroke="#14b8a6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    {/* Animated dot traveling on path */}
    <circle cx="0" cy="0" r="1.5" fill="#22c55e">
      <animateMotion dur="3s" repeatCount="indefinite" path="M5 8 L5 13 L12 16" />
      <animate attributeName="opacity" values="1;0.5;1" dur="3s" repeatCount="indefinite" />
    </circle>
  </svg>
);

/**
 * DocsShieldIcon - Gradient red to orange, shield shape
 * Use: Security, DLP rules, access control, compliance
 */
export const DocsShieldIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="docsShieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ef4444" />
        <stop offset="100%" stopColor="#f97316" />
      </linearGradient>
      <filter id="docsShieldGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Shield body */}
    <path
      d="M12 2l8 4v6c0 5.25-3.5 9.75-8 11-4.5-1.25-8-5.75-8-11V6l8-4z"
      fill="url(#docsShieldGrad)"
      fillOpacity="0.15"
      stroke="url(#docsShieldGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#docsShieldGlow)"
    />
    {/* Checkmark */}
    <path
      d="M9 12l2 2 4-4"
      stroke="url(#docsShieldGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Pulse on top */}
    <circle cx="12" cy="2" r="1.5" fill="#ef4444">
      <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2s" repeatCount="indefinite" />
    </circle>
  </svg>
);

/**
 * DocsInfraIcon - Gradient gray to blue, server/cloud shape
 * Use: Infrastructure, deployment, cloud services
 */
export const DocsInfraIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="docsInfraGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#64748b" />
        <stop offset="100%" stopColor="#3b82f6" />
      </linearGradient>
      <filter id="docsInfraGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Cloud shape */}
    <path
      d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"
      stroke="url(#docsInfraGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#docsInfraGlow)"
    />
    {/* Server lines inside */}
    <rect x="8" y="13" width="8" height="2" rx="0.5" fill="#3b82f6" opacity="0.4" />
    <rect x="8" y="16" width="8" height="2" rx="0.5" fill="#3b82f6" opacity="0.3" />
    {/* Status LED */}
    <circle cx="10" cy="14" r="0.8" fill="#22c55e">
      <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
    </circle>
  </svg>
);

/**
 * DocsChatIcon - Gradient blue to purple, chat bubble shape
 * Use: Chat panel, conversations, AI assistant
 */
export const DocsChatIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="docsChatGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
      <filter id="docsChatGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Chat bubble */}
    <path
      d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"
      fill="url(#docsChatGrad)"
      fillOpacity="0.12"
      stroke="url(#docsChatGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#docsChatGlow)"
    />
    {/* Typing dots */}
    <circle cx="8" cy="10" r="1" fill="#818cf8">
      <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" begin="0s" repeatCount="indefinite" />
    </circle>
    <circle cx="12" cy="10" r="1" fill="#818cf8">
      <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" begin="0.2s" repeatCount="indefinite" />
    </circle>
    <circle cx="16" cy="10" r="1" fill="#818cf8">
      <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
    </circle>
  </svg>
);

/**
 * DocsSearchIcon - Gradient white to light blue, magnifying glass
 * Use: Search functionality, filtering
 */
export const DocsSearchIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="docsSearchGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--color-text)" />
        <stop offset="100%" stopColor="#93c5fd" />
      </linearGradient>
    </defs>
    {/* Magnifying glass circle */}
    <circle
      cx="11"
      cy="11"
      r="7"
      stroke="url(#docsSearchGrad)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Handle */}
    <line
      x1="16.5"
      y1="16.5"
      x2="21"
      y2="21"
      stroke="url(#docsSearchGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    {/* Shine */}
    <path d="M8 8a4 4 0 014-4" stroke="#93c5fd" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
  </svg>
);

/**
 * DocsBrainIcon - Gradient purple to pink, brain shape
 * Use: AI models, intelligence, reasoning
 */
export const DocsBrainIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="docsBrainGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#ec4899" />
      </linearGradient>
      <filter id="docsBrainGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Left hemisphere */}
    <path
      d="M12 2C8 2 4 5 4 9c0 2 1 3.5 2 4.5S8 16 8 18v2h4V2z"
      stroke="url(#docsBrainGrad)"
      strokeWidth="1.5"
      fill="url(#docsBrainGrad)"
      fillOpacity="0.1"
      filter="url(#docsBrainGlow)"
    />
    {/* Right hemisphere */}
    <path
      d="M12 2c4 0 8 3 8 7 0 2-1 3.5-2 4.5S16 16 16 18v2h-4V2z"
      stroke="url(#docsBrainGrad)"
      strokeWidth="1.5"
      fill="url(#docsBrainGrad)"
      fillOpacity="0.1"
    />
    {/* Neural connections */}
    <path d="M7 8c2 0 3 1 5 1" stroke="#c084fc" strokeWidth="0.8" opacity="0.6" />
    <path d="M7 12c2 0 3-1 5-1" stroke="#c084fc" strokeWidth="0.8" opacity="0.5" />
    <path d="M17 8c-2 0-3 1-5 1" stroke="#c084fc" strokeWidth="0.8" opacity="0.6" />
    <path d="M17 12c-2 0-3-1-5-1" stroke="#c084fc" strokeWidth="0.8" opacity="0.5" />
    {/* Synapse pulse */}
    <circle cx="12" cy="9" r="1.2" fill="#a855f7">
      <animate attributeName="opacity" values="1;0.3;1" dur="1.8s" repeatCount="indefinite" />
    </circle>
    {/* Base */}
    <line x1="8" y1="20" x2="16" y2="20" stroke="url(#docsBrainGrad)" strokeWidth="2" strokeLinecap="round" />
    <line x1="9" y1="22" x2="15" y2="22" stroke="url(#docsBrainGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
  </svg>
);

/**
 * DocsCodeIcon - Gradient green to cyan, code brackets shape
 * Use: development, API references
 */
export const DocsCodeIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="docsCodeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#22c55e" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
      <filter id="docsCodeGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Left bracket */}
    <polyline
      points="8 18 3 12 8 6"
      stroke="url(#docsCodeGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#docsCodeGlow)"
    />
    {/* Right bracket */}
    <polyline
      points="16 6 21 12 16 18"
      stroke="url(#docsCodeGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#docsCodeGlow)"
    />
    {/* Slash */}
    <line
      x1="14"
      y1="4"
      x2="10"
      y2="20"
      stroke="#06b6d4"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.5"
    />
    {/* Cursor blink */}
    <line x1="12" y1="10" x2="12" y2="14" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round">
      <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
    </line>
  </svg>
);

/**
 * DocsCloseIcon - Simple X icon using theme colors
 * Use: Close buttons
 */
export const DocsCloseIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * DocsChevronIcon - Expandable chevron
 * Use: Tree navigation, collapsible sections
 */
export const DocsChevronIcon: React.FC<IconProps & { direction?: 'right' | 'down' }> = ({
  size = 16,
  className = '',
  style,
  direction = 'right'
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    style={{
      ...style,
      transform: direction === 'down' ? 'rotate(90deg)' : undefined,
      transition: 'transform 0.2s ease',
    }}
  >
    <polyline
      points="9 18 15 12 9 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// ============================================================================
// ICON MAP - Maps string keys to icon components (for dynamic rendering)
// ============================================================================

export const docsIconMap: Record<string, React.FC<IconProps>> = {
  book: DocsBookIcon,
  agent: DocsAgentIcon,
  tool: DocsToolIcon,
  flow: DocsFlowIcon,
  shield: DocsShieldIcon,
  infra: DocsInfraIcon,
  chat: DocsChatIcon,
  search: DocsSearchIcon,
  brain: DocsBrainIcon,
  code: DocsCodeIcon,
};

/**
 * Get icon component by string key, with fallback
 */
export const getDocsIcon = (key: string): React.FC<IconProps> => {
  return docsIconMap[key] || DocsBookIcon;
};
