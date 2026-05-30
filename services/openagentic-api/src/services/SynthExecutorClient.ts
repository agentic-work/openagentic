/**
 * Synth Executor Client
 *
 * Client for calling the Synth Executor service to run synthesized Python code.
 * Handles communication, retries, and result parsing.
 *
 * Auth (S2, commit aae7bb83): every /execute call carries a short-lived
 * HS256 service-JWT in `Authorization: Bearer <jwt>`. The JWT is minted per
 * call by `SynthExecuteJwt.mintSynthExecutorJwt({ userId, sessionId })`.
 * SERVICE_JWT_KEY env required — client refuses to call without it.
 */

import type { Logger } from 'pino';
import { mintSynthExecutorJwt } from './SynthExecuteJwt.js';

// =============================================================================
// Types
// =============================================================================

export interface SynthExecutionRequest {
  executionId: string;
  code: string;
  intent: string;
  userId: string;
  /**
   * Chat/codemode session id — embedded as `sid` claim in the service-JWT
   * so synth-executor can correlate audit rows + emit lifecycle frames back
   * to the right SSE stream.
   */
  sessionId: string;
  userEmail?: string;
  timeoutSeconds?: number;
  maxMemoryMb?: number;
  credentials?: Record<string, string>;
  capabilities?: string[];
  callbackUrl?: string;
  /** Input files (base64-encoded) to decode in sandbox before execution */
  files?: Array<{ name: string; type: string; data: string }>;
}

export interface SynthExecutionResponse {
  executionId: string;
  success: boolean;
  stdout?: string;
  stderr?: string;
  result?: any;
  error?: string;
  executionTimeMs: number;
  memoryUsedBytes?: number;
  codeHash: string;
  startedAt: string;
  completedAt: string;
}

export interface SynthExecutorHealth {
  status: string;
  version: string;
  activeExecutions: number;
  maxConcurrent: number;
  uptimeSeconds: number;
}

// =============================================================================
// Client Implementation
// =============================================================================

export class SynthExecutorClient {
  private baseUrl: string;
  private logger: Logger;
  private timeout: number;

  constructor(options: {
    baseUrl?: string;
    logger: Logger;
    timeoutMs?: number;
  }) {
    // Default to K8s service URL (set via Helm template)
    // In K8s: http://openagentic-synth-executor:8090
    this.baseUrl = options.baseUrl || process.env.SYNTH_EXECUTOR_URL || 'http://openagentic-synth-executor:8090';
    this.logger = options.logger.child({ service: 'synth-executor-client' });
    this.timeout = options.timeoutMs || 60000; // 60s default
  }

  /**
   * Execute synthesized Python code
   */
  async execute(request: SynthExecutionRequest): Promise<SynthExecutionResponse> {
    const startTime = Date.now();

    // Sev-0 #793 (2026-05-13): guard `.substring` against undefined intent.
    // Models occasionally emit `synth_execute({code, ...})` without `intent`
    // despite the JSON-schema marking it required. Pre-fix, the bare
    // `request.intent.substring(0, 100)` here threw TypeError BEFORE the
    // inner try/catch, surfacing as "Cannot read properties of undefined
    // (reading 'substring')" and bringing down the chat loop. Narrow at
    // the call site with `String(x ?? '')` rather than widening the type.
    this.logger.info({
      executionId: request.executionId,
      userId: request.userId,
      intent: String(request.intent ?? '').substring(0, 100),
      capabilities: request.capabilities,
    }, '[SynthExecutorClient] Sending execution request');

    try {
      // Mint per-call service-JWT (5-min TTL, HS256, sub=userId, sid=sessionId).
      // Throws if SERVICE_JWT_KEY missing — caught by the outer try and surfaced
      // as a structured error response, NOT a silent unauthenticated POST.
      const serviceJwt = mintSynthExecutorJwt({
        userId: request.userId,
        sessionId: request.sessionId,
      });

      const response = await fetch(`${this.baseUrl}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceJwt}`,
        },
        body: JSON.stringify({
          execution_id: request.executionId,
          code: request.code,
          intent: request.intent,
          user_id: request.userId,
          user_email: request.userEmail,
          timeout_seconds: request.timeoutSeconds || 30,
          max_memory_mb: request.maxMemoryMb || 256,
          credentials: request.credentials,
          capabilities: request.capabilities || ['http', 'json', 'datetime'],
          callback_url: request.callbackUrl,
          // Pass input files (base64) for sandbox decoding
          ...(request.files && request.files.length > 0 ? { files: request.files } : {}),
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Executor returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      this.logger.info({
        executionId: request.executionId,
        success: result.success,
        executionTimeMs: result.execution_time_ms,
        clientLatencyMs: Date.now() - startTime,
      }, '[SynthExecutorClient] Execution completed');

      return {
        executionId: result.execution_id,
        success: result.success,
        stdout: result.stdout,
        stderr: result.stderr,
        result: result.result,
        error: result.error,
        executionTimeMs: result.execution_time_ms,
        memoryUsedBytes: result.memory_used_bytes,
        codeHash: result.code_hash,
        startedAt: result.started_at,
        completedAt: result.completed_at,
      };

    } catch (error: any) {
      this.logger.error({
        executionId: request.executionId,
        error: error.message,
        latencyMs: Date.now() - startTime,
      }, '[SynthExecutorClient] Execution failed');

      // Return error response
      return {
        executionId: request.executionId,
        success: false,
        error: error.message,
        executionTimeMs: Date.now() - startTime,
        codeHash: '',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Check executor health
   */
  async healthCheck(): Promise<SynthExecutorHealth | null> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const health = await response.json();

      return {
        status: health.status,
        version: health.version,
        activeExecutions: health.active_executions,
        maxConcurrent: health.max_concurrent,
        uptimeSeconds: health.uptime_seconds,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if executor is ready to accept requests
   */
  async isReady(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/ready`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let clientInstance: SynthExecutorClient | null = null;

export function getSynthExecutorClient(logger: Logger): SynthExecutorClient {
  if (!clientInstance) {
    clientInstance = new SynthExecutorClient({ logger });
  }
  return clientInstance;
}
