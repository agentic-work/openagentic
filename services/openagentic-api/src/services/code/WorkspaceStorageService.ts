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
 * WorkspaceStorageService - Multi-cloud storage abstraction for OpenAgenticCode
 *
 * Supports:
 * - MinIO (local/on-prem, S3-compatible)
 * - AWS S3
 * - Azure Blob Storage
 * - Google Cloud Storage
 *
 * Handles workspace snapshots, file uploads, and persistent storage across sessions.
 */

import { PrismaClient } from '@prisma/client';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';

// Types
export type StorageBackendType = 'minio' | 's3' | 'azure-blob' | 'gcs';

export interface StorageConfig {
  backend: StorageBackendType;
  bucket: string;
  region?: string;
  endpoint?: string;
  credentials: StorageCredentials;
}

export type StorageCredentials =
  | MinIOCredentials
  | S3Credentials
  | AzureBlobCredentials
  | GCSCredentials;

interface MinIOCredentials {
  type: 'minio';
  endpoint: string;
  accessKey: string;
  secretKey: string;
  useSSL: boolean;
}

interface S3Credentials {
  type: 's3';
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  roleArn?: string; // For assuming roles
}

interface AzureBlobCredentials {
  type: 'azure-blob';
  accountName: string;
  accountKey?: string;
  connectionString?: string;
  sasToken?: string;
}

interface GCSCredentials {
  type: 'gcs';
  projectId: string;
  credentials: string; // Base64 encoded service account JSON
}

export interface UploadOptions {
  compression?: 'none' | 'gzip' | 'zstd' | 'lz4';
  encrypt?: boolean;
  encryptionKeyId?: string;
  metadata?: Record<string, string>;
  contentType?: string;
}

export interface DownloadOptions {
  decompress?: boolean;
  decrypt?: boolean;
}

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface UploadResult {
  key: string;
  size: number;
  compressedSize?: number;
  checksum: string;
  etag?: string;
}

/**
 * Abstract base class for storage backends
 */
abstract class StorageBackend {
  constructor(
    protected config: StorageConfig,
    protected logger: Console = console
  ) {}

  abstract upload(
    key: string,
    data: Buffer | Readable,
    options?: UploadOptions
  ): Promise<UploadResult>;

  abstract download(key: string, options?: DownloadOptions): Promise<Buffer>;

  abstract downloadStream(key: string, options?: DownloadOptions): Promise<Readable>;

  abstract delete(key: string): Promise<void>;

  abstract deleteMany(keys: string[]): Promise<void>;

  abstract exists(key: string): Promise<boolean>;

  abstract list(prefix: string, maxKeys?: number): Promise<StorageObject[]>;

  abstract getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;

  abstract healthCheck(): Promise<{ healthy: boolean; message?: string }>;

  /**
   * Compress data if compression is specified
   */
  protected async compress(
    data: Buffer,
    compression: 'none' | 'gzip' | 'zstd' | 'lz4'
  ): Promise<Buffer> {
    switch (compression) {
      case 'gzip':
        return promisify(zlib.gzip)(data);
      case 'zstd':
        // Would need zstd library - fallback to gzip for now
        this.logger.warn('zstd compression not available, falling back to gzip');
        return promisify(zlib.gzip)(data);
      case 'lz4':
        // Would need lz4 library - fallback to gzip for now
        this.logger.warn('lz4 compression not available, falling back to gzip');
        return promisify(zlib.gzip)(data);
      case 'none':
      default:
        return data;
    }
  }

  /**
   * Decompress data
   */
  protected async decompress(data: Buffer, compression: string): Promise<Buffer> {
    switch (compression) {
      case 'gzip':
        return promisify(zlib.gunzip)(data);
      case 'zstd':
      case 'lz4':
        // Fallback - these would be detected from metadata
        return promisify(zlib.gunzip)(data);
      default:
        return data;
    }
  }

  /**
   * Calculate SHA256 checksum
   */
  protected calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

/**
 * MinIO/S3-compatible storage backend
 */
class MinIOBackend extends StorageBackend {
  private client: any; // Minio.Client type

  constructor(config: StorageConfig) {
    super(config);
    this.initClient();
  }

  private async initClient(): Promise<void> {
    // Dynamic import to avoid bundling issues
    const { Client } = await import('minio');
    const creds = this.config.credentials as MinIOCredentials;

    this.client = new Client({
      endPoint: new URL(creds.endpoint).hostname,
      port: parseInt(new URL(creds.endpoint).port) || (creds.useSSL ? 443 : 9000),
      useSSL: creds.useSSL,
      accessKey: creds.accessKey,
      secretKey: creds.secretKey,
    });
  }

