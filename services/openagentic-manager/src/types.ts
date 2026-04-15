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
 * TypeScript type definitions for OpenAgenticCode Manager
 */

export interface UserSession {
  id: string;
  userId: string;
  pid: number;                    // Process ID
  workspacePath: string;
  model: string;
  createdAt: Date;
  lastActivity: Date;
  status: 'starting' | 'running' | 'stopped' | 'error';
}

export interface SessionStatus {
  id: string;
  status: string;
  running: boolean;
  userId?: string;
  model?: string;
  workspacePath?: string;
  createdAt?: Date;
  lastActivity?: Date;
  /** Kubernetes pod name for this session */
  podName?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface CreateSessionRequest {
  userId: string;
  userEmail?: string;  // User's email for Linux username (e.g., john.doe@company.com -> john-doe)
  workspacePath?: string;
  model?: string;
  storageLimitMb?: number;  // Per-user storage limit from admin settings
  githubToken?: string;  // Per-user GitHub token from Device Flow OAuth
}

export interface SendMessageRequest {
  message: string;
}
