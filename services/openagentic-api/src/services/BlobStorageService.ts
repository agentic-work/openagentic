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
 * Blob Storage Service - Abstraction Layer
 *
 * Provides unified interface for storing binary data (images, files) across
 * different storage backends:
 *
 * - MinIO (Docker Compose - S3-compatible)
 * - Google Cloud Storage (GKE deployment)
 * - Azure Blob Storage (AKS deployment)
 * - AWS S3 (EKS deployment)
 * - Local filesystem (fallback)
 *
 * Configuration via environment variables:
 * - BLOB_STORAGE_TYPE: 'minio' | 'gcs' | 'azure' | 's3' | 'local'
 * - MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY
 * - GCS_BUCKET, GOOGLE_APPLICATION_CREDENTIALS
 * - AZURE_STORAGE_CONNECTION_STRING, AZURE_STORAGE_CONTAINER
 * - AWS_S3_BUCKET, AWS_REGION
 */

import { Client as MinioClient } from 'minio';
import { Storage as GCSStorage } from '@google-cloud/storage';
import { BlobServiceClient } from '@azure/storage-blob';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export type StorageType = 'minio' | 'gcs' | 'azure' | 's3' | 'local';

export interface BlobMetadata {
  id: string;
  key: string; // Storage key/path
  bucket: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
  url?: string; // Public/signed URL if available
}

export interface StorageConfig {
  type: StorageType;
  bucket: string;
  // MinIO / S3
  endpoint?: string;
  accessKey?: string;
  secretKey?: string;
  region?: string;
  useSSL?: boolean;
  // Azure
  connectionString?: string;
  containerName?: string;
  // Local
  basePath?: string;
}

export class BlobStorageService {
  private config: StorageConfig;
  private logger: any;
  private minioClient?: MinioClient;
  private gcsStorage?: GCSStorage;
  private azureBlobClient?: BlobServiceClient;
  private s3Client?: S3Client;
  private initialized = false;

  constructor(logger: any, config?: Partial<StorageConfig>) {
    this.logger = logger;

    // Auto-detect storage type from environment
    this.config = this.buildConfig(config);

    this.logger.info({
      storageType: this.config.type,
      bucket: this.config.bucket,
      endpoint: this.config.endpoint
    }, '[BLOB-STORAGE] Configured');
  }

  private buildConfig(override?: Partial<StorageConfig>): StorageConfig {
    // Priority: explicit config > env vars > defaults
    const type = (override?.type ||
      process.env.BLOB_STORAGE_TYPE ||
      this.detectStorageType()) as StorageType;

    const baseConfig: StorageConfig = {
      type,
      bucket: override?.bucket || process.env.BLOB_STORAGE_BUCKET || 'openagentic-images',
    };

    switch (type) {
      case 'minio':
        return {
          ...baseConfig,
          endpoint: override?.endpoint || process.env.MINIO_ENDPOINT || 'milvus-minio:9000',
          accessKey: override?.accessKey || process.env.MINIO_ACCESS_KEY || 'minioadmin',
          secretKey: override?.secretKey || process.env.MINIO_SECRET_KEY || 'minioadmin',
          useSSL: override?.useSSL !== undefined ? override.useSSL : (process.env.MINIO_USE_SSL === 'true'),
        };

      case 'gcs':
        return {
          ...baseConfig,
          bucket: override?.bucket || process.env.GCS_BUCKET || 'openagentic-images',
        };

      case 'azure':
        return {
          ...baseConfig,
          connectionString: override?.connectionString || process.env.AZURE_STORAGE_CONNECTION_STRING,
          containerName: override?.containerName || process.env.AZURE_STORAGE_CONTAINER || 'images',
        };

      case 's3':
        return {
          ...baseConfig,
          bucket: override?.bucket || process.env.AWS_S3_BUCKET || 'openagentic-images',
          region: override?.region || process.env.AWS_REGION || 'us-east-1',
          accessKey: override?.accessKey || process.env.AWS_ACCESS_KEY_ID,
          secretKey: override?.secretKey || process.env.AWS_SECRET_ACCESS_KEY,
        };

      case 'local':
      default:
        return {
          ...baseConfig,
          type: 'local',
          basePath: override?.basePath || process.env.IMAGE_STORAGE_PATH || '/data/images',
        };
    }
  }

