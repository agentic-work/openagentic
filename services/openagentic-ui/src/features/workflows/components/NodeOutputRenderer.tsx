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
 * NodeOutputRenderer - Intelligent node output rendering based on node type.
 * Used in execution detail views to display node results with type-appropriate formatting.
 */

import React, { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  ChevronRight,
  ChevronDown,
  Code,
  Globe,
  Terminal,
  Cpu,
  GitBranch,
  ArrowRightLeft,
  Zap,
  AlertTriangle,
  Brain,
} from '@/shared/icons';

// ── Types ──────────────────────────────────────────────────────────────────

interface NodeOutputRendererProps {
  output: any;
  nodeType: string;
  error?: string;
  className?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const LLM_NODE_TYPES = new Set([
  'openagentic_llm',
  'llm_completion',
  'multi_agent',
  'agent_single',
  'agent_pool',
  'agent_supervisor',
]);

const CODE_NODE_TYPES = new Set(['code', 'openagentic']);

function isJsonObject(value: any): boolean {
  return value !== null && typeof value === 'object';
}

function tryParseJson(value: any): any {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return isJsonObject(value) ? value : null;
}

// ── Collapsible JSON Tree ──────────────────────────────────────────────────

const JsonTreeNode: React.FC<{ label?: string; data: any; defaultOpen?: boolean; depth?: number }> = ({
  label,
  data,
  defaultOpen = false,
  depth = 0,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen || depth < 1);

  if (data === null || data === undefined) {
    return (
      <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: depth * 12 }}>
        {label && <span className="text-purple-400">{label}:</span>}
        <span className="text-gray-500 italic">null</span>
      </div>
    );
  }

  if (typeof data === 'string') {
    const isLong = data.length > 300;
    return (
      <div className="flex items-start gap-1 py-0.5" style={{ paddingLeft: depth * 12 }}>
        {label && <span className="text-purple-400 flex-shrink-0">{label}:</span>}
        <span className="text-green-400 break-all">
          &quot;{isLong ? data.substring(0, 300) + '...' : data}&quot;
        </span>
      </div>
    );
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return (
      <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: depth * 12 }}>
        {label && <span className="text-purple-400">{label}:</span>}
        <span className="text-blue-400">{String(data)}</span>
      </div>
    );
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return (
        <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: depth * 12 }}>
          {label && <span className="text-purple-400">{label}:</span>}
          <span className="text-gray-500">[]</span>
        </div>
      );
    }
    return (
      <div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 py-0.5 hover:opacity-80 cursor-pointer"
          style={{ paddingLeft: depth * 12 }}
        >
          {isOpen ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />}
          {label && <span className="text-purple-400">{label}:</span>}
          <span className="text-gray-500">Array[{data.length}]</span>
        </button>
        {isOpen && data.slice(0, 50).map((item, i) => (
          <JsonTreeNode key={i} label={String(i)} data={item} depth={depth + 1} />
        ))}
        {isOpen && data.length > 50 && (
          <div className="text-gray-500 text-[10px] py-0.5" style={{ paddingLeft: (depth + 1) * 12 }}>
            ... {data.length - 50} more items
          </div>
        )}
      </div>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) {
      return (
        <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: depth * 12 }}>
          {label && <span className="text-purple-400">{label}:</span>}
          <span className="text-gray-500">{'{}'}</span>
        </div>
      );
    }
    return (
      <div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 py-0.5 hover:opacity-80 cursor-pointer"
          style={{ paddingLeft: depth * 12 }}
        >
          {isOpen ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />}
          {label && <span className="text-purple-400">{label}:</span>}
          <span className="text-gray-500">{`{${entries.length}}`}</span>
        </button>
        {isOpen && entries.slice(0, 50).map(([key, value]) => (
          <JsonTreeNode key={key} label={key} data={value} depth={depth + 1} />
        ))}
        {isOpen && entries.length > 50 && (
          <div className="text-gray-500 text-[10px] py-0.5" style={{ paddingLeft: (depth + 1) * 12 }}>
            ... {entries.length - 50} more keys
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="py-0.5" style={{ paddingLeft: depth * 12 }}>
      {label && <span className="text-purple-400">{label}: </span>}
      <span className="text-gray-400">{String(data)}</span>
    </div>
  );
};

const CollapsibleJsonTree: React.FC<{ data: any; defaultOpen?: boolean }> = ({ data, defaultOpen = true }) => (
  <div className="font-mono text-[11px] leading-relaxed">
    <JsonTreeNode data={data} defaultOpen={defaultOpen} />
  </div>
);

// ── Collapsible Section ────────────────────────────────────────────────────

const CollapsibleSection: React.FC<{
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, defaultOpen = false, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border rounded" style={{ borderColor: 'var(--color-border, rgba(255,255,255,0.08))' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium hover:opacity-80 cursor-pointer"
        style={{ color: 'var(--color-text-secondary, #8E8E93)' }}
      >
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title}
      </button>
      {isOpen && (
        <div className="px-2 pb-2 border-t" style={{ borderColor: 'var(--color-border, rgba(255,255,255,0.08))' }}>
          {children}
        </div>
      )}
    </div>
  );
};

