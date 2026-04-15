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
 * Storage Client for OpenAgentic Manager
 *
 * Handles per-user session data persistence to blob storage.
 * Supports:
 * - MinIO (local/compose)
 * - AWS S3
 * - Azure Blob Storage
 * - GCS
 *
 * Each user gets their own folder: /{bucket}/openagentic/{userId}/sessions/{sessionId}/
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  HeadBucketCommand
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import type { UserSession } from './types';

// Storage configuration from environment
export interface StorageConfig {
  provider: 'minio' | 's3' | 'azure' | 'gcs' | 'local';
  endpoint?: string;
  bucket: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  // Azure-specific
  azureConnectionString?: string;
  azureContainerName?: string;
}

function getStorageConfig(): StorageConfig {
  const provider = (process.env.STORAGE_PROVIDER || 'minio') as StorageConfig['provider'];

  // Get endpoint and ensure it has http:// prefix
  let endpoint = process.env.STORAGE_ENDPOINT || process.env.MINIO_ENDPOINT || 'minio:9000';
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    endpoint = `http://${endpoint}`;
  }

  return {
    provider,
    endpoint,
    bucket: process.env.STORAGE_BUCKET || process.env.MINIO_BUCKET || 'openagentic',
    region: process.env.STORAGE_REGION || process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.STORAGE_ACCESS_KEY || process.env.MINIO_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
    secretAccessKey: process.env.STORAGE_SECRET_KEY || process.env.MINIO_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
    azureConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    azureContainerName: process.env.AZURE_STORAGE_CONTAINER || 'openagentic',
  };
}

// Check if blob storage is enabled (not local mode)
function isStorageEnabled(): boolean {
  const provider = process.env.STORAGE_PROVIDER || 'minio';
  return provider !== 'local';
}

// S3-compatible client (works for MinIO, S3, and can be adapted for others)
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  const config = getStorageConfig();

  s3Client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId || '',
      secretAccessKey: config.secretAccessKey || '',
    },
    forcePathStyle: true, // Required for MinIO
  });

  return s3Client;
}

/**
 * Initialize storage - ensure bucket exists
 */
let bucketInitialized = false;

export async function initializeStorage(): Promise<void> {
  if (bucketInitialized) return;

  // Skip blob storage in local mode
  if (!isStorageEnabled()) {
    console.log('[Storage] Local mode - blob storage disabled');
    bucketInitialized = true;
    return;
  }

  const config = getStorageConfig();
  const client = getS3Client();

  try {
    // Check if bucket exists
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    console.log(`[Storage] Bucket ${config.bucket} already exists`);
    bucketInitialized = true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      // Bucket doesn't exist, create it
      try {
        await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
        console.log(`[Storage] Created bucket ${config.bucket}`);
        bucketInitialized = true;
      } catch (createError: any) {
        // Bucket might have been created by another instance
        if (createError.name === 'BucketAlreadyOwnedByYou' || createError.name === 'BucketAlreadyExists') {
          console.log(`[Storage] Bucket ${config.bucket} already exists (race condition)`);
          bucketInitialized = true;
        } else {
          console.error(`[Storage] Failed to create bucket ${config.bucket}:`, createError.message);
          throw createError;
        }
      }
    } else {
      console.error(`[Storage] Failed to check bucket ${config.bucket}:`, error.message);
      // Continue anyway - bucket might exist but we can't check
      bucketInitialized = true;
    }
  }
}

// Helper to convert stream to string
async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Session metadata stored in blob storage
 */
export interface SessionMetadata {
  id: string;
  userId: string;
  workspacePath: string;
  model: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  createdAt: string;
  lastActivity: string;
  pid?: number;
}

/**
 * Message data to persist
 */
export interface MessageRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  rawOutput?: string;
  thinking?: string;
  toolCalls?: any[];
  toolResults?: any[];
  timestamp: string;
  tokens?: number;
  model?: string;
}

/**
 * Get the storage path for a user's session
 */
function getSessionPath(userId: string, sessionId: string): string {
  return `openagentic/${userId}/sessions/${sessionId}`;
}

/**
 * Save session metadata to blob storage
 */
export async function saveSession(session: UserSession): Promise<void> {
  // Skip blob storage in local mode
  if (!isStorageEnabled()) {
    return;
  }

  const config = getStorageConfig();
  const client = getS3Client();

  const metadata: SessionMetadata = {
    id: session.id,
    userId: session.userId,
    workspacePath: session.workspacePath || '',
    model: session.model || 'unknown',
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    lastActivity: session.lastActivity.toISOString(),
    pid: session.pid,
  };

  const key = `${getSessionPath(session.userId, session.id)}/metadata.json`;

  try {
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json',
    }));
    console.log(`[Storage] Session ${session.id} saved to ${key}`);
  } catch (error: any) {
    console.error(`[Storage] Failed to save session ${session.id}:`, error.message);
    // Don't throw - session should continue even if storage fails
  }
}

/**
 * Update session status in blob storage
 */
