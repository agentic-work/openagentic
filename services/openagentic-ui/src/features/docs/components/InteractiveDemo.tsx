import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ============================================================================
// PIPELINE VISUALIZER
// ============================================================================

const pipelineStages = [
  {
    name: 'Auth',
    brief: 'Token validation',
    detail: 'Every request is validated against the session token or API key. SSO tokens from Microsoft Entra ID, Google Workspace, or OIDC providers are verified. Invalid tokens receive a 401 before any processing begins.',
  },
  {
    name: 'Validation',
    brief: 'Input + rate limits',
    detail: 'Input is sanitized and validated. Per-user and per-organization rate limits are enforced using a sliding-window algorithm backed by Redis. DLP scanning also runs within this stage to detect sensitive data.',
  },
  {
    name: 'RAG',
    brief: 'Vector search',
    detail: 'The user query is embedded using the configured embedding model and searched against pgvector (primary) and Milvus (GPU-accelerated fallback). Relevant document chunks are injected into the prompt context.',
  },
  {
    name: 'Memory',
    brief: 'Context window',
    detail: 'Conversation history is loaded from Redis and trimmed to fit the model context window. A sliding-window strategy preserves the most recent turns while keeping the system prompt and RAG context intact.',
  },
  {
    name: 'Prompt',
    brief: 'System + user',
    detail: 'The system prompt, RAG context, memory, user message, and any tool definitions are assembled into the final prompt payload. Token counting ensures the assembled prompt fits within model limits.',
  },
  {
    name: 'MCP',
    brief: 'Tool matching',
    detail: 'The query is matched against available MCP tool descriptions using vector similarity. The top-k tools are attached to the prompt as function definitions, enabling the model to invoke them during generation.',
  },
  {
    name: 'Agents',
    brief: 'Delegation',
    detail: 'If the orchestrator determines that a specialist agent would handle the request better, it delegates to one or more sub-agents. Each agent has its own system prompt and tool set.',
  },
  {
    name: 'MessagePrep',
    brief: 'Dedup + validate',
    detail: 'Messages are deduplicated and validated before being sent to the LLM. This stage ensures the final message array is clean, well-formed, and within token limits.',
  },
  {
    name: 'Completion',
    brief: 'Streaming LLM',
    detail: 'The assembled prompt is sent to the selected LLM provider. SmartModelRouter picks the model from capability scoring and per-user per-model budget caps. Responses stream via SSE.',
  },
  {
    name: 'Response',
    brief: 'SSE stream',
    detail: 'The generated response streams back to the client in real-time via Server-Sent Events. Token usage is logged for cost tracking, the conversation memory is updated, and audit records are written.',
  },
];