  async upload(key: string, data: Buffer | Readable, options?: UploadOptions): Promise<UploadResult> {
    await this.ensureClient();

    let uploadData = Buffer.isBuffer(data) ? data : await this.streamToBuffer(data);
    const originalSize = uploadData.length;

    // Compress if requested
    if (options?.compression && options.compression !== 'none') {
      uploadData = await this.compress(uploadData, options.compression);
    }

    const checksum = this.calculateChecksum(uploadData);

    const metadata: Record<string, string> = {
      ...options?.metadata,
      'x-amz-meta-checksum': checksum,
      'x-amz-meta-original-size': originalSize.toString(),
    };

    if (options?.compression) {
      metadata['x-amz-meta-compression'] = options.compression;
    }

    await this.client.putObject(this.config.bucket, key, uploadData, uploadData.length, metadata);

    return {
      key,
      size: originalSize,
      compressedSize: uploadData.length,
      checksum,
    };
  }

  async download(key: string, options?: DownloadOptions): Promise<Buffer> {
    await this.ensureClient();

    const stream = await this.client.getObject(this.config.bucket, key);
    let data = await this.streamToBuffer(stream);

    if (options?.decompress) {
      // Get compression type from object metadata
      const stat = await this.client.statObject(this.config.bucket, key);
      const compression = stat.metaData?.['x-amz-meta-compression'];
      if (compression) {
        data = await this.decompress(data, compression);
      }
    }

    return data;
  }

  async downloadStream(key: string, _options?: DownloadOptions): Promise<Readable> {
    await this.ensureClient();
    return this.client.getObject(this.config.bucket, key);
  }

  async delete(key: string): Promise<void> {
    await this.ensureClient();
    await this.client.removeObject(this.config.bucket, key);
  }

  async deleteMany(keys: string[]): Promise<void> {
    await this.ensureClient();
    await this.client.removeObjects(this.config.bucket, keys);
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureClient();
    try {
      await this.client.statObject(this.config.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string, maxKeys: number = 1000): Promise<StorageObject[]> {
    await this.ensureClient();
    const objects: StorageObject[] = [];

    const stream = this.client.listObjects(this.config.bucket, prefix, true);

    return new Promise((resolve, reject) => {
      stream.on('data', (obj: any) => {
        if (objects.length < maxKeys) {
          objects.push({
            key: obj.name,
            size: obj.size,
            lastModified: obj.lastModified,
            etag: obj.etag,
          });
        }
      });
      stream.on('end', () => resolve(objects));
      stream.on('error', reject);
    });
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    await this.ensureClient();
    return this.client.presignedGetObject(this.config.bucket, key, expiresInSeconds);
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      await this.ensureClient();
      const exists = await this.client.bucketExists(this.config.bucket);
      return { healthy: exists, message: exists ? 'Bucket accessible' : 'Bucket not found' };
    } catch (error) {
      return { healthy: false, message: `Health check failed: ${error}` };
    }
  }

  private async ensureClient(): Promise<void> {
    if (!this.client) {
      await this.initClient();
    }
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

/**
 * AWS S3 storage backend
 */
class S3Backend extends StorageBackend {
  private client: any; // S3Client type

  constructor(config: StorageConfig) {
    super(config);
    this.initClient();
  }

  private async initClient(): Promise<void> {
    const { S3Client } = await import('@aws-sdk/client-s3');
    const creds = this.config.credentials as S3Credentials;

    this.client = new S3Client({
      region: creds.region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });
  }

  async upload(key: string, data: Buffer | Readable, options?: UploadOptions): Promise<UploadResult> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');

    let uploadData = Buffer.isBuffer(data) ? data : await this.streamToBuffer(data);
    const originalSize = uploadData.length;

    if (options?.compression && options.compression !== 'none') {
      uploadData = await this.compress(uploadData, options.compression);
    }

    const checksum = this.calculateChecksum(uploadData);

    const metadata: Record<string, string> = {
      ...options?.metadata,
      checksum,
      'original-size': originalSize.toString(),
    };

    if (options?.compression) {
      metadata['compression'] = options.compression;
    }

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: uploadData,
      ContentType: options?.contentType || 'application/octet-stream',
      Metadata: metadata,
    });

    const result = await this.client.send(command);

    return {
      key,
      size: originalSize,
      compressedSize: uploadData.length,
      checksum,
      etag: result.ETag,
    };
  }

  async download(key: string, options?: DownloadOptions): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    let data = await this.streamToBuffer(response.Body as Readable);

    if (options?.decompress && response.Metadata?.compression) {
      data = await this.decompress(data, response.Metadata.compression);
    }

