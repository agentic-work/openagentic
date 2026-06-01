/**
 * DocsContent - Rich documentation content renderer
 *
 * Renders manifest data as user-friendly documentation with:
 * - Prose introductions per domain
 * - Interactive Mermaid diagrams for architecture/flow domains
 * - Smart type-specific item cards (agent, DLP rule, HTTP route, etc.)
 * - Table of contents with anchor links
 * - Search highlighting
 * - Collapsible sections for long item lists
 * - Swagger iframe for API reference
 * - "Ask about this" floating button
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import mermaid from 'mermaid';
import { sanitizeSVG } from '@/utils/sanitize';
import {
  useDocsStore,
  DocManifest,
  DocManifestSection,
  DocManifestItem,
} from '@/stores/useDocsStore';
import { DocsBookIcon, DocsChatIcon, getDocsIcon } from './DocsIcons';
import { OpenAgenticWordmark } from '@/shared/components/OpenAgenticWordmark';

// ============================================================================
// Mermaid Diagram Component
// ============================================================================

/**
 * MermaidDiagram - Renders a mermaid chart string as SVG.
 * Uses mermaid.render() with dark theme, sanitizes output via sanitizeSVG,
 * and handles errors gracefully by rendering nothing on failure.
 * Uses a unique ID per instance to avoid collisions.
 *
 * NOTE: innerHTML is set via sanitizeSVG() which strips dangerous elements --
 * this matches the pattern used in src/components/diagrams/MermaidDiagram.tsx.
 */
