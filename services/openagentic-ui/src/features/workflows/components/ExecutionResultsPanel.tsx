/**
 * ExecutionResultsPanel — Right-side 440px panel with 4 tabs:
 *   1. Output   — Node inspector with Input/Output (JSON | Rendered | Table views)
 *   2. Timeline — Vertical timeline of node executions with expandable cards
 *   3. AI       — Slot for AIFlowBuilder / AI assistant
 *   4. History  — Past execution list with mini health bars
 *   5. API      — Auto-generated code snippets (curl, Python, JS, TS, MCP)
 *
 * Visual fidelity: GitHub-dark design matching execution-results-mockup.html
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Node } from 'reactflow';
import {
  CheckCircle, XCircle, Clock, Zap, AlertCircle,
  ChevronDown, ChevronRight, Activity, Play, Brain, RotateCcw,
  Send, Sparkles, Trash2, Loader2, Eye, X, Copy, Check, Code,
  Download, Save, ExternalLink,
} from '@/shared/icons';
import { NodeOutputRenderer } from './NodeOutputRenderer';
import { useAuth } from '@/app/providers/AuthContext';
import { WorkflowApiService, WorkflowExecution } from '../services/workflowApi';
import { nodeTypeConfigs } from '../utils/nodeConfigs';
import { useAIFlowChat, type AIFlowMessage, type CanvasContext, type ExecutionContext, type WorkflowPatch } from '../hooks/useAIFlowChat';
import type { WorkflowDefinition } from '../types/workflow.types';
import { SharedMarkdownRenderer } from '@/features/chat/components/MessageContent/SharedMarkdownRenderer';

// ── Types ────────────────────────────────────────────────────────────────

export interface OutputEnvelope {
  format: 'markdown' | 'html' | 'json' | 'table';
  title: string;
  content: string;
  raw: any;
  artifacts: string[];
  nodeId?: string;
  nodeType?: string;
  persistToMilvus?: boolean;
}

export interface NodeExecution {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime?: number;
  duration?: number;
  input?: any;
  output?: any;
  outputEnvelope?: OutputEnvelope;
  error?: string;
  tokens?: number;
  cost?: number;
}

export interface ExecutionData {
  executionId: string;
  status: 'running' | 'completed' | 'failed' | 'completed_with_errors';
  startedAt: string;
  completedAt?: string;
  totalDuration?: number;
  nodeExecutions: NodeExecution[];
  totalTokens?: number;
  cost?: number;
}

interface ExecutionResultsPanelProps {
  executionData: ExecutionData | null;
  isExecuting: boolean;
  selectedNodeId: string | null;
  nodes: Node[];
  workflowId: string | null;
  workflowName: string;
  aiAssistantContent?: React.ReactNode;
  canvasContext?: CanvasContext | null;
  executionContext?: ExecutionContext | null;
  /** Full React Flow nodes/edges for AI context */
  rawDefinition?: { nodes: any[]; edges: any[] } | null;
  onNodeSelect?: (nodeId: string) => void;
  onLoadExecution?: (executionId: string) => void;
  onRerun?: () => void;
  onWorkflowGenerated?: (definition: WorkflowDefinition) => void;
  onWorkflowPatch?: (patches: WorkflowPatch[]) => void;
  defaultTab?: TabId;
  onClose?: () => void;
  style?: React.CSSProperties;
}

export type TabId = 'output' | 'timeline' | 'assistant' | 'history' | 'code';
type ViewMode = 'json' | 'rendered' | 'table';
type SnippetLang = 'curl' | 'python' | 'javascript' | 'typescript' | 'mcp_tool';

// ── Helpers ──────────────────────────────────────────────────────────────

const SC: Record<string, string> = {
  completed: '#2ea043', running: '#d29922', failed: '#f85149',
  pending: '#8b949e', skipped: '#8b949e', completed_with_errors: '#d29922',
};

