/**
 * Rendering API Routes for Pure Frontend Architecture
 * Server-side rendering endpoints for charts, diagrams, code, etc.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RenderingService } from '../services/RenderingService.js';

// NOTE: MermaidRequest removed - diagrams now use React Flow client-side

interface ChartRequest {
  chartData: {
    type: 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'radar' | 'doughnut' | 'bubble';
    data: any[];
    title?: string;
    xAxis?: string;
    yAxis?: string;
    dataKeys?: string[];
    colors?: string[];
    options?: any;
  };
  theme: 'light' | 'dark';
  height: number;
  format: 'png' | 'svg';
}

interface PipelineRequest {
  theme: 'light' | 'dark';
  embedded: boolean;
  format: 'svg' | 'png';
}

interface CodeRequest {
  code: string;
  language: string;
  theme: 'light' | 'dark';
  readOnly: boolean;
  showLineNumbers: boolean;
  format: 'png' | 'html';
}

interface MarkdownRequest {
  markdown: string;
  theme: 'light' | 'dark';
  enableMath: boolean;
  enableHighlight: boolean;
}

interface ExportRequest {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: string;
    metadata?: any;
    toolCalls?: any[];
    mcpCalls?: any[];
  }>;
  options: {
    format: 'pdf' | 'docx' | 'markdown' | 'text';
    includeTimestamps?: boolean;
    includeMetadata?: boolean;
    title?: string;
    author?: string;
    theme?: 'light' | 'dark';
  };
}

export default async function renderRoutes(fastify: FastifyInstance) {
  let renderingService: RenderingService | null = null;
  let isRenderingAvailable = false;

  try {
    renderingService = new RenderingService(fastify.log as any);
    await renderingService.initialize();
    isRenderingAvailable = true;
    fastify.log.info('Rendering service initialized successfully');

    // Cleanup on shutdown
    fastify.addHook('onClose', async () => {
      if (renderingService) {
        await renderingService.destroy();
      }
    });
  } catch (error) {
    fastify.log.warn('Rendering service not available - dependencies missing');
    isRenderingAvailable = false;
  }

  // Helper to check if rendering is available
  const checkRenderingAvailable = () => {
    if (!isRenderingAvailable || !renderingService) {
      throw new Error('Rendering service not available - native dependencies missing');
    }
  };

  // NOTE: Mermaid rendering endpoint removed - diagrams now use React Flow client-side

  /**
   * Render charts
   * POST /api/render/chart
   */
  fastify.post<{ Body: ChartRequest }>('/chart', async (request, reply): Promise<void> => {
    try {
      checkRenderingAvailable();
      const { chartData, theme, height, format } = request.body;

      if (!chartData?.data?.length) {
        return reply.code(400).send({ error: 'Chart data is required' });
      }

      const buffer = await renderingService!.renderChart({
        chartData,
        theme: theme || 'light',
        height: height || 400,
        format: format || 'png'
      });

      reply
        .header('Content-Type', 'image/png')
        .header('Cache-Control', 'public, max-age=1800') // Cache for 30 minutes
        .send(buffer);

    } catch (error) {
      fastify.log.error(`Chart rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ 
        error: 'Failed to render chart',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Render pipeline visualization
   * POST /api/render/pipeline
   */
  fastify.post<{ Body: PipelineRequest }>('/pipeline', async (request, reply): Promise<void> => {
    try {
      checkRenderingAvailable();
      const { theme, embedded, format } = request.body;

      const buffer = await renderingService.renderPipelineVisualization({
        theme: theme || 'dark',
        embedded: embedded || false,
        format: format || 'svg'
      });

      const contentType = format === 'svg' ? 'image/svg+xml' : 'image/png';
      
      reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'public, max-age=7200') // Cache for 2 hours
        .send(buffer);

    } catch (error) {
      fastify.log.error(`Pipeline rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ 
        error: 'Failed to render pipeline',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Render Monaco code editor
   * POST /api/render/code-editor
   */
  fastify.post<{ Body: CodeRequest }>('/code-editor', async (request, reply): Promise<void> => {
    try {
      checkRenderingAvailable();
      const { code, language, theme, readOnly, showLineNumbers, format } = request.body;

      if (!code?.trim()) {
        return reply.code(400).send({ error: 'Code is required' });
      }

      const result = await renderingService.renderCodeEditor({
        code: code.trim(),
        language: language || 'javascript',
        theme: theme || 'light',
        readOnly: readOnly !== false,
        showLineNumbers: showLineNumbers !== false,
        format: format || 'png'
      });

      if (format === 'html') {
        reply
          .header('Content-Type', 'text/html')
          .header('Cache-Control', 'public, max-age=1800')
          .send(result);
      } else {
        reply
          .header('Content-Type', 'image/png')
          .header('Cache-Control', 'public, max-age=1800')
          .send(result);
      }

    } catch (error) {
      fastify.log.error(`Code editor rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ 
        error: 'Failed to render code editor',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Render markdown with math and syntax highlighting
   * POST /api/render/markdown
   */
  fastify.post<{ Body: MarkdownRequest }>('/markdown', async (request, reply): Promise<void> => {
    try {
      checkRenderingAvailable();
      const { markdown, theme, enableMath, enableHighlight } = request.body;

      if (!markdown?.trim()) {
        return reply.code(400).send({ error: 'Markdown content is required' });
      }

      const html = await renderingService.renderMarkdown({
        markdown: markdown.trim(),
        theme: theme || 'light',
        enableMath: enableMath !== false,
        enableHighlight: enableHighlight !== false
      });

      reply
        .header('Content-Type', 'text/html')
        .header('Cache-Control', 'public, max-age=1800')
        .send(html);

    } catch (error) {
      fastify.log.error(`Markdown rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ 
        error: 'Failed to render markdown',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Render syntax-highlighted code block
   * POST /api/render/code-block
   */
  fastify.post<{ Body: { code: string; language: string; theme: 'light' | 'dark' } }>('/code-block', async (request, reply): Promise<void> => {
    try {
      checkRenderingAvailable();
      const { code, language, theme } = request.body;

      if (!code?.trim()) {
        return reply.code(400).send({ error: 'Code is required' });
      }

      const html = await renderingService.renderCodeBlock(
        code.trim(),
        language || 'javascript',
        theme || 'light'
      );

      reply
        .header('Content-Type', 'text/html')
        .header('Cache-Control', 'public, max-age=3600')
        .send(html);

    } catch (error) {
      fastify.log.error(`Code block rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ 
        error: 'Failed to render code block',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Render data table
   * POST /api/render/table
   */
  fastify.post<{ Body: { data: any[]; theme: 'light' | 'dark' } }>('/table', async (request, reply): Promise<void> => {
    try {
      checkRenderingAvailable();
      const { data, theme } = request.body;

      if (!Array.isArray(data) || !data.length) {
        return reply.code(400).send({ error: 'Table data array is required' });
      }

      const html = await renderingService.renderTable(data, theme || 'light');

      reply
        .header('Content-Type', 'text/html')
        .header('Cache-Control', 'public, max-age=1800')
        .send(html);

    } catch (error) {
      fastify.log.error(`Table rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ 
        error: 'Failed to render table',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Render complex document with mixed content
   * POST /api/render/document
   */
  fastify.post<{ Body: { 
    content: {
      markdown?: string;
      charts?: any[];
      diagrams?: string[];
      tables?: any[][];
    };
    theme: 'light' | 'dark' 
  } }>('/document', async (request, reply): Promise<void> => {
    try {
      const { content, theme } = request.body;

      if (!content || typeof content !== 'object') {
        return reply.code(400).send({ error: 'Document content is required' });
      }

      const html = await renderingService.renderDocument(content, theme || 'light');

      reply
        .header('Content-Type', 'text/html')
        .header('Cache-Control', 'public, max-age=1800')
        .send(html);

    } catch (error) {
      fastify.log.error(`Document rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({ 
        error: 'Failed to render document',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Render SVG from description (placeholder endpoint)
   * POST /api/render/svg
   * Note: This is a placeholder - actual SVG generation from text would require AI or a specialized library
   */
  fastify.post<{ Body: { description: string; theme: 'light' | 'dark' } }>('/svg', async (request, reply): Promise<void> => {
    try {
      const { description, theme } = request.body;

      if (!description?.trim()) {
        return reply.code(400).send({ error: 'Description is required' });
      }

      // For now, return a placeholder SVG indicating the feature is not yet implemented
      // In the future, this could use an LLM to generate SVG from text descriptions
      const placeholderSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
          <rect width="400" height="200" fill="${theme === 'dark' ? '#1a1a1a' : '#f5f5f5'}"/>
          <text x="200" y="100" text-anchor="middle" font-family="Arial" font-size="16" fill="${theme === 'dark' ? '#ffffff' : '#000000'}">
            SVG generation from text is not yet implemented
          </text>
          <text x="200" y="130" text-anchor="middle" font-family="Arial" font-size="12" fill="${theme === 'dark' ? '#cccccc' : '#666666'}">
            Please provide raw SVG code instead
          </text>
        </svg>
      `;

      reply
        .header('Content-Type', 'image/svg+xml')
        .header('Cache-Control', 'public, max-age=3600')
        .send(placeholderSvg);

    } catch (error) {
      fastify.log.error(`SVG rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({
        error: 'Failed to render SVG',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Export conversation to various formats (PDF, DOCX, Markdown, Text)
   * POST /api/render/export
   */
  fastify.post<{ Body: ExportRequest }>('/export', async (request, reply): Promise<void> => {
    try {
      checkRenderingAvailable();

      const { messages, options } = request.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return reply.code(400).send({ error: 'Messages array is required and cannot be empty' });
      }

      if (!options || !options.format) {
        return reply.code(400).send({ error: 'Export format is required' });
      }

      const exportOptions = {
        format: options.format,
        includeTimestamps: options.includeTimestamps !== false,
        includeMetadata: options.includeMetadata || false,
        title: options.title || 'Conversation Export',
        author: options.author || 'OpenAgenticChat',
        theme: options.theme || 'light'
      };

      switch (options.format) {
        case 'pdf': {
          const pdfBuffer = await renderingService!.exportToPDF(messages, exportOptions);

          reply
            .header('Content-Type', 'application/pdf')
            .header('Content-Disposition', `attachment; filename="conversation-${Date.now()}.pdf"`)
            .header('Cache-Control', 'no-cache')
            .send(pdfBuffer);
          break;
        }

        case 'docx': {
          const docxBuffer = await renderingService!.exportToDOCX(messages, exportOptions);

          reply
            .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            .header('Content-Disposition', `attachment; filename="conversation-${Date.now()}.docx"`)
            .header('Cache-Control', 'no-cache')
            .send(docxBuffer);
          break;
        }

        case 'markdown': {
          const markdown = await renderingService!.exportToMarkdown(messages, exportOptions);

          reply
            .header('Content-Type', 'text/markdown')
            .header('Content-Disposition', `attachment; filename="conversation-${Date.now()}.md"`)
            .header('Cache-Control', 'no-cache')
            .send(markdown);
          break;
        }

        case 'text': {
          const text = await renderingService!.exportToText(messages, exportOptions);

          reply
            .header('Content-Type', 'text/plain')
            .header('Content-Disposition', `attachment; filename="conversation-${Date.now()}.txt"`)
            .header('Cache-Control', 'no-cache')
            .send(text);
          break;
        }

        default:
          return reply.code(400).send({
            error: 'Invalid export format',
            validFormats: ['pdf', 'docx', 'markdown', 'text']
          });
      }

    } catch (error) {
      fastify.log.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
      reply.code(500).send({
        error: 'Failed to export conversation',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}