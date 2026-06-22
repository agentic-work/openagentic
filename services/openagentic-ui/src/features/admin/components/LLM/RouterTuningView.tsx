/**
 * RouterTuningView — Smart Router scoring formula visualizer.
 *
 * Sections:
 *   1. Header with live-propagation badge
 *   2. Scoring Formula card — inline chip editing
 *   3. FCA Floors card — 6 floor cards, 3-col grid
 *   4. Live Scoring Lab v2 — 8 curated prompts, each expanding to per-model KPI table
 *   5. Sticky footer — pending-changes count + Discard / Reset / Save
 */

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { apiRequest } from '@/utils/api';
import { onKeyActivate } from '@/utils/a11y';
import { useAdminQuery } from '../../hooks/useAdminQuery';
import { AdminCard } from '../Shared';
import { PageHeader } from '../../primitives-v2';

// ---------------------------------------------------------------------------
// Field help — summaries + doc anchors for ? affordances
// ---------------------------------------------------------------------------

interface FieldHelpEntry { summary: string; anchor: string; }
const FIELD_HELP: Record<string, FieldHelpEntry> = {
  fcaChatPoolFloor:            { summary: 'Minimum FCA for pure chat. Filters low-FCA models from casual chat routing.',                           anchor: 'fcaChatPoolFloor' },
  fcaSimpleToolFloor:          { summary: 'Minimum FCA for single-round tool calls.',                                                               anchor: 'fcaSimpleToolFloor' },
  fcaComplexToolFloor:         { summary: 'Minimum FCA for multi-step or multi-cloud tool chains. Frontier-only.',                                  anchor: 'fcaComplexToolFloor' },
  fcaDestructiveFloor:         { summary: 'Minimum FCA when prompt contains destructive verbs + cloud nouns. Safety guard.',                        anchor: 'fcaDestructiveFloor' },
  fcaInfraOpsFloor:            { summary: 'Minimum FCA for cloud infra ops (provision/rebuild/query).',                                             anchor: 'fcaInfraOpsFloor' },
  fcaComplexityBiasFloor:      { summary: 'Minimum FCA when prompt has 2+ complexity keywords (architecture, multicloud, etc.).',                   anchor: 'fcaComplexityBiasFloor' },
  fcaQualityFloor:             { summary: 'FCA below which a model earns 0 quality bonus. The "too dumb to reward" line.',                          anchor: 'fcaQualityFloor' },
  fcaQualityMultiplier:        { summary: 'Amplifier on FCA headroom. Higher = quality dominates cost more.',                                       anchor: 'fcaQualityMultiplier' },
  fcaQualityGatedByComplexity: { summary: 'When ON, quality bonus only applies on complex requests. Keeps simple chat cost-dominant.',              anchor: 'fcaQualityGatedByComplexity' },
  costWeight:                  { summary: 'Balances cost-sensitive bonuses (cost + latency) vs quality. Raise for cost-first routing.',             anchor: 'costWeight' },
  qualityWeight:               { summary: 'Balances quality bonus vs everything else. Should sum to ~1 with costWeight.',                           anchor: 'qualityWeight' },
  costBonusMaxPoints:          { summary: 'Max points a free model earns from the cost component.',                                                 anchor: 'costBonusMaxPoints' },
  costNormalizationCeiling:    { summary: 'Cost per 1K tokens at which cost bonus hits 0. Models above this earn no cost bonus.',                   anchor: 'costNormalizationCeiling' },
  latencyBonusMaxPoints:       { summary: 'Max points a fast (<50ms) model earns.',                                                                 anchor: 'latencyBonusMaxPoints' },
  toolCallingBonusMaxPoints:   { summary: 'Max points added when request has tools. Heavy hitter in tool-request scoring.',                         anchor: 'toolCallingBonusMaxPoints' },
  reasoningBonusMaxPoints:     { summary: 'Max points for multi-step or multi-cloud requests.',                                                     anchor: 'reasoningBonusMaxPoints' },
  fcaT3Floor:                  { summary: 'T3 capability gate — minimum FCA for the most demanding tasks (default 0.93). Triggered by t3TriggerTaskTypes.', anchor: 'fcaT3Floor' },
  contextT3Floor:              { summary: 'T3 capability gate — minimum context window in tokens (default 200000).',                                  anchor: 'contextT3Floor' },
};

// ---------------------------------------------------------------------------
// FieldHelp — ? hover affordance with popover
// ---------------------------------------------------------------------------

interface FieldHelpProps { fieldName: string; }