export async function updateSessionStatus(
  userId: string,
  sessionId: string,
  status: 'running' | 'stopped' | 'error',
  lastActivity?: Date
): Promise<void> {
  // Skip blob storage in local mode
  if (!isStorageEnabled()) {
    return;
  }

  const config = getStorageConfig();
  const client = getS3Client();

  const key = `${getSessionPath(userId, sessionId)}/metadata.json`;

  try {
    // Get existing metadata
    const getResult = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));

    const existingData = await streamToString(getResult.Body as Readable);
    const metadata: SessionMetadata = JSON.parse(existingData);

    // Update status
    metadata.status = status;
    if (lastActivity) {
      metadata.lastActivity = lastActivity.toISOString();
    }

    // Save updated metadata
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json',
    }));

    console.log(`[Storage] Session ${sessionId} status updated to ${status}`);
  } catch (error: any) {
    console.error(`[Storage] Failed to update session ${sessionId}:`, error.message);
  }
}

/**
 * Save a message to the session's message log
 */
export async function saveMessage(
  userId: string,
  sessionId: string,
  message: Omit<MessageRecord, 'id' | 'sessionId' | 'timestamp'>
): Promise<void> {
  // Skip blob storage in local mode
  if (!isStorageEnabled()) {
    return;
  }

  const config = getStorageConfig();
  const client = getS3Client();

  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const record: MessageRecord = {
    id: messageId,
    sessionId,
    timestamp: new Date().toISOString(),
    ...message,
  };

  const key = `${getSessionPath(userId, sessionId)}/messages/${messageId}.json`;

  try {
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: JSON.stringify(record, null, 2),
      ContentType: 'application/json',
    }));
    console.log(`[Storage] Message ${messageId} saved for session ${sessionId}`);
  } catch (error: any) {
    console.error(`[Storage] Failed to save message:`, error.message);
  }
}

/**
 * Save raw terminal output (for debugging/audit)
 */
export async function saveTerminalOutput(
  userId: string,
  sessionId: string,
  output: string
): Promise<void> {
  // Skip blob storage in local mode
  if (!isStorageEnabled()) {
    return;
  }

  const config = getStorageConfig();
  const client = getS3Client();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `${getSessionPath(userId, sessionId)}/output/${timestamp}.txt`;

  try {
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: output,
      ContentType: 'text/plain',
    }));
  } catch (error: any) {
    // Silent fail for output logs - too verbose
  }
}

/**
 * List all sessions for a user
 */
export async function listUserSessions(userId: string): Promise<SessionMetadata[]> {
  // Skip blob storage in local mode
  if (!isStorageEnabled()) {
    return [];
  }

  const config = getStorageConfig();
  const client = getS3Client();

  const prefix = `openagentic/${userId}/sessions/`;
  const sessions: SessionMetadata[] = [];

  try {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
      Delimiter: '/',
    }));

    // Each common prefix is a session folder
    for (const common of result.CommonPrefixes || []) {
      if (!common.Prefix) continue;

      // Extract session ID from path
      const parts = common.Prefix.split('/');
      const sessionId = parts[parts.length - 2]; // sessions/{sessionId}/

      try {
        const metadataKey = `${common.Prefix}metadata.json`;
        const getResult = await client.send(new GetObjectCommand({
          Bucket: config.bucket,
          Key: metadataKey,
        }));

        const data = await streamToString(getResult.Body as Readable);
        sessions.push(JSON.parse(data));
      } catch {
        // Session without metadata, skip
      }
    }

    return sessions;
  } catch (error: any) {
    console.error(`[Storage] Failed to list sessions for user ${userId}:`, error.message);
    return [];
  }
}

/**
 * Delete a session and all its data
 */
export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  const config = getStorageConfig();
  const client = getS3Client();

  const prefix = `${getSessionPath(userId, sessionId)}/`;

  try {
    // List all objects in the session folder
    const listResult = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
    }));

    // Delete each object
    for (const obj of listResult.Contents || []) {
      if (obj.Key) {
        await client.send(new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: obj.Key,
        }));
      }
    }

    console.log(`[Storage] Session ${sessionId} deleted`);
  } catch (error: any) {
    console.error(`[Storage] Failed to delete session ${sessionId}:`, error.message);
  }
}

/**
 * Get session metadata from storage
 */
export async function getSession(userId: string, sessionId: string): Promise<SessionMetadata | null> {
  const config = getStorageConfig();
  const client = getS3Client();

  const key = `${getSessionPath(userId, sessionId)}/metadata.json`;

  try {
    const result = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));

    const data = await streamToString(result.Body as Readable);
    return JSON.parse(data);
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      return null;
    }
    console.error(`[Storage] Failed to get session ${sessionId}:`, error.message);
    return null;
  }
}

/**
 * Save workspace file to blob storage
 * This allows file persistence beyond the container lifecycle
 */
export async function saveWorkspaceFile(
  userId: string,
  sessionId: string,
  filePath: string,
  content: string | Buffer
): Promise<void> {
  const config = getStorageConfig();
  const client = getS3Client();

  const key = `${getSessionPath(userId, sessionId)}/workspace/${filePath}`;

  try {
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: content,
    }));
    console.log(`[Storage] Workspace file saved: ${filePath}`);
  } catch (error: any) {
    console.error(`[Storage] Failed to save workspace file ${filePath}:`, error.message);
  }
}

/**
 * Get workspace file from blob storage
 */
export async function getWorkspaceFile(
  userId: string,
  sessionId: string,
  filePath: string
): Promise<string | null> {
  const config = getStorageConfig();
  const client = getS3Client();

  const key = `${getSessionPath(userId, sessionId)}/workspace/${filePath}`;

  try {
    const result = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));

    return await streamToString(result.Body as Readable);
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      return null;
    }
    console.error(`[Storage] Failed to get workspace file ${filePath}:`, error.message);
    return null;
  }
}