export const PipelineVisualizer: React.FC = () => {
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startAnimation = useCallback(() => {
    setActiveIndex(-1);
    setIsPlaying(true);
    let step = 0;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (step < pipelineStages.length) {
        setActiveIndex(step);
        step++;
      } else {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setIsPlaying(false);
      }
    }, 400);
  }, []);

  useEffect(() => {
    startAnimation();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startAnimation]);

  const handleReplay = useCallback(() => {
    setSelectedIndex(null);
    startAnimation();
  }, [startAnimation]);

  const handleStageClick = useCallback((index: number) => {
    setSelectedIndex((prev) => (prev === index ? null : index));
  }, []);

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '14px',
        padding: '28px 24px',
      }}
    >
      {/* Stage boxes */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          alignItems: 'center',
          overflowX: 'auto',
          paddingBottom: '8px',
        }}
      >
        {pipelineStages.map((stage, i) => {
          const isActive = i <= activeIndex;
          const isCurrent = i === activeIndex && isPlaying;
          const isSelected = i === selectedIndex;

          return (
            <React.Fragment key={stage.name}>
              {i > 0 && (
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: isActive ? 1 : 0 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    width: '16px',
                    height: '2px',
                    background: isActive
                      ? 'var(--color-primary)'
                      : 'var(--color-border)',
                    flexShrink: 0,
                    transformOrigin: 'left',
                  }}
                />
              )}
              <motion.button
                onClick={() => handleStageClick(i)}
                animate={{
                  background: isActive
                    ? 'var(--color-primary)'
                    : 'var(--color-surfaceSecondary)',
                  scale: isCurrent ? 1.08 : 1,
                }}
                transition={{ duration: 0.25 }}
                style={{
                  flexShrink: 0,
                  border: isSelected
                    ? '2px solid var(--color-primary)'
                    : '1px solid var(--color-border)',
                  borderRadius: '10px',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  minWidth: '72px',
                  textAlign: 'center',
                  outline: 'none',
                }}
              >
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: isActive
                      ? 'var(--color-textOnPrimary, #fff)'
                      : 'var(--color-text)',
                    lineHeight: 1.3,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {stage.name}
                </div>
                <div
                  style={{
                    fontSize: '9px',
                    color: isActive
                      ? 'rgba(255,255,255,0.7)'
                      : 'var(--color-textMuted)',
                    marginTop: '2px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {stage.brief}
                </div>
              </motion.button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Replay button */}
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={handleReplay}
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--color-primary)',
            background: 'transparent',
            border: '1px solid var(--color-primary)',
            borderRadius: '6px',
            padding: '6px 16px',
            cursor: 'pointer',
            opacity: isPlaying ? 0.5 : 1,
          }}
          disabled={isPlaying}
        >
          Replay
        </button>
      </div>

      {/* Info panel */}
      <AnimatePresence mode="wait">
        {selectedIndex !== null && (
          <motion.div
            key={selectedIndex}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                marginTop: '20px',
                padding: '20px',
                background: 'var(--color-surfaceSecondary)',
                borderRadius: '10px',
                border: '1px solid var(--color-border)',
              }}
            >
              <h4
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}
              >
                Stage {selectedIndex + 1}: {pipelineStages[selectedIndex].name}
              </h4>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--color-textSecondary)',
                  lineHeight: 1.65,
                }}
              >
                {pipelineStages[selectedIndex].detail}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// ============================================================================
// SLIDER DEMO — deleted 2026-04-19 (task #144, slider rip).
// Model selection goes through SmartModelRouter; per-user x per-model
// budget caps live in UserModelBudgetService.
// ============================================================================
// ============================================================================
// AGENT TYPE EXPLORER
// ============================================================================

interface AgentTypeConfig {
  name: string;
  description: string;
  temperature: number;
  maxTokens: number;
  thinkingEnabled: boolean;
  thinkingBudget?: number;
  costBudgetPerCall: string;
  timeoutMs: string;
  tier?: string;
}

const agentTypes: AgentTypeConfig[] = [
  {
    name: 'data_query',
    description: 'Executes precise dataset queries with zero hallucination tolerance.',
    temperature: 0,
    maxTokens: 2048,
    thinkingEnabled: false,
    costBudgetPerCall: '5c',
    timeoutMs: '10s',
  },
  {
    name: 'data_extraction',
    description: 'Extracts structured data from unstructured text, documents, and APIs.',
    temperature: 0,
    maxTokens: 4096,
    thinkingEnabled: false,
    costBudgetPerCall: '20c',
    timeoutMs: '30s',
  },
  {
    name: 'tool_orchestration',
    description: 'Selects and invokes MCP tools, chaining multi-step tool calls.',
    temperature: 0.1,
    maxTokens: 4096,
    thinkingEnabled: true,
    thinkingBudget: 4096,
    costBudgetPerCall: '50c',
    timeoutMs: '60s',
  },
  {
    name: 'reasoning',
    description: 'Multi-step logical reasoning, analysis, and problem decomposition.',
    temperature: 0.3,
    maxTokens: 8192,
    thinkingEnabled: true,
    thinkingBudget: 16384,
    costBudgetPerCall: '100c',
    timeoutMs: '120s',
  },
  {
    name: 'summarization',
    description: 'Condenses long content into concise, accurate summaries.',
    temperature: 0,
    maxTokens: 4096,
    thinkingEnabled: false,
    costBudgetPerCall: '10c',
    timeoutMs: '30s',
  },
  {
    name: 'code_execution',
    description: 'Generates, reviews, and executes code in sandboxed environments.',
    temperature: 0.1,
    maxTokens: 4096,
    thinkingEnabled: true,
    thinkingBudget: 4096,
    costBudgetPerCall: '50c',
    timeoutMs: '60s',
  },
  {
    name: 'planning',
    description: 'Creates structured plans, breaking complex goals into actionable steps.',
    temperature: 0.3,
    maxTokens: 4096,
    thinkingEnabled: true,
    thinkingBudget: 8192,
    costBudgetPerCall: '50c',
    timeoutMs: '60s',
  },
  {
    name: 'validation',
    description: 'Validates data, outputs, and intermediate results for correctness.',
    temperature: 0,
    maxTokens: 2048,
    thinkingEnabled: false,
    costBudgetPerCall: '5c',
    timeoutMs: '10s',
  },
  {
    name: 'synthesis',
    description: 'Combines information from multiple sources into coherent output.',
    temperature: 0.3,
    maxTokens: 4096,
    thinkingEnabled: true,
    thinkingBudget: 8192,
    costBudgetPerCall: '50c',
    timeoutMs: '60s',
  },
  {
    name: 'artifact_creation',
    description: 'Generates interactive HTML artifacts, dashboards, and visualizations.',
    temperature: 0.3,
    maxTokens: 8192,
    thinkingEnabled: true,
    thinkingBudget: 8192,
    costBudgetPerCall: '100c',
    timeoutMs: '120s',
    tier: 'premium',
  },
  {
    name: 'custom',
    description: 'User-configurable agent type with adjustable parameters.',
    temperature: 0.2,
    maxTokens: 4096,
    thinkingEnabled: false,
    costBudgetPerCall: '20c',
    timeoutMs: '30s',
    tier: 'balanced',
  },
];