    return data;
  }

  async downloadStream(key: string, _options?: DownloadOptions): Promise<Readable> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    return response.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');

    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  async deleteMany(keys: string[]): Promise<void> {
    const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');

    const command = new DeleteObjectsCommand({
      Bucket: this.config.bucket,
      Delete: {
        Objects: keys.map((key) => ({ Key: key })),
      },
    });

    await this.client.send(command);
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');

    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string, maxKeys: number = 1000): Promise<StorageObject[]> {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');

    const command = new ListObjectsV2Command({
      Bucket: this.config.bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const response = await this.client.send(command);

    return (response.Contents || []).map((obj: any) => ({
      key: obj.Key!,
      size: obj.Size!,
      lastModified: obj.LastModified!,
      etag: obj.ETag,
    }));
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
      const command = new HeadBucketCommand({ Bucket: this.config.bucket });
      await this.client.send(command);
      return { healthy: true, message: 'Bucket accessible' };
    } catch (error) {
      return { healthy: false, message: `Health check failed: ${error}` };
    }
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

/**
 * Azure Blob Storage backend
 */
class AzureBlobBackend extends StorageBackend {
  private containerClient: any;

  constructor(config: StorageConfig) {
    super(config);
    this.initClient();
  }

  private async initClient(): Promise<void> {
    const { BlobServiceClient, StorageSharedKeyCredential } = await import(
      '@azure/storage-blob'
    );
    const creds = this.config.credentials as AzureBlobCredentials;

    let serviceClient: any;

    if (creds.connectionString) {
      serviceClient = BlobServiceClient.fromConnectionString(creds.connectionString);
    } else if (creds.accountName && creds.accountKey) {
      const sharedKeyCredential = new StorageSharedKeyCredential(
        creds.accountName,
        creds.accountKey
      );
      serviceClient = new BlobServiceClient(
        `https://${creds.accountName}.blob.core.windows.net`,
        sharedKeyCredential
      );
    } else {
      throw new Error('Azure Blob credentials not properly configured');
    }

    this.containerClient = serviceClient.getContainerClient(this.config.bucket);
  }

  async upload(key: string, data: Buffer | Readable, options?: UploadOptions): Promise<UploadResult> {
    await this.ensureClient();

    let uploadData = Buffer.isBuffer(data) ? data : await this.streamToBuffer(data);
    const originalSize = uploadData.length;

    if (options?.compression && options.compression !== 'none') {
      uploadData = await this.compress(uploadData, options.compression);
    }

    const checksum = this.calculateChecksum(uploadData);

    const blockBlobClient = this.containerClient.getBlockBlobClient(key);

    const metadata: Record<string, string> = {
      ...options?.metadata,
      checksum,
      originalsize: originalSize.toString(),
    };

    if (options?.compression) {
      metadata['compression'] = options.compression;
    }

    await blockBlobClient.upload(uploadData, uploadData.length, {
      blobHTTPHeaders: {
        blobContentType: options?.contentType || 'application/octet-stream',
      },
      metadata,
    });

    return {
      key,
      size: originalSize,
      compressedSize: uploadData.length,
      checksum,
    };
  }

  async download(key: string, options?: DownloadOptions): Promise<Buffer> {
    await this.ensureClient();

    const blockBlobClient = this.containerClient.getBlockBlobClient(key);
    const response = await blockBlobClient.download();

    let data = await this.streamToBuffer(response.readableStreamBody!);

    if (options?.decompress) {
      const properties = await blockBlobClient.getProperties();
      const compression = properties.metadata?.compression;
      if (compression) {
        data = await this.decompress(data, compression);
      }
    }

    return data;
  }

  async downloadStream(key: string, _options?: DownloadOptions): Promise<Readable> {
    await this.ensureClient();

    const blockBlobClient = this.containerClient.getBlockBlobClient(key);
    const response = await blockBlobClient.download();
    return response.readableStreamBody!;
  }

  async delete(key: string): Promise<void> {
    await this.ensureClient();
    const blockBlobClient = this.containerClient.getBlockBlobClient(key);
    await blockBlobClient.delete();
  }

  async deleteMany(keys: string[]): Promise<void> {
    await this.ensureClient();
    await Promise.all(
      keys.map((key) => {
        const blockBlobClient = this.containerClient.getBlockBlobClient(key);
        return blockBlobClient.delete();
      })
    );
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureClient();
    const blockBlobClient = this.containerClient.getBlockBlobClient(key);
    return blockBlobClient.exists();
  }

  async list(prefix: string, maxKeys: number = 1000): Promise<StorageObject[]> {
    await this.ensureClient();

    const objects: StorageObject[] = [];

    for await (const blob of this.containerClient.listBlobsFlat({ prefix })) {
      if (objects.length >= maxKeys) break;
      objects.push({
        key: blob.name,
        size: blob.properties.contentLength || 0,
        lastModified: blob.properties.lastModified || new Date(),
        etag: blob.properties.etag,
      });
    }

    return objects;
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    await this.ensureClient();

    const { BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } =
      await import('@azure/storage-blob');

    const creds = this.config.credentials as AzureBlobCredentials;
    const blockBlobClient = this.containerClient.getBlockBlobClient(key);

    if (!creds.accountKey) {
      throw new Error('Account key required for generating signed URLs');
    }

    const credential = new StorageSharedKeyCredential(creds.accountName, creds.accountKey);

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: this.config.bucket,
        blobName: key,
        permissions: BlobSASPermissions.parse('r'),
        startsOn: new Date(),
        expiresOn: new Date(Date.now() + expiresInSeconds * 1000),
      },
      credential
    ).toString();

    return `${blockBlobClient.url}?${sasToken}`;
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      await this.ensureClient();
      const exists = await this.containerClient.exists();
      return { healthy: exists, message: exists ? 'Container accessible' : 'Container not found' };
    } catch (error) {
      return { healthy: false, message: `Health check failed: ${error}` };
    }
  }

