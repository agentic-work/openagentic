import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronDown, 
  ChevronRight, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  Terminal,
  FileText,
  Play,
  Square,
  Loader2
} from '@/shared/icons';

interface MCPCall {
  id: string;
  toolName: string;
  serverName?: string;
  status: 'running' | 'completed' | 'error' | 'pending';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  input?: any;
  output?: any;
  error?: string;
  metadata?: any;
}

interface MCPFunctionDisplayProps {
  calls: MCPCall[];
  theme: 'light' | 'dark';
  onExpandToCanvas?: (call: MCPCall) => void;
}

const MCPFunctionDisplay: React.FC<MCPFunctionDisplayProps> = ({
  calls,
  theme,
  onExpandToCanvas
}) => {
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set());
  
  const toggleExpanded = (callId: string) => {
    const newExpanded = new Set(expandedCalls);
    if (newExpanded.has(callId)) {
      newExpanded.delete(callId);
    } else {
      newExpanded.add(callId);
    }
    setExpandedCalls(newExpanded);
  };
  
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 size={14} className="animate-spin" />;
      case 'completed':
        return <CheckCircle size={14} className="text-success" />;
      case 'error':
        return <AlertCircle size={14} className="text-error" />;
      case 'pending':
        return <Clock size={14} className="text-warning" />;
      default:
        return <Square size={14} className="text-muted" />;
    }
  };
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'border-info/50 bg-info/10';
      case 'completed':
        return 'border-success/50 bg-success/10';
      case 'error':
        return 'border-error/50 bg-error/10';
      case 'pending':
        return 'border-warning/50 bg-warning/10';
      default:
        return 'border-primary bg-tertiary';
    }
  };
  
  const renderJSON = (data: any, maxLines = 10) => {
    if (!data) return null;
    
    const jsonString = JSON.stringify(data, null, 2);
    const lines = jsonString.split('\n');
    const shouldTruncate = lines.length > maxLines;
    const displayLines = shouldTruncate ? lines.slice(0, maxLines) : lines;
    
    return (
      <div className={`relative rounded-md border ${
        'bg-bg-secondary border-border-primary'
      }`}>
        <pre className={`p-3 text-xs font-mono overflow-x-auto ${
          'text-text-secondary'
        }`}>
          {displayLines.join('\n')}
          {shouldTruncate && (
            <span className={`${
              'text-text-muted'
            }`}>
              {'\n... '}({lines.length - maxLines} more lines)
            </span>
          )}
        </pre>
        {shouldTruncate && (
          <div className={`absolute bottom-2 right-2 text-xs px-2 py-1 rounded ${
            'bg-bg-tertiary text-text-muted'
          }`}>
            +{lines.length - maxLines} lines
          </div>
        )}
      </div>
    );
  };
  
  if (calls.length === 0) return null;
  
  return (
    <div className="space-y-3">
      {calls.map((call) => {
        const isExpanded = expandedCalls.has(call.id);

        // CRITICAL FIX: Deserialize date strings to Date objects
        // Database returns ISO strings, but UI expects Date objects
        const startTime = call.startTime instanceof Date
          ? call.startTime
          : call.startTime ? new Date(call.startTime) : undefined;

        const endTime = call.endTime instanceof Date
          ? call.endTime
          : call.endTime ? new Date(call.endTime) : undefined;

        const duration = call.duration || (endTime && startTime
          ? endTime.getTime() - startTime.getTime()
          : null);

        return (
          <motion.div
            key={call.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`border-l-4 rounded-lg shadow-sm ${getStatusColor(call.status)} ${
              'bg-bg-primary'
            }`}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between p-4 cursor-pointer"
              onClick={() => toggleExpanded(call.id)}
            >
              <div className="flex items-center gap-3">
                <motion.div
                  animate={{ rotate: isExpanded ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight size={16} className={
                    'text-text-muted'
                  } />
                </motion.div>
                
                {getStatusIcon(call.status)}
                
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${
                      'text-text-primary'
                    }`}>
                      {call.toolName}
                    </span>
                    {call.serverName && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        'bg-bg-tertiary text-text-secondary'
                      }`}>
                        {call.serverName}
                      </span>
                    )}
                  </div>
                  <div className={`text-sm flex items-center gap-2 ${
                    'text-text-muted'
                  }`}>
                    <span className="capitalize">{call.status}</span>
                    {duration && (
                      <>
                        <span>•</span>
                        <span>{formatDuration(duration)}</span>
                      </>
                    )}
                    <span>•</span>
                    <span>{startTime ? startTime.toLocaleTimeString() : 'Unknown time'}</span>
                  </div>
                </div>
              </div>
              
              {onExpandToCanvas && call.status === 'completed' && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onExpandToCanvas(call);
                  }}
                  className={`p-2 rounded-lg transition-all ${
                    'hover:bg-bg-secondary text-text-muted'
                  }`}
                  title="Open in canvas"
                >
                  <Terminal size={14} />
                </motion.button>
              )}
            </div>
            
            {/* Expanded content */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className={`px-4 pb-4 border-t ${
                    'border-border-secondary'
                  }`}>
                    <div className="pt-4 space-y-4">
                      {/* Input section */}
                      {call.input && (
                        <div>
                          <h4 className={`text-sm font-medium mb-2 flex items-center gap-2 ${
                            'text-text-secondary'
                          }`}>
                            <Play size={12} />
                            Input
                          </h4>
                          {renderJSON(call.input)}
                        </div>
                      )}
                      
                      {/* Output section */}
                      {call.output && call.status === 'completed' && (
                        <div>
                          <h4 className={`text-sm font-medium mb-2 flex items-center gap-2 ${
                            'text-text-secondary'
                          }`}>
                            <FileText size={12} />
                            Output
                          </h4>
                          {renderJSON(call.output)}
                        </div>
                      )}
                      
                      {/* Error section */}
                      {call.error && call.status === 'error' && (
                        <div>
                          <h4 className={`text-sm font-medium mb-2 flex items-center gap-2 text-error`}>
                            <AlertCircle size={12} />
                            Error
                          </h4>
                          <div className={`p-3 rounded-md border border-error/20 bg-error/10 text-error`}>
                            <pre className="text-xs whitespace-pre-wrap font-mono">
                              {call.error}
                            </pre>
                          </div>
                        </div>
                      )}
                      
                      {/* Metadata section */}
                      {call.metadata && (
                        <div>
                          <h4 className={`text-sm font-medium mb-2 flex items-center gap-2 ${
                            'text-text-secondary'
                          }`}>
                            <Terminal size={12} />
                            Metadata
                          </h4>
                          {renderJSON(call.metadata, 5)}
                        </div>
                      )}
                      
                      {/* Running indicator */}
                      {call.status === 'running' && (
                        <div className={`flex items-center gap-2 text-sm text-info`}>
                          <Loader2 size={14} className="animate-spin" />
                          Function is executing...
                        </div>
                      )}
                    </div>
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

export default MCPFunctionDisplay;