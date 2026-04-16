/**
 * Document RAG Service
 *
 * Handles user document upload, text extraction, semantic chunking,
 * embedding generation, and retrieval-augmented generation context.
 *
 * Supports: text/plain, text/markdown, application/json.
 * Stores embeddings via raw SQL (pgvector) alongside Prisma-managed rows.
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import type { EmbeddingResult } from './UniversalEmbeddingService.js';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChunkInfo {
  content: string;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  sectionTitle: string | null;
  pageNumber: number | null;
  tokenCount: number;
}

interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  sectionTitle: string | null;
  pageNumber: number | null;
  tokenCount: number;
  similarity: number;
  filename: string;
  mimeType: string;
  documentTitle: string | null;
}

interface RAGContextBlock {
  text: string;
  totalTokens: number;
  chunkCount: number;
  sources: Array<{ filename: string; section?: string; page?: number }>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const logger = loggers.services.child({ service: 'DocumentRAGService' });

export class DocumentRAGService {
  // Singleton
  private static instance: DocumentRAGService | null = null;

  private embeddingService: UniversalEmbeddingService | null = null;
  private embeddingDimensions: number = 0;
  private initialised = false;

  private constructor() {}

  static getInstance(): DocumentRAGService {
    if (!DocumentRAGService.instance) {
      DocumentRAGService.instance = new DocumentRAGService();
    }
    return DocumentRAGService.instance;
  }

  // ------------------------------------------------------------------
  // Lazy initialisation of embedding service
  // ------------------------------------------------------------------

  private ensureEmbeddings(): UniversalEmbeddingService {
    if (!this.embeddingService) {
      try {
        this.embeddingService = new UniversalEmbeddingService(logger);
        const info = this.embeddingService.getInfo();
        this.embeddingDimensions = info.dimensions;
        logger.info(
          { provider: info.provider, model: info.model, dimensions: info.dimensions },
          'DocumentRAGService embedding service initialised'
        );
      } catch (err) {
        logger.error({ err }, 'Failed to initialise embedding service');
        throw new Error('Embedding service unavailable');
      }
    }
    return this.embeddingService;
  }

  // ------------------------------------------------------------------
  // 1. uploadDocument
  // ------------------------------------------------------------------

  async uploadDocument(
    userId: string,
    filename: string,
    mimeType: string,
    content: Buffer
  ): Promise<{ id: string; status: string; chunkCount: number }> {
    // Create document record
    const doc = await prisma.document.create({
      data: {
        user_id: userId,
        filename,
        mime_type: mimeType,
        file_size: content.length,
        status: 'processing',
      },
    });

    try {
      // ----- Text extraction -----
      const text = this.extractText(mimeType, content);

      if (!text || text.trim().length === 0) {
        await prisma.document.update({
          where: { id: doc.id },
          data: { status: 'failed', error: 'No text could be extracted from the document' },
        });
        return { id: doc.id, status: 'failed', chunkCount: 0 };
      }

      // ----- Semantic chunking -----
      const chunks = this.chunkText(text);

      if (chunks.length === 0) {
        await prisma.document.update({
          where: { id: doc.id },
          data: { status: 'failed', error: 'Document produced zero chunks after processing' },
        });
        return { id: doc.id, status: 'failed', chunkCount: 0 };
      }

      // ----- Generate embeddings and store chunks -----
      const embSvc = this.ensureEmbeddings();
      let totalTokens = 0;

      for (const chunk of chunks) {
        const embeddingResult: EmbeddingResult = await embSvc.generateEmbedding(chunk.content);
        const vectorLiteral = this.toVectorLiteral(embeddingResult.embedding);
        totalTokens += chunk.tokenCount;

        // Insert chunk with embedding via raw SQL (pgvector)
        await prisma.$executeRawUnsafe(
          `INSERT INTO document_chunks
             (id, document_id, content, chunk_index, start_offset, end_offset,
              section_title, page_number, token_count, embedding, created_at)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::halfvec, NOW())`,
          crypto.randomUUID(),
          doc.id,
          chunk.content,
          chunk.chunkIndex,
          chunk.startOffset,
          chunk.endOffset,
          chunk.sectionTitle,
          chunk.pageNumber,
          chunk.tokenCount,
          vectorLiteral
        );
      }

      // ----- Summary embedding for the document itself -----
      const summaryText = text.slice(0, 2000); // use first ~500 tokens for doc-level embedding
      const summaryEmbedding = await embSvc.generateEmbedding(summaryText);
      const summaryVec = this.toVectorLiteral(summaryEmbedding.embedding);

      // Detect language heuristically (simple check)
      const language = this.detectLanguage(text);

      // Store small docs' full text; for larger ones keep null
      const extractedText = text.length <= 100_000 ? text : null;

      await prisma.$executeRawUnsafe(
        `UPDATE documents
         SET status = 'ready',
             chunk_count = $2,
             total_tokens = $3,
             extracted_text = $4,
             language = $5,
             title = $6,
             embedding = $7::halfvec,
             updated_at = NOW()
         WHERE id = $1`,
        doc.id,
        chunks.length,
        totalTokens,
        extractedText,
        language,
        this.deriveTitle(filename, text),
        summaryVec
      );

      logger.info(
        { documentId: doc.id, filename, chunks: chunks.length, totalTokens },
        'Document uploaded and processed successfully'
      );

      return { id: doc.id, status: 'ready', chunkCount: chunks.length };
    } catch (err: any) {
      logger.error({ err, documentId: doc.id }, 'Document processing failed');
      await prisma.document.update({
        where: { id: doc.id },
        data: { status: 'failed', error: String(err?.message || err) },
      });
      return { id: doc.id, status: 'failed', chunkCount: 0 };
    }
  }

  // ------------------------------------------------------------------
  // 2. searchChunks
  // ------------------------------------------------------------------

  async searchChunks(
    userId: string,
    query: string,
    limit: number = 5,
    documentId?: string
  ): Promise<SearchResult[]> {
    const embSvc = this.ensureEmbeddings();
    const queryEmbedding = await embSvc.generateEmbedding(query);
    const vectorLiteral = this.toVectorLiteral(queryEmbedding.embedding);

    // Use separate parameterised queries to avoid SQL injection
    if (documentId) {
      const rows: SearchResult[] = await prisma.$queryRawUnsafe(
        `SELECT
           dc.id            AS "chunkId",
           dc.document_id   AS "documentId",
           dc.content,
           dc.chunk_index   AS "chunkIndex",
           dc.section_title AS "sectionTitle",
           dc.page_number   AS "pageNumber",
           dc.token_count   AS "tokenCount",
           1 - (dc.embedding <=> $1::halfvec) AS "similarity",
           d.filename,
           d.mime_type       AS "mimeType",
           d.title           AS "documentTitle"
         FROM document_chunks dc
         JOIN documents d ON d.id = dc.document_id
         WHERE d.user_id = $2
           AND d.status = 'ready'
           AND dc.embedding IS NOT NULL
           AND dc.document_id = $4
         ORDER BY dc.embedding <=> $1::halfvec
         LIMIT $3`,
        vectorLiteral,
        userId,
        limit,
        documentId
      );
      return rows;
    }

    const rows: SearchResult[] = await prisma.$queryRawUnsafe(
      `SELECT
         dc.id            AS "chunkId",
         dc.document_id   AS "documentId",
         dc.content,
         dc.chunk_index   AS "chunkIndex",
         dc.section_title AS "sectionTitle",
         dc.page_number   AS "pageNumber",
         dc.token_count   AS "tokenCount",
         1 - (dc.embedding <=> $1::halfvec) AS "similarity",
         d.filename,
         d.mime_type       AS "mimeType",
         d.title           AS "documentTitle"
       FROM document_chunks dc
       JOIN documents d ON d.id = dc.document_id
       WHERE d.user_id = $2
         AND d.status = 'ready'
         AND dc.embedding IS NOT NULL
       ORDER BY dc.embedding <=> $1::halfvec
       LIMIT $3`,
      vectorLiteral,
      userId,
      limit
    );

    return rows;
  }

  // ------------------------------------------------------------------
  // 3. getRAGContext
  // ------------------------------------------------------------------

  async getRAGContext(
    userId: string,
    query: string,
    maxTokens: number = 4000
  ): Promise<RAGContextBlock> {
    // Fetch more chunks than we might need so we can trim to budget
    const chunks = await this.searchChunks(userId, query, 15);

    if (chunks.length === 0) {
      return { text: '', totalTokens: 0, chunkCount: 0, sources: [] };
    }

    const lines: string[] = ['RELEVANT DOCUMENT CONTEXT:'];
    let tokenBudget = maxTokens;
    let usedChunks = 0;
    const sources: RAGContextBlock['sources'] = [];

    for (const chunk of chunks) {
      // Estimate tokens: ~4 chars per token
      const chunkTokens = Math.ceil(chunk.content.length / 4);
      if (chunkTokens > tokenBudget) break;

      // Build attribution line
      const parts: string[] = [`From: ${chunk.filename}`];
      if (chunk.pageNumber != null) parts.push(`Page ${chunk.pageNumber}`);
      if (chunk.sectionTitle) parts.push(`Section: ${chunk.sectionTitle}`);

      lines.push('');
      lines.push(`[${parts.join(', ')}]`);
      lines.push(chunk.content);

      tokenBudget -= chunkTokens;
      usedChunks++;
      sources.push({
        filename: chunk.filename,
        section: chunk.sectionTitle || undefined,
        page: chunk.pageNumber || undefined,
      });
    }

    const text = lines.join('\n');
    return {
      text,
      totalTokens: maxTokens - tokenBudget,
      chunkCount: usedChunks,
      sources,
    };
  }

  // ------------------------------------------------------------------
  // 4. listDocuments
  // ------------------------------------------------------------------

  async listDocuments(userId: string) {
    return prisma.document.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        filename: true,
        mime_type: true,
        file_size: true,
        status: true,
        chunk_count: true,
        total_tokens: true,
        title: true,
        language: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  // ------------------------------------------------------------------
  // 5. deleteDocument
  // ------------------------------------------------------------------

  async deleteDocument(userId: string, documentId: string): Promise<boolean> {
    // Verify ownership
    const doc = await prisma.document.findFirst({
      where: { id: documentId, user_id: userId },
    });

    if (!doc) {
      logger.warn({ userId, documentId }, 'Delete requested for non-existent or unowned document');
      return false;
    }

    // Cascade delete handles chunks (ON DELETE CASCADE in schema)
    await prisma.document.delete({ where: { id: documentId } });

    logger.info({ userId, documentId, filename: doc.filename }, 'Document deleted');
    return true;
  }

  // ==================================================================
  // Private helpers
  // ==================================================================

  // ---- Text extraction ----

  private extractText(mimeType: string, content: Buffer): string {
    const type = mimeType.toLowerCase();

    if (type === 'text/plain' || type === 'text/markdown' || type.startsWith('text/')) {
      return content.toString('utf-8');
    }

    if (type === 'application/json') {
      try {
        const parsed = JSON.parse(content.toString('utf-8'));
        return JSON.stringify(parsed, null, 2);
      } catch {
        return content.toString('utf-8');
      }
    }

    // Unsupported types: try raw UTF-8 decode, log a warning
    logger.warn({ mimeType }, 'Unsupported mime type; attempting raw UTF-8 extraction');
    return content.toString('utf-8');
  }

  // ---- Semantic chunking ----

  private chunkText(text: string): ChunkInfo[] {
    const TARGET_MIN = 500;
    const TARGET_MAX = 1500;
    const MERGE_THRESHOLD = 200;

    // Step 1: split on paragraph boundaries (double newline)
    const rawParagraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    // Step 2: merge small paragraphs
    const merged: string[] = [];
    let buffer = '';
    for (const para of rawParagraphs) {
      const trimmed = para.trim();
      if (buffer.length > 0 && buffer.length + trimmed.length < MERGE_THRESHOLD * 2) {
        buffer += '\n\n' + trimmed;
      } else {
        if (buffer.length > 0) merged.push(buffer);
        buffer = trimmed;
      }
    }
    if (buffer.length > 0) merged.push(buffer);

    // Step 3: split large paragraphs on sentence boundaries
    const segments: string[] = [];
    for (const para of merged) {
      if (para.length <= TARGET_MAX) {
        segments.push(para);
      } else {
        // Split on sentence boundaries
        const sentences = para.match(/[^.!?\n]+[.!?]+[\s]*/g) || [para];
        let current = '';
        for (const sentence of sentences) {
          if (current.length + sentence.length > TARGET_MAX && current.length >= TARGET_MIN) {
            segments.push(current.trim());
            current = sentence;
          } else {
            current += sentence;
          }
        }
        if (current.trim().length > 0) segments.push(current.trim());
      }
    }

    // Step 4: final merge of tiny trailing segments
    const final: string[] = [];
    for (const seg of segments) {
      if (final.length > 0 && seg.length < MERGE_THRESHOLD) {
        final[final.length - 1] += '\n\n' + seg;
      } else {
        final.push(seg);
      }
    }

    // Step 5: build ChunkInfo objects with offsets
    const chunks: ChunkInfo[] = [];
    let offset = 0;
    for (let i = 0; i < final.length; i++) {
      const content = final[i];
      const startOffset = text.indexOf(content, offset);
      const endOffset = startOffset >= 0 ? startOffset + content.length : offset + content.length;
      const sectionTitle = this.detectSectionTitle(content);

      chunks.push({
        content,
        chunkIndex: i,
        startOffset: startOffset >= 0 ? startOffset : offset,
        endOffset,
        sectionTitle,
        pageNumber: null, // set when PDF support is added
        tokenCount: Math.ceil(content.length / 4),
      });

      offset = endOffset;
    }

    return chunks;
  }

  // ---- Helpers ----

  private detectSectionTitle(content: string): string | null {
    // Look for markdown headings at the start of the chunk
    const match = content.match(/^#{1,6}\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  private detectLanguage(text: string): string {
    // Very simple heuristic: look for common language markers
    const sample = text.slice(0, 5000).toLowerCase();

    const langScores: Record<string, number> = {
      en: 0,
      es: 0,
      fr: 0,
      de: 0,
      zh: 0,
      ja: 0,
    };

    // English common words
    const enWords = ['the', 'and', 'is', 'in', 'to', 'of', 'that', 'it', 'for', 'with'];
    for (const w of enWords) {
      const regex = new RegExp(`\\b${w}\\b`, 'g');
      const matches = sample.match(regex);
      if (matches) langScores.en += matches.length;
    }

    // Spanish
    const esWords = ['el', 'de', 'en', 'los', 'por', 'con', 'para', 'una'];
    for (const w of esWords) {
      const regex = new RegExp(`\\b${w}\\b`, 'g');
      const matches = sample.match(regex);
      if (matches) langScores.es += matches.length;
    }

    // CJK detection
    if (/[\u4e00-\u9fff]/.test(sample)) langScores.zh += 50;
    if (/[\u3040-\u30ff]/.test(sample)) langScores.ja += 50;

    const best = Object.entries(langScores).sort((a, b) => b[1] - a[1])[0];
    return best[1] > 0 ? best[0] : 'en';
  }

  private deriveTitle(filename: string, text: string): string {
    // Try markdown heading
    const headingMatch = text.match(/^#{1,2}\s+(.+)$/m);
    if (headingMatch) return headingMatch[1].trim().slice(0, 200);

    // Fall back to filename without extension
    return filename.replace(/\.[^.]+$/, '');
  }

  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}

// Convenience singleton accessor
export function getDocumentRAGService(): DocumentRAGService {
  return DocumentRAGService.getInstance();
}
