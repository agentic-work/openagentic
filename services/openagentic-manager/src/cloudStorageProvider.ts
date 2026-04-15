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
 * Cloud Storage Provider Abstraction
 *
 * Unified interface for cloud object storage providers.
 * Supports:
 * - MinIO (local development / self-hosted)
 * - AWS S3
 * - Azure Blob Storage
 * - Google Cloud Storage
 *
 * Cloud storage is the PRIMARY storage for user workspaces.
 * Local filesystem is only a working cache.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { BlobServiceClient, ContainerClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { Storage as GCSStorage } from '@google-cloud/storage';
import { Readable } from 'stream';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type StorageProviderType = 'minio' | 's3' | 'azure' | 'gcs';

export interface CloudStorageConfig {
  provider: StorageProviderType;
  bucket: string;

  // S3/MinIO specific
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;

  // Azure specific
  azureAccountName?: string;
  azureAccountKey?: string;
  azureConnectionString?: string;

  // GCP specific
  gcpProjectId?: string;
  gcpKeyFile?: string;
}

export interface StorageObject {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
}

export interface ListResult {
  objects: StorageObject[];
  prefixes: string[];  // For "folder" listing
  isTruncated: boolean;
  continuationToken?: string;
}

/**
 * Abstract interface for cloud storage providers
 */
export interface ICloudStorageProvider {
  readonly providerType: StorageProviderType;

  // Initialization
  initialize(): Promise<void>;
  ensureBucket(): Promise<void>;

  // Basic operations
  uploadFile(key: string, content: Buffer | string, contentType?: string): Promise<void>;
  downloadFile(key: string): Promise<Buffer>;
  deleteFile(key: string): Promise<void>;
  fileExists(key: string): Promise<boolean>;
  getFileMetadata(key: string): Promise<StorageObject | null>;

  // Directory operations
  listFiles(prefix: string, delimiter?: string): Promise<ListResult>;
  deleteDirectory(prefix: string): Promise<number>;  // Returns count of deleted files

  // Bulk operations
  uploadDirectory(localPath: string, remotePrefix: string): Promise<number>;
  downloadDirectory(remotePrefix: string, localPath: string): Promise<number>;

  // Utility
  getSignedUrl?(key: string, expiresInSeconds: number): Promise<string>;
  copyFile?(sourceKey: string, destKey: string): Promise<void>;
}

// ============================================================================
// Configuration
// ============================================================================

export function getStorageConfig(): CloudStorageConfig {
  const provider = (process.env.STORAGE_PROVIDER || process.env.CLOUD_STORAGE_PROVIDER || 'minio') as StorageProviderType;

  // Get endpoint and ensure it has http:// prefix for MinIO/S3
  let endpoint = process.env.STORAGE_ENDPOINT || process.env.MINIO_ENDPOINT;
  if (endpoint && !endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    endpoint = `http://${endpoint}`;
  }

  return {
    provider,
    bucket: process.env.STORAGE_BUCKET || process.env.MINIO_BUCKET || 'openagentic-workspaces',

    // S3/MinIO
    endpoint,
    region: process.env.STORAGE_REGION || process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.STORAGE_ACCESS_KEY || process.env.MINIO_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_KEY || process.env.MINIO_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY,
    forcePathStyle: provider === 'minio' || process.env.S3_FORCE_PATH_STYLE === 'true',

    // Azure
    azureAccountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
    azureAccountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,
    azureConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,

    // GCP
    gcpProjectId: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    gcpKeyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };
}

// ============================================================================
// S3/MinIO Provider
// ============================================================================

export class S3StorageProvider implements ICloudStorageProvider {
  readonly providerType: StorageProviderType;
  private client: S3Client;
  private config: CloudStorageConfig;
  private initialized = false;

  constructor(config: CloudStorageConfig) {
    this.config = config;
    this.providerType = config.provider === 'minio' ? 'minio' : 's3';

    const clientConfig: any = {
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId || '',
        secretAccessKey: config.secretAccessKey || '',
      },
    };

    // MinIO requires endpoint and path-style
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
    }
    if (config.forcePathStyle) {
      clientConfig.forcePathStyle = true;
    }

    this.client = new S3Client(clientConfig);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.ensureBucket();
    this.initialized = true;
    console.log(`[${this.providerType.toUpperCase()}] Storage initialized with bucket: ${this.config.bucket}`);
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        try {
          await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
          console.log(`[${this.providerType.toUpperCase()}] Created bucket: ${this.config.bucket}`);
        } catch (createError: any) {
          if (createError.name !== 'BucketAlreadyOwnedByYou' && createError.name !== 'BucketAlreadyExists') {
            throw createError;
          }
        }
      } else {
        throw error;
      }
    }
  }

  async uploadFile(key: string, content: Buffer | string, contentType?: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: content,
      ContentType: contentType || 'application/octet-stream',
    }));
  }

  async downloadFile(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }));

    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as Readable) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async deleteFile(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    }));
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }));
      return true;
    } catch {
      return false;
    }
  }

  async getFileMetadata(key: string): Promise<StorageObject | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }));
      return {
        key,
        size: result.ContentLength || 0,
        lastModified: result.LastModified || new Date(),
        etag: result.ETag,
      };
    } catch {
      return null;
    }
  }

  async listFiles(prefix: string, delimiter?: string): Promise<ListResult> {
    const result = await this.client.send(new ListObjectsV2Command({
      Bucket: this.config.bucket,
      Prefix: prefix,
      Delimiter: delimiter,
    }));

    return {
      objects: (result.Contents || []).map(obj => ({
        key: obj.Key || '',
        size: obj.Size || 0,
        lastModified: obj.LastModified || new Date(),
        etag: obj.ETag,
      })),
      prefixes: (result.CommonPrefixes || []).map(p => p.Prefix || ''),
      isTruncated: result.IsTruncated || false,
      continuationToken: result.NextContinuationToken,
    };
  }

  async deleteDirectory(prefix: string): Promise<number> {
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const listResult = await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));

      for (const obj of listResult.Contents || []) {
        if (obj.Key) {
          await this.deleteFile(obj.Key);
          deleted++;
        }
      }

      continuationToken = listResult.NextContinuationToken;
    } while (continuationToken);

    return deleted;
  }

  async uploadDirectory(localPath: string, remotePrefix: string): Promise<number> {
    const fs = await import('fs/promises');
    const path = await import('path');
    let uploaded = 0;

    const uploadRecursive = async (dir: string, prefix: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const localFilePath = path.join(dir, entry.name);
        const remoteKey = `${prefix}${entry.name}`;

        if (entry.isDirectory()) {
          await uploadRecursive(localFilePath, `${remoteKey}/`);
        } else if (entry.isFile()) {
          const content = await fs.readFile(localFilePath);
          await this.uploadFile(remoteKey, content);
          uploaded++;
        }
      }
    };

    await uploadRecursive(localPath, remotePrefix.endsWith('/') ? remotePrefix : `${remotePrefix}/`);
    return uploaded;
  }

  async downloadDirectory(remotePrefix: string, localPath: string): Promise<number> {
    const fs = await import('fs/promises');
    const path = await import('path');
    let downloaded = 0;

    const listResult = await this.listFiles(remotePrefix);

    for (const obj of listResult.objects) {
      const relativePath = obj.key.substring(remotePrefix.length);
      if (!relativePath) continue;

      const localFilePath = path.join(localPath, relativePath);
      const localDir = path.dirname(localFilePath);

      await fs.mkdir(localDir, { recursive: true });
      const content = await this.downloadFile(obj.key);
      await fs.writeFile(localFilePath, content);
      downloaded++;
    }

    return downloaded;
  }

  async copyFile(sourceKey: string, destKey: string): Promise<void> {
    await this.client.send(new CopyObjectCommand({
      Bucket: this.config.bucket,
      CopySource: `${this.config.bucket}/${sourceKey}`,
      Key: destKey,
    }));
  }
}

