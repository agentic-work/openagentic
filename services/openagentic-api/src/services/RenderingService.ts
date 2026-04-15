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
 * Server-Side Rendering Service for Pure Frontend Architecture
 * Handles heavy rendering operations moved from client to API
 */

// All heavy dependencies are lazy-loaded to avoid startup failures
import katex from 'katex';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
// import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import remarkEmoji from 'remark-emoji';
import remarkStringify from 'remark-stringify';
import rehypeHighlight from 'rehype-highlight';
// import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
// import { codeToHtml } from 'shiki';
import puppeteer from 'puppeteer';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  UnderlineType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle
} from 'docx';
import { Logger } from 'pino';

interface ChartData {
  type: 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'radar' | 'doughnut' | 'bubble';
  data: any[];
  title?: string;
  xAxis?: string;
  yAxis?: string;
  dataKeys?: string[];
  colors?: string[];
  options?: any;
}

// NOTE: Mermaid rendering removed - diagrams now use React Flow client-side

interface ChartRenderOptions {
  chartData: ChartData;
  theme: 'light' | 'dark';
  height: number;
  format: 'png' | 'svg';
}

interface PipelineRenderOptions {
  theme: 'light' | 'dark';
  embedded: boolean;
  format: 'svg' | 'png';
}

interface MarkdownRenderOptions {
  markdown: string;
  theme: 'light' | 'dark';
  enableMath: boolean;
  enableHighlight: boolean;
}

interface CodeEditorRenderOptions {
  code: string;
  language: string;
  theme: 'light' | 'dark';
  readOnly: boolean;
  showLineNumbers: boolean;
  format: 'png' | 'html';
}

interface ExportMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  metadata?: any;
  toolCalls?: any[];
  mcpCalls?: any[];
}

interface ExportOptions {
  format: 'pdf' | 'docx' | 'markdown' | 'text';
  includeTimestamps?: boolean;
  includeMetadata?: boolean;
  title?: string;
  author?: string;
  theme?: 'light' | 'dark';
}

export class RenderingService {
  private chartRenderer: any;
  private canvas: any;
  private ChartJSNodeCanvas: any;
  private logger: Logger;
  private browser?: puppeteer.Browser;
  private isCanvasAvailable = false;

  constructor(logger: Logger) {
    this.logger = logger;
    // Dependencies are initialized lazily on first use to avoid startup failures
    this.logger.info('RenderingService initialized - dependencies will be loaded on demand');
  }

  private async initializeChartJS() {
    if (this.isCanvasAvailable || this.chartRenderer) return;
    
    try {
      const { ChartJSNodeCanvas } = await import('chartjs-node-canvas');
      this.ChartJSNodeCanvas = ChartJSNodeCanvas;
      this.chartRenderer = new this.ChartJSNodeCanvas({ 
        width: 800, 
        height: 400,
        backgroundColour: 'transparent'
      });
      this.isCanvasAvailable = true;
      this.logger.info('Chart.js Canvas initialized successfully');
    } catch (error) {
      this.logger.warn('Chart.js Canvas not available - chart rendering disabled');
      this.isCanvasAvailable = false;
      throw new Error('Chart rendering not available - native dependencies missing');
    }
  }

  // NOTE: Mermaid initialization removed - diagrams now use React Flow client-side

  private async initializeCanvas() {
    if (this.canvas) return;
    
    try {
      this.canvas = await import('canvas');
      this.logger.info('Canvas initialized successfully');
    } catch (error) {
      this.logger.warn('Canvas not available - some rendering features disabled');
      throw new Error('Canvas not available - native dependencies missing');
    }
  }