  private detectStorageType(): StorageType {
    // Auto-detect based on available credentials
    if (process.env.MINIO_ENDPOINT || process.env.MINIO_ACCESS_KEY) {
      return 'minio';
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GCS_BUCKET) {
      return 'gcs';
    }
    if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
      return 'azure';
    }
    if (process.env.AWS_S3_BUCKET || process.env.AWS_ACCESS_KEY_ID) {
      return 's3';
    }
    return 'local';
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      switch (this.config.type) {
        case 'minio':
          await this.initMinio();
          break;
        case 'gcs':
          await this.initGCS();
          break;
        case 'azure':
          await this.initAzure();
          break;
        case 's3':
          await this.initS3();
          break;
        case 'local':
          await this.initLocal();
          break;
      }

      this.initialized = true;
      this.logger.info({ type: this.config.type }, '[BLOB-STORAGE] Initialized successfully');

    } catch (error) {
      this.logger.error({ error, type: this.config.type }, '[BLOB-STORAGE] Failed to initialize');
      throw error;
    }
  }

  private async initMinio(): Promise<void> {
    const endpointParts = (this.config.endpoint || 'localhost:9000').split(':');
    const endpointHost = endpointParts[0];
    const endpointPort = parseInt(endpointParts[1] || '9000', 10);

    this.minioClient = new MinioClient({
      endPoint: endpointHost,
      port: endpointPort,
      useSSL: this.config.useSSL || false,
      accessKey: this.config.accessKey || '',
      secretKey: this.config.secretKey || '',
    });

    // Ensure bucket exists
    const bucketExists = await this.minioClient.bucketExists(this.config.bucket);
    if (!bucketExists) {
      await this.minioClient.makeBucket(this.config.bucket);
      this.logger.info({ bucket: this.config.bucket }, '[BLOB-STORAGE] Created MinIO bucket');
    }
  }

  private async initGCS(): Promise<void> {
    this.gcsStorage = new GCSStorage();

    // Ensure bucket exists (may fail if no permissions, that's ok)
    try {
      const [exists] = await this.gcsStorage.bucket(this.config.bucket).exists();
      if (!exists) {
        this.logger.warn({ bucket: this.config.bucket }, '[BLOB-STORAGE] GCS bucket does not exist');
      }
    } catch (error) {
      this.logger.warn({ error }, '[BLOB-STORAGE] Could not check GCS bucket existence');
    }
  }

  private async initAzure(): Promise<void> {
    if (!this.config.connectionString) {
      throw new Error('Azure Storage connection string required');
    }

    this.azureBlobClient = BlobServiceClient.fromConnectionString(this.config.connectionString);

    // Ensure container exists
    const containerClient = this.azureBlobClient.getContainerClient(this.config.containerName || 'images');
    await containerClient.createIfNotExists();
  }

  private async initS3(): Promise<void> {
    this.s3Client = new S3Client({
      region: this.config.region,
      credentials: this.config.accessKey && this.config.secretKey ? {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      } : undefined,
    });
  }

  private async initLocal(): Promise<void> {
    const basePath = this.config.basePath || '/data/images';
    await fs.mkdir(basePath, { recursive: true });
  }

  /**
   * Generate a unique blob key
   */
  generateKey(userId: string, prefix: string = 'img'): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    const date = new Date();
    const yearMonth = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;

    return `${yearMonth}/${safeUserId}/${prefix}_${timestamp}_${random}`;
  }

  /**
   * Store a blob (image data)
   */
  async store(
    data: Buffer | string,
    key: string,
    contentType: string = 'image/png'
  ): Promise<BlobMetadata> {
    if (!this.initialized) await this.init();

    const buffer = typeof data === 'string' ? Buffer.from(data, 'base64') : data;

    try {
      switch (this.config.type) {
        case 'minio':
          return await this.storeInMinio(buffer, key, contentType);
        case 'gcs':
          return await this.storeInGCS(buffer, key, contentType);
        case 'azure':
          return await this.storeInAzure(buffer, key, contentType);
        case 's3':
          return await this.storeInS3(buffer, key, contentType);
        case 'local':
        default:
          return await this.storeLocally(buffer, key, contentType);
      }
    } catch (error) {
      this.logger.error({ error, key, type: this.config.type }, '[BLOB-STORAGE] Failed to store');
      throw error;
    }
  }

  private async storeInMinio(buffer: Buffer, key: string, contentType: string): Promise<BlobMetadata> {
    await this.minioClient!.putObject(this.config.bucket, key, buffer, buffer.length, {
      'Content-Type': contentType,
    });

    return {
      id: key.split('/').pop() || key,
      key,
      bucket: this.config.bucket,
      contentType,
      sizeBytes: buffer.length,
      createdAt: new Date(),
    };
  }

  private async storeInGCS(buffer: Buffer, key: string, contentType: string): Promise<BlobMetadata> {
    const file = this.gcsStorage!.bucket(this.config.bucket).file(key);
    await file.save(buffer, { contentType });

    return {
      id: key.split('/').pop() || key,
      key,
      bucket: this.config.bucket,
      contentType,
      sizeBytes: buffer.length,
      createdAt: new Date(),
    };
  }

  private async storeInAzure(buffer: Buffer, key: string, contentType: string): Promise<BlobMetadata> {
    const containerClient = this.azureBlobClient!.getContainerClient(this.config.containerName || 'images');
    const blockBlobClient = containerClient.getBlockBlobClient(key);

    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: contentType },
    });

    return {
      id: key.split('/').pop() || key,
      key,
      bucket: this.config.containerName || 'images',
      contentType,
      sizeBytes: buffer.length,
      createdAt: new Date(),
    };
  }

  private async storeInS3(buffer: Buffer, key: string, contentType: string): Promise<BlobMetadata> {
    await this.s3Client!.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));

    return {
      id: key.split('/').pop() || key,
      key,
      bucket: this.config.bucket,
      contentType,
      sizeBytes: buffer.length,
      createdAt: new Date(),
    };
  }

  private async storeLocally(buffer: Buffer, key: string, contentType: string): Promise<BlobMetadata> {
    const filePath = path.join(this.config.basePath || '/data/images', key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);

    return {
      id: key.split('/').pop() || key,
      key,
      bucket: 'local',
      contentType,
      sizeBytes: buffer.length,
      createdAt: new Date(),
    };
  }

  /**
   * Retrieve a blob
   */
  async get(key: string): Promise<Buffer | null> {
    if (!this.initialized) await this.init();

    try {
      switch (this.config.type) {
        case 'minio':
          return await this.getFromMinio(key);
        case 'gcs':
          return await this.getFromGCS(key);
        case 'azure':
          return await this.getFromAzure(key);
        case 's3':
          return await this.getFromS3(key);
        case 'local':
        default:
          return await this.getLocally(key);
      }
    } catch (error: any) {
      if (error.code === 'NoSuchKey' || error.code === 'ENOENT' || error.code === 'NotFound') {
        return null;
      }
      this.logger.error({ error, key }, '[BLOB-STORAGE] Failed to get');
      throw error;
    }
  }

  private async getFromMinio(key: string): Promise<Buffer | null> {
    try {
      const stream = await this.minioClient!.getObject(this.config.bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error: any) {
      if (error.code === 'NoSuchKey') return null;
      throw error;
    }
  }

  private async getFromGCS(key: string): Promise<Buffer | null> {
    try {
      const [data] = await this.gcsStorage!.bucket(this.config.bucket).file(key).download();
      return data;
    } catch (error: any) {
      if (error.code === 404) return null;
      throw error;
    }
  }

  private async getFromAzure(key: string): Promise<Buffer | null> {
    try {
      const containerClient = this.azureBlobClient!.getContainerClient(this.config.containerName || 'images');
      const blobClient = containerClient.getBlobClient(key);
      const downloadResponse = await blobClient.download();

      const chunks: Buffer[] = [];
      for await (const chunk of downloadResponse.readableStreamBody!) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error: any) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  private async getFromS3(key: string): Promise<Buffer | null> {
    try {
      const response = await this.s3Client!.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }));

      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error: any) {
      if (error.name === 'NoSuchKey') return null;
      throw error;
    }
  }

  private async getLocally(key: string): Promise<Buffer | null> {
    try {
      const filePath = path.join(this.config.basePath || '/data/images', key);
      return await fs.readFile(filePath);
    } catch (error: any) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * Get blob as base64 string
   */
  async getBase64(key: string): Promise<string | null> {
    const buffer = await this.get(key);
    return buffer ? buffer.toString('base64') : null;
  }

  /**
   * Delete a blob
   */
  async delete(key: string): Promise<boolean> {
    if (!this.initialized) await this.init();

    try {
      switch (this.config.type) {
        case 'minio':
          await this.minioClient!.removeObject(this.config.bucket, key);
          break;
        case 'gcs':
          await this.gcsStorage!.bucket(this.config.bucket).file(key).delete();
          break;
        case 'azure':
          const containerClient = this.azureBlobClient!.getContainerClient(this.config.containerName || 'images');
          await containerClient.deleteBlob(key);
          break;
        case 's3':
          await this.s3Client!.send(new DeleteObjectCommand({
            Bucket: this.config.bucket,
            Key: key,
          }));
          break;
        case 'local':
          await fs.unlink(path.join(this.config.basePath || '/data/images', key));
          break;
      }
      return true;
    } catch (error: any) {
      if (error.code === 'ENOENT' || error.code === 'NoSuchKey') {
        return true; // Already deleted
      }
      this.logger.error({ error, key }, '[BLOB-STORAGE] Failed to delete');
      return false;
    }
  }

  /**
   * Check if storage is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.initialized) await this.init();

      switch (this.config.type) {
        case 'minio':
          await this.minioClient!.bucketExists(this.config.bucket);
          break;
        case 'gcs':
          await this.gcsStorage!.bucket(this.config.bucket).exists();
          break;
        case 'azure':
          await this.azureBlobClient!.getContainerClient(this.config.containerName || 'images').exists();
          break;
        case 's3':
          // S3 doesn't have a simple health check, just return true if client exists
          break;
        case 'local':
          await fs.access(this.config.basePath || '/data/images');
          break;
      }
      return true;
    } catch {
      return false;
    }
  }

  getConfig(): StorageConfig {
    return { ...this.config };
  }

  /**
   * List all buckets visible to the configured MinIO credentials.
   * Returns bucket name + creation date.
   */
  async listBuckets(): Promise<Array<{ name: string; creationDate?: string }>> {
    if (!this.initialized) await this.init();
    if (this.config.type !== 'minio' || !this.minioClient) {
      return [{ name: this.config.bucket }]; // fallback: return configured bucket
    }
    try {
      const buckets = await this.minioClient.listBuckets();
      return buckets.map(b => ({ name: b.name, creationDate: b.creationDate?.toISOString() }));
    } catch (error) {
      this.logger.warn({ error }, '[BLOB-STORAGE] Failed to list buckets, returning configured bucket');
      return [{ name: this.config.bucket }];
    }
  }

  /**
   * List objects in a bucket with optional prefix and delimiter for folder-like browsing.
   */
  async listObjects(bucket: string, prefix: string = '', _delimiter: string = '/'): Promise<{
    prefixes: string[];
    objects: Array<{ key: string; size: number; lastModified?: string }>;
  }> {
    if (!this.initialized) await this.init();
    if (this.config.type !== 'minio' || !this.minioClient) {
      return { prefixes: [], objects: [] };
    }

    return new Promise((resolve) => {
      const prefixes: string[] = [];
      const objects: Array<{ key: string; size: number; lastModified?: string }> = [];
      // recursive=false uses '/' delimiter automatically for folder-like browsing
      const stream = this.minioClient!.listObjectsV2(bucket, prefix, false);

      stream.on('data', (item: any) => {
        if (item.prefix) {
          prefixes.push(item.prefix);
        } else if (item.name) {
          objects.push({
            key: item.name,
            size: item.size || 0,
            lastModified: item.lastModified?.toISOString(),
          });
        }
      });
      stream.on('end', () => resolve({ prefixes, objects }));
      stream.on('error', (err: any) => {
        this.logger.warn({ error: err, bucket, prefix }, '[BLOB-STORAGE] Failed to list objects');
        resolve({ prefixes: [], objects: [] });
      });
    });
  }
}
