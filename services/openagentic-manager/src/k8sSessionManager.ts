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
 * Kubernetes Session Manager
 *
 * Manages openagentic by spawning PERMANENT per-user Kubernetes pods.
 * Used when executionMode === 'kubernetes'.
 *
 * ARCHITECTURE:
 *   - Each USER gets ONE permanent pod (not per-session)
 *   - Pods are NEVER cleaned up automatically
 *   - Pod naming: openagentic-{userIdHash} for persistence
 *   - PVC storage per user for persistent workspace storage (no S3FS/MinIO)
 *   - Service created per pod for WebSocket/HTTP access
 *
 * STORAGE:
 *   - Each user gets a dedicated PersistentVolumeClaim (PVC)
 *   - PVC naming: openagentic-workspace-{userIdHash}
 *   - No privileged mode required (unlike S3FS FUSE mounts)
 *   - Works with any storage class (local-path, NFS, cloud disks)
 *
 * PERMANENT POD APPROACH:
 *   - No idle timeouts - pod stays running forever
 *   - No max session age - pod persists indefinitely
 *   - User reconnects to same pod every time
 *   - Only admin can manually delete pods if needed
 *
 * SECURITY:
 *   - Pods run as sandboxed Linux users
 *   - Each pod is isolated from others
 *   - Uses dedicated ServiceAccount with minimal RBAC
 *   - No privileged mode (was required for S3FS, not for PVC)
 */

import * as k8s from '@kubernetes/client-node';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { config, K8sConfig } from './config';
import { WebSocket } from 'ws';
import { SessionStore, createSessionStore } from './sessionStore';
import { ExecContainerClient } from './execContainerClient';
import { loggers } from './logger.js';

/**
 * Generate a consistent, K8s-safe pod name from user ID
 * Format: openagentic-{userIdHash} (max 63 chars)
 * Same user always gets same pod name
 */
function getUserPodName(userId: string): string {
  // Create a short hash of the userId for uniqueness
  const hash = createHash('sha256').update(userId).digest('hex').substring(0, 12);
  return `openagentic-${hash}`;
}

export interface K8sSession {
  sessionId: string;
  userId: string;
  podName: string;
  serviceName: string;
  status: 'pending' | 'running' | 'terminated' | 'failed';
  podIP?: string;
  serviceIP?: string;
  servicePort: number;
  createdAt: number;
  lastActivity: number;
  workspacePath: string;
  /** Number of times we've verified this session is healthy */
  healthChecksPassed: number;
  /** Last successful health check timestamp */
  lastHealthCheck?: number;
  /** Consecutive health check failures (reset on success) */
  consecutiveHealthFailures: number;
  /**
   * SHA-256 hash (first 16 hex chars) of the JWT that was last used
   * to refresh the exec daemon's CLI session. Stored so we can
   * cheaply compare an incoming reconnect's token and SKIP the CLI
   * restart when the token is unchanged. Without this, every browser
   * reconnect (tab focus, network flap, page reload) would SIGKILL
   * the CLI and respawn it — roughly 5 seconds of downtime per
   * reconnect, which the user experienced as "terminal keeps
   * disconnecting" on 2026-04-08. Only the hash is stored; the raw
   * JWT never lands in the session record or any log.
   */
  lastApiKeyHash?: string;
}

/**
 * Cheap fingerprint of an API key / JWT for the "did this token
 * actually change" check in getOrCreateSession. Uses sha256 and
 * truncates to 16 hex chars (64 bits of entropy) — enough to detect
 * any real change without leaking the token to anything that might
 * see the session record.
 */
