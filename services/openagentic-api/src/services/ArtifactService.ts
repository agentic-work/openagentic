/**
 * ArtifactService - Comprehensive artifact management with vector embeddings
 */

import type { Logger } from 'pino';
import { MilvusVectorService, ArtifactType, ArtifactMetadata } from './MilvusVectorService.js';
import { BlobStorageService } from './BlobStorageService.js';
import { prisma } from '../utils/prisma.js';
import { createHash } from 'crypto';
import sharp from 'sharp';
import mammoth from 'mammoth';
// Dynamic import to avoid pdf-parse loading test file at import time
// import { pdfParse } from 'pdf-parse';

export { ArtifactType } from './MilvusVectorService.js';

export interface UploadArtifactRequest {
  file: Buffer;
  filename: string;
  mimeType: string;
  title?: string;
  description?: string;
  tags?: string[];
  isPublic?: boolean;
}

export interface SearchArtifactsRequest {
  query: string;
  type?: ArtifactType;
  tags?: string[];
  limit?: number;
  threshold?: number;
  includePublic?: boolean;
}

export interface ArtifactSearchResult {
  id: string;
  title: string;
  description?: string;
  type: ArtifactType;
  score: number;
  preview?: string;
  metadata: Partial<ArtifactMetadata>;
  tags?: string[];
  createdAt: Date;
}

export interface ArtifactStats {
  totalArtifacts: number;
  totalStorageUsed: number;
  storageLimit: number;
  typeBreakdown: Record<ArtifactType, number>;
  recentActivity: Date;
  topTags: Array<{ tag: string; count: number }>;
}

/**
 * Service for artifact management with vector search capabilities
 * Integrates with MilvusVectorService for semantic search
 */
