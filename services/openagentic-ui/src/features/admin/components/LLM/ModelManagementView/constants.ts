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
  economy:  { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  balanced: { bg: 'bg-blue-500/10',    text: 'text-blue-400',    border: 'border-blue-500/30' },
  premium:  { bg: 'bg-purple-500/10',  text: 'text-purple-400',  border: 'border-purple-500/30' },
};

export const COST_TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  free:    { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  low:     { bg: 'bg-sky-500/10',     text: 'text-sky-400',     border: 'border-sky-500/30' },
  mid:     { bg: 'bg-blue-500/10',    text: 'text-blue-400',    border: 'border-blue-500/30' },
  high:    { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/30' },
  premium: { bg: 'bg-purple-500/10',  text: 'text-purple-400',  border: 'border-purple-500/30' },
};

// Compact icon-only badges with tooltips (no text labels to save space)
export const CAPABILITY_BADGES = [
  { key: 'chat', label: 'Chat', icon: Brain, color: 'var(--cap-chat, #3b82f6)' },
  { key: 'embeddings', label: 'Embeddings', icon: Layers, color: 'var(--cap-embeddings, #8b5cf6)' },
  { key: 'tools', label: 'Tool Use', icon: Zap, color: 'var(--cap-tools, #f59e0b)' },
  { key: 'vision', label: 'Vision', icon: Eye, color: 'var(--cap-vision, #10b981)' },
  { key: 'thinking', label: 'Thinking/Reasoning', icon: Sparkles, color: 'var(--cap-thinking, #ec4899)' },
  { key: 'imageGeneration', label: 'Image Generation', icon: Globe, color: 'var(--cap-image-gen, #06b6d4)' },
  { key: 'streaming', label: 'Streaming', icon: Play, color: 'var(--cap-streaming, #6366f1)' },
] as const;

// ── Utilities ────────────────────────────────────────────────────────────────

export function guessTier(model: string): 'economy' | 'balanced' | 'premium' {
  const m = model.toLowerCase();
  if (m.includes('opus') || m.includes('o1') || m.includes('o3') || m.includes('ultra') || m.includes('pro')) return 'premium';
  if (m.includes('haiku') || m.includes('mini') || m.includes('flash') || m.includes('lite') || m.includes('nano') || m.includes('small')) return 'economy';
  return 'balanced';
}
