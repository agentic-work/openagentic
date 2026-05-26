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