export class ArtifactService {
  private logger: Logger;
  private vectorService: MilvusVectorService | null = null;
  private blobStorage: BlobStorageService | null = null;
  private supportedTypes: Set<string>;
  private readonly maxFileSize: number = 50 * 1024 * 1024; // 50MB
  private readonly storageLimit: number = 1024 * 1024 * 1024; // 1GB default

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'ArtifactService' }) as Logger;
    try {
      this.vectorService = new MilvusVectorService();
      this.logger.info('MilvusVectorService initialized for artifact vector operations');
    } catch (error: any) {
      this.logger.warn({ error: error.message }, 'MilvusVectorService unavailable - artifact vector operations will be limited');
    }
    try {
      this.blobStorage = new BlobStorageService(this.logger);
      this.logger.info('BlobStorageService initialized for artifact file storage');
    } catch (error: any) {
      this.logger.warn({ error: error.message }, 'BlobStorageService unavailable - artifact download will be limited');
    }
    this.supportedTypes = new Set([
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/json',
      'text/javascript',
      'text/typescript',
      'text/css',
      'text/html'
    ]);
  }

  /**
   * Upload and process an artifact
   */
  async uploadArtifact(
    userId: string, 
    request: UploadArtifactRequest
  ): Promise<ArtifactMetadata> {
    this.logger.info({
      userId,
      filename: request.filename,
      size: request.file.length
    }, 'Starting artifact upload');

    try {
      // Validate file size
      if (request.file.length > this.maxFileSize) {
        throw new Error(`File size ${request.file.length} exceeds maximum ${this.maxFileSize}`);
      }

      // Check storage quota
      await this.checkStorageQuota(userId, request.file.length);

      // Validate MIME type
      if (!this.supportedTypes.has(request.mimeType)) {
        throw new Error(`Unsupported file type: ${request.mimeType}`);
      }

      // Extract content and create hash
      const extractedContent = await this.extractContent(request.file, request.mimeType);
      const contentHash = createHash('sha256').update(extractedContent).digest('hex');

      // Check for duplicates
      const existing = await this.findExistingArtifact(userId, contentHash);
      if (existing) {
        this.logger.info({ artifactId: existing.id }, 'Returning existing artifact');
        return existing;
      }

      // Determine artifact type
      const artifactType = this.determineArtifactType(request.mimeType);

      // Create artifact metadata
      const metadata: ArtifactMetadata = {
        id: this.generateId(),
        userId,
        type: artifactType,
        title: request.title || this.generateTitle(request.filename),
        description: request.description,
        source: request.filename,
        mimeType: request.mimeType,
        fileSize: request.file.length,
        tags: request.tags || [],
        createdAt: new Date(),
        updatedAt: new Date(),
        accessCount: 0,
        permissions: {
          isPublic: request.isPublic || false,
          sharedWith: []
        },
        contentHash,
        originalContent: extractedContent.length < 10000 ? extractedContent : undefined,
        extractedText: extractedContent
      };

      // Generate storage path
      const storagePath = `artifacts/${userId}/${metadata.id}`;

      // Generate thumbnail for images
      if (artifactType === ArtifactType.IMAGE) {
        metadata.thumbnailUrl = await this.generateThumbnail(request.file);
      }

      // Store artifact in database
      const dbArtifact = await prisma.artifactFile.create({
        data: {
          id: metadata.id,
          user_id: userId,
          filename: request.filename,
          mime_type: request.mimeType,
          file_size: request.file.length,
          storage_path: storagePath,
          content_hash: contentHash,
          title: metadata.title,
          description: metadata.description,
          tags: metadata.tags,
          is_public: metadata.permissions?.isPublic || false,
          extracted_text: extractedContent,
          thumbnail_url: metadata.thumbnailUrl,
          uploaded_at: metadata.createdAt,
          last_accessed: null,
          access_count: 0
        }
      });

      // Store binary file in blob storage (MinIO) for downloads
      if (this.blobStorage) {
        try {
          await this.blobStorage.store(request.file, storagePath, request.mimeType);
          this.logger.info({ storagePath, size: request.file.length }, 'Artifact stored in blob storage');
        } catch (blobErr: any) {
          this.logger.warn({ error: blobErr.message, storagePath }, 'Failed to store artifact in blob storage (non-fatal)');
        }
      }

      // Store in vector database for semantic search
      await this.vectorService.storeArtifact(userId, {
        type: artifactType,
        title: metadata.title,
        content: extractedContent || '',
        mimeType: request.mimeType,
        metadata: metadata
      });

      this.logger.info({
        artifactId: metadata.id,
        type: artifactType,
        contentLength: extractedContent.length
      }, 'Artifact uploaded successfully');

      return metadata;
    } catch (error) {
      this.logger.error({ err: error }, 'Artifact upload failed');
      throw new Error(`Failed to upload artifact: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Search artifacts using semantic similarity
   */
  async searchArtifacts(
    userId: string,
    request: SearchArtifactsRequest
  ): Promise<{ results: ArtifactSearchResult[]; total: number }> {
    this.logger.info({
      userId,
      query: request.query,
      filters: {
        type: request.type,
        tags: request.tags,
        includePublic: request.includePublic
      }
    }, 'Starting artifact search');

    try {
      // Perform vector search
      const vectorResults = await this.vectorService.searchArtifacts(
        userId,
        request.query,
        {
          types: request.type ? [request.type] : undefined,
          tags: request.tags,
          limit: request.limit || 20,
          threshold: request.threshold || 0.3, // Lower threshold for better recall
          includeShared: request.includePublic || false
        }
      );

      this.logger.info({
        userId,
        vectorResultsCount: vectorResults.length,
        vectorResultIds: vectorResults.map(r => r.id)
      }, 'Vector search returned results, looking up in database');

      // Enhance results with database metadata
      const results: ArtifactSearchResult[] = [];
      for (const vectorResult of vectorResults) {
        this.logger.debug({ lookupId: vectorResult.id }, 'Looking up artifact in database');
        const dbArtifact = await prisma.artifactFile.findUnique({
          where: { id: vectorResult.id }
        });

        if (dbArtifact) {
          // Update access statistics
          await this.updateAccessStats(vectorResult.id);

          results.push({
            id: vectorResult.id,
            title: dbArtifact.title,
            description: dbArtifact.description,
            type: vectorResult.metadata.type,
            score: vectorResult.score,
            preview: this.generatePreview(dbArtifact.extracted_text),
            metadata: {
              mimeType: dbArtifact.mime_type,
              fileSize: dbArtifact.file_size,
              createdAt: dbArtifact.uploaded_at,
              lastAccessed: dbArtifact.last_accessed,
              accessCount: dbArtifact.access_count,
              thumbnailUrl: dbArtifact.thumbnail_url
            },
            tags: dbArtifact.tags || [],
            createdAt: dbArtifact.uploaded_at
          });
        }
      }

      this.logger.info({
        userId,
        resultsCount: results.length,
        query: request.query
      }, 'Artifact search completed');

      return {
        results: results.sort((a, b) => b.score - a.score),
        total: results.length
      };
    } catch (error) {
      this.logger.error({ err: error }, 'Artifact search failed');
      throw new Error(`Failed to search artifacts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List user's artifacts with pagination
   */
  async listArtifacts(
    userId: string,
    options: {
      type?: ArtifactType;
      tags?: string[];
      limit?: number;
      offset?: number;
      sortBy?: 'created' | 'accessed' | 'title';
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<{ artifacts: ArtifactMetadata[]; total: number }> {
    try {
      const where: any = { user_id: userId };

      // Apply filters
      if (options.type) {
        // Note: We'd need to map ArtifactType to database representation
        // For now, this is a placeholder
      }
      if (options.tags?.length) {
        where.tags = {
          hasSome: options.tags
        };
      }

      // Build sort criteria
      let orderBy: any = { uploaded_at: 'desc' };
      if (options.sortBy === 'accessed') {
        orderBy = { last_accessed: options.sortOrder || 'desc' };
      } else if (options.sortBy === 'title') {
        orderBy = { title: options.sortOrder || 'asc' };
      } else if (options.sortBy === 'created') {
        orderBy = { uploaded_at: options.sortOrder || 'desc' };
      }

      const [artifacts, total] = await Promise.all([
        prisma.artifactFile.findMany({
          where,
          orderBy,
          take: options.limit || 50,
          skip: options.offset || 0
        }),
        prisma.artifactFile.count({ where })
      ]);

      const enrichedArtifacts = artifacts.map(artifact => this.mapToArtifactMetadata(artifact));

      return { artifacts: enrichedArtifacts, total };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to list artifacts');
      throw new Error(`Failed to list artifacts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete an artifact
   */
  async deleteArtifact(userId: string, artifactId: string): Promise<void> {
    try {
      // Verify ownership
      const artifact = await prisma.artifactFile.findFirst({
        where: {
          id: artifactId,
          user_id: userId
        }
      });

      if (!artifact) {
        throw new Error('Artifact not found or access denied');
      }

      // Delete from vector database
      await this.vectorService.deleteArtifact(userId, artifactId);

      // Delete from relational database
      await prisma.artifactFile.delete({
        where: { id: artifactId }
      });

      this.logger.info({ artifactId, userId }, 'Artifact deleted successfully');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to delete artifact');
      throw new Error(`Failed to delete artifact: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Download artifact file from blob storage.
   * Returns { buffer, mimeType, filename } or null if not found.
   */
  async downloadArtifact(userId: string, artifactId: string): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
    const artifact = await prisma.artifactFile.findFirst({
      where: { id: artifactId, user_id: userId },
    });
    if (!artifact) return null;

    // Update access tracking
    prisma.artifactFile.update({
      where: { id: artifactId },
      data: { access_count: { increment: 1 }, last_accessed: new Date() },
    }).catch(() => {});

    // Try blob storage first
    if (this.blobStorage && artifact.storage_path) {
      const buffer = await this.blobStorage.get(artifact.storage_path);
      if (buffer) {
        return { buffer, mimeType: artifact.mime_type, filename: artifact.filename };
      }
    }

    // Fallback: serve extracted_text as text file
    if (artifact.extracted_text) {
      return {
        buffer: Buffer.from(artifact.extracted_text, 'utf-8'),
        mimeType: 'text/plain',
        filename: artifact.filename.replace(/\.[^.]+$/, '.txt'),
      };
    }

    return null;
  }

  /**
   * Get artifact metadata (without downloading the file)
   */
  async getArtifact(userId: string, artifactId: string): Promise<any | null> {
    return prisma.artifactFile.findFirst({
      where: { id: artifactId, user_id: userId },
    });
  }

  /**
   * Get artifact statistics
   */
  async getArtifactStats(userId: string): Promise<ArtifactStats> {
    try {
      const [stats, typeStats, tagStats] = await Promise.all([
        prisma.artifactFile.aggregate({
          where: { user_id: userId },
          _count: { id: true },
          _sum: { file_size: true },
          _max: { uploaded_at: true }
        }),
        // Note: This query would need proper grouping based on how types are stored
        prisma.artifactFile.groupBy({
          by: ['mime_type'],
          where: { user_id: userId },
          _count: true
        }),
        // Note: This would need proper array aggregation for tags
        prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
          SELECT jsonb_array_elements_text(tags) as tag, COUNT(*) as count
          FROM artifact_files 
          WHERE user_id = ${userId} AND tags IS NOT NULL
          GROUP BY tag
          ORDER BY count DESC
          LIMIT 10
        `
      ]);

      // Map MIME types to ArtifactTypes (simplified)
      const typeBreakdown: Record<ArtifactType, number> = {
        [ArtifactType.DOCUMENT]: 0,
        [ArtifactType.IMAGE]: 0,
        [ArtifactType.CODE]: 0,
        [ArtifactType.MEMORY]: 0,
        [ArtifactType.CONVERSATION]: 0,
        [ArtifactType.KNOWLEDGE]: 0,
        [ArtifactType.FILE]: 0
      };

      for (const stat of typeStats) {
        const artifactType = this.determineArtifactType(stat.mime_type);
        typeBreakdown[artifactType] += stat._count;
      }

      return {
        totalArtifacts: stats._count.id || 0,
        totalStorageUsed: stats._sum.file_size || 0,
        storageLimit: this.storageLimit,
        typeBreakdown,
        recentActivity: stats._max.uploaded_at || new Date(),
        topTags: tagStats.map(t => ({ tag: t.tag, count: Number(t.count) }))
      };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to get artifact stats');
      throw new Error(`Failed to get artifact stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<{ healthy: boolean; details: any }> {
    try {
      const [vectorHealth, dbHealth] = await Promise.all([
        this.vectorService.healthCheck(),
        prisma.artifactFile.count().then(() => ({ healthy: true }))
      ]);

      return {
        healthy: vectorHealth && dbHealth.healthy,
        details: {
          vectorService: { healthy: vectorHealth },
          database: dbHealth,
          supportedTypes: Array.from(this.supportedTypes),
          limits: {
            maxFileSize: this.maxFileSize,
            storageLimit: this.storageLimit
          }
        }
      };
    } catch (error) {
      return {
        healthy: false,
        details: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  // Private helper methods

  private async extractContent(file: Buffer, mimeType: string): Promise<string> {
    switch (mimeType) {
      case 'text/plain':
      case 'text/markdown':
      case 'application/json':
      case 'text/javascript':
      case 'text/typescript':
      case 'text/css':
      case 'text/html':
        return file.toString('utf-8');

      case 'application/pdf':
        // Note: Would need actual PDF parsing library
        try {
          // const parsed = await pdfParse(file);
          // return parsed.text;
          return `[PDF Content - ${file.length} bytes]`;
        } catch {
          return `[PDF extraction failed - ${file.length} bytes]`;
        }

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        try {
          const result = await mammoth.extractRawText({ buffer: file });
          return result.value;
        } catch {
          return `[DOCX extraction failed - ${file.length} bytes]`;
        }

      case 'image/jpeg':
      case 'image/png':
      case 'image/webp':
        // For images, we'd typically use OCR or image analysis
        return `[Image - ${file.length} bytes]`;

      default:
        return file.toString('utf-8').substring(0, 10000); // Truncate for safety
    }
  }

  private determineArtifactType(mimeType: string): ArtifactType {
    if (mimeType.startsWith('text/') || mimeType.includes('document') || mimeType === 'application/pdf') {
      return ArtifactType.DOCUMENT;
    }
    if (mimeType.startsWith('image/')) {
      return ArtifactType.IMAGE;
    }
    if (mimeType.includes('javascript') || mimeType.includes('typescript') || 
        mimeType === 'application/json' || mimeType === 'text/css' || mimeType === 'text/html') {
      return ArtifactType.CODE;
    }
    return ArtifactType.FILE;
  }

  private async generateThumbnail(imageBuffer: Buffer): Promise<string> {
    try {
      const thumbnail = await sharp(imageBuffer)
        .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      
      // In production, upload to S3/blob storage and return URL
      return `data:image/jpeg;base64,${thumbnail.toString('base64')}`;
    } catch {
      return '';
    }
  }

  private generateId(): string {
    return `artifact_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private generateTitle(filename: string): string {
    return filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
  }

  private generatePreview(content: string | null): string {
    if (!content) return '';
    return content.substring(0, 200) + (content.length > 200 ? '...' : '');
  }

  private async checkStorageQuota(userId: string, additionalSize: number): Promise<void> {
    const currentUsage = await prisma.artifactFile.aggregate({
      where: { user_id: userId },
      _sum: { file_size: true }
    });

    const totalUsed = (currentUsage._sum.file_size || 0) + additionalSize;
    if (totalUsed > this.storageLimit) {
      throw new Error(`Storage quota exceeded. Used: ${totalUsed}, Limit: ${this.storageLimit}`);
    }
  }

  private async findExistingArtifact(userId: string, contentHash: string): Promise<ArtifactMetadata | null> {
    const existing = await prisma.artifactFile.findFirst({
      where: {
        user_id: userId,
        content_hash: contentHash
      }
    });

    return existing ? this.mapToArtifactMetadata(existing) : null;
  }

  private async updateAccessStats(artifactId: string): Promise<void> {
    await prisma.artifactFile.update({
      where: { id: artifactId },
      data: {
        access_count: { increment: 1 },
        last_accessed: new Date()
      }
    });
  }

  private mapToArtifactMetadata(dbArtifact: any): ArtifactMetadata {
    return {
      id: dbArtifact.id,
      userId: dbArtifact.user_id,
      type: this.determineArtifactType(dbArtifact.mime_type),
      title: dbArtifact.title,
      description: dbArtifact.description,
      source: dbArtifact.filename,
      mimeType: dbArtifact.mime_type,
      fileSize: dbArtifact.file_size,
      tags: dbArtifact.tags || [],
      createdAt: dbArtifact.uploaded_at,
      updatedAt: dbArtifact.uploaded_at, // Assuming no separate update tracking
      accessCount: dbArtifact.access_count,
      lastAccessed: dbArtifact.last_accessed,
      permissions: {
        isPublic: dbArtifact.is_public,
        sharedWith: []
      },
      contentHash: dbArtifact.content_hash,
      extractedText: dbArtifact.extracted_text,
      thumbnailUrl: dbArtifact.thumbnail_url
    };
  }
}