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

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

// ============================================================================
// ACTIVITY & MONITORING ICONS
// ============================================================================

/**
 * Activity/Pulse Icon - Colorful heartbeat monitor
 * Use: Real-time monitoring, health checks, live data
 */
export const ActivityIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="activityGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="var(--color-success)" />
        <stop offset="50%" stopColor="#10b981" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
      <filter id="activityGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <path
      d="M2 12h4l2-6 4 12 2-6h4l2 3 2-3h2"
      stroke="url(#activityGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#activityGlow)"
    />
    <circle cx="22" cy="12" r="2" fill="var(--color-success)">
      <animate attributeName="opacity" values="1;0.4;1" dur="1s" repeatCount="indefinite" />
    </circle>
  </svg>
);

/**
 * CPU/Processor Icon - Glowing tech chip
 * Use: Processing, compute resources, model inference
 */
export const CpuIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="cpuGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#6366f1" />
      </linearGradient>
      <filter id="cpuGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Main chip body */}
    <rect x="6" y="6" width="12" height="12" rx="2" fill="url(#cpuGrad)" filter="url(#cpuGlow)" />
    {/* Inner core */}
    <rect x="9" y="9" width="6" height="6" rx="1" fill="#a78bfa" opacity="0.8" />
    {/* Pins - top */}
    <line x1="9" y1="3" x2="9" y2="6" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="12" y1="3" x2="12" y2="6" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="15" y1="3" x2="15" y2="6" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
    {/* Pins - bottom */}
    <line x1="9" y1="18" x2="9" y2="21" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="12" y1="18" x2="12" y2="21" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="15" y1="18" x2="15" y2="21" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
    {/* Pins - left */}
    <line x1="3" y1="9" x2="6" y2="9" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="3" y1="12" x2="6" y2="12" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="3" y1="15" x2="6" y2="15" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
    {/* Pins - right */}
    <line x1="18" y1="9" x2="21" y2="9" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="18" y1="12" x2="21" y2="12" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="18" y1="15" x2="21" y2="15" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * Database Icon - Multi-layer storage with glow
 * Use: Data storage, Milvus, PostgreSQL, caching
 */
export const DatabaseIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="dbGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="50%" stopColor="#0284c7" />
        <stop offset="100%" stopColor="#0369a1" />
      </linearGradient>
    </defs>
    {/* Top ellipse */}
    <ellipse cx="12" cy="5" rx="8" ry="3" fill="url(#dbGrad)" />
    {/* Middle section */}
    <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" fill="url(#dbGrad)" opacity="0.85" />
    {/* Bottom section */}
    <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" fill="url(#dbGrad)" opacity="0.7" />
    {/* Highlight rings */}
    <ellipse cx="12" cy="11" rx="8" ry="3" fill="none" stroke="#38bdf8" strokeWidth="0.5" opacity="0.6" />
    <ellipse cx="12" cy="17" rx="8" ry="3" fill="none" stroke="#38bdf8" strokeWidth="0.5" opacity="0.4" />
    {/* LED indicator */}
    <circle cx="17" cy="7" r="1.5" fill="var(--color-success)">
      <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
    </circle>
  </svg>
);

/**
 * Server Icon - Server rack with status LEDs
 * Use: Infrastructure, providers, deployments
 */
export const ServerIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="serverGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#475569" />
        <stop offset="100%" stopColor="#334155" />
      </linearGradient>
    </defs>
    {/* Server unit 1 */}
    <rect x="3" y="2" width="18" height="6" rx="1.5" fill="url(#serverGrad)" stroke="#64748b" strokeWidth="0.5" />
    <circle cx="6" cy="5" r="1.2" fill="var(--color-success)">
      <animate attributeName="opacity" values="1;0.6;1" dur="1.5s" repeatCount="indefinite" />
    </circle>
    <rect x="9" y="4" width="9" height="2" rx="0.5" fill="#0ea5e9" opacity="0.4" />
    {/* Server unit 2 */}
    <rect x="3" y="9" width="18" height="6" rx="1.5" fill="url(#serverGrad)" stroke="#64748b" strokeWidth="0.5" />
    <circle cx="6" cy="12" r="1.2" fill="var(--color-success)">
      <animate attributeName="opacity" values="1;0.6;1" dur="1.8s" repeatCount="indefinite" />
    </circle>
    <rect x="9" y="11" width="9" height="2" rx="0.5" fill="#0ea5e9" opacity="0.4" />
    {/* Server unit 3 */}
    <rect x="3" y="16" width="18" height="6" rx="1.5" fill="url(#serverGrad)" stroke="#64748b" strokeWidth="0.5" />
    <circle cx="6" cy="19" r="1.2" fill="#f59e0b">
      <animate attributeName="opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite" />
    </circle>
    <rect x="9" y="18" width="9" height="2" rx="0.5" fill="#0ea5e9" opacity="0.4" />
  </svg>
);

// ============================================================================
// COST & ANALYTICS ICONS
// ============================================================================

/**
 * Dollar/Cost Icon - Money with gradient
 * Use: Pricing, costs, billing, usage fees
 */
export const DollarIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="dollarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--color-success)" />
        <stop offset="100%" stopColor="#16a34a" />
      </linearGradient>
      <filter id="dollarGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <circle cx="12" cy="12" r="10" fill="url(#dollarGrad)" filter="url(#dollarGlow)" opacity="0.15" />
    <circle cx="12" cy="12" r="10" stroke="url(#dollarGrad)" strokeWidth="2" fill="none" />
    <path
      d="M12 5v14M15 8.5c0-1.5-1.34-2.5-3-2.5s-3 1-3 2.5 1.5 2 3 2.5 3 1.5 3 3-1.34 2.5-3 2.5-3-1-3-2.5"
      stroke="url(#dollarGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#dollarGlow)"
    />
  </svg>
);

/**
 * TrendingUp Icon - Analytics chart with gradient
 * Use: Growth, analytics, metrics improvement
 */
export const TrendingUpIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="trendGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#06b6d4" />
        <stop offset="50%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="var(--color-success)" />
      </linearGradient>
      <filter id="trendGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Background bars */}
    <rect x="3" y="16" width="3" height="5" rx="0.5" fill="#0ea5e9" opacity="0.2" />
    <rect x="8" y="12" width="3" height="9" rx="0.5" fill="#0ea5e9" opacity="0.25" />
    <rect x="13" y="8" width="3" height="13" rx="0.5" fill="#0ea5e9" opacity="0.3" />
    <rect x="18" y="4" width="3" height="17" rx="0.5" fill="#0ea5e9" opacity="0.35" />
    {/* Trend line */}
    <path
      d="M3 18L8 14L13 10L21 4"
      stroke="url(#trendGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#trendGlow)"
    />
    {/* Arrow */}
    <path
      d="M16 4h5v5"
      stroke="var(--color-success)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Timer/Clock Icon - Stopwatch with accent
 * Use: Duration, latency, response times
 */
export const TimerIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    {/* Clock face */}
    <circle cx="12" cy="13" r="9" stroke="url(#timerGrad)" strokeWidth="2" fill="none" />
    <circle cx="12" cy="13" r="9" fill="url(#timerGrad)" opacity="0.1" />
    {/* Top button */}
    <rect x="10" y="1" width="4" height="3" rx="1" fill="url(#timerGrad)" />
    {/* Side button */}
    <rect x="19" y="6" width="3" height="2" rx="0.5" fill="url(#timerGrad)" opacity="0.7" />
    {/* Clock hands */}
    <path d="M12 8v5l3 2" stroke="url(#timerGrad)" strokeWidth="2" strokeLinecap="round" />
    {/* Center dot */}
    <circle cx="12" cy="13" r="1.5" fill="url(#timerGrad)" />
  </svg>
);

// ============================================================================
// ENERGY & ACTION ICONS
// ============================================================================

/**
 * Zap/Energy Icon - Lightning bolt with glow
 * Use: Power, speed, instant actions, AI processing
 */
