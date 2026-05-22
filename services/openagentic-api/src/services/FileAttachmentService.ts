/**

 * 
 * File Attachment Service - Implementation based on TDD specifications
 * 
 * Handles file uploads, storage, processing, and security for chat attachments
 * Features:
 * - Secure file validation and storage
 * - Image thumbnail generation
 * - Document text extraction
 * - Rate limiting and malware scanning
 * - Prisma ORM with snake_case schema
 * - Soft delete support
 */

import { nanoid } from 'nanoid';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import sharp from 'sharp';
import type { Logger } from 'pino';
import { createReadStream } from 'fs';
import { prisma } from '../utils/prisma.js';

// Types matching TDD specifications
export interface FileAttachment {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadPath: string;
  thumbnailPath?: string;
  userId: string;
  sessionId?: string;
  messageId?: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  metadata: {
    dimensions?: { width: number; height: number };
    duration?: number;
    extractedText?: string;
  };
}

export interface FileUploadRequest {
  file: Buffer;
  filename: string;
  mimeType: string;
  userId: string;
  sessionId?: string;
  messageId?: string;
  isPublic?: boolean;
}

// Configuration
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg',
  'image/jpg', 
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Audio
  'audio/mpeg',
  'audio/wav',
  'audio/mp3',
  'audio/ogg',
  // Video
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const UPLOAD_RATE_LIMIT = 5; // files per minute per user
const MALWARE_SIGNATURES = [
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', // EICAR test
];

export class FileAttachmentService {
  private logger: Logger;
  private uploadDir: string;
  private thumbnailDir: string;
  private rateLimitMap = new Map<string, number[]>();

  constructor(
    config: {
      uploadDir?: string;
      thumbnailDir?: string;
    },
    logger: Logger
  ) {
    this.logger = logger.child({ service: 'FileAttachmentService' }) as Logger;

    // Set up directories
    this.uploadDir = config.uploadDir || path.join(process.cwd(), 'uploads');
    this.thumbnailDir = config.thumbnailDir || path.join(this.uploadDir, 'thumbnails');

    this.logger.info({
      uploadDir: this.uploadDir,
      thumbnailDir: this.thumbnailDir
    }, 'FileAttachmentService initialized');
  }

