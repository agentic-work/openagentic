/**
 * Cloud Storage Provider — STUB.
 *
 * The manager no longer handles workspace storage. Workspace persistence lives
 * inside openagentic-exec pods (s3fs FUSE mount against MinIO/S3). The manager's
 * job is auth, provision, and lifecycle of those pods — nothing else.
 *
 * This file keeps the exported types + interface so legacy callers still type-
 * check, but all provider implementations throw at runtime. Cloud SDK imports
 * are gone.
 */

export type StorageProviderType = 'minio' | 's3' | 'azure' | 'gcs';

export interface CloudStorageConfig {
  provider: StorageProviderType;
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  azureAccountName?: string;
  azureAccountKey?: string;
  azureConnectionString?: string;
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
  prefixes: string[];
  isTruncated: boolean;
  continuationToken?: string;
}

export interface ICloudStorageProvider {
  readonly providerType: StorageProviderType;
  initialize(): Promise<void>;
  ensureBucket(): Promise<void>;
  uploadFile(key: string, content: Buffer | string, contentType?: string): Promise<void>;
  downloadFile(key: string): Promise<Buffer>;
  deleteFile(key: string): Promise<void>;
  fileExists(key: string): Promise<boolean>;
  getFileMetadata(key: string): Promise<StorageObject | null>;
  listFiles(prefix: string, delimiter?: string): Promise<ListResult>;
  deleteDirectory(prefix: string): Promise<number>;
  uploadDirectory(localPath: string, remotePrefix: string): Promise<number>;
  downloadDirectory(remotePrefix: string, localPath: string): Promise<number>;
  getSignedUrl?(key: string, expiresInSeconds: number): Promise<string>;
  copyFile?(sourceKey: string, destKey: string): Promise<void>;
}

export function getStorageConfig(): CloudStorageConfig {
  return {
    provider: 'minio',
    bucket: '',
  };
}

const err = () => new Error(
  'code-manager no longer provides cloud storage. Storage is mounted inside ' +
  'openagentic-exec pods via s3fs. Remove the call site.'
);

class NullStorageProvider implements ICloudStorageProvider {
  readonly providerType: StorageProviderType = 'minio';
  async initialize(): Promise<void> {}
  async ensureBucket(): Promise<void> {}
  async uploadFile(): Promise<void> { throw err(); }
  async downloadFile(): Promise<Buffer> { throw err(); }
  async deleteFile(): Promise<void> { throw err(); }
  async fileExists(): Promise<boolean> { return false; }
  async getFileMetadata(): Promise<StorageObject | null> { return null; }
  async listFiles(): Promise<ListResult> { return { objects: [], prefixes: [], isTruncated: false }; }
  async deleteDirectory(): Promise<number> { return 0; }
  async uploadDirectory(): Promise<number> { return 0; }
  async downloadDirectory(): Promise<number> { return 0; }
}

export class S3StorageProvider extends NullStorageProvider {}
export class AzureBlobStorageProvider extends NullStorageProvider {}
export class GCSStorageProvider extends NullStorageProvider {}

let storageProviderInstance: ICloudStorageProvider | null = null;

export function createStorageProvider(_config?: CloudStorageConfig): ICloudStorageProvider {
  if (!storageProviderInstance) storageProviderInstance = new NullStorageProvider();
  return storageProviderInstance;
}

export function getStorageProvider(): ICloudStorageProvider {
  if (!storageProviderInstance) storageProviderInstance = new NullStorageProvider();
  return storageProviderInstance;
}

export async function initializeCloudStorage(): Promise<ICloudStorageProvider> {
  storageProviderInstance = new NullStorageProvider();
  return storageProviderInstance;
}