// ============================================================================
// Azure Blob Storage Provider
// ============================================================================

export class AzureBlobStorageProvider implements ICloudStorageProvider {
  readonly providerType: StorageProviderType = 'azure';
  private containerClient: ContainerClient | null = null;
  private config: CloudStorageConfig;
  private initialized = false;

  constructor(config: CloudStorageConfig) {
    this.config = config;
  }

  private getContainerClient(): ContainerClient {
    if (this.containerClient) return this.containerClient;

    let blobServiceClient: BlobServiceClient;

    if (this.config.azureConnectionString) {
      blobServiceClient = BlobServiceClient.fromConnectionString(this.config.azureConnectionString);
    } else if (this.config.azureAccountName && this.config.azureAccountKey) {
      const credential = new StorageSharedKeyCredential(
        this.config.azureAccountName,
        this.config.azureAccountKey
      );
      blobServiceClient = new BlobServiceClient(
        `https://${this.config.azureAccountName}.blob.core.windows.net`,
        credential
      );
    } else {
      throw new Error('Azure storage requires either connection string or account name/key');
    }

    this.containerClient = blobServiceClient.getContainerClient(this.config.bucket);
    return this.containerClient;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.ensureBucket();
    this.initialized = true;
    console.log(`[AZURE] Storage initialized with container: ${this.config.bucket}`);
  }

