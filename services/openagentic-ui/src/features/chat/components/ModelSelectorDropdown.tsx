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
 * ModelSelectorDropdown - Provider-grouped model selector
 * Features:
 * - Grouped by provider (Google, Anthropic, OpenAI, Ollama, etc.)
 * - Search/filter
 * - Capability badges (vision, tools, thinking)
 * - Cost tier indicators
 * - Recommended model highlighting
 * - Fixed positioning with React Portal
 * - Keyboard navigation
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Sparkles, Search } from '@/shared/icons';
import clsx from 'clsx';

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  type?: string;
  provider?: string;
  capabilities?: string[];
  thinking?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  cost?: { input: number; output: number };
  pullRequired?: boolean;
}

export interface ModelSelectorDropdownProps {
  selectedModel: string;
  availableModels: ModelOption[];
  onModelChange: (model: string) => void;
  onClose: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  position?: 'above' | 'below';
}

// Provider display config — order, colors, labels
const PROVIDER_CONFIG: Record<string, { label: string; color: string; icon: string; iconUrl?: string; order: number }> = {
  'vertex-ai': { label: 'Google', color: '#4285F4', icon: 'G', order: 1 },
  'google-vertex': { label: 'Google', color: '#4285F4', icon: 'G', order: 1 },
  'anthropic': { label: 'Anthropic', color: '#EA580C', icon: 'A', order: 2 },
  'aws-bedrock': { label: 'AWS Bedrock', color: '#FF9900', icon: 'B', order: 3 },
  'openai': { label: 'OpenAI', color: '#10A37F', icon: 'O', order: 4 },
  'azure-openai': { label: 'Azure OpenAI', color: '#0078D4', icon: 'Az', order: 5 },
  'azure-ai-foundry': { label: 'Azure AI Foundry', color: '#0078D4', icon: 'AF', order: 5 },
  'ollama': { label: 'Ollama (Local)', color: '#1a1a2e', icon: 'O', iconUrl: 'https://ollama.com/public/ollama.png', order: 6 },
};

// Recommended models per provider (first one shown as "recommended")
const RECOMMENDED_MODELS: Record<string, string[]> = {
  'vertex-ai': ['gemini-2.5-pro', 'gemini-2.5-flash'],
  'google-vertex': ['gemini-2.5-pro', 'gemini-2.5-flash'],
  'anthropic': ['claude-sonnet-4-6', 'claude-opus-4-6'],
  'aws-bedrock': ['us.anthropic.claude-sonnet-4-6'],
  'openai': ['gpt-4o', 'gpt-4-turbo'],
  'ollama': ['gpt-oss:latest', 'qwen3:8b'],
};

// Cost tier based on model name patterns
function getCostTier(model: ModelOption): 'free' | 'low' | 'mid' | 'high' | 'premium' {
  const id = model.id.toLowerCase();
  if (model.provider === 'ollama') return 'free';
  if (id.includes('flash-lite') || id.includes('flash-8b') || id.includes('haiku')) return 'low';
  if (id.includes('flash') || id.includes('sonnet') || id.includes('4o-mini')) return 'mid';
  if (id.includes('pro') || id.includes('4o') || id.includes('gpt-4')) return 'high';
  if (id.includes('opus') || id.includes('o1') || id.includes('ultra')) return 'premium';
  return 'mid';
}

const COST_DISPLAY: Record<string, { label: string; color: string }> = {
  'free': { label: 'Free', color: '#22C55E' },
  'low': { label: '$', color: '#86EFAC' },
  'mid': { label: '$$', color: '#FCD34D' },
  'high': { label: '$$$', color: '#FB923C' },
  'premium': { label: '$$$$', color: '#F87171' },
};