  private async ensureClient(): Promise<void> {
    if (!this.containerClient) {
      await this.initClient();
    }
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

/**
 * Google Cloud Storage backend
 */
class GCSBackend extends StorageBackend {
  private bucket: any;

  constructor(config: StorageConfig) {
    super(config);
    this.initClient();
  }

  private async initClient(): Promise<void> {
    const { Storage } = await import('@google-cloud/storage');
    const creds = this.config.credentials as GCSCredentials;

    const credentials = JSON.parse(Buffer.from(creds.credentials, 'base64').toString('utf-8'));

    const storage = new Storage({
      projectId: creds.projectId,
      credentials,
    });

    this.bucket = storage.bucket(this.config.bucket);
  }

  async upload(key: string, data: Buffer | Readable, options?: UploadOptions): Promise<UploadResult> {
    await this.ensureClient();

    let uploadData = Buffer.isBuffer(data) ? data : await this.streamToBuffer(data);
    const originalSize = uploadData.length;

    if (options?.compression && options.compression !== 'none') {
      uploadData = await this.compress(uploadData, options.compression);
    }

    const checksum = this.calculateChecksum(uploadData);

    const metadata: Record<string, string> = {
      ...options?.metadata,
      checksum,
      originalSize: originalSize.toString(),
    };

    if (options?.compression) {
      metadata['compression'] = options.compression;
    }

    const file = this.bucket.file(key);
    await file.save(uploadData, {
      contentType: options?.contentType || 'application/octet-stream',
      metadata: { metadata },
    });

    return {
      key,
      size: originalSize,
      compressedSize: uploadData.length,
      checksum,
    };
  }

  async download(key: string, options?: DownloadOptions): Promise<Buffer> {
    await this.ensureClient();

    const file = this.bucket.file(key);
    const [data] = await file.download();

    if (options?.decompress) {
      const [metadata] = await file.getMetadata();
      const compression = metadata.metadata?.compression;
      if (compression) {
        return this.decompress(data, compression);
      }
    }

    return data;
  }

  async downloadStream(key: string, _options?: DownloadOptions): Promise<Readable> {
    await this.ensureClient();
    const file = this.bucket.file(key);
    return file.createReadStream();
  }

  async delete(key: string): Promise<void> {
    await this.ensureClient();
    const file = this.bucket.file(key);
    await file.delete();
  }

  async deleteMany(keys: string[]): Promise<void> {
    await this.ensureClient();
    await Promise.all(keys.map((key) => this.bucket.file(key).delete()));
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureClient();
    const file = this.bucket.file(key);
    const [exists] = await file.exists();
    return exists;
  }

  async list(prefix: string, maxKeys: number = 1000): Promise<StorageObject[]> {
    await this.ensureClient();

    const [files] = await this.bucket.getFiles({
      prefix,
      maxResults: maxKeys,
    });

    return files.map((file: any) => ({
      key: file.name,
      size: parseInt(file.metadata.size, 10),
      lastModified: new Date(file.metadata.updated),
      etag: file.metadata.etag,
    }));
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    await this.ensureClient();

    const file = this.bucket.file(key);
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInSeconds * 1000,
    });

    return url;
  }

  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      await this.ensureClient();
      const [exists] = await this.bucket.exists();
      return { healthy: exists, message: exists ? 'Bucket accessible' : 'Bucket not found' };
    } catch (error) {
      return { healthy: false, message: `Health check failed: ${error}` };
    }
  }

  private async ensureClient(): Promise<void> {
    if (!this.bucket) {
      await this.initClient();
    }
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

/**
 * Main service class for workspace storage operations
 */
export class WorkspaceStorageService {
  private backends: Map<string, StorageBackend> = new Map();
  private defaultBackendName: string | null = null;

  constructor(private prisma: PrismaClient) {}

  /**
   * Initialize storage backends from database configuration
   */
  async initialize(): Promise<void> {
    const backends = await this.prisma.codeStorageBackend.findMany({
      where: { is_enabled: true },
    });

    for (const backend of backends) {
      try {
        const config: StorageConfig = {
          backend: backend.backend_type as StorageBackendType,
          bucket: backend.default_bucket || '',
          region: backend.default_region || undefined,
          credentials: backend.connection_config as unknown as StorageCredentials,
        };

        const storageBackend = this.createBackend(config);
        this.backends.set(backend.name, storageBackend);

        if (backend.is_default) {
          this.defaultBackendName = backend.name;
        }

        console.log(`[WorkspaceStorage] Initialized backend: ${backend.name} (${backend.backend_type})`);
      } catch (error) {
        console.error(`[WorkspaceStorage] Failed to initialize backend ${backend.name}:`, error);
      }
    }

    // If no default backend set, use the first one
    if (!this.defaultBackendName && this.backends.size > 0) {
      this.defaultBackendName = this.backends.keys().next().value || null;
    }
  }

  /**
   * Create a storage backend instance
   */
  private createBackend(config: StorageConfig): StorageBackend {
    switch (config.backend) {
      case 'minio':
        return new MinIOBackend(config);
      case 's3':
        return new S3Backend(config);
      case 'azure-blob':
        return new AzureBlobBackend(config);
      case 'gcs':
        return new GCSBackend(config);
      default:
        throw new Error(`Unsupported storage backend: ${config.backend}`);
    }
  }

  /**
   * Get a storage backend by name
   */
  getBackend(name?: string): StorageBackend {
    const backendName = name || this.defaultBackendName;
    if (!backendName) {
      throw new Error('No storage backend available');
    }

    const backend = this.backends.get(backendName);
    if (!backend) {
      throw new Error(`Storage backend not found: ${backendName}`);
    }

    return backend;
  }

  /**
   * Create a workspace snapshot
   */
  async createSnapshot(
    sessionId: string,
    workspacePath: string,
    options?: {
      backendName?: string;
      compression?: 'none' | 'gzip' | 'zstd' | 'lz4';
      snapshotType?: 'full' | 'incremental';
    }
  ): Promise<string> {
    const backend = this.getBackend(options?.backendName);
    const snapshotId = crypto.randomUUID();

    // Create snapshot record
    const snapshot = await this.prisma.workspaceSnapshot.create({
      data: {
        session_id: sessionId,
        storage_backend: options?.backendName || this.defaultBackendName || 'minio',
        storage_path: `snapshots/${sessionId}/${snapshotId}.tar.gz`,
        snapshot_type: options?.snapshotType || 'full',
        compression: options?.compression || 'gzip',
        status: 'pending',
      },
    });

    // Actual snapshot creation would involve:
    // 1. Create tar archive of workspace
    // 2. Compress it
    // 3. Upload to storage backend
    // 4. Update snapshot record with size, checksum, etc.

    return snapshot.id;
  }

  /**
   * Restore a workspace from snapshot
   */
  async restoreSnapshot(snapshotId: string, targetPath: string): Promise<void> {
    const snapshot = await this.prisma.workspaceSnapshot.findUnique({
      where: { id: snapshotId },
    });

    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const backend = this.getBackend(snapshot.storage_backend);

    // Download and extract snapshot
    const data = await backend.download(snapshot.storage_path, { decompress: true });

    // Extract tar to targetPath
    // This would use tar library to extract
  }

  /**
   * Run health checks on all backends
   */
  async healthCheck(): Promise<Map<string, { healthy: boolean; message?: string }>> {
    const results = new Map<string, { healthy: boolean; message?: string }>();

    for (const [name, backend] of this.backends) {
      const health = await backend.healthCheck();
      results.set(name, health);

      // Update database
      await this.prisma.codeStorageBackend.update({
        where: { name },
        data: {
          last_health_check: new Date(),
          health_status: health.healthy ? 'healthy' : 'unhealthy',
          health_message: health.message,
        },
      });
    }

    return results;
  }
}

export default WorkspaceStorageService;
