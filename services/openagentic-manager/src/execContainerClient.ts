/**
 * Exec Container Client
 *
 * Client for communicating with the openagentic-exec container.
 * Used when executionMode === 'exec-container'.
 *
 * This allows the manager to be stateless - all execution happens in the
 * dedicated exec container, while the manager handles routing and storage.
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { config, ExecContainerConfig } from './config';
import { loggers } from './logger.js';

export interface ExecSession {
  sessionId: string;
  userId: string;
  status: string;
  workspacePath: string;
  pid: number;
  createdAt: number;
  lastActivity?: number;
}

// Readiness check result from exec daemon
export interface ReadinessResult {
  ready: boolean;
  cliResponsive: boolean;
  startupPhase: string;
  message: string;
  sessionId?: string;
  timestamp?: number;
  details?: {
    pid: number;
    uptime: number;
    lastActivity: number;
    status?: string;
    outputSample?: string;
  };
}

// Startup event from SSE stream
export interface StartupEvent {
  type: string;
  message: string;
  timestamp: number;
  sessionId: string;
  details?: Record<string, any>;
}

export interface CreateSessionOptions {
  sessionId: string;
  userId: string;
  userEmail?: string;  // User's email for Linux username (e.g., john.doe@company.com -> john-doe)
  workspacePath?: string;
  model?: string;
  apiKey?: string;
  apiEndpoint?: string;  // API endpoint for platform LLM access
}

export class ExecContainerClient extends EventEmitter {
  private baseUrl: string;
  private internalKey: string;
  private wsConnections: Map<string, WebSocket> = new Map();

  constructor(execConfig?: ExecContainerConfig) {
    super();
    const cfg = execConfig || config.execContainer;
    this.baseUrl = cfg.url;
    this.internalKey = cfg.internalKey || config.internalApiKey;
  }

  /**
   * Make an authenticated HTTP request to the exec container
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.internalKey) {
      headers['X-Internal-Api-Key'] = this.internalKey;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Exec container request failed: ${response.status} ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Check if the exec container is healthy
   */
  async checkHealth(): Promise<{
    status: string;
    activeSessions: number;
  }> {
    return this.request('GET', '/health');
  }

  /**
   * Create a session in the exec container
   */
  async createSession(options: CreateSessionOptions): Promise<ExecSession> {
    return this.request('POST', '/sessions', {
      sessionId: options.sessionId,
      userId: options.userId,
      userEmail: options.userEmail,  // For Linux username
      workspacePath: options.workspacePath,
      model: options.model,
      apiKey: options.apiKey,
      apiEndpoint: options.apiEndpoint,
    });
  }

  /**
   * Get session status
   */
  async getSession(sessionId: string): Promise<ExecSession | null> {
    try {
      return await this.request('GET', `/sessions/${sessionId}`);
    } catch (error) {
      // Session not found
      return null;
    }
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<{ sessions: ExecSession[] }> {
    return this.request('GET', '/sessions');
  }

  /**
   * Stop a session
   */
  async stopSession(sessionId: string): Promise<void> {
    await this.request('DELETE', `/sessions/${sessionId}`);
    // Close WebSocket if connected
    this.disconnectTerminal(sessionId);
  }

  /**
   * Refresh session token - restarts CLI with new API key
   * CRITICAL: This MUST be called on every user reconnect to ensure fresh token
   */
  async refreshSessionToken(
    sessionId: string,
    apiKey: string,
    options?: { model?: string; apiEndpoint?: string; githubToken?: string }
  ): Promise<ExecSession> {
    return this.request('POST', `/sessions/${sessionId}/refresh`, {
      apiKey,
      model: options?.model,
      apiEndpoint: options?.apiEndpoint,
      githubToken: options?.githubToken,
    });
  }

  /**
   * Write data to a session via REST (fallback)
   */
  async writeToSession(sessionId: string, data: string): Promise<void> {
    await this.request('POST', `/sessions/${sessionId}/write`, { data });
  }

  /**
   * Resize session terminal
   */
  async resizeSession(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.request('POST', `/sessions/${sessionId}/resize`, { cols, rows });
  }

  /**
   * Upload a file to the session workspace
   * This writes the file directly to the exec container's filesystem (the pod's PVC)
   */
  async uploadFile(
    sessionId: string,
    filename: string,
    content: string, // base64 encoded
    targetPath?: string
  ): Promise<{ success: boolean; path: string; relativePath: string; size: number }> {
    return this.request('POST', `/sessions/${sessionId}/upload`, {
      filename,
      content,
      targetPath,
    });
  }

  /**
   * Connect to a session's terminal via WebSocket
   * Returns a WebSocket that forwards PTY I/O
   */
  connectTerminal(sessionId: string): WebSocket {
    // Check for existing connection
    const existing = this.wsConnections.get(sessionId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      return existing;
    }

    // Build WebSocket URL
    const wsUrl = this.baseUrl.replace(/^http/, 'ws');
    const url = `${wsUrl}/ws/terminal/${sessionId}?internalKey=${encodeURIComponent(this.internalKey)}`;

    const ws = new WebSocket(url);

    // Handle connection events
    ws.on('open', () => {
      loggers.websocket.info({ sessionId }, 'Terminal WebSocket connected');
      this.emit('terminal:connected', sessionId);
    });

    ws.on('message', (data: Buffer | string) => {
      // Forward PTY output
      this.emit('terminal:data', sessionId, data.toString());
    });

    ws.on('close', (code, reason) => {
      loggers.websocket.info({ sessionId, code, reason: reason.toString() }, 'Terminal WebSocket closed');
      this.wsConnections.delete(sessionId);
      this.emit('terminal:closed', sessionId, code, reason.toString());
    });

    ws.on('error', (error) => {
      loggers.websocket.error({ sessionId, err: error }, 'Terminal WebSocket error');
      this.emit('terminal:error', sessionId, error);
    });

    this.wsConnections.set(sessionId, ws);
    return ws;
  }

  /**
   * Write to terminal via WebSocket
   */
  writeTerminal(sessionId: string, data: string): void {
    const ws = this.wsConnections.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else {
      // Fall back to REST
      this.writeToSession(sessionId, data).catch(err => loggers.websocket.error({ sessionId, err }, 'Failed to write to session via REST fallback'));
    }
  }

  /**
   * Resize terminal via WebSocket
   */
  resizeTerminal(sessionId: string, cols: number, rows: number): void {
    const ws = this.wsConnections.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    } else {
      this.resizeSession(sessionId, cols, rows).catch(err => loggers.websocket.error({ sessionId, err }, 'Failed to resize session via REST fallback'));
    }
  }

  /**
   * Disconnect terminal WebSocket
   */
  disconnectTerminal(sessionId: string): void {
    const ws = this.wsConnections.get(sessionId);
    if (ws) {
      ws.close();
      this.wsConnections.delete(sessionId);
    }
  }

  /**
   * Check if CLI is ready (readiness probe)
   * @param sessionId - The session ID to check
   * @param timeout - Timeout in milliseconds (default: 10000)
   */
  async checkReadiness(sessionId: string, timeout: number = 10000): Promise<ReadinessResult> {
    return this.request('POST', `/sessions/${sessionId}/readiness-check`, { timeout });
  }

  /**
   * Get quick readiness status (non-blocking)
   * @param sessionId - The session ID to check
   */
  async getReadinessStatus(sessionId: string): Promise<ReadinessResult> {
    return this.request('GET', `/sessions/${sessionId}/readiness`);
  }

  /**
   * Wait for CLI to be ready with polling
   * @param sessionId - The session ID to wait for
   * @param maxWaitMs - Maximum time to wait (default: 60000ms)
   * @param pollIntervalMs - Polling interval (default: 2000ms)
   * @param onProgress - Callback for progress updates
   */
  async waitForReady(
    sessionId: string,
    maxWaitMs: number = 60000,
    pollIntervalMs: number = 2000,
    onProgress?: (result: ReadinessResult) => void
  ): Promise<ReadinessResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const result = await this.getReadinessStatus(sessionId);
        if (onProgress) {
          onProgress(result);
        }

        if (result.ready) {
          return result;
        }

        // If we have errors, don't wait too long
        if (result.startupPhase === 'cli_error') {
          // Give it a few more tries after error
          const elapsed = Date.now() - startTime;
          if (elapsed > 10000) {
            return result; // Return error after 10s of errors
          }
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        loggers.k8s.warn({ sessionId, err: error }, 'Readiness check failed');
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    }

    // Timeout - return last status
    try {
      return await this.getReadinessStatus(sessionId);
    } catch {
      return {
        ready: false,
        cliResponsive: false,
        startupPhase: 'cli_error',
        message: 'Readiness check timed out',
        sessionId,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Subscribe to startup logs via SSE
   * Returns an abort function to stop the subscription
   * @param sessionId - The session ID to subscribe to
   * @param onEvent - Callback for each startup event
   * @param onError - Callback for errors
   */
  subscribeToStartupLogs(
    sessionId: string,
    onEvent: (event: StartupEvent) => void,
    onError?: (error: Error) => void
  ): () => void {
    const url = `${this.baseUrl}/sessions/${sessionId}/startup-logs`;
    const abortController = new AbortController();

    const fetchLogs = async () => {
      try {
        const headers: Record<string, string> = {};
        if (this.internalKey) {
          headers['X-Internal-Api-Key'] = this.internalKey;
        }

        const response = await fetch(url, {
          headers,
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to subscribe to startup logs: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body not readable');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const eventData = JSON.parse(line.slice(6));
                onEvent(eventData);

                // If stream is complete, we can stop
                if (eventData.type === 'stream_complete') {
                  reader.cancel();
                  return;
                }
              } catch (e) {
                // Ignore parse errors for comments/heartbeats
              }
            }
          }
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          loggers.k8s.error({ err: error }, 'Startup logs subscription error');
          if (onError) {
            onError(error);
          }
        }
      }
    };

    fetchLogs();

    // Return abort function
    return () => {
      abortController.abort();
    };
  }

  /**
   * Disconnect all WebSocket connections
   */
  disconnectAll(): void {
    for (const [sessionId, ws] of this.wsConnections) {
      ws.close();
    }
    this.wsConnections.clear();
  }

  /**
   * Get the internal WebSocket for a session (for proxy forwarding)
   */
  getTerminalWebSocket(sessionId: string): WebSocket | undefined {
    return this.wsConnections.get(sessionId);
  }
}

// Singleton instance
let execClientInstance: ExecContainerClient | null = null;

export function getExecContainerClient(): ExecContainerClient {
  if (!execClientInstance) {
    execClientInstance = new ExecContainerClient();
  }
  return execClientInstance;
}