const FieldHelp: React.FC<FieldHelpProps> = ({ fieldName }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverId = `fh-popover-${fieldName}`;
  const entry = FIELD_HELP[fieldName];
  if (!entry) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
  };

  const btnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    border: '1px solid currentColor',
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    fontSize: '10px',
    fontWeight: 700,
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
    flexShrink: 0,
    transition: 'color 120ms, background 120ms',
  };

  // Solid opaque background — was var(--color-surface-primary) which does
  // not exist and resolved to 'unset' (transparent). Use --color-surface
  // (actual theme token, solid in both light + dark) with a fallback so
  // it's never see-through.
  const popoverStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 1000,
    left: '22px',
    top: '-4px',
    width: '280px',
    background: 'var(--color-surface)',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    padding: '10px 12px',
    boxShadow: `0 8px 24px color-mix(in srgb, var(--color-text-primary) 24%, transparent)`,
    fontSize: '12px',
    lineHeight: 1.5,
    color: 'var(--color-text-primary)',
  };

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
    >
      <button
        ref={btnRef}
        aria-label={`Help for ${fieldName}`}
        aria-describedby={open ? popoverId : undefined}
        aria-expanded={open}
        data-testid={`field-help-${fieldName}`}
        onKeyDown={handleKeyDown}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={btnStyle}
        tabIndex={0}
        type="button"
      >
        ?
      </button>
      {open && (
        <div
          id={popoverId}
          role="tooltip"
          style={popoverStyle}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <div style={{ marginBottom: '6px' }}>{entry.summary}</div>
          <a
            href={`/docs/admin/router-tuning#${entry.anchor}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--color-primary)',
              textDecoration: 'none',
              fontSize: '11px',
              fontWeight: 500,
            }}
            data-testid={`field-help-link-${fieldName}`}
          >
            Learn more →
          </a>
        </div>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouterTuning {
  // Weights (0–1, must sum to ~1)
  costWeight: number;
  qualityWeight: number;
  // Bonus max points
  costBonusMaxPoints: number;
  latencyBonusMaxPoints: number;
  toolCallingBonusMaxPoints: number;
  reasoningBonusMaxPoints: number;
  // Quality scoring
  fcaQualityFloor: number;
  fcaQualityMultiplier: number;
  fcaQualityGatedByComplexity: boolean;
  // Cost normalisation ceiling ($USD / 1k tokens)
  costNormalizationCeiling: number;
  // FCA floors (exclusion filters)
  fcaChatPoolFloor: number;
  fcaSimpleToolFloor: number;
  fcaComplexToolFloor: number;
  fcaDestructiveFloor: number;
  fcaInfraOpsFloor: number;
  fcaCloudListFloor: number;
  fcaComplexityBiasFloor: number;
  // T3 capability gate (added 2026-05-22 #1049) — admin-editable
  // replacements for the hardcoded T3 floors + EXPLICIT_MOST_CAPABLE_RE
  // + CAPABILITY_PROFILES literals previously in SmartModelRouter.ts
  // and PromptClassifier.ts.
  fcaT3Floor: number;
  contextT3Floor: number;
  t3TriggerTaskTypes: string[];
  capabilityProfileFloors: Record<string, number>;
  capabilityContextFloors: Record<string, number>;
  // T2 — legacy LLM intent classifier wiring. The classifier service
  // itself was ripped in Phase E.1 (2026-05-10) and the per-intent
  // ranker (formerly consumed intentToTopK / intentToFcaFloor) was
  // ripped in Phase E.2 / E.10. These two toggle fields are kept on the
  // schema for backwards compat with admin UI binding; they have no
  // production consumer.
  intentClassifierEnabled: boolean;
  intentClassifierModelId: string;
}

export interface RouterTuningApiResponse {
  tuning: RouterTuning;
  lastUpdatedAt?: string;
  lastUpdatedBy?: string;
  podCount?: number;
}

// Default values used when API hasn't loaded yet (and in tests)
export const DEFAULT_TUNING: RouterTuning = {
  costWeight: 0.5,
  qualityWeight: 0.5,
  costBonusMaxPoints: 25,
  latencyBonusMaxPoints: 10,
  toolCallingBonusMaxPoints: 50,
  reasoningBonusMaxPoints: 30,
  fcaQualityFloor: 0.75,
  fcaQualityMultiplier: 100,
  fcaQualityGatedByComplexity: true,
  costNormalizationCeiling: 0.02,
  fcaChatPoolFloor: 0.82,
  fcaSimpleToolFloor: 0.83,
  fcaComplexToolFloor: 0.90,
  fcaDestructiveFloor: 0.93,
  fcaInfraOpsFloor: 0.85,
  fcaCloudListFloor: 0.90,
  fcaComplexityBiasFloor: 0.93,
  // T3 defaults — match the migration seed.
  fcaT3Floor: 0.93,
  contextT3Floor: 200_000,
  t3TriggerTaskTypes: [
    'cost-audit',
    'architecture-design-agentic',
    'multi-cloud-agentic',
    'multi-system-agentic',
  ],
  capabilityProfileFloors: {
    'multi-cloud-agentic': 0.90,
    'multi-system-agentic': 0.90,
    'cost-analysis-agentic': 0.90,
    'cost-audit': 0.93,
    'security-audit-agentic': 0.90,
    'architecture-design-agentic': 0.90,
    'single-system-read': 0.85,
    'file-read': 0.85,
    'pure-chat': 0.82,
  },
  capabilityContextFloors: {
    'multi-cloud-agentic': 30_000,
    'multi-system-agentic': 30_000,
    'cost-analysis-agentic': 100_000,
    'cost-audit': 100_000,
    'security-audit-agentic': 30_000,
    'architecture-design-agentic': 30_000,
    'single-system-read': 8_000,
    'file-read': 16_000,
    'pure-chat': 4_000,
  },
  intentClassifierEnabled: true,
  intentClassifierModelId: 'gpt-oss:20b',
};

// ---------------------------------------------------------------------------
// Live scoring simulator
// ---------------------------------------------------------------------------

export interface LabModel {
  id: string;
  fca: number;
  cost: number;
  latency: number;
  tier: string;
}

export interface PromptAnalysis {
  hasTools: boolean;
  isMultiStep: boolean;
  isComplexReasoning: boolean;
  isMultiCloud: boolean;
  estimatedTokens: number;
  destructive?: boolean;
  complexityBias?: boolean;
}

export interface LabPrompt {
  id: string;
  label: string;
  description: string;
  analysis: PromptAnalysis;
}

/** Registry row shape returned by GET /api/admin/llm-providers/registry */
interface RegistryRow {
  id: string;
  model: string;
  provider: string;
  role: string;
  priority: number;
  enabled: boolean;
  capabilities?: Record<string, unknown> | null;
  [key: string]: unknown;
}

/**
 * Map a registry row to a LabModel for scoring.
 *
 * 2026-04-23: registry endpoint now surfaces FCA/cost/latency at the row
 * level (enriched from ModelCapabilityRegistry). We still fall back to the
 * older `capabilities` nested shape for backward compatibility with older
 * API builds — the `row.capabilities` object from older builds was
 * booleans-only (no FCA), which was the root cause of "no surviving
 * candidates" in Lab v2.
 */
export function registryRowToLabModel(row: RegistryRow): LabModel {
  const caps = (row.capabilities ?? {}) as Record<string, unknown>;
  const costObj = caps.cost as Record<string, unknown> | undefined;
  const perfObj = caps.performance as Record<string, unknown> | undefined;

  // Prefer enriched top-level fields from the new registry endpoint
  const rowFca = typeof (row as any).functionCallingAccuracy === 'number'
    ? (row as any).functionCallingAccuracy
    : null;
  const rowCost = typeof (row as any).inputCostPer1k === 'number'
    ? (row as any).inputCostPer1k
    : null;
  const rowLatency = typeof (row as any).avgLatencyMs === 'number'
    ? (row as any).avgLatencyMs
    : null;

  // Fallback to nested capability shape for older API builds
  const fca = rowFca ?? (typeof caps.functionCallingAccuracy === 'number' ? (caps.functionCallingAccuracy as number) : null);
  const cost = rowCost ?? (typeof (costObj?.inputPer1kTokens) === 'number' ? (costObj?.inputPer1kTokens as number) : null);
  const latency = rowLatency ?? (typeof (perfObj?.avgLatencyMs) === 'number' ? (perfObj?.avgLatencyMs as number) : null);

  if (fca === null || cost === null) {
    console.warn(`[RouterTuningLab] Registry model "${row.model}" is missing FCA/cost. Using safe defaults.`);
  }

  return {
    id: row.model,
    fca: fca ?? 0.80,
    cost: cost ?? 0,
    latency: latency ?? 500,
    tier: row.role ?? 'mid',
  };
}

/**
 * Three canned prompts covering the routing spectrum. Pinned to a specific
 * difficulty label so the Lab can show what each tier of prompt should pick.
 */
export const DIFFICULTY_PROMPTS: Record<
  'easy' | 'medium' | 'hard',
  { label: string; description: string; prompt: string }
> = {
  easy: {
    label: 'Easy',
    description: 'Pure chat, no tools, short response — should route to a cheap high-FCA chat model.',
    prompt: 'why is the sky blue?',
  },
  medium: {
    label: 'Medium',
    description:
      'Infra planning + multi-cloud discovery + deploy + test + teardown + compare — should route to a high-FCA tool-caller.',
    prompt:
      'Write a full architecture diagram for an AKS deployment and show me my current Azure cloud usage. Give me a decision matrix on where best to place my data-processing workload. Deploy it and test it, then tear it down in both Azure and AWS options and tell me which is faster, cheaper, and better to run.',
  },
  hard: {
    label: 'Hard',
    description:
      'Parallel tools, subagents, synth executions, artifact creation, sandboxed exec — should route to a frontier-tier model.',
    prompt:
      'Analyze our Azure + AWS + GCP spend over the last 90 days in parallel, generate an interactive architecture diagram comparing our current multicloud topology to a proposed consolidated one, spawn subagents to draft migration runbooks for each workload, run a sandboxed React-to-PDF artifact conversion to export the board room deck, and then dispatch the synth executor to benchmark equivalent workloads on each cloud and rank them by cost/latency/reliability.',
  },
};

/** Curated prompt bank for Lab v2 (kept for heuristic-mode backward compat) */
export const LAB_PROMPTS: LabPrompt[] = [
  { id: 'haiku', label: 'Write me a haiku about the sea', description: 'Simple chat, no tools — tests cost-dominant routing',
    analysis: { hasTools: false, isMultiStep: false, isComplexReasoning: false, isMultiCloud: false, estimatedTokens: 20 } },

  { id: 'summarize-thread', label: 'Summarize this thread so far', description: 'Single-round, no tools — pure chat tier',
    analysis: { hasTools: false, isMultiStep: false, isComplexReasoning: false, isMultiCloud: false, estimatedTokens: 120 } },

  { id: 'list-subs', label: 'List my Azure subscriptions and all their resource groups', description: 'Simple tool call — Haiku-class qualifies',
    analysis: { hasTools: true, isMultiStep: false, isComplexReasoning: false, isMultiCloud: false, estimatedTokens: 60 } },

  { id: 'destructive-delete', label: 'Delete resource group rg-prod-01 and everything inside', description: 'Destructive verb + cloud noun — frontier-only safety filter kicks in',
    analysis: { hasTools: true, isMultiStep: false, isComplexReasoning: false, isMultiCloud: false, estimatedTokens: 45, destructive: true } },

  { id: 'multicloud-arch', label: 'Design a decoupled multicloud architecture for 100M users across IDP/data/compute/storage/ML layers', description: '3+ complexity keywords — frontier-only complexity bias',
    analysis: { hasTools: false, isMultiStep: true, isComplexReasoning: true, isMultiCloud: true, estimatedTokens: 90, complexityBias: true } },

  { id: 'aks-provision', label: 'Provision an AKS cluster in eastus2 then deploy my helm chart', description: 'Infra-ops + multi-step — high-FCA tool chain required',
    analysis: { hasTools: true, isMultiStep: true, isComplexReasoning: false, isMultiCloud: false, estimatedTokens: 70 } },

  { id: 'cost-compare', label: 'Compare our Azure vs AWS spend over the last 90 days and explain the main drivers', description: 'Multi-cloud + complex reasoning — frontier',
    analysis: { hasTools: true, isMultiStep: true, isComplexReasoning: true, isMultiCloud: true, estimatedTokens: 140 } },

  { id: 'migration-plan', label: 'Propose a 4-phase migration from on-prem Postgres to Cloud SQL with rollback plan', description: 'Multi-step planning + reasoning — frontier-tier',
    analysis: { hasTools: false, isMultiStep: true, isComplexReasoning: true, isMultiCloud: false, estimatedTokens: 200 } },
];

/** Analyze arbitrary prompt text into a PromptAnalysis shape (mirrors SmartRouter heuristics). */
export function analyzePromptText(text: string): PromptAnalysis {
  const lower = text.toLowerCase();
  const hasTools = /\b(list|show|query|get|call|use|fetch|inventory|audit|describe|delete|create|provision|deploy|restart|scale)\b/.test(lower);
  const isMultiStep = /\b(then|after|next|step|phase|first|second|finally)\b/.test(lower) || /\d+[-\s]?(step|phase)/.test(lower);
  const isComplexReasoning = /\b(design|architect|plan|strategy|compare|analyze|explain|why|tradeoff|migrate)\b/.test(lower);
  const isMultiCloud = ['azure', 'aws', 'gcp', 'google cloud'].filter(k => lower.includes(k)).length >= 2
    || /\bmulticloud\b|\bmulti-cloud\b/.test(lower);
  const destructive = /\b(delete|drop|terminate|destroy|purge|wipe|remove)\b/.test(lower)
    && /\b(resource group|subscription|vm|instance|database|db|cluster|pod|bucket)\b/.test(lower);
  const complexityBias = ['architecture', 'diagram', 'interactive', 'decoupled', 'multicloud', 'multi-cloud', 'layered', 'layers', 'enterprise', 'scale']
    .filter(k => lower.includes(k)).length >= 2;
  const estimatedTokens = Math.min(400, Math.max(20, text.length / 4));
  return { hasTools, isMultiStep, isComplexReasoning, isMultiCloud, estimatedTokens, destructive, complexityBias };
}

export function simulateScore(model: LabModel, tuning: RouterTuning, analysis: PromptAnalysis): number {
  const { costWeight, qualityWeight, costNormalizationCeiling } = tuning;
  let score = 0;

  // Cost bonus
  const costBonus = (1 - Math.min(model.cost / costNormalizationCeiling, 1)) * tuning.costBonusMaxPoints * costWeight;
  score += costBonus;

  // Latency bonus
  const latencyBonus = (1 - Math.min(model.latency / 1000, 1)) * tuning.latencyBonusMaxPoints * costWeight;
  score += latencyBonus;

  // Quality bonus (gated)
  const hasAnyComplexity =
    analysis.hasTools || analysis.isMultiStep || analysis.isComplexReasoning || analysis.isMultiCloud;
  if (!tuning.fcaQualityGatedByComplexity || hasAnyComplexity) {
    const headroom = Math.max(0, model.fca - tuning.fcaQualityFloor);
    score += headroom * tuning.fcaQualityMultiplier * qualityWeight;
  }

  // Tool-calling bonus
  if (analysis.hasTools) {
    score += model.fca * tuning.toolCallingBonusMaxPoints * (0.5 + qualityWeight * 0.5);
  }

  // Reasoning bonus
  if (analysis.isMultiStep || analysis.isMultiCloud) {
    score += model.fca * tuning.reasoningBonusMaxPoints * (0.5 + qualityWeight * 0.5);
  }

  return score;
}

/** Returns the floor key that filters the model out for the given prompt, or null. */
export function getFilterReason(model: LabModel, tuning: RouterTuning, analysis: PromptAnalysis): string | null {
  const { hasTools, isMultiStep, isComplexReasoning, isMultiCloud, destructive, complexityBias } = analysis;

  if (destructive && model.fca < tuning.fcaDestructiveFloor) {
    return `fcaDestructiveFloor (${tuning.fcaDestructiveFloor} > ${model.fca})`;
  }
  if (complexityBias && model.fca < tuning.fcaComplexityBiasFloor) {
    return `fcaComplexityBiasFloor (${tuning.fcaComplexityBiasFloor} > ${model.fca})`;
  }
  if ((isMultiStep || isComplexReasoning || isMultiCloud) && model.fca < tuning.fcaComplexToolFloor) {
    return `fcaComplexToolFloor (${tuning.fcaComplexToolFloor} > ${model.fca})`;
  }
  if (hasTools && model.fca < tuning.fcaSimpleToolFloor) {
    return `fcaSimpleToolFloor (${tuning.fcaSimpleToolFloor} > ${model.fca})`;
  }
  if (!hasTools && !isMultiStep && !isComplexReasoning && !isMultiCloud && model.fca < tuning.fcaChatPoolFloor) {
    return `fcaChatPoolFloor (${tuning.fcaChatPoolFloor} > ${model.fca})`;
  }
  return null;
}

/** Compute TTFT estimate (ms) based on model tier and estimated tokens. */
function computeTTFT(tier: string, estimatedTokens: number): number {
  const baselines: Record<string, number> = {
    frontier: 800,
    reasoning: 600,
    mid: 350,
    cheap: 150,
    local: 100,
  };
  const baseline = baselines[tier] ?? 500;
  return Math.round(baseline + estimatedTokens * 0.3);
}

/** Compute monthly cost estimate assuming 1M requests. */
function computeMonthlyCost(costPer1kTokens: number, estimatedTokens: number): string {
  const totalCost = 1_000_000 * estimatedTokens * (costPer1kTokens / 1000);
  return `$${totalCost.toFixed(2)}/mo @ 1M req`;
}

// ---------------------------------------------------------------------------
// Floor card metadata
// ---------------------------------------------------------------------------

interface FloorMeta {
  key: keyof RouterTuning;
  label: string;
  desc: string;
  colorVar: string;
}

const FLOOR_META: FloorMeta[] = [
  { key: 'fcaChatPoolFloor',       label: 'fcaChatPoolFloor',       desc: 'Kicks low-FCA models out of pure chat',                  colorVar: 'var(--color-primary)' },
  { key: 'fcaSimpleToolFloor',     label: 'fcaSimpleToolFloor',     desc: 'Single-round tools; mid-tier models qualify',            colorVar: 'var(--color-text-primary)' },
  { key: 'fcaComplexToolFloor',    label: 'fcaComplexToolFloor',    desc: 'Multi-step, multi-cloud chains',                         colorVar: 'var(--color-text-primary)' },
  { key: 'fcaDestructiveFloor',    label: 'fcaDestructiveFloor',    desc: 'delete/drop/terminate + resource → frontier only',       colorVar: 'var(--color-error)' },
  { key: 'fcaInfraOpsFloor',       label: 'fcaInfraOpsFloor',       desc: 'Cloud ops (provision, rebuild, query RG)',               colorVar: 'var(--color-text-primary)' },
  { key: 'fcaComplexityBiasFloor', label: 'fcaComplexityBiasFloor', desc: '2+ complexity keywords → frontier',                     colorVar: 'var(--color-warning)' },
];

// ---------------------------------------------------------------------------
// Formula chip metadata
// ---------------------------------------------------------------------------

type ChipColor = 'cost' | 'quality' | 'weight' | 'multiplier' | 'fca';

/**
 * Theme-aware tint helper — produces a translucent version of a theme
 * token using CSS `color-mix`. Re-themes automatically when the user
 * toggles light/dark or changes accent. Replaces hand-coded
 * `rgba(R,G,B,alpha)` literals which were baked dark-only.
 */
function tint(tokenVar: string, pct: number): string {
  return `color-mix(in srgb, ${tokenVar} ${pct}%, transparent)`;
}

const CHIP_STYLE: Record<ChipColor, React.CSSProperties> = {
  cost:       { color: 'var(--color-warning)' },
  quality:    { color: 'var(--color-success)' },
  weight:     { color: 'var(--color-primary)' },
  // "multiplier" is the orange-tier accent for scoring multipliers.
  // Maps to --color-accent-secondary in the theme so it re-themes; we
  // fall back to --color-warning if that token isn't defined in the
  // current theme (dark-only legacy fallback removed).
  multiplier: { color: 'var(--color-accent-secondary, var(--color-warning))' },
  fca:        { color: 'var(--color-primary)' },
};

// ---------------------------------------------------------------------------
// Inline chip editor sub-component
// ---------------------------------------------------------------------------

interface ChipProps {
  field: keyof RouterTuning;
  label: string;
  color: ChipColor;
  value: number | boolean;
  dirty: boolean;
  onCommit: (field: keyof RouterTuning, value: number | boolean) => void;
}

const Chip: React.FC<ChipProps> = ({ field, label, color, value, dirty, onCommit }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const displayVal =
    typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);

  const handleClick = () => {
    setDraft(displayVal);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    if (typeof value === 'boolean') {
      onCommit(field, draft === 'true');
    } else {
      const n = Number.parseFloat(draft);
      if (!isNaN(n)) onCommit(field, n);
    }
    setEditing(false);
  };

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    background: 'var(--color-surface-secondary)',
    border: `1px solid ${dirty ? 'var(--color-warning)' : 'var(--color-border)'}`,
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: '14px',
    transition: 'all 120ms',
    margin: '2px',
    boxShadow: dirty ? `0 0 0 2px ${tint('var(--color-warning)', 15)}` : 'none',
    ...CHIP_STYLE[color],
  };

  const valStyle: React.CSSProperties = {
    background: 'var(--color-surface-tertiary)',
    padding: '1px 6px',
    borderRadius: '4px',
    fontWeight: 600,
    color: 'var(--color-text-primary)',
  };

  return (
    <span
      style={chipStyle}
      role="button"
      tabIndex={editing ? -1 : 0}
      onClick={!editing ? handleClick : undefined}
      onKeyDown={!editing ? onKeyActivate(handleClick) : undefined}
      title={`Click to edit ${label}`}
    >
      {label}
      {FIELD_HELP[field] && (
        <span role="presentation" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center' }}>
          <FieldHelp fieldName={field} />
        </span>
      )}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={commit}
          style={{
            width: `${Math.max(draft.length, 4) + 2}ch`,
            background: 'var(--color-surface-tertiary)',
            border: '1px solid var(--color-primary)',
            borderRadius: '4px',
            padding: '1px 4px',
            fontFamily: 'inherit',
            fontSize: 'inherit',
            color: 'var(--color-text-primary)',
            outline: 'none',
          }}
          aria-label={`Edit ${label}`}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="val" style={valStyle}>{displayVal}</span>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Floor card sub-component
// ---------------------------------------------------------------------------

interface FloorCardProps {
  meta: FloorMeta;
  value: number;
  dirty: boolean;
  onCommit: (field: keyof RouterTuning, value: number) => void;
}

const FloorCard: React.FC<FloorCardProps> = ({ meta, value, dirty, onCommit }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    setDraft(String(value));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    const n = Number.parseFloat(draft);
    if (!isNaN(n)) onCommit(meta.key, n);
    setEditing(false);
  };

  return (
    <div
      role="button"
      tabIndex={editing ? -1 : 0}
      onClick={!editing ? handleClick : undefined}
      onKeyDown={!editing ? onKeyActivate(handleClick) : undefined}
      style={{
        background: 'var(--color-surface-tertiary)',
        border: `1px solid ${dirty ? 'var(--color-warning)' : 'var(--color-border)'}`,
        borderRadius: '8px',
        padding: '14px 16px',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        cursor: editing ? 'default' : 'pointer',
        transition: 'border 120ms',
        boxShadow: dirty ? `0 0 0 2px ${tint('var(--color-warning)', 15)}` : 'none',
      }}
      title="Click to edit"
    >
      <div style={{ color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '6px' }}>
        {meta.label}
        <span role="presentation" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <FieldHelp fieldName={meta.key} />
        </span>
      </div>
      <div style={{ marginTop: '4px', fontSize: '20px', fontWeight: 600, color: meta.colorVar, fontVariantNumeric: 'tabular-nums' }}>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={commit}
            style={{
              width: '7ch',
              background: 'var(--color-surface-tertiary)',
              border: '1px solid var(--color-primary)',
              borderRadius: '4px',
              padding: '1px 4px',
              fontFamily: 'inherit',
              fontSize: '16px',
              color: 'var(--color-text-primary)',
              outline: 'none',
            }}
            aria-label={`Edit ${meta.label}`}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          value.toFixed(2)
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-body)', color: 'var(--color-text-secondary)', fontSize: '11px', marginTop: '6px', lineHeight: 1.4 }}>
        {meta.desc}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// JsonFieldEditor — textarea + Save/Reset for one JSON-shaped tuning field.
// Added 2026-05-22 (#1049) for the T3 capability-gate JSON columns
// (t3TriggerTaskTypes / capabilityProfileFloors / capabilityContextFloors).
// Validation is shape-only; the API does range + per-key numeric checks.
// ---------------------------------------------------------------------------

interface JsonFieldEditorProps {
  field: string;
  label: string;
  help: string;
  value: unknown;
  dirty: boolean;
  onCommit: (value: unknown) => void;
  validate: (parsed: unknown) => string | null;
}

const JsonFieldEditor: React.FC<JsonFieldEditorProps> = ({
  field,
  label,
  help,
  value,
  dirty,
  onCommit,
  validate,
}) => {
  const [draft, setDraft] = useState<string>(JSON.stringify(value, null, 2));
  const [draftError, setDraftError] = useState<string | null>(null);

  // Re-sync draft when saved value changes (after a successful PUT)
  React.useEffect(() => {
    setDraft(JSON.stringify(value, null, 2));
    setDraftError(null);
  }, [JSON.stringify(value)]);

  const handleSave = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (err: any) {
      setDraftError(`invalid JSON: ${err?.message ?? String(err)}`);
      return;
    }
    const shapeErr = validate(parsed);
    if (shapeErr) {
      setDraftError(shapeErr);
      return;
    }
    setDraftError(null);
    onCommit(parsed);
  };

  const handleReset = () => {
    setDraft(JSON.stringify(value, null, 2));
    setDraftError(null);
  };

  return (
    <div
      style={{
        background: 'var(--color-surface-tertiary)',
        border: `1px solid ${dirty ? 'var(--color-warning)' : 'var(--color-border)'}`,
        borderRadius: '8px',
        padding: '14px 16px',
        marginTop: '14px',
        boxShadow: dirty ? `0 0 0 2px ${tint('var(--color-warning)', 15)}` : 'none',
      }}
      data-testid={`router-tuning-json-editor-${field}`}
    >
      <div
        style={{
          color: 'var(--color-text-secondary)',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontFamily: 'var(--font-mono)',
          marginBottom: '6px',
        }}
      >
        {label}
      </div>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px', margin: '0 0 8px' }}>
        {help}
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        style={{
          width: '100%',
          minHeight: '120px',
          background: 'var(--color-surface)',
          border: `1px solid ${draftError ? 'var(--color-error)' : 'var(--color-border)'}`,
          borderRadius: '6px',
          padding: '8px 10px',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          color: 'var(--color-text-primary)',
          outline: 'none',
          resize: 'vertical',
        }}
        aria-label={`Edit ${label}`}
      />
      {draftError && (
        <div style={{ color: 'var(--color-error)', fontSize: '12px', marginTop: '6px' }}>
          {draftError}
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button
          type="button"
          onClick={handleSave}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            border: '1px solid var(--color-primary)',
            background: 'var(--color-primary)',
            color: 'var(--color-on-primary, white)',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          Stage edit
        </button>
        <button
          type="button"
          onClick={handleReset}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            border: '1px solid var(--color-border)',
            background: 'transparent',
            color: 'var(--color-text-primary)',
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          Revert
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// LabPromptCard — collapsible card for a single curated prompt (Lab v2)
// ---------------------------------------------------------------------------

interface LabPromptCardProps {
  prompt: LabPrompt;
  labModels: LabModel[];
  tuning: RouterTuning;
  showFiltered: boolean;
  defaultExpanded?: boolean;
}

const LabPromptCard: React.FC<LabPromptCardProps> = ({ prompt, labModels, tuning, showFiltered, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const analysis = prompt.analysis;

  // Compute per-model results
  type LabResult = { model: LabModel; score: number; filterReason: string | null };
  const allResults: LabResult[] = labModels.map(m => ({
    model: m,
    score: simulateScore(m, tuning, analysis),
    filterReason: getFilterReason(m, tuning, analysis),
  }));

  const survivingResults = allResults.filter(r => r.filterReason === null);

  // Stable sort: score desc, then FCA desc, then cost asc
  const sortedSurvivors = [...survivingResults].sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.001) return b.score - a.score;
    if (Math.abs(a.model.fca - b.model.fca) > 0.001) return b.model.fca - a.model.fca;
    return a.model.cost - b.model.cost;
  });

  const filteredResults = allResults.filter(r => r.filterReason !== null);

  // Winner is rank-1 survivor
  const winner = sortedSurvivors[0] ?? null;

  // Build display rows: survivors sorted, then filtered (if shown)
  const displayRows: Array<LabResult & { rank: number | null }> = [
    ...sortedSurvivors.map((r, i) => ({ ...r, rank: i + 1 })),
    ...(showFiltered ? filteredResults.map(r => ({ ...r, rank: null })) : []),
  ];

  const winnerSummary = winner
    ? `→ ${winner.model.id} · ${winner.score.toFixed(1)} pts`
    : '→ no surviving candidates';

  // Rank row background/border styles
  function rankStyle(rank: number | null): React.CSSProperties {
    if (rank === 1) return { background: tint('var(--color-success)', 12), borderLeft: '3px solid var(--color-success)' };
    if (rank === 2) return { background: tint('var(--color-primary)', 10), borderLeft: '3px solid var(--color-primary)' };
    if (rank === 3) return { background: tint('var(--color-accent-secondary, var(--color-warning))', 10), borderLeft: '3px solid var(--color-accent-secondary, var(--color-warning))' };
    return {};
  }

  const flagStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    fontFamily: 'var(--font-mono)',
    background: active ? tint('var(--color-success)', 12) : tint('var(--color-text-secondary)', 8),
    color: active ? 'var(--color-success)' : 'var(--color-text-secondary)',
    border: `1px solid ${active ? tint('var(--color-success)', 40) : tint('var(--color-text-secondary)', 20)}`,
  });

  return (
    <div
      data-testid={`lab-prompt-${prompt.id}`}
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: '10px',
        overflow: 'hidden',
        marginBottom: '8px',
      }}
    >
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        data-testid={`lab-prompt-toggle-${prompt.id}`}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'var(--color-surface-secondary)',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          gap: '8px',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 500, fontSize: '14px', color: 'var(--color-text-primary)' }}>
            &ldquo;{prompt.label}&rdquo;
          </span>
          {!expanded && (
            <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
              {winnerSummary}
            </span>
          )}
        </div>
        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div
          data-testid={`lab-prompt-expanded-${prompt.id}`}
          style={{ padding: '16px', background: 'var(--color-surface-primary)' }}
        >
          {/* Description */}
          <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
            {prompt.description}
          </p>

          {/* Analyzer flags */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
            <span style={flagStyle(analysis.hasTools)}>hasTools {analysis.hasTools ? '✓' : '✗'}</span>
            <span style={flagStyle(analysis.isMultiStep)}>isMultiStep {analysis.isMultiStep ? '✓' : '✗'}</span>
            <span style={flagStyle(!!analysis.complexityBias)}>complexityBias {analysis.complexityBias ? '✓' : '✗'}</span>
            <span style={flagStyle(!!analysis.destructive)}>destructive {analysis.destructive ? '✓' : '✗'}</span>
            <span style={flagStyle(analysis.isMultiCloud)}>isMultiCloud {analysis.isMultiCloud ? '✓' : '✗'}</span>
            <span style={flagStyle(analysis.isComplexReasoning)}>isComplexReasoning {analysis.isComplexReasoning ? '✓' : '✗'}</span>
          </div>

          {/* Candidate table */}
          {labModels.length < 2 ? (
            <div
              data-testid="lab-insufficient-models-banner"
              style={{
                padding: '14px 18px',
                background: tint('var(--color-warning)', 10),
                border: `1px solid ${tint('var(--color-warning)', 40)}`,
                borderRadius: '8px',
                color: 'var(--color-warning)',
                fontSize: '14px',
              }}
            >
              At least 2 enabled models are required for the Live Scoring Lab. Add more via Admin → LLM → Providers.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Rank', 'Model', 'FCA', 'TTFT est', 'Monthly cost est', 'Score'].map(h => (
                      <th key={h} style={{
                        textAlign: 'left',
                        padding: '8px 12px',
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: 'var(--color-text-secondary)',
                        fontWeight: 500,
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map(({ model, score, filterReason, rank }) => {
                    const ttft = computeTTFT(model.tier, analysis.estimatedTokens);
                    const p95 = Math.round(model.latency * 2.2);
                    const monthlyCost = computeMonthlyCost(model.cost, analysis.estimatedTokens);
                    const isFiltered = filterReason !== null;

                    return (
                      <tr
                        key={model.id}
                        data-testid={`lab-row-${model.id}`}
                        data-rank={rank ?? 'filtered'}
                        className={isFiltered ? 'filtered' : ''}
                        style={{
                          borderBottom: '1px solid var(--color-border)',
                          opacity: isFiltered ? 0.45 : 1,
                          ...rankStyle(rank),
                        }}
                      >
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                          {rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : rank !== null ? `${rank}th` : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--color-text-primary)' }}>
                          {model.id}
                        </td>
                        <td style={{ padding: '10px 12px' }}>{model.fca.toFixed(2)}</td>
                        {isFiltered ? (
                          <>
                            <td style={{ padding: '10px 12px', textDecoration: 'line-through', color: 'var(--color-text-secondary)' }}>{ttft}ms</td>
                            <td style={{ padding: '10px 12px', textDecoration: 'line-through', color: 'var(--color-text-secondary)' }}>{monthlyCost}</td>
                            <td style={{ padding: '10px 12px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                              filtered by {filterReason}
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={{ padding: '10px 12px' }}>{ttft}ms <span style={{ color: 'var(--color-text-secondary)', fontSize: '10px' }}>(p95: {p95}ms)</span></td>
                            <td style={{ padding: '10px 12px' }}>{monthlyCost}</td>
                            <td style={{ padding: '10px 12px', fontWeight: rank === 1 ? 700 : 'normal' }}>{score.toFixed(1)}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// LivePipelineResult — renders the response from
// POST /api/admin/router-tuning/simulate. Uses the real ranking the
// SmartModelRouter would produce at request time, not the client heuristic.
// ---------------------------------------------------------------------------

interface LivePipelineResultProps {
  result: {
    prompt: string;
    analysis: { hasTools: boolean; toolCount: number; isMultiStep: boolean; isComplexReasoning: boolean; isMultiCloud: boolean; requiresVision: boolean; estimatedTokens: number };
    decision: { selectedModelId: string; reason: string; resolvedBy: string; tier: string };
    ranked: Array<{ modelId: string; provider: string; score: number; fca: number; inputCostPer1k: number; avgLatencyMs: number; tier: string; rank: number }>;
    filteredOut: Array<{ modelId: string; fca: number; excludedBy: string }>;
  };
}

const LivePipelineResult: React.FC<LivePipelineResultProps> = ({ result }) => {
  const { analysis, decision, ranked, filteredOut } = result;

  const rankStyle = (rank: number): React.CSSProperties => {
    if (rank === 1) return { background: tint('var(--color-success)', 14), borderLeft: '3px solid var(--color-success)' };
    if (rank === 2) return { background: tint('var(--color-primary)', 12), borderLeft: '3px solid var(--color-primary)' };
    if (rank === 3) return { background: tint('var(--color-warning)', 12), borderLeft: '3px solid var(--color-warning)' };
    return {};
  };

  const flagStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    fontFamily: 'var(--font-mono)',
    background: active ? tint('var(--color-success)', 14) : tint('var(--color-text-secondary)', 8),
    color: active ? 'var(--color-success)' : 'var(--color-text-secondary)',
    border: `1px solid ${active ? tint('var(--color-success)', 40) : tint('var(--color-text-secondary)', 20)}`,
  });

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '8px 10px',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--color-text-secondary)',
    fontWeight: 500,
    borderBottom: '1px solid var(--color-border)',
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px',
    fontSize: '13px',
    color: 'var(--color-text-primary)',
    borderBottom: `1px solid ${tint('var(--color-border)', 40)}`,
  };

  return (
    <div
      data-testid="lab-live-pipeline-result"
      style={{
        border: '1px solid var(--color-primary)',
        borderRadius: '10px',
        overflow: 'hidden',
        marginTop: '8px',
        background: 'var(--color-surface-primary)',
      }}
    >
      <div style={{
        padding: '12px 16px',
        background: tint('var(--color-primary)', 10),
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '3px 8px',
            borderRadius: '6px',
            background: 'var(--color-primary)',
            color: 'var(--color-bg-primary)',
          }}>
            Live Pipeline
          </span>
          <span style={{ fontWeight: 500, fontSize: '14px', color: 'var(--color-text-primary)' }} title={result.prompt}>
            &ldquo;{result.prompt.length > 60 ? result.prompt.slice(0, 60) + '…' : result.prompt}&rdquo;
          </span>
        </div>
        <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
          → {decision.selectedModelId} · {decision.tier}
        </span>
      </div>

      <div style={{ padding: '16px', background: 'var(--color-surface-primary)' }}>
        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
          {decision.reason} · Path: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>{decision.resolvedBy}</code>
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
          <span style={flagStyle(analysis.hasTools)}>hasTools {analysis.hasTools ? '✓' : '✗'}{analysis.toolCount ? ` (${analysis.toolCount})` : ''}</span>
          <span style={flagStyle(analysis.isMultiStep)}>isMultiStep {analysis.isMultiStep ? '✓' : '✗'}</span>
          <span style={flagStyle(analysis.isMultiCloud)}>isMultiCloud {analysis.isMultiCloud ? '✓' : '✗'}</span>
          <span style={flagStyle(analysis.isComplexReasoning)}>isComplexReasoning {analysis.isComplexReasoning ? '✓' : '✗'}</span>
          <span style={flagStyle(analysis.requiresVision)}>vision {analysis.requiresVision ? '✓' : '✗'}</span>
          <span style={{ ...flagStyle(false), background: tint('var(--color-text-secondary)', 6) }}>~{analysis.estimatedTokens} tok</span>
        </div>

        {ranked.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
            No candidates survived the router's filter chain. Check your floors under the Scoring Formula above.
          </div>
        ) : (
          <div style={{ overflow: 'hidden', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-secondary)' }}>
                  <th style={{ ...thStyle, width: '48px' }}>#</th>
                  <th style={thStyle}>Model</th>
                  <th style={{ ...thStyle, width: '80px' }}>Tier</th>
                  <th style={{ ...thStyle, width: '80px' }}>FCA</th>
                  <th style={{ ...thStyle, width: '100px' }}>Cost /1k</th>
                  <th style={{ ...thStyle, width: '80px' }}>TTFT</th>
                  <th style={{ ...thStyle, width: '80px' }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(r => (
                  <tr key={r.modelId} style={rankStyle(r.rank)}>
                    <td style={{ ...tdStyle, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{r.rank}</td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500 }}>{r.modelId}</div>
                      <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{r.provider}</div>
                    </td>
                    <td style={{ ...tdStyle, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-secondary)' }}>
                      {r.tier}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{(r.fca * 100).toFixed(0)}%</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>${r.inputCostPer1k.toFixed(4)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
                      ~{r.avgLatencyMs || 500}ms
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filteredOut.length > 0 && (
          <details style={{ marginTop: '12px' }}>
            <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              {filteredOut.length} model{filteredOut.length === 1 ? '' : 's'} excluded by floors
            </summary>
            <ul style={{ margin: '8px 0 0', padding: '0 0 0 16px', fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              {filteredOut.map((f, i) => (
                <li key={`${f.modelId}-${i}`} style={{ fontFamily: 'var(--font-mono)' }}>
                  {f.modelId} (FCA {(f.fca * 100).toFixed(0)}%) — <span style={{ color: 'var(--color-warning)' }}>{f.excludedBy}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const MAX_LAB_MODELS = 8;

const RouterTuningView: React.FC = () => {
  const { data: apiData, isLoading, error: queryError } = useAdminQuery<RouterTuningApiResponse>(
    ['router-tuning'],
    '/api/admin/router-tuning',
  );

  const { data: registryRows, isLoading: registryLoading } = useAdminQuery<RegistryRow[]>(
    ['llm-registry', 'enabled'],
    '/api/admin/llm-providers/registry?enabledOnly=true',
  );

  // Merge API data with defaults so the component works before the API resolves
  const savedTuning: RouterTuning = apiData?.tuning ?? DEFAULT_TUNING;

  // dirty holds field → new value overrides
  const [dirty, setDirty] = useState<Partial<RouterTuning>>({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Lab state
  const [customPromptText, setCustomPromptText] = useState('');
  // Difficulty pill state — which canned prompt is active (null = none chosen)
  const [activeDifficulty, setActiveDifficulty] = useState<null | 'easy' | 'medium' | 'hard'>(null);
  // Real-pipeline simulation (POST /api/admin/router-tuning/simulate)
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<null | {
    prompt: string;
    analysis: { hasTools: boolean; toolCount: number; isMultiStep: boolean; isComplexReasoning: boolean; isMultiCloud: boolean; requiresVision: boolean; estimatedTokens: number };
    decision: { selectedModelId: string; reason: string; resolvedBy: string; tier: string };
    ranked: Array<{ modelId: string; provider: string; score: number; fca: number; inputCostPer1k: number; avgLatencyMs: number; tier: string; rank: number }>;
    filteredOut: Array<{ modelId: string; fca: number; excludedBy: string }>;
  }>(null);

  // Effective tuning = saved + dirty overrides
  const tuning: RouterTuning = { ...savedTuning, ...dirty };

  const dirtyCount = Object.keys(dirty).length;

  // Commit a single field change. Accepts number / boolean (scalar fields)
  // OR a JSON-shaped value (t3TriggerTaskTypes / capabilityProfileFloors /
  // capabilityContextFloors); compare-by-stringify so dirty-tracking works
  // for arrays/objects too.
  const handleCommit = useCallback((field: keyof RouterTuning, value: unknown) => {
    setDirty(prev => {
      const next = { ...prev, [field]: value } as Partial<RouterTuning>;
      const savedVal = (savedTuning as unknown as Record<string, unknown>)[field];
      const sameAsSaved =
        typeof value === 'object' && value !== null
          ? JSON.stringify(value) === JSON.stringify(savedVal)
          : value === savedVal;
      if (sameAsSaved) {
        const { [field]: _removed, ...rest } = next as unknown as Record<string, unknown>;
        return rest as Partial<RouterTuning>;
      }
      return next;
    });
  }, [savedTuning]);

  const handleDiscard = () => {
    setDirty({});
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiRequest('/api/admin/router-tuning', {
        method: 'PUT',
        body: JSON.stringify(dirty),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Save failed (HTTP ${res.status})`);
      }
      setDirty({});
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setSaveError(null);
    try {
      const res = await apiRequest('/api/admin/router-tuning/reset', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Reset failed (HTTP ${res.status})`);
      }
      setDirty({});
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  const runSimulation = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;
    setSimulating(true);
    setSimError(null);
    setSimResult(null);
    try {
      const res = await apiRequest('/api/admin/router-tuning/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!data?.success) {
        throw new Error(data?.message || 'Simulation failed');
      }
      setSimResult({
        prompt: prompt.trim(),
        analysis: data.analysis,
        decision: data.decision,
        ranked: data.ranked,
        filteredOut: data.filteredOut,
      });
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setSimulating(false);
    }
  }, []);

  const handleSimulateCustomPrompt = () => runSimulation(customPromptText);

  const handlePickDifficulty = (d: 'easy' | 'medium' | 'hard') => {
    setActiveDifficulty(d);
    runSimulation(DIFFICULTY_PROMPTS[d].prompt);
  };

  // Helper: is field dirty?
  const isDirty = (field: keyof RouterTuning) => field in dirty;

  // Map registry rows → LabModels, sorted and capped for UX
  const labModels = useMemo<LabModel[]>(() => {
    if (!registryRows || registryRows.length === 0) return [];
    const mapped = registryRows.map(registryRowToLabModel);
    // Sort: frontier-first (highest FCA first) so ranking is deterministic
    const sorted = [...mapped].sort((a, b) => b.fca - a.fca);
    return sorted.slice(0, MAX_LAB_MODELS);
  }, [registryRows]);

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: 'var(--color-text-secondary)',
    margin: '0 0 20px',
  };

  const opStyle: React.CSSProperties = {
    color: 'var(--color-text-secondary)',
    margin: '0 4px',
  };

  const bigOpStyle: React.CSSProperties = {
    ...opStyle,
    fontSize: '22px',
    margin: '0 8px',
  };

  const gateChipStyle: React.CSSProperties = {
    background: tint('var(--color-success)', 10),
    border: `1px solid ${tint('var(--color-success)', 40)}`,
    color: 'var(--color-success)',
    padding: '3px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    fontFamily: 'var(--font-mono)',
    marginLeft: '6px',
  };

  const podCount = apiData?.podCount ?? 3;
  const lastUpdatedBy = apiData?.lastUpdatedBy;
  const lastUpdatedAt = apiData?.lastUpdatedAt;

  // Insufficient models banner (shown in lab only if less than 2 models when expanded)
  const tooFewModels = !registryLoading && labModels.length < 2;

  return (
    <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '0 0 120px', position: 'relative' }}>
      {/* Pulse animation */}
      <style>{`
        @keyframes rt-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>

      <PageHeader
        crumbs={['Admin', 'LLM', 'Router Tuning']}
        title="Router Tuning"
        explainer="Tune Smart Router scoring weights and FCA floors. Click coefficient chips in the formula to edit; live preview updates below."
        actions={[
          { label: dirtyCount > 0 ? `Discard (${dirtyCount})` : 'Discard', onClick: () => handleDiscard(), disabled: dirtyCount === 0 || saving },
          { label: 'Reset', onClick: () => { void handleReset(); }, disabled: resetting || saving },
          { label: saving ? 'Saving…' : 'Save', primary: true, onClick: () => { void handleSave(); }, disabled: dirtyCount === 0 || saving },
        ]}
      />

      <div style={{ padding: '24px 28px 0' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
      <AdminCard padding="lg">
        <h1 style={{ fontSize: '26px', fontWeight: 600, margin: '0 0 6px', letterSpacing: '-0.01em', color: 'var(--color-text-primary)' }}>
          Smart Router — Scoring Formula
          {' '}
          <span
            title="This page tunes only the Smart Router (requests with session model 'auto'). Tenant defaults for chat / code / embeddings / vision / image-gen live under Admin → LLM → Default Models. SmartRouter does not override an explicit model pin on a session or request."
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '18px',
              height: '18px',
              marginLeft: '8px',
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: '50%',
              cursor: 'help',
              verticalAlign: 'middle',
            }}
          >
            ?
          </span>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            background: tint('var(--color-success)', 12),
            border: `1px solid ${tint('var(--color-success)', 40)}`,
            color: 'var(--color-success)',
            borderRadius: '12px',
            fontSize: '12px',
            marginLeft: '12px',
            verticalAlign: 'middle',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block', animation: 'rt-pulse 2s ease-in-out infinite' }} />
            Live · {isLoading ? '…' : `${podCount} pods synced`}
          </span>
        </h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: 0 }}>
          A 0.1 weight change typically shifts 10–30% of routed traffic — test in the Lab below before saving.
          {lastUpdatedBy && lastUpdatedAt && (
            <span style={{ marginLeft: '8px' }}>
              Last saved: {new Date(lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} UTC by {lastUpdatedBy}
            </span>
          )}
        </p>
      </AdminCard>
      </div>

      {/* API / save errors */}
      {(queryError || saveError) && (
        <div style={{
          padding: '12px 16px',
          background: tint('var(--color-error)', 10),
          border: `1px solid ${tint('var(--color-error)', 40)}`,
          borderRadius: '8px',
          color: 'var(--color-error)',
          marginBottom: '16px',
          fontSize: '14px',
        }}>
          {saveError ?? String(queryError)}
        </div>
      )}

      {saveSuccess && (
        <div style={{
          padding: '12px 16px',
          background: tint('var(--color-success)', 10),
          border: `1px solid ${tint('var(--color-success)', 40)}`,
          borderRadius: '8px',
          color: 'var(--color-success)',
          marginBottom: '16px',
          fontSize: '14px',
        }}>
          Saved successfully — propagating to all pods.
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Section 1: Scoring Formula                                          */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginBottom: '20px' }}>
      <AdminCard>
        <h2 style={sectionTitleStyle}>Scoring Formula</h2>
        <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '12px', fontStyle: 'italic' }}>
          Click a colored chip to edit. Hover for description.
        </p>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '16px',
          lineHeight: 2.2,
          background: 'var(--color-surface-tertiary)',
          padding: '24px',
          borderRadius: '10px',
          textAlign: 'center',
          flexWrap: 'wrap',
        }}>
          {/* Line 1: costBonus × costWeight + qualityBonus × qualityWeight [gated] */}
          <div style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', gap: '2px' }}>
            <Chip field="costBonusMaxPoints" label="costBonus" color="cost" value={tuning.costBonusMaxPoints} dirty={isDirty('costBonusMaxPoints')} onCommit={handleCommit} />
            <span style={opStyle}>×</span>
            <Chip field="costWeight" label="costWeight" color="weight" value={tuning.costWeight} dirty={isDirty('costWeight')} onCommit={handleCommit} />
            <span style={bigOpStyle}>+</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: 'var(--color-success)', fontFamily: 'inherit', fontSize: '14px' }}>qualityBonus</span>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>(FCA − </span>
              <Chip field="fcaQualityFloor" label="" color="fca" value={tuning.fcaQualityFloor} dirty={isDirty('fcaQualityFloor')} onCommit={handleCommit} />
              <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>)</span>
              <span style={opStyle}>×</span>
              <Chip field="fcaQualityMultiplier" label="" color="quality" value={tuning.fcaQualityMultiplier} dirty={isDirty('fcaQualityMultiplier')} onCommit={handleCommit} />
            </span>
            <span style={opStyle}>×</span>
            <Chip field="qualityWeight" label="qualityWeight" color="weight" value={tuning.qualityWeight} dirty={isDirty('qualityWeight')} onCommit={handleCommit} />
            <span style={{ ...gateChipStyle, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              gated by complexity
              <FieldHelp fieldName="fcaQualityGatedByComplexity" />
            </span>
          </div>

          <br />

          {/* Line 2: + latencyBonus × costWeight + toolCallingBonus · if hasTools + reasoningBonus · if multi-step */}
          <div style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', gap: '2px' }}>
            <span style={bigOpStyle}>+</span>
            <Chip field="latencyBonusMaxPoints" label="latencyBonus" color="multiplier" value={tuning.latencyBonusMaxPoints} dirty={isDirty('latencyBonusMaxPoints')} onCommit={handleCommit} />
            <span style={opStyle}>×</span>
            <span style={{ ...CHIP_STYLE.weight, fontFamily: 'var(--font-mono)', fontSize: '14px' }}>costWeight</span>
            <span style={bigOpStyle}>+</span>
            <Chip field="toolCallingBonusMaxPoints" label="toolCallingBonus" color="multiplier" value={tuning.toolCallingBonusMaxPoints} dirty={isDirty('toolCallingBonusMaxPoints')} onCommit={handleCommit} />
            <span style={{ color: 'var(--color-text-secondary)', marginLeft: '2px' }}>·if hasTools</span>
            <span style={bigOpStyle}>+</span>
            <Chip field="reasoningBonusMaxPoints" label="reasoningBonus" color="multiplier" value={tuning.reasoningBonusMaxPoints} dirty={isDirty('reasoningBonusMaxPoints')} onCommit={handleCommit} />
            <span style={{ color: 'var(--color-text-secondary)', marginLeft: '2px' }}>·if multi-step</span>
            <span style={bigOpStyle}>·</span>
            <Chip field="costNormalizationCeiling" label="costCeiling" color="cost" value={tuning.costNormalizationCeiling} dirty={isDirty('costNormalizationCeiling')} onCommit={handleCommit} />
            <span style={{ color: 'var(--color-text-secondary)', marginLeft: '2px' }}>$/1k ceiling</span>
          </div>
        </div>
      </AdminCard>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section 2: FCA Floors                                               */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginBottom: '20px' }}>
      <AdminCard>
        <h2 style={sectionTitleStyle}>FCA Floors (exclusion filters, applied before scoring)</h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '14px',
        }}>
          {FLOOR_META.map(meta => (
            <FloorCard
              key={meta.key}
              meta={meta}
              value={tuning[meta.key] as number}
              dirty={isDirty(meta.key)}
              onCommit={handleCommit}
            />
          ))}
        </div>
      </AdminCard>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section 2b: T3 Capability Gate (#1049, 2026-05-22)                  */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginBottom: '20px' }}>
      <AdminCard>
        <h2 style={sectionTitleStyle}>T3 Capability Gate (structural classifier — no lexical safety-net)</h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px', margin: '0 0 14px' }}>
          When the PromptClassifier emits a taskType in <code>t3TriggerTaskTypes</code>, candidates
          must clear both <code>fcaT3Floor</code> AND <code>contextT3Floor</code>. Throws
          NO_T3_MODEL_IN_REGISTRY rather than silently downgrading.
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '14px',
          marginBottom: '20px',
        }}>
          <FloorCard
            meta={{ key: 'fcaT3Floor', label: 'fcaT3Floor', desc: 'T3 FCA floor (0..1)', colorVar: 'var(--color-warning)' }}
            value={tuning.fcaT3Floor}
            dirty={isDirty('fcaT3Floor')}
            onCommit={handleCommit}
          />
          <FloorCard
            meta={{ key: 'contextT3Floor', label: 'contextT3Floor', desc: 'T3 context-window floor (tokens)', colorVar: 'var(--color-warning)' }}
            value={tuning.contextT3Floor}
            dirty={isDirty('contextT3Floor')}
            onCommit={handleCommit}
          />
        </div>
        <JsonFieldEditor
          field="t3TriggerTaskTypes"
          label="t3TriggerTaskTypes"
          help="JSON array of TaskType identifiers that fire the T3 gate. Default: cost-audit, architecture-design-agentic, multi-cloud-agentic, multi-system-agentic."
          value={tuning.t3TriggerTaskTypes}
          dirty={isDirty('t3TriggerTaskTypes')}
          onCommit={(v) => handleCommit('t3TriggerTaskTypes', v as unknown as never)}
          validate={(parsed) => {
            if (!Array.isArray(parsed)) return 'must be a JSON array of strings';
            if (!parsed.every((s) => typeof s === 'string')) return 'all entries must be strings';
            return null;
          }}
        />
        <JsonFieldEditor
          field="capabilityProfileFloors"
          label="capabilityProfileFloors"
          help="JSON object map { TaskType: FCA-floor }. Replaces hardcoded CAPABILITY_PROFILES[taskType].requiresToolUseReliability literals."
          value={tuning.capabilityProfileFloors}
          dirty={isDirty('capabilityProfileFloors')}
          onCommit={(v) => handleCommit('capabilityProfileFloors', v as unknown as never)}
          validate={(parsed) => {
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 'must be a JSON object';
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
              if (typeof v !== 'number' || isNaN(v as number)) return `value at "${k}" must be a number`;
              if ((v as number) < 0 || (v as number) > 1) return `value at "${k}" must be in [0, 1]`;
            }
            return null;
          }}
        />
        <JsonFieldEditor
          field="capabilityContextFloors"
          label="capabilityContextFloors"
          help="JSON object map { TaskType: context-window-token-floor }. Replaces hardcoded CAPABILITY_PROFILES[taskType].requiresContextTokens literals."
          value={tuning.capabilityContextFloors}
          dirty={isDirty('capabilityContextFloors')}
          onCommit={(v) => handleCommit('capabilityContextFloors', v as unknown as never)}
          validate={(parsed) => {
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 'must be a JSON object';
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
              if (typeof v !== 'number' || isNaN(v as number) || !Number.isInteger(v)) return `value at "${k}" must be an integer`;
              if ((v as number) < 0) return `value at "${k}" must be ≥ 0`;
            }
            return null;
          }}
        />
      </AdminCard>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Section 3: Live Scoring Lab v2                                      */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginBottom: '20px' }}>
      <AdminCard>
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ ...sectionTitleStyle, margin: 0 }}>Live Scoring Lab</h2>
        </div>

        {/* Loading skeleton */}
        {registryLoading && (
          <div style={{
            padding: '14px 18px',
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            fontStyle: 'italic',
          }}>
            Loading registry models…
          </div>
        )}

        {/* Insufficient models banner (only when not loading and at top-level when nothing expanded) */}
        {tooFewModels && !registryLoading && (
          <div
            data-testid="lab-insufficient-models-banner"
            style={{
              padding: '14px 18px',
              background: tint('var(--color-warning)', 10),
              border: `1px solid ${tint('var(--color-warning)', 40)}`,
              borderRadius: '8px',
              color: 'var(--color-warning)',
              fontSize: '14px',
              marginBottom: '16px',
            }}
          >
            At least 2 enabled models are required for the Live Scoring Lab. Add more via Admin → LLM → Providers.
          </div>
        )}

        {/* Difficulty pills — click one to fire the real SmartModelRouter pipeline */}
        {!registryLoading && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
              {(['easy', 'medium', 'hard'] as const).map((d) => {
                const meta = DIFFICULTY_PROMPTS[d];
                const active = activeDifficulty === d;
                const accent =
                  d === 'easy' ? 'var(--color-success)'
                  : d === 'medium' ? 'var(--color-primary)'
                  : 'var(--color-warning)';
                return (
                  <button
                    key={d}
                    onClick={() => handlePickDifficulty(d)}
                    disabled={simulating}
                    data-testid={`lab-pill-${d}`}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '999px',
                      border: `1px solid ${active ? accent : 'var(--color-border)'}`,
                      background: active ? tint(accent, 16) : 'var(--color-surface-secondary)',
                      color: active ? accent : 'var(--color-text-primary)',
                      fontSize: '13px',
                      fontWeight: active ? 600 : 500,
                      cursor: simulating ? 'not-allowed' : 'pointer',
                      opacity: simulating && !active ? 0.5 : 1,
                      transition: 'all 120ms',
                      fontFamily: 'var(--font-body)',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {meta.label}
                  </button>
                );
              })}
              {activeDifficulty && (
                <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', alignSelf: 'center', marginLeft: '4px' }}>
                  {DIFFICULTY_PROMPTS[activeDifficulty].description}
                </span>
              )}
            </div>

            {activeDifficulty && (
              <div
                data-testid="lab-active-prompt-text"
                style={{
                  padding: '12px 14px',
                  background: 'var(--color-surface-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: 'var(--color-text-primary)',
                  lineHeight: 1.5,
                  marginBottom: '12px',
                  fontFamily: 'var(--font-body)',
                }}
              >
                &ldquo;{DIFFICULTY_PROMPTS[activeDifficulty].prompt}&rdquo;
              </div>
            )}
          </div>
        )}

        {/* Custom prompt input (always visible below pills) */}
        {!registryLoading && (
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)', margin: '0 0 12px' }}>
              Custom Prompt
            </h3>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={customPromptText}
                onChange={e => setCustomPromptText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSimulateCustomPrompt(); }}
                placeholder="e.g. compare our Azure vs AWS spend and explain the drivers"
                data-testid="lab-custom-prompt-input"
                style={{
                  flex: 1,
                  minWidth: '260px',
                  padding: '8px 12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  background: 'var(--color-surface-secondary)',
                  color: 'var(--color-text-primary)',
                  fontSize: '13px',
                  fontFamily: 'var(--font-body)',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => { setActiveDifficulty(null); handleSimulateCustomPrompt(); }}
                disabled={!customPromptText.trim() || simulating}
                data-testid="lab-custom-prompt-simulate-btn"
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: customPromptText.trim() && !simulating ? 'var(--color-primary)' : 'var(--color-surface-tertiary)',
                  color: customPromptText.trim() && !simulating ? 'var(--color-bg-primary)' : 'var(--color-text-secondary)',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: customPromptText.trim() && !simulating ? 'pointer' : 'not-allowed',
                  transition: 'all 120ms',
                  fontFamily: 'var(--font-body)',
                  whiteSpace: 'nowrap',
                }}
                title="Run the real SmartModelRouter against this prompt"
              >
                {simulating ? 'Simulating…' : 'Simulate →'}
              </button>
            </div>
          </div>
        )}

        {/* Unified simulation result pane — shared by pills AND custom prompt */}
        {!registryLoading && simError && (
          <div
            data-testid="lab-sim-error"
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: tint('var(--color-error)', 10),
              border: `1px solid ${tint('var(--color-error)', 40)}`,
              color: 'var(--color-error)',
              fontSize: '12px',
              margin: '16px 0',
            }}
          >
            Simulation failed: {simError}
          </div>
        )}
        {!registryLoading && simResult && (
          <div style={{ marginTop: '16px' }}>
            <LivePipelineResult result={simResult} />
          </div>
        )}
      </AdminCard>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Sticky footer                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div style={{
        position: 'sticky',
        bottom: 0,
        background: 'var(--color-surface-primary)',
        borderTop: '1px solid var(--color-border)',
        padding: '16px 0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 10,
      }}>
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          {dirtyCount > 0 ? (
            <span style={{ color: 'var(--color-warning)', fontWeight: 500 }}>
              ● {dirtyCount} {dirtyCount === 1 ? 'change' : 'changes'} pending
            </span>
          ) : (
            <span>No pending changes</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleReset}
            disabled={resetting || saving}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              cursor: resetting || saving ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              border: '1px solid var(--color-error)',
              background: 'transparent',
              color: 'var(--color-error)',
              fontSize: '14px',
              opacity: resetting || saving ? 0.5 : 1,
              transition: 'all 120ms',
              fontFamily: 'var(--font-body)',
            }}
          >
            {resetting ? 'Resetting…' : 'Reset to Defaults'}
          </button>
          <button
            onClick={handleDiscard}
            disabled={dirtyCount === 0 || saving || resetting}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              cursor: dirtyCount === 0 || saving || resetting ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface-tertiary)',
              color: 'var(--color-text-primary)',
              fontSize: '14px',
              opacity: dirtyCount === 0 ? 0.5 : 1,
              transition: 'all 120ms',
              fontFamily: 'var(--font-body)',
            }}
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={dirtyCount === 0 || saving || resetting}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              cursor: dirtyCount === 0 || saving || resetting ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              border: '1px solid transparent',
              background: dirtyCount === 0 ? 'var(--color-surface-tertiary)' : 'var(--color-primary)',
              color: dirtyCount === 0 ? 'var(--color-text-secondary)' : 'var(--color-bg)',
              fontSize: '14px',
              opacity: saving ? 0.7 : 1,
              transition: 'all 120ms',
              fontFamily: 'var(--font-body)',
            }}
          >
            {saving ? 'Saving…' : 'Save & Apply Live'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
};

export default RouterTuningView;