  async ensureBucket(): Promise<void> {
    const container = this.getContainerClient();
    const exists = await container.exists();
    if (!exists) {
      await container.create();
      console.log(`[AZURE] Created container: ${this.config.bucket}`);
    }
  }

  async uploadFile(key: string, content: Buffer | string, contentType?: string): Promise<void> {
    const container = this.getContainerClient();
    const blobClient = container.getBlockBlobClient(key);
    const buffer = typeof content === 'string' ? Buffer.from(content) : content;
    await blobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' },
    });
  }

  async downloadFile(key: string): Promise<Buffer> {
    const container = this.getContainerClient();
    const blobClient = container.getBlobClient(key);
    const downloadResponse = await blobClient.download();

    const chunks: Buffer[] = [];
    for await (const chunk of downloadResponse.readableStreamBody as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async deleteFile(key: string): Promise<void> {
    const container = this.getContainerClient();
    const blobClient = container.getBlobClient(key);
    await blobClient.deleteIfExists();
  }

  async fileExists(key: string): Promise<boolean> {
    const container = this.getContainerClient();
    const blobClient = container.getBlobClient(key);
    return await blobClient.exists();
  }

  async getFileMetadata(key: string): Promise<StorageObject | null> {
    const container = this.getContainerClient();
    const blobClient = container.getBlobClient(key);

    try {
      const props = await blobClient.getProperties();
      return {
        key,
        size: props.contentLength || 0,
        lastModified: props.lastModified || new Date(),
        etag: props.etag,
      };
    } catch {
      return null;
    }
  }

  async listFiles(prefix: string, delimiter?: string): Promise<ListResult> {
    const container = this.getContainerClient();
    const objects: StorageObject[] = [];
    const prefixes: string[] = [];

    if (delimiter) {
      // Hierarchical listing
      for await (const item of container.listBlobsByHierarchy(delimiter, { prefix })) {
        if (item.kind === 'prefix') {
          prefixes.push(item.name);
        } else {
          objects.push({
            key: item.name,
            size: item.properties.contentLength || 0,
            lastModified: item.properties.lastModified || new Date(),
            etag: item.properties.etag,
          });
        }
      }
    } else {
      // Flat listing
      for await (const blob of container.listBlobsFlat({ prefix })) {
        objects.push({
          key: blob.name,
          size: blob.properties.contentLength || 0,
          lastModified: blob.properties.lastModified || new Date(),
          etag: blob.properties.etag,
        });
      }
    }

    return { objects, prefixes, isTruncated: false };
  }

  async deleteDirectory(prefix: string): Promise<number> {
    const container = this.getContainerClient();
    let deleted = 0;

    for await (const blob of container.listBlobsFlat({ prefix })) {
      await container.getBlobClient(blob.name).deleteIfExists();
      deleted++;
    }

    return deleted;
  }

  async uploadDirectory(localPath: string, remotePrefix: string): Promise<number> {
    const fs = await import('fs/promises');
    const path = await import('path');
    let uploaded = 0;

    const uploadRecursive = async (dir: string, prefix: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const localFilePath = path.join(dir, entry.name);
        const remoteKey = `${prefix}${entry.name}`;

        if (entry.isDirectory()) {
          await uploadRecursive(localFilePath, `${remoteKey}/`);
        } else if (entry.isFile()) {
          const content = await fs.readFile(localFilePath);
          await this.uploadFile(remoteKey, content);
          uploaded++;
        }
      }
    };

    await uploadRecursive(localPath, remotePrefix.endsWith('/') ? remotePrefix : `${remotePrefix}/`);
    return uploaded;
  }

  async downloadDirectory(remotePrefix: string, localPath: string): Promise<number> {
    const fs = await import('fs/promises');
    const path = await import('path');
    let downloaded = 0;

    const listResult = await this.listFiles(remotePrefix);

    for (const obj of listResult.objects) {
      const relativePath = obj.key.substring(remotePrefix.length);
      if (!relativePath) continue;

      const localFilePath = path.join(localPath, relativePath);
      const localDir = path.dirname(localFilePath);

      await fs.mkdir(localDir, { recursive: true });
      const content = await this.downloadFile(obj.key);
      await fs.writeFile(localFilePath, content);
      downloaded++;
    }

    return downloaded;
  }

  async copyFile(sourceKey: string, destKey: string): Promise<void> {
    const container = this.getContainerClient();
    const sourceBlobClient = container.getBlobClient(sourceKey);
    const destBlobClient = container.getBlobClient(destKey);

    const poller = await destBlobClient.beginCopyFromURL(sourceBlobClient.url);
    await poller.pollUntilDone();
  }
}