export const AgentTypeExplorer: React.FC = () => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const handleToggle = useCallback((index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }, []);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '12px',
      }}
    >
      {agentTypes.map((agent, i) => {
        const isExpanded = expandedIndex === i;

        return (
          <motion.div
            key={agent.name}
            layout
            onClick={() => handleToggle(i)}
            style={{
              background: 'var(--color-surface)',
              border: isExpanded
                ? '1px solid var(--color-primary)'
                : '1px solid var(--color-border)',
              borderRadius: '12px',
              padding: '20px',
              cursor: 'pointer',
              transition: 'border-color 0.2s ease',
            }}
            whileHover={{
              borderColor: 'var(--color-primary)',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '8px',
              }}
            >
              <code
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  fontFamily: 'var(--font-mono, monospace)',
                }}
              >
                {agent.name}
              </code>
              {agent.tier && (
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    color:
                      agent.tier === 'premium'
                        ? '#3b82f6'
                        : '#eab308',
                    background:
                      agent.tier === 'premium'
                        ? 'rgba(59,130,246,0.12)'
                        : 'rgba(234,179,8,0.12)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {agent.tier}
                </span>
              )}
            </div>

            <p
              style={{
                fontSize: '12px',
                color: 'var(--color-textSecondary)',
                lineHeight: 1.55,
                marginBottom: isExpanded ? '14px' : 0,
              }}
            >
              {agent.description}
            </p>

            {/* Expanded config */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '8px',
                      padding: '14px',
                      background: 'var(--color-surfaceSecondary)',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <ConfigRow label="temperature" value={String(agent.temperature)} />
                    <ConfigRow label="maxTokens" value={String(agent.maxTokens)} />
                    <ConfigRow
                      label="thinking"
                      value={
                        agent.thinkingEnabled
                          ? `on${agent.thinkingBudget ? ` (${agent.thinkingBudget})` : ''}`
                          : 'off'
                      }
                    />
                    <ConfigRow label="costBudget" value={agent.costBudgetPerCall} />
                    <ConfigRow label="timeout" value={agent.timeoutMs} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
};

const ConfigRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div
      style={{
        fontSize: '10px',
        fontWeight: 600,
        color: 'var(--color-textMuted)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        marginBottom: '2px',
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontSize: '12px',
        fontWeight: 500,
        color: 'var(--color-text)',
        fontFamily: 'var(--font-mono, monospace)',
      }}
    >
      {value}
    </div>
  </div>
);

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

// 2026-04-19 — SliderDemo removed (task #144, slider rip).
const InteractiveDemo = {
  PipelineVisualizer,
  AgentTypeExplorer,
};

export default InteractiveDemo;