export const ZapIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="zapGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="50%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
      <filter id="zapGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <path
      d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"
      fill="url(#zapGrad)"
      stroke="#fcd34d"
      strokeWidth="0.5"
      filter="url(#zapGlow)"
    />
  </svg>
);

/**
 * Refresh/Sync Icon - Rotating arrows with gradient
 * Use: Refresh, sync, reload data
 */
export const RefreshIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="refreshGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
    </defs>
    <path
      d="M21 12a9 9 0 11-3.2-6.88"
      stroke="url(#refreshGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    <path
      d="M21 4v4h-4"
      stroke="url(#refreshGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3 12a9 9 0 013.2 6.88"
      stroke="url(#refreshGrad)"
      strokeWidth="2.5"
      strokeLinecap="round"
      opacity="0.5"
    />
  </svg>
);

/**
 * GitBranch Icon - Version control with colors
 * Use: Branching, versions, code management
 */
export const GitBranchIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="gitGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#ea580c" />
      </linearGradient>
    </defs>
    {/* Main branch */}
    <line x1="6" y1="3" x2="6" y2="21" stroke="url(#gitGrad)" strokeWidth="2.5" strokeLinecap="round" />
    {/* Branch line */}
    <path d="M6 12c0 0 2-4 6-4s6 0 6 0" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" />
    {/* Nodes */}
    <circle cx="6" cy="6" r="3" fill="url(#gitGrad)" />
    <circle cx="6" cy="18" r="3" fill="url(#gitGrad)" />
    <circle cx="18" cy="8" r="3" fill="var(--color-success)" />
  </svg>
);

// ============================================================================
// STATUS ICONS
// ============================================================================

/**
 * Success/Check Icon - Green checkmark with glow
 * Use: Success states, completed tasks, valid
 */
export const SuccessIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="successGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--color-success)" />
        <stop offset="100%" stopColor="#16a34a" />
      </linearGradient>
      <filter id="successGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <circle cx="12" cy="12" r="10" fill="url(#successGrad)" filter="url(#successGlow)" />
    <path d="M8 12l3 3 5-6" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Error/X Icon - Red X with glow
 * Use: Error states, failures, invalid
 */
export const ErrorIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="errorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ef4444" />
        <stop offset="100%" stopColor="#dc2626" />
      </linearGradient>
      <filter id="errorGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <circle cx="12" cy="12" r="10" fill="url(#errorGrad)" filter="url(#errorGlow)" />
    <path d="M15 9l-6 6M9 9l6 6" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * Warning/Alert Icon - Amber triangle with glow
 * Use: Warning states, caution, attention needed
 */
export const WarningIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="warnGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#f59e0b" />
      </linearGradient>
      <filter id="warnGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <path
      d="M12 3L2 20h20L12 3z"
      fill="url(#warnGrad)"
      stroke="#fcd34d"
      strokeWidth="0.5"
      filter="url(#warnGlow)"
    />
    <line x1="12" y1="9" x2="12" y2="13" stroke="#78350f" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="12" cy="16" r="1.2" fill="#78350f" />
  </svg>
);

// ============================================================================
// SECURITY & USER ICONS
// ============================================================================

/**
 * Shield Icon - Security shield with gradient
 * Use: Security, protection, audit logs, SOC2 compliance
 */
export const ShieldIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="50%" stopColor="#7c3aed" />
        <stop offset="100%" stopColor="#6d28d9" />
      </linearGradient>
      <filter id="shieldGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <path
      d="M12 2l8 4v5c0 5.25-3.5 10-8 11-4.5-1-8-5.75-8-11V6l8-4z"
      fill="url(#shieldGrad)"
      filter="url(#shieldGlow)"
      opacity="0.9"
    />
    <path
      d="M12 2l8 4v5c0 5.25-3.5 10-8 11-4.5-1-8-5.75-8-11V6l8-4z"
      stroke="#a78bfa"
      strokeWidth="0.5"
      fill="none"
    />
    {/* Check mark inside */}
    <path d="M8.5 12l2.5 2.5 4.5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * User Icon - Person with gradient
 * Use: User profiles, accounts, authentication
 */
export const UserIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="userGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#2563eb" />
      </linearGradient>
      <filter id="userGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Head */}
    <circle cx="12" cy="8" r="4" fill="url(#userGrad)" filter="url(#userGlow)" />
    {/* Body */}
    <path
      d="M5 20v-1c0-3 3-5 7-5s7 2 7 5v1"
      fill="url(#userGrad)"
      filter="url(#userGlow)"
      opacity="0.85"
    />
    {/* Highlight */}
    <circle cx="13" cy="7" r="1" fill="white" opacity="0.3" />
  </svg>
);

/**
 * Lock Icon - Secure lock with gradient
 * Use: Locked states, security, permissions
 */
export const LockIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="lockGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    {/* Lock body */}
    <rect x="5" y="11" width="14" height="10" rx="2" fill="url(#lockGrad)" />
    {/* Shackle */}
    <path d="M8 11V7a4 4 0 118 0v4" stroke="url(#lockGrad)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    {/* Keyhole */}
    <circle cx="12" cy="16" r="1.5" fill="#78350f" />
    <rect x="11.25" y="16" width="1.5" height="3" rx="0.5" fill="#78350f" />
  </svg>
);

// ============================================================================
// TOGGLE & OUTPUT ICONS
// ============================================================================

/**
 * Toggle On Icon - Active switch
 * Use: Enabled states, turned on settings
 */
export const ToggleOnIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="toggleOnGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="var(--color-success)" />
        <stop offset="100%" stopColor="#16a34a" />
      </linearGradient>
    </defs>
    <rect x="1" y="6" width="22" height="12" rx="6" fill="url(#toggleOnGrad)" />
    <circle cx="17" cy="12" r="4" fill="white" />
  </svg>
);

/**
 * Toggle Off Icon - Inactive switch
 * Use: Disabled states, turned off settings
 */
export const ToggleOffIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <rect x="1" y="6" width="22" height="12" rx="6" fill="#4b5563" />
    <circle cx="7" cy="12" r="4" fill="white" />
  </svg>
);

/**
 * File Output Icon - Document with arrow
 * Use: Output, exports, synthesis results
 */
export const FileOutputIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="fileOutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#06b6d4" />
        <stop offset="100%" stopColor="#0891b2" />
      </linearGradient>
    </defs>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" fill="url(#fileOutGrad)" opacity="0.2" />
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="url(#fileOutGrad)" strokeWidth="1.5" fill="none" />
    <path d="M14 2v6h6" stroke="url(#fileOutGrad)" strokeWidth="1.5" fill="none" />
    <path d="M9 15l3 3 3-3M12 12v6" stroke="url(#fileOutGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ============================================================================
// LOADING ICONS
// ============================================================================

/**
 * Loading Spinner - Animated gradient spinner
 * Use: Loading states, async operations
 */
export const LoadingIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`animate-spin ${className}`} style={style}>
    <defs>
      <linearGradient id="loadGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.15" />
    <path
      d="M12 2a10 10 0 0110 10"
      stroke="url(#loadGrad)"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * Loading Dots - Animated bouncing dots
 * Use: Alternative loading indicator
 */
export const LoadingDotsIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <circle cx="6" cy="12" r="2.5" fill="#0ea5e9">
      <animate attributeName="opacity" values="0.3;1;0.3" dur="0.8s" repeatCount="indefinite" begin="0s" />
    </circle>
    <circle cx="12" cy="12" r="2.5" fill="#06b6d4">
      <animate attributeName="opacity" values="0.3;1;0.3" dur="0.8s" repeatCount="indefinite" begin="0.15s" />
    </circle>
    <circle cx="18" cy="12" r="2.5" fill="var(--color-success)">
      <animate attributeName="opacity" values="0.3;1;0.3" dur="0.8s" repeatCount="indefinite" begin="0.3s" />
    </circle>
  </svg>
);

// ============================================================================
// ADDITIONAL ICONS FOR ADMIN SIDEBAR
// ============================================================================