  async initialize() {
    // Initialize browser for complex rendering tasks
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  async destroy() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  // NOTE: Mermaid diagram rendering removed - diagrams now use React Flow client-side

  /**
   * Render charts using Chart.js
   */
  async renderChart(options: ChartRenderOptions): Promise<Buffer> {
    // Initialize Chart.js on demand
    await this.initializeChartJS();

    try {
      const { chartData, theme, height, format } = options;
      
      // Configure chart for server-side rendering
      const configuration = {
        type: chartData.type as any,
        data: {
          labels: chartData.data.map(d => d.label || d.name || d.x || d[chartData.xAxis || 'x']),
          datasets: [{
            label: chartData.title || 'Dataset',
            data: chartData.data.map(d => d.value || d.y || d[chartData.dataKeys?.[0] || 'y']),
            backgroundColor: chartData.colors || [
              '#8b5cf6', '#ec4899', '#3b82f6', '#10b981', 
              '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6'
            ],
            borderColor: theme === 'dark' ? '#374151' : '#e5e7eb',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              labels: {
                color: theme === 'dark' ? '#e5e7eb' : '#374151'
              }
            },
            tooltip: {
              backgroundColor: theme === 'dark' ? '#1f2937' : '#ffffff',
              titleColor: theme === 'dark' ? '#e5e7eb' : '#374151',
              bodyColor: theme === 'dark' ? '#e5e7eb' : '#374151',
              borderColor: theme === 'dark' ? '#374151' : '#e5e7eb',
              borderWidth: 1
            }
          },
          scales: chartData.type !== 'pie' && chartData.type !== 'doughnut' ? {
            x: {
              ticks: { color: theme === 'dark' ? '#9ca3af' : '#6b7280' },
              grid: { color: theme === 'dark' ? '#374151' : '#e5e7eb' }
            },
            y: {
              ticks: { color: theme === 'dark' ? '#9ca3af' : '#6b7280' },
              grid: { color: theme === 'dark' ? '#374151' : '#e5e7eb' }
            }
          } : undefined,
          ...chartData.options
        }
      };

      // Render chart
      const chartRenderer = new this.ChartJSNodeCanvas!({ 
        width: 800, 
        height,
        backgroundColour: theme === 'dark' ? '#1f2937' : '#ffffff'
      });

      return await chartRenderer.renderToBuffer(configuration);

    } catch (error) {
      this.logger.error(`Chart rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to render chart: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Render beautiful markdown with math formulas and syntax highlighting
   */
  async renderMarkdown(options: MarkdownRenderOptions): Promise<string> {
    try {
      const { markdown, theme, enableMath, enableHighlight } = options;

      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkBreaks)
        .use(remarkEmoji)
        .use(enableMath ? (() => {}) : () => {})
        .use(rehypeSanitize)
        // .use(rehypeKatex, { 
          // trust: true,
          // strict: false 
        // })
        .use(enableHighlight ? rehypeHighlight : () => {});

      // Process markdown
      const result = await processor.process(markdown);
      let html = String(result);

      // Apply theme styling
      const themeStyles = theme === 'dark' ? `
        <style>
          body { 
            background: #1f2937; 
            color: #e5e7eb; 
            font-family: ui-sans-serif, system-ui, sans-serif;
            line-height: 1.6;
            padding: 2rem;
          }
          h1, h2, h3, h4, h5, h6 { color: #f3f4f6; border-bottom: 1px solid #374151; }
          code { background: #374151; color: #f3f4f6; padding: 0.2em 0.4em; border-radius: 0.25rem; }
          pre { background: #111827; border: 1px solid #374151; border-radius: 0.5rem; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #374151; padding: 0.5rem; text-align: left; }
          th { background: #374151; color: #f3f4f6; }
          blockquote { border-left: 4px solid #8b5cf6; padding-left: 1rem; color: #d1d5db; }
          .katex { color: #e5e7eb; }
        </style>
      ` : `
        <style>
          body { 
            background: #ffffff; 
            color: #374151; 
            font-family: ui-sans-serif, system-ui, sans-serif;
            line-height: 1.6;
            padding: 2rem;
          }
          h1, h2, h3, h4, h5, h6 { color: #1f2937; border-bottom: 1px solid #e5e7eb; }
          code { background: #f3f4f6; color: #1f2937; padding: 0.2em 0.4em; border-radius: 0.25rem; }
          pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0.5rem; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #e5e7eb; padding: 0.5rem; text-align: left; }
          th { background: #f3f4f6; color: #374151; }
          blockquote { border-left: 4px solid #8b5cf6; padding-left: 1rem; color: #6b7280; }
        </style>
      `;

      return `<!DOCTYPE html><html><head>${themeStyles}<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"></head><body>${html}</body></html>`;

    } catch (error) {
      this.logger.error(`Markdown rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to render markdown: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Render code with syntax highlighting using Shiki
   */
  async renderCodeBlock(code: string, language: string, theme: 'light' | 'dark'): Promise<string> {
    try {
      // const html = await codeToHtml(code, {
        // lang: language,
        // theme: theme === 'dark' ? 'github-dark' : 'github-light'
      // });
      const html = `<pre><code class="language-${language}">${code}</code></pre>`;
      
      return html;
    } catch (error) {
      this.logger.error(`Code highlighting failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to highlight code: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Render pipeline visualization
   */
  async renderPipelineVisualization(options: PipelineRenderOptions): Promise<Buffer> {
    try {
      const { theme, embedded, format } = options;

      if (!this.browser) await this.initialize();
      const page = await this.browser!.newPage();

      // Set viewport for proper rendering
      await page.setViewport({ width: 1200, height: embedded ? 600 : 800 });

      // Create HTML for pipeline visualization
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
          <style>
            body { 
              margin: 0; 
              padding: 2rem; 
              background: ${theme === 'dark' ? '#1f2937' : '#f9fafb'}; 
              font-family: ui-sans-serif, system-ui, sans-serif;
            }
            .pipeline-container {
              display: flex;
              justify-content: space-between;
              align-items: center;
              max-width: 1000px;
              margin: 0 auto;
            }
            .stage {
              flex: 1;
              margin: 0 1rem;
              padding: 2rem;
              background: ${theme === 'dark' ? 'rgba(55, 65, 81, 0.8)' : 'rgba(255, 255, 255, 0.8)'};
              border-radius: 1rem;
              border: 2px solid ${theme === 'dark' ? '#4b5563' : '#e5e7eb'};
              text-align: center;
              backdrop-filter: blur(10px);
            }
            .stage-icon {
              width: 4rem;
              height: 4rem;
              margin: 0 auto 1rem;
              background: linear-gradient(135deg, #8b5cf6, #ec4899);
              border-radius: 1rem;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 2rem;
            }
            .stage-title {
              font-size: 1.25rem;
              font-weight: 600;
              color: ${theme === 'dark' ? '#f3f4f6' : '#1f2937'};
              margin-bottom: 0.5rem;
            }
            .stage-desc {
              font-size: 0.875rem;
              color: ${theme === 'dark' ? '#9ca3af' : '#6b7280'};
            }
            .arrow {
              font-size: 2rem;
              color: #8b5cf6;
            }
            .title {
              text-align: center;
              font-size: 2rem;
              font-weight: bold;
              color: ${theme === 'dark' ? '#f3f4f6' : '#1f2937'};
              margin-bottom: 3rem;
              background: linear-gradient(135deg, #8b5cf6, #ec4899);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
            }
          </style>
        </head>
        <body>
          <div class="title">Platform Chat Pipeline</div>
          <div class="pipeline-container">
            <div class="stage">
              <div class="stage-icon">🔐</div>
              <div class="stage-title">Authentication</div>
              <div class="stage-desc">Validates user authentication and extracts security context</div>
            </div>
            <div class="arrow">→</div>
            <div class="stage">
              <div class="stage-icon">✅</div>
              <div class="stage-title">Validation</div>
              <div class="stage-desc">Sanitizes input and prepares conversation context</div>
            </div>
            <div class="arrow">→</div>
            <div class="stage">
              <div class="stage-icon">🎯</div>
              <div class="stage-title">Prompt Engineering</div>
              <div class="stage-desc">Applies advanced prompting techniques and user templates</div>
            </div>
            <div class="arrow">→</div>
            <div class="stage">
              <div class="stage-icon">🔧</div>
              <div class="stage-title">MCP Tools</div>
              <div class="stage-desc">Manages Model Context Protocol tools and executions</div>
            </div>
            <div class="arrow">→</div>
            <div class="stage">
              <div class="stage-icon">🧠</div>
              <div class="stage-title">AI Completion</div>
              <div class="stage-desc">Generates AI responses with intelligent model routing</div>
            </div>
            <div class="arrow">→</div>
            <div class="stage">
              <div class="stage-icon">📄</div>
              <div class="stage-title">Response Processing</div>
              <div class="stage-desc">Formats and stores the final response</div>
            </div>
          </div>
        </body>
        </html>
      `;

      await page.setContent(html);
      
      const screenshot = await page.screenshot({ 
        type: 'png',
        fullPage: true,
        omitBackground: false
      });
      
      await page.close();
      return screenshot as Buffer;

    } catch (error) {
      this.logger.error(`Pipeline visualization failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to render pipeline: ${error}`);
    }
  }

  /**
   * Generate image from AI model (placeholder for future implementation)
   */
  async generateImage(prompt: string, model: string): Promise<Buffer> {
    // This would integrate with image generation models like DALL-E, Midjourney, etc.
    // For now, return a placeholder
    throw new Error('Image generation not yet implemented');
  }

  /**
   * Render Monaco Editor with code
   */
  async renderCodeEditor(options: CodeEditorRenderOptions): Promise<Buffer | string> {
    try {
      const { code, language, theme, readOnly, showLineNumbers, format } = options;

      const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs';
      
      if (!this.browser) await this.initialize();
      const page = await this.browser!.newPage();

      // Set viewport for proper rendering
      await page.setViewport({ width: 1000, height: 600 });

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { 
              margin: 0; 
              padding: 0; 
              font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
              background: ${theme === 'dark' ? '#1e1e1e' : '#ffffff'};
            }
            #container { 
              width: 100%; 
              height: 100vh; 
              border: 1px solid ${theme === 'dark' ? '#3e3e3e' : '#e0e0e0'};
            }
          </style>
          <script src="https://unpkg.com/monaco-editor@latest/min/vs/loader.js"></script>
        </head>
        <body>
          <div id="container"></div>
          <script>
            require.config({ paths: { vs: 'https://unpkg.com/monaco-editor@latest/min/vs' } });
            require(['vs/editor/editor.main'], function () {
              const editor = monaco.editor.create(document.getElementById('container'), {
                value: ${JSON.stringify(code)},
                language: '${language}',
                theme: '${monacoTheme}',
                readOnly: ${readOnly},
                lineNumbers: ${showLineNumbers ? "'on'" : "'off'"},
                fontSize: 14,
                lineHeight: 20,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                minimap: { enabled: false },
                overviewRulerBorder: false,
                scrollbar: {
                  vertical: 'auto',
                  horizontal: 'auto',
                  verticalScrollbarSize: 12,
                  horizontalScrollbarSize: 12
                }
              });
            });
          </script>
        </body>
        </html>
      `;

      if (format === 'html') {
        await page.close();
        return html;
      }

      await page.setContent(html);
      
      // Wait for Monaco to load
      await page.waitForFunction(() => (window as any).monaco !== undefined, { timeout: 5000 });
      
      const screenshot = await page.screenshot({ 
        type: 'png',
        fullPage: true,
        omitBackground: false
      });
      
      await page.close();
      return screenshot as Buffer;

    } catch (error) {
      this.logger.error(`Monaco editor rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to render Monaco editor: ${error}`);
    }
  }

  /**
   * Create beautiful tables from data
   */
  async renderTable(data: any[], theme: 'light' | 'dark'): Promise<string> {
    if (!data.length) return '';

    const headers = Object.keys(data[0]);
    const themeClass = theme === 'dark' ? 'table-dark' : 'table-light';

    let html = `
      <style>
        .table-light { background: #ffffff; color: #374151; }
        .table-light th { background: #f3f4f6; }
        .table-light td, .table-light th { border: 1px solid #e5e7eb; }
        .table-dark { background: #1f2937; color: #e5e7eb; }
        .table-dark th { background: #374151; }
        .table-dark td, .table-dark th { border: 1px solid #4b5563; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 0.75rem; text-align: left; }
        th { font-weight: 600; }
      </style>
      <table class="${themeClass}">
        <thead>
          <tr>
            ${headers.map(h => `<th>${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
    `;

    for (const row of data) {
      html += '<tr>';
      for (const header of headers) {
        html += `<td>${row[header] || ''}</td>`;
      }
      html += '</tr>';
    }

    html += '</tbody></table>';
    return html;
  }

  /**
   * Render complex documents with mixed content (markdown + charts + diagrams)
   */
  async renderDocument(content: {
    markdown?: string;
    charts?: ChartData[];
    diagrams?: string[];
    tables?: any[][];
  }, theme: 'light' | 'dark'): Promise<string> {
    try {
      let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
          <style>
            body { 
              background: ${theme === 'dark' ? '#1f2937' : '#ffffff'}; 
              color: ${theme === 'dark' ? '#e5e7eb' : '#374151'}; 
              font-family: ui-sans-serif, system-ui, sans-serif;
              line-height: 1.6;
              padding: 2rem;
              max-width: 1200px;
              margin: 0 auto;
            }
            .section { margin: 2rem 0; }
            .chart-container { margin: 2rem 0; text-align: center; }
            .diagram-container { margin: 2rem 0; text-align: center; }
          </style>
        </head>
        <body>
      `;

      // Render markdown content
      if (content.markdown) {
        const markdownHtml = await this.renderMarkdown({
          markdown: content.markdown,
          theme,
          enableMath: true,
          enableHighlight: true
        });
        html += `<div class="section">${markdownHtml}</div>`;
      }

      // Render tables
      if (content.tables?.length) {
        for (const tableData of content.tables) {
          const tableHtml = await this.renderTable(tableData, theme);
          html += `<div class="section">${tableHtml}</div>`;
        }
      }

      html += '</body></html>';
      return html;

    } catch (error) {
      this.logger.error(`Document rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to render document: ${error}`);
    }
  }

  /**
   * Export conversation to PDF format
   */
  async exportToPDF(messages: ExportMessage[], options: ExportOptions): Promise<Buffer> {
    try {
      const {
        title = 'Conversation Export',
        author = 'OpenAgenticChat',
        includeTimestamps = true,
        includeMetadata = false,
        theme = 'light'
      } = options;

      if (!this.browser) await this.initialize();
      const page = await this.browser!.newPage();

      // Set viewport for proper rendering
      await page.setViewport({ width: 1200, height: 1600 });

      // Generate HTML content for the conversation
      const isDark = theme === 'dark';
      const bgColor = isDark ? '#1f2937' : '#ffffff';
      const textColor = isDark ? '#e5e7eb' : '#374151';
      const borderColor = isDark ? '#374151' : '#e5e7eb';
      const userBg = isDark ? '#3b82f6' : '#3b82f6';
      const assistantBg = isDark ? '#374151' : '#f3f4f6';
      const codeBg = isDark ? '#111827' : '#f9fafb';

      // Process messages and render markdown content
      let messagesHtml = '';
      for (const message of messages) {
        const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
        const timestamp = includeTimestamps
          ? `<div class="timestamp">${new Date(message.timestamp).toLocaleString()}</div>`
          : '';

        const isUser = message.role === 'user';
        const messageBg = isUser ? userBg : assistantBg;
        const messageColor = isUser ? '#ffffff' : textColor;

        // Render markdown content
        let renderedContent = message.content;
        try {
          // Use remark to process markdown
          const processor = unified()
            .use(remarkParse)
            .use(remarkGfm)
            .use(remarkBreaks)
            .use(remarkEmoji);

          const result = await processor.process(message.content);
          renderedContent = String(result);
        } catch (err) {
          this.logger.warn(`Failed to render markdown for message: ${err}`);
        }

        // Handle tool calls if present
        let toolCallsHtml = '';
        if (includeMetadata && (message.toolCalls?.length || message.mcpCalls?.length)) {
          const allCalls = [...(message.toolCalls || []), ...(message.mcpCalls || [])];
          toolCallsHtml = `
            <div class="tool-calls">
              <strong>Tool Calls:</strong>
              ${allCalls.map(call => `
                <div class="tool-call">
                  <code>${call.name || call.function?.name || 'unknown'}</code>
                </div>
              `).join('')}
            </div>
          `;
        }

        messagesHtml += `
          <div class="message ${message.role}">
            <div class="message-header">
              <strong class="role">${roleLabel}</strong>
              ${timestamp}
            </div>
            <div class="message-body" style="background: ${messageBg}; color: ${messageColor};">
              ${renderedContent}
            </div>
            ${toolCallsHtml}
          </div>
        `;
      }

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              background: ${bgColor};
              color: ${textColor};
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              line-height: 1.6;
              padding: 2rem;
            }
            .header {
              text-align: center;
              margin-bottom: 3rem;
              padding-bottom: 1rem;
              border-bottom: 2px solid ${borderColor};
            }
            .header h1 {
              font-size: 2rem;
              margin-bottom: 0.5rem;
              color: ${textColor};
            }
            .header .author {
              font-size: 0.875rem;
              color: ${isDark ? '#9ca3af' : '#6b7280'};
            }
            .message {
              margin-bottom: 1.5rem;
              page-break-inside: avoid;
            }
            .message-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 0.5rem;
            }
            .role {
              font-weight: 600;
              color: ${isDark ? '#8b5cf6' : '#7c3aed'};
            }
            .timestamp {
              font-size: 0.75rem;
              color: ${isDark ? '#9ca3af' : '#6b7280'};
            }
            .message-body {
              padding: 1rem;
              border-radius: 0.5rem;
              word-wrap: break-word;
            }
            .message.user .message-body {
              background: ${userBg};
              color: #ffffff;
            }
            .message.assistant .message-body {
              background: ${assistantBg};
              color: ${textColor};
            }
            code {
              background: ${codeBg};
              padding: 0.2em 0.4em;
              border-radius: 0.25rem;
              font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
              font-size: 0.875em;
            }
            pre {
              background: ${codeBg};
              padding: 1rem;
              border-radius: 0.5rem;
              overflow-x: auto;
              margin: 1rem 0;
            }
            pre code {
              background: transparent;
              padding: 0;
            }
            .tool-calls {
              margin-top: 0.75rem;
              padding: 0.75rem;
              background: ${isDark ? '#111827' : '#f9fafb'};
              border-radius: 0.375rem;
              font-size: 0.875rem;
            }
            .tool-call {
              margin-top: 0.5rem;
              padding: 0.5rem;
              background: ${isDark ? '#1f2937' : '#ffffff'};
              border-left: 3px solid #8b5cf6;
              border-radius: 0.25rem;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 1rem 0;
            }
            th, td {
              border: 1px solid ${borderColor};
              padding: 0.5rem;
              text-align: left;
            }
            th {
              background: ${isDark ? '#374151' : '#f3f4f6'};
              font-weight: 600;
            }
            blockquote {
              border-left: 4px solid #8b5cf6;
              padding-left: 1rem;
              margin: 1rem 0;
              color: ${isDark ? '#d1d5db' : '#6b7280'};
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${title}</h1>
            <div class="author">Generated by ${author}</div>
            <div class="author">${new Date().toLocaleString()}</div>
          </div>
          ${messagesHtml}
        </body>
        </html>
      `;

      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm'
        }
      });

      await page.close();
      return pdfBuffer as Buffer;

    } catch (error) {
      this.logger.error(`PDF export failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to export to PDF: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Export conversation to DOCX format
   */
  async exportToDOCX(messages: ExportMessage[], options: ExportOptions): Promise<Buffer> {
    try {
      const {
        title = 'Conversation Export',
        author = 'OpenAgenticChat',
        includeTimestamps = true,
        includeMetadata = false
      } = options;

      const documentChildren: any[] = [];

      // Add title
      documentChildren.push(
        new Paragraph({
          text: title,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 }
        })
      );

      // Add metadata
      documentChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Generated by ${author}`,
              italics: true,
              size: 20
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 }
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: new Date().toLocaleString(),
              italics: true,
              size: 20
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 }
        })
      );

      // Process each message
      for (const message of messages) {
        const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);

        // Message header
        const headerRuns: TextRun[] = [
          new TextRun({
            text: roleLabel,
            bold: true,
            color: message.role === 'user' ? '3B82F6' : '6B7280',
            size: 24
          })
        ];

        if (includeTimestamps) {
          headerRuns.push(
            new TextRun({
              text: ` • ${new Date(message.timestamp).toLocaleString()}`,
              italics: true,
              size: 20,
              color: '9CA3AF'
            })
          );
        }

        documentChildren.push(
          new Paragraph({
            children: headerRuns,
            spacing: { before: 200, after: 100 }
          })
        );

        // Message content - split by code blocks and paragraphs
        const contentLines = message.content.split('\n');
        let inCodeBlock = false;
        let codeBlockContent: string[] = [];
        let codeLanguage = '';

        for (const line of contentLines) {
          // Detect code block start/end
          if (line.trim().startsWith('```')) {
            if (!inCodeBlock) {
              inCodeBlock = true;
              codeLanguage = line.trim().substring(3);
              codeBlockContent = [];
            } else {
              // End of code block - add it
              inCodeBlock = false;
              documentChildren.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: codeBlockContent.join('\n'),
                      font: 'Consolas',
                      size: 20
                    })
                  ],
                  shading: {
                    fill: 'F3F4F6'
                  },
                  spacing: { before: 100, after: 100 }
                })
              );
              codeBlockContent = [];
            }
            continue;
          }

          if (inCodeBlock) {
            codeBlockContent.push(line);
          } else if (line.trim()) {
            // Regular text paragraph - handle inline code
            const parts = line.split('`');
            const textRuns: TextRun[] = [];

            parts.forEach((part, index) => {
              if (index % 2 === 0) {
                // Regular text
                if (part) {
                  textRuns.push(new TextRun({
                    text: part,
                    size: 22
                  }));
                }
              } else {
                // Inline code
                textRuns.push(new TextRun({
                  text: part,
                  font: 'Consolas',
                  size: 20,
                  shading: { fill: 'F3F4F6' }
                }));
              }
            });

            documentChildren.push(
              new Paragraph({
                children: textRuns.length > 0 ? textRuns : [new TextRun({ text: line, size: 22 })],
                spacing: { after: 100 }
              })
            );
          } else {
            // Empty line
            documentChildren.push(
              new Paragraph({
                text: '',
                spacing: { after: 100 }
              })
            );
          }
        }

        // Add tool calls if present
        if (includeMetadata && (message.toolCalls?.length || message.mcpCalls?.length)) {
          const allCalls = [...(message.toolCalls || []), ...(message.mcpCalls || [])];

          documentChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: 'Tool Calls:',
                  bold: true,
                  size: 20
                })
              ],
              spacing: { before: 100, after: 50 }
            })
          );

          for (const call of allCalls) {
            const toolName = call.name || call.function?.name || 'unknown';
            documentChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `• ${toolName}`,
                    font: 'Consolas',
                    size: 20
                  })
                ],
                indent: { left: 720 }
              })
            );
          }
        }

        // Add separator
        documentChildren.push(
          new Paragraph({
            border: {
              bottom: {
                color: 'E5E7EB',
                space: 1,
                style: BorderStyle.SINGLE,
                size: 6
              }
            },
            spacing: { after: 200 }
          })
        );
      }

      // Create document
      const doc = new Document({
        creator: author,
        title: title,
        description: 'Conversation export from OpenAgenticChat',
        sections: [{
          properties: {},
          children: documentChildren
        }]
      });

      // Generate buffer
      const buffer = await Packer.toBuffer(doc);
      return buffer;

    } catch (error) {
      this.logger.error(`DOCX export failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to export to DOCX: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Export conversation to plain text
   */
  async exportToText(messages: ExportMessage[], options: ExportOptions): Promise<string> {
    const {
      title = 'Conversation Export',
      author = 'OpenAgenticChat',
      includeTimestamps = true,
      includeMetadata = false
    } = options;

    let text = `${title}\n`;
    text += `Generated by ${author}\n`;
    text += `${new Date().toLocaleString()}\n`;
    text += '='.repeat(80) + '\n\n';

    for (const message of messages) {
      const roleLabel = message.role.toUpperCase();
      const timestamp = includeTimestamps
        ? ` [${new Date(message.timestamp).toLocaleString()}]`
        : '';

      text += `${roleLabel}${timestamp}\n`;
      text += '-'.repeat(80) + '\n';
      text += message.content + '\n';

      if (includeMetadata && (message.toolCalls?.length || message.mcpCalls?.length)) {
        const allCalls = [...(message.toolCalls || []), ...(message.mcpCalls || [])];
        text += '\nTool Calls:\n';
        allCalls.forEach(call => {
          const toolName = call.name || call.function?.name || 'unknown';
          text += `  - ${toolName}\n`;
        });
      }

      text += '\n';
    }

    return text;
  }

  /**
   * Export conversation to markdown
   */
  async exportToMarkdown(messages: ExportMessage[], options: ExportOptions): Promise<string> {
    const {
      title = 'Conversation Export',
      author = 'OpenAgenticChat',
      includeTimestamps = true,
      includeMetadata = false
    } = options;

    let markdown = `# ${title}\n\n`;
    markdown += `*Generated by ${author}*\n`;
    markdown += `*${new Date().toLocaleString()}*\n\n`;
    markdown += '---\n\n';

    for (const message of messages) {
      const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
      const timestamp = includeTimestamps
        ? ` *${new Date(message.timestamp).toLocaleString()}*`
        : '';

      markdown += `## ${roleLabel}${timestamp}\n\n`;
      markdown += message.content + '\n\n';

      if (includeMetadata && (message.toolCalls?.length || message.mcpCalls?.length)) {
        const allCalls = [...(message.toolCalls || []), ...(message.mcpCalls || [])];
        markdown += '**Tool Calls:**\n\n';
        allCalls.forEach(call => {
          const toolName = call.name || call.function?.name || 'unknown';
          markdown += `- \`${toolName}\`\n`;
        });
        markdown += '\n';
      }

      markdown += '---\n\n';
    }

    return markdown;
  }
}