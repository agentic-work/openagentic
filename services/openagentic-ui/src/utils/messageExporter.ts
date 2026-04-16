/**
 * Lightweight Message Export for Pure Frontend Architecture
 * Delegates heavy processing to API instead of client-side libraries
 */

import { ChatMessage } from '../types';

interface ExportOptions {
  format: 'pdf' | 'docx' | 'markdown' | 'text';
  includeTimestamps?: boolean;
  includeMetadata?: boolean;
  title?: string;
  author?: string;
}

/**
 * Export messages via API endpoints instead of client-side processing
 */
export class MessageExporter {
  /**
   * Export messages to the specified format via API
   */
  static async export(
    messages: ChatMessage | ChatMessage[],
    options: ExportOptions
  ): Promise<void> {
    const messageArray = Array.isArray(messages) ? messages : [messages];
    
    try {
      const response = await fetch('/api/export/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messageArray,
          options
        })
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.status} ${response.statusText}`);
      }

      // Get the file blob from API
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      // Determine file extension
      const extension = options.format === 'docx' ? 'docx' : 
                       options.format === 'pdf' ? 'pdf' :
                       options.format === 'markdown' ? 'md' : 'txt';
      
      // Download the file
      const filename = `${options.title?.replace(/[^a-z0-9]/gi, '-') || 'chat-export'}-${Date.now()}.${extension}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('Message export failed:', error);
      // Fallback to basic text export
      await this.fallbackTextExport(messageArray, options);
    }
  }

  /**
   * Fallback text export when API is unavailable
   */
  private static async fallbackTextExport(
    messages: ChatMessage[],
    options: ExportOptions
  ): Promise<void> {
    let text = '';

    // Add title
    text += `${options.title || 'Chat Export'}\n`;
    text += `${'='.repeat((options.title || 'Chat Export').length)}\n\n`;
    text += `Exported on ${new Date().toLocaleDateString()}\n\n`;
    text += `${'-'.repeat(50)}\n\n`;

    // Add messages
    messages.forEach((message) => {
      const role = message.role === 'user' ? 'YOU' : 'ASSISTANT';
      
      text += `[${role}]`;
      
      if (options.includeTimestamps && message.timestamp) {
        text += ` - ${new Date(message.timestamp).toLocaleString()}`;
      }
      
      text += '\n\n';
      text += `${message.content}\n\n`;
      text += `${'-'.repeat(50)}\n\n`;
    });

    // Save file
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${options.title?.replace(/[^a-z0-9]/gi, '-') || 'chat-export'}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Export Azure report via API
   */
  static async exportAzureReport(
    messages: ChatMessage[],
    options: {
      format: 'pdf' | 'docx';
      reportTitle: string;
      includeExecutiveSummary?: boolean;
      includeTOC?: boolean;
      author?: string;
      company?: string;
    }
  ): Promise<void> {
    try {
      const response = await fetch('/api/export/azure-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          options
        })
      });

      if (!response.ok) {
        throw new Error(`Azure report export failed: ${response.status} ${response.statusText}`);
      }

      // Download the generated report
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const filename = `${options.reportTitle.replace(/[^a-z0-9]/gi, '-')}-azure-report-${Date.now()}.${options.format}`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('Azure report export failed:', error);
      // Fallback to simple text export
      await this.export(messages, {
        format: 'text',
        title: options.reportTitle,
        author: options.author,
        includeTimestamps: true,
        includeMetadata: true
      });
    }
  }
}