/**
 * Users Icon - Multiple people with gradient
 * Use: User management, team settings
 */
export const UsersIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="usersGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#2563eb" />
      </linearGradient>
    </defs>
    {/* First person */}
    <circle cx="9" cy="7" r="3.5" fill="url(#usersGrad)" />
    <path d="M2 20v-1c0-2.5 2.5-4 7-4s7 1.5 7 4v1" fill="url(#usersGrad)" opacity="0.85" />
    {/* Second person (behind) */}
    <circle cx="16" cy="6" r="2.5" fill="url(#usersGrad)" opacity="0.7" />
    <path d="M14 20v-2c0-1 1-2 3.5-2.5" stroke="url(#usersGrad)" strokeWidth="2" fill="none" strokeLinecap="round" />
  </svg>
);

/**
 * Cog/Settings Icon - Gear with gradient
 * Use: Settings, configuration
 */
export const CogIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="cogGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6b7280" />
        <stop offset="100%" stopColor="#4b5563" />
      </linearGradient>
    </defs>
    <path
      d="M12 15a3 3 0 100-6 3 3 0 000 6z"
      fill="url(#cogGrad)"
    />
    <path
      d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
      stroke="url(#cogGrad)"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Cube Icon - 3D cube with gradient
 * Use: Models, packages, containers
 */
export const CubeIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="cubeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#6366f1" />
      </linearGradient>
    </defs>
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" fill="url(#cubeGrad)" opacity="0.2" stroke="url(#cubeGrad)" strokeWidth="2" />
    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="url(#cubeGrad)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * Logs Icon - Document list with gradient
 * Use: Logs, history, audit trails
 */
export const LogsIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="logsGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="#0284c7" />
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="18" height="18" rx="2" fill="url(#logsGrad)" opacity="0.15" stroke="url(#logsGrad)" strokeWidth="2" />
    <path d="M7 8h10M7 12h10M7 16h6" stroke="url(#logsGrad)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * Grid Icon - Grid layout with gradient
 * Use: Dashboard, grid view
 */
export const GridIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="gridGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#10b981" />
        <stop offset="100%" stopColor="#16A34A" />
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="7" height="7" rx="1.5" fill="url(#gridGrad)" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" fill="url(#gridGrad)" opacity="0.8" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" fill="url(#gridGrad)" opacity="0.8" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" fill="url(#gridGrad)" opacity="0.6" />
  </svg>
);

/**
 * Folder Icon - Folder with gradient
 * Use: File management, directories
 */
export const FolderIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="folderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" fill="url(#folderGrad)" />
    <path d="M2 10h20" stroke="#fcd34d" strokeWidth="1" opacity="0.5" />
  </svg>
);

/**
 * Terminal Icon - Command line with gradient
 * Use: CLI, code execution
 */
export const TerminalIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="terminalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1e293b" />
        <stop offset="100%" stopColor="#0f172a" />
      </linearGradient>
    </defs>
    <rect x="2" y="4" width="20" height="16" rx="2" fill="url(#terminalGrad)" stroke="#334155" strokeWidth="1" />
    <path d="M6 9l3 3-3 3" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M11 16h6" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
    {/* Blinking cursor effect */}
    <rect x="17" y="15" width="2" height="3" fill="var(--color-success)" opacity="0.8">
      <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
    </rect>
  </svg>
);

/**
 * Chat/Prompt Icon - Chat bubble with gradient
 * Use: Prompts, messages, chat
 */
export const PromptIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="promptGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#7c3aed" />
      </linearGradient>
    </defs>
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" fill="url(#promptGrad)" opacity="0.2" stroke="url(#promptGrad)" strokeWidth="2" />
    <circle cx="8" cy="10" r="1" fill="url(#promptGrad)" />
    <circle cx="12" cy="10" r="1" fill="url(#promptGrad)" />
    <circle cx="16" cy="10" r="1" fill="url(#promptGrad)" />
  </svg>
);

/**
 * Template Icon - Document copy with gradient
 * Use: Templates, boilerplates
 */
export const TemplateIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="templateGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#06b6d4" />
        <stop offset="100%" stopColor="#0891b2" />
      </linearGradient>
    </defs>
    <rect x="8" y="2" width="13" height="16" rx="2" fill="url(#templateGrad)" opacity="0.3" stroke="url(#templateGrad)" strokeWidth="2" />
    <rect x="3" y="6" width="13" height="16" rx="2" fill="url(#templateGrad)" opacity="0.9" stroke="url(#templateGrad)" strokeWidth="2" />
    <path d="M7 12h5M7 16h8" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
  </svg>
);

/**
 * Chart Icon - Bar chart with gradient
 * Use: Analytics, metrics
 */
export const ChartIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="chartGrad" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
    </defs>
    <rect x="3" y="12" width="4" height="8" rx="1" fill="url(#chartGrad)" />
    <rect x="10" y="8" width="4" height="12" rx="1" fill="url(#chartGrad)" opacity="0.85" />
    <rect x="17" y="4" width="4" height="16" rx="1" fill="url(#chartGrad)" opacity="0.7" />
    {/* Trend line */}
    <path d="M5 11L12 7L19 3" stroke="var(--color-success)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 2" />
  </svg>
);

/**
 * Key Icon - Key with gradient
 * Use: Permissions, access keys
 */
export const KeyIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="keyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    <circle cx="8" cy="15" r="5" fill="url(#keyGrad)" opacity="0.3" stroke="url(#keyGrad)" strokeWidth="2" />
    <path d="M11.8 11.2L21 2M18 5l3 3M15 8l3 3" stroke="url(#keyGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Network Icon - Network nodes with gradient
 * Use: Networking, connections
 */
export const NetworkIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="networkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#2563eb" />
      </linearGradient>
    </defs>
    {/* Central node */}
    <circle cx="12" cy="12" r="3" fill="url(#networkGrad)" />
    {/* Outer nodes */}
    <circle cx="5" cy="5" r="2" fill="url(#networkGrad)" opacity="0.8" />
    <circle cx="19" cy="5" r="2" fill="url(#networkGrad)" opacity="0.8" />
    <circle cx="5" cy="19" r="2" fill="url(#networkGrad)" opacity="0.8" />
    <circle cx="19" cy="19" r="2" fill="url(#networkGrad)" opacity="0.8" />
    {/* Connection lines */}
    <path d="M9.5 9.5L6.5 6.5M14.5 9.5L17.5 6.5M9.5 14.5L6.5 17.5M14.5 14.5L17.5 17.5" stroke="url(#networkGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
  </svg>
);

/**
 * Book Icon - Open book with gradient
 * Use: Documentation, guides
 */
export const BookIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="bookGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#7c3aed" />
      </linearGradient>
    </defs>
    <path d="M4 19.5A2.5 2.5 0 016.5 17H20" stroke="url(#bookGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" fill="url(#bookGrad)" opacity="0.2" stroke="url(#bookGrad)" strokeWidth="2" />
    <path d="M8 6h8M8 10h8M8 14h4" stroke="url(#bookGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
  </svg>
);

/**
 * Code Icon - Code brackets with gradient
 * Use: Code, programming
 */