const MermaidDiagram: React.FC<{ chart: string; title?: string }> = ({ chart, title }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const idRef = useRef(`docs-mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    if (!containerRef.current || !chart.trim()) return;

    const render = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'strict',
          fontFamily: "Inter, system-ui, sans-serif",
          flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
          sequence: { useMaxWidth: true, actorMargin: 50 },
          // theme-allow: mermaid diagram palette (isolated SVG render context, cannot read parent CSS vars)
          themeVariables: {
            primaryColor: '#3b82f6',
            primaryTextColor: '#ffffff',
            primaryBorderColor: '#60a5fa',
            lineColor: '#94a3b8',
            secondaryColor: '#2563eb',
            tertiaryColor: '#1e40af',
            background: 'transparent',
            mainBkg: '#1e293b',
            secondBkg: '#334155',
            textColor: '#f1f5f9',
            border1: '#475569',
            border2: '#64748b',
            arrowheadColor: '#cbd5e1',
            fontSize: '14px',
            noteBkgColor: '#334155',
            noteTextColor: '#f1f5f9',
            nodeBorder: '#60a5fa',
            clusterBkg: '#1e293b40',
            clusterBorder: '#475569',
          },
        });

        // Generate a fresh ID each render to avoid collision
        const id = `${idRef.current}-${Date.now()}`;
        const container = containerRef.current;
        container.textContent = ''; // clear safely
        const { svg } = await mermaid.render(id, chart);
        // sanitizeSVG strips scripts, event handlers, and dangerous SVG elements
        const sanitized = sanitizeSVG(svg);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = sanitized; // eslint-disable-line -- sanitized via sanitizeSVG
        const svgEl = wrapper.querySelector('svg');
        if (svgEl) {
          svgEl.style.maxWidth = '100%';
          svgEl.style.height = 'auto';
          svgEl.style.display = 'block';
          svgEl.style.margin = '0 auto';
          container.appendChild(svgEl);
        }
        setError(false);
      } catch {
        setError(true);
      }
    };

    render();
  }, [chart]);

  if (error) return null;

  return (
    <div
      className="rounded-lg overflow-hidden mb-6"
      style={{
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      {title && (
        <div
          className="px-4 py-2.5 border-b flex items-center gap-2"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--user-accent-primary)' }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-textSecondary)' }}>
            {title}
          </span>
        </div>
      )}
      <div className="p-4" ref={containerRef} />
    </div>
  );
};

// ============================================================================
// Domain Diagrams
// ============================================================================

function getDomainDiagram(domain: string): { chart: string; title: string } | null {
  switch (domain) {
    case 'chat-pipeline':
      return {
        title: 'Pipeline Flow',
        chart: `graph LR
  A[Auth] --> B[Validation]
  B --> C[RAG]
  C --> D[Memory]
  D --> E[Prompt]
  E --> F[MCP Tools]
  F --> G[Agents]
  G --> H[Message Prep]
  H --> I[Completion]
  I --> J[Response]`,
      };
    case 'agent-types':
      return {
        title: 'Agent Routing Architecture',
        chart: `graph TD
  R[Request Classifier] --> T1[Tier 1: Fast]
  R --> T2[Tier 2: Standard]
  R --> T3[Tier 3: Complex]
  T1 --> DQ[data_query]
  T1 --> V[validation]
  T2 --> DE[data_extraction]
  T2 --> TO[tool_orchestration]
  T2 --> SU[summarization]
  T3 --> RE[reasoning]
  T3 --> CE[code_execution]
  T3 --> PL[planning]
  T3 --> SY[synthesis]
  T3 --> AC[artifact_creation]`,
      };
    case 'mcp-servers':
      return {
        title: 'Tool Selection Pipeline',
        chart: `graph TD
  Q[User Query] --> E[Embedding]
  E --> PG[pgvector Search]
  PG -->|"found"| R[Rank & Select]
  PG -->|"miss"| MV[Milvus Search]
  MV -->|"found"| R
  MV -->|"miss"| RD[Redis Cache]
  RD -->|"found"| R
  RD -->|"miss"| FB[Fallback: All Tools]
  FB --> R
  R --> TS[Tool Set for LLM]`,
      };
    case 'dlp-scanner':
      return {
        title: 'Scan Flow & Enforcement',
        chart: `graph TD
  A[Data Flow] --> B{Scan Point}
  B -->|tool_input| C[Before Tool Exec]
  B -->|tool_result| D[After Tool Exec]
  B -->|llm_output| E[Before User]
  B -->|user_input| F[User Message]
  B -->|workflow_data| W[Workflow Nodes]
  C --> G{Severity}
  D --> G
  E --> G
  F --> G
  W --> G
  G -->|low| H[Allow]
  G -->|medium| I[Redact]
  G -->|high| J[Block]
  G -->|critical| K[Block + Alert]`,
      };
    default:
      return null;
  }
}

// ============================================================================
// Domain Prose Introductions
// ============================================================================

function getDomainProse(domain: string, manifest: DocManifest | null): string | null {
  const totalItems = manifest?.sections?.reduce((n, s) => n + s.items.length, 0) ?? 0;

  switch (domain) {
    case 'chat-pipeline':
      return `Every message sent to OpenAgentic passes through a sequential processing pipeline before a response is generated. The pipeline is composed of independent stages -- each responsible for a specific concern such as authentication, retrieval-augmented generation, prompt engineering, or tool execution. Stages can be toggled on or off through configuration flags, and the entire flow is designed for observability and extensibility. This manifest documents all ${totalItems} pipeline components extracted from the codebase.`;

    case 'agent-types':
      return `OpenAgentic uses a multi-agent architecture where incoming tasks are classified and routed to specialised agent types. Each agent type has its own model configuration -- including temperature, token limits, thinking budgets, and cost caps -- tuned for the kind of work it performs. Fast, deterministic tasks like data queries are routed to lightweight configurations, while complex reasoning or planning tasks get higher budgets and thinking enabled. This page covers all ${totalItems} registered agent-related items.`;

    case 'mcp-servers':
      return `Model Context Protocol (MCP) servers are the bridge between the AI layer and external systems. OpenAgentic connects to ${manifest?.sections?.[0]?.items?.length ?? 23} MCP servers that expose ${totalItems} tools spanning cloud providers (AWS, Azure, GCP), observability (Prometheus, Loki, Alertmanager), code execution, knowledge retrieval, and platform administration. Tools are dynamically selected per request using vector-similarity search with a pgvector-to-Milvus-to-Redis fallback chain.`;

    case 'dlp-scanner':
      return `The Data Loss Prevention (DLP) scanner is a security layer that inspects all data flowing through the platform -- tool inputs, tool results, LLM outputs, user messages, and workflow node data. It applies ${totalItems} detection rules across five categories (credentials, PII, infrastructure secrets, compliance data, and prompt injection attempts). Each rule carries a severity level that maps to an enforcement action: low-severity matches are flagged and allowed through, medium matches trigger automatic redaction, and high or critical matches block the request entirely.`;

    case 'api-routes':
      return `This reference documents every HTTP endpoint exposed by the OpenAgentic API server. Routes are grouped by their source file and cover authentication, chat, admin management, MCP proxying, workflows, and more. Each entry shows the HTTP method, path, and originating source file. For interactive exploration, the Swagger UI is also available at the bottom of this page.`;

    default:
      return manifest?.description || null;
  }
}

// ============================================================================
// Search Highlighting
// ============================================================================

const HighlightText: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  if (!query || query.length < 2) return <>{text}</>;

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            style={{
              backgroundColor: 'color-mix(in srgb, var(--user-accent-primary) 25%, transparent)',
              color: 'var(--color-text)',
              borderRadius: '2px',
              padding: '0 2px',
            }}
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
};

// ============================================================================
// Badge Components
// ============================================================================

const SeverityBadge: React.FC<{ severity: string }> = ({ severity }) => {
  // Severity maps onto the semantic status tokens; soft bg/border derived via color-mix.
  const tone: Record<string, string> = {
    low: 'var(--color-success)',
    medium: 'var(--color-warning)',
    high: 'var(--color-warning)',
    critical: 'var(--color-error)',
  };
  const fg = tone[severity] || tone.medium;
  const c = {
    bg: `color-mix(in srgb, ${fg} 9%, transparent)`,
    fg,
    border: `color-mix(in srgb, ${fg} 30%, transparent)`,
  };
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={{ backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
    >
      {severity}
    </span>
  );
};

const CategoryBadge: React.FC<{ category: string }> = ({ category }) => (
  <span
    className="text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider"
    style={{
      backgroundColor: 'var(--color-surfaceSecondary)',
      color: 'var(--color-textMuted)',
      border: '1px solid var(--color-border)',
    }}
  >
    {category}
  </span>
);

const MethodBadge: React.FC<{ method: string }> = ({ method }) => {
  // HTTP verbs map onto semantic status/accent tokens (GET=ok, DELETE=error, …).
  const tone: Record<string, string> = {
    GET: 'var(--color-success)',
    POST: 'var(--color-accent)',
    PUT: 'var(--color-warning)',
    PATCH: 'var(--color-warning)',
    DELETE: 'var(--color-error)',
  };
  const fg = tone[method.toUpperCase()] || 'var(--color-textMuted)';
  const c = { bg: `color-mix(in srgb, ${fg} 12%, transparent)`, fg };
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider font-mono"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {method.toUpperCase()}
    </span>
  );
};

const DocsTierLabel: React.FC<{ config: Record<string, unknown> }> = ({ config }) => {
  const temp = Number(config.temperature ?? 0);
  const thinking = Boolean(config.thinkingEnabled);
  const maxTok = Number(config.maxTokens ?? 0);

  let tier = 'Fast';
  let color = 'var(--color-success)';
  if (thinking && maxTok >= 8192) {
    tier = 'Complex';
    color = 'var(--color-accent)';
  } else if (maxTok >= 4096 || temp > 0) {
    tier = 'Standard';
    color = 'var(--color-info)';
  }

  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 9%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)` }}
    >
      {tier}
    </span>
  );
};

