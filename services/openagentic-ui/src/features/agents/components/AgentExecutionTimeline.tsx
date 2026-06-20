/**
 * AgentExecutionTimeline - Live visualization of agent execution steps
 *
 * Renders a vertical timeline with animated step cards showing:
 * - Thinking (brain icon, blue)
 * - Tool calls (wrench icon, orange)
 * - Results (check icon, green)
 * - Errors (X icon, red)
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Wrench, CheckCircle, XCircle, Clock,
  // Category icons — mirrors CategoryBadge in AgenticActivityStream so
  // delegated agents' tool steps look identical to top-level chat steps
  Cloud, Cpu, Database, Globe, GitBranch, Shield, Eye, Bot, Server,
  Sparkles, Zap, Lock, Coins, HardDrive, Package,
} from '@/shared/icons';
import { summarizeToolCall } from '../../chat/utils/toolSummarizer';
import type { ExecutionStep } from '../hooks/useAgentPlayground';

// Category → icon (kept in sync with CategoryBadge in AgenticActivityStream).
// Used to give the agent timeline the same visual scan rate as the main
// chat-mode activity stream. openagentic#330 follow-up.
const TIMELINE_ICON_MAP: Record<string, React.FC<any>> = {
  azure: Cloud, aws: Cloud, gcp: Cloud,
  k8s: Cpu, kubernetes: Cpu, kubectl: Cpu,
  database: Database, sql: Database, postgres: Database, cosmos: Database,
  rds: Database, query: Database, knowledge: Database, rag: Database,
  memory: Brain, recall: Brain,
  web: Globe, search: Globe, fetch: Globe, network: Globe, vnet: Globe,
  github: GitBranch, git: GitBranch,
  security: Shield, iam: Shield, role: Shield,
  monitor: Eye, log: Eye, metrics: Eye,
  delegate: Bot, agent: Bot,
  admin: Server, system: Server, platform: Server,
  diagram: Sparkles, synth: Sparkles, image: Sparkles,
  vm: Server, virtual_machine: Server, compute: Server,
  storage: HardDrive, blob: HardDrive, s3: HardDrive,
  vault: Lock, key: Lock, secret: Lock,
  cost: Coins, billing: Coins,
  resource_group: Package, rg: Package,
};

/** Pick an icon for a tool name based on its prefix / keyword. */
function pickToolIcon(toolName?: string): React.FC<any> {
  if (!toolName) return Wrench;
  const lower = toolName.toLowerCase();
  for (const [key, Icon] of Object.entries(TIMELINE_ICON_MAP)) {
    if (lower.includes(key)) return Icon;
  }
  return Wrench;
}

/** Tone color for provisioning state badges. */
function stateColor(state: string): { fg: string; bg: string } {
  const s = state.toLowerCase();
  if (s === 'succeeded' || s === 'success' || s === 'available' || s === 'running') return { fg: 'var(--color-ok)', bg: 'color-mix(in srgb, var(--color-ok) 18%, transparent)' };
  if (s === 'failed' || s === 'error' || s === 'rejected') return { fg: 'var(--color-err)', bg: 'color-mix(in srgb, var(--color-err) 18%, transparent)' };
  if (s === 'creating' || s === 'updating' || s === 'pending' || s === 'in_progress' || s === 'running') return { fg: 'var(--color-warn)', bg: 'color-mix(in srgb, var(--color-warn) 18%, transparent)' };
  return { fg: 'var(--color-text-secondary)', bg: 'color-mix(in srgb, var(--color-fg-subtle) 18%, transparent)' };
}

/** Best-effort extract of the resource name from a tool's args. */
function extractResourceName(args: any): string | null {
  if (!args || typeof args !== 'object') return null;
  return args.name || args.resource_group_name || args.resourceGroupName ||
    args.vm_name || args.account_name || args.cluster_name || args.app_name ||
    args.function_app_name || args.vault_name || args.vnet_name || args.nsg_name ||
    args.subnet_name || args.bucket_name || args.role_name || args.id || null;
}