function fmt(ms?: number): string {
  if (ms == null) return '--';
  if (ms < 1000) return `${ms}ms`;
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`;
}

function ago(d?: string): string {
  if (!d) return '--';
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return diff < 86400000 ? `${Math.floor(diff / 3600000)}h ago` : `${Math.floor(diff / 86400000)}d ago`;
}

/** Parse common error patterns and return human-readable messages with suggested fixes */
function formatErrorMessage(error: string, nodeLabel?: string, nodeType?: string): { message: string; suggestion?: string } {
  const e = error.toLowerCase();

  // Connection errors
  if (e.includes('econnrefused') || e.includes('connection refused')) {
    const serverMatch = error.match(/(?:to|at|connect)\s+(\S+)/i);
    return {
      message: `Connection refused${serverMatch ? ` to ${serverMatch[1]}` : ''}`,
      suggestion: 'Check that the target service is running and the URL/port is correct.',
    };
  }

  // Auth errors
  if (e.includes('401') || e.includes('unauthorized')) {
    return {
      message: 'Authentication failed',
      suggestion: 'Check credentials or API key. Use {{secret:name}} for secure storage.',
    };
  }
  if (e.includes('403') || e.includes('forbidden')) {
    return {
      message: 'Access denied (403 Forbidden)',
      suggestion: 'The API key or token does not have permission for this operation.',
    };
  }

  // Timeout
  if (e.includes('timeout') || e.includes('etimedout') || e.includes('timed out')) {
    const timeMatch = error.match(/(\d+)\s*(?:ms|milliseconds|seconds|s)/i);
    return {
      message: `Request timed out${timeMatch ? ` after ${timeMatch[1]}${timeMatch[0].includes('ms') ? 'ms' : 's'}` : ''}`,
      suggestion: 'Increase the timeout in node settings, or check if the target service is slow.',
    };
  }

  // Rate limiting
  if (e.includes('429') || e.includes('rate limit') || e.includes('too many requests')) {
    return {
      message: 'Rate limited (429 Too Many Requests)',
      suggestion: 'Add a wait node before this step, or enable retry with backoff.',
    };
  }

  // DNS / not found
  if (e.includes('enotfound') || e.includes('getaddrinfo')) {
    const hostMatch = error.match(/getaddrinfo.*?\s(\S+)/i);
    return {
      message: `DNS lookup failed${hostMatch ? ` for "${hostMatch[1]}"` : ''}`,
      suggestion: 'Check the hostname/URL spelling. The server may not exist or DNS may be unreachable.',
    };
  }

  // Model errors
  if (e.includes('model') && (e.includes('not found') || e.includes('not available'))) {
    const modelMatch = error.match(/model[:\s]+"?([^"]+)"?/i);
    return {
      message: `Model not available${modelMatch ? `: ${modelMatch[1]}` : ''}`,
      suggestion: 'Select a different model in the node configuration, or use "auto" for platform routing.',
    };
  }

  // MCP tool errors
  if (e.includes('tool') && (e.includes('not found') || e.includes('not available'))) {
    return {
      message: 'MCP tool not available',
      suggestion: 'Check that the MCP server is connected and the tool name is correct.',
    };
  }

  // JSON parse errors
  if (e.includes('json') && (e.includes('parse') || e.includes('syntax'))) {
    return {
      message: 'Invalid JSON in node configuration',
      suggestion: 'Check JSON syntax in arguments, headers, or body fields.',
    };
  }

  // Token/context length
  if (e.includes('context length') || e.includes('token limit') || e.includes('maximum context')) {
    return {
      message: 'Input exceeds model context length',
      suggestion: 'Reduce input size with a transform node, or use a model with a larger context window.',
    };
  }

  // Generic 5xx
  if (/\b5\d{2}\b/.test(error) || e.includes('internal server error')) {
    return {
      message: 'Server error (5xx)',
      suggestion: 'The target service returned an error. Check service logs or retry.',
    };
  }

  // Fallback: return as-is but truncated
  return {
    message: error.length > 200 ? error.slice(0, 200) + '...' : error,
  };
}

const nColor = (t: string) => nodeTypeConfigs[t]?.color || '#58a6ff';
const nIcon = (t: string) => nodeTypeConfigs[t]?.icon || '\u25CF';
const isObj = (v: any): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);

function syntaxHL(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'wf-json-number';
      if (/^"/.test(match)) cls = /:$/.test(match) ? 'wf-json-key' : 'wf-json-string';
      else if (/true|false/.test(match)) cls = 'wf-json-boolean';
      else if (/null/.test(match)) cls = 'wf-json-null';
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

// ── Micro-components ─────────────────────────────────────────────────────

const TimelineError: React.FC<{ error: string; nodeLabel?: string; nodeType?: string }> = ({ error, nodeLabel, nodeType }) => {
  const fmtErr = formatErrorMessage(error, nodeLabel, nodeType);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: '#f85149' }} />
        <div>
          <span style={{ color: '#f85149', wordBreak: 'break-word', fontWeight: 600 }}>{fmtErr.message}</span>
          {fmtErr.suggestion && (
            <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>{fmtErr.suggestion}</div>
          )}
        </div>
      </div>
    </div>
  );
};

const ViewToggle: React.FC<{ mode: ViewMode; onChange: (m: ViewMode) => void }> = ({ mode, onChange }) => (
  <div className="wf-view-toggle">
    {(['json', 'rendered', 'table'] as ViewMode[]).map(m => (
      <button key={m} onClick={() => onChange(m)} className={`wf-view-btn ${mode === m ? 'active' : ''}`}>
        {m.charAt(0).toUpperCase() + m.slice(1)}
      </button>
    ))}
  </div>
);

const TableView: React.FC<{ data: any }> = ({ data }) => {
  if (data == null) return <span style={{ color: '#6e7681', fontStyle: 'italic', fontSize: 11 }}>null</span>;
  const entries: [string, any][] = Array.isArray(data)
    ? data.map((v, i) => [String(i), v])
    : isObj(data) ? Object.entries(data) : [['-', data]];
  return (
    <div style={{ overflow: 'auto', maxHeight: 400 }}>
      <table className="wf-output-table">
        <thead><tr><th>Key</th><th>Value</th></tr></thead>
        <tbody>{entries.slice(0, 100).map(([key, value], idx) => (
          <tr key={idx}>
            <td style={{ color: '#bc8cff', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{key}</td>
            <td style={{ wordBreak: 'break-all' }}>
              {isObj(value) || Array.isArray(value)
                ? <pre style={{ whiteSpace: 'pre-wrap', fontSize: 10, margin: 0 }}>{JSON.stringify(value, null, 2)}</pre>
                : String(value ?? 'null')}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
};

const JsonBlock: React.FC<{ data: any }> = ({ data }) => {
  const str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  if (typeof data === 'string') return <pre className="wf-json-block wf-scrollbar">{str}</pre>;
  return <pre className="wf-json-block wf-scrollbar" dangerouslySetInnerHTML={{ __html: syntaxHL(str) }} />;
};

/** Download content as a file */
const downloadContent = (content: string, filename: string, mimeType = 'text/plain') => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/** Open rendered content in a new browser tab */
const openInNewTab = (content: string, title: string, format: 'markdown' | 'html' | 'text') => {
  let html: string;
  if (format === 'html') {
    // If already full HTML document, open as-is; otherwise wrap it
    html = content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html')
      ? content
      : `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
          body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.6;color:#e2e8f0;background:#0d1117;}
          pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;overflow:auto;}
          code{font-family:ui-monospace,monospace;font-size:0.9em;}
          table{border-collapse:collapse;width:100%;} td,th{border:1px solid #30363d;padding:8px 12px;}
          h1,h2,h3{color:#f0f6fc;border-bottom:1px solid #21262d;padding-bottom:8px;}
          a{color:#58a6ff;}
        </style></head><body>${content}</body></html>`;
  } else if (format === 'markdown') {
    // Basic markdown-to-html conversion for standalone rendering
    const escaped = content
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rendered = escaped
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^---$/gm, '<hr>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
      body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.7;color:#e2e8f0;background:#0d1117;}
      p{margin:0.8em 0;} h1,h2,h3{color:#f0f6fc;border-bottom:1px solid #21262d;padding-bottom:8px;margin-top:1.5em;}
      pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:16px;overflow:auto;}
      code{font-family:ui-monospace,monospace;font-size:0.9em;background:#161b22;padding:2px 5px;border-radius:3px;}
      strong{color:#f0f6fc;} hr{border:none;border-top:1px solid #21262d;margin:24px 0;}
      table{border-collapse:collapse;width:100%;} td,th{border:1px solid #30363d;padding:8px 12px;}
      a{color:#58a6ff;}
    </style></head><body><p>${rendered}</p></body></html>`;
  } else {
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
      body{font-family:ui-monospace,monospace;background:#0d1117;color:#e2e8f0;padding:20px;white-space:pre-wrap;word-break:break-all;}
    </style></head><body>${content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</body></html>`;
  }
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  // Revoke after a delay to allow the browser to load it
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return win;
};

/** Save output as artifact, then optionally ingest to knowledge base with DLP gate */
const saveToKnowledgeBase = async (
  envelope: OutputEnvelope,
  executionId: string | undefined,
  getAuthHeaders: () => Record<string, string>,
  target: 'personal' | 'global' = 'personal',
): Promise<{ ok: boolean; dlpBlocked?: boolean; findings?: any[] }> => {
  if (!executionId) return { ok: false };
  try {
    // Step 1: Persist as artifact
    const artifactRes = await fetch(`/api/workflows/executions/${executionId}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        content: envelope.content,
        title: envelope.title,
        format: envelope.format,
        nodeId: envelope.nodeId,
      }),
    });
    if (!artifactRes.ok) return { ok: false };
    const { artifactId } = await artifactRes.json();
    if (!artifactId) return { ok: true }; // Saved as artifact only

    // Step 2: Ingest to knowledge base (DLP-gated)
    const kbRes = await fetch(`/api/artifacts/${artifactId}/to-knowledge-base`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ target, title: envelope.title }),
    });

    if (kbRes.status === 403) {
      const dlpData = await kbRes.json();
      return { ok: false, dlpBlocked: true, findings: dlpData.findings };
    }

    return { ok: kbRes.ok };
  } catch {
    return { ok: false };
  }
};

