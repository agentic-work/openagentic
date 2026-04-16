/**

 * For all inquiries, please contact:
 *
 * Openagentic LLC
 * hello@openagentic.io
 */

import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from '@/shared/icons';
import { ReactFlowDiagram, parseDiagramJson } from '@/components/diagrams/ReactFlowDiagram';
import ChartRenderer from './MessageContent/ChartRenderer';

interface MCPCall {
  id: string;
  toolName: string;
  serverName?: string;
  executedOn?: string;  // K8s pod/container hostname for traceability
  status: 'running' | 'completed' | 'error' | 'pending';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  input?: any;
  output?: any;
  error?: string;
  metadata?: any;
}

interface InlineMCPCallProps {
  call: MCPCall;
  theme: 'light' | 'dark';
}

// Helper to detect special output types
const detectOutputType = (output: any): 'diagram' | 'chart' | 'json' => {
  if (!output || typeof output !== 'object') return 'json';

  // Check for diagram output from openagentic_diagram MCP
  if (output.type === 'diagram' && output.data && output.data.nodes) {
    return 'diagram';
  }

  // Check for chart output (has type like 'pie', 'bar', 'line' and data array)
  if (output.type && ['pie', 'bar', 'line', 'area', 'scatter', 'radar', 'doughnut'].includes(output.type) && output.data) {
    return 'chart';
  }

  return 'json';
};

export const InlineMCPCall: React.FC<InlineMCPCallProps> = ({
  call,
  theme
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const borderColor = 'border-border-primary';
  const bgColor = 'bg-bg-secondary/50';
  const textColor = 'text-text-primary';
  const codeBlockBg = 'bg-bg-tertiary';

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const duration = call.duration || (call.endTime && call.startTime
    ? call.endTime.getTime() - call.startTime.getTime()
    : null);

  // Detect if output is a diagram or chart
  const outputType = useMemo(() => detectOutputType(call.output), [call.output]);

  // Parse diagram if applicable
  const diagramData = useMemo(() => {
    if (outputType === 'diagram' && call.output?.data) {
      return parseDiagramJson(JSON.stringify(call.output.data));
    }
    return null;
  }, [outputType, call.output]);

  return (
    <div className={`my-2 border ${borderColor} rounded-md overflow-hidden`}>
      {/* MCP call header - matches Claude's style */}
      <div 
        className={`px-3 py-2 ${bgColor} flex items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity`}
        onClick={() => setShowDetails(!showDetails)}
      >
        <button className="flex items-center gap-1">
          {showDetails ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>
        <span className={`text-sm font-medium ${textColor}`}>
          {call.status === 'running' ? 'Calling' : 'Called'} MCP server: <code className="font-mono text-sm">{call.serverName || 'unknown'}</code> → <code className="font-mono text-sm">{call.toolName}</code>
          {call.executedOn && <span className="text-xs ml-2 opacity-70">on {call.executedOn}</span>}
          {duration && <span className="text-xs ml-2">({formatDuration(duration)})</span>}
        </span>
      </div>

      {/* Expandable details section */}
      {showDetails && (
        <div className={`border-t ${borderColor}`}>
          {/* Input section */}
          {call.input && (
            <div className={`px-3 py-2 border-b ${borderColor}`}>
              <div className={`text-xs font-medium ${textColor} mb-1`}>Input:</div>
              <pre className={`${codeBlockBg} p-2 rounded text-xs overflow-x-auto`}>
                <code className={textColor}>{JSON.stringify(call.input, null, 2)}</code>
              </pre>
            </div>
          )}

          {/* Output section - renders diagrams, charts, or JSON */}
          {call.output !== undefined && call.status === 'completed' && (
            <div className="px-3 py-2">
              <div className={`text-xs font-medium ${textColor} mb-1`}>Output:</div>

              {/* Render React Flow diagram */}
              {outputType === 'diagram' && diagramData ? (
                <div className="my-2">
                  <ReactFlowDiagram
                    diagram={{
                      ...diagramData,
                      theme: theme === 'dark' ? 'dark' : 'light'
                    }}
                    height={400}
                    interactive={true}
                    showControls={true}
                    showMiniMap={diagramData.nodes.length > 8}
                  />
                </div>
              ) : outputType === 'chart' ? (
                /* Render chart */
                <div className="my-2">
                  <ChartRenderer
                    chartSpec={call.output}
                    theme={theme}
                    height={350}
                  />
                </div>
              ) : (
                /* Render JSON */
                <pre className={`${codeBlockBg} p-2 rounded text-xs overflow-x-auto max-h-96`}>
                  <code className={textColor}>
                    {typeof call.output === 'string' ? call.output : JSON.stringify(call.output, null, 2)}
                  </code>
                </pre>
              )}
            </div>
          )}

          {/* Error section */}
          {call.status === 'error' && call.error && (
            <div className="px-3 py-2">
              <div className="text-xs font-medium text-red-500 mb-1">Error:</div>
              <pre className={`${codeBlockBg} p-2 rounded text-xs overflow-x-auto`}>
                <code className="text-red-400">{call.error}</code>
              </pre>
            </div>
          )}

          {/* Status info */}
          {call.status === 'running' && (
            <div className="px-3 py-2 text-xs text-blue-600 dark:text-blue-400">
              Running...
            </div>
          )}
        </div>
      )}
    </div>
  );
};
