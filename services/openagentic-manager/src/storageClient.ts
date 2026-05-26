/**
 * Storage Client — STUB.
 *
 * The manager no longer persists session metadata, messages, terminal output,
 * or workspace files. Persistence now happens inside openagentic-exec pods
 * (s3fs FUSE mount against MinIO/S3). The manager is auth + provision +
 * lifecycle of those pods, nothing else.
 *
 * This file keeps the export surface so existing callers compile. All writes
 * are no-ops; all reads return empty/null. Cloud SDK imports are gone.
 */

import type { UserSession } from './types';

export interface StorageConfig {
  provider: 'minio' | 's3' | 'azure' | 'gcs' | 'local';
  endpoint?: string;
  bucket: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  azureConnectionString?: string;
  azureContainerName?: string;
}

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

export async function initializeStorage(): Promise<void> {
  // no-op: manager does not own storage
}

export async function saveSession(_session: UserSession): Promise<void> {
  // no-op
}

export async function updateSessionStatus(
  _userId: string,
  _sessionId: string,
  _status: 'running' | 'stopped' | 'error',
  _lastActivity?: Date
): Promise<void> {
  // no-op
}

export async function saveMessage(
  _userId: string,
  _sessionId: string,
  _message: Omit<MessageRecord, 'id' | 'sessionId' | 'timestamp'>
): Promise<void> {
  // no-op
}

export async function saveTerminalOutput(
  _userId: string,
  _sessionId: string,
  _output: string
): Promise<void> {
  // no-op
}

export async function listUserSessions(_userId: string): Promise<SessionMetadata[]> {
  return [];
}

export async function deleteSession(_userId: string, _sessionId: string): Promise<void> {
  // no-op
}

export async function getSession(
  _userId: string,
  _sessionId: string
): Promise<SessionMetadata | null> {
  return null;
}

export async function saveWorkspaceFile(
  _userId: string,
  _sessionId: string,
  _filePath: string,
  _content: string | Buffer
): Promise<void> {
  // no-op
}

export async function getWorkspaceFile(
  _userId: string,
  _sessionId: string,
  _filePath: string
): Promise<string | null> {
  return null;
}
