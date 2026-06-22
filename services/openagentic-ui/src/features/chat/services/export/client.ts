import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import html2pdf from 'html2pdf.js';
import { 
  IExportService, 
  ExportData, 
  ExportResult, 
  PDFGenerationOptions,
  ChatMessage 
} from './types';
import { formatMarkdown, generateHTML, formatJSON } from './utils';

export class ClientExportService implements IExportService {
  
  async exportToPDF(data: ExportData): Promise<ExportResult> {
    try {
      const options = data.exportOptions as PDFGenerationOptions;
      const htmlContent = this.generatePDFHTML(data);
      
      // Create temporary container
      const tempContainer = document.createElement('div');
      tempContainer.innerHTML = htmlContent;
      tempContainer.style.position = 'absolute';
      tempContainer.style.left = '-9999px';
      tempContainer.style.top = '-9999px';
      tempContainer.style.width = '794px'; // A4 width in pixels at 96 DPI
      document.body.appendChild(tempContainer);

      const pdfOptions = {
        margin: [20, 20, 20, 20],
        filename: `${data.session.title}-${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg', quality: options.quality === 'high' ? 1 : 0.8 },
        html2canvas: { 
          scale: options.quality === 'high' ? 2 : 1,
          useCORS: true,
          backgroundColor: options.theme === 'dark' ? '#111827' : '#ffffff'
        },
        jsPDF: { 
          unit: 'mm', 
          format: options.pageSize?.toLowerCase() || 'a4', 
          orientation: options.orientation || 'portrait' 
        }
      };

      const pdf = await html2pdf().set(pdfOptions).from(tempContainer).outputPdf('blob');
      
      // Cleanup
      document.body.removeChild(tempContainer);

      return {
        success: true,
        data: pdf,
        filename: pdfOptions.filename
      };
    } catch (error) {
      console.error('PDF export error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'PDF export failed'
      };
    }
  }

  async exportToHTML(data: ExportData): Promise<ExportResult> {
    try {
      const htmlContent = generateHTML(data);
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      
      return {
        success: true,
        data: blob,
        filename: `${data.session.title}-${new Date().toISOString().split('T')[0]}.html`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'HTML export failed'
      };
    }
  }

  async exportToMarkdown(data: ExportData): Promise<ExportResult> {
    try {
      const markdownContent = formatMarkdown(data);
      const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
      
      return {
        success: true,
        data: blob,
        filename: `${data.session.title}-${new Date().toISOString().split('T')[0]}.md`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Markdown export failed'
      };
    }
  }

  async exportToJSON(data: ExportData): Promise<ExportResult> {
    try {
      const jsonContent = formatJSON(data);
      const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
      
      return {
        success: true,
        data: blob,
        filename: `${data.session.title}-${new Date().toISOString().split('T')[0]}.json`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'JSON export failed'
      };
    }
  }

  private generatePDFHTML(data: ExportData): string {
    const { session, exportOptions, userInfo } = data;
    const isDark = exportOptions.theme === 'dark';
    
    // Calculate statistics
    const stats = this.calculateStats(session.messages);
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${session.title} - Chat Export</title>
  <style>
    ${this.getPDFStyles(isDark)}
    ${exportOptions.customStyles || ''}
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header-content">
      <div class="logo-section">
        <div class="logo">🤖</div>
        <div class="company-info">
          <h1>OpenAgentic Chat Export</h1>
          <p>Professional AI Conversation Report</p>
        </div>
      </div>
      <div class="export-info">
        <p><strong>Exported:</strong> ${new Date().toLocaleString()}</p>
        ${userInfo?.name ? `<p><strong>User:</strong> ${userInfo.name}</p>` : ''}
      </div>
    </div>
  </div>

  <!-- Title Section -->
  <div class="title-section">
    <h1 class="session-title">${session.title}</h1>
    <div class="session-meta">
      <span class="meta-item">📅 ${new Date(session.createdAt).toLocaleDateString()}</span>
      <span class="meta-item">💬 ${session.messages.length} messages</span>
      <span class="meta-item">🔢 ${stats.totalTokens} tokens</span>
    </div>
  </div>

  ${exportOptions.summary?.includeStats ? this.generateStatsSection(stats, session) : ''}

  <!-- Messages -->
  <div class="messages-section">
    <h2>Conversation</h2>
    ${session.messages.map(msg => this.formatMessageForPDF(msg, exportOptions)).join('')}
  </div>

  ${exportOptions.includeMetadata ? this.generateMetadataSection(session) : ''}

  <!-- Footer -->
  <div class="footer">
    <div class="footer-content">
      <p>Generated by OpenAgentic Chat • Professional AI Assistant</p>
      <p>Page <span class="page-number"></span></p>
    </div>
  </div>
</body>
</html>`;
  }

  private getPDFStyles(isDark: boolean): string {
    const colors = isDark ? {
      bg: '#111827',
      cardBg: '#1f2937',
      text: '#f3f4f6',
      textSecondary: '#9ca3af',
      border: '#374151',
      accent: '#3b82f6'
    } : {
      bg: '#ffffff',
      cardBg: '#f8fafc',
      text: '#111827',
      textSecondary: '#6b7280',
      border: '#e5e7eb',
      accent: '#3b82f6'
    };

    return `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        font-size: 12px;
        line-height: 1.6;
        color: ${colors.text};
        background: ${colors.bg};
        padding: 0;
        margin: 0;
      }
      
      .header {
        background: ${colors.cardBg};
        border-bottom: 2px solid ${colors.accent};
        padding: 20px;
        margin-bottom: 30px;
      }
      
      .header-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .logo-section {
        display: flex;
        align-items: center;
        gap: 15px;
      }
      
      .logo {
        font-size: 32px;
        width: 50px;
        height: 50px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${colors.accent};
        border-radius: 10px;
      }
      
      .company-info h1 {
        font-size: 20px;
        font-weight: 700;
        color: ${colors.text};
        margin-bottom: 2px;
      }
      
      .company-info p {
        font-size: 12px;
        color: ${colors.textSecondary};
      }
      
      .export-info {
        text-align: right;
        font-size: 11px;
        color: ${colors.textSecondary};
      }
      
      .title-section {
        text-align: center;
        margin-bottom: 40px;
        padding: 0 20px;
      }
      
      .session-title {
        font-size: 28px;
        font-weight: 700;
        color: ${colors.text};
        margin-bottom: 15px;
      }
      
      .session-meta {
        display: flex;
        justify-content: center;
        gap: 30px;
        flex-wrap: wrap;
      }
      
      .meta-item {
        font-size: 12px;
        color: ${colors.textSecondary};
        background: ${colors.cardBg};
        padding: 8px 16px;
        border-radius: 20px;
        border: 1px solid ${colors.border};
      }
      
      .stats-section {
        background: ${colors.cardBg};
        border: 1px solid ${colors.border};
        border-radius: 12px;
        padding: 25px;
        margin: 30px 20px;
      }
      
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 20px;
        margin-top: 20px;
      }
      
      .stat-card {
        background: ${isDark ? '#374151' : '#ffffff'};
        border: 1px solid ${colors.border};
        border-radius: 8px;
        padding: 15px;
        text-align: center;
      }
      
      .stat-value {
        font-size: 24px;
        font-weight: 700;
        color: ${colors.accent};
        display: block;
      }
      
      .stat-label {
        font-size: 11px;
        color: ${colors.textSecondary};
        margin-top: 5px;
      }
      
      .messages-section {
        padding: 0 20px;
        margin-bottom: 40px;
      }
      
      .messages-section h2 {
        font-size: 20px;
        font-weight: 600;
        color: ${colors.text};
        margin-bottom: 25px;
        padding-bottom: 10px;
        border-bottom: 1px solid ${colors.border};
      }
      
      .message {
        margin-bottom: 25px;
        break-inside: avoid;
      }
      
      .message-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 8px;
      }
      
      .message-avatar {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        color: white;
      }
      
      .message-avatar.user {
        background: #3b82f6;
      }
      
      .message-avatar.assistant {
        background: #8b5cf6;
      }
      
      .message-info {
        flex: 1;
      }
      
      .message-role {
        font-weight: 600;
        font-size: 11px;
        text-transform: capitalize;
        color: ${colors.text};
      }
      
      .message-timestamp {
        font-size: 10px;
        color: ${colors.textSecondary};
      }
      
      .message-content {
        background: ${colors.cardBg};
        border: 1px solid ${colors.border};
        border-radius: 8px;
        padding: 15px;
        margin-left: 34px;
        font-size: 11px;
        line-height: 1.6;
      }
      
      .message-content pre {
        background: ${isDark ? '#000000' : '#f3f4f6'};
        border: 1px solid ${colors.border};
        border-radius: 6px;
        padding: 12px;
        overflow-x: auto;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 10px;
        margin: 10px 0;
      }
      
      .message-content code {
        background: ${isDark ? '#374151' : '#e5e7eb'};
        padding: 2px 4px;
        border-radius: 3px;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 10px;
      }
      
      .token-usage {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: ${colors.accent}20;
        color: ${colors.accent};
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 9px;
        font-weight: 500;
      }
      
      .metadata-section {
        background: ${colors.cardBg};
        border: 1px solid ${colors.border};
        border-radius: 12px;
        padding: 25px;
        margin: 30px 20px;
      }
      
      .metadata-section h3 {
        font-size: 16px;
        font-weight: 600;
        color: ${colors.text};
        margin-bottom: 15px;
      }
      
      .metadata-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 15px;
      }
      
      .metadata-item {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid ${colors.border};
        font-size: 11px;
      }
      
      .metadata-label {
        font-weight: 600;
        color: ${colors.textSecondary};
      }
      
      .metadata-value {
        color: ${colors.text};
      }
      
      .footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: ${colors.cardBg};
        border-top: 1px solid ${colors.border};
        padding: 15px 20px;
        font-size: 10px;
        color: ${colors.textSecondary};
      }
      
      .footer-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      @media print {
        .footer {
          position: fixed;
          bottom: 0;
        }
        
        .message {
          page-break-inside: avoid;
        }
      }
    `;
  }

  private calculateStats(messages: ChatMessage[]) {
    const userMessages = messages.filter(m => m.role === 'user').length;
    const assistantMessages = messages.filter(m => m.role === 'assistant').length;
    const totalTokens = messages.reduce((sum, m) => sum + (m.tokenUsage?.totalTokens || 0), 0);
    const averageResponseTime = 0; // Could be calculated if we track timing
    
    return {
      userMessages,
      assistantMessages,
      totalTokens,
      averageResponseTime,
      totalMessages: messages.length,
      estimatedCost: totalTokens * 0.00002 // Rough estimate
    };
  }

  private generateStatsSection(stats: any, session: any): string {
    return `
      <div class="stats-section">
        <h3>Conversation Statistics</h3>
        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-value">${stats.totalMessages}</span>
            <div class="stat-label">Total Messages</div>
          </div>
          <div class="stat-card">
            <span class="stat-value">${stats.userMessages}</span>
            <div class="stat-label">User Messages</div>
          </div>
          <div class="stat-card">
            <span class="stat-value">${stats.assistantMessages}</span>
            <div class="stat-label">AI Responses</div>
          </div>
          <div class="stat-card">
            <span class="stat-value">${stats.totalTokens.toLocaleString()}</span>
            <div class="stat-label">Total Tokens</div>
          </div>
          <div class="stat-card">
            <span class="stat-value">$${stats.estimatedCost.toFixed(4)}</span>
            <div class="stat-label">Estimated Cost</div>
          </div>
          <div class="stat-card">
            <span class="stat-value">${Math.round((new Date(session.updatedAt).getTime() - new Date(session.createdAt).getTime()) / 60000)}</span>
            <div class="stat-label">Duration (min)</div>
          </div>
        </div>
      </div>
    `;
  }

  private formatMessageForPDF(message: ChatMessage, options: any): string {
    const timestamp = options.includeTimestamps ? 
      `<div class="message-timestamp">${new Date(message.timestamp).toLocaleString()}</div>` : '';
    
    const tokenUsage = options.includeTokenUsage && message.tokenUsage ? 
      `<span class="token-usage">🔢 ${message.tokenUsage.totalTokens} tokens</span>` : '';

    const roleIcon = message.role === 'user' ? '👤' : '🤖';
    
    return `
      <div class="message">
        <div class="message-header">
          <div class="message-avatar ${message.role}">${roleIcon}</div>
          <div class="message-info">
            <div class="message-role">${message.role}</div>
            ${timestamp}
          </div>
          ${tokenUsage}
        </div>
        <div class="message-content">
          ${this.formatContentForPDF(message.content)}
        </div>
      </div>
    `;
  }

  private formatContentForPDF(content: string): string {
    // Basic markdown-like formatting for PDF
    return content
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  private generateMetadataSection(session: any): string {
    return `
      <div class="metadata-section">
        <h3>Session Metadata</h3>
        <div class="metadata-grid">
          <div class="metadata-item">
            <span class="metadata-label">Session ID:</span>
            <span class="metadata-value">${session.id}</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Created:</span>
            <span class="metadata-value">${new Date(session.createdAt).toLocaleString()}</span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Last Updated:</span>
            <span class="metadata-value">${new Date(session.updatedAt).toLocaleString()}</span>
          </div>
          ${session.metadata?.model ? `
          <div class="metadata-item">
            <span class="metadata-label">Model:</span>
            <span class="metadata-value">${session.metadata.model}</span>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }
}