const DataSection: React.FC<{
  title: string;
  data: any;
  nodeType: string;
  error?: string;
  outputEnvelope?: OutputEnvelope;
  executionId?: string;
}> = ({ title, data, nodeType, error, outputEnvelope, executionId }) => {
  const { getAuthHeaders } = useAuth();
  const [mode, setMode] = useState<ViewMode>('rendered');
  const [open, setOpen] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const has = data !== undefined && data !== null;
  const envelope = outputEnvelope;

  // Auto-detect markdown content even without envelope
  const autoMarkdown = useMemo(() => {
    if (envelope) return null; // envelope handles its own rendering
    if (typeof data === 'string' && (data.startsWith('#') || data.includes('\n## ') || data.includes('**'))) return data;
    if (data && typeof data.content === 'string' && (data.content.startsWith('#') || data.content.includes('\n## ') || data.content.includes('**'))) return data.content;
    return null;
  }, [data, envelope]);

  const handleDownload = () => {
    if (!envelope && !data && !autoMarkdown) return;
    const content = envelope?.content || autoMarkdown || (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    const ext = (envelope?.format === 'markdown' || autoMarkdown) ? 'md' : envelope?.format === 'html' ? 'html' : 'json';
    const filename = `${(envelope?.title || title).replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
    downloadContent(content, filename, ext === 'md' ? 'text/markdown' : ext === 'html' ? 'text/html' : 'application/json');
  };

  const [dlpMessage, setDlpMessage] = useState<string | null>(null);

  const handleSaveToKB = async (target: 'personal' | 'global' = 'personal') => {
    const content = envelope?.content || autoMarkdown;
    if (!content) return;
    const effectiveEnvelope: OutputEnvelope = envelope || {
      format: 'markdown',
      title: title || 'Workflow Output',
      content,
      raw: data,
      artifacts: [],
    };
    setSaveStatus('saving');
    setDlpMessage(null);
    const result = await saveToKnowledgeBase(effectiveEnvelope, executionId, getAuthHeaders, target);
    if (result.dlpBlocked) {
      setSaveStatus('error');
      const cats = result.findings?.map((f: any) => f.category).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(', ');
      setDlpMessage(`DLP blocked: ${cats || 'sensitive content detected'}`);
    } else {
      setSaveStatus(result.ok ? 'saved' : 'error');
    }
    setTimeout(() => { setSaveStatus('idle'); setDlpMessage(null); }, 5000);
  };

  return (
    <div className="wf-output-section">
      <div className="wf-output-section-title" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title}
        {open && has && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <ViewToggle mode={mode} onChange={setMode} />
            {title === 'Output' && has && (
              <>
                {(envelope || autoMarkdown) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const content = envelope?.content || autoMarkdown || '';
                      const fmt = envelope?.format === 'html' ? 'html' : 'markdown';
                      openInNewTab(content, envelope?.title || 'Workflow Output', fmt);
                    }}
                    className="wf-view-btn" title="Open in new tab" style={{ padding: '2px 6px' }}>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                  className="wf-view-btn" title="Download" style={{ padding: '2px 6px' }}>
                  <Download className="w-3 h-3" />
                </button>
                {(envelope || autoMarkdown) && (
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <button onClick={(e) => { e.stopPropagation(); handleSaveToKB('personal'); }}
                      className="wf-view-btn" title="Save to My Knowledge Base"
                      style={{ padding: '2px 6px', color: saveStatus === 'saved' ? '#2ea043' : saveStatus === 'error' ? '#f85149' : undefined }}>
                      {saveStatus === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                       saveStatus === 'saved' ? <Check className="w-3 h-3" /> :
                       <Save className="w-3 h-3" />}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleSaveToKB('global'); }}
                      className="wf-view-btn" title="Save to Global Knowledge Base (DLP scanned)"
                      style={{ padding: '2px 4px', fontSize: 8, fontWeight: 700, color: saveStatus === 'error' ? '#f85149' : 'var(--color-text-tertiary)' }}>
                      G
                    </button>
                    {dlpMessage && (
                      <div style={{
                        position: 'absolute', top: '100%', right: 0, zIndex: 50,
                        padding: '4px 8px', borderRadius: 4, fontSize: 10,
                        background: '#f8514920', border: '1px solid #f85149',
                        color: '#f85149', whiteSpace: 'nowrap', marginTop: 2,
                      }}>
                        {dlpMessage}
                      </div>
                    )}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {open && (
        !has ? (
          <div className="wf-json-block" style={{ padding: 16, textAlign: 'center', color: '#6e7681', fontStyle: 'italic' }}>
            No {title.toLowerCase()} data
          </div>
        ) : mode === 'json' ? (
          <JsonBlock data={envelope?.raw ?? data} />
        ) : mode === 'table' ? (
          <TableView data={envelope?.raw ?? data} />
        ) : envelope?.format === 'markdown' ? (
          <div className="wf-rendered-output wf-scrollbar" style={{ maxHeight: 400, overflowY: 'auto', padding: '8px 12px' }}>
            <SharedMarkdownRenderer content={envelope.content} theme="dark" />
          </div>
        ) : envelope?.format === 'html' ? (
          <div className="wf-rendered-output wf-scrollbar" style={{ maxHeight: 400, overflowY: 'auto', padding: '8px 12px' }}
            dangerouslySetInnerHTML={{ __html: envelope.content }} />
        ) : autoMarkdown ? (
          <div className="wf-rendered-output wf-scrollbar" style={{ maxHeight: 400, overflowY: 'auto', padding: '8px 12px' }}>
            <SharedMarkdownRenderer content={autoMarkdown} theme="dark" />
          </div>
        ) : (
          <div className="wf-rendered-output wf-scrollbar" style={{ maxHeight: 400, overflowY: 'auto' }}>
            <NodeOutputRenderer output={data} nodeType={nodeType} error={title === 'Output' ? error : undefined} />
          </div>
        )
      )}
    </div>
  );
};

// ── Tab 1: Output (Node Inspector) ───────────────────────────────────────

const OutputTab: React.FC<{
  selectedNodeId: string | null;
  nodes: Node[];
  executionData: ExecutionData | null;
  onFixWithAI?: (nodeId: string, error: string) => void;
}> = ({ selectedNodeId, nodes, executionData, onFixWithAI }) => {
  // Auto-select the last completed terminal node when no node is selected
  const effectiveNodeId = useMemo(() => {
    if (selectedNodeId) return selectedNodeId;
    if (!executionData || executionData.status === 'running') return null;
    // Find terminal nodes (nodes that completed last — typically output/end nodes)
    const completedNodes = executionData.nodeExecutions?.filter(n => n.status === 'completed' || n.status === 'failed') || [];
    if (completedNodes.length === 0) return null;
    // Return the last completed node (usually the terminal/output node)
    return completedNodes[completedNodes.length - 1]?.nodeId || null;
  }, [selectedNodeId, executionData]);

  const node = useMemo(() => nodes.find(n => n.id === effectiveNodeId) || null, [nodes, effectiveNodeId]);

  if (!node) return (
    <div className="wf-exec-empty">
      <Activity className="wf-exec-empty-icon" />
      <div className="wf-exec-empty-text">
        {executionData?.status === 'running'
          ? 'Workflow is executing...'
          : 'Select a node on the canvas to inspect its data'}
      </div>
      {executionData?.status === 'running' && (
        <div className="wf-exec-progress-bar">
          <div className="wf-exec-progress-fill" />
        </div>
      )}
    </div>
  );

  const d = node.data || {};
  const nType = d.type || node.type || 'unknown';
  const color = nColor(nType);
  const status = d.executionState || 'pending';
  const ne = executionData?.nodeExecutions?.find(x => x.nodeId === selectedNodeId);
  const output = d.executionOutput ?? ne?.output;
  const input = d.executionInput ?? ne?.input;
  const error = d.executionError ?? ne?.error;
  const duration = d.executionTimeMs ?? ne?.duration;

  return (
    <div className="wf-exec-content wf-scrollbar" style={{ overflowY: 'auto' }}>
      {/* Node header card */}
      <div className="wf-node-output-header">
        <div className="wf-noh-icon" style={{ backgroundColor: `${color}22`, color }}>
          {nIcon(nType)}
        </div>
        <div className="wf-noh-info">
          <div className="wf-noh-name">{d.label || node.id}</div>
          <div className="wf-noh-type">{nType}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span className={`wf-status-pill ${status}`}>{status.replace(/_/g, ' ')}</span>
          <div className="wf-noh-stats">
            {duration != null && <span><Clock className="w-3 h-3" />{fmt(duration)}</span>}
            {ne?.tokens != null && <span><Zap className="w-3 h-3" />{ne.tokens.toLocaleString()}</span>}
          </div>
        </div>
      </div>

      <DataSection title="Input" data={input} nodeType={nType} />
      <DataSection title="Output" data={output} nodeType={nType} error={error}
        outputEnvelope={ne?.outputEnvelope} executionId={executionData?.executionId} />

      {error && (() => {
        const formatted = formatErrorMessage(error, d.label, nType);
        return (
        <div className="wf-output-section">
          <div style={{
            background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)',
            borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#f85149' }} />
              <div>
                <div style={{ fontSize: 12, color: '#f85149', fontWeight: 600, lineHeight: 1.5 }}>{formatted.message}</div>
                {formatted.suggestion && (
                  <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4, lineHeight: 1.5 }}>
                    {formatted.suggestion}
                  </div>
                )}
              </div>
            </div>
            {formatted.message !== error && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 10, color: '#6e7681', cursor: 'pointer', userSelect: 'none' }}>
                  Show raw error
                </summary>
                <pre style={{
                  fontSize: 10, color: '#8b949e', marginTop: 4, padding: 8,
                  background: 'rgba(0,0,0,0.2)', borderRadius: 4, whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all', maxHeight: 200, overflow: 'auto',
                }}>
                  {error}
                </pre>
              </details>
            )}
            {onFixWithAI && (
              <button
                onClick={() => onFixWithAI(node.id, error)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                  border: 'none', borderRadius: 6, color: '#fff', fontSize: 12,
                  fontWeight: 500, cursor: 'pointer', alignSelf: 'flex-start',
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Fix with AI
              </button>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
};

// ── Tab 2: Timeline ──────────────────────────────────────────────────────

const TimelineTab: React.FC<{
  executionData: ExecutionData | null;
  isExecuting: boolean;
  onNodeSelect?: (id: string) => void;
  onRerun?: () => void;
}> = ({ executionData, isExecuting, onNodeSelect, onRerun }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, ViewMode>>({});

  if (!executionData) return (
    <div className="wf-exec-empty">
      <Play className="wf-exec-empty-icon" />
      <div className="wf-exec-empty-text">Run a workflow to see the execution timeline</div>
    </div>
  );

  const { nodeExecutions: nes, status, executionId, startedAt, totalDuration } = executionData;
  const completed = nes.filter(n => n.status === 'completed').length;
  const failed = nes.filter(n => n.status === 'failed').length;

  return (
    <div className="wf-exec-content wf-scrollbar" style={{ overflowY: 'auto' }}>
      {/* Run header */}
      <div className="wf-run-header">
        <span className={`wf-run-status-dot ${status}`} />
        <div className="wf-run-info">
          <div className="wf-run-title">Run {executionId.slice(0, 8)}</div>
          <div className="wf-run-meta">
            manual &middot; {ago(startedAt)} &middot; {completed}/{nes.length} nodes
            {failed > 0 && <span style={{ color: '#f85149' }}> &middot; {failed} failed</span>}
          </div>
        </div>
        {isExecuting && <div className="wf-exec-spinner" style={{ width: 14, height: 14 }} />}
        {totalDuration != null && <span className="wf-run-duration">{fmt(totalDuration)}</span>}
        {onRerun && !isExecuting && (
          <button onClick={onRerun} style={{
            background: 'none', border: '1px solid var(--wf-ep-border)', borderRadius: 6,
            padding: '4px 8px', color: 'var(--wf-ep-text-secondary)', cursor: 'pointer', display: 'flex',
            alignItems: 'center', gap: 4, fontSize: 10,
          }}>
            <RotateCcw className="w-3 h-3" /> Rerun
          </button>
        )}
      </div>

      {/* Vertical timeline */}
      <div style={{ padding: '0 12px 12px' }}>
        {nes.map((ne, idx) => {
          const isLast = idx === nes.length - 1;
          const exp = expandedId === ne.nodeId;
          const color = nColor(ne.nodeType);
          const view = views[ne.nodeId] || 'rendered';

          return (
            <div key={ne.nodeId} className="wf-timeline-step">
              <div className="wf-timeline-rail">
                <span className={`wf-timeline-dot ${ne.status}`} />
                {!isLast && <div className="wf-timeline-connector" />}
              </div>

              <div
                className={`wf-timeline-card ${exp ? 'expanded' : ''}`}
                onClick={() => { setExpandedId(exp ? null : ne.nodeId); onNodeSelect?.(ne.nodeId); }}
              >
                <div className="wf-tc-header">
                  <div className="wf-tc-icon" style={{ backgroundColor: `${color}22`, color }}>
                    {nIcon(ne.nodeType)}
                  </div>
                  <span className="wf-tc-name">{ne.nodeLabel || ne.nodeId}</span>
                  {ne.duration != null && <span className="wf-tc-time">{fmt(ne.duration)}</span>}
                  <span className={`wf-status-pill ${ne.status}`}>{ne.status}</span>
                </div>

                <AnimatePresence>
                  {exp && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="wf-tc-output"
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="wf-tc-output-tabs">
                        {(['rendered', 'json', 'table'] as ViewMode[]).map(m => (
                          <button key={m}
                            className={`wf-tc-output-tab ${view === m ? 'active' : ''}`}
                            onClick={e => { e.stopPropagation(); setViews(p => ({ ...p, [ne.nodeId]: m })); }}>
                            {m.charAt(0).toUpperCase() + m.slice(1)}
                          </button>
                        ))}
                      </div>
                      <div className="wf-tc-output-body wf-scrollbar">
                        {ne.error ? (
                          <TimelineError error={ne.error} nodeLabel={ne.nodeLabel} nodeType={ne.nodeType} />
                        ) : ne.output != null ? (
                          view === 'json' ? <JsonBlock data={ne.outputEnvelope?.raw ?? ne.output} />
                          : view === 'table' ? <TableView data={ne.outputEnvelope?.raw ?? ne.output} />
                          : ne.outputEnvelope?.format === 'markdown' ? (
                            <div className="wf-rendered-output" style={{ border: 'none', background: 'transparent', padding: 0 }}>
                              <SharedMarkdownRenderer content={ne.outputEnvelope.content} theme="dark" />
                            </div>
                          ) : (
                            <div className="wf-rendered-output" style={{ border: 'none', background: 'transparent', padding: 0 }}>
                              <NodeOutputRenderer output={ne.output} nodeType={ne.nodeType} />
                            </div>
                          )
                        ) : (
                          <span style={{ color: '#6e7681', fontStyle: 'italic' }}>No output</span>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
        {nes.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: '#6e7681', fontSize: 12 }}>
            No node executions recorded
          </div>
        )}
      </div>
    </div>
  );
};

// ── Tab 3: AI Assistant ──────────────────────────────────────────────────

const AssistantTab: React.FC<{
  content?: React.ReactNode;
  canvasContext?: CanvasContext | null;
  executionContext?: ExecutionContext | null;
  rawDefinition?: { nodes: any[]; edges: any[] } | null;
  onWorkflowGenerated?: (def: WorkflowDefinition) => void;
  onWorkflowPatch?: (patches: WorkflowPatch[]) => void;
}> = ({ content, canvasContext, executionContext, rawDefinition, onWorkflowGenerated, onWorkflowPatch }) => {
  if (content) return <div className="wf-exec-content">{content}</div>;

  const { messages, isGenerating, sendMessage, clearMessages, stopGeneration, setCanvasContext } = useAIFlowChat();
  const [input, setInput] = useState('');
  const [autoFixRunning, setAutoFixRunning] = useState(false);
  const [autoFixIteration, setAutoFixIteration] = useState(0);
  const autoFixMaxIterations = 3;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setCanvasContext(canvasContext || null, executionContext || null, rawDefinition || null);
  }, [canvasContext, executionContext, rawDefinition, setCanvasContext]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Auto-apply patches from latest message
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role === 'assistant' && last.patches && onWorkflowPatch) {
      onWorkflowPatch(last.patches);
    }
  }, [messages, onWorkflowPatch]);

  const handleSend = async (overrideMsg?: string) => {
    const msg = (overrideMsg || input).trim();
    if (!msg || isGenerating) return;
    if (!overrideMsg) setInput('');
    const result = await sendMessage(msg);
    if (result && onWorkflowGenerated) onWorkflowGenerated(result);
  };

  const hasCanvas = canvasContext && canvasContext.nodes.length > 0;
  const hasFailedExec = executionContext?.status === 'failed';

  const suggestions = hasCanvas
    ? [
        { label: 'Explain this flow', icon: <Eye className="w-3 h-3" />, msg: 'What does this workflow do? Explain each node and how data flows between them.' },
        { label: 'Optimize', icon: <Zap className="w-3 h-3" />, msg: 'Analyze this workflow and suggest optimizations.' },
        ...(hasFailedExec ? [{ label: 'Fix errors', icon: <AlertCircle className="w-3 h-3" />, msg: 'The last execution failed. Analyze the errors and suggest fixes.' }] : []),
      ]
    : [
        { label: 'Research pipeline', icon: <Sparkles className="w-3 h-3" />, msg: 'Research a topic using web search, analyze findings, and produce a summary report' },
        { label: 'Code review', icon: <Sparkles className="w-3 h-3" />, msg: 'Build a multi-agent code review pipeline with security scanning' },
        { label: 'Data pipeline', icon: <Sparkles className="w-3 h-3" />, msg: 'Create a scheduled data pipeline that queries, transforms, and alerts on anomalies' },
      ];

  return (
    <div className="wf-ai-assistant" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Messages */}
      <div className="wf-ai-messages wf-scrollbar">
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: 24 }}>
            <Brain style={{ width: 40, height: 40, opacity: 0.3, color: 'var(--wf-ep-text-secondary)', marginBottom: 12 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--wf-ep-text)', marginBottom: 4 }}>AI Flow Builder</div>
            <div style={{ fontSize: 11, color: 'var(--wf-ep-text-muted)', lineHeight: 1.6 }}>
              Describe what you want to automate and I'll<br />generate a workflow for you.
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`wf-ai-msg ${msg.role === 'user' ? 'user' : ''}`}>
            <div className={`wf-ai-avatar ${msg.role === 'user' ? 'human' : 'bot'}`}>
              {msg.role === 'user' ? '👤' : '✨'}
            </div>
            <div className={`wf-ai-bubble ${msg.role === 'user' ? '' : ''}`}>
              {msg.role === 'user' ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
              ) : (
                <div className="wf-ai-md-content" style={{ fontSize: 12, lineHeight: 1.6 }}>
                  <SharedMarkdownRenderer
                    content={msg.content.replace(/```(?:workflow|patch)[\s\S]*?```/g, '').trim() || msg.content}
                    theme="dark"
                    isStreaming={false}
                  />
                </div>
              )}
              {msg.workflowDefinition && onWorkflowGenerated && (
                <button
                  className="wf-ai-action"
                  onClick={() => onWorkflowGenerated(msg.workflowDefinition!)}
                >
                  <Sparkles className="w-3 h-3" />
                  Apply to Canvas ({msg.workflowDefinition.nodes.length} nodes)
                </button>
              )}
              {msg.patches && msg.patches.length > 0 && onWorkflowPatch && (
                <button
                  className="wf-ai-action"
                  onClick={() => onWorkflowPatch(msg.patches!)}
                  style={{ color: '#d29922', background: 'rgba(210,153,34,0.1)', borderColor: 'rgba(210,153,34,0.2)' }}
                >
                  <Zap className="w-3 h-3" />
                  Apply Patch ({msg.patches.length} node{msg.patches.length > 1 ? 's' : ''})
                </button>
              )}
            </div>
          </div>
        ))}

        {isGenerating && (
          <div className="wf-ai-msg">
            <div className="wf-ai-avatar bot">✨</div>
            <div className="wf-ai-bubble" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Loader2 className="w-3.5 h-3.5" style={{ color: '#bc8cff', animation: 'wf-spin 0.6s linear infinite' }} />
              <span style={{ fontSize: 11, color: '#8b949e' }}>Generating...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion chips */}
      <div className="wf-ai-suggestions" style={{ padding: '0 12px', marginBottom: messages.length === 0 ? 0 : undefined }}>
        {suggestions.map((s, i) => (
          <button key={i} className="wf-ai-suggestion" onClick={() => handleSend(s.msg)} disabled={isGenerating}>
            {s.icon} {s.label}
          </button>
        ))}
        {messages.length > 0 && (
          <button className="wf-ai-suggestion" onClick={clearMessages} style={{ borderColor: 'rgba(248,81,73,0.2)', color: '#f85149' }}>
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {/* Auto-Fix button */}
      {hasFailedExec && !autoFixRunning && (
        <div style={{ padding: '0 12px', marginBottom: 8 }}>
          <button
            onClick={async () => {
              setAutoFixRunning(true);
              setAutoFixIteration(1);
              const failedNodes = executionContext?.nodeResults
                ? Object.entries(executionContext.nodeResults)
                    .filter(([_, r]) => r.status === 'failed')
                    .map(([id, r]) => `- Node "${id}": ${r.error || 'unknown error'}`)
                    .join('\n')
                : 'Unknown failures';

              const fixPrompt = `The workflow execution FAILED. Here are the errors:\n\n${failedNodes}\n\nAnalyze each error and generate a \`\`\`patch block to fix all issues. Focus on:\n1. Missing or incorrect configuration\n2. Wrong variable references\n3. Connection/auth issues that need config changes\n\nAfter generating the patch, explain what you fixed and why.`;

              await handleSend(fixPrompt);
              setAutoFixRunning(false);
            }}
            disabled={isGenerating}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              border: 'none', borderRadius: 8, color: '#fff', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', width: '100%', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(245,158,11,0.3)',
              opacity: isGenerating ? 0.5 : 1,
            }}
          >
            <Zap className="w-4 h-4" />
            Auto-Fix Failed Nodes ({Object.entries(executionContext?.nodeResults || {}).filter(([_, r]) => r.status === 'failed').length} errors)
          </button>
        </div>
      )}
      {autoFixRunning && (
        <div style={{ padding: '0 12px', marginBottom: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
            borderRadius: 8, fontSize: 12, color: '#f59e0b',
          }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            Auto-fixing... (iteration {autoFixIteration}/{autoFixMaxIterations})
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="wf-ai-input-area">
        <div className="wf-ai-input-wrapper">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Describe your workflow..."
            rows={1}
            className="wf-ai-input"
          />
          {isGenerating ? (
            <button className="wf-ai-send-btn" onClick={stopGeneration} style={{ background: 'rgba(248,81,73,0.8)' }}>
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              className="wf-ai-send-btn"
              onClick={() => handleSend()}
              disabled={!input.trim()}
              style={{ opacity: input.trim() ? 1 : 0.4 }}
            >
              <Send className="w-4 h-4" style={{ marginLeft: 1 }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Run Detail View (double-click from history) ────────────────────────

const NODE_CATEGORY_LABELS: Record<string, string> = {
  trigger: 'Trigger', mcp_tool: 'Data Collection', http_request: 'Data Collection',
  merge: 'Data Processing', transform: 'Data Processing',
  openagentic_llm: 'LLM Analysis', llm_completion: 'LLM Analysis', multi_agent: 'LLM Analysis',
  agent_single: 'Agent Execution', agent_pool: 'Agent Execution', agent_supervisor: 'Agent Execution',
  code: 'Code Execution', openagentic: 'Code Execution',
  condition: 'Logic', loop: 'Logic', wait: 'Logic',
  approval: 'Approval', human_approval: 'Approval',
};

function getNodeCategoryIcon(nodeType: string): string {
  const map: Record<string, string> = {
    trigger: '\u26A1', mcp_tool: '\uD83D\uDD27', http_request: '\uD83C\uDF10', merge: '\u26D9',
    transform: '\uD83D\uDD04', openagentic_llm: '\u2728', llm_completion: '\uD83E\uDDE0',
    code: '\uD83D\uDCBB', openagentic: '\uD83D\uDC0D', condition: '\uD83D\uDD00',
    agent_single: '\uD83E\uDD16', multi_agent: '\uD83C\uDFAF',
  };
  return map[nodeType] || '\u25CF';
}

const RunDetailView: React.FC<{
  execution: WorkflowExecution;
  runIndex: number;
  onBack: () => void;
  onLoadExecution?: (id: string) => void;
}> = ({ execution, runIndex, onBack, onLoadExecution }) => {
  const nodeOutputs = execution.node_outputs || {};
  const entries = Object.entries(nodeOutputs);
  const dur = execution.execution_time_ms
    || (execution.completed_at && execution.created_at
      ? new Date(execution.completed_at).getTime() - new Date(execution.created_at).getTime() : undefined);
  const completedCount = entries.filter(([, n]) => (n as any).status === 'completed' || (n as any).status === 'success').length;
  const failedCount = entries.filter(([, n]) => (n as any).status === 'failed' || (n as any).status === 'error').length;

  // Group nodes by category
  const groups: Record<string, Array<[string, any]>> = {};
  for (const [nodeId, nodeData] of entries) {
    const nt = (nodeData as any).nodeType || 'unknown';
    const cat = NODE_CATEGORY_LABELS[nt] || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push([nodeId, nodeData]);
  }

  const handleExport = (format: 'json' | 'markdown') => {
    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === 'json') {
      content = JSON.stringify({ execution_id: execution.id, status: execution.status, duration_ms: dur, node_outputs: nodeOutputs }, null, 2);
      filename = `execution-${execution.id.slice(0, 8)}.json`;
      mimeType = 'application/json';
    } else {
      const lines = [`# Execution Report: Run #${runIndex}`, `**Status:** ${execution.status}`, `**Duration:** ${fmt(dur)}`, `**Nodes:** ${entries.length} (${completedCount} completed, ${failedCount} failed)`, ''];
      for (const [cat, nodes] of Object.entries(groups)) {
        lines.push(`## ${cat}`, '');
        for (const [nodeId, nd] of nodes) {
          const output = nd.output;
          const outputStr = typeof output === 'string' ? output : output?.content ? String(output.content) : JSON.stringify(output, null, 2);
          lines.push(`### ${nodeId} (${nd.nodeType})`, `- **Status:** ${nd.status}`, `- **Duration:** ${fmt(nd.duration)}`, '', '```', (outputStr || 'No output').slice(0, 2000), '```', '');
        }
      }
      content = lines.join('\n');
      filename = `execution-${execution.id.slice(0, 8)}.md`;
      mimeType = 'text/markdown';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', background: 'var(--wf-ep-bg)', borderBottom: '1px solid var(--wf-ep-border)' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#58a6ff', fontSize: 11, cursor: 'pointer', padding: 0, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ChevronRight style={{ width: 12, height: 12, transform: 'rotate(180deg)' }} /> Back to History
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span className="wf-run-status-dot" style={{ backgroundColor: SC[execution.status] || '#8b949e', width: 10, height: 10 }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--wf-ep-text-bright)' }}>Run #{runIndex}</span>
          <span style={{ fontSize: 10, color: 'var(--wf-ep-text-secondary)', fontFamily: 'monospace' }}>{execution.id.slice(0, 12)}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {[
            { val: `${completedCount}/${entries.length}`, lbl: 'Nodes', color: failedCount > 0 ? '#d29922' : '#2ea043' },
            { val: fmt(dur), lbl: 'Duration', color: 'var(--wf-ep-text-bright)' },
            { val: `${entries.reduce((sum, [, n]) => sum + ((n as any).tokens || 0), 0).toLocaleString() || '--'}`, lbl: 'Tokens', color: 'var(--wf-ep-text-bright)' },
            { val: execution.cost != null ? `$${execution.cost.toFixed(2)}` : '--', lbl: 'Cost', color: 'var(--wf-ep-text-bright)' },
          ].map((s, i) => (
            <div key={i} style={{ background: 'var(--wf-ep-bg-surface)', borderRadius: 8, padding: '6px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 8, color: 'var(--wf-ep-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{s.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Node cards grouped by category */}
      <div className="wf-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {Object.entries(groups).map(([category, nodes]) => (
          <div key={category} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--wf-ep-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              {category}
              <div style={{ flex: 1, height: 1, background: 'var(--wf-ep-bg-surface)' }} />
            </div>
            {nodes.map(([nodeId, nd]) => {
              const nt = nd.nodeType || 'unknown';
              const icon = getNodeCategoryIcon(nt);
              const color = nColor(nt);
              const output = nd.output;
              const outputStr = typeof output === 'string' ? output
                : output?.content ? String(output.content)
                : output ? JSON.stringify(output, null, 2) : null;

              return (
                <div key={nodeId} style={{ background: 'var(--wf-ep-bg-card)', border: '1px solid var(--wf-ep-border)', borderRadius: 10, padding: '10px 12px', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 7, background: `${color}22`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--wf-ep-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nodeId}</div>
                      <div style={{ fontSize: 9, color: 'var(--wf-ep-text-secondary)' }}>{nt}{nd.model ? ` \u00B7 ${nd.model}` : ''}{nd.tokens ? ` \u00B7 ${nd.tokens} tokens` : ''}{nd.cost ? ` \u00B7 $${nd.cost.toFixed(4)}` : ''}</div>
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase',
                      background: nd.status === 'completed' || nd.status === 'success' ? 'rgba(46,160,67,0.12)' : nd.status === 'failed' || nd.status === 'error' ? 'rgba(248,81,73,0.12)' : 'rgba(139,148,158,0.12)',
                      color: nd.status === 'completed' || nd.status === 'success' ? '#2ea043' : nd.status === 'failed' || nd.status === 'error' ? '#f85149' : '#8b949e',
                    }}>{fmt(nd.duration)}</span>
                  </div>
                  {nd.error && (
                    <div style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)', borderRadius: 6, padding: '6px 8px', fontSize: 11, color: '#f85149', marginBottom: 6, fontFamily: 'monospace' }}>
                      {nd.error.slice(0, 200)}
                    </div>
                  )}
                  {outputStr && (
                    <div style={{ background: 'var(--wf-ep-bg-code)', border: '1px solid var(--wf-ep-border)', borderRadius: 6, padding: '6px 8px', fontSize: 10, fontFamily: "'SF Mono', Monaco, monospace", color: 'var(--wf-ep-text-secondary)', maxHeight: 100, overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                      {outputStr.slice(0, 800)}{outputStr.length > 800 ? '...' : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Export toolbar */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--wf-ep-border)', background: 'var(--wf-ep-bg)', flexWrap: 'wrap' }}>
        <button onClick={() => handleExport('json')} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: 'rgba(88,166,255,0.1)', border: '1px solid rgba(88,166,255,0.25)', color: '#58a6ff', display: 'flex', alignItems: 'center', gap: 4 }}>
          {'{ }'} JSON
        </button>
        <button onClick={() => handleExport('markdown')} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: 'rgba(46,160,67,0.1)', border: '1px solid rgba(46,160,67,0.25)', color: '#2ea043', display: 'flex', alignItems: 'center', gap: 4 }}>
          MD Export
        </button>
        {onLoadExecution && (
          <button onClick={() => onLoadExecution(execution.id)} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', background: 'rgba(188,140,255,0.1)', border: '1px solid rgba(188,140,255,0.25)', color: '#bc8cff', display: 'flex', alignItems: 'center', gap: 4 }}>
            Load on Canvas
          </button>
        )}
        <div style={{ flex: 1 }} />
      </div>
    </div>
  );
};

// ── Tab 4: History ───────────────────────────────────────────────────────

const HistoryTab: React.FC<{
  workflowId: string | null;
  currentExecutionId?: string;
  onLoadExecution?: (id: string) => void;
}> = ({ workflowId, currentExecutionId, onLoadExecution }) => {
  const { getAuthHeaders } = useAuth();
  const [execs, setExecs] = useState<WorkflowExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailExec, setDetailExec] = useState<WorkflowExecution | null>(null);
  const [detailIndex, setDetailIndex] = useState(0);
  const api = useMemo(() => new WorkflowApiService(getAuthHeaders), [getAuthHeaders]);

  useEffect(() => {
    if (!workflowId) return;
    let cancel = false;
    setLoading(true); setError(null);
    api.getExecutions(workflowId)
      .then(d => { if (!cancel) setExecs(d || []); })
      .catch(e => { if (!cancel) setError(e.message || 'Failed to load'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [api, workflowId]);

  // Show detail view if selected
  if (detailExec) {
    return (
      <RunDetailView
        execution={detailExec}
        runIndex={detailIndex}
        onBack={() => setDetailExec(null)}
        onLoadExecution={onLoadExecution}
      />
    );
  }

  if (!workflowId) return (
    <div className="wf-exec-empty">
      <Clock className="wf-exec-empty-icon" />
      <div className="wf-exec-empty-text">Save workflow to view execution history</div>
    </div>
  );
  if (loading) return (
    <div className="wf-exec-empty">
      <div className="wf-exec-spinner" style={{ width: 16, height: 16, marginBottom: 12 }} />
      <div className="wf-exec-empty-text">Loading history...</div>
    </div>
  );
  if (error) return (
    <div className="wf-exec-empty">
      <AlertCircle className="wf-exec-empty-icon" style={{ color: '#f85149', opacity: 0.6 }} />
      <div className="wf-exec-empty-text" style={{ color: '#f85149' }}>{error}</div>
    </div>
  );
  if (!execs.length) return (
    <div className="wf-exec-empty">
      <Clock className="wf-exec-empty-icon" />
      <div className="wf-exec-empty-text">No executions yet. Run this workflow to see history.</div>
    </div>
  );

  return (
    <div className="wf-exec-content wf-scrollbar" style={{ overflowY: 'auto', padding: '8px 0' }}>
      <div style={{ padding: '0 12px 6px', fontSize: 10, color: '#6e7681' }}>Click to load on canvas. Double-click for detailed report.</div>
      {execs.map((ex, idx) => {
        const nodeOutputs = (ex as any).node_outputs || {};
        const nodeEntries = Object.entries(nodeOutputs);
        const dur = (ex as any).execution_time_ms
          || (ex.completed_at && ex.created_at
            ? new Date(ex.completed_at).getTime() - new Date(ex.created_at).getTime() : undefined);
        const active = ex.id === currentExecutionId;
        return (
          <div key={ex.id}
            className={`wf-history-item ${active ? 'active' : ''}`}
            onClick={() => onLoadExecution?.(ex.id)}
            onDoubleClick={(e) => { e.stopPropagation(); setDetailExec(ex); setDetailIndex(execs.length - idx); }}>
            <span className="wf-run-status-dot" style={{ backgroundColor: SC[ex.status] || '#8b949e' }} />
            <div className="wf-history-info">
              <div className="wf-history-trigger">
                Run #{execs.length - idx}
                <span style={{ fontWeight: 400, color: '#6e7681', marginLeft: 8, fontSize: 10 }}>
                  {(ex as any).trigger_type || 'manual'}
                </span>
              </div>
              <div className="wf-history-meta">
                {ago((ex as any).started_at || ex.created_at)}
                {dur != null && <> &middot; {fmt(dur)}</>}
                {nodeEntries.length > 0 && <> &middot; {nodeEntries.length} nodes</>}
              </div>
              {nodeEntries.length > 0 && (
                <div className="wf-health-bar">
                  {nodeEntries.slice(0, 20).map(([nid, ne]: [string, any], i: number) => (
                    <span key={i} className="wf-health-dot"
                      title={`${nid} (${ne.status || 'unknown'})`}
                      style={{ backgroundColor: SC[ne.status] || SC[ne.status === 'failed_with_fallback' ? 'completed' : 'pending'] || '#8b949e' }} />
                  ))}
                  {nodeEntries.length > 20 && <span style={{ fontSize: 9, color: '#6e7681', marginLeft: 2 }}>+{nodeEntries.length - 20}</span>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); onLoadExecution?.(ex.id); }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors"
                style={{ color: '#8b949e', background: 'rgba(255,255,255,0.04)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                title="Load this execution on canvas"
              >
                <Eye className="w-3 h-3" />
                View
              </button>
              <span className={`wf-status-pill ${ex.status}`}>{ex.status.replace(/_/g, ' ')}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Tab 5: Code / API Snippets ──────────────────────────────────────────

const SNIPPET_LABELS: Record<SnippetLang, string> = {
  curl: 'cURL',
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  mcp_tool: 'MCP Tool',
};

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback: ignore */ }
  };
  return (
    <button
      onClick={handleCopy}
      style={{
        background: copied ? 'rgba(46,160,67,0.15)' : 'rgba(88,166,255,0.1)',
        border: `1px solid ${copied ? 'rgba(46,160,67,0.3)' : 'rgba(88,166,255,0.2)'}`,
        borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 600,
        color: copied ? '#2ea043' : '#58a6ff', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.2s',
      }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

const CodeTab: React.FC<{ workflowId: string | null; workflowName: string }> = ({ workflowId, workflowName }) => {
  const { getAuthHeaders } = useAuth();
  const [snippets, setSnippets] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLang, setActiveLang] = useState<SnippetLang>('curl');

  useEffect(() => {
    if (!workflowId) return;
    let cancel = false;
    setLoading(true);
    setError(null);

    const headers = getAuthHeaders();
    fetch(`/api/workflows/${workflowId}/snippets`, { headers })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (!cancel) setSnippets(data.snippets || null);
      })
      .catch(e => {
        if (!cancel) setError(e.message || 'Failed to load snippets');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });

    return () => { cancel = true; };
  }, [workflowId, getAuthHeaders]);

  if (!workflowId) return (
    <div className="wf-exec-empty">
      <Code className="wf-exec-empty-icon" />
      <div className="wf-exec-empty-text">Save workflow to generate API snippets</div>
    </div>
  );

  if (loading) return (
    <div className="wf-exec-empty">
      <div className="wf-exec-spinner" style={{ width: 16, height: 16, marginBottom: 12 }} />
      <div className="wf-exec-empty-text">Generating snippets...</div>
    </div>
  );

  if (error) return (
    <div className="wf-exec-empty">
      <AlertCircle className="wf-exec-empty-icon" style={{ color: '#f85149', opacity: 0.6 }} />
      <div className="wf-exec-empty-text" style={{ color: '#f85149' }}>{error}</div>
    </div>
  );

  if (!snippets) return (
    <div className="wf-exec-empty">
      <Code className="wf-exec-empty-icon" />
      <div className="wf-exec-empty-text">No snippets available</div>
    </div>
  );

  const currentSnippet = snippets[activeLang] || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--wf-ep-border)', background: 'var(--wf-ep-bg)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--wf-ep-text-bright)', marginBottom: 4 }}>
          API Integration
        </div>
        <div style={{ fontSize: 11, color: 'var(--wf-ep-text-secondary)', lineHeight: 1.5 }}>
          Call <strong style={{ color: 'var(--wf-ep-text)' }}>{workflowName}</strong> from your code or tools.
        </div>
      </div>

      {/* Language tabs */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid var(--wf-ep-border)',
        background: 'var(--wf-ep-bg)', padding: '0 12px', overflowX: 'auto',
      }}>
        {(Object.keys(SNIPPET_LABELS) as SnippetLang[]).map(lang => (
          <button
            key={lang}
            onClick={() => setActiveLang(lang)}
            style={{
              background: 'none', border: 'none', borderBottom: activeLang === lang ? '2px solid #58a6ff' : '2px solid transparent',
              padding: '8px 12px', fontSize: 11, fontWeight: activeLang === lang ? 700 : 500,
              color: activeLang === lang ? '#58a6ff' : 'var(--wf-ep-text-secondary)',
              cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
            }}
          >
            {SNIPPET_LABELS[lang]}
          </button>
        ))}
      </div>

      {/* Snippet display */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        <div style={{
          display: 'flex', justifyContent: 'flex-end', marginBottom: 8,
        }}>
          <CopyButton text={currentSnippet} />
        </div>
        <pre style={{
          background: 'var(--wf-ep-bg-code, #161b22)',
          border: '1px solid var(--wf-ep-border)',
          borderRadius: 8,
          padding: '14px 16px',
          fontSize: 11,
          fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
          color: '#c9d1d9',
          lineHeight: 1.6,
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
        }}>
          {currentSnippet}
        </pre>
      </div>

      {/* Footer hint */}
      <div style={{
        padding: '8px 16px', borderTop: '1px solid var(--wf-ep-border)',
        background: 'var(--wf-ep-bg)', fontSize: 10, color: 'var(--wf-ep-text-muted)',
        lineHeight: 1.5,
      }}>
        Replace <code style={{ background: 'rgba(88,166,255,0.1)', padding: '1px 4px', borderRadius: 3, color: '#58a6ff' }}>YOUR_API_KEY</code> with
        a key from Settings &rarr; API Keys.
      </div>
    </div>
  );
};

// ── Main Component ───────────────────────────────────────────────────────

export const ExecutionResultsPanel: React.FC<ExecutionResultsPanelProps> = (props) => {
  const {
    executionData, isExecuting, selectedNodeId, nodes,
    workflowId, workflowName, aiAssistantContent,
    canvasContext, executionContext,
    onNodeSelect, onLoadExecution, onRerun,
    onWorkflowGenerated, onWorkflowPatch,
    defaultTab,
  } = props;
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab || 'output');
  useEffect(() => { if (isExecuting) setActiveTab('timeline'); }, [isExecuting]);
  useEffect(() => { if (selectedNodeId) setActiveTab('output'); }, [selectedNodeId]);
  useEffect(() => { if (defaultTab) setActiveTab(defaultTab); }, [defaultTab]);

  // Auto-switch to output tab when execution completes to show results
  const prevStatus = useRef(executionData?.status);
  useEffect(() => {
    if (prevStatus.current === 'running' && executionData?.status && executionData.status !== 'running') {
      // Execution just finished — switch to output tab to show the final result
      setActiveTab('output');
    }
    prevStatus.current = executionData?.status;
  }, [executionData?.status]);

  // "Fix with AI" handler — switches to AI tab with error context
  const handleFixWithAI = useCallback((nodeId: string, error: string) => {
    setActiveTab('assistant');
  }, []);

  const nodeCount = executionData?.nodeExecutions?.length || 0;
  const failCount = executionData?.nodeExecutions?.filter(n => n.status === 'failed').length || 0;

  const tabs: { id: TabId; label: string; badge?: number; badgeError?: boolean }[] = [
    { id: 'output', label: 'Output' },
    { id: 'timeline', label: 'Timeline', badge: nodeCount || undefined, badgeError: failCount > 0 },
    { id: 'assistant', label: 'AI' },
    { id: 'history', label: 'History' },
    { id: 'code', label: 'API' },
  ];

  return (
    <div className="wf-exec-panel" style={props.style}>
      {/* Tab bar */}
      <div className="wf-exec-tabs">
        {tabs.map(tab => (
          <button key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`wf-exec-tab ${activeTab === tab.id ? 'active' : ''}`}>
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span className={`wf-tab-count ${tab.badgeError ? 'error' : ''}`}>{tab.badge}</span>
            )}
          </button>
        ))}
        {props.onClose && (
          <button onClick={props.onClose} className="wf-exec-close-btn" title="Close panel">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Tab content */}
      {activeTab === 'output' && <OutputTab selectedNodeId={selectedNodeId} nodes={nodes} executionData={executionData} onFixWithAI={handleFixWithAI} />}
      {activeTab === 'timeline' && <TimelineTab executionData={executionData} isExecuting={isExecuting} onNodeSelect={onNodeSelect} onRerun={onRerun} />}
      {activeTab === 'assistant' && (
        <AssistantTab
          content={aiAssistantContent}
          canvasContext={canvasContext}
          executionContext={executionContext}
          rawDefinition={props.rawDefinition}
          onWorkflowGenerated={onWorkflowGenerated}
          onWorkflowPatch={onWorkflowPatch}
        />
      )}
      {activeTab === 'history' && <HistoryTab workflowId={workflowId} currentExecutionId={executionData?.executionId} onLoadExecution={onLoadExecution} />}
      {activeTab === 'code' && <CodeTab workflowId={workflowId} workflowName={workflowName} />}
    </div>
  );
};

export default ExecutionResultsPanel;