// ── Status Badge ───────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: number }> = ({ status }) => {
  const isSuccess = status >= 200 && status < 300;
  const isRedirect = status >= 300 && status < 400;
  const isClientError = status >= 400 && status < 500;
  const isServerError = status >= 500;

  const bgColor = isSuccess ? 'rgba(34,197,94,0.15)' : isRedirect ? 'rgba(59,130,246,0.15)' : isClientError ? 'rgba(245,158,11,0.15)' : isServerError ? 'rgba(239,68,68,0.15)' : 'rgba(107,114,128,0.15)';
  const textColor = isSuccess ? 'var(--color-success)' : isRedirect ? '#3b82f6' : isClientError ? '#f59e0b' : isServerError ? '#ef4444' : '#6b7280';

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      {status}
    </span>
  );
};

const BoolBadge: React.FC<{ value: boolean; trueLabel?: string; falseLabel?: string }> = ({
  value,
  trueLabel = 'true',
  falseLabel = 'false',
}) => (
  <span
    className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold"
    style={{
      backgroundColor: value ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
      color: value ? 'var(--color-success)' : '#ef4444',
    }}
  >
    {value ? trueLabel : falseLabel}
  </span>
);

// ── Node Type Renderers ────────────────────────────────────────────────────

const LlmOutputRenderer: React.FC<{ output: any }> = ({ output }) => {
  if (!output) return <span className="text-gray-500 italic text-[11px]">No output</span>;

  const content = output?.content ?? output?.text ?? output?.message ?? (typeof output === 'string' ? output : null);
  const model = output?.model || output?.modelId;
  const tokens = output?.tokens || output?.usage?.total_tokens || output?.totalTokens;
  const promptTokens = output?.usage?.prompt_tokens || output?.promptTokens;
  const completionTokens = output?.usage?.completion_tokens || output?.completionTokens;

  return (
    <div className="space-y-2">
      {/* Metadata bar */}
      {(model || tokens) && (
        <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--color-text-tertiary, #636366)' }}>
          {model && (
            <span className="flex items-center gap-1">
              <Brain className="w-3 h-3" />
              {model}
            </span>
          )}
          {tokens && (
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {Number(tokens).toLocaleString()} tokens
              {promptTokens && completionTokens && (
                <span className="opacity-70">({promptTokens}+{completionTokens})</span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Content */}
      {content ? (
        <div
          className="text-[12px] leading-relaxed whitespace-pre-wrap break-words"
          style={{ color: 'var(--color-text, #FFFFFF)' }}
        >
          {content}
        </div>
      ) : (
        <CollapsibleJsonTree data={output} />
      )}
    </div>
  );
};

const CodeOutputRenderer: React.FC<{ output: any }> = ({ output }) => {
  if (!output) return <span className="text-gray-500 italic text-[11px]">No output</span>;

  const stdout = output?.stdout ?? output?.output ?? (typeof output === 'string' ? output : null);
  const stderr = output?.stderr;
  const exitCode = output?.exitCode ?? output?.exit_code ?? output?.code;

  return (
    <div className="space-y-2">
      {/* Exit code */}
      {exitCode !== undefined && exitCode !== null && (
        <div className="flex items-center gap-2 text-[11px]">
          <span style={{ color: 'var(--color-text-tertiary, #636366)' }}>Exit code:</span>
          <span
            className="px-1.5 py-0.5 rounded font-mono font-semibold text-[10px]"
            style={{
              backgroundColor: exitCode === 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: exitCode === 0 ? 'var(--color-success)' : '#ef4444',
            }}
          >
            {exitCode}
          </span>
        </div>
      )}

      {/* Stdout */}
      {stdout && (
        <div>
          <div className="text-[10px] font-medium mb-1 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary, #636366)' }}>
            <Terminal className="w-3 h-3" /> stdout
          </div>
          <pre
            className="text-[11px] font-mono leading-relaxed p-2.5 rounded overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto"
            style={{
              backgroundColor: 'rgba(0,0,0,0.4)',
              color: '#e2e8f0',
              border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
            }}
          >
            {stdout}
          </pre>
        </div>
      )}

      {/* Stderr */}
      {stderr && (
        <div>
          <div className="text-[10px] font-medium mb-1 flex items-center gap-1 text-red-400">
            <AlertTriangle className="w-3 h-3" /> stderr
          </div>
          <pre
            className="text-[11px] font-mono leading-relaxed p-2.5 rounded overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto"
            style={{
              backgroundColor: 'rgba(239,68,68,0.08)',
              color: '#fca5a5',
              border: '1px solid rgba(239,68,68,0.2)',
            }}
          >
            {stderr}
          </pre>
        </div>
      )}

      {/* Fallback if no stdout/stderr */}
      {!stdout && !stderr && exitCode === undefined && (
        <CollapsibleJsonTree data={output} />
      )}
    </div>
  );
};

const McpToolOutputRenderer: React.FC<{ output: any }> = ({ output }) => {
  if (!output) return <span className="text-gray-500 italic text-[11px]">No output</span>;

  const toolName = output?.toolName || output?.tool_name || output?.name;
  const result = output?.result ?? output?.data ?? output;
  const parsed = tryParseJson(result);

  return (
    <div className="space-y-2">
      {toolName && (
        <div className="flex items-center gap-1.5 text-[11px]">
          <Cpu className="w-3 h-3" style={{ color: 'var(--color-text-tertiary, #636366)' }} />
          <span className="font-mono font-medium" style={{ color: 'var(--color-text, #FFFFFF)' }}>{toolName}</span>
        </div>
      )}

      {parsed ? (
        <CollapsibleJsonTree data={parsed} defaultOpen />
      ) : typeof result === 'string' ? (
        <pre
          className="text-[11px] font-mono p-2 rounded whitespace-pre-wrap break-all"
          style={{
            backgroundColor: 'rgba(0,0,0,0.3)',
            color: 'var(--color-text, #FFFFFF)',
            border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          }}
        >
          {result}
        </pre>
      ) : (
        <CollapsibleJsonTree data={result} defaultOpen />
      )}
    </div>
  );
};

const HttpOutputRenderer: React.FC<{ output: any }> = ({ output }) => {
  if (!output) return <span className="text-gray-500 italic text-[11px]">No output</span>;

  const status = output?.status ?? output?.statusCode ?? output?.status_code;
  const headers = output?.headers ?? output?.responseHeaders;
  const body = output?.body ?? output?.data ?? output?.response;

  return (
    <div className="space-y-2">
      {/* Status code */}
      {status !== undefined && (
        <div className="flex items-center gap-2 text-[11px]">
          <Globe className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary, #636366)' }} />
          <StatusBadge status={Number(status)} />
          {output?.url && (
            <span className="font-mono text-[10px] truncate" style={{ color: 'var(--color-text-secondary, #8E8E93)' }}>
              {output.url}
            </span>
          )}
        </div>
      )}

      {/* Headers */}
      {headers && Object.keys(headers).length > 0 && (
        <CollapsibleSection title={`Response Headers (${Object.keys(headers).length})`}>
          <div className="font-mono text-[10px] space-y-0.5 mt-1">
            {Object.entries(headers).map(([key, value]) => (
              <div key={key} className="flex gap-1">
                <span className="text-purple-400 flex-shrink-0">{key}:</span>
                <span style={{ color: 'var(--color-text-secondary, #8E8E93)' }}>{String(value)}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Body */}
      {body !== undefined && body !== null && (
        <div>
          <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-tertiary, #636366)' }}>
            Response Body
          </div>
          {tryParseJson(body) ? (
            <CollapsibleJsonTree data={tryParseJson(body)} />
          ) : (
            <pre
              className="text-[11px] font-mono p-2 rounded whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto"
              style={{
                backgroundColor: 'rgba(0,0,0,0.3)',
                color: 'var(--color-text, #FFFFFF)',
                border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              }}
            >
              {String(body)}
            </pre>
          )}
        </div>
      )}

      {/* Fallback */}
      {status === undefined && !headers && body === undefined && (
        <CollapsibleJsonTree data={output} />
      )}
    </div>
  );
};

const ConditionOutputRenderer: React.FC<{ output: any }> = ({ output }) => {
  if (!output) return <span className="text-gray-500 italic text-[11px]">No output</span>;

  const condition = output?.condition ?? output?.expression;
  const result = output?.result ?? output?.value ?? output?.branch;
  const branchTaken = typeof result === 'boolean' ? result : result === 'true';

  return (
    <div className="space-y-2">
      {condition && (
        <div>
          <div className="text-[10px] font-medium mb-1 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary, #636366)' }}>
            <GitBranch className="w-3 h-3" /> Condition
          </div>
          <pre
            className="text-[11px] font-mono p-2 rounded whitespace-pre-wrap"
            style={{
              backgroundColor: 'rgba(0,0,0,0.3)',
              color: '#e2e8f0',
              border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
            }}
          >
            {typeof condition === 'string' ? condition : JSON.stringify(condition, null, 2)}
          </pre>
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px]">
        <span style={{ color: 'var(--color-text-tertiary, #636366)' }}>Branch taken:</span>
        <BoolBadge value={branchTaken} />
      </div>

      {/* Show any additional data */}
      {output && !condition && result === undefined && (
        <CollapsibleJsonTree data={output} />
      )}
    </div>
  );
};

const TransformOutputRenderer: React.FC<{ output: any }> = ({ output }) => {
  if (!output) return <span className="text-gray-500 italic text-[11px]">No output</span>;

  const inputData = output?.input ?? output?.before;
  const outputData = output?.output ?? output?.after ?? output?.result ?? output;
  const hasInputOutput = inputData !== undefined && outputData !== undefined && inputData !== outputData;

  return (
    <div className="space-y-2">
      {hasInputOutput ? (
        <>
          <div className="flex items-center gap-2 text-[10px] font-medium" style={{ color: 'var(--color-text-tertiary, #636366)' }}>
            <ArrowRightLeft className="w-3 h-3" /> Transform
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] font-medium mb-1 text-orange-400/70">Input</div>
              <div
                className="p-2 rounded text-[11px] font-mono overflow-auto max-h-[200px]"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                }}
              >
                <CollapsibleJsonTree data={inputData} />
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium mb-1 text-green-400/70">Output</div>
              <div
                className="p-2 rounded text-[11px] font-mono overflow-auto max-h-[200px]"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                }}
              >
                <CollapsibleJsonTree data={outputData} />
              </div>
            </div>
          </div>
        </>
      ) : (
        <CollapsibleJsonTree data={output} defaultOpen />
      )}
    </div>
  );
};

const TriggerOutputRenderer: React.FC<{ output: any }> = ({ output }) => {
  if (!output) return <span className="text-gray-500 italic text-[11px]">No output</span>;

  const triggerType = output?.triggerType ?? output?.trigger_type ?? output?.type;
  const inputData = output?.data ?? output?.payload ?? output?.input;

  return (
    <div className="space-y-2">
      {triggerType && (
        <div className="flex items-center gap-2 text-[11px]">
          <Zap className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary, #636366)' }} />
          <span
            className="px-2 py-0.5 rounded font-medium text-[10px] uppercase tracking-wide"
            style={{
              backgroundColor: 'rgba(59,130,246,0.15)',
              color: '#60a5fa',
            }}
          >
            {triggerType}
          </span>
        </div>
      )}

      {inputData !== undefined ? (
        <div>
          <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-tertiary, #636366)' }}>
            Input Data
          </div>
          <CollapsibleJsonTree data={inputData} defaultOpen />
        </div>
      ) : !triggerType ? (
        <CollapsibleJsonTree data={output} defaultOpen />
      ) : null}
    </div>
  );
};

// ── Error Renderer ─────────────────────────────────────────────────────────

const ErrorBox: React.FC<{ error: string }> = ({ error }) => (
  <div
    className="flex items-start gap-2 p-3 rounded text-[12px]"
    style={{
      backgroundColor: 'rgba(239,68,68,0.1)',
      border: '1px solid rgba(239,68,68,0.25)',
    }}
  >
    <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
    <div className="text-red-300 whitespace-pre-wrap break-words font-mono">{error}</div>
  </div>
);

// ── Main Component ─────────────────────────────────────────────────────────

export const NodeOutputRenderer: React.FC<NodeOutputRendererProps> = ({
  output,
  nodeType,
  error,
  className = '',
}) => {
  return (
    <div className={`space-y-2 ${className}`}>
      {/* Error state always shown on top */}
      {error && <ErrorBox error={error} />}

      {/* Type-specific output rendering */}
      {output !== undefined && output !== null ? (
        LLM_NODE_TYPES.has(nodeType) ? (
          <LlmOutputRenderer output={output} />
        ) : CODE_NODE_TYPES.has(nodeType) ? (
          <CodeOutputRenderer output={output} />
        ) : nodeType === 'mcp_tool' ? (
          <McpToolOutputRenderer output={output} />
        ) : nodeType === 'http_request' ? (
          <HttpOutputRenderer output={output} />
        ) : nodeType === 'condition' ? (
          <ConditionOutputRenderer output={output} />
        ) : nodeType === 'transform' || nodeType === 'merge' ? (
          <TransformOutputRenderer output={output} />
        ) : nodeType === 'trigger' ? (
          <TriggerOutputRenderer output={output} />
        ) : (
          /* Default: JSON tree viewer */
          <CollapsibleJsonTree data={output} defaultOpen />
        )
      ) : !error ? (
        <span className="text-gray-500 italic text-[11px]">No output</span>
      ) : null}
    </div>
  );
};

export default NodeOutputRenderer;