interface AgentExecutionTimelineProps {
  steps: ExecutionStep[];
  executing: boolean;
}

const stepConfig: Record<string, { icon: React.ComponentType<any>; color: string; bgColor: string; label: string }> = {
  agent_start: { icon: Brain, color: 'var(--color-nfo)', bgColor: 'color-mix(in srgb, var(--color-nfo) 12%, transparent)', label: 'Agent Started' },
  tool_call: { icon: Wrench, color: 'var(--color-warn)', bgColor: 'color-mix(in srgb, var(--color-warn) 12%, transparent)', label: 'Tool Call' },
  tool_result: { icon: CheckCircle, color: 'var(--color-ok)', bgColor: 'color-mix(in srgb, var(--color-ok) 12%, transparent)', label: 'Tool Result' },
  llm_chunk: { icon: Brain, color: 'var(--color-accent)', bgColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)', label: 'Thinking' },
  agent_complete: { icon: CheckCircle, color: 'var(--color-ok)', bgColor: 'color-mix(in srgb, var(--color-ok) 12%, transparent)', label: 'Completed' },
  agent_error: { icon: XCircle, color: 'var(--color-err)', bgColor: 'color-mix(in srgb, var(--color-err) 12%, transparent)', label: 'Error' },
};

export const AgentExecutionTimeline: React.FC<AgentExecutionTimelineProps> = ({ steps, executing }) => {
  if (steps.length === 0 && !executing) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Brain className="w-8 h-8 mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.3 }} />
        <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          Run an agent to see the execution timeline
        </p>
      </div>
    );
  }

  // Accumulate cost from steps
  const totalCost = steps.reduce((sum, s) => sum + (s.data?.cost || 0), 0);
  const totalTokens = steps.reduce((sum, s) => sum + (s.data?.tokensUsed || s.data?.tokens || 0), 0);

  return (
    <div className="space-y-1">
      {/* Timeline header */}
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
          Execution Timeline
        </span>
        <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {totalTokens > 0 && <span>{totalTokens.toLocaleString()} tokens</span>}
          {totalCost > 0 && <span>${totalCost.toFixed(4)}</span>}
        </div>
      </div>

      {/* Steps */}
      <div className="relative">
        {/* Vertical line */}
        <div
          className="absolute left-5 top-0 bottom-0 w-px"
          style={{ backgroundColor: 'var(--color-border)' }}
        />

        <AnimatePresence>
          {steps.map((step, i) => {
            const config = stepConfig[step.type] || stepConfig.llm_chunk;
            const Icon = config.icon;
            const isLast = i === steps.length - 1;

            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: 0.05 }}
                className="relative flex items-start gap-3 pl-2 pr-2 py-1.5"
              >
                {/* Icon circle */}
                <div
                  className="relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: config.bgColor,
                    border: `2px solid ${config.color}`,
                    ...(isLast && executing ? {
                      animation: 'pulse 2s ease-in-out infinite',
                      boxShadow: `0 0 8px ${config.color}40`,
                    } : {}),
                  }}
                >
                  <Icon style={{ width: 12, height: 12, color: config.color }} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 py-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Tool icon — picked from the tool name's prefix
                        (azure_*, k8s_*, aws_*, ...) so users can scan
                        the timeline by category at a glance. */}
                    {(step.type === 'tool_call' || step.type === 'tool_result') && step.toolName && (() => {
                      const ToolIcon = pickToolIcon(step.toolName);
                      return <ToolIcon style={{ width: 12, height: 12, color: config.color, flexShrink: 0 }} />;
                    })()}
                    <span className="text-[12px] font-medium" style={{ color: config.color }}>
                      {step.toolName || config.label}
                    </span>
                    {/* Resource name extracted from the tool args
                        (e.g. "uc-test-arch-rg"). Surfaces what was
                        actually being created/queried instead of just
                        the tool name. openagentic#330. */}
                    {(step.type === 'tool_call' || step.type === 'tool_result') && (() => {
                      const args = (step.data?.arguments) || step.data?.args || step.data?.input;
                      const resourceName = extractResourceName(args);
                      if (!resourceName) return null;
                      return (
                        <span
                          className="text-[11px] truncate"
                          style={{ color: 'var(--color-text)', fontWeight: 500, maxWidth: 220 }}
                          title={resourceName}
                        >
                          · {resourceName}
                        </span>
                      );
                    })()}
                    {/* Provisioning state badge from the result */}
                    {step.type === 'tool_result' && (() => {
                      const result = step.data?.result;
                      if (!result || typeof result !== 'object') return null;
                      const state = result.properties?.provisioningState
                        || result.provisioning_state
                        || (result.is_error === false ? 'succeeded' : null)
                        || (result.is_error === true ? 'failed' : null);
                      if (!state) return null;
                      const c = stateColor(state);
                      return (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-px rounded uppercase tracking-wide"
                          style={{ background: c.bg, color: c.fg, letterSpacing: '0.3px' }}
                        >
                          {state}
                        </span>
                      );
                    })()}
                    {step.agentRole && (
                      <span className="text-[10px] px-1 rounded" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>
                        {step.agentRole}
                      </span>
                    )}
                    <span className="text-[10px] flex items-center gap-0.5 ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                      <Clock style={{ width: 9, height: 9 }} />
                      {new Date(step.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  {/* Agent task summary for agent_start */}
                  {step.type === 'agent_start' && step.data?.task && (
                    <div className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                      {String(step.data.task).substring(0, 150)}
                    </div>
                  )}

                  {/* Image thumbnail for tool results containing image URLs */}
                  {step.type === 'tool_result' && step.data?.result && /\/api\/images\/[^\s]+\.png/.test(String(step.data.result)) && (() => {
                    const match = String(step.data.result).match(/\/api\/images\/[^\s"'<>]+\.png/);
                    if (!match) return null;
                    return (
                      <div className="mt-1.5">
                        <img
                          src={match[0]}
                          alt={step.toolName || 'Generated image'}
                          className="rounded-md cursor-pointer hover:opacity-90 transition-opacity"
                          style={{ maxWidth: 180, maxHeight: 120, objectFit: 'cover', border: '1px solid var(--color-border)' }}
                          onClick={(e) => {
                            const img = e.currentTarget;
                            if (img.style.maxWidth === '180px' || img.style.maxWidth === '') {
                              img.style.maxWidth = '100%';
                              img.style.maxHeight = '400px';
                            } else {
                              img.style.maxWidth = '180px';
                              img.style.maxHeight = '120px';
                            }
                          }}
                        />
                      </div>
                    );
                  })()}

                  {/* Details (expandable) — skip for image results already shown above */}
                  {step.data && step.type !== 'llm_chunk' && step.type !== 'agent_start' &&
                   !(step.type === 'tool_result' && step.data?.result && /\/api\/images\/[^\s]+\.png/.test(String(step.data.result))) && (
                    <div
                      className="mt-1 text-[11px] font-mono rounded-md p-2 max-h-24 overflow-y-auto"
                      style={{
                        backgroundColor: 'var(--color-surface)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {typeof step.data === 'string'
                        ? step.data.substring(0, 300)
                        : step.data.result
                        ? String(step.data.result).substring(0, 300)
                        : step.data.arguments
                        ? JSON.stringify(step.data.arguments, null, 2).substring(0, 300)
                        : JSON.stringify(step.data, null, 2).substring(0, 300)
                      }
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Running indicator */}
        {executing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative flex items-center gap-3 pl-2 py-2"
          >
            <div
              className="relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-warn) 12%, transparent)',
                border: '2px solid var(--color-warn)',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-warn)', animation: 'pulse 1s ease-in-out infinite' }} />
            </div>
            <span className="text-[12px]" style={{ color: 'var(--color-warn)' }}>Processing...</span>
          </motion.div>
        )}
      </div>
    </div>
  );
};
