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
 * Enhanced MCP Display Component
 * Displays Model Context Protocol (MCP) tool calls with formatted arguments and results
 * Features: Tool name display, argument formatting, execution status indicators
 * @see docs/chat/mcp-integration.md
 */

import React from 'react';

interface EnhancedMCPDisplayProps {
  calls?: any[];
  mcpCalls?: any[];
  theme?: string;
}

// Extract meaningful content from MCP response
const extractMCPContent = (result: unknown): string => {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;

  if (typeof result === 'object' && result !== null) {
    const obj = result as Record<string, unknown>;
    // Try content array (standard MCP format)
    if (Array.isArray(obj.content) && obj.content.length > 0) {
      const textContent = obj.content.find((c: any) => c.type === 'text' && c.text);
      if (textContent?.text) return textContent.text;
    }
    // Try structuredContent.result
    if (obj.structuredContent && typeof obj.structuredContent === 'object') {
      const sc = obj.structuredContent as Record<string, unknown>;
      if (typeof sc.result === 'string') return sc.result;
    }
    // Try direct result field
    if (typeof obj.result === 'string') return obj.result;
    // Try text field
    if (typeof obj.text === 'string') return obj.text;
  }
  return JSON.stringify(result, null, 2);
};

const EnhancedMCPDisplay: React.FC<EnhancedMCPDisplayProps> = ({ calls, mcpCalls, theme }) => {
  const actualCalls = calls || mcpCalls || [];
  if (!actualCalls || actualCalls.length === 0) {
    return null;
  }

  // Group and deduplicate tool calls properly
  const processedCalls = actualCalls.reduce((acc: any[], call) => {
    if (!call || typeof call !== 'object') return acc;
    
    const toolName = call.tool || call.name || call.function?.name;
    if (!toolName || toolName === 'tool') return acc; // Skip generic "tool" entries
    
    const existingCall = acc.find(c => c.toolName === toolName);
    if (existingCall) {
      // Update existing call with new info
      if (call.result && !existingCall.result) {
        existingCall.result = call.result;
        existingCall.status = 'completed';
      }
      if (call.args && !existingCall.args) {
        existingCall.args = call.args;
      }
    } else {
      acc.push({
        toolName,
        args: call.args || call.arguments || call.function?.arguments,
        result: call.result,
        status: call.status || (call.result ? 'completed' : 'calling'),
        executionTime: call.executionTime
      });
    }
    return acc;
  }, []);

  if (processedCalls.length === 0) {
    return null;
  }

  return (
    <div className="mcp-display border border-info/30 rounded-lg p-4 my-3 bg-secondary/50">
      <div className="flex items-center gap-2 text-sm font-medium text-info mb-3">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
        </svg>
        MCP Tool Execution
      </div>
      
      {processedCalls.map((call, index) => (
        <div key={`${call.toolName}-${index}`} className="mb-3 last:mb-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-sm font-semibold text-primary">
              {call.toolName}
            </span>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
              call.status === 'completed'
                ? 'bg-success/20 text-success'
                : call.status === 'calling'
                ? 'bg-warning/20 text-warning'
                : 'bg-tertiary text-muted'
            }`}>
              {call.status === 'completed' ? 'Completed' :
               call.status === 'calling' ? 'Running' : 'Unknown'}
            </span>
            {call.executionTime && (
              <span className="text-xs text-muted">
                ({call.executionTime}ms)
              </span>
            )}
          </div>
          
          {call.args && (
            <details className="mb-2">
              <summary className="cursor-pointer text-xs text-secondary hover:text-primary">
                Arguments
              </summary>
              <pre className="text-xs mt-1 p-2 bg-tertiary rounded overflow-x-auto">
                {typeof call.args === 'string' ? call.args : JSON.stringify(call.args, null, 2)}
              </pre>
            </details>
          )}

          {call.result && (
            <details className="p-3 bg-secondary border border-primary rounded">
              <summary className="cursor-pointer text-xs font-medium text-primary hover:text-info">
                View Result
              </summary>
              <pre className="text-xs mt-2 p-2 bg-tertiary rounded overflow-x-auto whitespace-pre-wrap">
                {extractMCPContent(call.result)}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
};

export default EnhancedMCPDisplay;