export const CodeIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="codeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--color-success)" />
        <stop offset="100%" stopColor="#16a34a" />
      </linearGradient>
    </defs>
    <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" stroke="url(#codeGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * API Icon - API brackets with gradient
 * Use: API documentation, endpoints
 */
export const APIIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="apiGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    <rect x="2" y="4" width="20" height="16" rx="2" fill="url(#apiGrad)" opacity="0.15" stroke="url(#apiGrad)" strokeWidth="2" />
    <path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01" stroke="url(#apiGrad)" strokeWidth="3" strokeLinecap="round" />
    <path d="M8 8h8M8 16h8" stroke="url(#apiGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
  </svg>
);

/**
 * Clock Icon - Clock with gradient
 * Use: Time, schedules, rate limits
 */
export const ClockIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="clockGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#4f46e5" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="9" fill="url(#clockGrad)" opacity="0.15" stroke="url(#clockGrad)" strokeWidth="2" />
    <path d="M12 6v6l4 2" stroke="url(#clockGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ============================================================================
// ACTION & UI ICONS
// ============================================================================

/**
 * Play Icon - Play button with gradient
 * Use: Start, run, execute workflows
 */
export const PlayIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="playGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--color-success)" />
        <stop offset="100%" stopColor="#16a34a" />
      </linearGradient>
      <filter id="playGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <path d="M6 4l14 8-14 8V4z" fill="url(#playGrad)" filter="url(#playGlow)" />
  </svg>
);

/**
 * Stop Icon - Stop/Square button with gradient
 * Use: Stop, halt, cancel operations
 */
export const StopIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="stopGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ef4444" />
        <stop offset="100%" stopColor="#dc2626" />
      </linearGradient>
    </defs>
    <rect x="5" y="5" width="14" height="14" rx="2" fill="url(#stopGrad)" />
  </svg>
);

/**
 * Trash Icon - Delete with gradient
 * Use: Delete, remove items
 */
export const TrashIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="trashGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ef4444" />
        <stop offset="100%" stopColor="#dc2626" />
      </linearGradient>
    </defs>
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke="url(#trashGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M19 6v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6" fill="url(#trashGrad)" opacity="0.2" stroke="url(#trashGrad)" strokeWidth="2" />
    <line x1="10" y1="10" x2="10" y2="16" stroke="url(#trashGrad)" strokeWidth="2" strokeLinecap="round" />
    <line x1="14" y1="10" x2="14" y2="16" stroke="url(#trashGrad)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/**
 * Eye Icon - View/visibility with gradient
 * Use: View, preview, visibility toggle
 */
export const EyeIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="eyeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="#0284c7" />
      </linearGradient>
    </defs>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" fill="url(#eyeGrad)" opacity="0.15" stroke="url(#eyeGrad)" strokeWidth="2" />
    <circle cx="12" cy="12" r="3" fill="url(#eyeGrad)" />
  </svg>
);

/**
 * Plus Icon - Add with gradient
 * Use: Add, create, new items
 */
export const PlusIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="plusGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--color-success)" />
        <stop offset="100%" stopColor="#16a34a" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="10" fill="url(#plusGrad)" opacity="0.15" stroke="url(#plusGrad)" strokeWidth="2" />
    <path d="M12 7v10M7 12h10" stroke="url(#plusGrad)" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * Search Icon - Magnifying glass with gradient
 * Use: Search, find, lookup
 */
export const SearchIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="searchGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#4f46e5" />
      </linearGradient>
    </defs>
    <circle cx="10" cy="10" r="7" fill="url(#searchGrad)" opacity="0.15" stroke="url(#searchGrad)" strokeWidth="2" />
    <path d="M21 21l-4.35-4.35" stroke="url(#searchGrad)" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * Filter Icon - Filter funnel with gradient
 * Use: Filter, sort, refine
 */
export const FilterIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="filterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#7c3aed" />
      </linearGradient>
    </defs>
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" fill="url(#filterGrad)" opacity="0.2" stroke="url(#filterGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * External Link Icon - Link arrow with gradient
 * Use: External links, open in new tab
 */
export const ExternalLinkIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="extLinkGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
    </defs>
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="url(#extLinkGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 3h6v6" stroke="url(#extLinkGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 14L21 3" stroke="url(#extLinkGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Edit Icon - Pencil with gradient
 * Use: Edit, modify, update
 */
export const EditIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="editGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="url(#editGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" fill="url(#editGrad)" opacity="0.2" stroke="url(#editGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Copy Icon - Duplicate with gradient
 * Use: Copy, duplicate, clone
 */
export const CopyIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="copyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#4f46e5" />
      </linearGradient>
    </defs>
    <rect x="9" y="9" width="13" height="13" rx="2" fill="url(#copyGrad)" opacity="0.2" stroke="url(#copyGrad)" strokeWidth="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="url(#copyGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Download Icon - Arrow down with gradient
 * Use: Download, export, save
 */
export const DownloadIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="downloadGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="var(--color-success)" />
        <stop offset="100%" stopColor="#16a34a" />
      </linearGradient>
    </defs>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="url(#downloadGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 10l5 5 5-5" stroke="url(#downloadGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 15V3" stroke="url(#downloadGrad)" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * Upload Icon - Arrow up with gradient
 * Use: Upload, import, send
 */
export const UploadIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="uploadGrad" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
    </defs>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="url(#uploadGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M17 8l-5-5-5 5" stroke="url(#uploadGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 3v12" stroke="url(#uploadGrad)" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * Building Icon - Building/Organization with gradient
 * Use: Organizations, companies, tenants
 */
export const BuildingIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="buildingGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    <rect x="4" y="2" width="16" height="20" rx="2" fill="url(#buildingGrad)" opacity="0.2" stroke="url(#buildingGrad)" strokeWidth="2" />
    <path d="M9 22V12h6v10" stroke="url(#buildingGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="8" y="6" width="2" height="2" fill="url(#buildingGrad)" rx="0.5" />
    <rect x="14" y="6" width="2" height="2" fill="url(#buildingGrad)" rx="0.5" />
  </svg>
);

/**
 * Folder Open Icon - Open folder with gradient
 * Use: Open folders, directory browsing
 */
export const FolderOpenIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="folderOpenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v2" fill="url(#folderOpenGrad)" opacity="0.3" />
    <path d="M2 10h20l-2 9H4l-2-9z" fill="url(#folderOpenGrad)" stroke="url(#folderOpenGrad)" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

/**
 * Chevron Down Icon - Down arrow
 * Use: Expand, dropdown, collapse
 */
export const ChevronDownIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Chevron Right Icon - Right arrow
 * Use: Next, navigate, expand
 */
export const ChevronRightIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Arrow Left Icon - Back arrow with gradient
 * Use: Back, previous, return
 */
export const ArrowLeftIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="arrowLeftGrad" x1="100%" y1="0%" x2="0%" y2="0%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#4f46e5" />
      </linearGradient>
    </defs>
    <path d="M19 12H5M12 19l-7-7 7-7" stroke="url(#arrowLeftGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Calendar Icon - Calendar with gradient
 * Use: Dates, scheduling, time ranges
 */
export const CalendarIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="calendarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="#0284c7" />
      </linearGradient>
    </defs>
    <rect x="3" y="4" width="18" height="18" rx="2" fill="url(#calendarGrad)" opacity="0.15" stroke="url(#calendarGrad)" strokeWidth="2" />
    <path d="M16 2v4M8 2v4M3 10h18" stroke="url(#calendarGrad)" strokeWidth="2" strokeLinecap="round" />
    <rect x="7" y="14" width="3" height="3" rx="0.5" fill="url(#calendarGrad)" />
  </svg>
);

/**
 * Close Icon - X with gradient
 * Use: Close, dismiss, cancel
 */
export const CloseIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="closeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6b7280" />
        <stop offset="100%" stopColor="#4b5563" />
      </linearGradient>
    </defs>
    <path d="M18 6L6 18M6 6l12 12" stroke="url(#closeGrad)" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * Maximize Icon - Expand with gradient
 * Use: Fullscreen, maximize, expand view
 */
export const MaximizeIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="maximizeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#4f46e5" />
      </linearGradient>
    </defs>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke="url(#maximizeGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * User Plus Icon - Add user with gradient
 * Use: Add user, invite, create account
 */
export const UserPlusIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="userPlusGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--color-success)" />
        <stop offset="100%" stopColor="#16a34a" />
      </linearGradient>
    </defs>
    <circle cx="9" cy="7" r="4" fill="url(#userPlusGrad)" opacity="0.3" stroke="url(#userPlusGrad)" strokeWidth="2" />
    <path d="M2 21v-2a4 4 0 014-4h6a4 4 0 014 4v2" stroke="url(#userPlusGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M19 8v6M22 11h-6" stroke="url(#userPlusGrad)" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * User Minus Icon - Remove user with gradient
 * Use: Remove user, delete account, revoke access
 */
export const UserMinusIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="userMinusGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ef4444" />
        <stop offset="100%" stopColor="#dc2626" />
      </linearGradient>
    </defs>
    <circle cx="9" cy="7" r="4" fill="url(#userMinusGrad)" opacity="0.3" stroke="url(#userMinusGrad)" strokeWidth="2" />
    <path d="M2 21v-2a4 4 0 014-4h6a4 4 0 014 4v2" stroke="url(#userMinusGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M22 11h-6" stroke="url(#userMinusGrad)" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

/**
 * Mail Icon - Email envelope with gradient
 * Use: Email, contact, notifications
 */
export const MailIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="mailGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="#0284c7" />
      </linearGradient>
    </defs>
    <rect x="2" y="4" width="20" height="16" rx="2" fill="url(#mailGrad)" opacity="0.15" stroke="url(#mailGrad)" strokeWidth="2" />
    <path d="M22 6l-10 7L2 6" stroke="url(#mailGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Sparkles Icon - AI/Magic sparkles with gradient
 * Use: AI features, magic, generation
 */
export const SparklesIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="sparklesGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="50%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
      <filter id="sparklesGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" fill="url(#sparklesGrad)" filter="url(#sparklesGlow)" />
    <path d="M5 16l1 2.5 2.5 1-2.5 1L5 23l-1-2.5L1.5 19.5 4 18.5 5 16z" fill="url(#sparklesGrad)" opacity="0.8" />
    <path d="M19 14l.75 2 2 .75-2 .75-.75 2-.75-2-2-.75 2-.75.75-2z" fill="url(#sparklesGrad)" opacity="0.6" />
  </svg>
);

/**
 * Bar Chart Icon - Horizontal bar chart with gradient
 * Use: Charts, statistics, metrics
 */
export const BarChartIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="barChartGrad" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stopColor="#06b6d4" />
        <stop offset="100%" stopColor="#0ea5e9" />
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="16" height="4" rx="1" fill="url(#barChartGrad)" opacity="0.9" />
    <rect x="4" y="10" width="12" height="4" rx="1" fill="url(#barChartGrad)" opacity="0.7" />
    <rect x="4" y="16" width="8" height="4" rx="1" fill="url(#barChartGrad)" opacity="0.5" />
  </svg>
);

/**
 * Beaker/Lab Icon - For development and testing
 * Use: Development tools, testing, experiments
 */
export const BeakerIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="beakerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="50%" stopColor="#a855f7" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
      <filter id="beakerGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Flask body */}
    <path
      d="M9 3v6l-5 8a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3l-5-8V3"
      stroke="url(#beakerGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      filter="url(#beakerGlow)"
    />
    {/* Flask neck */}
    <line x1="9" y1="3" x2="15" y2="3" stroke="url(#beakerGrad)" strokeWidth="2" strokeLinecap="round" />
    {/* Liquid level */}
    <path
      d="M7.5 15h9"
      stroke="#06b6d4"
      strokeWidth="1.5"
      strokeLinecap="round"
      opacity="0.6"
    />
    {/* Bubbles */}
    <circle cx="10" cy="16" r="1" fill="#a855f7" opacity="0.7">
      <animate attributeName="cy" values="16;14;16" dur="2s" repeatCount="indefinite" />
    </circle>
    <circle cx="13" cy="17" r="0.8" fill="#8b5cf6" opacity="0.5">
      <animate attributeName="cy" values="17;15;17" dur="1.5s" repeatCount="indefinite" />
    </circle>
  </svg>
);

// ============================================================================
// UNIQUE SIDEBAR SECTION ICONS
// ============================================================================

/**
 * System Management Icon - Server with gears
 * Use: System management, infrastructure settings
 */
export const SystemManagementIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="systemMgmtGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="50%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
      <filter id="systemGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Server rack */}
    <rect x="3" y="4" width="14" height="16" rx="2" fill="url(#systemMgmtGrad)" opacity="0.2" stroke="url(#systemMgmtGrad)" strokeWidth="1.5" filter="url(#systemGlow)" />
    {/* Server rows */}
    <rect x="5" y="6" width="10" height="3" rx="0.5" fill="url(#systemMgmtGrad)" opacity="0.6" />
    <rect x="5" y="11" width="10" height="3" rx="0.5" fill="url(#systemMgmtGrad)" opacity="0.5" />
    <rect x="5" y="16" width="10" height="3" rx="0.5" fill="url(#systemMgmtGrad)" opacity="0.4" />
    {/* Status LEDs */}
    <circle cx="7" cy="7.5" r="0.8" fill="var(--color-success)">
      <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
    </circle>
    <circle cx="7" cy="12.5" r="0.8" fill="var(--color-success)">
      <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
    </circle>
    <circle cx="7" cy="17.5" r="0.8" fill="#f59e0b">
      <animate attributeName="opacity" values="1;0.6;1" dur="1.8s" repeatCount="indefinite" />
    </circle>
    {/* Gear */}
    <circle cx="19" cy="17" r="4" fill="#1e1b4b" stroke="url(#systemMgmtGrad)" strokeWidth="1.5" />
    <circle cx="19" cy="17" r="1.5" fill="url(#systemMgmtGrad)" />
    <path d="M19 13v1M19 20v1M15 17h1M22 17h1M16.2 14.2l.7.7M21.1 19.1l.7.7M16.2 19.8l.7-.7M21.1 14.9l.7-.7" stroke="url(#systemMgmtGrad)" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

/**
 * Neural Network Icon - For Agentic Frameworks
 * Use: AI frameworks, neural networks, multi-agent systems
 */
export const NeuralNetworkIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="neuralGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#06b6d4" />
        <stop offset="50%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#ec4899" />
      </linearGradient>
      <filter id="neuralGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Connection lines - animated pulses */}
    <path d="M4 6L10 10M4 12L10 12M4 18L10 14" stroke="url(#neuralGrad)" strokeWidth="1.5" opacity="0.5" />
    <path d="M14 10L20 6M14 12L20 12M14 14L20 18" stroke="url(#neuralGrad)" strokeWidth="1.5" opacity="0.5" />
    <path d="M10 10L14 10M10 14L14 14M10 12L14 10M10 12L14 14" stroke="url(#neuralGrad)" strokeWidth="1.5" opacity="0.4" />
    {/* Input layer nodes */}
    <circle cx="4" cy="6" r="2.5" fill="url(#neuralGrad)" filter="url(#neuralGlow)" opacity="0.9" />
    <circle cx="4" cy="12" r="2.5" fill="url(#neuralGrad)" filter="url(#neuralGlow)" opacity="0.9" />
    <circle cx="4" cy="18" r="2.5" fill="url(#neuralGrad)" filter="url(#neuralGlow)" opacity="0.9" />
    {/* Hidden layer nodes */}
    <circle cx="12" cy="10" r="3" fill="url(#neuralGrad)" filter="url(#neuralGlow)">
      <animate attributeName="r" values="3;3.3;3" dur="2s" repeatCount="indefinite" />
    </circle>
    <circle cx="12" cy="14" r="3" fill="url(#neuralGrad)" filter="url(#neuralGlow)">
      <animate attributeName="r" values="3;3.3;3" dur="2.5s" repeatCount="indefinite" />
    </circle>
    {/* Output layer nodes */}
    <circle cx="20" cy="6" r="2.5" fill="url(#neuralGrad)" filter="url(#neuralGlow)" opacity="0.9" />
    <circle cx="20" cy="12" r="2.5" fill="url(#neuralGrad)" filter="url(#neuralGlow)" opacity="0.9" />
    <circle cx="20" cy="18" r="2.5" fill="url(#neuralGrad)" filter="url(#neuralGlow)" opacity="0.9" />
  </svg>
);

/**
 * Agent Orchestration Icon - Hub and spoke with connected agents
 * Use: Agent orchestration section header (distinct from Agentic Frameworks neural network)
 */
export const AgentOrchestrationIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="agentOrchGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
      <filter id="agentOrchGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Central hub */}
    <circle cx="12" cy="12" r="3.5" fill="url(#agentOrchGrad)" filter="url(#agentOrchGlow)" />
    {/* Orbiting agent dots */}
    <circle cx="5" cy="5" r="2" fill="#a78bfa" opacity="0.9">
      <animateTransform attributeName="transform" type="rotate" values="0 12 12;360 12 12" dur="8s" repeatCount="indefinite" />
    </circle>
    <circle cx="19" cy="5" r="2" fill="#818cf8" opacity="0.9">
      <animateTransform attributeName="transform" type="rotate" values="120 12 12;480 12 12" dur="8s" repeatCount="indefinite" />
    </circle>
    <circle cx="12" cy="20" r="2" fill="#c084fc" opacity="0.9">
      <animateTransform attributeName="transform" type="rotate" values="240 12 12;600 12 12" dur="8s" repeatCount="indefinite" />
    </circle>
    {/* Connection lines */}
    <line x1="12" y1="12" x2="5" y2="5" stroke="#6366f1" strokeWidth="0.8" opacity="0.4" />
    <line x1="12" y1="12" x2="19" y2="5" stroke="#6366f1" strokeWidth="0.8" opacity="0.4" />
    <line x1="12" y1="12" x2="12" y2="20" stroke="#6366f1" strokeWidth="0.8" opacity="0.4" />
  </svg>
);