const OptionalBadge: React.FC<{ optional: boolean }> = ({ optional }) => (
  <span
    className="text-[10px] font-medium px-1.5 py-0.5 rounded"
    style={{
      backgroundColor: optional ? 'color-mix(in srgb, var(--color-warning) 9%, transparent)' : 'color-mix(in srgb, var(--color-info) 9%, transparent)',
      color: optional ? 'var(--color-warning)' : 'var(--color-info)',
    }}
  >
    {optional ? 'optional' : 'required'}
  </span>
);

// ============================================================================
// Chevron SVG (inline, no Lucide)
// ============================================================================

const ChevronDown: React.FC<{ open: boolean; size?: number }> = ({ open, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    style={{
      color: 'var(--color-textMuted)',
      transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
      transition: 'transform 0.2s ease',
      flexShrink: 0,
    }}
  >
    <polyline points="6 9 12 15 18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ============================================================================
// Type-Specific Item Card Renderers
// ============================================================================

const AgentTypeCard: React.FC<{ item: DocManifestItem; query: string }> = ({ item, query }) => (
  <div
    className="rounded-lg p-4 flex items-start gap-4"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
  >
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          <HighlightText text={item.name} query={query} />
        </span>
        {item.properties && <DocsTierLabel config={item.properties} />}
      </div>
      {item.description && (
        <p className="text-xs mb-2" style={{ color: 'var(--color-textSecondary)' }}>
          <HighlightText text={item.description} query={query} />
        </p>
      )}
      {item.properties && (
        <div className="flex gap-3 flex-wrap text-[11px]" style={{ color: 'var(--color-textMuted)' }}>
          {item.properties.temperature !== undefined && (
            <span>temp: <strong style={{ color: 'var(--color-textSecondary)' }}>{String(item.properties.temperature)}</strong></span>
          )}
          {item.properties.maxTokens !== undefined && (
            <span>tokens: <strong style={{ color: 'var(--color-textSecondary)' }}>{String(item.properties.maxTokens)}</strong></span>
          )}
          {item.properties.thinkingEnabled !== undefined && (
            <span>thinking: <strong style={{ color: item.properties.thinkingEnabled ? 'var(--color-success)' : 'var(--color-textMuted)' }}>{item.properties.thinkingEnabled ? 'on' : 'off'}</strong></span>
          )}
          {item.properties.costBudgetPerCall !== undefined && (
            <span>budget: <strong style={{ color: 'var(--color-textSecondary)' }}>{String(item.properties.costBudgetPerCall)}c</strong></span>
          )}
          {item.properties.timeoutMs !== undefined && (
            <span>timeout: <strong style={{ color: 'var(--color-textSecondary)' }}>{Number(item.properties.timeoutMs) / 1000}s</strong></span>
          )}
        </div>
      )}
    </div>
  </div>
);

const DLPRuleCard: React.FC<{ item: DocManifestItem; query: string }> = ({ item, query }) => (
  <div
    className="rounded-lg px-4 py-3 flex items-center gap-3"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
  >
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          <HighlightText text={item.name} query={query} />
        </span>
        {item.properties?.category && <CategoryBadge category={String(item.properties.category)} />}
        {item.properties?.severity && <SeverityBadge severity={String(item.properties.severity)} />}
      </div>
      {item.description && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>
          <HighlightText text={item.description} query={query} />
        </p>
      )}
    </div>
  </div>
);

const HttpRouteCard: React.FC<{ item: DocManifestItem; query: string }> = ({ item, query }) => {
  const method = item.properties?.method ? String(item.properties.method) : 'GET';
  const path = item.properties?.path ? String(item.properties.path) : item.name;
  const sourceFile = item.properties?.sourceFile ? String(item.properties.sourceFile) : undefined;

  return (
    <div
      className="rounded-lg px-4 py-2.5 flex items-center gap-3"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <MethodBadge method={method} />
      <span className="text-sm font-mono truncate" style={{ color: 'var(--color-text)' }}>
        <HighlightText text={path} query={query} />
      </span>
      {sourceFile && (
        <span className="text-[10px] ml-auto flex-shrink-0 truncate max-w-[200px]" style={{ color: 'var(--color-textMuted)' }}>
          {sourceFile.split('/').pop()}
        </span>
      )}
    </div>
  );
};

const ModelConfigCard: React.FC<{ item: DocManifestItem; query: string }> = ({ item, query }) => {
  const props = item.properties || {};
  const entries = Object.entries(props);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <div className="px-4 py-2.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          <HighlightText text={item.name} query={query} />
        </span>
        {item.description && (
          <span className="text-xs ml-2" style={{ color: 'var(--color-textMuted)' }}>
            {item.description}
          </span>
        )}
      </div>
      <div className="px-4 py-2">
        <table className="w-full text-xs">
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key}>
                <td className="py-1 pr-4 font-medium" style={{ color: 'var(--color-textSecondary)', width: '40%' }}>
                  {key}
                </td>
                <td className="py-1 font-mono" style={{ color: 'var(--color-textMuted)' }}>
                  {typeof value === 'boolean' ? (
                    <span style={{ color: value ? 'var(--color-success)' : 'var(--color-textMuted)' }}>{String(value)}</span>
                  ) : (
                    String(value)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const InterfaceFieldCard: React.FC<{ item: DocManifestItem; query: string }> = ({ item, query }) => {
  const fieldType = item.properties?.type ? String(item.properties.type) : 'unknown';
  const isOptional = Boolean(item.properties?.optional);

  return (
    <div
      className="rounded-lg px-4 py-2.5 flex items-center gap-3"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <span className="text-sm font-mono font-medium" style={{ color: 'var(--color-text)' }}>
        <HighlightText text={item.name} query={query} />
      </span>
      <span className="text-xs font-mono" style={{ color: 'var(--color-accent)' }}>{fieldType}</span>
      <OptionalBadge optional={isOptional} />
      {item.description && item.description !== `${fieldType} field` && (
        <span className="text-xs ml-auto" style={{ color: 'var(--color-textMuted)' }}>
          <HighlightText text={item.description} query={query} />
        </span>
      )}
    </div>
  );
};

const FlowStepCard: React.FC<{ item: DocManifestItem; query: string; index: number }> = ({ item, query, index }) => (
  <div className="flex gap-3 items-start">
    <div className="flex flex-col items-center flex-shrink-0">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
        style={{ backgroundColor: 'color-mix(in srgb, var(--user-accent-primary) 12%, transparent)', color: 'var(--user-accent-primary)', border: '1px solid color-mix(in srgb, var(--user-accent-primary) 18%, transparent)' }}
      >
        {index + 1}
      </div>
      <div className="w-px flex-1 min-h-[16px]" style={{ backgroundColor: 'var(--color-border)' }} />
    </div>
    <div
      className="rounded-lg px-4 py-3 flex-1 mb-2"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
        <HighlightText text={item.name} query={query} />
      </span>
      {item.description && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>
          <HighlightText text={item.description} query={query} />
        </p>
      )}
      {item.properties?.className && (
        <span className="text-[10px] font-mono mt-1 inline-block" style={{ color: 'var(--color-textMuted)' }}>
          {String(item.properties.className)}
        </span>
      )}
    </div>
  </div>
);

const McpServerCard: React.FC<{ item: DocManifestItem; query: string }> = ({ item, query }) => (
  <div
    className="rounded-lg px-4 py-3 flex items-center gap-3"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--color-warning)', flexShrink: 0 }}>
      <rect x="2" y="3" width="20" height="6" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="2" y="15" width="20" height="6" rx="2" stroke="currentColor" strokeWidth="2" />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="6" cy="18" r="1" fill="currentColor" />
    </svg>
    <div className="flex-1 min-w-0">
      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        <HighlightText text={item.name} query={query} />
      </span>
      {item.description && (
        <span className="text-xs ml-2" style={{ color: 'var(--color-textMuted)' }}>
          <HighlightText text={item.description} query={query} />
        </span>
      )}
    </div>
    {item.properties?.toolCount && (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 9%, transparent)', color: 'var(--color-warning)' }}>
        {String(item.properties.toolCount)} tools
      </span>
    )}
  </div>
);

