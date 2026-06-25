/**
 * AgentCapabilityCard - Shows agent capabilities, tools, and configuration
 */

import React from 'react';
import { Brain, Wrench, Zap, Settings, Shield } from '@/shared/icons';
import type { PlaygroundAgent } from '../hooks/useAgentPlayground';

interface AgentCapabilityCardProps {
  agent: PlaygroundAgent;
}

export const AgentCapabilityCard: React.FC<AgentCapabilityCardProps> = ({ agent }) => {
  // Group tools by MCP server prefix
  const toolGroups = React.useMemo(() => {
    const groups: Record<string, string[]> = {};
    (agent.tools || []).forEach(tool => {
      const parts = tool.split('__');
      const server = parts.length > 1 ? parts[0] : 'general';
      if (!groups[server]) groups[server] = [];
      groups[server].push(tool);
    });
    return groups;
  }, [agent.tools]);

  return (
    <div className="space-y-4">
      {/* Agent header */}
      <div className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
          style={{ backgroundColor: 'var(--color-surface)' }}
        >
          {agent.icon || '🤖'}
        </div>
        <div>
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            {agent.display_name || agent.name}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className="text-[11px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
            >
              {agent.role || agent.agent_type}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {agent.model}
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      {agent.description && (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          {agent.description}
        </p>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg p-2 text-center" style={{ backgroundColor: 'var(--color-surface)' }}>
          <Wrench className="w-4 h-4 mx-auto mb-1" style={{ color: 'var(--color-text-tertiary)' }} />
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{agent.tools?.length || 0}</div>
          <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Tools</div>
        </div>
        <div className="rounded-lg p-2 text-center" style={{ backgroundColor: 'var(--color-surface)' }}>
          <Brain className="w-4 h-4 mx-auto mb-1" style={{ color: 'var(--color-text-tertiary)' }} />
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{agent.maxTurns || '∞'}</div>
          <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Max Turns</div>
        </div>
        <div className="rounded-lg p-2 text-center" style={{ backgroundColor: 'var(--color-surface)' }}>
          <Zap className="w-4 h-4 mx-auto mb-1" style={{ color: 'var(--color-text-tertiary)' }} />
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{agent.skills?.length || 0}</div>
          <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Skills</div>
        </div>
      </div>

      {/* Tools by server */}
      {Object.keys(toolGroups).length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Settings className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
              Available Tools
            </span>
          </div>
          <div className="space-y-2">
            {Object.entries(toolGroups).map(([server, tools]) => (
              <div key={server}>
                <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                  {server}
                </div>
                <div className="flex flex-wrap gap-1">
                  {tools.map(tool => (
                    <span
                      key={tool}
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
                    >
                      {tool.split('__').pop()}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Limits */}
      <div className="flex items-center gap-1.5">
        <Shield className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          Max {agent.maxToolCalls || 25} tool calls per execution
        </span>
      </div>
    </div>
  );
};