/**
 * Developer Portal Icon - For Developer API section
 * Use: API documentation, developer tools, SDK
 */
export const DeveloperPortalIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="devPortalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f97316" />
        <stop offset="50%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#eab308" />
      </linearGradient>
      <filter id="devGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Code brackets background */}
    <path d="M8 5l-5 7 5 7" stroke="url(#devPortalGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#devGlow)" />
    <path d="M16 5l5 7-5 7" stroke="url(#devPortalGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#devGlow)" />
    {/* API badge */}
    <rect x="8" y="9" width="8" height="6" rx="1" fill="url(#devPortalGrad)" opacity="0.9" />
    <text x="12" y="13.5" fontSize="4" fontWeight="bold" fill="white" textAnchor="middle" dominantBaseline="middle">API</text>
    {/* Connection dots with pulse animation */}
    <circle cx="5" cy="3" r="1.2" fill="url(#devPortalGrad)" opacity="0.6">
      <animate attributeName="r" values="1.2;1.8;1.2" dur="2s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" />
    </circle>
    <circle cx="19" cy="3" r="1.2" fill="url(#devPortalGrad)" opacity="0.6">
      <animate attributeName="r" values="1.2;1.8;1.2" dur="2s" repeatCount="indefinite" begin="0.5s" />
      <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" begin="0.5s" />
    </circle>
    <circle cx="5" cy="21" r="1.2" fill="url(#devPortalGrad)" opacity="0.6">
      <animate attributeName="r" values="1.2;1.8;1.2" dur="2s" repeatCount="indefinite" begin="1s" />
      <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" begin="1s" />
    </circle>
    <circle cx="19" cy="21" r="1.2" fill="url(#devPortalGrad)" opacity="0.6">
      <animate attributeName="r" values="1.2;1.8;1.2" dur="2s" repeatCount="indefinite" begin="1.5s" />
      <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" begin="1.5s" />
    </circle>
  </svg>
);

