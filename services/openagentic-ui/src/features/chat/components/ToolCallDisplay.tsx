/**
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 * 

 * For all inquiries, please contact:
 * 
 * Openagentic LLC
 * hello@openagentic.io
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronDown, Wrench, CheckCircle, XCircle, AlertCircle, Terminal, FileText, Loader2, Copy, Check } from '@/shared/icons';
import { ReactFlowDiagram, parseDiagramJson, DiagramDefinition } from '../../../components/diagrams/ReactFlowDiagram';
import { DrawioDiagramViewer, parseDrawioResult } from '../../../components/diagrams/DrawioDiagramViewer';

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface ToolCallDisplayProps {
  toolCalls?: ToolCall[];
  toolResults?: any[];
  theme: 'light' | 'dark';
  status?: 'pending' | 'executing' | 'completed' | 'error';
}

const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({ toolCalls, toolResults, theme, status = 'pending' }) => {
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  if (!toolCalls || toolCalls.length === 0) return null;
  
  const toggleExpanded = (id: string) => {
    const newExpanded = new Set(expandedCalls);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedCalls(newExpanded);
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  const bgColor = 'bg-bg-secondary';
  const borderColor = 'border-border-primary';
  const textColor = 'text-text-secondary';
  const codeBlockBg = 'bg-bg-primary';
  const headerBg = 'bg-bg-tertiary';
  
  const getStatusIcon = () => {
    switch (status) {
      case 'executing':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
    }
  };
  
  return (
    <div className="my-4 space-y-3">
      {toolCalls.map((toolCall, index) => {
        const isExpanded = expandedCalls.has(toolCall.id);
        const result = toolResults?.[index];
        let parsedArgs;
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          parsedArgs = toolCall.function.arguments;
        }
        
        return (
          <motion.div
            key={toolCall.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
            className={`${bgColor} ${borderColor} border rounded-lg overflow-hidden shadow-lg`}
          >
            {/* Header */}
            <button
              onClick={() => toggleExpanded(toolCall.id)}
              className={`w-full px-4 py-3 ${headerBg} flex items-center justify-between hover:opacity-90 transition-opacity`}
            >
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <Terminal className="w-4 h-4 text-blue-500" />
                </div>
                <span className={`font-mono text-sm ${textColor}`}>
                  {toolCall.function.name}
                </span>
                {getStatusIcon()}
              </div>
            </button>
            
            {/* Expanded Content */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 space-y-4">
                    {/* Request Section */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                          Request
                        </h4>
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(parsedArgs, null, 2), `${toolCall.id}-req`)}
                          className="p-1 rounded hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-secondary"
                        >
                          {copiedId === `${toolCall.id}-req` ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      <div className={`${codeBlockBg} rounded-md p-3 border ${borderColor}`}>
                        <pre className="text-xs overflow-x-auto">
                          <code className="text-text-secondary font-mono">
                            {JSON.stringify(parsedArgs, null, 2)}
                          </code>
                        </pre>
                      </div>
                    </div>
                    
                    {/* Response Section */}
                    {result !== undefined && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                            Response
                          </h4>
                          {/* Don't show copy button for diagram results */}
                          {!(result?.type === 'diagram' && result?.data) &&
                           !(result?.type === 'drawio_diagram' && result?.xml) && (
                            <button
                              onClick={() => copyToClipboard(JSON.stringify(result, null, 2), `${toolCall.id}-res`)}
                              className="p-1 rounded hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-secondary"
                            >
                              {copiedId === `${toolCall.id}-res` ? (
                                <Check className="w-4 h-4 text-green-500" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </div>
                        {/* Check if this is a diagram result from create_diagram tool */}
                        {result?.type === 'diagram' && result?.data ? (
                          <div className="rounded-lg overflow-hidden">
                            <ReactFlowDiagram
                              diagram={result.data as DiagramDefinition}
                              height={450}
                              interactive={true}
                              showControls={true}
                              showMiniMap={false}
                            />
                          </div>
                        ) : result?.type === 'drawio_diagram' && result?.xml ? (
                          /* Draw.io diagram from oap-drawio-mcp */
                          <div className="rounded-lg overflow-hidden">
                            <DrawioDiagramViewer
                              xml={result.xml}
                              title={result.metadata?.diagram_type || 'Diagram'}
                              height={450}
                              showControls={true}
                            />
                          </div>
                        ) : (
                          <div className={`${codeBlockBg} rounded-md p-3 border ${borderColor}`}>
                            <pre className="text-xs overflow-x-auto">
                              <code className="text-text-secondary font-mono">
                                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                              </code>
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Running state */}
                    {status === 'executing' && !result && (
                      <div className={`${codeBlockBg} rounded-md p-3 border ${borderColor} flex items-center justify-center`}>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        <span className="text-sm">Running...</span>
                      </div>
                    )}
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

export default ToolCallDisplay;
