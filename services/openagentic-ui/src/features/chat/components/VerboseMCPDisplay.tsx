/**
 * Enhanced MCP Tool Call Display - Shows detailed execution information
 *
 * For all inquiries, please contact:
 * Openagentic LLC
 * hello@openagentic.io
 */

import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, Clock, CheckCircle, XCircle,
  Loader2, AlertTriangle, Copy, Server, Wrench, Eye
} from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '../../../components/diagrams/ReactFlowDiagram';

interface MCPToolCall {
  id: string;
  tool?: string;
  toolName?: string;
  function?: {
    name: string;
    arguments: string | object;
  };
  arguments?: any;
  result?: any;
  response?: any;
  error?: string;
  status?: 'pending' | 'executing' | 'completed' | 'failed';
  startTime?: number;
  endTime?: number;
  duration?: number;
  serverId?: string;
  serverName?: string;
  metadata?: any;
}

interface VerboseMCPDisplayProps {
  toolCall: MCPToolCall;
  isStreaming?: boolean;
  onRetry?: () => void;
}

export const VerboseMCPDisplay: React.FC<VerboseMCPDisplayProps> = ({
  toolCall,
  isStreaming = false,
  onRetry
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  // Extract tool information from different formats
  const toolName = toolCall.tool || toolCall.toolName || toolCall.function?.name || 'unknown_tool';
  const serverId = toolCall.serverId || 'unknown_server';
  const serverName = toolCall.serverName || serverId;

  // Parse arguments safely
  let parsedArgs = toolCall.arguments;
  if (!parsedArgs && toolCall.function?.arguments) {
    try {
      parsedArgs = typeof toolCall.function.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    } catch (e) {
      parsedArgs = { raw: toolCall.function.arguments };
    }
  }
  parsedArgs = parsedArgs || {};

  // Get result - support multiple formats for stored MCP calls
  const result = toolCall.result || toolCall.response || (toolCall as any).content || (toolCall as any).output;
  const error = toolCall.error;

  // Extract executed_as user info from result (for cloud MCP calls like Azure)
  const executedAs = result?.executed_as || (toolCall as any).executed_as;

  // Determine status
  const status = toolCall.status || (
    error ? 'failed' :
    result ? 'completed' :
    isStreaming ? 'executing' : 'pending'
  );

  // Calculate duration
  const duration = toolCall.duration || (
    toolCall.startTime && toolCall.endTime
      ? toolCall.endTime - toolCall.startTime
      : null
  );

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'executing':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'pending': return 'border-yellow-500/30 bg-yellow-500/5';
      case 'executing': return 'border-blue-500/30 bg-blue-500/5';
      case 'completed': return 'border-green-500/30 bg-green-500/5';
      case 'failed': return 'border-red-500/30 bg-red-500/5';
      default: return 'border-gray-500/30 bg-gray-500/5';
    }
  };

  const copyToClipboard = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const formatJson = (obj: any) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  // Check if result contains diagram data
  const isDiagramResult = (res: any): res is { type: 'diagram'; data: DiagramDefinition } => {
    if (!res) return false;
    if (res.type === 'diagram' && res.data) return true;
    if (res.nodes && Array.isArray(res.nodes) && res.edges && Array.isArray(res.edges)) return true;
    if (res.diagram && res.diagram.nodes && res.diagram.edges) return true;
    return false;
  };

  // Extract diagram data from various result formats
  const extractDiagramData = (res: any): DiagramDefinition | null => {
    if (!res) return null;
    if (res.type === 'diagram' && res.data) return res.data as DiagramDefinition;
    if (res.nodes && Array.isArray(res.nodes)) return res as DiagramDefinition;
    if (res.diagram && res.diagram.nodes) return res.diagram as DiagramDefinition;
    return null;
  };

  return (
    <div className={`
      my-3 rounded-lg border-2 overflow-hidden transition-all duration-150
      ${getStatusColor()}
      shadow-md dark:shadow-lg
    `}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left transition-colors duration-150 hover:bg-gray-100/50 dark:hover:bg-gray-800/30 text-gray-800 dark:text-gray-200"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 flex-shrink-0 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 flex-shrink-0 text-gray-500" />
        )}

        <Wrench className="w-5 h-5 text-blue-500 flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono font-bold text-lg truncate">{toolName}</span>
            {getStatusIcon()}
            <span className={`text-sm font-medium ${
              status === 'completed' ? 'text-green-600' :
              status === 'failed' ? 'text-red-600' :
              status === 'executing' ? 'text-blue-600' :
              'text-yellow-600'
            }`}>
              {status.toUpperCase()}
            </span>
            {duration && (
              <span className="text-xs px-2 py-1 rounded text-gray-500 bg-gray-100 dark:bg-gray-800">
                {formatDuration(duration)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Server className="w-3 h-3" />
            <span className="font-mono">{serverId}</span>
            {serverName !== serverId && (
              <span className="text-xs">({serverName})</span>
            )}
          </div>

          {/* Cloud MCP User Badge - Shows who the operation was executed as */}
          {executedAs && executedAs.upn && (
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="font-semibold">Executed as:</span>
                <span className="font-mono">{executedAs.name || executedAs.upn}</span>
              </span>
            </div>
          )}
        </div>

        {status === 'failed' && onRetry && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors duration-150"
          >
            Retry
          </button>
        )}
      </button>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-gray-200/50 dark:border-gray-700/50">

              {/* Tool Call Information */}
              <div className="grid grid-cols-2 gap-4 text-sm pt-4">
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">Tool ID:</span>
                  <span className="ml-2 font-mono text-xs">{toolCall.id}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">Server:</span>
                  <span className="ml-2 font-mono text-xs">{serverId}</span>
                </div>
              </div>

              {/* Arguments Section */}
              {parsedArgs && Object.keys(parsedArgs).length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-blue-600 flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      Request Arguments
                    </h4>
                    <button
                      onClick={() => copyToClipboard(formatJson(parsedArgs), 'args')}
                      className="p-1 rounded transition-colors duration-150 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-500"
                      title="Copy arguments"
                    >
                      {copiedSection === 'args' ? (
                        <CheckCircle className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                  <pre className="text-xs font-mono p-3 rounded border overflow-x-auto max-h-32 bg-blue-50 dark:bg-gray-900/80 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-600/20">
                    {formatJson(parsedArgs)}
                  </pre>
                </div>
              )}

              {/* Response Section */}
              {result !== undefined && (status === 'completed' || !isStreaming) && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-green-600 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" />
                      Response {isDiagramResult(result) && <span className="text-xs font-normal">(Diagram)</span>}
                    </h4>
                    <button
                      onClick={() => copyToClipboard(formatJson(result), 'result')}
                      className="p-1 rounded transition-colors duration-150 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-500"
                      title="Copy response"
                    >
                      {copiedSection === 'result' ? (
                        <CheckCircle className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>

                  {isDiagramResult(result) ? (
                    <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                      <ReactFlowDiagram
                        diagram={extractDiagramData(result)!}
                        height={450}
                        interactive={true}
                        showControls={true}
                        showMiniMap={false}
                      />
                    </div>
                  ) : (
                    <pre className="text-xs font-mono p-3 rounded border overflow-x-auto max-h-48 bg-green-50 dark:bg-gray-900/80 text-green-800 dark:text-green-300 border-green-200 dark:border-green-600/20">
                      {formatJson(result)}
                    </pre>
                  )}
                </div>
              )}

              {/* Error Section */}
              {error && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle className="w-4 h-4 text-red-500" />
                    <h4 className="text-sm font-bold text-red-600">
                      Error Details
                    </h4>
                  </div>
                  <div className="text-sm p-3 rounded border font-mono bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/50">
                    {error}
                  </div>
                </div>
              )}

              {/* Executing State */}
              {status === 'executing' && !result && !error && (
                <div className="flex items-center justify-center py-6">
                  <motion.div
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="flex items-center gap-3"
                  >
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                    <span className="text-base font-medium">
                      Executing {toolName} on {serverName}...
                    </span>
                  </motion.div>
                </div>
              )}

              {/* Metadata */}
              {toolCall.metadata && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                    Debug Metadata
                  </summary>
                  <pre className="mt-2 p-2 rounded text-xs overflow-x-auto bg-gray-100 dark:bg-gray-800">
                    {formatJson(toolCall.metadata)}
                  </pre>
                </details>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default VerboseMCPDisplay;