/**
 * Content Data Icon - For Content & Data section
 * Use: Content management, data storage, vectors
 */
export const ContentDataIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="contentDataGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0ea5e9" />
        <stop offset="50%" stopColor="#06b6d4" />
        <stop offset="100%" stopColor="#14b8a6" />
      </linearGradient>
      <filter id="contentGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Database cylinder */}
    <ellipse cx="9" cy="6" rx="6" ry="2.5" fill="url(#contentDataGrad)" filter="url(#contentGlow)" />
    <path d="M3 6v10c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V6" fill="url(#contentDataGrad)" opacity="0.7" />
    <ellipse cx="9" cy="11" rx="6" ry="2.5" fill="none" stroke="url(#contentDataGrad)" strokeWidth="0.5" opacity="0.5" />
    <ellipse cx="9" cy="16" rx="6" ry="2.5" fill="none" stroke="url(#contentDataGrad)" strokeWidth="0.5" opacity="0.3" />
    {/* Document overlay */}
    <rect x="13" y="10" width="8" height="10" rx="1" fill="#0f172a" stroke="url(#contentDataGrad)" strokeWidth="1.5" />
    <path d="M15 13h4M15 16h4M15 19h2" stroke="url(#contentDataGrad)" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
    {/* Sync indicator */}
    <circle cx="19" cy="8" r="2" fill="url(#contentDataGrad)">
      <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
    </circle>
  </svg>
);

/**
 * Monitoring Pulse Icon - For Monitoring & Logs section
 * Use: Real-time monitoring, metrics, logs
 */
export const MonitoringPulseIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="monitorPulseGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="var(--color-success)" />
        <stop offset="50%" stopColor="#10b981" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
      <filter id="monitorGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Monitor screen */}
    <rect x="2" y="3" width="20" height="14" rx="2" fill="#0f172a" stroke="url(#monitorPulseGrad)" strokeWidth="1.5" />
    {/* Heartbeat line */}
    <path
      d="M4 11h3l1.5-4 2 8 2-4 1.5 2h6"
      stroke="url(#monitorPulseGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#monitorGlow)"
    />
    {/* Live indicator */}
    <circle cx="18" cy="6" r="1.5" fill="var(--color-success)">
      <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
    </circle>
    {/* Monitor stand */}
    <path d="M8 17h8M12 17v3M8 20h8" stroke="url(#monitorPulseGrad)" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * Security Fortress Icon - For Security & Access section
 * Use: Security settings, access control, authentication
 */
export const SecurityFortressIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="securityGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="50%" stopColor="#a855f7" />
        <stop offset="100%" stopColor="#c026d3" />
      </linearGradient>
      <filter id="securityGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Shield background with pulse */}
    <path
      d="M12 2l9 4v5c0 5.5-3.8 10.7-9 12-5.2-1.3-9-6.5-9-12V6l9-4z"
      fill="url(#securityGrad)"
      opacity="0.2"
      filter="url(#securityGlow)"
    >
      <animate attributeName="opacity" values="0.15;0.3;0.15" dur="2.5s" repeatCount="indefinite" />
    </path>
    <path
      d="M12 2l9 4v5c0 5.5-3.8 10.7-9 12-5.2-1.3-9-6.5-9-12V6l9-4z"
      stroke="url(#securityGrad)"
      strokeWidth="1.5"
      fill="none"
    >
      <animate attributeName="strokeWidth" values="1.5;2.2;1.5" dur="2.5s" repeatCount="indefinite" />
    </path>
    {/* Lock icon inside */}
    <rect x="9" y="10" width="6" height="5" rx="1" fill="url(#securityGrad)" />
    <path d="M10.5 10V8a1.5 1.5 0 013 0v2" stroke="url(#securityGrad)" strokeWidth="1.5" fill="none" />
    {/* Keyhole with glow */}
    <circle cx="12" cy="12" r="0.8" fill="white">
      <animate attributeName="r" values="0.8;1.1;0.8" dur="2s" repeatCount="indefinite" />
    </circle>
    <rect x="11.5" y="12" width="1" height="2" fill="white" />
  </svg>
);

/**
 * LLM Sparkle Icon - For LLM Providers section
 * Use: LLM providers, AI models, model management
 */
