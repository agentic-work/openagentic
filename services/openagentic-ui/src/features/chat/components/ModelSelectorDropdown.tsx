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

import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  'vertex-ai': { label: 'Google', color: 'var(--cm-info)', icon: 'G', order: 1 },
  'google-vertex': { label: 'Google', color: 'var(--cm-info)', icon: 'G', order: 1 },
  'anthropic': { label: 'Anthropic', color: 'var(--cm-warning)', icon: 'A', order: 2 },
  'aws-bedrock': { label: 'AWS Bedrock', color: 'var(--cm-warning)', icon: 'B', order: 3 },
  'openai': { label: 'OpenAI', color: 'var(--cm-success)', icon: 'O', order: 4 },
  'azure-openai': { label: 'Azure OpenAI', color: 'var(--cm-accent)', icon: 'Az', order: 5 },
  'azure-ai-foundry': { label: 'Azure AI Foundry', color: 'var(--cm-accent)', icon: 'AF', order: 5 },
  'ollama': { label: 'Ollama (Local)', color: 'var(--cm-bg-tertiary)', icon: 'O', iconUrl: 'https://ollama.com/public/ollama.png', order: 6 },
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
  'free': { label: 'Free', color: 'var(--cm-success)' },
  'low': { label: '$', color: 'var(--cm-success)' },
  'mid': { label: '$$', color: 'var(--cm-warning)' },
  'high': { label: '$$$', color: 'var(--cm-warning)' },
  'premium': { label: '$$$$', color: 'var(--cm-error)' },
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

  // Filter chat models — Registry surface is small and finite; no search
  // bar to filter (per user direction).
  const chatModels = useMemo(() =>
    availableModels.filter(m => m.type === 'chat'),
    [availableModels]
  );
  const filteredModels = chatModels;

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

  // Calculate position — anchor to the pill, not to the viewport. User locked
  // 2026-04-22: dropdown must "attach to the Auto-Routing pill above it", NOT
  // float in the center of the chat modal. The old `left: rect.right - 380`
  // math right-aligned the dropdown with the pill, which — combined with the
  // chat container's bounded max-width — put the dropdown visually center-ish
  // inside the chat column. Fix: anchor the dropdown's RIGHT edge to the
  // pill's right edge (so it opens flush above it), clamp to viewport gutters,
  // and nudge up so the dropdown's bottom sits 6px above the pill.
  useEffect(() => {
    const DROPDOWN_WIDTH = 380;
    const GUTTER = 8;
    const GAP_ABOVE_PILL = 6;
    const updatePosition = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const dropdownMaxH = Math.min(520, vh - 32);

      // Right edge of dropdown == right edge of pill, clamped so the dropdown
      // never overflows the viewport (keeps ≥ GUTTER from both edges).
      const idealLeft = rect.right - DROPDOWN_WIDTH;
      const clampedLeft = Math.max(
        GUTTER,
        Math.min(idealLeft, vw - DROPDOWN_WIDTH - GUTTER),
      );

      if (position === 'above') {
        const idealTop = rect.top - dropdownMaxH - GAP_ABOVE_PILL;
        setDropdownPosition({
          top: Math.max(GUTTER, idealTop),
          left: clampedLeft,
        });
      } else {
        setDropdownPosition({
          top: rect.bottom + GAP_ABOVE_PILL,
          left: clampedLeft,
        });
      }
    };

    // Retry once on the next frame — covers the case where buttonRef.current
    // isn't yet attached when this effect first runs (React refs settle after
    // first paint). Without the retry the dropdown sticks at {top:0,left:0}.
    updatePosition();
    const rafId = requestAnimationFrame(updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [buttonRef, position]);

  // Handle keyboard — listen at the document level so the dialog container
  // (a non-interactive element) doesn't carry its own keyboard listener.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
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
      role="dialog"
      aria-label="Model selector"
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
        boxShadow: '0 20px 60px color-mix(in srgb, var(--cm-text) 40%, transparent)',
        color: 'var(--color-text)',
        display: 'flex',
        flexDirection: 'column',
      }}
      tabIndex={-1}
    >
      {/* RIPPED: Search bar inside the model selector. The Registry shows
          users their finite enabled set — searching across 5-10 models
          is unnecessary chrome. Per user direction. */}

      {/* Scrollable model list */}
      <div className="overflow-y-auto flex-1 p-2" style={{ maxHeight: '440px' }}>
        {/* Auto-Routing pseudo-option — only rendered when Registry has more
            than one chat model. With exactly one (or zero) there's no routing
            decision to make; showing Auto-Routing would be a lie. Behavior
            locked by user 2026-04-22 ("it MAKE SENSE the Auto-Routing doesnt
            show up when only one chat model is defined") + regression tested
            in ModelSelectorDropdown.smart-router.test.tsx. */}
        {chatModels.length > 1 && (
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
              <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold" style={{ background: 'linear-gradient(135deg, var(--cm-info), var(--cm-accent))', color: 'var(--cm-bg)' }}>
                AI
              </div>
              <div>
                <div className="font-medium">Auto-Routing</div>
                <div className="text-[11px]" style={{ color: 'var(--color-textMuted)' }}>
                  Auto-selects based on query complexity
                </div>
              </div>
            </div>
            {!selectedModel && <Check size={14} className="text-blue-400" />}
          </button>
        )}

        {/* Provider groups */}
        {groupedModels.map(([provider, models]) => {
          const config = PROVIDER_CONFIG[provider] || { label: provider, color: 'var(--cm-text-muted)', icon: '?', order: 99 };

          return (
            <div key={provider} className="mt-2">
              {/* Provider header */}
              <div className="flex items-center gap-2 px-3 py-1.5">
                <div
                  className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold overflow-hidden"
                  style={{ backgroundColor: config.iconUrl ? 'transparent' : config.color, color: 'var(--cm-bg)' }}
                >
                  {config.iconUrl ? <img src={config.iconUrl} width={20} height={20} alt={config.label} style={{ borderRadius: 3, backgroundColor: 'var(--cm-bg)', padding: 1 }} /> : config.icon}
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
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--cm-success) 20%, transparent)', color: 'var(--cm-success)' }}>
                            REC
                          </span>
                        )}
                      </div>
                      {/* Capability badges */}
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {model.thinking && (
                          <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--cm-accent) 15%, transparent)', color: 'var(--cm-accent)' }}>
                            think
                          </span>
                        )}
                        {model.capabilities?.includes('vision') && (
                          <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--cm-info) 15%, transparent)', color: 'var(--cm-info)' }}>
                            vision
                          </span>
                        )}
                        {model.capabilities?.includes('function-calling') && (
                          <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--cm-warning) 15%, transparent)', color: 'var(--cm-warning)' }}>
                            tools
                          </span>
                        )}
                        {model.contextWindow && model.contextWindow >= 200000 ? (
                          <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--cm-accent) 15%, transparent)', color: 'var(--cm-accent)' }}>
                            {Math.round(model.contextWindow / 1000)}k ctx
                          </span>
                        ) : null}
                        {model.pullRequired && (
                          <span className="text-[9px] px-1 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--cm-error) 15%, transparent)', color: 'var(--cm-error)' }}>
                            pull required
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {/* RIPPED $$/cost-tier label per user direction:
                          "no more $$ or that shit". Pricing belongs in
                          admin Model Registry, not on the per-turn
                          model picker. */}
                      {isSelected && <Check size={14} className="text-blue-400" />}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}

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
  const displayName = selectedModel ? (modelName || selectedModel) : 'Auto-Routing';

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