// ============================================================================
// Google Cloud Storage Provider
// ============================================================================

export class GCSStorageProvider implements ICloudStorageProvider {
  readonly providerType: StorageProviderType = 'gcs';
  private storage: GCSStorage | null = null;
  private config: CloudStorageConfig;
  private initialized = false;

  constructor(config: CloudStorageConfig) {
    this.config = config;
  }

  private getStorage(): GCSStorage {
    if (this.storage) return this.storage;

    const options: any = {};
    if (this.config.gcpProjectId) {
      options.projectId = this.config.gcpProjectId;
    }
    if (this.config.gcpKeyFile) {
      options.keyFilename = this.config.gcpKeyFile;
    }

    this.storage = new GCSStorage(options);
    return this.storage;
  }

  private getBucket() {
    return this.getStorage().bucket(this.config.bucket);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.ensureBucket();
    this.initialized = true;
    console.log(`[GCS] Storage initialized with bucket: ${this.config.bucket}`);
  }

  async ensureBucket(): Promise<void> {
    const bucket = this.getBucket();
    const [exists] = await bucket.exists();
    if (!exists) {
      await bucket.create();
      console.log(`[GCS] Created bucket: ${this.config.bucket}`);
    }
  }

  async uploadFile(key: string, content: Buffer | string, contentType?: string): Promise<void> {
    const bucket = this.getBucket();
    const file = bucket.file(key);
    const buffer = typeof content === 'string' ? Buffer.from(content) : content;
    await file.save(buffer, {
      contentType: contentType || 'application/octet-stream',
    });
  }

  async downloadFile(key: string): Promise<Buffer> {
    const bucket = this.getBucket();
    const file = bucket.file(key);
    const [content] = await file.download();
    return content;
  }

  async deleteFile(key: string): Promise<void> {
    const bucket = this.getBucket();
    const file = bucket.file(key);
    await file.delete({ ignoreNotFound: true });
  }

  async fileExists(key: string): Promise<boolean> {
    const bucket = this.getBucket();
    const file = bucket.file(key);
    const [exists] = await file.exists();
    return exists;
  }