export const LLMSparkleIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="llmGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="30%" stopColor="#f59e0b" />
        <stop offset="70%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#6366f1" />
      </linearGradient>
      <filter id="llmGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Main star */}
    <path
      d="M12 2l2 6 6 1-4.5 4.5 1 6.5-5-3-5 3 1-6.5L3 9l6-1 3-6z"
      fill="url(#llmGrad)"
      filter="url(#llmGlow)"
    />
    {/* Inner glow */}
    <circle cx="12" cy="11" r="3" fill="white" opacity="0.3" />
    {/* Sparkle particles */}
    <circle cx="5" cy="5" r="1" fill="#fbbf24" opacity="0.8">
      <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.5s" repeatCount="indefinite" />
    </circle>
    <circle cx="20" cy="7" r="0.8" fill="#8b5cf6" opacity="0.7">
      <animate attributeName="opacity" values="0.7;0.2;0.7" dur="2s" repeatCount="indefinite" />
    </circle>
    <circle cx="18" cy="18" r="0.6" fill="#f59e0b" opacity="0.6">
      <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1.8s" repeatCount="indefinite" />
    </circle>
  </svg>
);

/**
 * Workflow Flow Icon - For native workflows section
 * Use: Workflows, flow builders, automation
 */
export const WorkflowFlowIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="workflowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ec4899" />
        <stop offset="50%" stopColor="#f43f5e" />
        <stop offset="100%" stopColor="#f97316" />
      </linearGradient>
      <filter id="workflowGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Flow connections */}
    <path d="M6 6h4v0M16 12h-3M10 12h3M14 18h4" stroke="url(#workflowGrad)" strokeWidth="2" strokeLinecap="round" />
    <path d="M10 6v6h4v6" stroke="url(#workflowGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    {/* Nodes */}
    <rect x="2" y="3" width="8" height="6" rx="2" fill="url(#workflowGrad)" filter="url(#workflowGlow)" />
    <rect x="11" y="9" width="8" height="6" rx="2" fill="url(#workflowGrad)" opacity="0.8" filter="url(#workflowGlow)" />
    <rect x="14" y="15" width="8" height="6" rx="2" fill="url(#workflowGrad)" opacity="0.6" filter="url(#workflowGlow)" />
    {/* Node icons */}
    <circle cx="6" cy="6" r="1.5" fill="white" opacity="0.5" />
    <circle cx="15" cy="12" r="1.5" fill="white" opacity="0.4" />
    <circle cx="18" cy="18" r="1.5" fill="white" opacity="0.3" />
  </svg>
);

/**
 * MCP Tools Icon - For MCP Management section
 * Use: MCP servers, tool management, integrations
 */
export const MCPToolsIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="mcpGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="50%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
      <filter id="mcpGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Wrench */}
    <path
      d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
      fill="url(#mcpGrad)"
      opacity="0.3"
      stroke="url(#mcpGrad)"
      strokeWidth="1.5"
      filter="url(#mcpGlow)"
    />
    {/* Connection bolt */}
    <path d="M9 3l1 4-3 1 4 4-1-4 3-1-4-4z" fill="url(#mcpGrad)" />
    {/* Sparks */}
    <circle cx="18" cy="14" r="1" fill="#fbbf24" opacity="0.8">
      <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1s" repeatCount="indefinite" />
    </circle>
    <circle cx="20" cy="12" r="0.6" fill="#f59e0b" opacity="0.6">
      <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1.3s" repeatCount="indefinite" />
    </circle>
  </svg>
);

/**
 * Terminal Code Icon - For Openagentic section
 * Use: Code execution, terminal, CLI
 */
export const TerminalCodeIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="termCodeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#10b981" />
        <stop offset="50%" stopColor="#14b8a6" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
      <filter id="termGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Terminal window */}
    <rect x="2" y="3" width="20" height="18" rx="2" fill="#0f172a" stroke="url(#termCodeGrad)" strokeWidth="1.5" />
    {/* Title bar */}
    <rect x="2" y="3" width="20" height="4" fill="url(#termCodeGrad)" opacity="0.2" />
    <circle cx="5" cy="5" r="1" fill="#ef4444" />
    <circle cx="8" cy="5" r="1" fill="#fbbf24" />
    <circle cx="11" cy="5" r="1" fill="var(--color-success)" />
    {/* Prompt */}
    <path d="M5 11l3 2-3 2" stroke="url(#termCodeGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#termGlow)" />
    {/* Command line */}
    <path d="M10 15h8" stroke="url(#termCodeGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
    {/* Cursor */}
    <rect x="18" y="14" width="2" height="3" fill="url(#termCodeGrad)">
      <animate attributeName="opacity" values="1;0.2;1" dur="1s" repeatCount="indefinite" />
    </rect>
  </svg>
);

/**
 * Synth Beaker Icon - For Synth Tool Synthesis section
 * Use: Tool synthesis, generation, chemistry
 */
export const SynthBeakerIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="synthGrad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#06b6d4" />
        <stop offset="30%" stopColor="#8b5cf6" />
        <stop offset="70%" stopColor="#a855f7" />
        <stop offset="100%" stopColor="#ec4899" />
      </linearGradient>
      <filter id="synthGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="1" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Flask outline */}
    <path
      d="M9 3v5l-5 9a2 2 0 001.7 3h12.6a2 2 0 001.7-3l-5-9V3"
      stroke="url(#synthGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
      filter="url(#synthGlow)"
    />
    {/* Neck */}
    <line x1="9" y1="3" x2="15" y2="3" stroke="url(#synthGrad)" strokeWidth="2" strokeLinecap="round" />
    {/* Liquid */}
    <path d="M7 15c1-1 3-1 5 0s4 1 5 0v5H7v-5z" fill="url(#synthGrad)" opacity="0.4" />
    {/* Bubbles */}
    <circle cx="9" cy="16" r="1.2" fill="#8b5cf6" opacity="0.8">
      <animate attributeName="cy" values="16;13;16" dur="2s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2s" repeatCount="indefinite" />
    </circle>
    <circle cx="12" cy="17" r="0.9" fill="#a855f7" opacity="0.7">
      <animate attributeName="cy" values="17;14;17" dur="1.5s" repeatCount="indefinite" />
    </circle>
    <circle cx="14" cy="15" r="1" fill="#ec4899" opacity="0.6">
      <animate attributeName="cy" values="15;12;15" dur="1.8s" repeatCount="indefinite" />
    </circle>
    {/* Sparkle */}
    <path d="M18 5l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" fill="url(#synthGrad)" opacity="0.8">
      <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.2s" repeatCount="indefinite" />
    </path>
  </svg>
);

/**
 * Chargeback Coin Icon - For Chargeback & Costs section
 * Use: Cost management, billing, chargeback
 */
export const ChargebackCoinIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="chargebackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="50%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
      <filter id="chargebackGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Coin stack - bottom */}
    <ellipse cx="12" cy="18" rx="8" ry="3" fill="url(#chargebackGrad)" opacity="0.3" />
    {/* Coin stack - middle */}
    <ellipse cx="12" cy="15" rx="8" ry="3" fill="url(#chargebackGrad)" opacity="0.5" />
    <path d="M4 15v3c0 1.66 3.58 3 8 3s8-1.34 8-3v-3" fill="url(#chargebackGrad)" opacity="0.3" />
    {/* Coin stack - top */}
    <ellipse cx="12" cy="12" rx="8" ry="3" fill="url(#chargebackGrad)" opacity="0.8" filter="url(#chargebackGlow)" />
    <path d="M4 12v3c0 1.66 3.58 3 8 3s8-1.34 8-3v-3" fill="url(#chargebackGrad)" opacity="0.5" />
    {/* Dollar sign */}
    <text x="12" y="9" fontSize="8" fontWeight="bold" fill="url(#chargebackGrad)" textAnchor="middle" dominantBaseline="middle" filter="url(#chargebackGlow)">$</text>
    {/* Sparkle */}
    <circle cx="18" cy="5" r="1.5" fill="#fbbf24">
      <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.5s" repeatCount="indefinite" />
      <animate attributeName="r" values="1.5;2;1.5" dur="1.5s" repeatCount="indefinite" />
    </circle>
    <circle cx="5" cy="7" r="1" fill="#f59e0b">
      <animate attributeName="opacity" values="0.6;0.1;0.6" dur="2s" repeatCount="indefinite" begin="0.5s" />
    </circle>
  </svg>
);

