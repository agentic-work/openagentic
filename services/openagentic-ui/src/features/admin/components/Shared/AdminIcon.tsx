/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';

export type AdminIconName =
  // Navigation & Layout
  | 'dashboard' | 'grid' | 'menu' | 'chevron-right' | 'chevron-down'
  // System & Infrastructure
  | 'server' | 'database' | 'cpu' | 'memory' | 'network' | 'cloud' | 'container'
  // Users & Security
  | 'user' | 'users' | 'shield' | 'lock' | 'key' | 'fingerprint'
  // Monitoring & Analytics
  | 'chart' | 'trending' | 'activity' | 'pulse' | 'logs' | 'clock'
  // Development
  | 'code' | 'terminal' | 'git' | 'branch' | 'api' | 'workflow' | 'cube'
  // Files & Content
  | 'folder' | 'file' | 'document' | 'prompt' | 'template'
  // Actions & Status
  | 'check' | 'cross' | 'warning' | 'info' | 'plus' | 'edit' | 'trash' | 'eye'
  // AI & Models
  | 'sparkle' | 'brain' | 'robot' | 'magic'
  // Misc
  | 'cog' | 'settings' | 'book' | 'link';

interface AdminIconProps {
  name: AdminIconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

// Nerd Font Unicode mappings - Powerlevel10k style icons
const iconGlyphs: Record<AdminIconName, string> = {
  // Navigation - using Nerd Font/FontAwesome
  'dashboard': '\uf0e4',    //
  'grid': '\uf00a',         //
  'menu': '\uf0c9',         //
  'chevron-right': '\uf054', //
  'chevron-down': '\uf078', //

  // System & Infrastructure
  'server': '\uf233',       //
  'database': '\uf1c0',     //
  'cpu': '\uf2db',          //
  'memory': '\uf538',       //
  'network': '\uf0e8',      //
  'cloud': '\uf0c2',        //
  'container': '\ue7b0',    //  (Docker)

  // Users & Security
  'user': '\uf007',         //
  'users': '\uf0c0',        //
  'shield': '\uf132',       //
  'lock': '\uf023',         //
  'key': '\uf084',          //
  'fingerprint': '\uf577',  //

  // Monitoring & Analytics
  'chart': '\uf080',        //
  'trending': '\uf201',     //
  'activity': '\uf201',     //
  'pulse': '\uf21e',        //
  'logs': '\uf15c',         //
  'clock': '\uf017',        //

  // Development
  'code': '\uf121',         //
  'terminal': '\uf120',     //
  'git': '\ue725',          //
  'branch': '\ue0a0',       //
  'api': '\uf1b3',          //
  'workflow': '\uf126',     //
  'cube': '\uf1b2',         //

  // Files & Content
  'folder': '\uf07b',       //
  'file': '\uf15b',         //
  'document': '\uf15c',     //
  'prompt': '\uf075',       //
  'template': '\uf0c5',     //

  // Actions & Status
  'check': '\uf00c',        //
  'cross': '\uf00d',        //
  'warning': '\uf071',      //
  'info': '\uf05a',         //
  'plus': '\uf067',         //
  'edit': '\uf044',         //
  'trash': '\uf1f8',        //
  'eye': '\uf06e',          //

  // AI & Models
  'sparkle': '\uf005',      //
  'brain': '\uf5dc',        //
  'robot': '\uf544',        //
  'magic': '\uf0d0',        //

  // Misc
  'cog': '\uf013',          //
  'settings': '\uf013',     //
  'book': '\uf02d',         //
  'link': '\uf0c1',         //
};

export const AdminIcon: React.FC<AdminIconProps> = ({
  name,
  size = 16,
  className = '',
  style = {}
}) => {
  const glyph = iconGlyphs[name] || '\uf128'; // Default to question mark

  return (
    <span
      className={`admin-icon ${className}`}
      style={{
        fontFamily: 'var(--font-admin)',
        fontSize: size,
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
        ...style
      }}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
};

// SVG-based icons for complex graphics that Nerd Font doesn't cover well
// These give more design flexibility while maintaining the admin aesthetic

interface SvgIconProps {
  size?: number;
  className?: string;
  color?: string;
}

// GCP-style hexagon icon for the main logo
export const GCPHexIcon: React.FC<SvgIconProps> = ({ size = 24, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path
      d="M12 2L3 7v10l9 5 9-5V7l-9-5z"
      stroke={color}
      strokeWidth="2"
      fill="none"
    />
    <path
      d="M12 7v10M7.5 9.5l9 5M16.5 9.5l-9 5"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

// Activity/pulse indicator
export const PulseIcon: React.FC<SvgIconProps> = ({ size = 20, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
    <path
      d="M2 10h3l2-5 3 10 2-5h3"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="17" cy="10" r="2" fill={color} />
  </svg>
);

// Sparkle/AI icon
export const SparkleIcon: React.FC<SvgIconProps> = ({ size = 20, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
    <path
      d="M10 1l1.5 4.5L16 7l-4.5 1.5L10 13l-1.5-4.5L4 7l4.5-1.5L10 1z"
      fill={color}
    />
    <path
      d="M15 12l.75 2.25L18 15l-2.25.75L15 18l-.75-2.25L12 15l2.25-.75L15 12z"
      fill={color}
      opacity="0.7"
    />
    <path
      d="M4 14l.5 1.5L6 16l-1.5.5L4 18l-.5-1.5L2 16l1.5-.5L4 14z"
      fill={color}
      opacity="0.5"
    />
  </svg>
);

// Server rack icon
export const ServerRackIcon: React.FC<SvgIconProps> = ({ size = 20, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
    <rect x="3" y="2" width="14" height="5" rx="1" stroke={color} strokeWidth="1.5" />
    <rect x="3" y="8" width="14" height="5" rx="1" stroke={color} strokeWidth="1.5" />
    <rect x="3" y="14" width="14" height="4" rx="1" stroke={color} strokeWidth="1.5" />
    <circle cx="6" cy="4.5" r="1" fill={color} />
    <circle cx="6" cy="10.5" r="1" fill={color} />
    <circle cx="6" cy="16" r="1" fill={color} />
    <line x1="9" y1="4.5" x2="14" y2="4.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <line x1="9" y1="10.5" x2="14" y2="10.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <line x1="9" y1="16" x2="14" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// Workflow/DAG icon
export const WorkflowIcon: React.FC<SvgIconProps> = ({ size = 20, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
    <circle cx="4" cy="10" r="2.5" stroke={color} strokeWidth="1.5" />
    <circle cx="10" cy="4" r="2.5" stroke={color} strokeWidth="1.5" />
    <circle cx="10" cy="16" r="2.5" stroke={color} strokeWidth="1.5" />
    <circle cx="16" cy="10" r="2.5" stroke={color} strokeWidth="1.5" />
    <path d="M6.5 9L8 5.5M6.5 11L8 14.5M12 5.5L13.5 9M12 14.5L13.5 11" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// MCP/Tools icon
export const ToolsIcon: React.FC<SvgIconProps> = ({ size = 20, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
    <path
      d="M12.5 3.5l4 4-1.5 1.5 2 2-2.5 2.5-2-2-1.5 1.5-4-4"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3 14l4.5-4.5M3 17l2-2"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <circle cx="7" cy="7" r="3" stroke={color} strokeWidth="1.5" />
  </svg>
);

// Code terminal icon with prompt
export const TerminalPromptIcon: React.FC<SvgIconProps> = ({ size = 20, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
    <rect x="2" y="3" width="16" height="14" rx="2" stroke={color} strokeWidth="1.5" />
    <path d="M5 8l3 2-3 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="10" y1="12" x2="14" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// Shield with checkmark
export const ShieldCheckIcon: React.FC<SvgIconProps> = ({ size = 20, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
    <path
      d="M10 2L3 5v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V5l-7-3z"
      stroke={color}
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M7 10l2 2 4-4"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Database with sync arrows
export const DatabaseSyncIcon: React.FC<SvgIconProps> = ({ size = 20, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
    <ellipse cx="10" cy="5" rx="6" ry="2.5" stroke={color} strokeWidth="1.5" />
    <path d="M4 5v10c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V5" stroke={color} strokeWidth="1.5" />
    <ellipse cx="10" cy="10" rx="6" ry="2.5" stroke={color} strokeWidth="1.5" />
  </svg>
);

// Chart bars with trend line
export const AnalyticsIcon: React.FC<SvgIconProps> = ({ size = 20, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className}>
    <rect x="3" y="12" width="3" height="5" rx="0.5" fill={color} opacity="0.6" />
    <rect x="8.5" y="8" width="3" height="9" rx="0.5" fill={color} opacity="0.8" />
    <rect x="14" y="4" width="3" height="13" rx="0.5" fill={color} />
    <path d="M3 9l4.5-3 4.5 2L17 3" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="17" cy="3" r="1.5" fill={color} />
  </svg>
);

// Exports for convenience
export default AdminIcon;
