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

/**
 * AWCode Active Sessions View
 *
 * Admin panel view for monitoring and managing AWCode CLI sessions.
 * Features:
 * - Matrix-style CRT terminal thumbnails with animated static
 * - Live CPU/memory metrics per session
 * - Session kill/restart controls
 *
 * Note: Settings and Metrics have been moved to separate Admin Console sections:
 * - Settings: AWCodeSettingsView.tsx (Admin Console > Openagentic > Settings)
 * - Metrics: CodeModeMetricsDashboard.tsx (Admin Console > Openagentic > Metrics)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
// Basic UI icons from lucide
import {
  Monitor, Code, Users, Trash2, Play, RotateCcw, Eye, Terminal,
  MessageSquare, BarChart, ChevronDown, ChevronUp, Maximize2, X,
  Settings, HardDrive, Layers, Save, Brain, FileCode, Edit3,
  PlayCircle, Globe, ExternalLink, Wifi, WifiOff, FileText, Info,
  Shield
} from '@/shared/icons';
import { SlideInPanel, SlideInPanelSection, SlideInPanelField, SlideInPanelFooter } from '@/shared/components/SlideInPanel';
// Custom badass OpenAgentic icons
import {
  RefreshCw, Activity, Cpu, Timer as Clock, Zap, AlertTriangle,
  CheckCircle, XCircle, Database, TrendingUp
} from '../Shared/AdminIcons';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { apiRequest } from '@/utils/api';

// Session interface with process metrics
// Activity states from the new Code Mode protocol
type ActivityState = 'idle' | 'thinking' | 'writing' | 'editing' | 'executing' | 'artifact' | 'error';

interface AWCodeSession {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  status: 'running' | 'idle' | 'stopped' | 'error';
  model: string;
  workspacePath: string;
  createdAt: string;
  lastActivity: string;
  pid?: number;
  // Metrics
  messageCount?: number;
  tokenCount?: number;
  toolCallCount?: number;
  contextUsagePercent?: number;
  // Process metrics
  metrics?: {
    cpu: number;
    memory: number;
    memoryMB: number;
    elapsed: number;
  } | null;
  // Storage metrics
  storageMB?: number;
  storagePercent?: number;
  storageLimitMB?: number;
  // Live state - updated for new Code Mode
  currentActivity?: string;
  activityState?: ActivityState;
  lastOutput?: string;
  // New Code Mode fields
  activeArtifact?: {
    type: string;
    name: string;
    url?: string;
    port?: number;
  };
  writingFile?: string;
  executingCommand?: string;
  eventClients?: number; // Number of WebSocket event clients connected
}

interface AWCodeSettings {
  defaultModel: string;
  sessionIdleTimeout: number;
  sessionMaxLifetime: number;
  maxSessionsPerUser: number;
  defaultSecurityLevel: 'strict' | 'permissive' | 'minimal';
  defaultNetworkEnabled: boolean;
  defaultCpuLimit: number;
  defaultMemoryLimitMb: number;
  enabledForNewUsers: boolean;
  // New Code Mode settings
  enableNewCodeModeUI: boolean;
  codeModeDefaultView: 'conversation' | 'terminal';
  artifactSandboxLevel: 'strict' | 'permissive' | 'none';
  artifactMaxPreviewSize: number; // MB
  enableArtifactAutoPreview: boolean;
  enableActivityVisualization: boolean;
}

interface AWCodeSessionsViewProps {
  theme: string;
}

// Matrix rain character component for CRT effect
const MatrixRain: React.FC<{ active: boolean }> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789';
    const fontSize = 10;
    const columns = Math.floor(canvas.width / fontSize);
    const drops: number[] = Array(columns).fill(1);

    // Get terminal colors from CSS variables
    const styles = getComputedStyle(document.documentElement);
    const terminalBg = styles.getPropertyValue('--color-background').trim() || '#0d1117';
    const terminalText = styles.getPropertyValue('--color-success').trim() || 'var(--color-success)';

    const draw = () => {
      ctx.fillStyle = `color-mix(in srgb, ${terminalBg} 95%, transparent)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = terminalText;
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.globalAlpha = Math.random() * 0.5 + 0.1;
        ctx.fillStyle = terminalText;
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        ctx.globalAlpha = 1;

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    const interval = setInterval(draw, 50);
    return () => clearInterval(interval);
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={96}
      className="absolute inset-0 opacity-30 pointer-events-none"
    />
  );
};

// Static noise overlay for CRT effect
const StaticNoise: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const noise = Math.random() * 30;
        data[i] = noise;     // R
        data[i + 1] = noise; // G
        data[i + 2] = noise; // B
        data[i + 3] = 15;    // A (very transparent)
      }

      ctx.putImageData(imageData, 0, 0);
    };

    const interval = setInterval(draw, 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={48}
      className="absolute inset-0 w-full h-full opacity-50 pointer-events-none mix-blend-overlay"
    />
  );
};

// CRT Monitor frame with matrix effect
const CRTFrame: React.FC<{ children: React.ReactNode; status: string; showMatrix?: boolean }> = ({
  children,
  status,
  showMatrix = true
}) => {
  // Use CSS variable classes for status colors
  const statusColorClasses = {
    running: 'var(--ap-status-running, var(--color-success))',
    idle: 'var(--ap-status-idle, var(--color-warning))',
    stopped: 'var(--ap-status-stopped, var(--color-textMuted))',
    error: 'var(--ap-status-error, var(--color-error))'
  };
  const glowColor = statusColorClasses[status as keyof typeof statusColorClasses] || statusColorClasses.stopped;

  return (
    <div className="relative">
      {/* CRT outer bezel */}
      <div
        className="rounded-lg p-2"
        style={{
          background: 'linear-gradient(145deg, var(--color-surfaceSecondary), var(--color-background))',
          boxShadow: `0 0 20px color-mix(in srgb, ${glowColor} 20%, transparent), inset 0 2px 4px color-mix(in srgb, var(--color-text) 10%, transparent)`
        }}
      >
        {/* CRT screen */}
        <div
          className="relative rounded overflow-hidden"
          style={{
            background: 'var(--color-background)',
            boxShadow: `inset 0 0 60px color-mix(in srgb, black 80%, transparent), 0 0 10px color-mix(in srgb, ${glowColor} 13%, transparent)`
          }}
        >
          {/* Matrix rain effect */}
          {showMatrix && status === 'running' && <MatrixRain active={true} />}

          {/* Static noise */}
          <StaticNoise />

          {/* Scanline effect */}
          <div
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              background: 'repeating-linear-gradient(0deg, color-mix(in srgb, black 15%, transparent) 0px, color-mix(in srgb, black 15%, transparent) 1px, transparent 1px, transparent 2px)',
              opacity: 0.4
            }}
          />

          {/* Screen curvature */}
          <div
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              background: 'radial-gradient(ellipse at center, transparent 0%, color-mix(in srgb, black 30%, transparent) 100%)'
            }}
          />

          {/* Flicker effect */}
          <div
            className="absolute inset-0 pointer-events-none z-10 animate-pulse"
            style={{
              background: 'color-mix(in srgb, var(--color-text) 1%, transparent)',
              animation: 'flicker 0.15s infinite'
            }}
          />

          {/* Content */}
          <div className="relative z-20">{children}</div>
        </div>
      </div>

      {/* Power LED */}
      <div
        className="absolute bottom-1 right-3 w-2 h-2 rounded-full animate-pulse"
        style={{
          backgroundColor: glowColor,
          boxShadow: `0 0 8px ${glowColor}`
        }}
      />
    </div>
  );
};

