/**
 * NodePalette - Slide-out searchable palette with category groups
 */

import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, X, AlertCircle, ChevronDown } from '@/shared/icons';
import { PaletteCategory } from './PaletteCategory';
import { PaletteItem } from './PaletteItem';

interface NodeConfig {
  type: string;
  label: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  defaultData?: Record<string, any>;
}

interface NodePaletteProps {
  isOpen: boolean;
  nodeConfigs: Record<string, NodeConfig>;
  loading: boolean;
  error: string | null;
}

const CATEGORY_ORDER = ['trigger', 'ai', 'action', 'logic', 'data', 'http', 'code', 'approval', 'agents'];
const CATEGORY_LABELS: Record<string, string> = {
  trigger: 'Triggers',
  ai: 'AI / LLM',
  action: 'Actions',
  logic: 'Logic',
  data: 'Data',
  http: 'HTTP',
  code: 'Code',
  approval: 'Human-in-Loop',
  agents: 'Agents',
};

export const NodePalette: React.FC<NodePaletteProps> = ({
  isOpen,
  nodeConfigs,
  loading,
  error,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const filteredConfigs = useMemo(() => {
    const configs = Object.values(nodeConfigs);
    if (!searchQuery.trim()) return configs;
    const q = searchQuery.toLowerCase();
    return configs.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
    );
  }, [nodeConfigs, searchQuery]);

  const nodesByCategory = useMemo(() => {
    return filteredConfigs.reduce((acc, config) => {
      const cat = config.category || 'Other';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(config);
      return acc;
    }, {} as Record<string, NodeConfig[]>);
  }, [filteredConfigs]);

  const sortedCategories = useMemo(() => {
    const ordered = CATEGORY_ORDER.filter(cat => nodesByCategory[cat]);
    const remaining = Object.keys(nodesByCategory).filter(cat => !CATEGORY_ORDER.includes(cat));
    return [...ordered, ...remaining];
  }, [nodesByCategory]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 250 }}
          className="border-r flex flex-col overflow-hidden flex-shrink-0"
          style={{
            background: 'var(--wf-node-bg)',
            borderColor: 'var(--wf-node-border)',
          }}
        >
          {/* Header + search */}
          <div className="flex-shrink-0 p-3 border-b" style={{ borderColor: 'var(--wf-node-border)' }}>
            <div className="flex items-center gap-2 mb-2.5">
              <Plus className="w-4 h-4" style={{ color: '#2196f3' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text, #333)' }}>
                Add Nodes
              </h2>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full ml-auto"
                style={{ background: 'rgba(0,0,0,0.05)', color: 'var(--color-text-tertiary, #999)' }}
              >
                {Object.keys(nodeConfigs).length}
              </span>
            </div>
            <div className="relative">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                style={{ color: 'var(--color-text-tertiary, #999)' }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search nodes..."
                className="w-full pl-8 pr-8 py-1.5 rounded-lg border text-xs transition-all focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                style={{
                  background: 'rgba(0,0,0,0.03)',
                  borderColor: 'var(--wf-node-border)',
                  color: 'var(--color-text, #333)',
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--color-text-tertiary, #999)' }}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Node list */}
          <div className="flex-1 overflow-y-auto wf-scrollbar p-2">
            {loading && (
              <div className="p-6 text-center">
                <div className="wf-loading rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent mx-auto mb-2" style={{ animation: 'wf-spin 1s linear infinite' }} />
                <p className="text-xs" style={{ color: 'var(--color-text-tertiary, #999)' }}>Loading nodes...</p>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg border mx-1 mb-2" style={{ background: 'rgba(244,67,54,0.05)', borderColor: 'rgba(244,67,54,0.2)' }}>
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-red-400" />
                  <div>
                    <p className="text-[11px] font-medium text-red-400">Failed to load nodes</p>
                    <p className="text-[10px] mt-0.5 text-red-400/60">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {!loading && sortedCategories.length === 0 && (
              <div className="p-6 text-center" style={{ color: 'var(--color-text-tertiary, #999)' }}>
                <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-xs font-medium">No nodes found</p>
              </div>
            )}

            {!loading && sortedCategories.map(category => (
              <PaletteCategory
                key={category}
                category={category}
                label={CATEGORY_LABELS[category] || category}
                count={nodesByCategory[category].length}
                isCollapsed={collapsedCategories.has(category)}
                onToggle={() => toggleCategory(category)}
              >
                {nodesByCategory[category].map(config => (
                  <PaletteItem key={config.type} config={config} />
                ))}
              </PaletteCategory>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