function hashApiKey(apiKey: string): string {
  // Lazy require because this file is already past 2000 lines and a
  // static import of 'crypto' would move the whole import block.
  // Lazy load keeps the edit contained to this helper.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

export interface CreateK8sSessionOptions {
  sessionId: string;
  userId: string;
  userEmail?: string;  // User's email for Linux username (e.g., john.doe@company.com -> john-doe)
  workspacePath?: string;
  model?: string;
  apiKey?: string;
  apiEndpoint?: string;
  cliBackend?: 'openagentic-cli';  // Always openagentic-cli (routes through SDK/API)
  githubToken?: string;  // Per-user GitHub token from Device Flow OAuth
}

export interface CodeServerInfo {
  status: string;
  url: string | null;
  port?: number;
  workspacePath?: string;
  startedAt?: number;
}

export class K8sSessionManager extends EventEmitter {
  private kubeConfig: k8s.KubeConfig;
  private coreApi: k8s.CoreV1Api;
  private namespace: string;
  private runnerImage: string;
  private k8sConfig: K8sConfig;
  private sessionStore: SessionStore;
  private wsConnections: Map<string, WebSocket> = new Map();
  private managerPodName: string;
  private managerPodUid: string;
  private cleanupInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  private isInitialized: boolean = false;

  // Circuit breaker state for pod creation
  private circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
  private circuitBreakerFailures: number = 0;
  private circuitBreakerLastFailure: number = 0;
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5; // failures before opening
  private static readonly CIRCUIT_BREAKER_TIMEOUT_MS = 30000; // 30 seconds before half-open
  private static readonly CIRCUIT_BREAKER_HALF_OPEN_ATTEMPTS = 2; // successful attempts to close

  // Health check settings (NO cleanup - pods are permanent)
  private static readonly HEALTH_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds (less aggressive)
  private static readonly MAX_CONSECUTIVE_HEALTH_FAILURES = 5; // Only mark failed after 5 consecutive failures

  constructor() {
    super();
    this.kubeConfig = new k8s.KubeConfig();

    // Load in-cluster config (uses ServiceAccount credentials)
    this.kubeConfig.loadFromCluster();

    this.coreApi = this.kubeConfig.makeApiClient(k8s.CoreV1Api);
    this.namespace = config.k8s.namespace;
    this.runnerImage = config.k8s.runnerImage;
    this.k8sConfig = config.k8s;
    this.managerPodName = process.env.POD_NAME || 'unknown';
    this.managerPodUid = process.env.POD_UID || '';

    // Initialize session store (Redis for HA, in-memory for single instance)
    this.sessionStore = createSessionStore({
      redisUrl: config.redis.url,
      keyPrefix: config.redis.keyPrefix,
      sessionTTL: config.redis.sessionTTL,
    });

    const storeType = config.redis.url ? 'Redis' : 'in-memory';
    loggers.k8s.info({ namespace: this.namespace, runnerImage: this.runnerImage, managerPod: this.managerPodName, storeType, maxSessionsPerUser: config.maxSessionsPerUser, maxGlobalSessions: config.maxGlobalSessions }, 'K8sSessionManager initialized');
  }

  /**
   * Wait for CLI to be ready and emit status events
   * This is the TRUE readiness check - not just "pod is running"
   * @param execClient - ExecContainerClient connected to the pod
   * @param sessionId - Session ID for status events
   * @param maxWaitMs - Maximum time to wait (default: 30s)
   * @returns true if CLI is ready, false otherwise
   */
  private async waitForCliReady(
    execClient: ExecContainerClient,
    sessionId: string,
    maxWaitMs: number = 30000
  ): Promise<boolean> {
    this.emit('deployment:status', {
      sessionId,
      step: 'cli',
      status: 'pending',
      message: 'Waiting for CLI to initialize...',
    });

    try {
      const result = await execClient.waitForReady(
        sessionId,
        maxWaitMs,
        2000, // poll every 2 seconds
        (progressResult) => {
          // Emit progress updates
          this.emit('deployment:status', {
            sessionId,
            step: 'cli',
            status: 'pending',
            message: progressResult.message,
            details: {
              phase: progressResult.startupPhase,
              uptime: progressResult.details?.uptime,
            },
          });
        }
      );

      if (result.ready) {
        this.emit('deployment:status', {
          sessionId,
          step: 'cli',
          status: 'complete',
          message: '✓ CLI READY - Environment initialized',
          details: {
            phase: result.startupPhase,
            pid: result.details?.pid,
            uptime: result.details?.uptime,
          },
        });
        loggers.k8s.info({ sessionId }, "CLI ready");
        return true;
      } else {
        this.emit('deployment:status', {
          sessionId,
          step: 'cli',
          status: 'error',
          message: `CLI not ready: ${result.message}`,
          details: {
            phase: result.startupPhase,
            outputSample: result.details?.outputSample,
          },
        });
        loggers.k8s.warn({ sessionId, message: result.message }, "CLI not ready");
        return false;
      }
    } catch (err: any) {
      this.emit('deployment:status', {
        sessionId,
        step: 'cli',
        status: 'error',
        message: `CLI readiness check failed: ${err?.message}`,
      });
      loggers.k8s.error({ sessionId, err }, "CLI readiness check error");
      return false;
    }
  }

  /**
   * Initialize the session manager - MUST be called after construction
   * Syncs with cluster state and starts health checks
   * NOTE: No cleanup loop - pods are permanent per user
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      loggers.k8s.info('Already initialized');
      return;
    }

    loggers.k8s.info('Starting initialization (PERMANENT POD MODE)');

    // Sync with cluster to recover any existing sessions/pods
    await this.syncWithCluster();

    // Start health check loop (monitors pods, doesn't delete them)
    this.startHealthChecks();

    // NOTE: No cleanup loop - pods are PERMANENT
    // NOTE: No warm pool - each user gets their own permanent pod

    // Auto-reconnect terminal WebSocket on unexpected close (e.g., exec daemon restart)
    this.on('terminal:closed', async (sessionId: string, code: number, reason: string) => {
      const session = await this.sessionStore.get(sessionId);
      if (!session || session.status !== 'running') return;

      loggers.k8s.info({ sessionId, code, reason }, "Terminal closed, attempting auto-reconnect");
      for (let attempt = 1; attempt <= 3; attempt++) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        const ws = await this.connectTerminal(sessionId);
        if (ws) {
          loggers.k8s.info({ sessionId, attempt }, "Terminal auto-reconnected");
          this.emit('terminal:reconnected', sessionId);
          return;
        }
      }
      loggers.k8s.warn({ sessionId }, "Terminal auto-reconnect failed after 3 attempts");
    });

    this.isInitialized = true;
    const sessionCount = (await this.sessionStore.getAll()).length;
    loggers.k8s.info({ sessionCount }, "Initialization complete - permanent user pods tracked");
  }

  /**
   * Get user's existing PERMANENT pod or create one
   * This is the PREFERRED entry point for code mode
   *
   * PERMANENT POD APPROACH:
   * - Each user has exactly ONE pod that persists forever
   * - Pod name is deterministic: openagentic-{userIdHash}
   * - First checks K8s directly for existing pod
   * - Creates pod only if none exists for user
   */
  async getOrCreateSession(options: CreateK8sSessionOptions): Promise<K8sSession> {
    const { userId, sessionId } = options;
    const expectedPodName = getUserPodName(userId);

    loggers.k8s.info({ userId, podName: expectedPodName }, "Looking for permanent pod");

    // First, check if user's permanent pod already exists in K8s
    try {
      const existingPod = await this.coreApi.readNamespacedPod(expectedPodName, this.namespace);
      const phase = existingPod.body.status?.phase;

      if (phase === 'Running') {
        loggers.k8s.info({ podName: expectedPodName }, "Found permanent pod (Running)");

        // Emit reconnect status for UI
        this.emit('deployment:status', {
          sessionId,
          step: 'pod',
          status: 'complete',
          message: 'Reconnecting to existing workspace...',
          details: { podName: expectedPodName, isReconnect: true },
        });

        // Get or create session record for this pod
        let existingSession = await this.sessionStore.getUserSession(userId)
          .then(sid => sid ? this.sessionStore.get(sid) : null);

        if (existingSession && existingSession.podName === expectedPodName) {
          // Update activity and return existing session
          existingSession.lastActivity = Date.now();
          existingSession.status = 'running';
          await this.sessionStore.set(existingSession.sessionId, existingSession);
          loggers.k8s.info({ sessionId: existingSession.sessionId }, "Reusing session record");

          // Emit session reuse status
          this.emit('deployment:status', {
            sessionId: existingSession.sessionId,
            step: 'session',
            status: 'complete',
            message: 'Resumed previous session',
            details: { isReconnect: true },
          });

          // Refresh the token on reconnect ONLY when it actually changed.
          //
          // History: this path used to unconditionally SIGKILL the CLI
          // and respawn it on EVERY reconnect (tab focus, network flap,
          // page reload). Each cycle cost ~5s of black terminal, which
          // users experienced as "openagentic keeps disconnecting" on
          // 2026-04-08. The fix is to fingerprint the incoming JWT and
          // only take the expensive refresh path when it differs from
          // the hash we stored during the previous refresh.
          try {
            const execClient = new ExecContainerClient({ url: `http://${existingPod.body.status?.podIP}:3060` });
            const execSession = await execClient.getSession(existingSession.sessionId).catch(() => null);

            const incomingHash = options.apiKey ? hashApiKey(options.apiKey) : undefined;
            const tokenUnchanged =
              !!execSession &&
              !!incomingHash &&
              existingSession.lastApiKeyHash === incomingHash;

            if (tokenUnchanged) {
              // Happy path: CLI is alive and the JWT we'd send is the
              // same one it's already using. Do nothing — the existing
              // terminal WS stays connected and the user sees zero
              // downtime.
              loggers.k8s.info(
                { sessionId: existingSession.sessionId },
                "Token unchanged on reconnect — skipping CLI refresh",
              );
            } else if (execSession && options.apiKey) {
              // Token actually changed (or we have no record of a prior
              // hash) — do the full refresh dance.
              loggers.k8s.info("Refreshing token for existing CLI session");
              await execClient.refreshSessionToken(existingSession.sessionId, options.apiKey, {
                model: options.model,
                apiEndpoint: options.apiEndpoint,
                githubToken: options.githubToken,
              });
              loggers.k8s.info("Token refreshed successfully");

              // Record the new hash so the NEXT reconnect can take the
              // fast path above.
              existingSession.lastApiKeyHash = incomingHash;
              await this.sessionStore.set(existingSession.sessionId, existingSession);

              // Wait for CLI to be ready after token refresh
              await this.waitForCliReady(execClient, existingSession.sessionId);

              // CRITICAL: Reconnect terminal WS — token refresh killed the old CLI process,
              // which closed the PTY, which closed the terminal WS (code 4003 "Session ended").
              // Without this reconnect, the terminal stays dead and the UI sees nothing.
              loggers.k8s.info({ sessionId: existingSession.sessionId }, "Reconnecting terminal after token refresh");
              this.disconnectTerminal(existingSession.sessionId);
              await this.connectTerminal(existingSession.sessionId);
            } else if (!execSession) {
              // CLI not running - create fresh session with new token
              loggers.k8s.info("Initializing session on exec daemon with fresh token");
              await execClient.createSession({
                sessionId: existingSession.sessionId,
                userId,
                userEmail: options.userEmail,  // For Linux username
                workspacePath: existingSession.workspacePath || `/workspaces/${userId}`,
                model: options.model || config.defaultModel,
                apiKey: options.apiKey,
                apiEndpoint: options.apiEndpoint,
              });

              // Wait for CLI to be ready after session creation
              await this.waitForCliReady(execClient, existingSession.sessionId);

              // Record the hash so reconnects with the same JWT take
              // the fast path next time.
              existingSession.lastApiKeyHash = incomingHash;
              await this.sessionStore.set(existingSession.sessionId, existingSession);

              // Connect terminal WS for the new session
              loggers.k8s.info({ sessionId: existingSession.sessionId }, "Connecting terminal for fresh session");
              await this.connectTerminal(existingSession.sessionId);
            }
            // Ensure code-server is running (may have been killed during token refresh)
            const csStatus = await execClient.getCodeServerStatus(existingSession.sessionId).catch(() => null);
            if (!csStatus || csStatus.status !== 'running') {
              loggers.k8s.info("Code-server not running after reconnect, auto-starting");
              this.startCodeServer(existingSession.sessionId).then(() => {
                loggers.k8s.info({ sessionId: existingSession.sessionId }, "Code-server restarted for reconnected session");
              }).catch((csErr) => {
                loggers.k8s.warn({ err: csErr.message }, "Failed to restart code-server on reconnect");
              });
            }
          } catch (err: any) {
            loggers.k8s.warn({ err: err?.message }, "Failed to verify/refresh exec session");
          }

          return existingSession;
        }

        // Pod exists but no session record - create one
        const newSession: K8sSession = {
          sessionId,
          userId,
          podName: expectedPodName,
          serviceName: `${expectedPodName}-svc`,
          status: 'running',
          podIP: existingPod.body.status?.podIP,
          servicePort: 3060,
          createdAt: Date.now(),
          lastActivity: Date.now(),
          workspacePath: `/workspaces/${userId}`,
          healthChecksPassed: 1,
          consecutiveHealthFailures: 0,
          lastApiKeyHash: options.apiKey ? hashApiKey(options.apiKey) : undefined,
        };

        await this.sessionStore.set(sessionId, newSession);
        await this.sessionStore.setUserSession(userId, sessionId);
        loggers.k8s.info("Created session record for existing pod");
        
        // Initialize session on exec daemon
        try {
          const execClient = new ExecContainerClient({ url: `http://${existingPod.body.status?.podIP}:3060` });
          loggers.k8s.info("Initializing session on exec daemon");
          await execClient.createSession({
            sessionId,
            userId,
            userEmail: options.userEmail,  // For Linux username
            workspacePath: newSession.workspacePath || `/workspaces/${userId}`,
            model: options.model || config.defaultModel,
            apiKey: options.apiKey,
            apiEndpoint: options.apiEndpoint,
          });

          // Wait for CLI to be ready after session creation
          await this.waitForCliReady(execClient, sessionId);
        } catch (err: any) {
          loggers.k8s.warn({ err: err?.message }, "Failed to init exec session");
        }

        // Auto-start code-server for the user (runs in background, non-blocking)
        this.startCodeServer(sessionId).then(() => {
          loggers.k8s.info({ sessionId }, "Code-server auto-started for existing pod");
        }).catch((err) => {
          loggers.k8s.warn({ sessionId, err: err.message }, "Failed to auto-start code-server for existing pod");
          // Non-fatal - user can start manually via UI
        });

        return newSession;
      }

      // Pod exists but not Running - wait for it if Pending
      if (phase === 'Pending' || phase === 'ContainerCreating') {
        loggers.k8s.info({ podName: expectedPodName, phase }, "Pod is starting, waiting");
        try {
          // 180s — matches the method's new default. See waitForPodReady
          // for the rationale (s3fs + sandbox + code-server cold boot).
          await this.waitForPodReady(expectedPodName, 180000);
          // Recursively call to get the running pod
          return this.getOrCreateSession(options);
        } catch (waitError: any) {
          // Pod exists but not ready yet - keep trying, don't create new pod
          loggers.k8s.info({ podName: expectedPodName }, "Pod still starting, will retry");
          // Wait a bit and retry (pod exists, just not ready)
          await new Promise(r => setTimeout(r, 5000));
          return this.getOrCreateSession(options);
        }
      }

      // Pod exists but in bad state (Failed, Succeeded) - delete and recreate
      loggers.k8s.info({ podName: expectedPodName, phase }, "Pod in bad state, deleting");
      await this.coreApi.deleteNamespacedPod(expectedPodName, this.namespace).catch(() => {});

      // Wait for pod to actually be deleted before creating new one
      for (let i = 0; i < 30; i++) {
        try {
          await this.coreApi.readNamespacedPod(expectedPodName, this.namespace);
          loggers.k8s.info({ podName: expectedPodName }, "Waiting for pod deletion");
          await new Promise(r => setTimeout(r, 1000));
        } catch (err: any) {
          if (err.statusCode === 404) {
            loggers.k8s.info({ podName: expectedPodName }, "Pod deleted, creating new one");
            break;
          }
          throw err;
        }
      }
      // Fall through to create new pod

    } catch (error: any) {
      if (error.statusCode !== 404) {
        loggers.k8s.error({ err: error?.message }, "Error checking for user pod");
        // Rethrow non-404 errors (don't try to create a pod that might already exist)
        throw error;
      }
      // 404 = Pod doesn't exist, which is fine - we'll create it
    }

    // No existing pod - create a new PERMANENT pod for this user
    loggers.k8s.info({ userId }, "No permanent pod found, creating one");
    return this.createSession(options);
  }

  /**
   * Enforce per-user and global session limits
   * Throws error if limits exceeded
   */
  private async enforceSessionLimits(userId: string): Promise<void> {
    const allSessions = await this.sessionStore.getAll();
    const activeSessions = allSessions.filter(s => s.status === 'running' || s.status === 'pending');

    // Check global session limit
    if (activeSessions.length >= config.maxGlobalSessions) {
      loggers.k8s.warn({ current: activeSessions.length, max: config.maxGlobalSessions }, "Global session limit reached");
      throw new Error(`Global session limit reached (${config.maxGlobalSessions}). Please try again later.`);
    }

    // Check per-user session limit
    const userSessions = activeSessions.filter(s => s.userId === userId);
    if (userSessions.length >= config.maxSessionsPerUser) {
      loggers.k8s.warn({ userId, current: userSessions.length, max: config.maxSessionsPerUser }, "User session limit reached");
      throw new Error(`Session limit reached for user (${config.maxSessionsPerUser}). Please close existing sessions.`);
    }
  }

  /**
   * Check if a session's pod is healthy
   * Returns true if healthy, false if unhealthy
   * Tracks consecutive failures - a single transient error won't kill the session
   * Persists state changes to session store
   */
  private async checkSessionHealth(session: K8sSession): Promise<boolean> {
    let stateChanged = false;
    try {
      const pod = await this.coreApi.readNamespacedPod(session.podName, this.namespace);
      const phase = pod.body.status?.phase;
      const conditions = pod.body.status?.conditions || [];
      const ready = conditions.find((c: k8s.V1PodCondition) => c.type === 'Ready' && c.status === 'True');

      if (phase === 'Running' && ready) {
        // Try to reach the health endpoint
        const url = `http://${session.serviceName}.${this.namespace}.svc.cluster.local:${session.servicePort}/health`;
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (response.ok) {
            // Success - reset failure counter and update lastActivity
            // This keeps sessions alive while they're actually running
            session.healthChecksPassed = (session.healthChecksPassed || 0) + 1;
            session.lastHealthCheck = Date.now();
            session.lastActivity = Date.now(); // CRITICAL: Healthy pod = active session
            session.consecutiveHealthFailures = 0;
            stateChanged = true;
            await this.sessionStore.set(session.sessionId, session);
            return true;
          }
          // HTTP error (non-2xx) - increment failure counter
          session.consecutiveHealthFailures = (session.consecutiveHealthFailures || 0) + 1;
          stateChanged = true;
          loggers.k8s.warn({ sessionId: session.sessionId, failures: session.consecutiveHealthFailures }, "Health check HTTP error");
          await this.sessionStore.set(session.sessionId, session);
          return false;
        } catch (fetchErr: any) {
          // Network/DNS error - increment failure counter but don't immediately kill
          // EAI_AGAIN is a transient DNS error that can happen during cluster churn
          session.consecutiveHealthFailures = (session.consecutiveHealthFailures || 0) + 1;
          const isTransient = fetchErr?.cause?.code === 'EAI_AGAIN' || fetchErr?.cause?.code === 'ETIMEDOUT';
          loggers.k8s.warn({ sessionId: session.sessionId, failures: session.consecutiveHealthFailures, transient: isTransient, err: fetchErr?.message || fetchErr }, "Health check fetch failed");
          await this.sessionStore.set(session.sessionId, session);
          return false;
        }
      }

      // Pod not running/ready - this is a real failure
      session.consecutiveHealthFailures = (session.consecutiveHealthFailures || 0) + 1;
      loggers.k8s.warn({ podName: session.podName, phase, failures: session.consecutiveHealthFailures }, "Pod not running/ready");
      await this.sessionStore.set(session.sessionId, session);
      return false;
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Pod definitely doesn't exist - clean up the stale session immediately
        // so the next getOrCreateSession call creates a fresh pod
        loggers.k8s.info({ podName: session.podName, sessionId: session.sessionId }, "Pod not found - cleaning up stale session");
        await this.cleanupSession(session.sessionId);
        return false;
      }
      // Other K8s API errors - increment but don't immediately kill
      session.consecutiveHealthFailures = (session.consecutiveHealthFailures || 0) + 1;
      loggers.k8s.error({ sessionId: session.sessionId, failures: session.consecutiveHealthFailures, err: error?.message || error }, "Error checking health");
      await this.sessionStore.set(session.sessionId, session);
      return false;
    }
  }

  /**
   * Create a new session by spawning a runner pod
   * First tries to claim a warm container for instant availability
   * Uses circuit breaker pattern to prevent cascade failures
   */
  async createSession(options: CreateK8sSessionOptions): Promise<K8sSession> {
    const { sessionId, userId, userEmail, workspacePath, model, apiKey, cliBackend } = options;

    // Check circuit breaker before creating pod
    this.checkCircuitBreaker();

    // Try to claim a warm container first (instant availability)
    if (this.k8sConfig.warmPool?.enabled) {
      const warmSession = await this.claimWarmContainer(options);
      if (warmSession) {
        loggers.k8s.info({ sessionId, podName: warmSession.podName }, "Session using warm container");
        this.recordCircuitBreakerSuccess();
        return warmSession;
      }
    }

    // No warm container available - create new PERMANENT pod for this user
    // Pod naming is USER-BASED: openagentic-{userIdHash}
    // Same user ALWAYS gets same pod name (permanent pod)
    const podName = getUserPodName(userId);
    const serviceName = `${podName}-svc`;
    const servicePort = 3060; // Fixed port inside pod

    loggers.k8s.info({ userId }, "Creating PERMANENT pod");
    loggers.k8s.info({ podName }, "Pod name (user-based, will persist)");

    // Create session record
    const session: K8sSession = {
      sessionId,
      userId,
      podName,
      serviceName,
      status: 'pending',
      servicePort,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      workspacePath: workspacePath || `/workspaces/${userId}`,
      healthChecksPassed: 0,
      consecutiveHealthFailures: 0,
      lastApiKeyHash: apiKey ? hashApiKey(apiKey) : undefined,
    };

    await this.sessionStore.set(sessionId, session);
    await this.sessionStore.setUserSession(userId, sessionId);

    try {
      // Create the runner pod
      await this.createRunnerPod(session, { model, apiKey, cliBackend });

      // Create service for the pod
      await this.createRunnerService(session);

      // Wait for pod to be ready
      await this.waitForPodReady(podName);

      // Update session with pod IP
      const pod = await this.coreApi.readNamespacedPod(podName, this.namespace);
      session.podIP = pod.body.status?.podIP;
      session.status = 'running';

      // Get service IP
      const service = await this.coreApi.readNamespacedService(serviceName, this.namespace);
      session.serviceIP = service.body.spec?.clusterIP;

      // Persist updated session state
      await this.sessionStore.set(sessionId, session);

      loggers.k8s.info({ sessionId, podIP: session.podIP }, "Session ready");

      // Create PTY session on the runner (required before WebSocket connection)
      await this.createPtySessionOnRunner(session, { model, apiKey, userEmail, cliBackend });

      // Auto-start code-server for the user (runs in background, non-blocking)
      this.startCodeServer(sessionId).then(() => {
        loggers.k8s.info({ sessionId }, "Code-server auto-started");
      }).catch((err) => {
        loggers.k8s.warn({ sessionId, err: err.message }, "Failed to auto-start code-server");
        // Non-fatal - user can start manually
      });

      // Record success for circuit breaker
      this.recordCircuitBreakerSuccess();

      return session;
    } catch (error) {
      loggers.k8s.error({ sessionId, err: error }, "Failed to create session");
      session.status = 'failed';
      await this.sessionStore.set(sessionId, session);

      // Record failure for circuit breaker
      this.recordCircuitBreakerFailure();

      // Cleanup on failure
      await this.cleanupSession(sessionId).catch(err => loggers.k8s.error({ sessionId, err }, "Cleanup after session creation failure failed"));
      throw error;
    }
  }

  /**
   * Circuit breaker: Check if pod creation is allowed
   * Throws error if circuit is open
   */
  private checkCircuitBreaker(): void {
    const now = Date.now();

    if (this.circuitBreakerState === 'open') {
      // Check if timeout has passed to allow half-open
      if (now - this.circuitBreakerLastFailure > K8sSessionManager.CIRCUIT_BREAKER_TIMEOUT_MS) {
        loggers.k8s.info('Circuit breaker transitioning to half-open');
        this.circuitBreakerState = 'half-open';
        this.circuitBreakerFailures = 0;
      } else {
        const waitTime = Math.ceil((K8sSessionManager.CIRCUIT_BREAKER_TIMEOUT_MS - (now - this.circuitBreakerLastFailure)) / 1000);
        throw new Error(`Pod creation temporarily disabled due to repeated failures. Please try again in ${waitTime} seconds.`);
      }
    }
  }

  /**
   * Circuit breaker: Record a successful pod creation
   */
  private recordCircuitBreakerSuccess(): void {
    if (this.circuitBreakerState === 'half-open') {
      this.circuitBreakerFailures++;
      if (this.circuitBreakerFailures >= K8sSessionManager.CIRCUIT_BREAKER_HALF_OPEN_ATTEMPTS) {
        loggers.k8s.info('Circuit breaker closing after successful attempts');
        this.circuitBreakerState = 'closed';
        this.circuitBreakerFailures = 0;
      }
    } else if (this.circuitBreakerState === 'closed') {
      this.circuitBreakerFailures = 0; // Reset on success
    }
  }

  /**
   * Circuit breaker: Record a failed pod creation
   */
  private recordCircuitBreakerFailure(): void {
    this.circuitBreakerFailures++;
    this.circuitBreakerLastFailure = Date.now();

    if (this.circuitBreakerState === 'half-open') {
      // Any failure in half-open reopens the circuit
      loggers.k8s.info('Circuit breaker reopening after failure in half-open state');
      this.circuitBreakerState = 'open';
    } else if (this.circuitBreakerState === 'closed' &&
               this.circuitBreakerFailures >= K8sSessionManager.CIRCUIT_BREAKER_THRESHOLD) {
      loggers.k8s.info({ failures: this.circuitBreakerFailures }, "Circuit breaker opening after consecutive failures");
      this.circuitBreakerState = 'open';
      this.emit('circuit:open');
    }
  }

  /**
   * Create the runner pod
   */

  /**
   * Ensure a PVC exists for the user's workspace
   * Creates a PersistentVolumeClaim if it doesn't exist
   */
  private async ensureUserPVC(userId: string): Promise<string> {
    const pvcName = `openagentic-workspace-${createHash('sha256').update(userId).digest('hex').substring(0, 12)}`;
    
    try {
      // Check if PVC already exists
      await this.coreApi.readNamespacedPersistentVolumeClaim(pvcName, this.namespace);
      loggers.k8s.info({ pvcName }, "PVC already exists");
      return pvcName;
    } catch (error: any) {
      if (error.statusCode !== 404) {
        throw error;
      }
    }
    
    // Create PVC
    const pvc: k8s.V1PersistentVolumeClaim = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: pvcName,
        namespace: this.namespace,
        labels: {
          app: 'openagentic-workspace',
          'app.kubernetes.io/component': 'workspace-storage',
          'app.kubernetes.io/managed-by': 'openagentic-manager',
          'openagentic.io/user-id': userId,
        },
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: {
          requests: {
            storage: `${config.maxWorkspaceSizeMb}Mi`,  // Use config for size
          },
        },
        // Use specified storage class, or omit to use cluster default
        // Empty string or undefined = use default storage class
        ...(process.env.K8S_STORAGE_CLASS ? { storageClassName: process.env.K8S_STORAGE_CLASS } : {}),
      },
    };
    
    await this.coreApi.createNamespacedPersistentVolumeClaim(this.namespace, pvc);
    loggers.k8s.info({ pvcName, sizeMb: config.maxWorkspaceSizeMb }, "Created PVC");
    return pvcName;
  }

  private async createRunnerPod(
    session: K8sSession,
    options: { model?: string; apiKey?: string; cliBackend?: string }
  ): Promise<void> {
    // Storage mode: MinIO/S3FS (default) or PVC (fallback)
    // When using S3FS, skip PVC creation - workspace is mounted via FUSE
    
    const pod: k8s.V1Pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: session.podName,
        namespace: this.namespace,
        labels: {
          app: 'openagentic-runner',
          'app.kubernetes.io/component': 'runner',
          'app.kubernetes.io/managed-by': 'openagentic-manager',
          'openagentic.io/session-id': session.sessionId,
          'openagentic.io/user-id': session.userId,
        },
        // NOTE: No ownerReferences - pods are PERMANENT and must survive manager restarts
        // Cleanup is handled by admin deletion or explicit session termination
      },
      spec: {
        restartPolicy: 'Never',
        terminationGracePeriodSeconds: 30,
        // SECURITY: Use restricted service account with no K8s API access.
        // The chart templates a per-release SA (<release>-runner-restricted)
        // and passes the name through K8S_RUNNER_SERVICE_ACCOUNT env var.
        // Throw early if neither is set rather than guess and produce a
        // 403 Forbidden at pod-create time (the old fallback of
        // 'openagentic-runner-restricted' was wrong for any install
        // with a release name other than plain 'openagentic').
        serviceAccountName: (() => {
          const sa = this.k8sConfig.runnerServiceAccount;
          if (!sa) {
            throw new Error(
              'k8sSessionManager: runnerServiceAccount is unset. Set ' +
              'K8S_RUNNER_SERVICE_ACCOUNT in the code-manager Deployment ' +
              'to the chart-templated SA name (e.g. <release>-runner-restricted).'
            );
          }
          return sa;
        })(),
        automountServiceAccountToken: false, // CRITICAL: Prevents K8s API access from container
        // Image pull secrets from config
        imagePullSecrets: this.k8sConfig.imagePullSecrets?.map(name => ({ name })),
        // Security context - run as root for user sandboxing
        securityContext: {
          runAsUser: 0,
          runAsGroup: 0,
          fsGroup: 0,
        },
        containers: [
          {
            name: 'runner',
            image: this.runnerImage,
            imagePullPolicy: 'Always',
            ports: [
              { containerPort: 3060, name: 'http', protocol: 'TCP' },
              // Code-server ports
              { containerPort: 3100, name: 'code-server', protocol: 'TCP' },
              // GhostPilot (shared browser control)
              { containerPort: 3200, name: 'ghostpilot', protocol: 'TCP' },
            ],
            env: this.buildPodEnv(session, options),
            // Burstable — requests only, NO memory/cpu limits. See
            // config.ts runnerResources for the rationale (OOMKilled
            // pod openagentic-2cb1bf3f719f, 2026-04-08). The
            // ephemeral-storage limit stays because that's disk-
            // backed quota, not memory, and a runaway write is a
            // different failure mode.
            resources: this.k8sConfig.runnerResources || {
              requests: { cpu: '500m', memory: '512Mi', 'ephemeral-storage': '1Gi' },
              limits: { 'ephemeral-storage': '10Gi' },
            },
            // Security context for sandboxing - privileged mode required for S3FS FUSE mounts
            securityContext: {
              runAsUser: 0,
              runAsGroup: 0,
              // Privileged mode required for s3fs FUSE mount
              privileged: true,
              capabilities: {
                add: ['SYS_ADMIN', 'SETUID', 'SETGID', 'CHOWN', 'DAC_OVERRIDE'],
              },
            },
            // Volume mounts for S3FS FUSE + runtime tools cache
            volumeMounts: [
              {
                name: 'dev-fuse',
                mountPath: '/dev/fuse',
              },
              {
                name: 'tools-cache',
                mountPath: '/opt/tools',
              },
            ],
            // Probes - PERMANENT PODS: Very lenient to prevent killing
            // Pods should NEVER be killed by probes - they are permanent
            readinessProbe: {
              httpGet: { path: '/health', port: 3060 as any },
              initialDelaySeconds: 60,      // Give more time to start
              periodSeconds: 60,            // Check less frequently
              timeoutSeconds: 30,           // Allow more time for response
              failureThreshold: 100,        // Essentially never fail
            },
            // DISABLED liveness probe - pods are permanent, should NEVER be killed
            // livenessProbe removed to prevent Kubernetes from killing pods
          },
        ],
        // Fix DNS: ndots:5 + search gnomuslabs.com causes external domains
        // to resolve as *.gnomuslabs.com (wildcard DNS). ndots:1 means domains
        // with any dot are queried as absolute names first.
        dnsConfig: {
          options: [{ name: 'ndots', value: '1' }],
        },
        // Node selector from config
        nodeSelector: this.k8sConfig.nodeSelector,
        tolerations: this.k8sConfig.tolerations,
        // Volumes - /dev/fuse for S3FS FUSE mounts, tools-cache for runtime tools
        volumes: [
          {
            name: 'dev-fuse',
            hostPath: {
              path: '/dev/fuse',
              type: 'CharDevice',
            },
          },
          {
            name: 'tools-cache',
            emptyDir: {
              sizeLimit: '5Gi',
            },
          },
        ],
      },
    };

    try {
      await this.coreApi.createNamespacedPod(this.namespace, pod);
      loggers.k8s.info({ podName: session.podName }, "Created pod with S3FS/MinIO storage");
    } catch (error: any) {
      // Handle 409 Conflict - pod already exists (race condition)
      if (error.statusCode === 409 || error.body?.reason === 'AlreadyExists') {
        loggers.k8s.info({ podName: session.podName }, "Pod already exists, will use existing");
        return; // Pod exists, just continue
      }
      throw error;
    }
  }

  /**
   * Build environment variables for the runner pod
   */
  private buildPodEnv(
    session: K8sSession,
    options: { model?: string; apiKey?: string; cliBackend?: string; githubToken?: string }
  ): k8s.V1EnvVar[] {
    const env: k8s.V1EnvVar[] = [
      { name: 'PORT', value: '3060' },
      { name: 'SESSION_ID', value: session.sessionId },
      { name: 'OPENAGENTIC_SESSION_ID', value: session.sessionId },
      { name: 'OPENAGENTIC_MANAGED', value: '1' },
      { name: 'CONTAINER_MODE', value: '1' },
      { name: 'OPENAGENTIC_REMOTE_MEMORY_DIR', value: `/workspaces/${session.userId}/.openagentic` },
      { name: 'USER_ID', value: session.userId },
      { name: 'WORKSPACES_PATH', value: '/workspaces' },
      { name: 'WORKSPACE_PATH', value: session.workspacePath },
      // Storage mode - MinIO S3FS for workspace persistence
      { name: 'STORAGE_MODE', value: 's3fs' },
      { name: 'STORAGE_PROVIDER', value: 'minio' },
      { name: 'STORAGE_ENDPOINT', value: config.storage.endpoint || 'http://openagentic-workspace-minio:9000' },
      { name: 'STORAGE_BUCKET', value: config.storage.bucket || 'openagentic-workspaces' },
      { name: 'STORAGE_ACCESS_KEY', value: config.storage.accessKeyId || 'minioadmin' },
      { name: 'STORAGE_SECRET_KEY', value: config.storage.secretAccessKey || 'minioadmin123' },
      // Runtime tools installer: defer slow tools (gcloud, az) to background
      { name: 'FAST_BOOT', value: 'true' },
      // Sandbox settings
      { name: 'SANDBOX_ENABLED', value: 'true' },
      { name: 'SANDBOX_UID_MIN', value: '10000' },
      { name: 'SANDBOX_UID_MAX', value: '60000' },
      // Code-server settings
      { name: 'CODE_SERVER_BINARY', value: '/usr/bin/code-server' },
      { name: 'CODE_SERVER_BASE_PORT', value: '3100' },
      { name: 'CODE_SERVER_MAX_INSTANCES', value: '1' },
      { name: 'CODE_SERVER_EXTENSIONS_DIR', value: '/var/lib/code-server/extensions' },
      // Terminal setting - re-enabled now that containers are isolated with NetworkPolicy
      // Users can access terminal in their own container but can't reach cluster services
      { name: 'CODE_SERVER_DISABLE_TERMINAL', value: process.env.CODE_SERVER_DISABLE_TERMINAL || 'false' },
      // LLM PROVIDER: MUST use API mode - NO hardcoded providers allowed
      // The CLI calls back to openagentic-api for all LLM requests
      { name: 'LLM_PROVIDER', value: 'api' },
      { name: 'OPENAGENTIC_API_ENDPOINT', value: config.openagenticApiEndpoint },
      // OPENAGENTIC_BASE_URL is what the openagentic CLI v2 actually reads
      // (services/api/client.ts line 132). Keep OPENAGENTIC_API_ENDPOINT too
      // for backward compat with the older vendored CLI builds.
      { name: 'OPENAGENTIC_BASE_URL', value: config.openagenticApiEndpoint },
      // Model identifier (resolved by API based on admin settings)
      { name: 'DEFAULT_MODEL', value: options.model || config.defaultModel || '' },
      // CLI backend: always openagentic-cli (routes through SDK/API)
      { name: 'CLI_BACKEND', value: 'openagentic-cli' },
    ];

    // Internal API key for manager -> runner communication
    if (config.internalApiKey) {
      env.push({ name: 'INTERNAL_API_KEY', value: config.internalApiKey });
    }

    // User's JWT token for OpenAgentic API access
    // The CLI uses --provider api mode which routes through OpenAgentic API
    if (options.apiKey) {
      env.push({ name: 'OPENAGENTIC_API_KEY', value: options.apiKey });
      // OPENAGENTIC_API_KEY is what the openagentic CLI v2 reads via auth.ts
      // (utils/auth.ts → getOpenAgenticApiKey). Alias for forward compat.
      env.push({ name: 'OPENAGENTIC_API_KEY', value: options.apiKey });
    }

    // SearXNG URL for web search (passed to openagentic CLI in runner pod)
    const searxngUrl = process.env.SEARXNG_URL || 'http://openagentic-searxng:8080';
    env.push({ name: 'SEARXNG_URL', value: searxngUrl });

    // GitHub token for git operations (clone, push, gh CLI, etc.)
    // Prefer per-user token from Device Flow OAuth over global env var
    const githubToken = options.githubToken || process.env.GITHUB_TOKEN;
    if (githubToken) {
      env.push({ name: 'GITHUB_TOKEN', value: githubToken });
      env.push({ name: 'GH_TOKEN', value: githubToken });
    }

    // MinIO/S3 credentials from config (set by Helm values or environment)
    if (config.storage.accessKeyId) {
      env.push({ name: 'STORAGE_ACCESS_KEY', value: config.storage.accessKeyId });
    }
    if (config.storage.secretAccessKey) {
      env.push({ name: 'STORAGE_SECRET_KEY', value: config.storage.secretAccessKey });
    }

    return env;
  }

  /**
   * Create a service for the runner pod
   */
  private async createRunnerService(session: K8sSession): Promise<void> {
    const service: k8s.V1Service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: session.serviceName,
        namespace: this.namespace,
        labels: {
          app: 'openagentic-runner',
          'openagentic.io/session-id': session.sessionId,
          'openagentic.io/user-id': session.userId,
        },
        // OwnerReference to pod for automatic cleanup
        ownerReferences: [
          {
            apiVersion: 'v1',
            kind: 'Pod',
            name: session.podName,
            uid: '', // Will be set after pod creation
            blockOwnerDeletion: false,
          },
        ],
      },
      spec: {
        type: 'ClusterIP',
        selector: {
          'openagentic.io/session-id': session.sessionId,
        },
        ports: [
          { name: 'http', port: 3060, targetPort: 3060 as any, protocol: 'TCP' },
          { name: 'code-server', port: 3100, targetPort: 3100 as any, protocol: 'TCP' },
          { name: 'ghostpilot', port: 3200, targetPort: 3200 as any, protocol: 'TCP' },
        ],
      },
    };

    // Get pod UID for owner reference
    try {
      const pod = await this.coreApi.readNamespacedPod(session.podName, this.namespace);
      if (service.metadata?.ownerReferences?.[0]) {
        service.metadata.ownerReferences[0].uid = pod.body.metadata?.uid || '';
      }
    } catch (error) {
      loggers.k8s.warn("Could not get pod UID for owner reference");
    }

    try {
      await this.coreApi.createNamespacedService(this.namespace, service);
      loggers.k8s.info({ serviceName: session.serviceName }, "Created service");
    } catch (error: any) {
      // Handle 409 Conflict - service already exists (permanent pod architecture)
      if (error.statusCode === 409 || error.body?.reason === 'AlreadyExists') {
        loggers.k8s.info({ serviceName: session.serviceName }, "Service already exists, will use existing");
        return; // Service exists, just continue
      }
      throw error;
    }
  }

  /**
   * Create PTY session on the runner pod
   * CRITICAL: This MUST be called before connecting WebSocket
   */
  private async createPtySessionOnRunner(
    session: K8sSession,
    options: { model?: string; apiKey?: string; userEmail?: string; cliBackend?: string }
  ): Promise<void> {
    const url = `http://${session.serviceName}.${this.namespace}.svc.cluster.local:${session.servicePort}`;

    loggers.k8s.info({ podName: session.podName }, "Creating PTY session on runner");

    const response = await fetch(`${url}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': config.internalApiKey,
      },
      body: JSON.stringify({
        sessionId: session.sessionId,
        userId: session.userId,
        userEmail: options.userEmail,  // For Linux username
        workspacePath: session.workspacePath,
        model: options.model || config.defaultModel,
        apiKey: options.apiKey,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create PTY session on runner: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as { sessionId: string; pid: number };
    loggers.k8s.info({ sessionId: result.sessionId, pid: result.pid }, "PTY session created on runner");

    // Wait for CLI to be ready using ExecContainerClient
    const execClient = new ExecContainerClient({ url });
    await this.waitForCliReady(execClient, session.sessionId);
  }

  /**
   * Wait for a pod to be ready.
   *
   * Default timeout: 180s. Bumped from 60s on 2026-04-08 after the
   * openagentic-2cb1bf3f719f diagnosis — cold-boot sessions routinely
   * need >60s because the exec container has to mount s3fs (FUSE), run
   * the sandbox user setup, fetch the codemode admin config over the
   * network, start code-server, and spawn the openagentic CLI. On a
   * fully-cold pod the critical path is dominated by s3fs connection
   * + first sync, which is network-bound and can hit 90-120s on slow
   * storage backends. 180s gives headroom without being so long that
   * a truly broken pod hangs the UI.
   *
   * Callers that need a tighter bound (e.g. post-restart health check)
   * can pass an explicit `timeout` arg.
   */
  private async waitForPodReady(podName: string, timeout = 180000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const pod = await this.coreApi.readNamespacedPod(podName, this.namespace);
        const phase = pod.body.status?.phase;
        const conditions = pod.body.status?.conditions || [];

        // Check if pod is ready
        const ready = conditions.find((c: k8s.V1PodCondition) => c.type === 'Ready' && c.status === 'True');
        if (phase === 'Running' && ready) {
          return;
        }
        
        // Check for failure
        if (phase === 'Failed' || phase === 'Succeeded') {
          throw new Error(`Pod ${podName} is in ${phase} state`);
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error: any) {
        if (error.statusCode === 404) {
          throw new Error(`Pod ${podName} not found`);
        }
        throw error;
      }
    }
    
    throw new Error(`Timeout waiting for pod ${podName} to be ready`);
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<K8sSession | null> {
    return this.sessionStore.get(sessionId);
  }

  /**
   * Store/update a session in the session store (for recovery)
   */
  async storeSession(sessionId: string, session: K8sSession): Promise<void> {
    await this.sessionStore.set(sessionId, session);
  }

  /**
   * Store user-to-session mapping (for recovery)
   */
  async storeUserSession(userId: string, sessionId: string): Promise<void> {
    await this.sessionStore.setUserSession(userId, sessionId);
  }

  /**
   * Get session by user ID - returns the user's active session if any
   */
  async getSessionByUserId(userId: string): Promise<K8sSession | null> {
    const sessionId = await this.sessionStore.getUserSession(userId);
    if (!sessionId) return null;
    return this.sessionStore.get(sessionId);
  }

  /**
   * Get all sessions
   */
  async listSessions(): Promise<K8sSession[]> {
    return this.sessionStore.getAll();
  }

  /**
   * Update session activity timestamp - call this when user interacts with the session
   */
  async touchSession(sessionId: string): Promise<void> {
    const session = await this.sessionStore.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      await this.sessionStore.set(sessionId, session);
    }
  }

  /**
   * Disconnect from a session (soft stop - does NOT delete the permanent pod)
   * The pod remains running for user to reconnect later
   */
  async stopSession(sessionId: string): Promise<void> {
    loggers.k8s.info({ sessionId }, "Disconnecting from session (pod remains running)");
    this.disconnectTerminal(sessionId);
    // NOTE: Pod is NOT deleted - it's permanent
  }

  /**
   * Force delete a user's permanent pod (ADMIN ONLY)
   * Use sparingly - normally pods should never be deleted
   */
  async forceDeleteUserPod(userId: string): Promise<void> {
    const podName = getUserPodName(userId);
    loggers.k8s.info({ podName, userId }, "ADMIN: Force deleting permanent pod");

    // Close any WebSocket connections
    const sessionId = await this.sessionStore.getUserSession(userId);
    if (sessionId) {
      this.disconnectTerminal(sessionId);
      await this.sessionStore.delete(sessionId);
      await this.sessionStore.deleteUserSession(userId);
    }

    // Delete pod
    try {
      await this.coreApi.deleteNamespacedPod(podName, this.namespace);
      loggers.k8s.info({ podName }, "ADMIN: Deleted pod");
    } catch (error: any) {
      if (error.statusCode !== 404) {
        loggers.k8s.error({ podName, err: error }, "Error deleting pod");
        throw error;
      }
    }

    // Delete service
    const serviceName = `${podName}-svc`;
    try {
      await this.coreApi.deleteNamespacedService(serviceName, this.namespace);
      loggers.k8s.info({ serviceName }, "ADMIN: Deleted service");
    } catch (error: any) {
      if (error.statusCode !== 404) {
        // Ignore - service might not exist
      }
    }
  }

  /**
   * Legacy cleanup method - now only disconnects, does NOT delete pod
   * Kept for API compatibility but behavior changed
   */
  private async cleanupSession(sessionId: string): Promise<void> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) return;

    loggers.k8s.info({ sessionId, podName: session.podName }, "Disconnecting session (pod remains)");

    // Close WebSocket connection
    this.disconnectTerminal(sessionId);

    // Remove from session store (but NOT the pod!)
    await this.sessionStore.delete(sessionId);

    // Remove from user session mapping
    const userSessionId = await this.sessionStore.getUserSession(session.userId);
    if (userSessionId === sessionId) {
      await this.sessionStore.deleteUserSession(session.userId);
    }

    // NOTE: Pod and service are NOT deleted - they are PERMANENT
  }

  /**
   * Health check loop — monitors runner pods every 60s.
   * Pods are permanent and never deleted, but we track:
   *   - Pod Running/Ready status
   *   - Exec daemon /health endpoint
   *   - Storage mount status (s3fs degradation detection)
   * On degraded storage: logs a warning so operators can investigate.
   * On repeated /health failures: marks session as unhealthy for reconnect flow.
   */
  private startHealthChecks(): void {
    const INTERVAL_MS = 60_000;
    loggers.k8s.info({ intervalSec: INTERVAL_MS / 1000 }, "Health check loop started");

    this.healthCheckInterval = setInterval(async () => {
      const allSessions = await this.sessionStore.getAll();
      for (const session of allSessions) {
        try {
          const healthy = await this.checkSessionHealth(session);
          if (!healthy && session.consecutiveHealthFailures >= 3) {
            loggers.k8s.warn({ podName: session.podName, failures: session.consecutiveHealthFailures, sessionId: session.sessionId }, "Pod unhealthy for consecutive checks");
          }

          // Check storage status from the health response
          try {
            const url = `http://${session.serviceName}.${this.namespace}.svc.cluster.local:${session.servicePort}/health`;
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (res.ok) {
              const data = await res.json() as any;
              if (data.status === 'degraded') {
                loggers.k8s.error({ podName: session.podName, sessionId: session.sessionId, storageFailures: data.storage?.consecutiveFailures, recovering: data.storage?.recovering }, "STORAGE DEGRADED");
              }
            }
          } catch { /* already counted in checkSessionHealth */ }
        } catch (err: any) {
          loggers.k8s.error({ sessionId: session.sessionId, err: err?.message }, "Health check error");
        }
      }
    }, INTERVAL_MS);
  }

  /**
   * DISABLED: Cleanup loop is no longer used
   * Pods are PERMANENT and should never be auto-deleted
   */
  private startCleanupLoop(): void {
    loggers.k8s.info("Cleanup loop DISABLED - pods are permanent");
    // NO-OP: Pods are permanent, no automatic cleanup
  }

  /**
   * DISABLED: Stale resource cleanup is no longer performed
   * Pods are PERMANENT - only admin can manually delete them
   */
  private async cleanupStaleResources(): Promise<void> {
    // NO-OP: Pods are permanent, no automatic cleanup
    // Use forceDeleteUserPod() for admin-initiated cleanup
  }

  /**
   * DISABLED: Orphaned pod cleanup is no longer performed
   * Pods are PERMANENT - "orphaned" pods are actually just permanent user pods
   */
  private async cleanupOrphanedPods(): Promise<void> {
    // NO-OP: Pods are permanent, "orphaned" pods are valid permanent pods
    // Use forceDeleteUserPod() for admin-initiated cleanup
  }

  /**
   * Connect to session terminal via WebSocket
   * PERMANENT PODS: Try to connect even if session was previously marked failed
   */
  async connectTerminal(sessionId: string): Promise<WebSocket | null> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      loggers.k8s.error({ sessionId }, "Cannot connect terminal - session not found");
      return null;
    }

    // PERMANENT PODS: Always try to connect, reset status immediately
    if (session.status === 'failed' || session.status === 'terminated') {
      loggers.k8s.info({ sessionId, previousStatus: session.status }, "Session was marked failed, resetting to running for reconnection");
      session.status = 'running';
      session.consecutiveHealthFailures = 0;
      await this.sessionStore.set(sessionId, session);
    }

    // Check for existing connection
    const existing = this.wsConnections.get(sessionId);
    if (existing && existing.readyState === WebSocket.OPEN) {
      return existing;
    }

    // Build WebSocket URL to runner service
    // CRITICAL: Auth must be passed as query param, not header (exec container requirement)
    const wsUrl = `ws://${session.serviceName}.${this.namespace}.svc.cluster.local:${session.servicePort}/ws/terminal/${sessionId}?internalKey=${encodeURIComponent(config.internalApiKey)}`;
    const ws = new WebSocket(wsUrl);

    // Wait for the WebSocket to actually open before returning
    return new Promise<WebSocket | null>((resolve) => {
      const timeout = setTimeout(() => {
        loggers.k8s.error({ sessionId }, "Terminal WebSocket connection timeout");
        ws.close();
        resolve(null);
      }, 10000); // 10 second timeout

      ws.on('open', () => {
        clearTimeout(timeout);
        loggers.k8s.info({ sessionId }, "Terminal WebSocket connected");
        this.wsConnections.set(sessionId, ws);
        this.emit('terminal:connected', sessionId);
        resolve(ws);
      });

      ws.on('message', (data: Buffer | string) => {
        this.emit('terminal:data', sessionId, data.toString());
      });

      ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        loggers.k8s.info({ sessionId, code, reason: reason.toString() }, "Terminal WebSocket closed");
        this.wsConnections.delete(sessionId);
        this.emit('terminal:closed', sessionId, code, reason.toString());
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        loggers.k8s.error({ sessionId, err: error }, "Terminal WebSocket error");
        this.emit('terminal:error', sessionId, error);
        resolve(null);
      });
    });
  }

  /**
   * Write to terminal via WebSocket
   * Automatically reconnects if connection is missing
   */
  async writeTerminal(sessionId: string, data: string): Promise<void> {
    let ws: WebSocket | null | undefined = this.wsConnections.get(sessionId);

    // Auto-reconnect if no connection
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      loggers.k8s.info({ sessionId }, "No terminal connection, attempting to reconnect");
      ws = await this.connectTerminal(sessionId);
      if (!ws) {
        loggers.k8s.error({ sessionId }, "Failed to reconnect terminal");
        return;
      }
      loggers.k8s.info({ sessionId }, "Terminal reconnected");
    }

    ws.send(data);
  }

  /**
   * Resize terminal
   */
  resizeTerminal(sessionId: string, cols: number, rows: number): void {
    const ws = this.wsConnections.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
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
   * Start code-server for a session
   * PERMANENT PODS: Accept failed sessions and try to start anyway
   */
  async startCodeServer(sessionId: string): Promise<CodeServerInfo> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // PERMANENT PODS: Reset status if failed/terminated
    if (session.status === 'failed' || session.status === 'terminated') {
      loggers.k8s.info({ sessionId, previousStatus: session.status }, "Session was failed, resetting for code-server start");
      session.status = 'running';
      session.consecutiveHealthFailures = 0;
      await this.sessionStore.set(sessionId, session);
    }

    const url = `http://${session.serviceName}.${this.namespace}.svc.cluster.local:${session.servicePort}`;
    
    // Start code-server
    const startResponse = await fetch(`${url}/sessions/${sessionId}/code-server`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': config.internalApiKey,
      },
    });

    if (!startResponse.ok) {
      throw new Error(`Failed to start code-server: ${startResponse.status}`);
    }

    const startResult = await startResponse.json() as CodeServerInfo;
    loggers.k8s.info({ sessionId }, "Code-server started, waiting for HTTP readiness");

    // Wait for code-server to be HTTP-ready (actually serving requests)
    // This ensures VS Code is fully loaded before the UI opens it
    const waitResponse = await fetch(`${url}/sessions/${sessionId}/code-server/wait-ready`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': config.internalApiKey,
      },
      body: JSON.stringify({ timeout: 30000 }),
    });

    if (waitResponse.ok) {
      const readinessResult = await waitResponse.json() as { ready: boolean; url?: string; error?: string };
      if (readinessResult.ready) {
        loggers.k8s.info({ sessionId, url: readinessResult.url || startResult.url }, "Code-server HTTP-ready");
        return {
          ...startResult,
          url: readinessResult.url || startResult.url,
        };
      } else {
        loggers.k8s.warn({ sessionId, error: readinessResult.error }, "Code-server HTTP readiness check failed");
        // Return start result anyway - code-server may still work, just slower
      }
    } else {
      loggers.k8s.warn({ sessionId, status: waitResponse.status }, "Code-server wait-ready request failed");
    }

    // Return the start result even if readiness check failed
    return startResult;
  }

  /**
   * Get code-server status
   * PERMANENT PODS: Try to get status even for failed sessions
   */
  async getCodeServerStatus(sessionId: string): Promise<CodeServerInfo> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return { status: 'stopped', url: null };
    }

    // PERMANENT PODS: Reset status if failed/terminated before checking
    if (session.status === 'failed' || session.status === 'terminated') {
      session.status = 'running';
      session.consecutiveHealthFailures = 0;
      await this.sessionStore.set(sessionId, session);
    }

    const url = `http://${session.serviceName}.${this.namespace}.svc.cluster.local:${session.servicePort}`;
    const response = await fetch(`${url}/sessions/${sessionId}/code-server`, {
      method: 'GET',
      headers: {
        'X-Internal-Api-Key': config.internalApiKey,
      },
    });

    if (!response.ok) {
      return { status: 'stopped', url: null };
    }

    return response.json() as Promise<CodeServerInfo>;
  }

  /**
   * Stop code-server
   */
  async stopCodeServer(sessionId: string): Promise<void> {
    const session = await this.sessionStore.get(sessionId);
    if (!session || session.status !== 'running') return;

    const url = `http://${session.serviceName}.${this.namespace}.svc.cluster.local:${session.servicePort}`;
    await fetch(`${url}/sessions/${sessionId}/code-server`, {
      method: 'DELETE',
      headers: {
        'X-Internal-Api-Key': config.internalApiKey,
      },
    });
  }

  /**
   * Cleanup all sessions on shutdown
   * Note: We do NOT delete sessions from Redis on shutdown - they persist for recovery
   */
  async shutdown(): Promise<void> {
    loggers.k8s.info('Shutting down');

    // Stop background loops
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Get all sessions
    const allSessions = await this.sessionStore.getAll();

    // Clean up all sessions - delete K8s resources but keep Redis state for recovery
    const cleanupPromises = allSessions.map(session =>
      this.cleanupSession(session.sessionId).catch(err =>
        loggers.k8s.error({ sessionId: session.sessionId, err }, "Error cleaning up session")
      )
    );

    await Promise.all(cleanupPromises);

    // Clear WebSocket connections
    this.wsConnections.clear();

    this.isInitialized = false;
    loggers.k8s.info('Shutdown complete');
  }

  /**
   * Sync session records with running PERMANENT pods
   * On startup, discovers existing permanent user pods and creates session records for them
   * NOTE: Does NOT delete any pods - just reconciles session store with K8s
   */
  async syncWithCluster(): Promise<void> {
    loggers.k8s.info('Syncing with cluster (PERMANENT POD MODE)');

    try {
      // Get sessions from Redis
      const redisSessions = await this.sessionStore.getAll();
      loggers.k8s.info({ count: redisSessions.length }, "Found sessions in store");

      // Get all openagentic pods from K8s
      const pods = await this.coreApi.listNamespacedPod(
        this.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        'app=openagentic-runner'  // Match pods with app=openagentic-runner label
      );

      const k8sPodNames = new Set<string>();
      let recoveredFromK8s = 0;
      let staleSessions = 0;

      // Process pods from K8s - these are PERMANENT user pods
      for (const pod of pods.body.items || []) {
        const podName = pod.metadata?.name || '';
        const userId = pod.metadata?.labels?.['openagentic.io/user-id'];
        const phase = pod.status?.phase;

        if (!podName || !userId) continue;

        k8sPodNames.add(podName);

        // Only process Running or Pending pods
        if (phase !== 'Running' && phase !== 'Pending') {
          loggers.k8s.info({ podName, phase }, "Found permanent pod in non-running state");
          continue;
        }

        // Check if user already has a session record
        const existingSessionId = await this.sessionStore.getUserSession(userId);
        if (existingSessionId) {
          const existingSession = await this.sessionStore.get(existingSessionId);
          if (existingSession && existingSession.podName === podName) {
            // Update session with current pod state
            existingSession.status = phase === 'Running' ? 'running' : 'pending';
            existingSession.podIP = pod.status?.podIP;
            await this.sessionStore.set(existingSessionId, existingSession);
            continue;
          }
        }

        // Permanent pod exists but no session record - create one
        const sessionId = pod.metadata?.labels?.['openagentic.io/session-id'] || `recovered-${Date.now()}`;
        const serviceName = `${podName}-svc`;

        const session: K8sSession = {
          sessionId,
          userId,
          podName,
          serviceName,
          status: phase === 'Running' ? 'running' : 'pending',
          podIP: pod.status?.podIP,
          servicePort: 3060,
          createdAt: new Date(pod.metadata?.creationTimestamp || '').getTime(),
          lastActivity: Date.now(),
          workspacePath: `/workspaces/${userId}`,
          healthChecksPassed: 0,
          consecutiveHealthFailures: 0,
        };

        await this.sessionStore.set(sessionId, session);
        await this.sessionStore.setUserSession(userId, sessionId);
        recoveredFromK8s++;
        loggers.k8s.info({ podName, userId }, "Recovered permanent pod");
      }

      // Handle stale session records (pod doesn't exist anymore)
      // Just remove the session record - don't try to delete anything
      for (const session of redisSessions) {
        if (!k8sPodNames.has(session.podName)) {
          loggers.k8s.info({ sessionId: session.sessionId, podName: session.podName }, "Stale session record, removing");
          await this.sessionStore.delete(session.sessionId);
          await this.sessionStore.deleteUserSession(session.userId);
          staleSessions++;
          // NOTE: Pod is NOT deleted - it's already gone or we shouldn't delete permanent pods
        }
      }

      loggers.k8s.info({ recovered: recoveredFromK8s, stale: staleSessions }, "Sync complete");
    } catch (error) {
      loggers.k8s.error({ err: error }, 'Error syncing with cluster');
    }
  }

  // ============================================================================
  // WARM POOL MANAGEMENT
  // Pre-spawn containers for instant code mode availability
  // ============================================================================

  /**
   * Initialize warm pool - called on manager startup
   */
  async initializeWarmPool(): Promise<void> {
    const warmPool = this.k8sConfig.warmPool;
    if (!warmPool?.enabled) {
      loggers.k8s.info('Warm pool disabled');
      return;
    }

    loggers.k8s.info({ minReady: warmPool.minReady, maxReady: warmPool.maxReady }, "Initializing warm pool");
    await this.ensureWarmPool();

    // Start background maintenance loop
    this.startWarmPoolMaintenance();
  }

  /**
   * Ensure minimum warm containers are available
   */
  async ensureWarmPool(): Promise<void> {
    const warmPool = this.k8sConfig.warmPool;
    if (!warmPool?.enabled) return;

    try {
      const warmContainers = await this.getWarmContainers();
      const currentCount = warmContainers.length;

      if (currentCount < warmPool.minReady) {
        const toCreate = warmPool.minReady - currentCount;
        loggers.k8s.info({ toCreate, currentCount }, "Warm pool needs more containers");

        for (let i = 0; i < toCreate; i++) {
          await this.createWarmContainer().catch(err => {
            loggers.k8s.error({ err: err.message }, 'Failed to create warm container');
          });
        }
      }
    } catch (error) {
      loggers.k8s.error({ err: error }, 'Error ensuring warm pool');
    }
  }

  /**
   * Create a warm container (no user assigned)
   */
  async createWarmContainer(): Promise<string> {
    const warmId = `warm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const podName = `openagentic-warm-${warmId}`;

    loggers.k8s.info({ podName }, "Creating warm container");

    const pod: k8s.V1Pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: podName,
        namespace: this.namespace,
        labels: {
          app: 'openagentic-runner',
          'openagentic.io/warm': 'true',
          'openagentic.io/warm-id': warmId,
          'openagentic.io/managed-by': 'openagentic-manager',
        },
      },
      spec: {
        restartPolicy: 'Never',
        terminationGracePeriodSeconds: 30,
        imagePullSecrets: this.k8sConfig.imagePullSecrets?.map(name => ({ name })),
        securityContext: {
          runAsUser: 0,
          runAsGroup: 0,
          fsGroup: 0,
        },
        containers: [
          {
            name: 'runner',
            image: this.runnerImage,
            imagePullPolicy: 'Always',
            ports: [
              { containerPort: 3060, name: 'http', protocol: 'TCP' },
              { containerPort: 3100, name: 'code-server', protocol: 'TCP' },
            ],
            env: [
              { name: 'PORT', value: '3060' },
              { name: 'WARM_MODE', value: 'true' },
              { name: 'WORKSPACES_PATH', value: '/workspaces' },
              { name: 'SANDBOX_ENABLED', value: 'true' },
              { name: 'SANDBOX_UID_MIN', value: '10000' },
              { name: 'SANDBOX_UID_MAX', value: '60000' },
              // LLM PROVIDER: MUST use API mode - NO hardcoded providers
              { name: 'LLM_PROVIDER', value: 'api' },
              { name: 'OPENAGENTIC_API_ENDPOINT', value: config.openagenticApiEndpoint },
              // OPENAGENTIC_BASE_URL is what the openagentic CLI v2 actually reads
              { name: 'OPENAGENTIC_BASE_URL', value: config.openagenticApiEndpoint },
              { name: 'DEFAULT_MODEL', value: config.defaultModel || '' },
              { name: 'INTERNAL_API_KEY', value: config.internalApiKey },
              // Storage config
              { name: 'STORAGE_PROVIDER', value: config.storage.provider },
              { name: 'STORAGE_BUCKET', value: config.storage.bucket },
              { name: 'STORAGE_ENDPOINT', value: config.storage.endpoint || '' },
              { name: 'STORAGE_REGION', value: config.storage.region || 'us-east-1' },
              { name: 'STORAGE_ACCESS_KEY', value: config.storage.accessKeyId || '' },
              { name: 'STORAGE_SECRET_KEY', value: config.storage.secretAccessKey || '' },
            ],
            // Burstable — requests only, NO memory/cpu limits. See
            // config.ts runnerResources for the rationale.
            resources: this.k8sConfig.runnerResources || {
              requests: { cpu: '200m', memory: '512Mi' },
            },
            // Security context for sandboxing + FUSE mounts (s3fs for MinIO)
            securityContext: {
              runAsUser: 0,
              runAsGroup: 0,
              privileged: true, // Required for s3fs FUSE mount
              capabilities: {
                drop: ['ALL'],
                add: ['SETUID', 'SETGID', 'CHOWN', 'DAC_OVERRIDE', 'SYS_ADMIN'],
              },
            },
            // Mount /dev/fuse for s3fs
            volumeMounts: [
              {
                name: 'fuse-device',
                mountPath: '/dev/fuse',
              },
            ],
            // Probes - PERMANENT PODS: Very lenient to prevent killing
            readinessProbe: {
              httpGet: { path: '/health', port: 3060 as any },
              initialDelaySeconds: 60,
              periodSeconds: 60,
              timeoutSeconds: 30,
              failureThreshold: 100,
            },
            // DISABLED liveness probe - pods are permanent
          },
        ],
        nodeSelector: this.k8sConfig.nodeSelector,
        tolerations: this.k8sConfig.tolerations,
        // Volumes for FUSE mount support
        volumes: [
          {
            name: 'fuse-device',
            hostPath: {
              path: '/dev/fuse',
              type: 'CharDevice',
            },
          },
        ],
      },
    };

    await this.coreApi.createNamespacedPod(this.namespace, pod);
    loggers.k8s.info({ podName }, "Created warm container");

    // Wait for it to be ready
    await this.waitForPodReady(podName).catch(err => {
      loggers.k8s.error({ podName, err: err.message }, "Warm container failed to become ready");
    });

    return podName;
  }

  /**
   * Get list of warm containers
   */
  async getWarmContainers(): Promise<k8s.V1Pod[]> {
    try {
      const pods = await this.coreApi.listNamespacedPod(
        this.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        'openagentic.io/warm=true'
      );
      return (pods.body.items || []).filter((pod: k8s.V1Pod) =>
        pod.status?.phase === 'Running' || pod.status?.phase === 'Pending'
      );
    } catch (error) {
      loggers.k8s.error({ err: error }, 'Error listing warm containers');
      return [];
    }
  }

  /**
   * Claim a warm container for a user session
   * Returns the claimed session or null if no warm container available
   */
  async claimWarmContainer(options: CreateK8sSessionOptions): Promise<K8sSession | null> {
    const warmContainers = await this.getWarmContainers();
    const readyWarm = warmContainers.find(pod => pod.status?.phase === 'Running');

    if (!readyWarm || !readyWarm.metadata?.name) {
      loggers.k8s.info('No warm container available to claim');
      return null;
    }

    const { sessionId, userId, userEmail, workspacePath, model, apiKey } = options;
    const podName = readyWarm.metadata.name;
    const serviceName = `${podName}-svc`;

    loggers.k8s.info({ podName, userId }, "Claiming warm container");

    // Update pod labels to mark as claimed
    const patch = [
      { op: 'remove', path: '/metadata/labels/openagentic.io~1warm' },
      { op: 'add', path: '/metadata/labels/openagentic.io~1session-id', value: sessionId },
      { op: 'add', path: '/metadata/labels/openagentic.io~1user-id', value: userId },
    ];

    await this.coreApi.patchNamespacedPod(
      podName,
      this.namespace,
      patch,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { headers: { 'Content-Type': 'application/json-patch+json' } }
    );

    // Create service for the pod
    const session: K8sSession = {
      sessionId,
      userId,
      podName,
      serviceName,
      status: 'running',
      podIP: readyWarm.status?.podIP,
      servicePort: 3060,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      workspacePath: workspacePath || `/workspaces/${userId}`,
      healthChecksPassed: 0,
      consecutiveHealthFailures: 0,
    };

    await this.createRunnerService(session);

    // Get service IP
    const service = await this.coreApi.readNamespacedService(serviceName, this.namespace);
    session.serviceIP = service.body.spec?.clusterIP;

    await this.sessionStore.set(sessionId, session);
    await this.sessionStore.setUserSession(userId, sessionId);

    // Configure the container for this user (set env vars, workspace path)
    await this.configureClaimedContainer(session, { model, apiKey, userEmail });

    // Replenish the warm pool
    this.ensureWarmPool().catch(err => loggers.k8s.error({ err }, "Failed to ensure warm pool"));

    loggers.k8s.info({ podName, sessionId }, "Claimed warm container");
    return session;
  }

  /**
   * Create a session on the claimed warm container
   * Calls POST /sessions on the exec container to spawn the openagentic-cli PTY
   */
  private async configureClaimedContainer(
    session: K8sSession,
    options: { model?: string; apiKey?: string; userEmail?: string }
  ): Promise<void> {
    // Use pod IP directly for immediate connectivity (avoids DNS propagation delay)
    // Fall back to service DNS if pod IP is not available
    const baseUrl = session.podIP
      ? `http://${session.podIP}:${session.servicePort}`
      : `http://${session.serviceName}.${this.namespace}.svc.cluster.local:${session.servicePort}`;
    const apiEndpoint = process.env.OPENAGENTIC_API_ENDPOINT || 'http://openagentic-api:8000';

    loggers.k8s.info({ baseUrl }, "Creating session on container");

    // Retry logic for transient failures
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(`${baseUrl}/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Api-Key': config.internalApiKey,
          },
          body: JSON.stringify({
            sessionId: session.sessionId,
            userId: session.userId,
            userEmail: options.userEmail,  // For Linux username
            workspacePath: session.workspacePath,
            model: options.model,
            apiKey: options.apiKey,
            apiEndpoint,
          }),
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json() as { pid?: number; sessionId?: string };
        loggers.k8s.info({ pid: result.pid }, "Session created on container");
        return; // Success
      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;
        const isRetryable = error.cause?.code === 'ECONNREFUSED' ||
                           error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
                           error.name === 'TimeoutError';

        if (isLastAttempt || !isRetryable) {
          loggers.k8s.error({ attempt, maxRetries, err: error }, "Failed to create session on container");
          throw error;
        }

        const delay = baseDelay * attempt;
        loggers.k8s.warn({ attempt, maxRetries, delayMs: delay }, "Connection failed, retrying");
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Start background warm pool maintenance loop
   */
  private startWarmPoolMaintenance(): void {
    const warmPool = this.k8sConfig.warmPool;
    if (!warmPool?.enabled) return;

    // Check every 30 seconds
    setInterval(async () => {
      try {
        // Ensure minimum containers
        await this.ensureWarmPool();

        // Clean up old warm containers that exceed idle timeout
        const warmContainers = await this.getWarmContainers();
        const now = Date.now();

        for (const pod of warmContainers) {
          const createdAt = new Date(pod.metadata?.creationTimestamp || '').getTime();
          const ageSeconds = (now - createdAt) / 1000;

          if (ageSeconds > warmPool.idleTimeout && warmContainers.length > warmPool.minReady) {
            loggers.k8s.info({ podName: pod.metadata?.name }, "Recycling idle warm container");
            await this.coreApi.deleteNamespacedPod(pod.metadata!.name!, this.namespace).catch(err => loggers.k8s.error({ podName: pod.metadata?.name, err }, 'Failed to delete warm container'));
          }
        }
      } catch (error) {
        loggers.k8s.error({ err: error }, 'Warm pool maintenance error');
      }
    }, 30000);
  }

  // ============================================================================
  // ADMIN OPERATIONS - For administrative management and auditing
  // ============================================================================

  /**
   * Get pod logs for a session
   * Returns container logs for debugging and auditing
   */
  async getPodLogs(sessionId: string, options?: {
    tailLines?: number;
    sinceSeconds?: number;
    container?: string;
  }): Promise<{ logs: string; podName: string }> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const response = await this.coreApi.readNamespacedPodLog(
        session.podName,
        this.namespace,
        options?.container || 'openagentic-exec',
        undefined, // follow
        undefined, // insecureSkipTLSVerifyBackend
        undefined, // limitBytes
        undefined, // pretty
        undefined, // previous
        options?.sinceSeconds,
        options?.tailLines || 500,
        undefined  // timestamps
      );

      return {
        logs: response.body || '',
        podName: session.podName,
      };
    } catch (error: any) {
      loggers.k8s.error({ podName: session.podName, err: error }, "Failed to get pod logs");
      throw new Error(`Failed to get pod logs: ${error.message}`);
    }
  }

  /**
   * Get all exec container pods (both active sessions and warm pool)
   * Returns detailed pod information for admin dashboard
   */
  async getAllPods(): Promise<Array<{
    podName: string;
    sessionId?: string;
    userId?: string;
    status: string;
    phase: string;
    nodeName?: string;
    podIP?: string;
    startTime?: string;
    type: 'session' | 'warm';
    containers: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
      state: string;
    }>;
    resourceUsage?: {
      cpuRequest?: string;
      memoryRequest?: string;
      cpuLimit?: string;
      memoryLimit?: string;
    };
  }>> {
    try {
      const pods = await this.coreApi.listNamespacedPod(
        this.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        'app=openagentic-runner'  // Match pods with app=openagentic-runner label
      );

      return (pods.body.items || []).map((pod: k8s.V1Pod) => {
        const sessionId = pod.metadata?.labels?.['openagentic.io/session-id'];
        const userId = pod.metadata?.labels?.['openagentic.io/user-id'];
        const isWarm = pod.metadata?.labels?.['openagentic.io/pool'] === 'warm';

        const containerStatuses = pod.status?.containerStatuses || [];
        const containers = containerStatuses.map((cs: k8s.V1ContainerStatus) => {
          let state = 'unknown';
          if (cs.state?.running) state = 'running';
          else if (cs.state?.waiting) state = `waiting: ${cs.state.waiting.reason || 'unknown'}`;
          else if (cs.state?.terminated) state = `terminated: ${cs.state.terminated.reason || 'unknown'}`;

          return {
            name: cs.name,
            ready: cs.ready,
            restartCount: cs.restartCount,
            state,
          };
        });

        const container = pod.spec?.containers?.[0];
        const resourceUsage = container?.resources ? {
          cpuRequest: container.resources.requests?.cpu,
          memoryRequest: container.resources.requests?.memory,
          cpuLimit: container.resources.limits?.cpu,
          memoryLimit: container.resources.limits?.memory,
        } : undefined;

        return {
          podName: pod.metadata?.name || '',
          sessionId: sessionId || undefined,
          userId: userId || undefined,
          status: pod.status?.phase === 'Running' ? 'running' : pod.status?.phase?.toLowerCase() || 'unknown',
          phase: pod.status?.phase || 'Unknown',
          nodeName: pod.spec?.nodeName,
          podIP: pod.status?.podIP,
          startTime: pod.metadata?.creationTimestamp?.toISOString(),
          type: isWarm ? 'warm' : 'session',
          containers,
          resourceUsage,
        };
      });
    } catch (error: any) {
      loggers.k8s.error({ err: error }, 'Failed to list pods');
      throw new Error(`Failed to list pods: ${error.message}`);
    }
  }

  /**
   * Get detailed pod information for auditing
   */
  async getDetailedPodInfo(sessionId: string): Promise<{
    pod: {
      name: string;
      namespace: string;
      uid: string;
      creationTimestamp: string;
      labels: Record<string, string>;
      annotations: Record<string, string>;
    };
    spec: {
      nodeName?: string;
      nodeSelector?: Record<string, string>;
      serviceAccountName?: string;
      containers: Array<{
        name: string;
        image: string;
        command?: string[];
        env?: Array<{ name: string; value?: string }>;
        resources?: any;
        ports?: Array<{ containerPort: number; protocol: string }>;
      }>;
    };
    status: {
      phase: string;
      hostIP?: string;
      podIP?: string;
      startTime?: string;
      conditions: Array<{
        type: string;
        status: string;
        lastTransitionTime?: string;
        reason?: string;
      }>;
      containerStatuses: Array<{
        name: string;
        ready: boolean;
        restartCount: number;
        started: boolean;
        state: any;
      }>;
    };
    session: K8sSession | null;
  }> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const response = await this.coreApi.readNamespacedPod(session.podName, this.namespace);
      const pod = response.body;

      return {
        pod: {
          name: pod.metadata?.name || '',
          namespace: pod.metadata?.namespace || '',
          uid: pod.metadata?.uid || '',
          creationTimestamp: pod.metadata?.creationTimestamp?.toISOString() || '',
          labels: pod.metadata?.labels || {},
          annotations: pod.metadata?.annotations || {},
        },
        spec: {
          nodeName: pod.spec?.nodeName,
          nodeSelector: pod.spec?.nodeSelector,
          serviceAccountName: pod.spec?.serviceAccountName,
          containers: (pod.spec?.containers || []).map((c: k8s.V1Container) => ({
            name: c.name,
            image: c.image || '',
            command: c.command,
            env: c.env?.map((e: k8s.V1EnvVar) => ({ name: e.name, value: e.value })),
            resources: c.resources,
            ports: c.ports?.map((p: k8s.V1ContainerPort) => ({ containerPort: p.containerPort, protocol: p.protocol || 'TCP' })),
          })),
        },
        status: {
          phase: pod.status?.phase || 'Unknown',
          hostIP: pod.status?.hostIP,
          podIP: pod.status?.podIP,
          startTime: pod.status?.startTime?.toISOString(),
          conditions: (pod.status?.conditions || []).map((c: k8s.V1PodCondition) => ({
            type: c.type,
            status: c.status,
            lastTransitionTime: c.lastTransitionTime?.toISOString(),
            reason: c.reason,
          })),
          containerStatuses: (pod.status?.containerStatuses || []).map((cs: k8s.V1ContainerStatus) => ({
            name: cs.name,
            ready: cs.ready,
            restartCount: cs.restartCount,
            started: cs.started || false,
            state: cs.state,
          })),
        },
        session,
      };
    } catch (error: any) {
      loggers.k8s.error({ podName: session.podName, err: error }, "Failed to get pod info");
      throw new Error(`Failed to get pod info: ${error.message}`);
    }
  }

  /**
   * Force restart a pod (delete and let it recreate if session still active)
   */
  async restartPod(sessionId: string): Promise<{ success: boolean; message: string }> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    loggers.k8s.info({ podName: session.podName, sessionId }, "Admin restarting pod");

    try {
      // Delete the pod (Kubernetes will handle cleanup)
      await this.coreApi.deleteNamespacedPod(session.podName, this.namespace);

      // Remove from session store - it will need to be recreated
      await this.sessionStore.delete(sessionId);
      await this.sessionStore.deleteUserSession(session.userId);
      this.disconnectTerminal(sessionId);

      return {
        success: true,
        message: `Pod ${session.podName} deleted. Session will need to be recreated.`,
      };
    } catch (error: any) {
      loggers.k8s.error({ podName: session.podName, err: error }, "Failed to restart pod");
      throw new Error(`Failed to restart pod: ${error.message}`);
    }
  }

  /**
   * Force delete a warm container
   */
  async deleteWarmContainer(podName: string): Promise<{ success: boolean; message: string }> {
    if (!podName.startsWith('openagentic-warm-')) {
      throw new Error('Not a warm container pod');
    }

    loggers.k8s.info({ podName }, "Admin deleting warm container");

    try {
      await this.coreApi.deleteNamespacedPod(podName, this.namespace);
      return {
        success: true,
        message: `Warm container ${podName} deleted.`,
      };
    } catch (error: any) {
      loggers.k8s.error({ podName, err: error }, "Failed to delete warm container");
      throw new Error(`Failed to delete warm container: ${error.message}`);
    }
  }

  /**
   * Get events for a session's pod (for auditing)
   */
  async getPodEvents(sessionId: string): Promise<Array<{
    type: string;
    reason: string;
    message: string;
    firstTimestamp?: string;
    lastTimestamp?: string;
    count: number;
  }>> {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const events = await this.coreApi.listNamespacedEvent(
        this.namespace,
        undefined,
        undefined,
        undefined,
        `involvedObject.name=${session.podName}`
      );

      return (events.body.items || []).map((event: k8s.CoreV1Event) => ({
        type: event.type || 'Normal',
        reason: event.reason || 'Unknown',
        message: event.message || '',
        firstTimestamp: event.firstTimestamp?.toISOString(),
        lastTimestamp: event.lastTimestamp?.toISOString(),
        count: event.count || 1,
      }));
    } catch (error: any) {
      loggers.k8s.error({ podName: session.podName, err: error }, "Failed to get pod events");
      throw new Error(`Failed to get pod events: ${error.message}`);
    }
  }
}

// Singleton instance
let k8sSessionManagerInstance: K8sSessionManager | null = null;

export function getK8sSessionManager(): K8sSessionManager {
  if (!k8sSessionManagerInstance) {
    k8sSessionManagerInstance = new K8sSessionManager();
  }
  return k8sSessionManagerInstance;
}