const McpToolCard: React.FC<{ item: DocManifestItem; query: string }> = ({ item, query }) => {
  const [expanded, setExpanded] = useState(false);
  const params = item.properties?.parameters;
  const hasParams = params && typeof params === 'object' && Object.keys(params as object).length > 0;

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <button
        onClick={() => hasParams && setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        style={{ cursor: hasParams ? 'pointer' : 'default' }}
      >
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', color: 'var(--color-warning)', border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)' }}
        >
          tool
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            <HighlightText text={item.name} query={query} />
          </span>
          {item.description && (
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-textMuted)' }}>
              <HighlightText text={item.description} query={query} />
            </p>
          )}
        </div>
        {hasParams && <ChevronDown open={expanded} />}
      </button>
      <AnimatePresence>
        {expanded && hasParams && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="border-t px-4 py-3"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surfaceSecondary)' }}
          >
            <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--color-textSecondary)' }}>Parameters</div>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(params as Record<string, unknown>).map(([key, val]) => (
                <div key={key} className="text-xs">
                  <span className="font-mono font-medium" style={{ color: 'var(--color-textSecondary)' }}>{key}</span>
                  <span style={{ color: 'var(--color-textMuted)' }}> {typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const DefaultCard: React.FC<{ item: DocManifestItem; query: string }> = ({ item, query }) => (
  <div
    className="rounded-lg px-4 py-3 flex items-start gap-3"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
  >
    <span
      className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 uppercase tracking-wide"
      style={{
        backgroundColor: 'var(--color-surfaceSecondary)',
        color: 'var(--color-textMuted)',
        border: '1px solid var(--color-border)',
      }}
    >
      {item.type}
    </span>
    <div className="flex-1 min-w-0">
      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
        <HighlightText text={item.name} query={query} />
      </span>
      {item.description && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>
          <HighlightText text={item.description} query={query} />
        </p>
      )}
    </div>
    {item.tags && item.tags.length > 0 && (
      <div className="flex gap-1 flex-shrink-0">
        {item.tags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-textMuted)' }}
          >
            {tag}
          </span>
        ))}
      </div>
    )}
  </div>
);

