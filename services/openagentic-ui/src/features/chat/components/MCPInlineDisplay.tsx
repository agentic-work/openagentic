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
 * Clean MCP Function Request/Reply Display
 * Inspired by Claude Desktop's inline MCP visualization
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Zap, ChevronRight, CheckCircle, XCircle, Loader2, 
  Copy, Check, Terminal, FileJson, Clock
} from '@/shared/icons';

interface MCPCall {
  id: string;
  tool?: string;
  toolName?: string;
  functionName?: string;
  function?: {
    name: string;
    arguments: string;
  };
  arguments?: any;
  result?: any;
  response?: any;
  error?: string;
  status?: 'pending' | 'executing' | 'completed' | 'failed';
  duration?: number;
  serverId?: string;
  serverName?: string;
  explanation?: string;
}

interface MCPInlineDisplayProps {
  call: MCPCall;
  isExpanded?: boolean;
  onToggle?: () => void;
}

export const MCPInlineDisplay: React.FC<MCPInlineDisplayProps> = ({
  call,
  isExpanded: externalExpanded,
  onToggle
}) => {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  
  const isExpanded = externalExpanded !== undefined ? externalExpanded : internalExpanded;
  const handleToggle = onToggle || (() => setInternalExpanded(!internalExpanded));

  // Extract tool name from various formats
  const toolName = call.toolName || call.functionName || 
                   call.function?.name || call.tool || 'unknown_tool';
  
  // Get server information
  const serverName = call.serverName || call.serverId || 'Unknown Server';
  
  // Explanation should come from API/model when call is made
  
  // Parse arguments
  let args = call.arguments;
  if (!args && call.function?.arguments) {
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      args = { raw: call.function.arguments };
    }
  }
  
  const result = call.result || call.response;
  const status = call.status || (result ? 'completed' : call.error ? 'failed' : 'executing');

  const copyToClipboard = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(
        typeof text === 'object' ? JSON.stringify(text, null, 2) : text
      );
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'completed': return 'text-green-500';
      case 'failed': return 'text-red-500';
      case 'executing': return 'text-blue-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-3.5 h-3.5" />;
      case 'failed': return <XCircle className="w-3.5 h-3.5" />;
      case 'executing': return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
      default: return <Clock className="w-3.5 h-3.5" />;
    }
  };

  // Format display of arguments/results
  const formatValue = (value: any, maxLength = 100) => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string') {
      return value.length > maxLength ? value.substring(0, maxLength) + '...' : value;
    }
    if (typeof value === 'object') {
      const str = JSON.stringify(value, null, 2);
      return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
    }
    return String(value);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      
      className="glass-subtle rounded-lg my-2 overflow-hidden border"
      style={{ borderColor: 'var(--color-borderHover)' }}
    >
      {/* Function Header - matches expected UI */}
      <div 
      className="px-4 py-3 border-b"
      style={{ borderColor: 'var(--color-borderHover)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span 
            className="inline-flex items-center justify-center w-5 h-5 text-xs font-mono rounded"
            style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-textMuted)' }}>
              F
            </span>
            <span className="text-sm font-medium text-text-primary">
              {toolName}
            </span>
          </div>
          <button
            onClick={handleToggle}
            className="p-1 hover:bg-white/5 rounded transition-colors"
          >
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronRight 
              className="w-4 h-4"
              style={{ color: 'var(--color-textMuted)' }} />
            </motion.div>
          </button>
        </div>
      </div>

      {/* Collapsible Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="divide-y divide-gray-600/20"
          >
            {/* Request Section */}
            {args && (
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-text-secondary">Request</span>
                  <button
                    onClick={() => copyToClipboard(args, 'request')}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                  >
                    {copiedSection === 'request' ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-text-muted" />
                    )}
                  </button>
                </div>
                <pre 
                className="text-sm font-mono rounded p-3 overflow-x-auto"
                style={{ backgroundColor: 'var(--color-background)' }}>
                  <code className="text-text-primary">
                    {typeof args === 'object' ? JSON.stringify(args, null, 2) : args}
                  </code>
                </pre>
              </div>
            )}

            {/* Response Section */}
            {(result || call.error) && (
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-text-secondary">
                    {call.error ? 'Error' : 'Response'}
                  </span>
                  <button
                    onClick={() => copyToClipboard(result || call.error || '', 'response')}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                  >
                    {copiedSection === 'response' ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-text-muted" />
                    )}
                  </button>
                </div>
                <pre className={`text-sm font-mono rounded p-3 overflow-x-auto ${
                  call.error ? 'bg-red-500/10' : 'bg-gray-900/50'
                }`}>
                  <code className={call.error ? 'text-red-400' : 'text-text-primary'}>
                    {typeof (result || call.error) === 'object' 
                      ? JSON.stringify(result || call.error, null, 2) 
                      : (result || call.error)}
                  </code>
                </pre>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Explanation - only show if provided by API/model */}
      {call.explanation && (
        <div 
        className="px-4 py-3 border-t"
        style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-borderHover)' }}>
          <div className="flex items-center gap-2">
            <ChevronRight
            className="w-4 h-4"
            style={{ color: 'var(--color-textMuted)', transform: 'rotate(90deg)' }} />
            <span className="text-sm text-text-muted">{call.explanation}</span>
          </div>
        </div>
      )}

      {/* Status indicator for executing calls */}
      {status === 'executing' && !result && !call.error && (
        <div className="px-4 py-3 bg-blue-500/10 border-t border-blue-500/20">
          <div className="flex items-center gap-2 text-sm text-blue-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Executing function...</span>
          </div>
        </div>
      )}
    </motion.div>
  );
};

// Batch display for multiple MCP calls
export const MCPCallsDisplay: React.FC<{ calls: MCPCall[] }> = ({ calls }) => {
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set());

  const toggleCall = (id: string) => {
    setExpandedCalls(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (!calls || calls.length === 0) return null;

  return (
    <div className="space-y-1 my-2">
      {calls.map(call => (
        <MCPInlineDisplay
          key={call.id}
          call={call}
          isExpanded={expandedCalls.has(call.id)}
          onToggle={() => toggleCall(call.id)}
        />
      ))}
    </div>
  );
};

export default MCPInlineDisplay;