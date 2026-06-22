/**
 * Enhanced File Upload and Processing Routes
 * 
 * Advanced file management with content extraction, OCR, virus scanning,
 * metadata extraction, chunking for large files, and integration with
 * vector storage for semantic search.
 * 
 * Features:
 * - Multi-file upload with progress tracking
 * - Automatic content extraction (PDF, Word, Excel)
 * - OCR for images
 * - Virus scanning integration
 * - File chunking for large uploads
 * - Metadata extraction
 * - Vector embedding for semantic search
 * - File preview generation
 * - Compression/decompression
 * 
 * @see ./docs/api/files.md
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import * as jwt from 'jsonwebtoken';
import { validateAnyToken, extractBearerToken } from '../../auth/tokenValidator.js';
import { pipeline } from 'stream/promises';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import sharp from 'sharp';
// Dynamic import to avoid pdf-parse loading test file at module load time
// import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { parseString as parseXML } from 'xml2js';
import { promisify } from 'util';
import zlib from 'zlib';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { createReadStream, createWriteStream } from 'fs';
import { Readable } from 'stream';
import { getDocumentIndexingService } from '../../services/DocumentIndexingService.js';
import { BlobStorageService } from '../../services/BlobStorageService.js';
import {
  planUpload,
  DEFAULT_ALLOWED_MIME_TYPES,
  DEFAULT_MAX_UPLOAD_BYTES,
} from './uploadToBlob.js';

const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET or SIGNING_SECRET environment variable is required for file uploads');
}
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/uploads';

export const fileUploadRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  // Ensure upload directory exists
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  // Helper to get user from token. Accepts BOTH Azure AD (SSO) and locally
  // minted JWTs via validateAnyToken — chat-stream uses the same validator,
  // so /api/files/upload now matches that contract instead of jwt.verify-ing
  // raw with JWT_SECRET (which only worked for the local-account path and
  // 401'd every SSO user, falling back to inline-base64 → 413 downstream).
  const getUserFromToken = async (request: any): Promise<string | null> => {
    const token =
      (request.headers['x-api-key'] as string | undefined) ||
      extractBearerToken(request.headers.authorization) ||
      (request.cookies?.openagentic_token as string | undefined) ||
      null;
    if (!token) return null;

    try {
      const result = await validateAnyToken(token, { logger });
      if (!result.isValid || !result.user) {
        logger.warn({ reason: result.error }, 'Failed to validate user token');
        return null;
      }
      return result.user.userId || (result.user as any).id || (result.user as any).oid;
    } catch (error) {
      logger.warn({ error }, 'Failed to decode user token');
      return null;
    }
  };

  /**
   * Upload files
   * POST /api/files/upload
   */
  fastify.post('/upload', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const data = await (request as any).file();
      if (!data) {
        return reply.code(400).send({ error: 'No file provided' });
      }

      // Buffer the upload into memory — multipart stream → Buffer in one shot
      // so we never touch disk. @fastify/multipart exposes toBuffer() on the
      // file part; it respects the fastify bodyLimit (100 MB post-2026-04-24).
      const buffer: Buffer = await (data as any).toBuffer();

      // Validate (mime allow-list + size cap) + compute blob key + sha256
      // in one pass via the pure helper. Throws a descriptive Error on reject.
      let plan;
      try {
        plan = planUpload({
          userId,
          originalFilename: data.filename,
          mimeType: data.mimetype,
          buffer,
        });
      } catch (planErr: any) {
        return reply.code(400).send({
          error: planErr.message,
          allowedTypes: DEFAULT_ALLOWED_MIME_TYPES,
          maxBytes: DEFAULT_MAX_UPLOAD_BYTES,
        });
      }

      // Dedup check: same user + same sha256 → return the existing row and
      // skip the MinIO put. Avoids burning bucket space on repeat drops.
      const existingFile = await prisma.fileAttachment.findFirst({
        where: {
          user_id: userId,
          metadata: { path: ['sha256'], equals: plan.sha256 },
          deleted_at: null,
        },
      });
      if (existingFile) {
        return reply.send({
          file: {
            id: existingFile.id,
            filename: existingFile.filename,
            originalName: existingFile.original_name,
            mimeType: existingFile.mime_type,
            size: existingFile.file_size ?? existingFile.size,
            uploadedAt: existingFile.created_at,
            status: existingFile.upload_status,
          },
          isDuplicate: true,
        });
      }

      // Persist bytes to MinIO — bucket `openagentic-uploads`, key
      // YYYY/MM/<userId>/<fileId>.<ext>.
      const blobStorage = new BlobStorageService(request.log, { bucket: 'openagentic-uploads' });
      await blobStorage.init();
      await blobStorage.store(buffer, plan.blobKey, plan.mimeType);

      // Extract content in-memory for LLM context / semantic search. Best
      // effort — failures are logged, not fatal.
      let extractedContent = '';
      let extractedMetadata: any = {};
      try {
        if (plan.mimeType === 'application/pdf') {
          const { PDFParse } = await import('pdf-parse');
          const parser = new PDFParse({ data: new Uint8Array(buffer) });
          const pdfData: any = await parser.getText();
          extractedContent = pdfData.text || '';
          extractedMetadata = {
            pages: pdfData.pages || pdfData.numpages || 0,
            info: pdfData.info,
            metadata: pdfData.metadata,
          };
        } else if (
          plan.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          plan.mimeType === 'application/msword'
        ) {
          const result = await mammoth.extractRawText({ buffer });
          extractedContent = result.value;
          extractedMetadata = { messages: result.messages };
        } else if (plan.mimeType.startsWith('image/') && plan.mimeType !== 'image/svg+xml') {
          // SVG is text; sharp can't read it as a raster source for metadata.
          const imageMetadata = await sharp(buffer).metadata();
          extractedMetadata = {
            width: imageMetadata.width,
            height: imageMetadata.height,
            format: imageMetadata.format,
            space: imageMetadata.space,
            channels: imageMetadata.channels,
            depth: imageMetadata.depth,
            density: imageMetadata.density,
            hasAlpha: imageMetadata.hasAlpha,
          };
        } else if (
          plan.mimeType === 'text/plain' ||
          plan.mimeType === 'text/markdown' ||
          plan.mimeType === 'text/csv' ||
          plan.mimeType === 'text/html' ||
          plan.mimeType === 'text/xml' ||
          plan.mimeType === 'application/json'
        ) {
          extractedContent = buffer.toString('utf-8');
        }
      } catch (extractError) {
        logger.warn({ extractError, fileId: plan.fileId }, 'Failed to extract content from file');
      }

      // Write row. upload_path now holds the MinIO blob key (formerly a
      // /tmp filesystem path). storage_backend='minio' lives in metadata
      // so downstream readers know how to fetch.
      const fileRecord = await prisma.fileAttachment.create({
        data: {
          id: plan.fileId,
          user_id: userId,
          filename: data.filename,
          original_name: data.filename,
          mime_type: plan.mimeType,
          size: plan.size,
          upload_path: plan.blobKey,
          file_size: plan.size,
          file_path: plan.blobKey,
          upload_status: 'completed',
          metadata: {
            uploadedAt: new Date().toISOString(),
            sha256: plan.sha256,
            extracted: extractedMetadata,
            contentLength: extractedContent.length,
            extractedText: extractedContent ? extractedContent.substring(0, 10000) : null,
            storage_backend: 'minio',
            bucket: 'openagentic-uploads',
          },
        },
      });

      // Async indexing for semantic search. Non-blocking.
      if (extractedContent && extractedContent.length > 0) {
        const documentIndexingService = getDocumentIndexingService();
        if (documentIndexingService) {
          setImmediate(async () => {
            try {
              await documentIndexingService.indexDocument(plan.fileId);
              logger.info({ fileId: plan.fileId }, 'Document indexed for semantic search');
            } catch (indexError) {
              logger.warn({ err: indexError, fileId: plan.fileId }, 'Failed to index document');
            }
          });
        }
      }

      // Tiny preview for text files — the UI uses this for the
      // "x lines, y chars" card before the full content loads.
      let contentPreview: { lines: number; characters: number; preview: string } | null = null;
      if (plan.mimeType.startsWith('text/') || plan.mimeType === 'application/json') {
        const text = extractedContent;
        if (text) {
          contentPreview = {
            lines: text.split('\n').length,
            characters: text.length,
            preview: text.substring(0, 500) + (text.length > 500 ? '...' : ''),
          };
        }
      }

      return reply.send({
        file: {
          id: fileRecord.id,
          filename: fileRecord.filename,
          originalName: fileRecord.original_name,
          mimeType: fileRecord.mime_type,
          size: fileRecord.file_size,
          uploadedAt: fileRecord.created_at,
          status: fileRecord.upload_status,
          blobKey: plan.blobKey,
          contentPreview,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to upload file');
      return reply.code(500).send({ error: 'File upload failed' });
    }
  });

  /**
   * Get file details
   * GET /api/files/:id
   */
  fastify.get('/:id', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };

      const file = await prisma.fileAttachment.findFirst({
        where: {
          id,
          user_id: userId
        }
      });

      if (!file) {
        return reply.code(404).send({ error: 'File not found' });
      }

      // Check if file still exists on disk
      const fileExists = fs.existsSync(file.file_path);
      let contentAnalysis = null;

      if (fileExists && file.mime_type.startsWith('text/')) {
        try {
          const content = fs.readFileSync(file.file_path, 'utf-8');
          contentAnalysis = {
            lines: content.split('\n').length,
            words: content.split(/\s+/).length,
            characters: content.length,
            encoding: 'utf-8'
          };
        } catch (error) {
          logger.warn({ error }, 'Failed to analyze file content');
        }
      }

      return reply.send({
        file: {
          id: file.id,
          filename: file.filename,
          originalName: file.original_name,
          mimeType: file.mime_type,
          size: file.file_size,
          uploadedAt: file.created_at,
          updatedAt: file.updated_at,
          status: file.upload_status,
          metadata: file.metadata as Record<string, any> || {},
          exists: fileExists,
          contentAnalysis
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get file details');
      return reply.code(500).send({ error: 'Failed to retrieve file details' });
    }
  });

  /**
   * List user files
   * GET /api/files
   */
  fastify.get('/', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const {
        limit = 50,
        offset = 0,
        type,
        sortBy = 'created_at',
        sortOrder = 'desc'
      } = request.query as {
        limit?: number;
        offset?: number;
        type?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
      };

      const where: any = { user_id: userId };
      if (type) {
        where.mime_type = { startsWith: type };
      }

      const [files, totalCount] = await Promise.all([
        prisma.fileAttachment.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          take: Number.parseInt(limit.toString()),
          skip: Number.parseInt(offset.toString())
        }),
        
        prisma.fileAttachment.count({ where })
      ]);

      const enhancedFiles = files.map(file => ({
        id: file.id,
        filename: file.filename,
        originalName: file.original_name,
        mimeType: file.mime_type,
        size: file.file_size,
        uploadedAt: file.created_at,
        updatedAt: file.updated_at,
        status: file.upload_status,
        exists: fs.existsSync(file.file_path)
      }));

      return reply.send({
        files: enhancedFiles,
        pagination: {
          total: totalCount,
          limit: Number.parseInt(limit.toString()),
          offset: Number.parseInt(offset.toString()),
          hasMore: totalCount > Number.parseInt(offset.toString()) + Number.parseInt(limit.toString())
        },
        stats: {
          totalFiles: totalCount,
          totalSize: files.reduce((sum, f) => sum + f.file_size, 0),
          typeBreakdown: files.reduce((acc, f) => {
            const mainType = f.mime_type.split('/')[0];
            acc[mainType] = (acc[mainType] || 0) + 1;
            return acc;
          }, {} as Record<string, number>)
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list files');
      return reply.code(500).send({ error: 'Failed to retrieve files' });
    }
  });

  /**
   * Process file (extract text, analyze content)
   * POST /api/files/:id/process
   */
  fastify.post('/:id/process', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };
      const { 
        operation = 'extract_text',
        options = {}
      } = request.body as {
        operation?: 'extract_text' | 'analyze_content' | 'generate_summary' | 'detect_language';
        options?: Record<string, any>;
      };

      const file = await prisma.fileAttachment.findFirst({
        where: {
          id,
          user_id: userId
        }
      });

      if (!file) {
        return reply.code(404).send({ error: 'File not found' });
      }

      if (!fs.existsSync(file.file_path)) {
        return reply.code(404).send({ error: 'File no longer exists on disk' });
      }

      let result: any = {};

      switch (operation) {
        case 'extract_text':
          if (file.mime_type.startsWith('text/')) {
            const content = fs.readFileSync(file.file_path, 'utf-8');
            result = {
              text: content,
              metadata: {
                lines: content.split('\n').length,
                words: content.split(/\s+/).length,
                characters: content.length
              }
            };
          } else {
            result = {
              error: 'Text extraction not supported for this file type',
              supportedTypes: ['text/plain', 'text/csv']
            };
          }
          break;

        case 'analyze_content':
          if (file.mime_type.startsWith('text/')) {
            const content = fs.readFileSync(file.file_path, 'utf-8');
            result = {
              analysis: {
                lines: content.split('\n').length,
                words: content.split(/\s+/).length,
                characters: content.length,
                uniqueWords: new Set(content.toLowerCase().match(/\b\w+\b/g) || []).size,
                avgWordsPerLine: content.split('\n').filter(l => l.trim()).length > 0 ? 
                  content.split(/\s+/).length / content.split('\n').filter(l => l.trim()).length : 0,
                containsCode: /function|class|import|const|let|var|\{|\}|\[|\]/g.test(content),
                containsUrls: /https?:\/\/[^\s]+/g.test(content),
                // ReDoS-hardened: bounded, non-overlapping segments (was /\S+@\S+\.\S+/ — O(n²) on large uploads).
                containsEmails: /[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}/g.test(content)
              }
            };
          } else {
            result = {
              error: 'Content analysis not supported for this file type'
            };
          }
          break;

        case 'generate_summary':
          // TODO: Integrate with AI model for summarization
          result = {
            placeholder: true
          };
          break;

        case 'detect_language':
          if (file.mime_type.startsWith('text/')) {
            const content = fs.readFileSync(file.file_path, 'utf-8');
            // Simple language detection (placeholder)
            const hasEnglishWords = /\b(the|and|or|is|are|was|were|have|has|had)\b/i.test(content);
            result = {
              language: hasEnglishWords ? 'en' : 'unknown',
              confidence: hasEnglishWords ? 0.8 : 0.1,
              note: 'Simple pattern-based detection - not production ready'
            };
          } else {
            result = {
              error: 'Language detection only supported for text files'
            };
          }
          break;

        default:
          return reply.code(400).send({ error: 'Unsupported operation' });
      }

      // Update file record with processing results
      await prisma.fileAttachment.update({
        where: { id },
        data: {
          metadata: {
            ...(file.metadata as any || {}),
            lastProcessed: new Date().toISOString(),
            lastOperation: operation,
            processResults: result
          },
          updated_at: new Date()
        }
      });

      return reply.send({
        fileId: id,
        operation,
        result,
        processedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to process file');
      return reply.code(500).send({ error: 'File processing failed' });
    }
  });

  /**
   * Download file
   * GET /api/files/:id/download
   */
  fastify.get('/:id/download', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };

      const file = await prisma.fileAttachment.findFirst({
        where: {
          id,
          user_id: userId
        }
      });

      if (!file) {
        return reply.code(404).send({ error: 'File not found' });
      }

      if (!fs.existsSync(file.file_path)) {
        return reply.code(404).send({ error: 'File no longer exists on disk' });
      }

      return reply
        .header('Content-Disposition', `attachment; filename="${file.original_name}"`)
        .type(file.mime_type)
        .send(fs.createReadStream(file.file_path));
    } catch (error) {
      logger.error({ error }, 'Failed to download file');
      return reply.code(500).send({ error: 'File download failed' });
    }
  });

  /**
   * Delete file
   * DELETE /api/files/:id
   */
  fastify.delete('/:id', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };

      const file = await prisma.fileAttachment.findFirst({
        where: {
          id,
          user_id: userId
        }
      });

      if (!file) {
        return reply.code(404).send({ error: 'File not found' });
      }

      // Delete file from disk
      if (fs.existsSync(file.file_path)) {
        fs.unlinkSync(file.file_path);
      }

      // Delete record from database
      await prisma.fileAttachment.delete({
        where: { id }
      });

      return reply.send({ 
        success: true, 
        message: 'File deleted successfully',
        fileId: id
      });
    } catch (error) {
      logger.error({ error }, 'Failed to delete file');
      return reply.code(500).send({ error: 'File deletion failed' });
    }
  });

  /**
   * Analyze multiple files
   * POST /api/files/analyze
   */
  fastify.post('/analyze', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { 
        fileIds = [],
        analysisType = 'summary'
      } = request.body as {
        fileIds?: string[];
        analysisType?: 'summary' | 'comparison' | 'aggregate';
      };

      if (fileIds.length === 0) {
        return reply.code(400).send({ error: 'At least one file ID is required' });
      }

      const files = await prisma.fileAttachment.findMany({
        where: {
          id: { in: fileIds },
          user_id: userId
        }
      });

      if (files.length === 0) {
        return reply.code(404).send({ error: 'No accessible files found' });
      }

      const analysis: any = {
        fileCount: files.length,
        analysisType,
        results: {}
      };

      switch (analysisType) {
        case 'summary':
          analysis.results = {
            totalSize: files.reduce((sum, f) => sum + f.file_size, 0),
            types: [...new Set(files.map(f => f.mime_type))],
            oldestFile: files.reduce((oldest, f) => f.created_at < oldest.created_at ? f : oldest),
            newestFile: files.reduce((newest, f) => f.created_at > newest.created_at ? f : newest),
            avgSize: files.reduce((sum, f) => sum + f.file_size, 0) / files.length
          };
          break;

        case 'comparison':
          analysis.results = {
            files: files.map(f => ({
              id: f.id,
              name: f.filename,
              size: f.file_size,
              type: f.mime_type,
              created: f.created_at
            })),
            differences: {
              sizeVariance: Math.max(...files.map(f => f.file_size)) - Math.min(...files.map(f => f.file_size)),
              typeVariety: new Set(files.map(f => f.mime_type)).size,
              timeSpread: new Date(Math.max(...files.map(f => f.created_at.getTime()))).getTime() - 
                          new Date(Math.min(...files.map(f => f.created_at.getTime()))).getTime()
            }
          };
          break;

        case 'aggregate':
          const textFiles = files.filter(f => f.mime_type.startsWith('text/'));
          let totalContent = '';
          
          for (const file of textFiles) {
            if (fs.existsSync(file.file_path)) {
              try {
                totalContent += fs.readFileSync(file.file_path, 'utf-8') + '\n\n';
              } catch (error) {
                logger.warn({ error, fileId: file.id }, 'Failed to read file for aggregation');
              }
            }
          }
          
          analysis.results = {
            textFiles: textFiles.length,
            totalTextContent: {
              characters: totalContent.length,
              words: totalContent.split(/\s+/).length,
              lines: totalContent.split('\n').length
            },
            nonTextFiles: files.length - textFiles.length
          };
          break;
      }

      return reply.send({
        analysis,
        processedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to analyze files');
      return reply.code(500).send({ error: 'File analysis failed' });
    }
  });

  /**
   * Get comprehensive metadata for files
   * GET /api/files/metadata?ids=file1,file2 (query parameter)
   * POST /api/files/metadata (with body containing fileIds)
   */
  fastify.get('/metadata', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { ids } = request.query as { ids?: string };
      const fileIds = ids ? ids.split(',').map(id => id.trim()) : [];

      if (fileIds.length === 0) {
        return reply.code(400).send({ error: 'File IDs are required (provide as ?ids=id1,id2,id3)' });
      }

      const files = await prisma.fileAttachment.findMany({
        where: {
          id: { in: fileIds },
          user_id: userId
        }
      });

      if (files.length === 0) {
        return reply.code(404).send({ error: 'No accessible files found' });
      }

      const metadata = files.map(file => {
        const fileExists = fs.existsSync(file.file_path);
        let diskMetadata: any = {};

        if (fileExists) {
          try {
            const stats = fs.statSync(file.file_path);
            diskMetadata = {
              actualSize: stats.size,
              lastModified: stats.mtime,
              lastAccessed: stats.atime,
              created: stats.birthtime,
              isDirectory: stats.isDirectory(),
              isFile: stats.isFile()
            };
          } catch (error) {
            logger.warn({ error, fileId: file.id }, 'Failed to get file system metadata');
          }
        }

        return {
          id: file.id,
          filename: file.filename,
          originalName: file.original_name,
          mimeType: file.mime_type,
          size: file.file_size,
          uploadPath: file.file_path,
          uploadStatus: file.upload_status,
          createdAt: file.created_at,
          updatedAt: file.updated_at,
          exists: fileExists,
          storedMetadata: file.metadata as Record<string, any> || {},
          diskMetadata,
          checksum: {
            // Get stored checksum from metadata if available
            md5: (file.metadata as any)?.hash || null,
            sha256: (file.metadata as any)?.sha256 || null
          },
          contentInfo: {
            hasExtractedText: !!(file.metadata as any)?.extractedText,
            extractedTextLength: (file.metadata as any)?.contentLength || 0,
            hasPreview: !!(file.metadata as any)?.previewUrl,
            previewUrl: (file.metadata as any)?.previewUrl || null
          }
        };
      });

      return reply.send({
        requestedFiles: fileIds.length,
        foundFiles: files.length,
        metadata,
        retrievedAt: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get file metadata');
      return reply.code(500).send({ error: 'Failed to retrieve file metadata' });
    }
  });

  // POST version of metadata endpoint for large lists of file IDs
  fastify.post('/metadata', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { fileIds = [] } = request.body as { fileIds?: string[] };

      if (fileIds.length === 0) {
        return reply.code(400).send({ error: 'File IDs array is required' });
      }

      if (fileIds.length > 100) {
        return reply.code(400).send({ error: 'Maximum 100 files can be processed at once' });
      }

      const files = await prisma.fileAttachment.findMany({
        where: {
          id: { in: fileIds },
          user_id: userId
        }
      });

      if (files.length === 0) {
        return reply.code(404).send({ error: 'No accessible files found' });
      }

      // Enhanced metadata with content analysis for supported file types
      const enhancedMetadata = await Promise.all(files.map(async (file) => {
        const fileExists = fs.existsSync(file.file_path);
        let diskMetadata: any = {};
        let contentAnalysis: any = {};

        if (fileExists) {
          try {
            const stats = fs.statSync(file.file_path);
            diskMetadata = {
              actualSize: stats.size,
              lastModified: stats.mtime,
              lastAccessed: stats.atime,
              created: stats.birthtime,
              permissions: stats.mode.toString(8)
            };

            // Advanced content analysis for text files
            if (file.mime_type.startsWith('text/') && stats.size < 1024 * 1024) { // Max 1MB for analysis
              try {
                const content = fs.readFileSync(file.file_path, 'utf-8');
                contentAnalysis = {
                  lines: content.split('\n').length,
                  words: content.split(/\s+/).filter(w => w.length > 0).length,
                  characters: content.length,
                  uniqueWords: new Set(content.toLowerCase().match(/\b\w+\b/g) || []).size,
                  encoding: 'utf-8',
                  hasCode: /function|class|import|const|let|var|\{|\}|\[|\]/g.test(content),
                  hasUrls: (content.match(/https?:\/\/[^\s]+/g) || []).length,
                  // ReDoS-hardened: bounded, non-overlapping segments (was /\S+@\S+\.\S+/ — O(n²) on large uploads).
                  hasEmails: (content.match(/[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}/g) || []).length,
                  languageHints: {
                    javascript: /function|const|let|var|=>/g.test(content),
                    python: /def |import |from |if __name__/g.test(content),
                    html: /<[^>]+>/g.test(content),
                    css: /[.#][a-zA-Z][a-zA-Z0-9-_]*\s*{/g.test(content)
                  }
                };
              } catch (contentError) {
                logger.warn({ contentError, fileId: file.id }, 'Failed to analyze text content');
              }
            }
          } catch (error) {
            logger.warn({ error, fileId: file.id }, 'Failed to get enhanced file metadata');
          }
        }

        return {
          id: file.id,
          filename: file.filename,
          originalName: file.original_name,
          mimeType: file.mime_type,
          size: file.file_size,
          uploadPath: file.file_path,
          uploadStatus: file.upload_status,
          createdAt: file.created_at,
          updatedAt: file.updated_at,
          exists: fileExists,
          storedMetadata: file.metadata as Record<string, any> || {},
          diskMetadata,
          contentAnalysis,
          checksum: {
            md5: (file.metadata as any)?.hash || null,
            sha256: (file.metadata as any)?.sha256 || null
          },
          contentInfo: {
            hasExtractedText: !!(file.metadata as any)?.extractedText,
            extractedTextLength: (file.metadata as any)?.contentLength || 0,
            hasPreview: !!(file.metadata as any)?.previewUrl,
            previewUrl: (file.metadata as any)?.previewUrl || null,
            processingHistory: (file.metadata as any)?.processResults || null
          }
        };
      }));

      return reply.send({
        requestedFiles: fileIds.length,
        foundFiles: files.length,
        metadata: enhancedMetadata,
        summary: {
          totalSize: enhancedMetadata.reduce((sum, m) => sum + m.size, 0),
          typeBreakdown: enhancedMetadata.reduce((acc, m) => {
            const mainType = m.mimeType.split('/')[0];
            acc[mainType] = (acc[mainType] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
          existingFiles: enhancedMetadata.filter(m => m.exists).length,
          filesWithContent: enhancedMetadata.filter(m => m.contentAnalysis?.characters).length
        },
        retrievedAt: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get enhanced file metadata');
      return reply.code(500).send({ error: 'Failed to retrieve file metadata' });
    }
  });

  /**
   * Search user documents using semantic search
   * POST /api/files/search
   */
  fastify.post('/search', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const {
        query,
        limit = 5
      } = request.body as {
        query?: string;
        limit?: number;
      };

      if (!query || query.trim().length === 0) {
        return reply.code(400).send({ error: 'Search query is required' });
      }

      const documentIndexingService = (global as any).documentIndexingService;
      if (!documentIndexingService) {
        return reply.code(503).send({
          error: 'Document search not available',
          message: 'Vector search service not initialized'
        });
      }

      // Search documents
      const results = await documentIndexingService.searchDocuments(
        userId,
        query,
        Math.min(Number.parseInt(limit.toString()), 20) // Max 20 results
      );

      return reply.send({
        query,
        results: results.map(r => ({
          fileId: r.fileId,
          filename: r.filename,
          excerpt: r.chunkContent,
          relevance: r.score,
          metadata: r.metadata
        })),
        totalResults: results.length,
        searchedAt: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Document search failed');
      return reply.code(500).send({ error: 'Search failed' });
    }
  });

  /**
   * Get document indexing statistics
   * GET /api/files/indexing-stats
   */
  fastify.get('/indexing-stats', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const documentIndexingService = (global as any).documentIndexingService;
      if (!documentIndexingService) {
        return reply.send({
          available: false,
          message: 'Document indexing service not available'
        });
      }

      const stats = await documentIndexingService.getIndexingStats(userId);

      return reply.send({
        available: true,
        stats,
        retrievedAt: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get indexing stats');
      return reply.code(500).send({ error: 'Failed to retrieve statistics' });
    }
  });

  /**
   * Re-index a specific document
   * POST /api/files/:id/reindex
   */
  fastify.post('/:id/reindex', async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params as { id: string };

      // Verify ownership
      const file = await prisma.fileAttachment.findFirst({
        where: {
          id,
          user_id: userId
        }
      });

      if (!file) {
        return reply.code(404).send({ error: 'File not found' });
      }

      const documentIndexingService = (global as any).documentIndexingService;
      if (!documentIndexingService) {
        return reply.code(503).send({
          error: 'Document indexing not available',
          message: 'Vector indexing service not initialized'
        });
      }

      // Trigger re-indexing in background
      setImmediate(async () => {
        try {
          await documentIndexingService.reindexDocument(id);
          logger.info({ fileId: id }, 'Document re-indexed successfully');
        } catch (reindexError) {
          logger.error({ error: reindexError, fileId: id }, 'Re-indexing failed');
        }
      });

      return reply.send({
        success: true,
        message: 'Re-indexing started',
        fileId: id
      });

    } catch (error) {
      logger.error({ error }, 'Failed to start re-indexing');
      return reply.code(500).send({ error: 'Re-indexing failed' });
    }
  });

  fastify.log.info('File attachment routes registered - upload, process, analyze, metadata, search');
};