import React from 'react';
import { CheckCircle, XCircle, Loader2 } from '@/shared/icons';

interface InlineToolCallDisplayProps {
  toolName: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export const InlineToolCallDisplay: React.FC<InlineToolCallDisplayProps> = ({
  toolName,
  status,
  result,
  error,
}) => {
  const getStatusIcon = () => {
    switch (status) {
      case 'pending':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case 'executing':
        return <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'pending':
        return 'Waiting...';
      case 'executing':
        return 'Running...';
      case 'completed':
        return '✓ Completed';
      case 'failed':
        return 'Failed';
    }
  };

  return (
    <div 
    className="inline-flex items-center gap-2 px-2 py-1 rounded-md text-sm"
    style={{ backgroundColor: 'var(--color-surface)' }}>
      {getStatusIcon()}
      <span className="font-mono">{toolName}</span>
      <span style={{ color: 'var(--color-textSecondary)' }}>{getStatusText()}</span>
      {error && (
        <span className="text-red-600 text-xs">({error})</span>
      )}
    </div>
  );
};