// ============================================================================
// Item Renderer (dispatch by type)
// ============================================================================

const renderItem = (item: DocManifestItem, query: string, index: number) => {
  switch (item.type) {
    case 'agent-type':
      return <AgentTypeCard key={item.id} item={item} query={query} />;
    case 'model-config':
      return <ModelConfigCard key={item.id} item={item} query={query} />;
    case 'dlp-rule':
    case 'severity-mapping':
      return <DLPRuleCard key={item.id} item={item} query={query} />;
    case 'http-route':
      return <HttpRouteCard key={item.id} item={item} query={query} />;
    case 'interface-field':
    case 'metric-field':
      return <InterfaceFieldCard key={item.id} item={item} query={query} />;
    case 'pipeline-stage':
    case 'stage-order':
    case 'flow-step':
      return <FlowStepCard key={item.id} item={item} query={query} index={index} />;
    case 'mcp-server':
      return <McpServerCard key={item.id} item={item} query={query} />;
    case 'mcp-tool':
      return <McpToolCard key={item.id} item={item} query={query} />;
    default:
      return <DefaultCard key={item.id} item={item} query={query} />;
  }
};

// ============================================================================
// Section Component (with collapsible support)
// ============================================================================

const COLLAPSE_THRESHOLD = 10;

const SectionBlock: React.FC<{ section: DocManifestSection; query: string }> = ({ section, query }) => {
  const [expanded, setExpanded] = useState(section.items.length <= COLLAPSE_THRESHOLD);
  const needsCollapse = section.items.length > COLLAPSE_THRESHOLD;
  const displayItems = expanded ? section.items : section.items.slice(0, COLLAPSE_THRESHOLD);

  return (
    <div id={`section-${section.id}`} className="mb-10">
      <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
        <HighlightText text={section.title} query={query} />
      </h3>
      {section.description && (
        <p className="text-sm mb-4" style={{ color: 'var(--color-textSecondary)' }}>
          <HighlightText text={section.description} query={query} />
        </p>
      )}
      <div className="space-y-2">
        {displayItems.map((item, i) => renderItem(item, query, i))}
      </div>

      {needsCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 flex items-center gap-1.5 text-xs font-medium transition-colors"
          style={{ color: 'var(--color-textSecondary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-textSecondary)'; }}
        >
          <ChevronDown open={expanded} size={14} />
          {expanded ? 'Show fewer' : `Show all ${section.items.length} items`}
        </button>
      )}
    </div>
  );
};