// Activity state indicator component
const ActivityStateIndicator: React.FC<{
  state?: ActivityState;
  writingFile?: string;
  executingCommand?: string;
  artifact?: AWCodeSession['activeArtifact'];
}> = ({ state, writingFile, executingCommand, artifact }) => {
  const stateConfig: Record<ActivityState, { icon: React.ReactNode; label: string; colorVar: string }> = {
    idle: { icon: <CheckCircle size={12} />, label: 'Ready', colorVar: 'var(--color-text-secondary)' },
    thinking: { icon: <Brain size={12} />, label: 'Thinking...', colorVar: 'var(--ap-info)' },
    writing: { icon: <FileCode size={12} />, label: `Writing ${writingFile || 'code'}`, colorVar: 'var(--ap-success)' },
    editing: { icon: <Edit3 size={12} />, label: 'Editing', colorVar: 'var(--color-primary)' },
    executing: { icon: <PlayCircle size={12} />, label: executingCommand ? `Running: ${executingCommand.slice(0, 30)}` : 'Executing...', colorVar: 'var(--ap-warning)' },
    artifact: { icon: <Globe size={12} />, label: artifact?.name || 'Artifact Ready', colorVar: 'var(--color-primary)' },
    error: { icon: <AlertTriangle size={12} />, label: 'Error', colorVar: 'var(--ap-error)' },
  };

  const config = stateConfig[state || 'idle'];
  const isActive = state && state !== 'idle';

  return (
    <div className="flex items-center gap-1.5" style={{ color: config.colorVar }}>
      {isActive && <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
      </span>}
      {config.icon}
      <span className="truncate text-xs">{config.label}</span>
    </div>
  );
};

// Terminal preview with process metrics
const TerminalPreview: React.FC<{
  output: string;
  activity?: string;
  activityState?: ActivityState;
  metrics?: AWCodeSession['metrics'];
  expanded?: boolean;
  writingFile?: string;
  executingCommand?: string;
  artifact?: AWCodeSession['activeArtifact'];
  eventClients?: number;
}> = ({ output, activity, activityState, metrics, expanded = false, writingFile, executingCommand, artifact, eventClients }) => {
  const lines = (output || '').split('\n').slice(-10);

  return (
    <div className={`font-mono text-xs p-2 ${expanded ? 'h-64' : 'h-24'} overflow-hidden`}>
      {/* Header bar with metrics and activity state */}
      <div className="flex items-center justify-between mb-1 pb-1 text-xs" style={{ borderBottom: '1px solid color-mix(in srgb, var(--ap-success) 20%, transparent)' }}>
        <div className="flex items-center gap-3">
          {metrics && (
            <>
              <span className="flex items-center gap-1" style={{ color: 'var(--color-primary)' }}>
                <Cpu size={10} />
                {metrics.cpu.toFixed(1)}%
              </span>
              <span className="flex items-center gap-1" style={{ color: 'var(--ap-info)' }}>
                <HardDrive size={10} />
                {metrics.memoryMB.toFixed(0)}MB
              </span>
            </>
          )}
          {eventClients !== undefined && eventClients > 0 && (
            <span className="flex items-center gap-1" style={{ color: 'var(--ap-success)' }} title="WebSocket clients connected">
              <Wifi size={10} />
              {eventClients}
            </span>
          )}
        </div>
        <ActivityStateIndicator
          state={activityState}
          writingFile={writingFile}
          executingCommand={executingCommand}
          artifact={artifact}
        />
      </div>

      {/* Legacy activity display (fallback) */}
      {!activityState && activity && (
        <div className="mb-1 flex items-center gap-1" style={{ color: 'var(--ap-success)' }}>
          <span className="animate-pulse">●</span>
          <span className="truncate">{activity}</span>
        </div>
      )}

      {/* Artifact preview hint */}
      {activityState === 'artifact' && artifact?.url && (
        <div className="mb-1 flex items-center gap-1" style={{ color: 'var(--color-primary)' }}>
          <Globe size={10} />
          <a href={artifact.url} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">
            {artifact.url}
          </a>
          <ExternalLink size={10} />
        </div>
      )}

      <div style={{ color: 'var(--color-text)', textShadow: '0 0 2px color-mix(in srgb, var(--color-text) 50%, transparent)' }}>
        {lines.length > 0 ? (
          lines.map((line, i) => (
            <div key={i} className="truncate opacity-80 hover:opacity-100">
              {line || '\u00A0'}
            </div>
          ))
        ) : (
          <div style={{ color: 'var(--color-text-secondary)' }} className="italic">Awaiting signal...</div>
        )}
      </div>

      {/* Blinking cursor */}
      <span className="inline-block w-2 h-3 animate-pulse ml-1" style={{ backgroundColor: 'var(--ap-success)' }} />
    </div>
  );
};