export const ModelSelectorDropdown: React.FC<ModelSelectorDropdownProps> = ({
  selectedModel,
  availableModels,
  onModelChange,
  onClose,
  buttonRef,
  position = 'above'
}) => {
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter chat models
  const chatModels = useMemo(() =>
    availableModels.filter(m => m.type === 'chat'),
    [availableModels]
  );

  // Filter by search
  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return chatModels;
    const q = searchQuery.toLowerCase();
    return chatModels.filter(m =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.provider?.toLowerCase().includes(q) ||
      PROVIDER_CONFIG[m.provider || '']?.label.toLowerCase().includes(q)
    );
  }, [chatModels, searchQuery]);

  // Group by provider, sorted by provider order
  const groupedModels = useMemo(() => {
    const groups = new Map<string, ModelOption[]>();
    for (const model of filteredModels) {
      const provider = model.provider || 'unknown';
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider)!.push(model);
    }

    // Sort within each group: recommended first, then by name
    for (const [provider, models] of groups) {
      const recommended = new Set(RECOMMENDED_MODELS[provider] || []);
      models.sort((a, b) => {
        const aRec = recommended.has(a.id) ? 0 : 1;
        const bRec = recommended.has(b.id) ? 0 : 1;
        if (aRec !== bRec) return aRec - bRec;
        return a.name.localeCompare(b.name);
      });
    }

    // Sort groups by provider order
    return [...groups.entries()].sort((a, b) => {
      const orderA = PROVIDER_CONFIG[a[0]]?.order ?? 99;
      const orderB = PROVIDER_CONFIG[b[0]]?.order ?? 99;
      return orderA - orderB;
    });
  }, [filteredModels]);

  // Calculate position
  useEffect(() => {
    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const vh = window.innerHeight;
        const dropdownMaxH = Math.min(520, vh - 32);

        if (position === 'above') {
          const idealTop = rect.top - dropdownMaxH - 8;
          setDropdownPosition({
            top: Math.max(8, idealTop),
            left: Math.max(8, rect.right - 380)
          });
        } else {
          setDropdownPosition({
            top: rect.bottom + 8,
            left: Math.max(8, rect.right - 380)
          });
        }
      }
    };

    updatePosition();
    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
    };
  }, [buttonRef, position]);

  // Focus search on open
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 50);
  }, []);

  // Handle keyboard
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
          onClose();
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [buttonRef, onClose]);

  const isRecommended = (provider: string, modelId: string) =>
    (RECOMMENDED_MODELS[provider] || [])[0] === modelId;

  return createPortal(
    <div
      ref={dropdownRef}
      className="model-selector-dropdown rounded-xl"
      style={{
        position: 'fixed',
        top: `${dropdownPosition.top}px`,
        left: `${dropdownPosition.left}px`,
        zIndex: 10000,
        width: '380px',
        maxHeight: `${Math.min(520, window.innerHeight - 32)}px`,
        backdropFilter: 'blur(20px) saturate(180%)',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        color: 'var(--color-text)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Search bar */}
      <div className="px-3 pt-3 pb-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--color-surfaceHover)' }}>
          <Search size={14} style={{ color: 'var(--color-textMuted)' }} />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent outline-none text-sm flex-1"
            style={{ color: 'var(--color-text)' }}
          />
        </div>
      </div>

      {/* Scrollable model list */}
      <div className="overflow-y-auto flex-1 p-2" style={{ maxHeight: '440px' }}>
        {/* Smart Router option */}
        <button
          onClick={() => { onModelChange(''); onClose(); }}
          className={clsx(
            'w-full text-left px-3 py-2 rounded-lg transition-colors text-sm flex items-center justify-between mb-1',
          )}
          style={{
            color: 'var(--color-text)',
            backgroundColor: !selectedModel ? 'color-mix(in srgb, var(--color-primary) 20%, transparent)' : 'transparent'
          }}
          onMouseEnter={(e) => { if (selectedModel) e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = !selectedModel ? 'color-mix(in srgb, var(--color-primary) 20%, transparent)' : 'transparent'; }}
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold" style={{ background: 'linear-gradient(135deg, #3B82F6, #A855F7)', color: '#fff' }}>
              AI
            </div>
            <div>
              <div className="font-medium">Smart Router</div>
              <div className="text-[11px]" style={{ color: 'var(--color-textMuted)' }}>
                Auto-selects based on query complexity
              </div>
            </div>
          </div>
          {!selectedModel && <Check size={14} className="text-blue-400" />}
        </button>

        {/* Provider groups */}
        {groupedModels.map(([provider, models]) => {
          const config = PROVIDER_CONFIG[provider] || { label: provider, color: '#888', icon: '?', order: 99 };

          return (
            <div key={provider} className="mt-2">
              {/* Provider header */}
              <div className="flex items-center gap-2 px-3 py-1.5">
                <div
                  className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold overflow-hidden"
                  style={{ backgroundColor: config.iconUrl ? 'transparent' : config.color, color: '#fff' }}
                >
                  {config.iconUrl ? <img src={config.iconUrl} width={20} height={20} alt={config.label} style={{ borderRadius: 3, backgroundColor: '#fff', padding: 1 }} /> : config.icon}
                </div>
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-textMuted)' }}>
                  {config.label}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: 'var(--color-textMuted)', backgroundColor: 'var(--color-surfaceHover)' }}>
                  {models.length}
                </span>
              </div>

              {/* Models in this provider */}
              {models.map((model) => {
                const costTier = getCostTier(model);
                const costInfo = COST_DISPLAY[costTier];
                const recommended = isRecommended(provider, model.id);
                const isSelected = selectedModel === model.id;

                return (
                  <button
                    key={model.id}
                    onClick={() => { onModelChange(model.id); onClose(); }}
                    className={clsx(
                      'w-full text-left px-3 py-2 rounded-lg transition-colors text-sm flex items-center justify-between',
                      model.pullRequired && 'opacity-50'
                    )}
                    style={{
                      color: 'var(--color-text)',
                      backgroundColor: isSelected ? 'color-mix(in srgb, var(--color-primary) 20%, transparent)' : 'transparent'
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isSelected ? 'color-mix(in srgb, var(--color-primary) 20%, transparent)' : 'transparent'; }}
                    disabled={model.pullRequired}
                    title={model.pullRequired ? 'Model needs to be pulled first' : undefined}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{model.name}</span>
                        {recommended && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0" style={{ backgroundColor: 'color-mix(in srgb, #22C55E 20%, transparent)', color: '#22C55E' }}>
                            REC
                          </span>
                        )}
                      </div>
                      {/* Capability badges */}
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {model.thinking && (
                          <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, #A78BFA 15%, transparent)', color: '#A78BFA' }}>
                            think
                          </span>
                        )}
                        {model.capabilities?.includes('vision') && (
                          <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, #3B82F6 15%, transparent)', color: '#60A5FA' }}>
                            vision
                          </span>
                        )}
                        {model.capabilities?.includes('function-calling') && (
                          <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, #F97316 15%, transparent)', color: '#FBBF24' }}>
                            tools
                          </span>
                        )}
                        {model.contextWindow && model.contextWindow >= 200000 && (
                          <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, #6366F1 15%, transparent)', color: '#818CF8' }}>
                            {Math.round(model.contextWindow / 1000)}k ctx
                          </span>
                        )}
                        {model.pullRequired && (
                          <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, #EF4444 15%, transparent)', color: '#F87171' }}>
                            pull required
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] font-mono" style={{ color: costInfo.color }}>
                        {costInfo.label}
                      </span>
                      {isSelected && <Check size={14} className="text-blue-400" />}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}

        {filteredModels.length === 0 && searchQuery && (
          <div className="text-center py-6 text-sm" style={{ color: 'var(--color-textMuted)' }}>
            No models matching "{searchQuery}"
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

// Compact trigger button for model selection
export const ModelSelectorButton: React.FC<{
  selectedModel: string;
  modelName?: string;
  onClick: () => void;
  isOpen?: boolean;
  disabled?: boolean;
  className?: string;
}> = ({
  selectedModel,
  modelName,
  onClick,
  isOpen = false,
  disabled = false,
  className = ''
}) => {
  const displayName = selectedModel ? (modelName || selectedModel) : 'Smart Router';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'model-selector-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all',
        'hover:bg-white/10',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      style={{
        color: 'var(--color-textMuted)',
        backgroundColor: isOpen ? 'var(--color-surfaceHover)' : 'transparent'
      }}
      aria-haspopup="listbox"
      aria-expanded={isOpen}
    >
      <span className="truncate max-w-[150px]">{displayName}</span>
      <ChevronDown
        size={14}
        className={clsx(
          'transition-transform duration-200',
          isOpen && 'rotate-180'
        )}
      />
    </button>
  );
};

export default ModelSelectorDropdown;