// ============================================================================
// Table of Contents
// ============================================================================

const TableOfContents: React.FC<{ sections: DocManifestSection[]; showSwagger?: boolean }> = ({ sections, showSwagger }) => {
  const handleClick = useCallback((sectionId: string) => {
    const el = document.getElementById(`section-${sectionId}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (sections.length <= 1 && !showSwagger) return null;

  return (
    <nav
      className="rounded-lg px-4 py-3 mb-6"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-textMuted)' }}>
        On this page
      </div>
      <ul className="space-y-1">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => handleClick(s.id)}
              className="text-xs w-full text-left py-0.5 transition-colors"
              style={{ color: 'var(--color-textSecondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-textSecondary)'; }}
            >
              {s.title}
              <span className="ml-1.5" style={{ color: 'var(--color-textMuted)' }}>({s.items.length})</span>
            </button>
          </li>
        ))}
        {showSwagger && (
          <li>
            <button
              onClick={() => handleClick('swagger-api')}
              className="text-xs w-full text-left py-0.5 transition-colors"
              style={{ color: 'var(--color-textSecondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-textSecondary)'; }}
            >
              API Reference (Swagger)
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
};

// ============================================================================
// Swagger Section
// ============================================================================

const SwaggerSection: React.FC = () => (
  <div id="section-swagger-api" className="mb-10">
    <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
      API Reference (Swagger)
    </h3>
    <p className="text-sm mb-4" style={{ color: 'var(--color-textSecondary)' }}>
      Interactive OpenAPI explorer. You can try out requests directly from this embedded view.
    </p>
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--color-border)', height: '700px' }}
    >
      <iframe
        src="/api/swagger"
        title="Swagger API Reference"
        className="w-full h-full border-0"
        style={{ backgroundColor: 'var(--color-bg)' }}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
      />
    </div>
  </div>
);

// ============================================================================
// Main Content Component
// ============================================================================

export const DocsContent: React.FC = () => {
  const { currentDomain, currentSectionId, index, loadedManifests, loadManifest, toggleChat, searchQuery } = useDocsStore();
  const [manifest, setManifest] = useState<DocManifest | null>(null);
  const [loadingManifest, setLoadingManifest] = useState(false);

  // Load manifest when domain changes
  useEffect(() => {
    if (!currentDomain) {
      setManifest(null);
      return;
    }

    const cached = loadedManifests.get(currentDomain);
    if (cached) {
      setManifest(cached);
      return;
    }

    setLoadingManifest(true);
    loadManifest(currentDomain).then((m) => {
      setManifest(m);
      setLoadingManifest(false);
    });
  }, [currentDomain, loadedManifests, loadManifest]);

  // Scroll to section when sectionId changes
  useEffect(() => {
    if (currentSectionId) {
      const el = document.getElementById(`section-${currentSectionId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [currentSectionId]);

  const domainInfo = index?.domains.find((d) => d.domain === currentDomain);

  const diagram = useMemo(
    () => (currentDomain ? getDomainDiagram(currentDomain) : null),
    [currentDomain],
  );

  const prose = useMemo(
    () => (currentDomain ? getDomainProse(currentDomain, manifest) : null),
    [currentDomain, manifest],
  );

  const showSwagger = currentDomain === 'api-routes';

  // No domain selected -- landing page (atlas hero + animated wordmark inside the card)
  if (!currentDomain) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--color-background)' }}>
        <div
          className="rounded-xl overflow-hidden"
          style={{
            width: 'min(640px, 90%)',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            // Layered shadows + faint perspective tilt = subtle 3-D feel without parallax JS.
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.04) inset, 0 30px 60px -20px rgba(0,0,0,0.55), 0 12px 24px -10px rgba(0,0,0,0.35)',
            transform: 'perspective(1200px) rotateX(0.6deg)',
            transformStyle: 'preserve-3d',
          }}
        >
          {/* Cropped atlas hero — fixed-height crop, parallax shadow under it */}
          <div
            style={{
              position: 'relative',
              height: 200,
              backgroundImage:
                'linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%), url("/atlas.png")',
              backgroundSize: 'cover',
              backgroundPosition: 'center 30%',
              backgroundRepeat: 'no-repeat',
              borderBottom: '1px solid var(--color-border)',
              boxShadow: 'inset 0 -16px 24px -16px rgba(0,0,0,0.45)',
            }}
          >
            {/* Wordmark + Documentation title inside the hero, on the dark gradient base */}
            <div
              style={{
                position: 'absolute',
                left: 24,
                bottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                textShadow: '0 1px 4px rgba(0,0,0,0.6)',
              }}
            >
              <OpenAgenticWordmark size={22} animate />
              <span
                style={{
                  // theme-allow: light label sits over the fixed photographic atlas.png hero (not a themed surface)
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                }}
              >
                Documentation
              </span>
            </div>
            {/* Version pill, top-right of the hero */}
            <span
              className="font-mono"
              style={{
                position: 'absolute',
                top: 14,
                right: 14,
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 999,
                // theme-allow: version pill sits over the fixed photographic atlas.png hero (not a themed surface)
                backgroundColor: 'rgba(0,0,0,0.55)',
                color: '#ffffff',
                border: '1px solid rgba(255,255,255,0.18)',
                whiteSpace: 'nowrap',
              }}
            >
              v{import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_VERSION || '0.0.0'}
              {import.meta.env.VITE_CODENAME ? ` · ${import.meta.env.VITE_CODENAME}` : ''}
            </span>
          </div>
          {/* Body of the landing card */}
          <div className="px-6 py-5 text-center">
            <p className="text-sm" style={{ color: 'var(--color-textMuted)' }}>
              Select a topic from the sidebar to view documentation.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (loadingManifest) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--color-background)' }}>
        <div className="flex items-center gap-3">
          <div
            className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"
            style={{ color: 'var(--color-textMuted)' }}
          />
          <span className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>Loading documentation...</span>
        </div>
      </div>
    );
  }

  const DomainIcon = getDocsIcon(domainInfo?.icon || manifest?.icon || 'book');

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Breadcrumb bar */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-textSecondary)' }}>
          <span>{
            { core: 'Core Platform', agents: 'Agents', tools: 'MCP & Tools', workflows: 'Workflows', security: 'Security', infrastructure: 'Infrastructure', ui: 'UI & Modes' }[domainInfo?.category || manifest?.category || ''] || domainInfo?.category || manifest?.category || 'Docs'
          }</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <polyline points="9 18 15 12 9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>
            {manifest?.title || domainInfo?.title || currentDomain}
          </span>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto relative">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {/* Domain header */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-6"
          >
            <div className="flex items-center gap-3 mb-2">
              <DomainIcon size={24} />
              <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
                {manifest?.title || domainInfo?.title || currentDomain}
              </h1>
            </div>

            {/* Prose introduction */}
            {prose && (
              <p className="text-sm leading-relaxed ml-9" style={{ color: 'var(--color-textSecondary)' }}>
                {prose}
              </p>
            )}
          </motion.div>

          {/* Mermaid diagram */}
          {diagram && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.05 }}
            >
              <MermaidDiagram chart={diagram.chart} title={diagram.title} />
            </motion.div>
          )}

          {/* Table of contents */}
          {manifest?.sections && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: 0.1 }}
            >
              <TableOfContents sections={manifest.sections} showSwagger={showSwagger} />
            </motion.div>
          )}

          {/* Sections */}
          {manifest?.sections?.map((section, i) => (
            <motion.div
              key={section.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.1 + i * 0.03 }}
            >
              <SectionBlock section={section} query={searchQuery} />
            </motion.div>
          ))}

          {/* Swagger section for api-routes domain */}
          {showSwagger && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.2 }}
            >
              <SwaggerSection />
            </motion.div>
          )}

          {/* Swagger-only page for the synthetic swagger-api domain */}
          {currentDomain === 'swagger-api' && (
            <div className="mb-10">
              <p className="text-sm mb-6" style={{ color: 'var(--color-textSecondary)', lineHeight: 1.7 }}>
                Interactive OpenAPI documentation for every HTTP endpoint in the OpenAgentic API.
                You can explore endpoints, view request/response schemas, and test API calls directly from this page.
              </p>
              <div
                className="rounded-lg overflow-hidden border"
                style={{ borderColor: 'var(--color-border)', height: 'calc(100vh - 280px)' }}
              >
                <iframe
                  src="/api/swagger"
                  title="Swagger API Reference"
                  className="w-full h-full"
                  style={{ border: 'none', backgroundColor: 'white' }}
                />
              </div>
            </div>
          )}

          {/* Empty state */}
          {!manifest && !loadingManifest && currentDomain !== 'swagger-api' && (
            <div className="text-center py-12">
              <p className="text-sm" style={{ color: 'var(--color-textMuted)' }}>
                No detailed documentation available for this domain yet.
              </p>
            </div>
          )}
        </div>

        {/* "Ask about this" button removed — single "Ask AI" in header is sufficient */}
      </div>
    </div>
  );
};
