import React, { useState } from 'react';
import { Download, FileText, FileDown, File, Check } from '@/shared/icons';
import { ChatMessage } from '@/types';

interface ExportButtonProps {
  messages: ChatMessage[];
  sessionTitle?: string;
  theme?: 'light' | 'dark';
}

type ExportFormat = 'pdf' | 'docx' | 'markdown' | 'text';

const ExportButton: React.FC<ExportButtonProps> = ({
  messages,
  sessionTitle = 'Conversation',
  theme = 'dark'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportedFormat, setExportedFormat] = useState<ExportFormat | null>(null);

  const exportFormats = [
    {
      format: 'pdf' as ExportFormat,
      label: 'PDF Document',
      icon: FileText,
      description: 'Export as formatted PDF'
    },
    {
      format: 'docx' as ExportFormat,
      label: 'Word Document',
      icon: FileDown,
      description: 'Export as DOCX file'
    },
    {
      format: 'markdown' as ExportFormat,
      label: 'Markdown',
      icon: File,
      description: 'Export as Markdown text'
    },
    {
      format: 'text' as ExportFormat,
      label: 'Plain Text',
      icon: FileText,
      description: 'Export as plain text'
    }
  ];

  const handleExport = async (format: ExportFormat) => {
    if (messages.length === 0) {
      alert('No messages to export');
      return;
    }

    setIsExporting(true);
    setExportedFormat(null);

    try {
      // Get API endpoint from environment or default
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

      // Get auth token
      const token = localStorage.getItem('auth_token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'X-OpenAgentic-Frontend': 'true'
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Prepare messages for export (filter out system messages if desired)
      const exportMessages = messages
        .filter(msg => msg.role !== 'system')
        .map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          metadata: msg.metadata,
          toolCalls: msg.toolCalls,
          mcpCalls: msg.mcpCalls
        }));

      const response = await fetch(`${apiUrl}/api/render/export`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: exportMessages,
          options: {
            format,
            includeTimestamps: true,
            includeMetadata: false, // Set to true to include tool calls
            title: sessionTitle,
            author: 'OpenAgenticChat',
            theme
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || 'Export failed');
      }

      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `${sessionTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now()}.${format}`;

      if (contentDisposition) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
        if (matches && matches[1]) {
          filename = matches[1].replace(/['"]/g, '');
        }
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      // Show success state
      setExportedFormat(format);
      setTimeout(() => {
        setExportedFormat(null);
        setIsOpen(false);
      }, 2000);

    } catch (error) {
      console.error('Export failed:', error);
      alert(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-secondary hover:bg-bg-tertiary transition-colors border border-border-primary"
        title="Export conversation"
        disabled={messages.length === 0}
      >
        <Download className="w-4 h-4" />
        <span className="text-sm font-medium">Export</span>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown menu */}
          <div className="absolute right-0 mt-2 w-72 bg-bg-secondary border border-border-primary rounded-lg shadow-xl z-50 overflow-hidden">
            <div className="p-3 border-b border-border-primary">
              <h3 className="text-sm font-semibold text-text-primary">Export Conversation</h3>
              <p className="text-xs text-text-secondary mt-1">
                Choose a format to download this conversation
              </p>
            </div>

            <div className="p-2">
              {exportFormats.map(({ format, label, icon: Icon, description }) => (
                <button
                  key={format}
                  onClick={() => handleExport(format)}
                  disabled={isExporting}
                  className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-bg-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {exportedFormat === format ? (
                      <Check className="w-5 h-5 text-green-500" />
                    ) : (
                      <Icon className="w-5 h-5 text-text-secondary group-hover:text-text-primary transition-colors" />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium text-text-primary">
                      {label}
                    </div>
                    <div className="text-xs text-text-secondary mt-0.5">
                      {description}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {isExporting && (
              <div className="p-3 border-t border-border-primary bg-bg-tertiary">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <div className="animate-spin w-4 h-4 border-2 border-text-secondary border-t-transparent rounded-full" />
                  <span>Exporting...</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ExportButton;