  /**
   * Upload and store a file with full validation and processing
   */
  async uploadFile(request: FileUploadRequest): Promise<FileAttachment> {
    this.logger.info({
      filename: request.filename,
      mimeType: request.mimeType,
      size: request.file.length,
      userId: request.userId
    }, 'Starting file upload');

    // Validate the file upload
    this.validateFileUpload(request);

    // Check rate limiting
    this.checkRateLimit(request.userId);

    // Security scanning
    await this.scanForMalware(request.file);

    // Generate secure filename and path
    const fileId = nanoid();
    const sanitizedName = this.sanitizeFilename(request.filename);
    const extension = path.extname(sanitizedName);
    const secureFilename = `${fileId}${extension}`;
    const uploadPath = this.generateUploadPath(secureFilename);
    
    // Ensure upload directory exists
    await fs.mkdir(path.dirname(uploadPath), { recursive: true });

    try {
      // Write file to disk
      await fs.writeFile(uploadPath, request.file);
      
      // Extract metadata based on file type
      const metadata = await this.extractMetadata(uploadPath, request.mimeType);

      // Store in database
      const fileRecord = await prisma.fileAttachment.create({
        data: {
          id: fileId,
          filename: secureFilename,
          original_name: request.filename,
          mime_type: request.mimeType,
          size: request.file.length,
          upload_path: uploadPath,
          user_id: request.userId,
          session_id: request.sessionId || null,
          message_id: request.messageId || null,
          is_public: request.isPublic || false,
          metadata: metadata,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Convert to response format
      const result = this.transformFileToResponse(fileRecord);

      // Generate thumbnail for images (async, non-blocking)
      if (request.mimeType.startsWith('image/') && request.mimeType !== 'image/svg+xml') {
        this.generateThumbnail(fileId).catch(error => {
          this.logger.warn({ error, fileId }, 'Failed to generate thumbnail');
        });
      }

      // Extract text from documents (async, non-blocking)
      if (this.isTextExtractionSupported(request.mimeType)) {
        this.extractTextFromFile(fileId).catch(error => {
          this.logger.warn({ error, fileId }, 'Failed to extract text');
        });
      }

      this.logger.info({
        fileId: result.id,
        filename: result.filename,
        size: result.size,
        uploadPath: result.uploadPath
      }, 'File uploaded successfully');

      return result;

    } catch (error) {
      // Clean up file if database save failed
      try {
        await fs.unlink(uploadPath);
      } catch (cleanupError) {
        this.logger.warn({ error: cleanupError }, 'Failed to cleanup file after error');
      }
      
      this.logger.error({ error, fileId }, 'Failed to upload file');
      throw error;
    }
  }

  /**
   * Get file metadata by ID with access control
   */
  async getFile(fileId: string, userId: string): Promise<FileAttachment | null> {
    const file = await prisma.fileAttachment.findFirst({
      where: {
        id: fileId,
        deleted_at: null,
        OR: [
          { user_id: userId },
          { is_public: true },
        ],
      },
    });

    if (!file) {
      this.logger.debug({ fileId, userId }, 'File not found or access denied');
      return null;
    }

    return this.transformFileToResponse(file);
  }

  /**
   * Soft delete a file
   */
  async deleteFile(fileId: string, userId: string): Promise<boolean> {
    // First verify ownership
    const file = await prisma.fileAttachment.findFirst({
      where: {
        id: fileId,
        user_id: userId,
        deleted_at: null,
      },
    });

    if (!file) {
      throw new Error('Access denied');
    }

    // Soft delete
    await prisma.fileAttachment.update({
      where: { id: fileId },
      data: {
        deleted_at: new Date(),
        updated_at: new Date(),
      },
    });

    this.logger.info({ fileId, userId }, 'File soft deleted');
    return true;
  }

  /**
   * List files for a user
   */
  async listUserFiles(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<FileAttachment[]> {
    const files = await prisma.fileAttachment.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
      },
      orderBy: {
        created_at: 'desc',
      },
      take: limit,
      skip: offset,
    });

    return files.map(file => this.transformFileToResponse(file));
  }

  /**
   * Generate thumbnail for image files
   */
  async generateThumbnail(fileId: string): Promise<string | null> {
    const file = await prisma.fileAttachment.findUnique({
      where: { id: fileId },
    });

    if (!file || !file.mime_type.startsWith('image/')) {
      return null;
    }

    try {
      // Ensure thumbnail directory exists
      await fs.mkdir(this.thumbnailDir, { recursive: true });

      const thumbnailPath = path.join(
        this.thumbnailDir,
        `thumb_${file.filename}`
      );

      // Generate thumbnail using Sharp
      await sharp(file.upload_path)
        .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(thumbnailPath);

      // Get image dimensions
      const { width, height } = await sharp(file.upload_path).metadata();

      // Update database with thumbnail path and dimensions
      await prisma.fileAttachment.update({
        where: { id: fileId },
        data: {
          thumbnail_path: thumbnailPath,
          metadata: {
            ...((file.metadata as any) || {}),
            dimensions: { width: width || 0, height: height || 0 },
          },
          updated_at: new Date(),
        },
      });

      this.logger.info({ fileId, thumbnailPath }, 'Thumbnail generated');
      return thumbnailPath;

    } catch (error) {
      this.logger.error({ error, fileId }, 'Failed to generate thumbnail');
      return null;
    }
  }

  /**
   * Extract text content from document files
   */
  async extractTextFromFile(fileId: string): Promise<string | null> {
    const file = await prisma.fileAttachment.findUnique({
      where: { id: fileId },
    });

    if (!file || !this.isTextExtractionSupported(file.mime_type)) {
      return null;
    }

    try {
      let extractedText = '';

      if (file.mime_type === 'text/plain' || file.mime_type === 'text/markdown') {
        // Simple text files
        extractedText = await fs.readFile(file.upload_path, 'utf-8');
      } else if (file.mime_type === 'application/pdf') {
        // Use pdf-parse v2 class API for PDF text extraction
        try {
          const { PDFParse } = await import('pdf-parse');
          const dataBuffer = await fs.readFile(file.upload_path);
          const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
          const pdfData: any = await parser.getText();
          extractedText = pdfData.text || '';
        } catch (pdfError) {
          this.logger.warn({ error: pdfError, fileId }, 'PDF parsing failed, no text extracted');
          extractedText = '';
        }
      }

      // Update database with extracted text
      await prisma.fileAttachment.update({
        where: { id: fileId },
        data: {
          metadata: {
            ...((file.metadata as any) || {}),
            extractedText,
          },
          updated_at: new Date(),
        },
      });

      this.logger.info({
        fileId,
        textLength: extractedText.length
      }, 'Text extracted from file');

      return extractedText;

    } catch (error) {
      this.logger.error({ error, fileId }, 'Failed to extract text');
      return null;
    }
  }

  /**
   * Get file stream for download
   */
  async getFileStream(fileId: string, userId: string): Promise<NodeJS.ReadableStream | null> {
    const file = await this.getFile(fileId, userId);
    if (!file) {
      return null;
    }

    try {
      return createReadStream(file.uploadPath);
    } catch (error) {
      this.logger.error({ error, fileId }, 'Failed to create file stream');
      return null;
    }
  }

  /**
   * Cleanup expired soft-deleted files
   */
  async cleanupExpiredFiles(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    // Find files to delete
    const expiredFiles = await prisma.fileAttachment.findMany({
      where: {
        deleted_at: {
          not: null,
          lt: cutoffDate,
        },
      },
    });

    // Delete physical files
    let deletedCount = 0;
    for (const file of expiredFiles) {
      try {
        await fs.unlink(file.upload_path);
        if (file.thumbnail_path) {
          await fs.unlink(file.thumbnail_path).catch(() => {}); // Ignore errors
        }
        deletedCount++;
      } catch (error) {
        this.logger.warn({ error, fileId: file.id }, 'Failed to delete physical file');
      }
    }

    // Remove from database
    const result = await prisma.fileAttachment.deleteMany({
      where: {
        deleted_at: {
          not: null,
          lt: cutoffDate,
        },
      },
    });

    this.logger.info({
      requested: expiredFiles.length,
      physicalDeleted: deletedCount,
      dbDeleted: result.count
    }, 'Expired files cleanup completed');

    return result.count;
  }

  /**
   * Handle message deletion (soft delete attachments)
   */
  async handleMessageDeletion(messageId: string): Promise<void> {
    const files = await prisma.fileAttachment.findMany({
      where: {
        message_id: messageId,
        deleted_at: null,
      },
    });

    for (const file of files) {
      await prisma.fileAttachment.update({
        where: { id: file.id },
        data: {
          deleted_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    this.logger.info({
      messageId,
      filesDeleted: files.length
    }, 'Message attachments soft deleted');
  }

  // Private helper methods
  
  private validateFileUpload(request: FileUploadRequest): void {
    // Check file type
    if (!ALLOWED_MIME_TYPES.has(request.mimeType)) {
      throw new Error('File type not allowed');
    }

    // Check file size
    if (request.file.length > MAX_FILE_SIZE) {
      throw new Error('File too large');
    }

    // Basic filename validation
    if (!request.filename || request.filename.length === 0) {
      throw new Error('Invalid filename');
    }
  }

  private sanitizeFilename(filename: string): string {
    // Remove directory traversal attempts
    const sanitized = filename
      .replace(/\.\./g, '')
      .replace(/[\/\\]/g, '')
      .replace(/[<>:"|?*]/g, '_')
      .trim();

    // Ensure filename is not empty
    return sanitized || 'unnamed_file';
  }

  private generateUploadPath(filename: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    
    const datePath = `${year}/${month}`;
    return path.join(this.uploadDir, datePath, filename);
  }

  private checkRateLimit(userId: string): void {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    // Get or create rate limit array for user
    const userUploads = this.rateLimitMap.get(userId) || [];
    
    // Filter to only recent uploads
    const recentUploads = userUploads.filter(timestamp => timestamp > windowStart);
    
    if (recentUploads.length >= UPLOAD_RATE_LIMIT) {
      throw new Error('Upload rate limit exceeded');
    }

    // Add current upload and update map
    recentUploads.push(now);
    this.rateLimitMap.set(userId, recentUploads);
  }

  private async scanForMalware(fileBuffer: Buffer): Promise<void> {
    const fileContent = fileBuffer.toString();
    
    for (const signature of MALWARE_SIGNATURES) {
      if (fileContent.includes(signature)) {
        throw new Error('File failed security scan');
      }
    }
  }

  private async extractMetadata(filePath: string, mimeType: string): Promise<object> {
    const metadata: any = {};

    try {
      if (mimeType.startsWith('image/')) {
        const imageMetadata = await sharp(filePath).metadata();
        if (imageMetadata.width && imageMetadata.height) {
          metadata.dimensions = {
            width: imageMetadata.width,
            height: imageMetadata.height,
          };
        }
      }
    } catch (error) {
      this.logger.debug({ error }, 'Failed to extract file metadata');
    }

    return metadata;
  }

  private isTextExtractionSupported(mimeType: string): boolean {
    return [
      'text/plain',
      'text/markdown',
      'application/pdf',
    ].includes(mimeType);
  }

  private transformFileToResponse(file: any): FileAttachment {
    return {
      id: file.id,
      filename: file.filename,
      originalName: file.original_name,
      mimeType: file.mime_type,
      size: file.size,
      uploadPath: file.upload_path,
      thumbnailPath: file.thumbnail_path,
      userId: file.user_id,
      sessionId: file.session_id,
      messageId: file.message_id,
      isPublic: file.is_public,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
      deletedAt: file.deleted_at,
      metadata: file.metadata || {},
    };
  }

  async close(): Promise<void> {
    this.logger.info('FileAttachmentService closed');
  }
}

// Export helper functions for TDD compliance
export function validateFileUpload(request: FileUploadRequest): void {
  const service = new (FileAttachmentService as any)({}, { child: () => ({}) } as any);
  return service.validateFileUpload(request);
}

export function sanitizeFilename(filename: string): string {
  const service = new (FileAttachmentService as any)({}, { child: () => ({}) } as any);
  return service.sanitizeFilename(filename);
}

export function generateUploadPath(filename: string): string {
  const service = new (FileAttachmentService as any)({}, { child: () => ({}) } as any);
  return service.generateUploadPath(filename);
}