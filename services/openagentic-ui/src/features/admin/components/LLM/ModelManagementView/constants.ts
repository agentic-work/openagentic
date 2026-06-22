/**
 * Model Management View — Types, interfaces, and constants.
 */
import { Brain, Layers, Zap, Eye, Sparkles, Globe, Play } from '@/shared/icons';

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  providerId: string;
  providerType: string;
  providerName: string; // internal name for API calls
  capabilities: {
    chat: boolean;
    embeddings: boolean;
    tools: boolean;
    vision: boolean;
    thinking?: boolean;
    imageGeneration?: boolean;
    audio?: boolean;
    streaming?: boolean;
    grounding?: boolean;
  };
  maxTokens?: number;
  contextWindow?: number;
  tier?: 'economy' | 'balanced' | 'premium';
  enabled: boolean;
  costPerInputToken?: number;
  costPerOutputToken?: number;
  addedAt?: string;
  config?: ModelConfig;
}

export interface ModelConfig {
  maxOutputTokens?: number;
  maxInputTokens?: number;
  rateLimitRequestsPerHour?: number;
  rateLimitTokensPerHour?: number;
  temperature?: number;
  topP?: number;
  enabled?: boolean;
  roles?: string[];
  // (#69) Per-model capability overrides (admin can override SDK guesses)
  capabilities?: {
    chat?: boolean;
    vision?: boolean;
    tools?: boolean;
    thinking?: boolean;
    embeddings?: boolean;
    imageGeneration?: boolean;
    streaming?: boolean;
  };
  // Cost classification for smart router tier selection
  costTier?: 'free' | 'low' | 'mid' | 'high' | 'premium';
  // Optional pricing in $ per million tokens (display only — admin can override)
  costPerMTokInput?: number;
  costPerMTokOutput?: number;
  // Measured TTFT in ms (populated by chat pipeline on first call, persisted)
  ttftMs?: number;
  ttftMeasuredAt?: string;
}

export interface DiscoveredModel {
  id: string;
  name: string;
  provider: string;
  description?: string;
  configured?: boolean;
  capabilities?: Record<string, boolean>;
  maxTokens?: number;
  maxOutputTokens?: number;
  contextWindow?: number;
  providerName?: string; // e.g. "Anthropic", "Meta", "Amazon"
  inferenceTypes?: string[];
  costPerInputToken?: number;
  costPerOutputToken?: number;
  tier?: 'economy' | 'balanced' | 'premium';
  costTier?: 'free' | 'low' | 'mid' | 'high' | 'premium';
  family?: string;
  pullRequired?: boolean;
}

export interface DbProvider {
  id: string;
  name: string;
  display_name: string;
  provider_type: string;
  enabled: boolean;
  priority: number;
  model_config: Record<string, any>;
  provider_config: Record<string, any>;
  capabilities: Record<string, boolean>;
  status?: string;
}

export interface PlaygroundMessage {
  role: 'user' | 'assistant';
  content: string;
  latency?: number;
}

export interface ModelManagementViewProps {
  theme: string;
}

export type TabId = 'registry' | 'garden' | 'playground';

// ── Constants ────────────────────────────────────────────────────────────────

export const MODEL_ROLES = ['chat', 'embedding', 'vision', 'image-generation', 'compaction'] as const;

export const TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  economy:  { bg: 'bg-[color-mix(in_srgb,var(--color-ok)_10%,transparent)]',   text: 'text-ok',   border: 'border-[color-mix(in_srgb,var(--color-ok)_30%,transparent)]' },
  balanced: { bg: 'bg-[color-mix(in_srgb,var(--color-nfo)_10%,transparent)]',  text: 'text-info', border: 'border-[color-mix(in_srgb,var(--color-nfo)_30%,transparent)]' },
  premium:  { bg: 'bg-[color:var(--ap-accent-soft)]', text: 'text-[color:var(--ap-accent)]', border: 'border-[color:var(--ap-accent-line)]' },
};

export const COST_TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  free:    { bg: 'bg-[color-mix(in_srgb,var(--color-ok)_10%,transparent)]',   text: 'text-ok',   border: 'border-[color-mix(in_srgb,var(--color-ok)_30%,transparent)]' },
  low:     { bg: 'bg-[color-mix(in_srgb,var(--color-nfo)_10%,transparent)]',  text: 'text-info', border: 'border-[color-mix(in_srgb,var(--color-nfo)_30%,transparent)]' },
  mid:     { bg: 'bg-[color-mix(in_srgb,var(--color-nfo)_10%,transparent)]',  text: 'text-info', border: 'border-[color-mix(in_srgb,var(--color-nfo)_30%,transparent)]' },
  high:    { bg: 'bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)]', text: 'text-warn', border: 'border-[color-mix(in_srgb,var(--color-warn)_30%,transparent)]' },
  premium: { bg: 'bg-[color:var(--ap-accent-soft)]', text: 'text-[color:var(--ap-accent)]', border: 'border-[color:var(--ap-accent-line)]' },
};

// Compact icon-only badges with tooltips (no text labels to save space)
export const CAPABILITY_BADGES = [
  { key: 'chat', label: 'Chat', icon: Brain, color: 'var(--cap-chat)' },
  { key: 'embeddings', label: 'Embeddings', icon: Layers, color: 'var(--cap-embeddings)' },
  { key: 'tools', label: 'Tool Use', icon: Zap, color: 'var(--cap-tools)' },
  { key: 'vision', label: 'Vision', icon: Eye, color: 'var(--cap-vision)' },
  { key: 'thinking', label: 'Thinking/Reasoning', icon: Sparkles, color: 'var(--cap-thinking)' },
  { key: 'imageGeneration', label: 'Image Generation', icon: Globe, color: 'var(--cap-image-gen)' },
  { key: 'streaming', label: 'Streaming', icon: Play, color: 'var(--cap-streaming)' },
] as const;

// ── Utilities ────────────────────────────────────────────────────────────────

export function guessTier(model: string): 'economy' | 'balanced' | 'premium' {
  const m = model.toLowerCase();
  if (m.includes('opus') || m.includes('o1') || m.includes('o3') || m.includes('ultra') || m.includes('pro')) return 'premium';
  if (m.includes('haiku') || m.includes('mini') || m.includes('flash') || m.includes('lite') || m.includes('nano') || m.includes('small')) return 'economy';
  return 'balanced';
}