  async getFileMetadata(key: string): Promise<StorageObject | null> {
    const bucket = this.getBucket();
    const file = bucket.file(key);

    try {
      const [metadata] = await file.getMetadata();
      return {
        key,
        size: parseInt(metadata.size as string) || 0,
        lastModified: new Date(metadata.updated as string),
        etag: metadata.etag,
      };
    } catch {
      return null;
    }
  }

  async listFiles(prefix: string, delimiter?: string): Promise<ListResult> {
    const bucket = this.getBucket();
    const options: any = { prefix };
    if (delimiter) {
      options.delimiter = delimiter;
    }

    const [files, , apiResponse] = await bucket.getFiles(options);

    const objects: StorageObject[] = files.map(file => ({
      key: file.name,
      size: parseInt(file.metadata.size as string) || 0,
      lastModified: new Date(file.metadata.updated as string),
      etag: file.metadata.etag,
    }));

    const prefixes = (apiResponse as any)?.prefixes || [];

    return { objects, prefixes, isTruncated: false };
  }

  async deleteDirectory(prefix: string): Promise<number> {
    const bucket = this.getBucket();
    const [files] = await bucket.getFiles({ prefix });

    let deleted = 0;
    for (const file of files) {
      await file.delete({ ignoreNotFound: true });
      deleted++;
    }

    return deleted;
  }

  async uploadDirectory(localPath: string, remotePrefix: string): Promise<number> {
    const fs = await import('fs/promises');
    const path = await import('path');
    let uploaded = 0;

    const uploadRecursive = async (dir: string, prefix: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const localFilePath = path.join(dir, entry.name);
        const remoteKey = `${prefix}${entry.name}`;

        if (entry.isDirectory()) {
          await uploadRecursive(localFilePath, `${remoteKey}/`);
        } else if (entry.isFile()) {
          const content = await fs.readFile(localFilePath);
          await this.uploadFile(remoteKey, content);
          uploaded++;
        }
      }
    };

    await uploadRecursive(localPath, remotePrefix.endsWith('/') ? remotePrefix : `${remotePrefix}/`);
    return uploaded;
  }

  async downloadDirectory(remotePrefix: string, localPath: string): Promise<number> {
    const fs = await import('fs/promises');
    const path = await import('path');
    let downloaded = 0;

    const listResult = await this.listFiles(remotePrefix);

    for (const obj of listResult.objects) {
      const relativePath = obj.key.substring(remotePrefix.length);
      if (!relativePath) continue;

      const localFilePath = path.join(localPath, relativePath);
      const localDir = path.dirname(localFilePath);

      await fs.mkdir(localDir, { recursive: true });
      const content = await this.downloadFile(obj.key);
      await fs.writeFile(localFilePath, content);
      downloaded++;
    }

    return downloaded;
  }

  async copyFile(sourceKey: string, destKey: string): Promise<void> {
    const bucket = this.getBucket();
    const sourceFile = bucket.file(sourceKey);
    await sourceFile.copy(bucket.file(destKey));
  }
}

// ============================================================================
// Factory & Singleton
// ============================================================================

let storageProviderInstance: ICloudStorageProvider | null = null;

/**
 * Create a storage provider based on configuration
 */
export function createStorageProvider(config?: CloudStorageConfig): ICloudStorageProvider {
  const cfg = config || getStorageConfig();

  switch (cfg.provider) {
    case 'minio':
    case 's3':
      return new S3StorageProvider(cfg);
    case 'azure':
      return new AzureBlobStorageProvider(cfg);
    case 'gcs':
      return new GCSStorageProvider(cfg);
    default:
      throw new Error(`Unsupported storage provider: ${cfg.provider}`);
  }
}

/**
 * Get the singleton storage provider instance
 */
export function getStorageProvider(): ICloudStorageProvider {
  if (!storageProviderInstance) {
    storageProviderInstance = createStorageProvider();
  }
  return storageProviderInstance;
}

/**
 * Initialize the storage provider
 */
export async function initializeCloudStorage(): Promise<ICloudStorageProvider> {
  const provider = getStorageProvider();
  await provider.initialize();
  return provider;
}

/**
 * Reset the storage provider (for testing)
 */
export function resetStorageProvider(): void {
  storageProviderInstance = null;
}
