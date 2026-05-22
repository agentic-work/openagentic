/**
 * Rendering API Routes
 * Only endpoints actually called by the UI are kept:
 *   POST /api/render/export  — ExportButton.tsx (PDF/DOCX/MD/Text)
 *   POST /api/render/svg     — SvgDiagram.tsx (placeholder)
 */

import { FastifyInstance } from 'fastify';
import { RenderingService } from '../services/RenderingService.js';

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
    format: 'docx' | 'markdown' | 'text';
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

    fastify.addHook('onClose', async () => {
      if (renderingService) {
        await renderingService.destroy();
      }
    });
  } catch (error) {
    fastify.log.warn('Rendering service not available - dependencies missing');
    isRenderingAvailable = false;
  }

  const checkRenderingAvailable = () => {
    if (!isRenderingAvailable || !renderingService) {
      throw new Error('Rendering service not available');
    }
  };

  fastify.post<{ Body: { description: string; theme: 'light' | 'dark' } }>('/svg', async (request, reply): Promise<void> => {
    try {
      const { description, theme } = request.body;

      if (!description?.trim()) {
        return reply.code(400).send({ error: 'Description is required' });
      }

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
            validFormats: ['docx', 'markdown', 'text']
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

  // Sprint B (2026-05-18) — per-artifact XLSX export.
  //
  // Body shape:
  //   { artifact: { type, ... }, format: 'xlsx', filename?: string }
  //
  // The artifact MUST be a streaming_table or compose_visual (or its
  // synonyms artifact_render/compose_artifact/viz_render). Anything else
  // returns 422 with a descriptive error so the UI surfaces a toast.
  fastify.post<{
    Body: {
      artifact?: any;
      format?: string;
      filename?: string;
      sheetName?: string;
      title?: string;
    };
  }>('/export-artifact', async (request, reply): Promise<void> => {
    try {
      checkRenderingAvailable();

      const { artifact, format, filename, sheetName, title } = request.body ?? {};

      if (!artifact || typeof artifact !== 'object') {
        return reply.code(400).send({ error: 'artifact is required' });
      }
      if (!format) {
        return reply.code(400).send({ error: 'format is required' });
      }
      if (format !== 'xlsx') {
        return reply.code(400).send({
          error: `Unsupported export format "${format}" — only "xlsx" is supported on this route`,
        });
      }

      let buf: Buffer;
      try {
        buf = await renderingService!.exportArtifactToXLSX(artifact, {
          sheetName,
          title,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Unsupported artifact type → 422 (semantic), not 500 (server fault).
        if (/unsupported|cannot export/i.test(msg)) {
          return reply.code(422).send({ error: msg });
        }
        throw e;
      }

      const safeBase = (filename || 'artifact').replace(/[^a-z0-9_-]/gi, '-');
      reply
        .header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        .header(
          'Content-Disposition',
          `attachment; filename="${safeBase}-${Date.now()}.xlsx"`,
        )
        .header('Cache-Control', 'no-cache')
        .send(buf);
    } catch (error) {
      fastify.log.error(
        `export-artifact failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      reply.code(500).send({
        error: 'Failed to export artifact',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
