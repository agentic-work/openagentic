/**
 * Export Utilities
 * Helper functions for exporting conversations to various formats
 */

import { ChatMessage } from '@/types';

export type ExportFormat = 'pdf' | 'docx' | 'markdown' | 'text';

export interface ExportOptions {
  format: ExportFormat;
  includeTimestamps?: boolean;
  includeMetadata?: boolean;
  title?: string;
  author?: string;
  theme?: 'light' | 'dark';
}

export interface ExportMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  metadata?: any;
  toolCalls?: any[];
  mcpCalls?: any[];
}

/**
 * Convert ChatMessage to ExportMessage format
 */
export function prepareMessagesForExport(messages: ChatMessage[]): ExportMessage[] {
  return messages
    .filter(msg => msg.role !== 'system') // Filter out system messages
    .map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
      metadata: msg.metadata,
      toolCalls: msg.toolCalls,
      mcpCalls: msg.mcpCalls
    }));
}

/**
 * Export conversation to specified format
 */
export async function exportConversation(
  messages: ChatMessage[],
  options: ExportOptions,
  apiUrl?: string
): Promise<Blob> {
  const endpoint = apiUrl || import.meta.env.VITE_API_URL || 'http://localhost:3001';

  // Get auth token
  const token = localStorage.getItem('auth_token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'X-OpenAgentic-Frontend': 'true'
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Prepare messages for export
  const exportMessages = prepareMessagesForExport(messages);

  const response = await fetch(`${endpoint}/api/render/export`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messages: exportMessages,
      options: {
        format: options.format,
        includeTimestamps: options.includeTimestamps !== false,
        includeMetadata: options.includeMetadata || false,
        title: options.title || 'Conversation Export',
        author: options.author || 'OpenAgentic',
        theme: options.theme || 'light'
      }
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Export failed' }));
    throw new Error(error.details || error.error || 'Export failed');
  }

  return await response.blob();
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/**
 * Generate filename for export
 */
export function generateExportFilename(
  title: string,
  format: ExportFormat,
  timestamp?: Date
): string {
  const cleanTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const time = timestamp || new Date();
  const dateStr = time.toISOString().split('T')[0];
  return `${cleanTitle}_${dateStr}.${format}`;
}

/**
 * Export and download conversation
 */
export async function exportAndDownload(
  messages: ChatMessage[],
  options: ExportOptions,
  filename?: string
): Promise<void> {
  try {
    const blob = await exportConversation(messages, options);
    const downloadFilename = filename || generateExportFilename(
      options.title || 'conversation',
      options.format
    );
    downloadBlob(blob, downloadFilename);
  } catch (error) {
    console.error('Export failed:', error);
    throw error;
  }
}

/**
 * Get MIME type for export format
 */
export function getExportMimeType(format: ExportFormat): string {
  switch (format) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'markdown':
      return 'text/markdown';
    case 'text':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Get file extension for export format
 */
export function getExportExtension(format: ExportFormat): string {
  return format;
}

/**
 * Validate export options
 */
export function validateExportOptions(options: ExportOptions): boolean {
  const validFormats: ExportFormat[] = ['pdf', 'docx', 'markdown', 'text'];
  return validFormats.includes(options.format);
}