// Session card with restart and enhanced metrics
const SessionCard: React.FC<{
  session: AWCodeSession;
  onKill: (id: string) => void;
  onRestart: (id: string) => void;
  onView: (id: string) => void;
  onEdit: (session: AWCodeSession) => void;
  onViewLogs: (id: string) => void;
  onViewPodInfo: (id: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}> = ({ session, onKill, onRestart, onView, onEdit, onViewLogs, onViewPodInfo, isExpanded, onToggleExpand }) => {
  const statusConfig = {
    running: { colorVar: 'var(--ap-success)', bgVar: 'color-mix(in srgb, var(--ap-success) 10%, transparent)', icon: CheckCircle, label: 'Running' },
    idle: { colorVar: 'var(--ap-warning)', bgVar: 'color-mix(in srgb, var(--ap-warning) 10%, transparent)', icon: Clock, label: 'Idle' },
    stopped: { colorVar: 'var(--color-text-secondary)', bgVar: 'color-mix(in srgb, var(--color-text-secondary) 10%, transparent)', icon: XCircle, label: 'Stopped' },
    error: { colorVar: 'var(--ap-error)', bgVar: 'color-mix(in srgb, var(--ap-error) 10%, transparent)', icon: AlertTriangle, label: 'Error' }
  };

  const config = statusConfig[session.status] || statusConfig.stopped;
  const StatusIcon = config.icon;

  const formatDuration = (start: string) => {
    const ms = Date.now() - new Date(start).getTime();
    const mins = Math.floor(ms / 60000);
    const hours = Math.floor(mins / 60);
    if (hours > 0) return `${hours}h ${mins % 60}m`;
    return `${mins}m`;
  };

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: config.bgVar }}>
            <Terminal size={20} style={{ color: config.colorVar }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-text-primary">
                {session.userName || session.userEmail || session.userId}
              </p>
              <span className="px-2 py-0.5 text-xs rounded-full flex items-center gap-1" style={{ backgroundColor: config.bgVar, color: config.colorVar }}>
                <StatusIcon size={12} />
                {config.label}
              </span>
            </div>
            <p className="text-sm text-text-secondary flex items-center gap-2">
              <Cpu size={12} />
              {session.model}
              <span className="text-text-tertiary">•</span>
              <Clock size={12} />
              {formatDuration(session.createdAt)}
              {session.metrics && (
                <>
                  <span className="text-text-tertiary">•</span>
                  <span style={{ color: 'var(--color-primary)' }}>{session.metrics.cpu.toFixed(1)}% CPU</span>
                  <span style={{ color: 'var(--ap-info)' }}>{session.metrics.memoryMB.toFixed(0)}MB</span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onView(session.id)}
            className="ap-icon-btn ap-icon-btn-default"
            title="View full terminal"
          >
            <Maximize2 size={16} />
          </button>
          <button
            onClick={() => onEdit(session)}
            className="ap-icon-btn ap-icon-btn-primary"
            title="Edit session"
          >
            <Edit3 size={16} />
          </button>
          <button
            onClick={() => onViewLogs(session.id)}
            className="ap-icon-btn ap-icon-btn-info"
            title="View container logs"
          >
            <FileText size={16} />
          </button>
          <button
            onClick={() => onViewPodInfo(session.id)}
            className="ap-icon-btn ap-icon-btn-info"
            title="Pod info (audit)"
          >
            <Info size={16} />
          </button>
          <button
            onClick={() => onRestart(session.id)}
            className="ap-icon-btn ap-icon-btn-primary"
            title="Restart session"
          >
            <RotateCcw size={16} />
          </button>
          <button
            onClick={() => onKill(session.id)}
            className="ap-icon-btn ap-icon-btn-error"
            title="Kill session"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={onToggleExpand}
            className="ap-icon-btn ap-icon-btn-default"
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* CRT Terminal Preview */}
      <div className="p-4">
        <CRTFrame status={session.status}>
          <TerminalPreview
            output={session.lastOutput || ''}
            activity={session.currentActivity}
            activityState={session.activityState}
            metrics={session.metrics}
            expanded={isExpanded}
            writingFile={session.writingFile}
            executingCommand={session.executingCommand}
            artifact={session.activeArtifact}
            eventClients={session.eventClients}
          />
        </CRTFrame>
      </div>

      {/* Metrics bar */}
      <div className="px-4 pb-4 grid grid-cols-5 gap-2">
        <div className="text-center p-2 rounded-lg bg-white/5">
          <MessageSquare size={14} className="mx-auto mb-1" style={{ color: 'var(--color-primary)' }} />
          <p className="text-xs text-text-secondary">Messages</p>
          <p className="font-mono text-sm text-text-primary">{session.messageCount || 0}</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-white/5">
          <Zap size={14} className="mx-auto mb-1" style={{ color: 'var(--ap-warning)' }} />
          <p className="text-xs text-text-secondary">Tokens</p>
          <p className="font-mono text-sm text-text-primary">{(session.tokenCount || 0).toLocaleString()}</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-white/5">
          <Activity size={14} className="mx-auto mb-1" style={{ color: 'var(--ap-info)' }} />
          <p className="text-xs text-text-secondary">Tool Calls</p>
          <p className="font-mono text-sm text-text-primary">{session.toolCallCount || 0}</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-white/5">
          <BarChart size={14} className="mx-auto mb-1" style={{ color: 'var(--ap-success)' }} />
          <p className="text-xs text-text-secondary">Context</p>
          <p className="font-mono text-sm text-text-primary">{session.contextUsagePercent || 0}%</p>
        </div>
        <div
          className="text-center p-2 rounded-lg"
          style={{
            backgroundColor: (session.storagePercent || 0) >= 90
              ? 'color-mix(in srgb, var(--ap-error) 10%, transparent)'
              : (session.storagePercent || 0) >= 75
                ? 'color-mix(in srgb, var(--ap-warning) 10%, transparent)'
                : 'rgba(255,255,255,0.05)'
          }}
        >
          <HardDrive
            size={14}
            className="mx-auto mb-1"
            style={{
              color: (session.storagePercent || 0) >= 90
                ? 'var(--ap-error)'
                : (session.storagePercent || 0) >= 75
                  ? 'var(--ap-warning)'
                  : 'var(--color-primary)'
            }}
          />
          <p className="text-xs text-text-secondary">Disk</p>
          <p
            className="font-mono text-sm"
            style={{
              color: (session.storagePercent || 0) >= 90
                ? 'var(--ap-error)'
                : (session.storagePercent || 0) >= 75
                  ? 'var(--ap-warning)'
                  : 'var(--color-text)'
            }}
          >
            {session.storageMB || 0}MB
          </p>
          <p
            className="text-xs"
            style={{
              color: (session.storagePercent || 0) >= 90
                ? 'var(--ap-error)'
                : (session.storagePercent || 0) >= 75
                  ? 'var(--ap-warning)'
                  : 'var(--color-text-tertiary)'
            }}
          >
            {session.storagePercent || 0}%
          </p>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-white/5 pt-4 space-y-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-text-secondary">Session ID</p>
              <p className="font-mono text-text-primary text-xs">{session.id}</p>
            </div>
            <div>
              <p className="text-text-secondary">PID</p>
              <p className="font-mono text-text-primary">{session.pid || 'N/A'}</p>
            </div>
            <div>
              <p className="text-text-secondary">Workspace</p>
              <p className="font-mono text-text-primary text-xs truncate">{session.workspacePath}</p>
            </div>
            <div>
              <p className="text-text-secondary">Last Activity</p>
              <p className="text-text-primary text-xs">
                {new Date(session.lastActivity).toLocaleString()}
              </p>
            </div>
          </div>
          {/* Storage details */}
          {session.storageMB !== undefined && (
            <div className="mt-3 p-3 rounded-lg bg-surface-secondary">
              <div className="flex items-center justify-between mb-2">
                <p className="text-text-secondary text-xs flex items-center gap-1">
                  <HardDrive size={12} />
                  Workspace Storage
                </p>
                <span
                  className="text-xs font-medium"
                  style={{
                    color: (session.storagePercent || 0) >= 90
                      ? 'var(--ap-error)'
                      : (session.storagePercent || 0) >= 75
                        ? 'var(--ap-warning)'
                        : 'var(--color-text)'
                  }}
                >
                  {session.storageMB}MB / {session.storageLimitMB || 5120}MB
                </span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${Math.min(session.storagePercent || 0, 100)}%`,
                    backgroundColor: (session.storagePercent || 0) >= 90
                      ? 'var(--ap-error)'
                      : (session.storagePercent || 0) >= 75
                        ? 'var(--ap-warning)'
                        : 'var(--color-primary)'
                  }}
                />
              </div>
              {(session.storagePercent || 0) >= 75 && (
                <p
                  className="text-xs mt-2"
                  style={{
                    color: (session.storagePercent || 0) >= 90
                      ? 'var(--ap-error)'
                      : 'var(--ap-warning)'
                  }}
                >
                  {(session.storagePercent || 0) >= 90
                    ? 'Critical: Workspace is almost full. User should clean up or use GitHub.'
                    : 'Warning: Workspace storage is filling up.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Available models interface
interface AvailableModel {
  id: string;
  name: string;
  providerId: string;
  available: boolean;
}

// Settings Panel
const SettingsPanel: React.FC<{
  settings: AWCodeSettings | null;
  onSave: (settings: Partial<AWCodeSettings>) => Promise<void>;
  loading: boolean;
}> = ({ settings, onSave, loading }) => {
  const [localSettings, setLocalSettings] = useState<Partial<AWCodeSettings>>({});
  const [saving, setSaving] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  // Fetch available models from openagentic config
  useEffect(() => {
    const fetchModels = async () => {
      setModelsLoading(true);
      try {
        const response = await apiRequest('/openagentic/config');
        if (response.ok) {
          const data = await response.json();
          setAvailableModels(data.models || []);
        }
      } catch (err) {
        console.error('Failed to fetch available models:', err);
        // No fallback - show empty list so user knows there's a configuration issue
        setAvailableModels([]);
      } finally {
        setModelsLoading(false);
      }
    };
    fetchModels();
  }, []);

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(localSettings);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto" />
        <p className="text-text-secondary mt-4">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Settings size={20} className="text-primary-500" />
          AWCode Configuration
        </h3>

        <div className="grid grid-cols-2 gap-6">
          {/* Default Model */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Default Model
            </label>
            <select
              value={localSettings.defaultModel || ''}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultModel: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
              disabled={modelsLoading}
            >
              {modelsLoading ? (
                <option value="">Loading models...</option>
              ) : availableModels.length === 0 ? (
                <option value="">No models available</option>
              ) : (
                availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))
              )}
            </select>
            {!modelsLoading && localSettings.defaultModel && !availableModels.find(m => m.id === localSettings.defaultModel) && (
              <p className="text-xs mt-1" style={{ color: 'var(--ap-warning)' }}>
                Current setting "{localSettings.defaultModel}" is not in available models list
              </p>
            )}
          </div>

          {/* Max Sessions Per User */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Max Sessions Per User
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={localSettings.maxSessionsPerUser || 3}
              onChange={(e) => setLocalSettings({ ...localSettings, maxSessionsPerUser: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Session Idle Timeout */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Idle Timeout (seconds)
            </label>
            <input
              type="number"
              min={300}
              max={7200}
              step={60}
              value={localSettings.sessionIdleTimeout || 1800}
              onChange={(e) => setLocalSettings({ ...localSettings, sessionIdleTimeout: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Max Session Lifetime */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Max Lifetime (seconds)
            </label>
            <input
              type="number"
              min={3600}
              max={86400}
              step={3600}
              value={localSettings.sessionMaxLifetime || 14400}
              onChange={(e) => setLocalSettings({ ...localSettings, sessionMaxLifetime: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Security Level */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Default Security Level
            </label>
            <select
              value={localSettings.defaultSecurityLevel || 'permissive'}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultSecurityLevel: e.target.value as AWCodeSettings['defaultSecurityLevel'] })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            >
              <option value="strict">Strict (Limited access)</option>
              <option value="permissive">Permissive (Default)</option>
              <option value="minimal">Minimal (Full access)</option>
            </select>
          </div>

          {/* CPU Limit */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              CPU Limit (cores)
            </label>
            <input
              type="number"
              min={0.5}
              max={8}
              step={0.5}
              value={localSettings.defaultCpuLimit || 2}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultCpuLimit: parseFloat(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Memory Limit */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Memory Limit (MB)
            </label>
            <input
              type="number"
              min={512}
              max={8192}
              step={256}
              value={localSettings.defaultMemoryLimitMb || 2048}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultMemoryLimitMb: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Network Enabled */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="networkEnabled"
              checked={localSettings.defaultNetworkEnabled ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultNetworkEnabled: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="networkEnabled" className="text-sm text-text-secondary">
              Enable Network Access by Default
            </label>
          </div>

          {/* Enabled for New Users */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enabledForNewUsers"
              checked={localSettings.enabledForNewUsers ?? false}
              onChange={(e) => setLocalSettings({ ...localSettings, enabledForNewUsers: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="enabledForNewUsers" className="text-sm text-text-secondary">
              Enable AWCode for New Users
            </label>
          </div>
        </div>
      </div>

      {/* New Code Mode Settings Section */}
      <div className="glass-card p-6 mt-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Code size={20} style={{ color: 'var(--ap-success)' }} />
          Code Mode UI Settings
        </h3>

        <div className="grid grid-cols-2 gap-6">
          {/* Enable New Code Mode UI */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enableNewCodeModeUI"
              checked={localSettings.enableNewCodeModeUI ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, enableNewCodeModeUI: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="enableNewCodeModeUI" className="text-sm text-text-secondary">
              Enable New Code Mode UI (Three-Panel Layout)
            </label>
          </div>

          {/* Enable Activity Visualization */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enableActivityVisualization"
              checked={localSettings.enableActivityVisualization ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, enableActivityVisualization: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="enableActivityVisualization" className="text-sm text-text-secondary">
              Enable Real-time Activity Visualization
            </label>
          </div>

          {/* Default View */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Default Code Mode View
            </label>
            <select
              value={localSettings.codeModeDefaultView || 'conversation'}
              onChange={(e) => setLocalSettings({ ...localSettings, codeModeDefaultView: e.target.value as 'conversation' | 'terminal' })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            >
              <option value="conversation">Conversation (New UI)</option>
              <option value="terminal">Terminal (Legacy)</option>
            </select>
          </div>

          {/* Artifact Sandbox Level */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Artifact Sandbox Level
            </label>
            <select
              value={localSettings.artifactSandboxLevel || 'strict'}
              onChange={(e) => setLocalSettings({ ...localSettings, artifactSandboxLevel: e.target.value as 'strict' | 'permissive' | 'none' })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            >
              <option value="strict">Strict (Recommended)</option>
              <option value="permissive">Permissive (Allow more APIs)</option>
              <option value="none">None (Full access - Not recommended)</option>
            </select>
          </div>

          {/* Artifact Max Preview Size */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Max Artifact Preview Size (MB)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={localSettings.artifactMaxPreviewSize || 10}
              onChange={(e) => setLocalSettings({ ...localSettings, artifactMaxPreviewSize: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </div>

          {/* Enable Artifact Auto Preview */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enableArtifactAutoPreview"
              checked={localSettings.enableArtifactAutoPreview ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, enableArtifactAutoPreview: e.target.checked })}
              className="rounded border-border-hover"
            />
            <label htmlFor="enableArtifactAutoPreview" className="text-sm text-text-secondary">
              Auto-Preview Artifacts When Ready
            </label>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg ap-bg-info" style={{ borderColor: 'color-mix(in srgb, var(--ap-info) 20%, transparent)', borderWidth: '1px', borderStyle: 'solid' }}>
          <p className="text-sm flex items-center gap-2" style={{ color: 'var(--ap-info)' }}>
            <Globe size={14} />
            The new Code Mode UI uses WebSocket streaming via <code className="px-1 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--ap-info) 20%, transparent)' }}>/ws/events</code> for real-time activity visualization.
          </p>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Metrics Dashboard
const MetricsDashboard: React.FC<{
  stats: any;
  loading: boolean;
}> = ({ stats, loading }) => {
  if (loading) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto" />
        <p className="text-text-secondary mt-4">Loading metrics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-5 gap-4">
        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}>
              <Users size={24} style={{ color: 'var(--color-primary)' }} />
            </div>
            <div>
              <p className="text-3xl font-bold text-text-primary">{stats?.users?.enabled || 0}</p>
              <p className="text-sm text-text-secondary">Users Enabled</p>
              <p className="text-xs text-text-tertiary">{stats?.users?.enabledPercentage || 0}% of total</p>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'color-mix(in srgb, var(--ap-success) 10%, transparent)' }}>
              <Activity size={24} style={{ color: 'var(--ap-success)' }} />
            </div>
            <div>
              <p className="text-3xl font-bold text-text-primary">{stats?.sessions?.active || 0}</p>
              <p className="text-sm text-text-secondary">Active Sessions</p>
              <p className="text-xs text-text-tertiary">{stats?.sessions?.total || 0} total</p>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}>
              <Wifi size={24} style={{ color: 'var(--color-primary)' }} />
            </div>
            <div>
              <p className="text-3xl font-bold text-text-primary">{stats?.websockets?.eventClients || 0}</p>
              <p className="text-sm text-text-secondary">Event Streams</p>
              <p className="text-xs text-text-tertiary">{stats?.websockets?.terminalClients || 0} terminal</p>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'color-mix(in srgb, var(--ap-info) 10%, transparent)' }}>
              <Zap size={24} style={{ color: 'var(--ap-info)' }} />
            </div>
            <div>
              <p className="text-3xl font-bold text-text-primary">{stats?.executions?.total || 0}</p>
              <p className="text-sm text-text-secondary">Total Executions</p>
              <p className="text-xs text-text-tertiary">{stats?.executions?.last24h || 0} in last 24h</p>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'color-mix(in srgb, var(--ap-warning) 10%, transparent)' }}>
              <Database size={24} style={{ color: 'var(--ap-warning)' }} />
            </div>
            <div>
              <p className="text-3xl font-bold text-text-primary">{stats?.storage?.totalMb || 0}</p>
              <p className="text-sm text-text-secondary">Storage (MB)</p>
              <p className="text-xs text-text-tertiary">Workspace snapshots</p>
            </div>
          </div>
        </div>
      </div>

      {/* Code Mode Activity Summary */}
      {stats?.codeMode && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Code size={20} style={{ color: 'var(--ap-success)' }} />
            Code Mode Activity
            <span className="px-2 py-0.5 text-xs rounded-full ap-badge ap-badge-success">Live</span>
          </h3>
          <div className="grid grid-cols-6 gap-4">
            <div className="p-4 rounded-lg bg-white/5 text-center">
              <Brain size={20} className="mx-auto mb-2" style={{ color: 'var(--ap-info)' }} />
              <p className="text-2xl font-bold text-text-primary">{stats.codeMode.thinking || 0}</p>
              <p className="text-xs text-text-secondary">Thinking</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 text-center">
              <FileCode size={20} className="mx-auto mb-2" style={{ color: 'var(--ap-success)' }} />
              <p className="text-2xl font-bold text-text-primary">{stats.codeMode.writing || 0}</p>
              <p className="text-xs text-text-secondary">Writing</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 text-center">
              <Edit3 size={20} className="mx-auto mb-2" style={{ color: 'var(--color-primary)' }} />
              <p className="text-2xl font-bold text-text-primary">{stats.codeMode.editing || 0}</p>
              <p className="text-xs text-text-secondary">Editing</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 text-center">
              <PlayCircle size={20} className="mx-auto mb-2" style={{ color: 'var(--ap-warning)' }} />
              <p className="text-2xl font-bold text-text-primary">{stats.codeMode.executing || 0}</p>
              <p className="text-xs text-text-secondary">Executing</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 text-center">
              <Globe size={20} className="mx-auto mb-2" style={{ color: 'var(--color-primary)' }} />
              <p className="text-2xl font-bold text-text-primary">{stats.codeMode.artifacts || 0}</p>
              <p className="text-xs text-text-secondary">Artifacts</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 text-center">
              <CheckCircle size={20} className="mx-auto mb-2" style={{ color: 'var(--color-text-secondary)' }} />
              <p className="text-2xl font-bold text-text-primary">{stats.codeMode.idle || 0}</p>
              <p className="text-xs text-text-secondary">Idle</p>
            </div>
          </div>
        </div>
      )}

      {/* Runtime Status */}
      {stats?.runtime && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Layers size={20} style={{ color: 'var(--color-primary)' }} />
            Runtime Status
          </h3>
          <div className="grid grid-cols-4 gap-4">
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-sm text-text-secondary">Status</p>
              <p
                className="text-lg font-medium"
                style={{ color: stats.runtime.status === 'healthy' ? 'var(--ap-success)' : 'var(--ap-error)' }}
              >
                {stats.runtime.status === 'healthy' ? 'Healthy' : 'Unhealthy'}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-sm text-text-secondary">CLI Version</p>
              <p className="text-lg font-medium text-text-primary">
                {stats.runtime.versions?.cli || 'Unknown'}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-sm text-text-secondary">SDK Version</p>
              <p className="text-lg font-medium text-text-primary">
                {stats.runtime.versions?.sdk || 'Unknown'}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-white/5">
              <p className="text-sm text-text-secondary">Event Stream</p>
              <p className="text-lg font-medium text-text-primary flex items-center gap-1">
                <Wifi size={14} style={{ color: stats.websockets?.eventClients > 0 ? 'var(--ap-success)' : 'var(--color-text-secondary)' }} />
                {stats.websockets?.eventClients > 0 ? 'Active' : 'Idle'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Full terminal modal
const FullTerminalModal: React.FC<{
  session: AWCodeSession | null;
  onClose: () => void;
}> = ({ session, onClose }) => {
  if (!session) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="w-full max-w-4xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Terminal style={{ color: 'var(--ap-success)' }} />
            <span className="text-white font-medium">
              {session.userName || session.userId} - {session.model}
            </span>
            {session.metrics && (
              <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                CPU: {session.metrics.cpu.toFixed(1)}% | RAM: {session.metrics.memoryMB.toFixed(0)}MB
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-white"
          >
            <X size={20} />
          </button>
        </div>
        <CRTFrame status={session.status} showMatrix={false}>
          <div className="h-96 p-4 font-mono text-sm overflow-auto" style={{ color: 'var(--color-text)' }}>
            <pre className="whitespace-pre-wrap">{session.lastOutput || 'No output available'}</pre>
          </div>
        </CRTFrame>
      </div>
    </div>
  );
};

// Main component
export const AWCodeSessionsView: React.FC<AWCodeSessionsViewProps> = ({ theme }) => {
  const confirm = useConfirm();
  const [sessions, setSessions] = useState<AWCodeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [viewingSession, setViewingSession] = useState<AWCodeSession | null>(null);

  // CRUD panel state
  const [logsPanel, setLogsPanel] = useState<{ open: boolean; sessionId: string | null; logs: string; loading: boolean }>({
    open: false, sessionId: null, logs: '', loading: false
  });
  const [podInfoPanel, setPodInfoPanel] = useState<{ open: boolean; sessionId: string | null; info: any; loading: boolean }>({
    open: false, sessionId: null, info: null, loading: false
  });
  const [editPanel, setEditPanel] = useState<{
    open: boolean;
    session: AWCodeSession | null;
    saving: boolean;
    form: {
      status: string;
      securityLevel: string;
      networkEnabled: boolean;
      cpuLimit: number;
      memoryLimitMb: number;
    };
  }>({
    open: false, session: null, saving: false,
    form: { status: '', securityLevel: 'strict', networkEnabled: false, cpuLimit: 1, memoryLimitMb: 512 }
  });

  // Fetch live sessions with metrics
  const fetchSessions = useCallback(async () => {
    try {
      const response = await apiRequest('/admin/code/sessions/live?metrics=true');

      if (response.ok) {
        const data = await response.json();
        setSessions(data);
        setError(null);
      } else {
        // Fallback to database sessions
        const dbResponse = await apiRequest('/admin/code/sessions');
        if (dbResponse.ok) {
          const dbData = await dbResponse.json();
          setSessions(dbData.sessions || []);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Auto-refresh for sessions
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchSessions, refreshInterval * 1000);
      return () => clearInterval(interval);
    }
  }, [fetchSessions, autoRefresh, refreshInterval]);

  const handleKillSession = async (sessionId: string) => {
    if (!await confirm('Are you sure you want to terminate this session?', { variant: 'danger', title: 'Terminate Session' })) return;

    try {
      const response = await apiRequest(`/admin/code/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchSessions();
      } else {
        alert('Failed to kill session');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleRestartSession = async (sessionId: string) => {
    if (!await confirm('Are you sure you want to restart this session?', { variant: 'primary', title: 'Restart Session' })) return;

    try {
      const response = await apiRequest(`/admin/code/sessions/${sessionId}/restart`, {
        method: 'POST',
      });

      if (response.ok) {
        await fetchSessions();
      } else {
        alert('Failed to restart session');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // Fetch container logs
  const handleViewLogs = async (sessionId: string) => {
    setLogsPanel({ open: true, sessionId, logs: '', loading: true });
    try {
      const response = await apiRequest(`/admin/code/exec/sessions/${sessionId}/logs?tailLines=500`);
      if (response.ok) {
        const data = await response.json();
        setLogsPanel(prev => ({ ...prev, logs: data.logs || 'No logs available', loading: false }));
      } else {
        setLogsPanel(prev => ({ ...prev, logs: 'Failed to fetch logs', loading: false }));
      }
    } catch (err: any) {
      setLogsPanel(prev => ({ ...prev, logs: `Error: ${err.message}`, loading: false }));
    }
  };

  // Fetch pod info for auditing
  const handleViewPodInfo = async (sessionId: string) => {
    setPodInfoPanel({ open: true, sessionId, info: null, loading: true });
    try {
      const response = await apiRequest(`/admin/code/exec/sessions/${sessionId}/pod-info`);
      if (response.ok) {
        const data = await response.json();
        setPodInfoPanel(prev => ({ ...prev, info: data, loading: false }));
      } else {
        setPodInfoPanel(prev => ({ ...prev, info: { error: 'Failed to fetch pod info' }, loading: false }));
      }
    } catch (err: any) {
      setPodInfoPanel(prev => ({ ...prev, info: { error: err.message }, loading: false }));
    }
  };

  // Open edit panel for a session
  const handleEditSession = (session: AWCodeSession) => {
    setEditPanel({
      open: true,
      session,
      saving: false,
      form: {
        status: session.status,
        securityLevel: 'strict', // Default - actual value would come from backend
        networkEnabled: false,
        cpuLimit: 1,
        memoryLimitMb: 512
      }
    });
  };

  // Save session edits
  const handleSaveSession = async () => {
    if (!editPanel.session) return;
    setEditPanel(prev => ({ ...prev, saving: true }));
    try {
      const response = await apiRequest(`/admin/code/sessions/${editPanel.session.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: editPanel.form.status,
          securityLevel: editPanel.form.securityLevel,
          networkEnabled: editPanel.form.networkEnabled,
          cpuLimit: editPanel.form.cpuLimit,
          memoryLimitMb: editPanel.form.memoryLimitMb
        })
      });
      if (response.ok) {
        setEditPanel(prev => ({ ...prev, open: false }));
        await fetchSessions();
      } else {
        alert('Failed to update session');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setEditPanel(prev => ({ ...prev, saving: false }));
    }
  };

  const toggleExpanded = (sessionId: string) => {
    setExpandedSessions(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const sessionStats = {
    total: sessions.length,
    running: sessions.filter(s => s.status === 'running').length,
    idle: sessions.filter(s => s.status === 'idle').length,
    totalTokens: sessions.reduce((acc, s) => acc + (s.tokenCount || 0), 0)
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold mb-2 text-text-primary flex items-center gap-2">
            <Terminal size={20} />
            Active Sessions
          </h2>
          <p className="text-xs text-text-secondary">
            Monitor and manage active Openagentic sessions. Use Settings and Metrics from the sidebar.
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-border-hover bg-transparent"
            />
            Auto-refresh
          </label>
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            disabled={!autoRefresh}
            className="px-2 py-1 rounded-lg bg-surface-secondary border border-white/10 text-sm text-text-primary"
          >
            <option value={5}>5s</option>
            <option value={10}>10s</option>
            <option value={30}>30s</option>
          </select>
          <button
            onClick={fetchSessions}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Sessions Content */}
      <>
          {/* Stats cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="glass-card p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 10%, transparent)' }}>
                  <Users size={20} style={{ color: 'var(--color-primary)' }} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-text-primary">{sessionStats.total}</p>
                  <p className="text-sm text-text-secondary">Total Sessions</p>
                </div>
              </div>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--ap-success) 10%, transparent)' }}>
                  <Activity size={20} style={{ color: 'var(--ap-success)' }} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-text-primary">{sessionStats.running}</p>
                  <p className="text-sm text-text-secondary">Running</p>
                </div>
              </div>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--ap-warning) 10%, transparent)' }}>
                  <Clock size={20} style={{ color: 'var(--ap-warning)' }} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-text-primary">{sessionStats.idle}</p>
                  <p className="text-sm text-text-secondary">Idle</p>
                </div>
              </div>
            </div>
            <div className="glass-card p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--ap-info) 10%, transparent)' }}>
                  <Zap size={20} style={{ color: 'var(--ap-info)' }} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-text-primary">{sessionStats.totalTokens.toLocaleString()}</p>
                  <p className="text-sm text-text-secondary">Total Tokens</p>
                </div>
              </div>
            </div>
          </div>

          {/* Sessions grid */}
          {loading ? (
            <div className="glass-card p-8 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4" />
              <p className="text-text-secondary">Loading sessions...</p>
            </div>
          ) : error ? (
            <div className="glass-card p-6 ap-bg-warning" style={{ borderColor: 'color-mix(in srgb, var(--ap-warning) 30%, transparent)', borderWidth: '1px', borderStyle: 'solid' }}>
              <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--ap-warning)' }}>
                <AlertTriangle size={18} />
                <span className="font-medium">Connection Info</span>
              </div>
              <p className="text-text-secondary">{error}</p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <div className="mb-4">
                <CRTFrame status="stopped">
                  <div className="h-32 flex items-center justify-center">
                    <div className="text-center">
                      <Terminal size={32} className="mx-auto mb-2" style={{ color: 'var(--color-text-secondary)' }} />
                      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No Signal</p>
                    </div>
                  </div>
                </CRTFrame>
              </div>
              <p className="text-text-secondary">No active AWCode sessions</p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onKill={handleKillSession}
                  onRestart={handleRestartSession}
                  onView={(id) => setViewingSession(sessions.find(s => s.id === id) || null)}
                  onEdit={handleEditSession}
                  onViewLogs={handleViewLogs}
                  onViewPodInfo={handleViewPodInfo}
                  isExpanded={expandedSessions.has(session.id)}
                  onToggleExpand={() => toggleExpanded(session.id)}
                />
              ))}
            </div>
          )}
        </>

      {/* Full terminal modal */}
      <FullTerminalModal
        session={viewingSession}
        onClose={() => setViewingSession(null)}
      />

      {/* CSS for flicker animation */}
      <style>{`
        @keyframes flicker {
          0%, 100% { opacity: 0.01; }
          50% { opacity: 0.02; }
        }
      `}</style>

      {/* Logs Slide-In Panel */}
      <SlideInPanel
        isOpen={logsPanel.open}
        onClose={() => setLogsPanel(prev => ({ ...prev, open: false }))}
        title="Container Logs"
        subtitle={logsPanel.sessionId ? `Session: ${logsPanel.sessionId.slice(0, 8)}...` : undefined}
        width="lg"
      >
        <SlideInPanelSection title="Log Output" icon={<FileText size={16} />}>
          {logsPanel.loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={24} className="animate-spin text-primary-500" />
              <span className="ml-2 text-text-secondary">Loading logs...</span>
            </div>
          ) : (
            <pre className="bg-surface-secondary rounded-lg p-4 text-xs font-mono text-text-primary overflow-auto max-h-[600px] whitespace-pre-wrap">
              {logsPanel.logs}
            </pre>
          )}
        </SlideInPanelSection>
        <SlideInPanelFooter>
          <button
            onClick={() => logsPanel.sessionId && handleViewLogs(logsPanel.sessionId)}
            className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-2"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </SlideInPanelFooter>
      </SlideInPanel>

      {/* Pod Info Slide-In Panel */}
      <SlideInPanel
        isOpen={podInfoPanel.open}
        onClose={() => setPodInfoPanel(prev => ({ ...prev, open: false }))}
        title="Pod Information"
        subtitle="Kubernetes pod details for auditing"
        width="lg"
      >
        <SlideInPanelSection title="Pod Details" icon={<Info size={16} />}>
          {podInfoPanel.loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={24} className="animate-spin text-primary-500" />
              <span className="ml-2 text-text-secondary">Loading pod info...</span>
            </div>
          ) : podInfoPanel.info?.error ? (
            <div style={{ color: 'var(--ap-error)' }}>{podInfoPanel.info.error}</div>
          ) : (
            <pre className="bg-surface-secondary rounded-lg p-4 text-xs font-mono text-text-primary overflow-auto max-h-[600px]">
              {JSON.stringify(podInfoPanel.info, null, 2)}
            </pre>
          )}
        </SlideInPanelSection>
        <SlideInPanelFooter>
          <button
            onClick={() => podInfoPanel.sessionId && handleViewPodInfo(podInfoPanel.sessionId)}
            className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-2"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </SlideInPanelFooter>
      </SlideInPanel>

      {/* Edit Session Slide-In Panel */}
      <SlideInPanel
        isOpen={editPanel.open}
        onClose={() => setEditPanel(prev => ({ ...prev, open: false }))}
        title="Edit Session"
        subtitle={editPanel.session ? `${editPanel.session.userName || editPanel.session.userEmail}` : undefined}
        width="md"
      >
        <SlideInPanelSection title="Session Configuration" icon={<Settings size={16} />}>
          <SlideInPanelField label="Status">
            <select
              value={editPanel.form.status}
              onChange={(e) => setEditPanel(prev => ({ ...prev, form: { ...prev.form, status: e.target.value } }))}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            >
              <option value="running">Running</option>
              <option value="idle">Idle</option>
              <option value="stopped">Stopped</option>
            </select>
          </SlideInPanelField>
          <SlideInPanelField label="Security Level">
            <select
              value={editPanel.form.securityLevel}
              onChange={(e) => setEditPanel(prev => ({ ...prev, form: { ...prev.form, securityLevel: e.target.value } }))}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            >
              <option value="strict">Strict</option>
              <option value="permissive">Permissive</option>
              <option value="minimal">Minimal</option>
            </select>
          </SlideInPanelField>
          <SlideInPanelField label="Network Enabled">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editPanel.form.networkEnabled}
                onChange={(e) => setEditPanel(prev => ({ ...prev, form: { ...prev.form, networkEnabled: e.target.checked } }))}
                className="rounded border-border-hover"
              />
              <span className="text-text-secondary">Allow network access</span>
            </label>
          </SlideInPanelField>
        </SlideInPanelSection>
        <SlideInPanelSection title="Resource Limits" icon={<Cpu size={16} />}>
          <SlideInPanelField label="CPU Limit (cores)">
            <input
              type="number"
              min="0.5"
              max="4"
              step="0.5"
              value={editPanel.form.cpuLimit}
              onChange={(e) => setEditPanel(prev => ({ ...prev, form: { ...prev.form, cpuLimit: parseFloat(e.target.value) } }))}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </SlideInPanelField>
          <SlideInPanelField label="Memory Limit (MB)">
            <input
              type="number"
              min="256"
              max="4096"
              step="256"
              value={editPanel.form.memoryLimitMb}
              onChange={(e) => setEditPanel(prev => ({ ...prev, form: { ...prev.form, memoryLimitMb: parseInt(e.target.value) } }))}
              className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-white/10 text-text-primary"
            />
          </SlideInPanelField>
        </SlideInPanelSection>
        <SlideInPanelFooter>
          <button
            onClick={() => setEditPanel(prev => ({ ...prev, open: false }))}
            className="px-4 py-2 rounded-lg bg-surface-secondary text-text-secondary hover:bg-surface-tertiary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveSession}
            disabled={editPanel.saving}
            className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {editPanel.saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            {editPanel.saving ? 'Saving...' : 'Save Changes'}
          </button>
        </SlideInPanelFooter>
      </SlideInPanel>
    </div>
  );
};

export default AWCodeSessionsView;