/**
 * Dashboard Overview Icon - For Dashboard Overview section
 * Use: Main dashboard, overview, pulse monitor
 */
export const DashboardOverviewIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="dashOverviewGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="50%" stopColor="#6366f1" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
      <filter id="dashGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    {/* Dashboard frame */}
    <rect x="2" y="3" width="20" height="18" rx="2" fill="#0f172a" stroke="url(#dashOverviewGrad)" strokeWidth="1.5" />
    {/* Stat panels */}
    <rect x="4" y="5" width="7" height="4" rx="1" fill="url(#dashOverviewGrad)" opacity="0.3" />
    <rect x="13" y="5" width="7" height="4" rx="1" fill="url(#dashOverviewGrad)" opacity="0.3" />
    {/* Heartbeat/pulse line */}
    <path
      d="M4 15h3l1.5-3 2 6 2-3 1.5 1.5h6"
      stroke="url(#dashOverviewGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      filter="url(#dashGlow)"
    />
    {/* Pulse dot */}
    <circle cx="20" cy="15.5" r="1.5" fill="#3b82f6">
      <animate attributeName="r" values="1.5;2.5;1.5" dur="1.2s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite" />
    </circle>
    {/* Stat numbers */}
    <text x="7.5" y="8" fontSize="3.5" fontWeight="bold" fill="url(#dashOverviewGrad)" textAnchor="middle" dominantBaseline="middle" opacity="0.9">98%</text>
    <text x="16.5" y="8" fontSize="3.5" fontWeight="bold" fill="url(#dashOverviewGrad)" textAnchor="middle" dominantBaseline="middle" opacity="0.9">2.1k</text>
    {/* Activity indicator */}
    <circle cx="18" cy="5.5" r="1" fill="var(--color-success)">
      <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
    </circle>
  </svg>
);

/**
 * Save Icon - Floppy disk with gradient
 * Use: Save actions, commit, persist
 */
export const SaveIcon: React.FC<IconProps> = ({ size = 20, className = '', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={style}>
    <defs>
      <linearGradient id="saveGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
      <filter id="saveGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="0.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    <path
      d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"
      stroke="url(#saveGrad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      filter="url(#saveGlow)"
    />
    <path d="M17 21v-8H7v8" stroke="url(#saveGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 3v5h8" stroke="url(#saveGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Monitoring
  ActivityIcon as Activity,
  CpuIcon as Cpu,
  DatabaseIcon as Database,
  ServerIcon as Server,
  // Analytics/Cost
  DollarIcon as DollarSign,
  TrendingUpIcon as TrendingUp,
  TimerIcon as Timer,
  ChartIcon as Chart,
  BarChartIcon as BarChart,
  BarChartIcon as BarChart2,
  // Energy/Action
  ZapIcon as Zap,
  RefreshIcon as RefreshCw,
  RefreshIcon as RotateCw,
  GitBranchIcon as GitBranch,
  // Status
  SuccessIcon as CheckCircle,
  ErrorIcon as XCircle,
  WarningIcon as AlertCircle,
  WarningIcon as AlertTriangle,
  // Security & User
  ShieldIcon as Shield,
  UserIcon as User,
  UsersIcon as Users,
  UserPlusIcon as UserPlus,
  UserMinusIcon as UserMinus,
  LockIcon as Lock,
  KeyIcon as Key,
  // Loading
  LoadingIcon as Loader,
  LoadingIcon as Loader2,
  // Toggle & Output
  ToggleOnIcon as ToggleRight,
  ToggleOffIcon as ToggleLeft,
  FileOutputIcon as FileOutput,
  // Admin Sidebar Icons
  CogIcon as Cog,
  CogIcon as Settings,
  CubeIcon as Cube,
  LogsIcon as Logs,
  GridIcon as Grid,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  TerminalIcon as Terminal,
  PromptIcon as Prompt,
  PromptIcon as MessageSquare,
  TemplateIcon as Template,
  NetworkIcon as Network,
  BookIcon as Book,
  CodeIcon as Code,
  APIIcon as API,
  ClockIcon as Clock,
  // Action & UI Icons
  PlayIcon as Play,
  StopIcon as Square,
  StopIcon as Stop,
  TrashIcon as Trash,
  TrashIcon as Trash2,
  EyeIcon as Eye,
  PlusIcon as Plus,
  SearchIcon as Search,
  FilterIcon as Filter,
  ExternalLinkIcon as ExternalLink,
  EditIcon as Edit,
  EditIcon as Pencil,
  CopyIcon as Copy,
  DownloadIcon as Download,
  UploadIcon as Upload,
  BuildingIcon as Building,
  BuildingIcon as Building2,
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  ArrowLeftIcon as ArrowLeft,
  CalendarIcon as Calendar,
  CloseIcon as X,
  CloseIcon as Close,
  MaximizeIcon as Maximize,
  MaximizeIcon as Maximize2,
  MailIcon as Mail,
  SparklesIcon as Sparkles,
  BeakerIcon as Beaker,
  // Save & Reset
  SaveIcon as Save,
  RefreshIcon as RotateCcw,
  SuccessIcon as Check,
};

export default {
  Activity: ActivityIcon,
  Cpu: CpuIcon,
  Database: DatabaseIcon,
  Server: ServerIcon,
  DollarSign: DollarIcon,
  TrendingUp: TrendingUpIcon,
  Timer: TimerIcon,
  Chart: ChartIcon,
  BarChart: BarChartIcon,
  BarChart2: BarChartIcon,
  Zap: ZapIcon,
  RefreshCw: RefreshIcon,
  RotateCw: RefreshIcon,
  GitBranch: GitBranchIcon,
  CheckCircle: SuccessIcon,
  XCircle: ErrorIcon,
  AlertCircle: WarningIcon,
  AlertTriangle: WarningIcon,
  Shield: ShieldIcon,
  User: UserIcon,
  Users: UsersIcon,
  UserPlus: UserPlusIcon,
  UserMinus: UserMinusIcon,
  Lock: LockIcon,
  Key: KeyIcon,
  Loader: LoadingIcon,
  Loader2: LoadingIcon,
  ToggleRight: ToggleOnIcon,
  ToggleLeft: ToggleOffIcon,
  FileOutput: FileOutputIcon,
  // Admin Sidebar Icons
  Cog: CogIcon,
  Settings: CogIcon,
  Cube: CubeIcon,
  Logs: LogsIcon,
  Grid: GridIcon,
  Folder: FolderIcon,
  FolderOpen: FolderOpenIcon,
  Terminal: TerminalIcon,
  Prompt: PromptIcon,
  MessageSquare: PromptIcon,
  Template: TemplateIcon,
  Network: NetworkIcon,
  Book: BookIcon,
  Code: CodeIcon,
  API: APIIcon,
  Clock: ClockIcon,
  // Action & UI Icons
  Play: PlayIcon,
  Square: StopIcon,
  Stop: StopIcon,
  Trash: TrashIcon,
  Trash2: TrashIcon,
  Eye: EyeIcon,
  Plus: PlusIcon,
  Search: SearchIcon,
  Filter: FilterIcon,
  ExternalLink: ExternalLinkIcon,
  Edit: EditIcon,
  Pencil: EditIcon,
  Copy: CopyIcon,
  Download: DownloadIcon,
  Upload: UploadIcon,
  Building: BuildingIcon,
  Building2: BuildingIcon,
  ChevronDown: ChevronDownIcon,
  ChevronRight: ChevronRightIcon,
  ArrowLeft: ArrowLeftIcon,
  Calendar: CalendarIcon,
  X: CloseIcon,
  Close: CloseIcon,
  Maximize: MaximizeIcon,
  Maximize2: MaximizeIcon,
  Mail: MailIcon,
  Sparkles: SparklesIcon,
  Beaker: BeakerIcon,
  Save: SaveIcon,
  RotateCcw: RefreshIcon,
  Check: SuccessIcon,
};
