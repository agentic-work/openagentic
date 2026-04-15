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
 * NodePaletteDrawer - Floating node palette that overlays the canvas edge
 * Fully scrollable, supports drag-and-drop onto the canvas behind it.
 * Opens when clicking "Nodes" or "Agents" in the sidebar.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, ChevronRight } from '@/shared/icons';
import { PaletteItem } from './palette/PaletteItem';
import { nodeTypeConfigs } from '../utils/nodeConfigs';
import { useBackendNodes } from '../hooks/useBackendNodes';

interface NodePaletteDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'nodes' | 'agents';
  agents?: any[];
}

export const NodePaletteDrawer: React.FC<NodePaletteDrawerProps> = ({
  isOpen,
  onClose,
  mode,
  agents = [],
}) => {
  const [search, setSearch] = useState('');
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
  const { nodeConfigs: backendNodeConfigs } = useBackendNodes();
  const activeNodeConfigs = Object.keys(backendNodeConfigs).length > 0 ? backendNodeConfigs : nodeTypeConfigs;

  const toggleCat = (cat: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  // Group nodes by category
  const nodesByCategory = useMemo(() => {
    const configs = Object.values(activeNodeConfigs);
    const grouped: Record<string, typeof configs> = {};
    const categoryOrder = ['trigger', 'ai', 'action', 'logic', 'data', 'http', 'code', 'approval', 'agents', 'annotation'];
    const categoryLabels: Record<string, string> = {
      trigger: 'Triggers', ai: 'AI / LLM', action: 'Actions', logic: 'Logic',
      data: 'Data', http: 'HTTP', code: 'Code', approval: 'Human-in-Loop', agents: 'Agents',
      annotation: 'Annotation',
    };
    configs.forEach(c => {
      const cat = (c as any).category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(c);
    });
    const sorted = categoryOrder.filter(c => grouped[c]);
    const remaining = Object.keys(grouped).filter(c => !categoryOrder.includes(c));
    return { grouped, order: [...sorted, ...remaining], labels: categoryLabels };
  }, [activeNodeConfigs]);

  // Filter by search
  const filteredCategories = useMemo(() => {
    if (!search) return nodesByCategory;
    const q = search.toLowerCase();
    const filtered: Record<string, any[]> = {};
    for (const [cat, items] of Object.entries(nodesByCategory.grouped)) {
      const matching = items.filter(
        (c: any) => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q) || c.type.toLowerCase().includes(q)
      );
      if (matching.length > 0) filtered[cat] = matching;
    }
    const order = nodesByCategory.order.filter(c => filtered[c]);
    return { grouped: filtered, order, labels: nodesByCategory.labels };
  }, [nodesByCategory, search]);

  // Group agents by category
  const agentsByCategory = useMemo(() => {
    const platform = agents.filter(a => a.category === 'platform' && a.enabled !== false);
    const custom = agents.filter(a => a.category === 'custom' && a.enabled !== false);
    const background = agents.filter(a => a.category === 'background' && a.enabled !== false);
    return { platform, custom, background };
  }, [agents]);

  const totalNodes = Object.values(filteredCategories.grouped).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Floating drawer panel — no backdrop so drag-and-drop to canvas works */}
          <motion.div
            initial={{ x: -320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -320, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute left-0 top-0 bottom-0 z-40 flex flex-col"
            style={{
              width: 320,
              background: 'var(--color-bg-primary)',
              borderRight: '1px solid var(--color-border)',
              boxShadow: '4px 0 24px rgba(0,0,0,0.25)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {mode === 'nodes' ? 'Node Palette' : 'Agent Palette'}
                </span>
                <span className="text-[11px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
                  {mode === 'nodes' ? totalNodes : agents.length}
                </span>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-md transition-colors hover:bg-[var(--color-surface)]"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={mode === 'nodes' ? 'Search nodes...' : 'Search agents...'}
                  className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border focus:outline-none focus:ring-1"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                  autoFocus
                />
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto wf-scrollbar px-3 py-2">
              {mode === 'nodes' ? (
                <>
                  {filteredCategories.order.map(cat => {
                    const isCollapsed = collapsedCats.has(cat);
                    const items = filteredCategories.grouped[cat];
                    return (
                      <div key={cat} className="mb-2">
                        <button
                          onClick={() => toggleCat(cat)}
                          className="w-full flex items-center gap-1.5 px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:bg-[var(--color-surface)] rounded"
                          style={{ color: 'var(--color-text-tertiary)' }}
                        >
                          <motion.div animate={{ rotate: isCollapsed ? 0 : 90 }} transition={{ duration: 0.12 }}>
                            <ChevronRight className="w-3 h-3" />
                          </motion.div>
                          {filteredCategories.labels[cat] || cat}
                          <span className="ml-auto text-[10px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>
                            {items.length}
                          </span>
                        </button>
                        <AnimatePresence>
                          {!isCollapsed && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.12 }}
                              className="overflow-hidden space-y-1 pl-1"
                            >
                              {items.map((config: any) => (
                                <PaletteItem key={config.type} config={config} />
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                  {filteredCategories.order.length === 0 && (
                    <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                      No nodes match "{search}"
                    </div>
                  )}
                </>
              ) : (
                /* Agents mode */
                <>
                  {agentsByCategory.platform.length > 0 && (
                    <AgentGroup label="Platform" agents={agentsByCategory.platform} />
                  )}
                  {agentsByCategory.custom.length > 0 && (
                    <AgentGroup label="Custom" agents={agentsByCategory.custom} />
                  )}
                  {agentsByCategory.background.length > 0 && (
                    <AgentGroup label="Background" agents={agentsByCategory.background} />
                  )}
                  {agents.length === 0 && (
                    <div className="text-center py-8 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                      No agents configured. Create agents in Admin Portal.
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t text-[11px]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}>
              Drag items onto the canvas to add them
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

/** Agent group within the drawer */
const AgentGroup: React.FC<{ label: string; agents: any[] }> = ({ label, agents }) => (
  <div className="mb-3">
    <div className="text-[11px] font-semibold uppercase tracking-wider px-1 py-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
      {label}
    </div>
    <div className="space-y-1">
      {agents.map(agent => (
        <div
          key={agent.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/openagentic-node', JSON.stringify({
              type: 'agent_single',
              data: { label: agent.display_name, agentId: agent.id, role: agent.agent_type, ...agent.model_config },
            }));
            e.dataTransfer.effectAllowed = 'copy';
          }}
          className="wf-palette-item flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-grab active:cursor-grabbing"
          style={{
            background: 'var(--wf-node-bg)',
            borderColor: 'var(--wf-node-border)',
          }}
        >
          <div
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm"
            style={{ backgroundColor: '#7c3aed' }}
          >
            {agent.icon || '\uD83E\uDD16'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-xs truncate" style={{ color: 'var(--color-text)' }}>
              {agent.display_name}
            </div>
            <div className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
              <span className="px-1 rounded" style={{ background: 'var(--color-surface-secondary, #333)' }}>{agent.agent_type}</span>
              {agent.tools_whitelist?.length > 0 && (
                <span>{agent.tools_whitelist.length} tools</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);
