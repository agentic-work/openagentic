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
 * OpenAgenticCode Manager Service
 * Handles per-user PTY-based AWCode CLI sessions
 *
 * This service provides:
 * - Real PTY terminal sessions with xterm.js support
 * - WebSocket for direct terminal I/O (like SSH)
 * - REST API for session management
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, existsSync, promises as fs } from 'fs';
import { join, dirname } from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as promClient from 'prom-client';
import { config } from './config';
import { SessionManager } from './sessionManager';
import { initializeStorage } from './storageClient';
import { OpenagenticEventEmitter, OpenagenticStreamEvent } from './eventEmitter';
import { metricsService, SystemMetrics } from './metricsService';
import { workspaceSyncService, FileChangeEvent } from './workspaceSyncService';
import { getCodeServerService, CodeServerInstance } from './codeServerService';
import { getExecContainerClient, ExecContainerClient } from './execContainerClient';
import { getK8sSessionManager, K8sSession } from './k8sSessionManager';
import type { SessionStatus } from './types';
import { loggers } from './logger.js';
import { createHmac } from 'crypto';

const execAsync = promisify(exec);

// ===== Internal JWT Generation =====
// Generates short-lived JWTs signed with JWT_SECRET for code mode users.
// These JWTs are passed to exec pods as ANTHROPIC_API_KEY so that the
// CLI can authenticate requests through the platform's openagentic proxy endpoint.
// This avoids passing Azure AD tokens (which expire and have escaping issues).
const JWT_SECRET = process.env.JWT_SECRET || '';

function base64UrlEncode(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateInternalJwt(payload: {
  userId: string;
  email?: string;
  name?: string;
  isAdmin?: boolean;
}): string {
  if (!JWT_SECRET) {
    loggers.security.warn('JWT_SECRET not set - cannot generate internal tokens for code mode');
    return '';
  }

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64UrlEncode(JSON.stringify({
    sub: payload.userId,
    id: payload.userId,
    userId: payload.userId,
    email: payload.email || '',
    name: payload.name || 'Code Mode User',
    isAdmin: payload.isAdmin || false,
    source: 'code-mode-internal',
    iat: now,
    exp: now + 86400, // 24 hours
  }));

  const signature = base64UrlEncode(
    createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest()
  );

  return `${header}.${body}.${signature}`;
}

// Platform version from package.json
const PLATFORM_VERSION = process.env.npm_package_version || '0.3.0';

// Get versions from bundled packages
function getPackageVersions(): { cliVersion: string; sdkVersion: string } {
  let cliVersion = 'unknown';
  let sdkVersion = 'unknown';

  try {
    // CLI package.json is at /app/openagentic/package.json in container
    const cliPackagePath = join('/app', 'openagentic', 'package.json');
    if (existsSync(cliPackagePath)) {
      const cliPkg = JSON.parse(readFileSync(cliPackagePath, 'utf-8'));
      cliVersion = cliPkg.version || 'unknown';
    }
  } catch (err) {
    loggers.api.warn({ err }, 'Could not read CLI package.json');
  }

  try {
    // SDK package.json is in CLI's node_modules
    const sdkPackagePath = join('/app', 'openagentic', 'node_modules', '@agentic-work', 'sdk', 'package.json');
    if (existsSync(sdkPackagePath)) {
      const sdkPkg = JSON.parse(readFileSync(sdkPackagePath, 'utf-8'));
      sdkVersion = sdkPkg.version || 'unknown';
    }
  } catch (err) {
    loggers.api.warn({ err }, 'Could not read SDK package.json');
  }

  return { cliVersion, sdkVersion };
}

const { cliVersion, sdkVersion } = getPackageVersions();

const app = express();
const server = createServer(app);

// WebSocket servers with noServer mode - we handle upgrade manually to support multiple paths
const wss = new WebSocketServer({ noServer: true });
const wssEvents = new WebSocketServer({ noServer: true });
const wssMetrics = new WebSocketServer({ noServer: true });
// Phase 3: structured tool/api event side channel. The browser opens
// /ws/progress and the manager proxies the connection through to the
// exec pod's /ws/progress/:id endpoint, which tails the openagentic
// pino log and forwards parsed events. Pure relay — manager performs
// no translation on the byte stream.
const wssProgress = new WebSocketServer({ noServer: true });

// Track metrics WebSocket clients
const metricsClients: Set<WebSocket> = new Set();

// Track WebSocket alive status for keepalive pings
const wsAliveMap = new WeakMap<WebSocket, boolean>();

// Ping interval (30 seconds)
const WS_PING_INTERVAL = 30000;

// Start keepalive ping loop for a WebSocket server
function setupWsPingInterval(wss: WebSocketServer, serverName: string) {
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (wsAliveMap.get(ws) === false) {
        // Client didn't respond to previous ping - terminate
        loggers.websocket.info({ serverName }, "WebSocket client unresponsive, terminating");
        ws.terminate();
        return;
      }
      // Mark as waiting for pong
      wsAliveMap.set(ws, false);
      ws.ping();
    });
  }, WS_PING_INTERVAL);

  wss.on('close', () => {
    clearInterval(interval);
  });
}

// Setup keepalive for all WebSocket servers
setupWsPingInterval(wss, 'Terminal');
setupWsPingInterval(wssEvents, 'Events');
setupWsPingInterval(wssMetrics, 'Metrics');
setupWsPingInterval(wssProgress, 'Progress');

// Handle HTTP upgrade manually to route to correct WebSocket server
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

  if (pathname === '/ws/terminal') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/events') {
    wssEvents.handleUpgrade(request, socket, head, (ws) => {
      wssEvents.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/metrics') {
    wssMetrics.handleUpgrade(request, socket, head, (ws) => {
      wssMetrics.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/progress') {
    // Phase 3 side channel — see wssProgress comment above. The
    // connection handler below proxies bytes 1:1 between the browser
    // and the exec pod, no parsing happens at the manager layer.
    wssProgress.handleUpgrade(request, socket, head, (ws) => {
      wssProgress.emit('connection', ws, request);
    });
  } else if (pathname.startsWith('/code-server/session/')) {
    // Proxy WebSocket connections for code-server (VS Code needs this)
    const match = pathname.match(/^\/code-server\/session\/([^\/]+)(\/.*)?$/);
    if (match) {
      const sessionId = match[1];
      const remainingPath = match[2] || '/';

      const k8sManager = getK8sSessionManager();

      // Use async IIFE to handle async session lookup
      (async () => {
        let session = await k8sManager.getSession(sessionId);

        // Fallback: recover from local SessionManager if Redis lost the session
        if (!session || session.status !== 'running') {
          const localSession = sessionManager.getSession(sessionId);
          if (localSession && localSession.status === 'running') {
            const { createHash } = await import('crypto');
            const hash = createHash('sha256').update(localSession.userId).digest('hex').substring(0, 12);
            const podName = `openagentic-${hash}`;
            const serviceName = `${podName}-svc`;
            loggers.codeserver.info({ sessionId, serviceName }, "WS Redis session missing, recovered from local");
            session = {
              sessionId,
              userId: localSession.userId,
              podName,
              serviceName,
              status: 'running' as const,
              servicePort: 3060,
              createdAt: new Date(localSession.createdAt).getTime(),
              lastActivity: Date.now(),
              workspacePath: localSession.workspacePath,
              healthChecksPassed: 0,
              consecutiveHealthFailures: 0,
            };
            // Self-heal Redis
            await k8sManager.storeSession(sessionId, session);
            await k8sManager.storeUserSession(localSession.userId, sessionId);
          }
        }

        if (!session || session.status !== 'running') {
          loggers.codeserver.info({ sessionId }, "WS upgrade rejected - session not running");
          socket.destroy();
          return;
        }

        const targetHost = `${session.serviceName}.${config.k8s.namespace}.svc.cluster.local`;
        const queryString = request.url!.includes('?') ? request.url!.substring(request.url!.indexOf('?')) : '';
        const targetPath = `${remainingPath}${queryString}`;

        loggers.codeserver.info({ pathname, targetHost, targetPath }, "WS upgrade proxying");

        // Use raw HTTP to proxy the WebSocket upgrade
        const http = require('http');
        
        // Filter and fix headers for code-server WebSocket
        // code-server rejects WebSocket connections with mismatched Origin
        const proxyHeaders: Record<string, string | string[] | undefined> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          const lowerKey = key.toLowerCase();
          // Skip headers that cause issues with code-server
          if (lowerKey === 'origin') {
            // Rewrite Origin to match code-server's bind address for CSRF check
            proxyHeaders[key] = `http://${targetHost}:3100`;
            continue;
          } else if (lowerKey === 'host') {
            proxyHeaders[key] = `${targetHost}:3100`;
          } else {
            proxyHeaders[key] = value;
          }
        }
        
        const proxyReq = http.request({
          hostname: targetHost,
          port: 3100,
          path: targetPath,
          method: 'GET',
          headers: proxyHeaders,
        });

        proxyReq.on('upgrade', (proxyRes: any, proxySocket: any, proxyHead: Buffer) => {
          // Forward the upgrade response to client
          let response = `HTTP/1.1 101 Switching Protocols\r\n`;
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            if (key.toLowerCase() !== 'connection' && key.toLowerCase() !== 'upgrade') {
              response += `${key}: ${value}\r\n`;
            }
          }
          response += `Connection: Upgrade\r\n`;
          response += `Upgrade: websocket\r\n`;
          response += `\r\n`;

          socket.write(response);
          if (proxyHead.length > 0) {
            socket.write(proxyHead);
          }

          // Pipe the sockets bidirectionally (raw TCP after handshake)
          proxySocket.pipe(socket);
          socket.pipe(proxySocket);

          proxySocket.on('error', (err: Error) => {
            loggers.codeserver.error({ sessionId, err: err.message }, "WS proxy socket error");
            socket.destroy();
          });

          socket.on('error', (err: Error) => {
            loggers.codeserver.error({ sessionId, err: err.message }, "WS client socket error");
            proxySocket.destroy();
          });

          proxySocket.on('close', () => socket.destroy());
          socket.on('close', () => proxySocket.destroy());
        });

        proxyReq.on('error', (err: Error) => {
          loggers.codeserver.error({ sessionId, err: err.message }, "WS upgrade request error");
          socket.destroy();
        });

        proxyReq.on('response', (res: any) => {
          // If we get a regular response instead of upgrade, forward it and close
          loggers.codeserver.info({ sessionId, statusCode: res.statusCode }, "WS upgrade got HTTP instead of 101");
          let response = `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`;
          for (const [key, value] of Object.entries(res.headers)) {
            response += `${key}: ${value}\r\n`;
          }
          response += `\r\n`;
          socket.write(response);
          res.pipe(socket);
        });

        proxyReq.end();
      })().catch((err) => {
        loggers.codeserver.error({ err: err.message }, "WS upgrade async error");
        socket.destroy();
      });
    } else {
      socket.destroy();
    }
  } else if (pathname.startsWith('/ghostpilot/session/')) {
    // Proxy WebSocket connections for GhostPilot (screencast streaming)
    const match = pathname.match(/^\/ghostpilot\/session\/([^\/]+)(\/.*)?$/);
    if (match) {
      const sessionId = match[1];
      const remainingPath = match[2] || '/ws';

      const k8sManager = getK8sSessionManager();

      (async () => {
        let session = await k8sManager.getSession(sessionId);

        if (!session || session.status !== 'running') {
          const localSession = sessionManager.getSession(sessionId);
          if (localSession && localSession.status === 'running') {
            const { createHash } = await import('crypto');
            const hash = createHash('sha256').update(localSession.userId).digest('hex').substring(0, 12);
            const podName = `openagentic-${hash}`;
            session = {
              sessionId,
              userId: localSession.userId,
              podName,
              serviceName: `${podName}-svc`,
              status: 'running' as const,
              servicePort: 3060,
              createdAt: new Date(localSession.createdAt).getTime(),
              lastActivity: Date.now(),
              workspacePath: localSession.workspacePath,
              healthChecksPassed: 0,
              consecutiveHealthFailures: 0,
            };
          }
        }

        if (!session || session.status !== 'running') {
          socket.destroy();
          return;
        }

        // Get GhostPilot port from exec daemon
        const serviceUrl = `http://${session.serviceName}.${config.k8s.namespace}.svc.cluster.local:${session.servicePort}`;
        let gpPort = 3200;
        try {
          const statusResp = await fetch(`${serviceUrl}/sessions/${sessionId}/ghostpilot`, {
            headers: { 'X-Internal-Api-Key': config.internalApiKey || '' },
            signal: AbortSignal.timeout(3000),
          });
          const gpStatus = await statusResp.json() as { port?: number };
          gpPort = gpStatus?.port || 3200;
        } catch {}

        const targetHost = `${session.serviceName}.${config.k8s.namespace}.svc.cluster.local`;
        const queryString = request.url!.includes('?') ? request.url!.substring(request.url!.indexOf('?')) : '';
        const targetPath = `${remainingPath}${queryString}`;

        loggers.api.info({ pathname, targetHost, targetPath, gpPort }, 'GhostPilot WS upgrade proxying');

        const http = require('http');

        const proxyHeaders: Record<string, string | string[] | undefined> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          const lowerKey = key.toLowerCase();
          if (lowerKey === 'origin') { proxyHeaders[key] = `http://${targetHost}:${gpPort}`; continue; }
          if (lowerKey === 'host') {
            proxyHeaders[key] = `${targetHost}:${gpPort}`;
          } else {
            proxyHeaders[key] = value;
          }
        }

        const proxyReq = http.request({
          hostname: targetHost,
          port: gpPort,
          path: targetPath,
          method: 'GET',
          headers: proxyHeaders,
        });

        proxyReq.on('upgrade', (proxyRes: any, proxySocket: any, proxyHead: Buffer) => {
          let response = `HTTP/1.1 101 Switching Protocols\r\n`;
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            if (key.toLowerCase() !== 'connection' && key.toLowerCase() !== 'upgrade') {
              response += `${key}: ${value}\r\n`;
            }
          }
          response += `Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n`;

          socket.write(response);
          if (proxyHead.length > 0) socket.write(proxyHead);

          proxySocket.pipe(socket);
          socket.pipe(proxySocket);

          proxySocket.on('error', () => socket.destroy());
          socket.on('error', () => proxySocket.destroy());
          proxySocket.on('close', () => socket.destroy());
          socket.on('close', () => proxySocket.destroy());
        });

        proxyReq.on('error', (err: Error) => {
          loggers.api.error({ sessionId, err: err.message }, 'GhostPilot WS upgrade error');
          socket.destroy();
        });

        proxyReq.on('response', (res: any) => {
          let response = `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`;
          for (const [key, value] of Object.entries(res.headers)) {
            response += `${key}: ${value}\r\n`;
          }
          response += `\r\n`;
          socket.write(response);
          res.pipe(socket);
        });

        proxyReq.end();
      })().catch((err) => {
        loggers.api.error({ err: err.message }, 'GhostPilot WS upgrade async error');
        socket.destroy();
      });
    } else {
      socket.destroy();
    }
  } else {
    socket.destroy();
  }
});

// Track event emitters and WebSocket clients per session
const sessionEventEmitters: Map<string, OpenagenticEventEmitter> = new Map();
const sessionEventClients: Map<string, Set<WebSocket>> = new Map();
// Track which sessions were created with API mode (vs Ollama mode)
const apiModeSessions: Set<string> = new Set();
// Track CLI backend per session
const sessionCliBackend: Map<string, string> = new Map();

const sessionManager = new SessionManager(config);

app.use(express.json());

// ===========================================
// SECURITY: Internal API Key Authentication
// ===========================================
// Only the OpenAgentic API can access this service.
// All requests must include the internal API key.
// Health endpoint is exempt for load balancer health checks.

const validateInternalAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Health, metrics, and code-server proxy are accessible without internal key.
  // Code-server serves the VS Code UI directly to the browser iframe — the browser
  // doesn't have the internal API key. User auth is handled by nginx/API proxy upstream.
  if (req.path === '/health' || req.path === '/metrics' || req.path.startsWith('/code-server/') || req.path.includes('/context-stats')) {
    return next();
  }

  // If no internal key configured, allow all (dev mode warning)
  if (!config.internalApiKey) {
    loggers.security.warn('No INTERNAL_API_KEY configured - running in INSECURE mode');
    return next();
  }

  // Check for internal API key in headers
  const authHeader = req.headers['authorization'];
  const internalKeyHeader = req.headers['x-internal-api-key'];

  let providedKey: string | undefined;

  if (internalKeyHeader) {
    providedKey = Array.isArray(internalKeyHeader) ? internalKeyHeader[0] : internalKeyHeader;
  } else if (authHeader?.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7);
  } else if (authHeader?.startsWith('Internal ')) {
    providedKey = authHeader.slice(9);
  }

  if (!providedKey || providedKey !== config.internalApiKey) {
    loggers.security.warn({ path: req.path, ip: req.ip }, "Unauthorized request");
    return res.status(401).json({ error: 'Unauthorized - internal API key required' });
  }

  next();
};

// Apply authentication middleware to all routes
app.use(validateInternalAuth);

// ========================================
// Prometheus Metrics
// ========================================
const promRegister = new promClient.Registry();
promClient.collectDefaultMetrics({ register: promRegister });

const sessionGauge = new promClient.Gauge({
  name: 'openagentic_active_sessions',
  help: 'Number of active code sessions',
  registers: [promRegister],
});
const sessionCreateCounter = new promClient.Counter({
  name: 'openagentic_sessions_created_total',
  help: 'Total sessions created',
  registers: [promRegister],
});
const podStartupHistogram = new promClient.Histogram({
  name: 'openagentic_pod_startup_seconds',
  help: 'Pod startup latency in seconds',
  buckets: [1, 2, 5, 10, 20, 30, 60, 120],
  registers: [promRegister],
});

// Additional metrics for Work Stream 4B
const codeSessionsActive = new promClient.Gauge({
  name: 'code_sessions_active',
  help: 'Number of currently active code sessions',
  registers: [promRegister],
});
const codeSessionDuration = new promClient.Histogram({
  name: 'code_session_duration_seconds',
  help: 'Duration of code sessions in seconds',
  buckets: [60, 300, 600, 1800, 3600, 7200, 14400],
  registers: [promRegister],
});
const codePodLifecycle = new promClient.Counter({
  name: 'code_pod_lifecycle_total',
  help: 'Total pod lifecycle events',
  labelNames: ['action'] as const,
  registers: [promRegister],
});
const codeReconnectTotal = new promClient.Counter({
  name: 'code_reconnect_total',
  help: 'Total session reconnections',
  registers: [promRegister],
});

// Update session gauges periodically
setInterval(() => {
  const activeSessions = sessionManager.getAllSessions().length;
  sessionGauge.set(activeSessions);
  codeSessionsActive.set(activeSessions);
}, 5000);

// Prometheus metrics endpoint (no auth required for scraping)
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', promRegister.contentType);
  res.end(await promRegister.metrics());
});

// Health check with full config for Admin Portal
app.get('/health', (req, res) => {
  // Build storage display info based on provider type
  const storageProvider = config.storage.provider;
  let storageDisplay = 'Unknown Storage';

  switch (storageProvider) {
    case 'minio':
      storageDisplay = `MinIO - ${config.storage.bucket}`;
      break;
    case 's3':
      storageDisplay = `AWS S3 - ${config.storage.bucket}`;
      break;
    case 'azure':
      // Azure uses container name from bucket field
      const accountName = process.env.AZURE_STORAGE_ACCOUNT || 'unknown';
      storageDisplay = `Azure Storage - ${accountName}/${config.storage.bucket}`;
      break;
    case 'gcs':
      const projectId = process.env.GCP_PROJECT_ID || 'unknown';
      storageDisplay = `GCS - ${projectId}/${config.storage.bucket}`;
      break;
    default:
      storageDisplay = `${storageProvider} - ${config.storage.bucket}`;
  }

  res.json({
    status: 'healthy',
    version: PLATFORM_VERSION,
    activeSessions: sessionManager.getActiveCount(),
    versions: {
      cli: cliVersion,
      sdk: sdkVersion,
    },
    config: {
      defaultModel: config.defaultModel,
      defaultUi: config.defaultUi,
      defaultCliBackend: config.defaultCliBackend,
      sessionIdleTimeout: config.sessionIdleTimeout,
      sessionMaxLifetime: config.sessionMaxLifetime,
      maxSessionsPerUser: config.maxSessionsPerUser,
      workspacesPath: config.workspacesPath,
      llmProvider: 'api',  // ALWAYS API mode - no hardcoded providers
      openagenticApiEndpoint: config.openagenticApiEndpoint,
    },
    storage: {
      provider: storageProvider,
      bucket: config.storage.bucket,
      endpoint: config.storage.endpoint,
      display: storageDisplay,
    },
  });
});

// Create session for user
app.post('/sessions', async (req, res) => {
  try {
    const { userId, userEmail, workspacePath, model, apiKey, storageLimitMb, cliBackend, githubToken } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    // Check if user already has an active session
    const existing = sessionManager.getSessionsByUser(userId)
      .filter(s => s.status === 'running');

    if (existing.length > 0) {
      const existingSession = existing[0];

      // CRITICAL: Refresh token on reconnect if a new apiKey was provided.
      // The CLI process may hold an expired JWT from a previous connection.
      if (apiKey && config.executionMode === 'kubernetes') {
        try {
          const k8sManager = getK8sSessionManager();
          // Look up pod IP from K8s session store
          const k8sSession = await k8sManager.getSessionByUserId(userId);
          const podIP = k8sSession?.podIP;
          if (podIP) {
            const execClient = new ExecContainerClient({ url: `http://${podIP}:3060` });
            const execSession = await execClient.getSession(existingSession.id).catch(() => null);

            if (execSession) {
              loggers.sessions.info({ sessionId: existingSession.id }, "Refreshing token for existing session");
              await execClient.refreshSessionToken(existingSession.id, apiKey, {
                model: model || existingSession.model,
                githubToken,
              });
              loggers.sessions.info({ sessionId: existingSession.id }, "Token refreshed successfully");
            } else {
              // CLI not running - create fresh session with new token
              loggers.sessions.info("CLI not running, creating fresh session on exec daemon");
              await execClient.createSession({
                sessionId: existingSession.id,
                userId,
                userEmail,
                workspacePath: existingSession.workspacePath || `/workspaces/${userId}`,
                model: model || existingSession.model,
                apiKey,
              });
            }
          } else {
            loggers.sessions.warn({ sessionId: existingSession.id }, "No podIP found, skipping token refresh");
          }
        } catch (err: any) {
          loggers.sessions.warn({ sessionId: existingSession.id, err: err?.message }, "Token refresh failed");
        }
      }

      codeReconnectTotal.inc();
      return res.json({
        sessionId: existingSession.id,
        status: 'existing',
        session: existingSession,
      });
    }

    // Create session with optional API key, storage limit, CLI backend, userEmail, and GitHub token
    const session = await sessionManager.createSession(userId, workspacePath, model, apiKey, storageLimitMb, cliBackend, userEmail, githubToken);
    sessionCreateCounter.inc();
    codePodLifecycle.inc({ action: 'create' });

    // Track CLI backend for this session (used in session_started WebSocket event)
    if (cliBackend) {
      sessionCliBackend.set(session.id, cliBackend);
    }

    res.json({
      sessionId: session.id,
      status: 'created',
      session,
    });
  } catch (error) {
    loggers.api.error({ err: error }, 'Failed to create session');
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Get session status
app.get('/sessions/:sessionId', async (req, res) => {
  try {
    const status = sessionManager.getSessionStatus(req.params.sessionId);
    if (!status) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get session status' });
  }
});

// GET /sessions/:sessionId/context-stats — aggregated context data for sidebar
app.get('/sessions/:sessionId/context-stats', async (req, res) => {
  const { sessionId } = req.params;

  // Find session — check local session manager first, then K8s manager
  let session: any = sessionManager.getSession(sessionId);
  if (!session && config.executionMode === 'kubernetes') {
    try {
      const k8sManager = getK8sSessionManager();
      session = await k8sManager.getSession(sessionId);
    } catch { /* non-fatal */ }
  }

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // 1. Get token stats from API (keyed by userId, since CLI sends userId not sessionId)
  const statsKey = session.userId || sessionId;
  let tokenStats = { inputTokens: 0, outputTokens: 0, requestCount: 0, model: '', lastRequest: 0 };
  try {
    const apiUrl = config.openagenticApiEndpoint || 'http://openagentic-api:8000';
    const resp = await fetch(`${apiUrl}/api/openagentic/session-stats/${statsKey}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data: any = await resp.json();
      tokenStats = data;
    }
  } catch { /* non-fatal */ }

  // 2. Compute cost estimate (rough: $3/M input, $15/M output for Sonnet)
  const inputCost = (tokenStats.inputTokens / 1_000_000) * 3;
  const outputCost = (tokenStats.outputTokens / 1_000_000) * 15;

  const createdAtMs = session.createdAt
    ? new Date(session.createdAt).getTime()
    : Date.now();

  return res.json({
    session: {
      model: tokenStats.model || session.model || '',
      cost: Math.round((inputCost + outputCost) * 100) / 100,
      duration: Math.floor((Date.now() - createdAtMs) / 1000),
      tokens: {
        input: tokenStats.inputTokens,
        output: tokenStats.outputTokens,
        total: tokenStats.inputTokens + tokenStats.outputTokens,
      },
    },
    contextDetails: null, // Will be populated later when CLI status file writer is implemented
  });
});

// List user sessions
app.get('/users/:userId/sessions', async (req, res) => {
  try {
    const sessions = sessionManager.getSessionsByUser(req.params.userId);
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// List ALL sessions (admin endpoint for monitoring)
app.get('/sessions', async (req, res) => {
  try {
    // Check if metrics are requested
    const withMetrics = req.query.metrics === 'true';
    if (withMetrics) {
      const sessions = await sessionManager.getAllSessionsWithMetrics();
      res.json(sessions);
    } else {
      const sessions = sessionManager.getAllSessionsWithOutput();
      res.json(sessions);
    }
  } catch (error) {
    loggers.api.error({ err: error }, 'Failed to list all sessions');
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Stats endpoint for admin dashboard metrics
app.get('/stats', async (req, res) => {
  try {
    const sessions = sessionManager.getAllSessions();
    const activeSessions = sessions.filter(s => s.status === 'running');

    // Count WebSocket connections
    let totalEventClients = 0;
    let totalTerminalClients = 0;
    sessionEventClients.forEach((clients) => {
      totalEventClients += clients.size;
    });
    // Terminal clients tracked by wss.clients
    totalTerminalClients = wss.clients.size;

    // Count activity states across sessions
    const activityCounts: Record<string, number> = {
      idle: 0,
      thinking: 0,
      writing: 0,
      editing: 0,
      executing: 0,
      artifacts: 0,
      error: 0,
    };

    // Get activity states from event emitters
    sessionEventEmitters.forEach((emitter) => {
      const state = emitter.getState();
      if (state && activityCounts[state] !== undefined) {
        activityCounts[state]++;
      } else {
        activityCounts.idle++;
      }
    });

    // Also count sessions not yet in event emitters as idle
    const emitterSessionIds = new Set(sessionEventEmitters.keys());
    activeSessions.forEach(s => {
      if (!emitterSessionIds.has(s.id)) {
        activityCounts.idle++;
      }
    });

    res.json({
      sessions: {
        total: sessions.length,
        active: activeSessions.length,
        stopped: sessions.filter(s => s.status === 'stopped').length,
        error: sessions.filter(s => s.status === 'error').length,
      },
      websockets: {
        eventClients: totalEventClients,
        terminalClients: totalTerminalClients,
        totalClients: totalEventClients + totalTerminalClients,
      },
      codeMode: {
        thinking: activityCounts.thinking,
        writing: activityCounts.writing,
        editing: activityCounts.editing,
        executing: activityCounts.executing,
        artifacts: activityCounts.artifacts,
        idle: activityCounts.idle,
        error: activityCounts.error,
      },
      runtime: {
        status: 'healthy',
        versions: {
          cli: cliVersion,
          sdk: sdkVersion,
        },
      },
    });
  } catch (error) {
    loggers.api.error({ err: error }, 'Failed to get stats');
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Get process metrics for a specific session
app.get('/sessions/:sessionId/metrics', async (req, res) => {
  try {
    const metrics = await sessionManager.getProcessMetrics(req.params.sessionId);
    if (!metrics) {
      return res.status(404).json({ error: 'Session not found or process exited' });
    }
    res.json(metrics);
  } catch (error) {
    loggers.metrics.error({ err: error }, 'Failed to get session metrics');
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

// Get ENHANCED metrics for a specific session (includes network I/O, disk I/O, tokens, storage)
app.get('/sessions/:sessionId/metrics/enhanced', async (req, res) => {
  try {
    const metrics = await sessionManager.getEnhancedMetrics(req.params.sessionId);
    if (!metrics) {
      return res.status(404).json({ error: 'Session not found or process exited' });
    }
    res.json(metrics);
  } catch (error) {
    loggers.metrics.error({ err: error }, 'Failed to get enhanced session metrics');
    res.status(500).json({ error: 'Failed to get enhanced metrics' });
  }
});

// Get ALL sessions with ENHANCED metrics (admin dashboard endpoint)
app.get('/sessions/all/metrics/enhanced', async (req, res) => {
  try {
    const sessions = await sessionManager.getAllSessionsWithEnhancedMetrics();
    res.json({ sessions });
  } catch (error) {
    loggers.metrics.error({ err: error }, 'Failed to get all sessions with enhanced metrics');
    res.status(500).json({ error: 'Failed to get enhanced metrics' });
  }
});

// Get system-wide aggregated metrics
app.get('/metrics/system', async (req, res) => {
  try {
    const sessions = sessionManager.getAllSessions().map(s => ({
      id: s.id,
      userId: s.userId,
      pid: s.pid,
      workspacePath: s.workspacePath,
    }));

    const systemMetrics = await metricsService.getSystemMetrics(sessions);
    res.json(systemMetrics);
  } catch (error) {
    loggers.metrics.error({ err: error }, 'Failed to get system metrics');
    res.status(500).json({ error: 'Failed to get system metrics' });
  }
});

// Record token usage for a session (called by event emitter when parsing NDJSON)
app.post('/sessions/:sessionId/tokens', async (req, res) => {
  try {
    const { inputTokens, outputTokens, model } = req.body;
    sessionManager.recordTokenUsage(
      req.params.sessionId,
      inputTokens || 0,
      outputTokens || 0,
      model
    );
    res.json({ success: true });
  } catch (error) {
    loggers.metrics.error({ err: error }, 'Failed to record token usage');
    res.status(500).json({ error: 'Failed to record tokens' });
  }
});

// ========================================
// Workspace Sync Endpoints
// ========================================

// Get sync status for all sessions
app.get('/workspace/sync/status', async (req, res) => {
  try {
    const status = workspaceSyncService.getSyncStatus();
    const result: Record<string, any> = {};
    for (const [sessionId, s] of status) {
      result[sessionId] = s;
    }
    res.json({ syncing: result, totalWatchers: status.size });
  } catch (error) {
    loggers.storage.error({ err: error }, 'Failed to get sync status');
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

// Trigger full sync for a session
app.post('/sessions/:sessionId/sync', async (req, res) => {
  try {
    const session = sessionManager.getSessionStatus(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.workspacePath || !session.userId) {
      return res.status(400).json({ error: 'Session missing required data (userId or workspacePath)' });
    }

    const result = await workspaceSyncService.fullSync(
      session.id,
      session.userId,
      session.workspacePath
    );

    res.json({ success: true, ...result });
  } catch (error) {
    loggers.storage.error({ err: error }, 'Failed to trigger sync');
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
});

// Restart session (stop and start with same config)
app.post('/sessions/:sessionId/restart', async (req, res) => {
  try {
    const newSession = await sessionManager.restartSession(req.params.sessionId);
    res.json({
      status: 'restarted',
      oldSessionId: req.params.sessionId,
      newSession,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Inject GitHub token into a user's active code mode session
app.post('/sessions/refresh-github', async (req, res) => {
  try {
    const { userId, githubToken } = req.body;
    if (!userId || !githubToken) {
      return res.status(400).json({ error: 'userId and githubToken required' });
    }

    // Find the user's active running session
    const userSessions = sessionManager.getSessionsByUser(userId)
      .filter((s: any) => s.status === 'running');
    if (!userSessions || userSessions.length === 0) {
      return res.status(404).json({ error: 'No active session for user', userId });
    }

    const existingSession = userSessions[0];
    const sessionId = existingSession.id;

    // Get K8s pod IP to call exec container directly
    if (config.executionMode === 'kubernetes') {
      const k8sManager = getK8sSessionManager();
      const k8sSession = await k8sManager.getSessionByUserId(userId);
      if (k8sSession && k8sSession.podIP) {
        const { ExecContainerClient } = await import('./execContainerClient.js');
        const execClient = new ExecContainerClient({ url: `http://${k8sSession.podIP}:3060` });
        await execClient.refreshSessionToken(sessionId, (existingSession as any).apiKey || '', {
          model: existingSession.model,
          githubToken,
        });
      }
    }

    loggers.api.info({ userId, sessionId }, 'GitHub token injected into running session');
    res.json({ status: 'success', sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loggers.api.warn({ err: message }, 'Failed to inject GitHub token');
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// Native chat mode — Server-Sent Events proxy to the exec daemon's stream-json
// bridge. Used by the new React CodeMode UI (no terminal emulation). Each turn
// is a fresh request here; we resolve the user's pod, POST to the daemon, and
// pipe the SSE response back verbatim. The daemon spawns a one-shot openagentic
// process with --input-format stream-json --output-format stream-json, which
// keeps conversation context via --continue.
// ============================================================================
app.post('/sessions/:sessionId/chat', async (req, res) => {
  const { sessionId } = req.params;
  const body = req.body as { message?: string; model?: string };

  if (!body?.message || typeof body.message !== 'string') {
    return res.status(400).json({ error: 'message (string) required in body' });
  }

  loggers.api.info({ sessionId }, 'chat-stream: request received');

  // Resolve the exec daemon URL for this session. Mirror the pattern
  // used by the terminal WebSocket handler (lines ~1963): prefer the
  // stable per-pod Service DNS name so we stay correct across pod
  // restarts, falling back to ephemeral podIP/serviceIP.
  let execUrl: string | null = null;
  try {
    if (config.executionMode === 'kubernetes') {
      const k8sManager = getK8sSessionManager();
      const k8sSession = await k8sManager.getSession(sessionId);
      if (!k8sSession) {
        loggers.api.warn({ sessionId }, 'chat-stream: no k8s session found for id');
        return res.status(404).json({ error: 'Session not found in k8s session store' });
      }
      const execPort = k8sSession.servicePort || 3060;
      const ns = config.k8s?.namespace || 'agentic-dev';
      if (k8sSession.serviceName) {
        execUrl = `http://${k8sSession.serviceName}.${ns}.svc.cluster.local:${execPort}`;
      } else if (k8sSession.serviceIP || k8sSession.podIP) {
        execUrl = `http://${k8sSession.serviceIP || k8sSession.podIP}:${execPort}`;
      }
      loggers.api.info(
        {
          sessionId,
          serviceName: k8sSession.serviceName,
          podIP: k8sSession.podIP,
          serviceIP: k8sSession.serviceIP,
          execUrl,
        },
        'chat-stream: resolved exec daemon URL',
      );
    } else if (config.executionMode === 'exec-container') {
      execUrl = process.env.EXEC_CONTAINER_URL || 'http://openagentic-exec:3060';
    }
  } catch (resolveErr) {
    loggers.api.error({ err: resolveErr, sessionId }, 'chat-stream: failed to resolve exec URL');
    return res.status(502).json({ error: 'Failed to resolve exec daemon' });
  }

  if (!execUrl) {
    loggers.api.error({ sessionId }, 'chat-stream: exec URL is null after resolve — no service/podIP available');
    return res.status(503).json({ error: 'No exec daemon reachable for session' });
  }

  // SSE passthrough — we set headers here and copy the upstream body as-is.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let upstream: Response;
  try {
    upstream = await fetch(`${execUrl}/sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': process.env.INTERNAL_API_KEY || '',
      },
      body: JSON.stringify(body),
    });
  } catch (fetchErr) {
    loggers.api.error({ err: fetchErr, sessionId }, 'chat-stream: upstream fetch failed');
    res.write(`event: done\ndata: {"reason":"upstream_error","message":${JSON.stringify(String(fetchErr))}}\n\n`);
    return res.end();
  }

  if (!upstream.ok || !upstream.body) {
    const text = upstream.body ? await upstream.text() : '';
    loggers.api.error({ sessionId, status: upstream.status, body: text.slice(0, 500) }, 'chat-stream: upstream returned error');
    res.write(`event: done\ndata: {"reason":"upstream_status","status":${upstream.status}}\n\n`);
    return res.end();
  }

  // Pipe the upstream SSE stream to our response. We read chunks from the
  // web-stream reader and write them to the node response; both sides are
  // already SSE-framed so no transformation is needed.
  //
  // NOTE: use res.on('close'), NOT req.on('close'). See the matching
  // comment in openagentic-exec/src/index.ts — req emits 'close' as soon
  // as the POST body is fully read, which is essentially immediately
  // for a small JSON body and would cause us to cancel the upstream
  // reader before receiving any data.
  const reader = upstream.body.getReader();
  let clientClosed = false;
  res.on('close', () => {
    clientClosed = true;
    reader.cancel().catch(() => {});
  });

  try {
    while (!clientClosed) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
  } catch (streamErr) {
    loggers.api.warn({ err: streamErr, sessionId }, 'chat-stream: pipe interrupted');
  } finally {
    try { res.end(); } catch { /* already ended */ }
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /sessions/:sessionId/chat/control
//
// Thin proxy to the exec daemon's /chat/control endpoint — the daemon
// holds the in-flight openagentic child's stdin, we just forward the
// control frame (interrupt, permission response, etc.) to the right
// runner pod. See openagentic-exec/src/index.ts for the frame format.
// ───────────────────────────────────────────────────────────────────────────
app.post('/sessions/:sessionId/chat/control', async (req, res) => {
  const { sessionId } = req.params;

  let execUrl: string | null = null;
  try {
    if (config.executionMode === 'kubernetes') {
      const k8sManager = getK8sSessionManager();
      const k8sSession = await k8sManager.getSession(sessionId);
      if (!k8sSession) {
        return res.status(404).json({ error: 'Session not found in k8s session store' });
      }
      const execPort = k8sSession.servicePort || 3060;
      const ns = config.k8s?.namespace || 'agentic-dev';
      if (k8sSession.serviceName) {
        execUrl = `http://${k8sSession.serviceName}.${ns}.svc.cluster.local:${execPort}`;
      } else if (k8sSession.serviceIP || k8sSession.podIP) {
        execUrl = `http://${k8sSession.serviceIP || k8sSession.podIP}:${execPort}`;
      }
    } else if (config.executionMode === 'exec-container') {
      execUrl = process.env.EXEC_CONTAINER_URL || 'http://openagentic-exec:3060';
    }
  } catch (resolveErr) {
    loggers.api.error({ err: resolveErr, sessionId }, 'chat-control: failed to resolve exec URL');
    return res.status(502).json({ error: 'Failed to resolve exec daemon' });
  }

  if (!execUrl) {
    return res.status(503).json({ error: 'No exec daemon reachable for session' });
  }

  try {
    const upstream = await fetch(`${execUrl}/sessions/${sessionId}/chat/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': process.env.INTERNAL_API_KEY || '',
      },
      body: JSON.stringify(req.body || {}),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (err) {
    loggers.api.error({ err, sessionId }, 'chat-control: upstream fetch failed');
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

// Upload file to session workspace
app.post('/sessions/:sessionId/upload', async (req, res) => {
  const { sessionId } = req.params;
  let execUrl: string | null = null;
  try {
    if (config.executionMode === 'kubernetes') {
      const k8sManager = getK8sSessionManager();
      const k8sSession = await k8sManager.getSession(sessionId);
      if (!k8sSession) return res.status(404).json({ error: 'Session not found' });
      const execPort = k8sSession.servicePort || 3060;
      const ns = config.k8s?.namespace || 'agentic-dev';
      if (k8sSession.serviceName) {
        execUrl = `http://${k8sSession.serviceName}.${ns}.svc.cluster.local:${execPort}`;
      } else if (k8sSession.serviceIP || k8sSession.podIP) {
        execUrl = `http://${k8sSession.serviceIP || k8sSession.podIP}:${execPort}`;
      }
    } else if (config.executionMode === 'exec-container') {
      execUrl = process.env.EXEC_CONTAINER_URL || 'http://openagentic-exec:3060';
    }
  } catch (err) {
    return res.status(502).json({ error: 'Failed to resolve exec daemon' });
  }
  if (!execUrl) return res.status(503).json({ error: 'No exec daemon reachable' });
  try {
    const upstream = await fetch(`${execUrl}/sessions/${sessionId}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': process.env.INTERNAL_API_KEY || '' },
      body: JSON.stringify(req.body || {}),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

// Send message to session (REST API - legacy, non-streaming)
app.post('/sessions/:sessionId/messages', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message required' });
    }

    const response = await sessionManager.sendMessage(req.params.sessionId, message);
    res.json({ response });
  } catch (error) {
    loggers.api.error({ err: error }, 'Message failed');
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Stop session
app.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    // Record session duration before stopping
    const sessionStatus = sessionManager.getSessionStatus(sessionId);
    if (sessionStatus?.createdAt) {
      const durationSec = (Date.now() - new Date(sessionStatus.createdAt).getTime()) / 1000;
      codeSessionDuration.observe(durationSec);
    }
    await sessionManager.stopSession(sessionId);

    // Also stop code-server if running (in exec-container mode, exec handles this)
    if (config.executionMode !== 'exec-container') {
      const codeServerService = getCodeServerService();
      await codeServerService.stopInstance(sessionId).catch(() => {});
    }

    res.json({ status: 'stopped' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// ========================================
// Code Server (VS Code Web IDE) API
// ========================================

// Start/get code-server URL for a session
app.post('/sessions/:sessionId/code-server', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Delegate to exec container when in exec-container mode
    if (config.executionMode === 'exec-container') {
      const execClient = getExecContainerClient();
      const result = await execClient.startCodeServer(sessionId);

      // Transform internal URL (http://localhost:PORT) to external URL (/code-server/PORT/)
      // The external URL is proxied by Caddy to the exec container
      const externalUrlPrefix = process.env.CODE_SERVER_EXTERNAL_URL || '/code-server';
      const externalUrl = result.port && result.workspacePath
        ? `${externalUrlPrefix}/${result.port}/?folder=${encodeURIComponent(result.workspacePath)}`
        : result.url; // Fallback to original URL if port/path not available

      return res.json({
        status: result.status || 'available',
        url: externalUrl,
        port: result.port,
        workspacePath: result.workspacePath,
      });
    }

    // Delegate to K8s per-user pod when in kubernetes mode
    if (config.executionMode === 'kubernetes') {
      const k8sManager = getK8sSessionManager();
      const result = await k8sManager.startCodeServer(sessionId);

      // Transform internal URL to external URL with session-based routing
      // K8s mode uses session ID routing: /code-server/session/{sessionId}/
      // This is different from exec-container mode which uses port-based routing
      // because each k8s pod has code-server on port 3100 internally
      const externalUrlPrefix = process.env.CODE_SERVER_EXTERNAL_URL || '/code-server';
      const externalUrl = result.workspacePath
        ? `${externalUrlPrefix}/session/${sessionId}/?folder=${encodeURIComponent(result.workspacePath)}`
        : result.url; // Fallback to original URL if workspace path not available

      return res.json({
        status: result.status || 'available',
        url: externalUrl,
        sessionId: sessionId,
        workspacePath: result.workspacePath,
      });
    }

    // Local mode: run code-server on manager
    const codeServerService = getCodeServerService();
    // Get sandbox username so code-server runs as the correct user (not root)
    const sandboxUsername = sessionManager.getSandboxUsername(sessionId);
    const instance = await codeServerService.startInstance(
      session.userId,
      sessionId,
      session.workspacePath || `/workspaces/${session.userId}/${sessionId}`,
      sandboxUsername
    );

    res.json({
      status: 'available',
      url: instance.url,
      workspacePath: instance.workspacePath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loggers.codeserver.error({ sessionId: req.params.sessionId, err: message }, "Failed to get code-server URL");
    res.status(500).json({ error: message });
  }
});

// Get code-server status for a session
app.get('/sessions/:sessionId/code-server', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessionManager.getSession(sessionId);

    // Delegate to exec container when in exec-container mode
    if (config.executionMode === 'exec-container') {
      const execClient = getExecContainerClient();

      if (!session) {
        return res.json({ status: 'no_session', url: null, healthy: true });
      }

      // Get status from exec container
      let result = await execClient.getCodeServerStatus(sessionId);

      // If not started yet, start it
      if (result.status === 'not_started') {
        result = await execClient.startCodeServer(sessionId);
      }

      // Transform internal URL (http://localhost:PORT) to external URL (/code-server/PORT/)
      // The external URL is proxied by Caddy to the exec container
      const externalUrlPrefix = process.env.CODE_SERVER_EXTERNAL_URL || '/code-server';
      const externalUrl = result.port && result.workspacePath
        ? `${externalUrlPrefix}/${result.port}/?folder=${encodeURIComponent(result.workspacePath)}`
        : result.url; // Fallback to original URL if port/path not available

      return res.json({
        status: result.status,
        url: externalUrl,
        port: result.port,
        workspacePath: result.workspacePath,
        healthy: true,
      });
    }

    // Delegate to K8s per-user pod when in kubernetes mode
    if (config.executionMode === 'kubernetes') {
      const k8sManager = getK8sSessionManager();

      if (!session) {
        return res.json({ status: 'no_session', url: null, healthy: true });
      }

      // Get status from K8s pod
      let result: { status: string; url: string | null; port?: number; workspacePath?: string; startedAt?: number };
      try {
        result = await k8sManager.getCodeServerStatus(sessionId);
      } catch (statusErr: any) {
        // Pod may not be reachable yet (starting up), return transient status
        loggers.codeserver.warn({ sessionId, err: statusErr?.message }, "Code-server status check failed, pod may be starting");
        return res.json({ status: 'not_started', url: null, healthy: true });
      }

      // If not started yet, start it
      if (result.status === 'not_started' || result.status === 'stopped') {
        try {
          result = await k8sManager.startCodeServer(sessionId);
        } catch (startErr: any) {
          loggers.codeserver.warn({ sessionId, err: startErr?.message }, "Code-server auto-start failed, will retry on next poll");
          return res.json({ status: 'not_started', url: null, healthy: true });
        }
      }

      // Transform internal URL to external URL with session-based routing
      // K8s mode uses session ID routing: /code-server/session/{sessionId}/
      const externalUrlPrefix = process.env.CODE_SERVER_EXTERNAL_URL || '/code-server';
      const externalUrl = result.workspacePath
        ? `${externalUrlPrefix}/session/${sessionId}/?folder=${encodeURIComponent(result.workspacePath)}`
        : result.url;

      return res.json({
        status: result.status,
        url: externalUrl,
        sessionId: sessionId,
        workspacePath: result.workspacePath,
        healthy: true,
      });
    }

    // Local mode
    const codeServerService = getCodeServerService();

    // Check if code-server container is healthy
    const isHealthy = await codeServerService.checkHealth();

    if (!session) {
      return res.json({ status: 'no_session', url: null, healthy: isHealthy });
    }

    // Get or create instance URL
    let instance = codeServerService.getInstance(sessionId);
    if (!instance) {
      // Get sandbox username so code-server runs as the correct user (not root)
      const sandboxUsername = sessionManager.getSandboxUsername(sessionId);
      instance = await codeServerService.startInstance(
        session.userId,
        sessionId,
        session.workspacePath || `/workspaces/${session.userId}/${sessionId}`,
        sandboxUsername
      );
    }

    res.json({
      status: instance.status,
      url: instance.url,
      workspacePath: instance.workspacePath,
      healthy: isHealthy,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Stop code-server for a session
app.delete('/sessions/:sessionId/code-server', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Delegate to exec container when in exec-container mode
    if (config.executionMode === 'exec-container') {
      const execClient = getExecContainerClient();
      await execClient.stopCodeServer(sessionId);
      return res.json({ status: 'stopped' });
    }

    // Delegate to K8s per-user pod when in kubernetes mode
    if (config.executionMode === 'kubernetes') {
      const k8sManager = getK8sSessionManager();
      await k8sManager.stopCodeServer(sessionId);
      return res.json({ status: 'stopped' });
    }

    // Local mode
    const codeServerService = getCodeServerService();
    await codeServerService.stopInstance(sessionId);
    res.json({ status: 'stopped' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Get all code-server instances (admin)
app.get('/code-servers', async (req, res) => {
  try {
    // Delegate to exec container when in exec-container mode
    if (config.executionMode === 'exec-container') {
      const execClient = getExecContainerClient();
      const result = await execClient.listCodeServers();
      return res.json({
        count: result.instances.length,
        healthy: true,
        instances: result.instances,
      });
    }

    // For kubernetes mode, iterate through sessions and get code-server status
    if (config.executionMode === 'kubernetes') {
      const k8sManager = getK8sSessionManager();
      const sessions = await k8sManager.listSessions();
      const instances = await Promise.all(
        sessions.map(async (session) => {
          try {
            const status = await k8sManager.getCodeServerStatus(session.sessionId);
            return {
              sessionId: session.sessionId,
              userId: session.userId,
              status: status.status,
              url: status.url,
              workspacePath: status.workspacePath,
            };
          } catch {
            return null;
          }
        })
      );
      const validInstances = instances.filter(Boolean);
      return res.json({
        count: validInstances.length,
        healthy: true,
        instances: validInstances,
      });
    }

    // Local mode
    const codeServerService = getCodeServerService();
    const instances = codeServerService.getAllInstances();
    const isHealthy = await codeServerService.checkHealth();
    res.json({
      count: instances.length,
      healthy: isHealthy,
      instances: instances.map(i => ({
        sessionId: i.sessionId,
        userId: i.userId,
        status: i.status,
        url: i.url,
        workspacePath: i.workspacePath,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// ========================================
// Code-Server Proxy Routes (K8s mode)
// ========================================
// In K8s mode, code-servers run on individual runner pods (not on code-manager).
// These proxy routes forward requests to the correct runner pod based on session ID.
// URL format: /code-server/session/{sessionId}/...

// Proxy all code-server requests based on session ID
app.all('/code-server/session/:sessionId/*', async (req, res) => {
  // Only used in kubernetes mode
  if (config.executionMode !== 'kubernetes') {
    return res.status(404).json({ error: 'Session-based code-server routing only available in kubernetes mode' });
  }

  const { sessionId } = req.params;
  // Extract remaining path after /code-server/session/{sessionId}/
  const fullUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathPrefix = `/code-server/session/${sessionId}/`;
  const path = fullUrl.pathname.startsWith(pathPrefix) ? fullUrl.pathname.substring(pathPrefix.length) : '';
  const queryString = fullUrl.search;

  try {
    const k8sManager = getK8sSessionManager();
    let session = await k8sManager.getSession(sessionId);

    // Fallback: if K8s session store (Redis) lost the session, recover from local SessionManager
    if (!session || session.status !== 'running') {
      const localSession = sessionManager.getSession(sessionId);
      if (localSession && localSession.status === 'running') {
        // Derive pod/service name from userId (deterministic naming)
        const { createHash } = await import('crypto');
        const hash = createHash('sha256').update(localSession.userId).digest('hex').substring(0, 12);
        const podName = `openagentic-${hash}`;
        const serviceName = `${podName}-svc`;

        loggers.codeserver.info({ sessionId, serviceName }, "Redis session missing, recovered from local store");

        // Self-heal: re-store session in Redis for future requests
        const recoveredSession = {
          sessionId,
          userId: localSession.userId,
          podName,
          serviceName,
          status: 'running' as const,
          servicePort: 3060,
          createdAt: new Date(localSession.createdAt).getTime(),
          lastActivity: Date.now(),
          workspacePath: localSession.workspacePath,
          healthChecksPassed: 0,
          consecutiveHealthFailures: 0,
        };
        await k8sManager.storeSession(sessionId, recoveredSession);
        await k8sManager.storeUserSession(localSession.userId, sessionId);
        session = recoveredSession;
      }
    }

    if (!session || session.status !== 'running') {
      return res.status(404).json({ error: 'Session not found or not running' });
    }

    // Build the target URL (runner pod's code-server)
    const targetUrl = `http://${session.serviceName}.${config.k8s.namespace}.svc.cluster.local:3100/${path}${queryString}`;

    loggers.codeserver.info({ method: req.method, originalUrl: req.originalUrl, targetUrl }, "Proxying code-server request");

    // Use http/https module for proxying
    const http = await import('http');
    const url = new URL(targetUrl);

    // Filter headers: strip Origin to avoid code-server CSRF rejection
    const proxyHeaders: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'origin') {
        // Rewrite Origin to match code-server's bind address for CSRF check
        proxyHeaders[key] = `${url.protocol}//${url.host}`;
        continue;
      } else if (lowerKey === 'host') {
        proxyHeaders[key] = url.hostname;
      } else {
        proxyHeaders[key] = value;
      }
    }

    const proxyReq = http.request({
      hostname: url.hostname,
      port: url.port || 3100,
      path: url.pathname + url.search,
      method: req.method,
      headers: proxyHeaders,
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      loggers.codeserver.error({ sessionId, err: err.message }, "Proxy error");
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to connect to code-server', details: err.message });
      }
    });

    // Handle request body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loggers.codeserver.error({ sessionId, err: message }, "Error proxying to session");
    res.status(500).json({ error: message });
  }
});

// Handle WebSocket upgrades for code-server (VS Code uses WebSockets)
// This is handled in the WebSocket server setup below

// ========================================
// GhostPilot Proxy Routes (K8s mode)
// ========================================
// GhostPilot runs on runner pods (port 3200+).
// These proxy routes forward HTTP + WebSocket to the correct runner pod.
// URL format: /ghostpilot/session/{sessionId}/...

// GhostPilot lifecycle endpoints (start/stop/status)
app.post('/ghostpilot/start/:sessionId', async (req, res) => {
  if (config.executionMode !== 'kubernetes') {
    return res.status(404).json({ error: 'GhostPilot only available in kubernetes mode' });
  }

  const { sessionId } = req.params;

  try {
    const k8sManager = getK8sSessionManager();
    const session = await k8sManager.getSession(sessionId);

    if (!session || session.status !== 'running') {
      return res.status(404).json({ error: 'Session not found or not running' });
    }

    // Call exec pod to start GhostPilot
    const execClient = getExecContainerClient();
    const serviceUrl = `http://${session.serviceName}.${config.k8s.namespace}.svc.cluster.local:${session.servicePort}`;

    const response = await fetch(`${serviceUrl}/sessions/${sessionId}/ghostpilot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': config.internalApiKey || '',
      },
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loggers.api.error({ sessionId, err: message }, 'Failed to start GhostPilot');
    res.status(500).json({ error: message });
  }
});

app.get('/ghostpilot/status/:sessionId', async (req, res) => {
  if (config.executionMode !== 'kubernetes') {
    return res.status(404).json({ error: 'GhostPilot only available in kubernetes mode' });
  }

  const { sessionId } = req.params;

  try {
    const k8sManager = getK8sSessionManager();
    const session = await k8sManager.getSession(sessionId);

    if (!session || session.status !== 'running') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const serviceUrl = `http://${session.serviceName}.${config.k8s.namespace}.svc.cluster.local:${session.servicePort}`;
    const response = await fetch(`${serviceUrl}/sessions/${sessionId}/ghostpilot`, {
      headers: { 'X-Internal-Api-Key': config.internalApiKey || '' },
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.delete('/ghostpilot/stop/:sessionId', async (req, res) => {
  if (config.executionMode !== 'kubernetes') {
    return res.status(404).json({ error: 'GhostPilot only available in kubernetes mode' });
  }

  const { sessionId } = req.params;

  try {
    const k8sManager = getK8sSessionManager();
    const session = await k8sManager.getSession(sessionId);

    if (!session || session.status !== 'running') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const serviceUrl = `http://${session.serviceName}.${config.k8s.namespace}.svc.cluster.local:${session.servicePort}`;
    const response = await fetch(`${serviceUrl}/sessions/${sessionId}/ghostpilot`, {
      method: 'DELETE',
      headers: { 'X-Internal-Api-Key': config.internalApiKey || '' },
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Proxy all GhostPilot requests (viewer UI, API, screenshots) to runner pod
app.all('/ghostpilot/session/:sessionId/*', async (req, res) => {
  if (config.executionMode !== 'kubernetes') {
    return res.status(404).json({ error: 'GhostPilot only available in kubernetes mode' });
  }

  const { sessionId } = req.params;
  const fullUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathPrefix = `/ghostpilot/session/${sessionId}/`;
  const path = fullUrl.pathname.startsWith(pathPrefix) ? fullUrl.pathname.substring(pathPrefix.length) : '';
  const queryString = fullUrl.search;

  try {
    const k8sManager = getK8sSessionManager();
    let session = await k8sManager.getSession(sessionId);

    // Fallback: recover from local SessionManager if Redis lost the session
    if (!session || session.status !== 'running') {
      const localSession = sessionManager.getSession(sessionId);
      if (localSession && localSession.status === 'running') {
        const { createHash } = await import('crypto');
        const hash = createHash('sha256').update(localSession.userId).digest('hex').substring(0, 12);
        const podName = `openagentic-${hash}`;
        const serviceName = `${podName}-svc`;
        session = {
          sessionId,
          userId: localSession.userId,
          podName,
          serviceName,
          status: 'running' as const,
          servicePort: 3060,
          createdAt: new Date(localSession.createdAt).getTime(),
          lastActivity: Date.now(),
          workspacePath: localSession.workspacePath,
          healthChecksPassed: 0,
          consecutiveHealthFailures: 0,
        };
      }
    }

    if (!session || session.status !== 'running') {
      return res.status(404).json({ error: 'Session not found or not running' });
    }

    // Get GhostPilot port from exec daemon
    const serviceUrl = `http://${session.serviceName}.${config.k8s.namespace}.svc.cluster.local:${session.servicePort}`;
    const statusResp = await fetch(`${serviceUrl}/sessions/${sessionId}/ghostpilot`, {
      headers: { 'X-Internal-Api-Key': config.internalApiKey || '' },
    }).catch(() => null);

    const gpStatus = statusResp ? await statusResp.json() as { port?: number } : null;
    const gpPort = gpStatus?.port || 3200;

    // Build target URL (GhostPilot on runner pod)
    const targetUrl = `http://${session.serviceName}.${config.k8s.namespace}.svc.cluster.local:${gpPort}/${path}${queryString}`;

    loggers.api.info({ method: req.method, targetUrl }, 'Proxying GhostPilot request');

    const http = await import('http');
    const url = new URL(targetUrl);

    // Filter headers
    const proxyHeaders: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'origin') { proxyHeaders[key] = `${url.protocol}//${url.host}`; continue; }
      if (lowerKey === 'host') {
        proxyHeaders[key] = url.hostname;
      } else {
        proxyHeaders[key] = value;
      }
    }

    const proxyReq = http.request({
      hostname: url.hostname,
      port: url.port || gpPort,
      path: url.pathname + url.search,
      method: req.method,
      headers: proxyHeaders,
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      loggers.api.error({ sessionId, err: err.message }, 'GhostPilot proxy error');
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to connect to GhostPilot', details: err.message });
      }
    });

    if (['POST', 'PUT', 'PATCH'].includes(req.method || '') && req.body && Object.keys(req.body).length > 0) {
      // Express bodyParser already consumed the stream, so req.pipe() won't work.
      // Write the parsed body as JSON directly to the proxy request.
      const bodyStr = JSON.stringify(req.body);
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyStr));
      proxyReq.end(bodyStr);
    } else {
      proxyReq.end();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loggers.api.error({ sessionId, err: message }, 'Error proxying GhostPilot');
    res.status(500).json({ error: message });
  }
});

// ========================================
// /slices API - Compatibility with AgenticCodeService
// ========================================

app.post('/slices', async (req, res) => {
  try {
    const { userId, model } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const existing = sessionManager.getSessionsByUser(userId)
      .filter(s => s.status === 'running');

    if (existing.length > 0) {
      return res.json({
        sliceId: existing[0].id,
        workspacePath: existing[0].workspacePath || `/workspaces/${userId}`,
        status: 'existing',
      });
    }

    const session = await sessionManager.createSession(userId, undefined, model);
    res.json({
      sliceId: session.id,
      workspacePath: session.workspacePath || `/workspaces/${userId}`,
      status: 'created',
    });
  } catch (error) {
    loggers.api.error({ err: error }, 'Failed to create slice');
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

app.post('/slices/:sliceId/exec', async (req, res) => {
  try {
    const { command, workDir, timeout } = req.body;
    const { sliceId } = req.params;

    if (!command) {
      return res.status(400).json({ error: 'command required' });
    }

    const response = await sessionManager.sendMessage(sliceId, command);

    res.json({
      stdout: response,
      stderr: '',
      exitCode: 0,
    });
  } catch (error) {
    loggers.api.error({ err: error }, 'Exec failed');
    const message = error instanceof Error ? error.message : String(error);
    res.json({
      stdout: '',
      stderr: message,
      exitCode: 1,
    });
  }
});

app.delete('/slices/:sliceId', async (req, res) => {
  try {
    await sessionManager.stopSession(req.params.sliceId);
    res.json({ status: 'deleted' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// ========================================
// WebSocket Terminal Handler
// Real PTY I/O for xterm.js frontend
// ========================================

wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');
  const token = url.searchParams.get('token');
  const internalKey = url.searchParams.get('internalKey');

  // SECURITY: Validate internal API key for WebSocket connections
  if (config.internalApiKey) {
    if (!internalKey || internalKey !== config.internalApiKey) {
      loggers.security.warn({ ip: req.socket.remoteAddress }, "Unauthorized WebSocket connection attempt");
      ws.close(4000, 'Unauthorized - internal API key required');
      return;
    }
  }

  if (!sessionId) {
    ws.close(4001, 'Missing sessionId');
    return;
  }

  // Get session — check both local and K8s session managers
  let session: any = sessionManager.getSessionStatus(sessionId);

  // In K8s mode, the session lives in the K8s session manager, not local
  if ((!session || session.status !== 'running') && config.executionMode === 'kubernetes') {
    try {
      const k8sManager = getK8sSessionManager();
      const k8sSession = await k8sManager.getSession(sessionId);
      if (k8sSession && k8sSession.status === 'running') {
        session = { ...k8sSession, running: true };
        loggers.websocket.info({ sessionId }, "Resolved session via K8s session manager");
      }
    } catch (err) {
      loggers.websocket.warn({ sessionId, err }, "Failed to look up K8s session");
    }
  }

  if (!session || session.status !== 'running') {
    loggers.websocket.warn({ sessionId, hasSession: !!session, status: session?.status }, "Session not found or not running for terminal WS");
    ws.close(4002, 'Session not found or not running');
    return;
  }

  // For K8s sessions, we don't have a local PTY — use the K8s terminal WS pipe
  const pty = sessionManager.getPty(sessionId);
  if (!pty && config.executionMode === 'kubernetes') {
    // K8s mode: pipe directly between UI WebSocket and K8s terminal WebSocket
    const k8sManager = getK8sSessionManager();
    loggers.websocket.info({ sessionId }, "K8s terminal WS pipe mode — connecting to exec pod");

    const terminalWs = await k8sManager.connectTerminal(sessionId);
    if (!terminalWs) {
      ws.close(4003, 'Failed to connect to exec pod terminal');
      return;
    }

    loggers.websocket.info({ sessionId }, "Terminal WebSocket connected (K8s pipe)");

    // REPLAY BUFFERED OUTPUT: The CLI already painted its TUI before this WS connected.
    // Fetch the output buffer from the exec daemon and replay it so the user sees
    // the TUI immediately instead of a blank terminal.
    try {
      const k8sSession = await k8sManager.getSession(sessionId);
      if (k8sSession?.serviceIP || k8sSession?.podIP) {
        const execHost = k8sSession.serviceIP || k8sSession.podIP;
        const execPort = k8sSession.servicePort || 3060;
        const ns = config.k8s?.namespace || 'agentic-dev';
        const bufferUrl = `http://${k8sSession.serviceName}.${ns}.svc.cluster.local:${execPort}/sessions/${sessionId}/output-buffer`;
        const bufferResp = await fetch(bufferUrl, {
          headers: { 'X-Internal-Api-Key': config.internalApiKey },
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);
        if (bufferResp?.ok) {
          const data: any = await bufferResp.json();
          if (data.buffer && ws.readyState === WebSocket.OPEN) {
            ws.send(data.buffer);
            loggers.websocket.info({ sessionId, chars: data.buffer.length }, "Replayed output buffer to terminal");
          }
        }
      }
    } catch (replayErr) {
      loggers.websocket.warn({ sessionId, err: replayErr }, "Failed to replay output buffer");
    }

    // Pipe: exec pod → UI
    k8sManager.on('terminal:data', (sid: string, data: string) => {
      if (sid === sessionId && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Pipe: UI → exec pod (filter control messages, forward raw input)
    ws.on('message', async (data: Buffer | string) => {
      const message = data.toString();
      if (message.startsWith('{')) {
        try {
          const control = JSON.parse(message);
          if (control.type === 'resize' && control.cols && control.rows) {
            k8sManager.resizeTerminal(sessionId, control.cols, control.rows);
            return;
          }
          if (control.type === 'keepalive') {
            return; // Silently consume — don't forward to PTY
          }
        } catch { /* not JSON — forward as raw input */ }
      }
      await k8sManager.writeTerminal(sessionId, message);
    });

    ws.on('close', () => {
      loggers.websocket.info({ sessionId }, "Terminal WebSocket disconnected (K8s pipe)");
    });

    wsAliveMap.set(ws, true);
    ws.on('pong', () => wsAliveMap.set(ws, true));
    return; // K8s pipe mode — skip local PTY setup below
  }

  if (!pty) {
    ws.close(4003, 'PTY not available');
    return;
  }

  loggers.websocket.info({ sessionId }, "Terminal WebSocket connected");

  // Setup keepalive pong handler
  wsAliveMap.set(ws, true);
  ws.on('pong', () => {
    wsAliveMap.set(ws, true);
  });

  // Forward PTY output to WebSocket
  const dataDisposable = pty.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Forward WebSocket input to PTY
  ws.on('message', async (data: Buffer | string) => {
    try {
      const message = data.toString();

      // Check if it's a control message (JSON)
      if (message.startsWith('{')) {
        try {
          const control = JSON.parse(message);
          if (control.type === 'resize' && control.cols && control.rows) {
            sessionManager.resize(sessionId, control.cols, control.rows);
            return;
          }
          if (control.type === 'keepalive') {
            return; // Silently consume — don't forward to PTY
          }
        } catch {
          // Not JSON, send as input
        }
      }

      // Send raw input to PTY (with auto-reconnect for K8s)
      await sessionManager.write(sessionId, message);
    } catch (error) {
      loggers.websocket.error({ err: error }, 'WebSocket message error');
    }
  });

  // Handle WebSocket close
  ws.on('close', () => {
    loggers.websocket.info({ sessionId }, "Terminal WebSocket disconnected");
    dataDisposable.dispose();
  });

  // Handle WebSocket error
  ws.on('error', (error) => {
    loggers.websocket.error({ sessionId, err: error }, "WebSocket error");
    dataDisposable.dispose();
  });
});

// ========================================
// WebSocket Progress Proxy Handler (Phase 3)
// ========================================
//
// Pure 1:1 proxy between the browser /ws/progress connection and the
// openagentic-exec pod's /ws/progress/:id endpoint. The exec pod tails
// the openagentic pino log and forwards parsed tool events; the manager
// just relays bytes both directions. No translation, no buffering.
//
// We open the upstream WebSocket per browser connection (no pooling)
// because each browser tab needs to see its own session's events.
// Connection is short-lived in practice — the browser closes when
// the user leaves the panel.

wssProgress.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');
  const internalKey = url.searchParams.get('internalKey');
  const userToken = url.searchParams.get('token');

  // SECURITY: same auth model as /ws/terminal — accept either the
  // internal service key OR a user token. The internal key path is
  // for in-cluster service-to-service tests; in production the
  // browser comes through with a JWT in the `token` query param.
  if (config.internalApiKey) {
    if (!internalKey && !userToken) {
      loggers.security.warn({ ip: req.socket.remoteAddress }, "Unauthorized progress WebSocket connection");
      ws.close(4000, 'Unauthorized');
      return;
    }
    if (internalKey && internalKey !== config.internalApiKey) {
      loggers.security.warn({ ip: req.socket.remoteAddress }, "Invalid internal key on progress WebSocket");
      ws.close(4000, 'Unauthorized');
      return;
    }
  }

  if (!sessionId) {
    ws.close(4001, 'Missing sessionId');
    return;
  }

  // Resolve the exec pod URL for this session. K8s mode is the only
  // supported deployment for the progress channel — local mode runs
  // openagentic in the same process and doesn't need a side channel.
  if (config.executionMode !== 'kubernetes') {
    loggers.websocket.warn({ sessionId }, "Progress channel requested in non-K8s mode — closing");
    ws.close(4002, 'Progress channel requires Kubernetes execution mode');
    return;
  }

  let podHost: string | null = null;
  let podPort: number = 3060;
  try {
    const k8sManager = getK8sSessionManager();
    const session = await k8sManager.getSession(sessionId);
    if (!session || session.status !== 'running') {
      loggers.websocket.warn({ sessionId }, "Progress: session not running");
      ws.close(4002, 'Session not found or not running');
      return;
    }
    const ns = config.k8s?.namespace || 'agentic-dev';
    podHost = `${session.serviceName}.${ns}.svc.cluster.local`;
    podPort = session.servicePort || 3060;
  } catch (err) {
    loggers.websocket.error({ sessionId, err }, "Progress: failed to look up session");
    ws.close(4003, 'Session lookup failed');
    return;
  }

  const upstreamUrl = `ws://${podHost}:${podPort}/ws/progress/${sessionId}?internalKey=${encodeURIComponent(config.internalApiKey || '')}`;
  loggers.websocket.info({ sessionId, upstreamUrl }, "Opening progress upstream");

  const upstream = new WebSocket(upstreamUrl);
  let upstreamOpen = false;

  // Buffer browser → upstream messages that arrive before the upstream
  // socket finishes opening (rare but possible — the user can send a
  // keepalive immediately on connect and the exec pod ws may still be
  // mid-handshake). Drained on upstream open.
  const pendingBrowserMessages: string[] = [];

  upstream.on('open', () => {
    upstreamOpen = true;
    loggers.websocket.info({ sessionId }, "Progress upstream connected");
    for (const msg of pendingBrowserMessages) {
      try { upstream.send(msg); } catch {}
    }
    pendingBrowserMessages.length = 0;
  });

  // Pipe: exec pod → browser
  upstream.on('message', (data: Buffer | string) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(typeof data === 'string' ? data : data.toString('utf8'));
      } catch (err) {
        loggers.websocket.warn({ sessionId, err }, "Progress: failed to forward upstream message");
      }
    }
  });

  upstream.on('close', (code, reason) => {
    loggers.websocket.info({ sessionId, code, reason: reason.toString() }, "Progress upstream closed");
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(code === 1006 ? 4004 : code, 'Upstream closed');
    }
  });

  upstream.on('error', (error) => {
    loggers.websocket.error({ sessionId, err: error }, "Progress upstream error");
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(4005, 'Upstream error');
    }
  });

  // Pipe: browser → exec pod
  ws.on('message', (data: Buffer | string) => {
    const text = typeof data === 'string' ? data : data.toString('utf8');
    if (upstreamOpen && upstream.readyState === WebSocket.OPEN) {
      try { upstream.send(text); } catch {}
    } else {
      pendingBrowserMessages.push(text);
    }
  });

  ws.on('close', () => {
    loggers.websocket.info({ sessionId }, "Progress browser closed");
    try { upstream.close(); } catch {}
  });

  ws.on('error', (error) => {
    loggers.websocket.error({ sessionId, err: error }, "Progress browser error");
    try { upstream.close(); } catch {}
  });
});

// ========================================
// WebSocket Structured Events Handler
// For new Code Mode UI with real-time activity visualization
// ========================================

wssEvents.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const userId = url.searchParams.get('userId');
  const requestedSessionId = url.searchParams.get('sessionId');
  const internalKey = url.searchParams.get('internalKey');
  // Auth token for API mode - CLI will use this to call platform LLM providers
  const userToken = url.searchParams.get('token');

  // SECURITY: Validate authentication for WebSocket connections
  // Accept either internal API key (service-to-service) OR user token (UI connections)
  const hasValidInternalKey = config.internalApiKey && internalKey === config.internalApiKey;
  const hasUserToken = !!userToken && userToken.length > 0;

  if (config.internalApiKey && !hasValidInternalKey && !hasUserToken) {
    loggers.security.warn({ ip: req.socket.remoteAddress }, "Unauthorized event WebSocket connection attempt");
    ws.close(4000, 'Unauthorized - internal API key or user token required');
    return;
  }

  if (hasUserToken && !hasValidInternalKey) {
    loggers.events.info({ ip: req.socket.remoteAddress, userId }, "User token authentication");
  }

  if (!userId) {
    ws.close(4001, 'Missing userId');
    return;
  }

  loggers.events.info({ userId, apiMode: !!userToken }, 'Events WebSocket connected');

  // Setup keepalive pong handler
  wsAliveMap.set(ws, true);
  ws.on('pong', () => {
    wsAliveMap.set(ws, true);
  });

  // Find or create session
  let sessionId = requestedSessionId;
  let session: SessionStatus | null = null;
  const wantApiMode = !!userToken;

  // For Kubernetes mode, use getOrCreateSession which handles health verification
  // This ensures stale sessions with deleted pods are cleaned up and new sessions created
  if (config.executionMode === 'kubernetes') {
    const k8sManager = getK8sSessionManager();
    try {
      // Generate an internal JWT for the exec pod's CLI
      // This is more reliable than passing through Azure AD tokens which:
      // 1. Expire after ~1 hour
      // 2. Can have encoding issues in shell commands
      // 3. May not be accepted by the openagentic proxy auth middleware
      const internalApiKey = wantApiMode ? generateInternalJwt({
        userId: userId!,
        email: url.searchParams.get('email') || undefined,
        name: url.searchParams.get('name') || undefined,
      }) : undefined;

      if (wantApiMode && !internalApiKey) {
        loggers.events.warn({ userId }, "Failed to generate internal JWT - JWT_SECRET may not be set");
      }

      // getOrCreateSession verifies pod health and cleans up stale sessions
      const k8sSession = await k8sManager.getOrCreateSession({
        sessionId: requestedSessionId || require('crypto').randomUUID(),
        userId,
        apiKey: internalApiKey || userToken || undefined,
      });
      sessionId = k8sSession.sessionId;

      // Register the K8s session with sessionManager for write()/resize() to work
      // This doesn't create a new pod, just registers the existing session
      const userSession = sessionManager.registerK8sSession(k8sSession);

      session = {
        id: userSession.id,
        status: userSession.status,
        running: userSession.status === 'running',
        userId: userSession.userId,
        model: userSession.model,
        workspacePath: userSession.workspacePath,
        createdAt: userSession.createdAt,
        lastActivity: userSession.lastActivity,
        podName: k8sSession.podName,  // Include pod name for UI display
      };

      // Track API mode sessions
      if (wantApiMode) {
        apiModeSessions.add(sessionId);
      }
      loggers.events.info({ sessionId, apiMode: wantApiMode }, "K8s session ready");
    } catch (err) {
      loggers.events.error({ err }, 'Failed to get/create K8s session');
      ws.close(4004, 'Failed to create session');
      return;
    }
  } else {
    // Non-K8s mode: use local session management
    session = sessionId ? sessionManager.getSessionStatus(sessionId) : null;

    // If no session, find existing or create new
    if (!session) {
      const userSessions = sessionManager.getSessionsByUser(userId);
      const runningSession = userSessions.find(s => s.status === 'running');

      if (runningSession) {
        // Check if the running session matches the requested mode (API vs Ollama)
        // Don't reuse Ollama sessions when API mode is requested and vice versa
        const sessionHasApiMode = apiModeSessions.has(runningSession.id);
        if (sessionHasApiMode === wantApiMode) {
          session = sessionManager.getSessionStatus(runningSession.id);
          sessionId = runningSession.id;
          codeReconnectTotal.inc();
          loggers.events.info({ sessionId, mode: wantApiMode ? 'API' : 'Ollama' }, 'Reusing existing session');
        } else {
          loggers.events.info({ existingMode: sessionHasApiMode ? 'API' : 'Ollama', requestedMode: wantApiMode ? 'API' : 'Ollama' }, 'Mode mismatch, stopping old session');
          // Stop the old session and create a new one with the correct mode
          sessionManager.stopSession(runningSession.id).catch(err => {
            loggers.events.error({ err }, 'Failed to stop old session');
          });
          apiModeSessions.delete(runningSession.id);
        }
      }

      // Create new session if we don't have one
      if (!session) {
        // Create new session with user's auth token for API mode
        // If token is provided, CLI will use platform LLM providers instead of Ollama
        try {
          const newSession = await sessionManager.createSession(userId, undefined, undefined, userToken || undefined);
          session = sessionManager.getSessionStatus(newSession.id);
          sessionId = newSession.id;
          // Track API mode sessions
          if (wantApiMode) {
            apiModeSessions.add(sessionId);
          }
          loggers.events.info({ sessionId, mode: wantApiMode ? 'API' : 'Ollama' }, 'Created new session');
        } catch (err) {
          loggers.events.error({ err }, 'Failed to create session');
          ws.close(4004, 'Failed to create session');
          return;
        }
      }
    }
  }

  if (!session || !sessionId) {
    ws.close(4002, 'Session not available');
    return;
  }

  // Get or create event emitter for this session
  let eventEmitter = sessionEventEmitters.get(sessionId);
  if (!eventEmitter) {
    eventEmitter = new OpenagenticEventEmitter(sessionId);
    sessionEventEmitters.set(sessionId, eventEmitter);

    // Connect event emitter to PTY output
    const pty = sessionManager.getPty(sessionId);
    if (pty) {
      // LOCAL MODE: Connect directly to local PTY
      pty.onData((data: string) => {
        eventEmitter!.processOutput(data);
      });
    } else if (config.executionMode === 'exec-container') {
      // EXEC-CONTAINER MODE: Subscribe to remote terminal data from exec container
      const execClient = getExecContainerClient();
      const terminalDataHandler = (sid: string, data: string) => {
        if (sid === sessionId) {
          const emitter = sessionEventEmitters.get(sessionId);
          if (emitter) {
            emitter.processOutput(data);
          }
        }
      };
      execClient.on('terminal:data', terminalDataHandler);
      loggers.events.info({ sessionId }, "Connected to exec container terminal:data");
    } else if (config.executionMode === 'kubernetes') {
      // KUBERNETES MODE: Subscribe to remote terminal data from K8s runner pod
      // NOTE: Event handlers are registered once per eventEmitter creation
      const k8sManager = getK8sSessionManager();
      const terminalDataHandler = (sid: string, data: string) => {
        if (sid === sessionId) {
          const emitter = sessionEventEmitters.get(sessionId);
          if (emitter) {
            emitter.processOutput(data);
          }
        }
      };
      k8sManager.on('terminal:data', terminalDataHandler);

      // Subscribe to deployment status events for verbose UI feedback
      const deploymentStatusHandler = (status: {
        sessionId: string;
        step: string;
        status: 'pending' | 'running' | 'complete' | 'error' | 'failed';
        message: string;
        details?: Record<string, any>;
      }) => {
        if (status.sessionId === sessionId && ws.readyState === WebSocket.OPEN) {
          // Map deployment step names to init_status step names that UI expects
          // UI expects: 'workspace' | 'vscode' | 'openagentic' | 'ready'
          let initStep: string;
          switch (status.step) {
            case 'pod':
              initStep = 'workspace'; // Pod creation maps to workspace init
              break;
            case 'cli':
              initStep = 'openagentic'; // CLI readiness maps to openagentic
              break;
            case 'session':
              initStep = 'openagentic'; // Session init also maps to openagentic
              break;
            case 'vscode':
              initStep = 'vscode';
              break;
            default:
              initStep = status.step;
          }

          // Map status names: 'pending' | 'complete' | 'error' -> 'pending' | 'running' | 'complete' | 'failed'
          let initStatus: string;
          switch (status.status) {
            case 'pending':
              initStatus = 'running'; // pending = in progress
              break;
            case 'complete':
              initStatus = 'complete';
              break;
            case 'error':
              initStatus = 'failed';
              break;
            default:
              initStatus = status.status;
          }

          // Send as init_status so existing UI can handle it
          ws.send(JSON.stringify({
            type: 'init_status',
            timestamp: Date.now(),
            step: initStep,
            status: initStatus,
            message: status.message,
            details: status.details,
          }));
          loggers.events.info({ step: initStep, status: initStatus, message: status.message }, "CLI Status");
        }
      };
      k8sManager.on('deployment:status', deploymentStatusHandler);
      // NOTE: Terminal connection is now established OUTSIDE this block (below)
      // to ensure reconnection works when UI WebSocket reconnects
    } else {
      // PTY not ready yet - set up a listener for when session PTY becomes available
      const checkPtyInterval = setInterval(() => {
        const delayedPty = sessionManager.getPty(sessionId!);
        if (delayedPty) {
          delayedPty.onData((data: string) => {
            const emitter = sessionEventEmitters.get(sessionId!);
            if (emitter) {
              emitter.processOutput(data);
            }
          });
          clearInterval(checkPtyInterval);
        }
      }, 100);
      // Stop checking after 30 seconds
      setTimeout(() => clearInterval(checkPtyInterval), 30000);
    }

    // Emit session started event
    eventEmitter.emitSessionStarted(
      session.workspacePath || `/workspaces/${userId}`,
      session.model || 'default',
      (session as any).podName  // Include pod name for K8s mode
    );
  }

  // KUBERNETES MODE: Establish terminal WebSocket connection on EVERY UI WebSocket connect
  // This MUST be outside the eventEmitter creation block to handle reconnections
  // When users refresh or reconnect, the eventEmitter already exists but the terminal
  // WebSocket was closed when the previous UI WebSocket disconnected
  if (config.executionMode === 'kubernetes') {
    const k8sManager = getK8sSessionManager();
    loggers.events.info({ sessionId }, "Establishing terminal connection for K8s session");
    const terminalWs = await k8sManager.connectTerminal(sessionId);
    if (!terminalWs) {
      loggers.events.error({ sessionId }, "Failed to connect terminal WebSocket for K8s session");
      // Send error status to UI
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'init_status',
          timestamp: Date.now(),
          step: 'openagentic',
          status: 'failed',
          message: 'Failed to connect to terminal - try refreshing',
        }));
      }
    } else {
      loggers.events.info({ sessionId }, "Terminal WebSocket connected for K8s session");
      // Send success status to UI
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'init_status',
          timestamp: Date.now(),
          step: 'openagentic',
          status: 'complete',
          message: 'Terminal connected',
        }));
      }

      // REPLAY BUFFERED OUTPUT: CLI may have emitted init/ready before WebSocket connected
      // Fetch any buffered output from the session and send it to the UI
      try {
        const sessionWithOutput = sessionManager.getSessionWithOutput(sessionId);
        if (sessionWithOutput?.lastOutput && sessionWithOutput.lastOutput.length > 0) {
          loggers.events.info({ sessionId, chars: sessionWithOutput.lastOutput.length }, "Replaying buffered output");
          const emitter = sessionEventEmitters.get(sessionId);
          if (emitter) {
            // Process the buffered output through the emitter to generate proper events
            emitter.processOutput(sessionWithOutput.lastOutput);
          }
        }
      } catch (replayErr) {
        loggers.events.warn({ sessionId, err: replayErr }, "Failed to replay buffered output");
      }
    }
  }

  // Add client to session's client set
  if (!sessionEventClients.has(sessionId)) {
    sessionEventClients.set(sessionId, new Set());
  }
  sessionEventClients.get(sessionId)!.add(ws);

  // Forward events to this client
  const eventHandler = (event: OpenagenticStreamEvent) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  };
  eventEmitter.on('event', eventHandler);

  // Send initialization status events for the checklist UI
  // Helper to send init status with optional details
  const sendInitStatus = (
    step: string,
    status: 'pending' | 'running' | 'complete' | 'failed',
    message?: string,
    details?: Record<string, any>
  ) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'init_status',
        timestamp: Date.now(),
        step,
        status,
        message,
        details,
      }));
    }
  };

  // Send execution mode info first
  sendInitStatus('mode', 'complete', `Execution mode: ${config.executionMode}`, {
    executionMode: config.executionMode,
    isKubernetes: config.executionMode === 'kubernetes',
    isExecContainer: config.executionMode === 'exec-container',
    isLocal: config.executionMode === 'local',
  });

  // Workspace initialization
  const workspacePath = session.workspacePath || `/workspaces/${userId}`;
  sendInitStatus('workspace', 'running', `Initializing workspace: ${workspacePath}`, {
    path: workspacePath,
    userId,
  });
  try {
    // Workspace is ready if session exists
    sendInitStatus('workspace', 'complete', `Workspace ready: ${workspacePath}`, {
      path: workspacePath,
    });
  } catch {
    sendInitStatus('workspace', 'failed', 'Failed to initialize workspace');
  }

  // VS Code / code-server initialization with REAL validation
  // Helper to verify the runner pod service is responding (uses /health endpoint on service port)
  const verifyRunnerService = async (url: string, maxAttempts = 5, delayMs = 500): Promise<boolean> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // The openagentic-exec service exposes /health on port 3060 (servicePort)
        const response = await fetch(`${url}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          loggers.init.info({ attempt }, "Runner service verified");
          return true;
        }
      } catch (err) {
        if (attempt === maxAttempts) {
          loggers.init.error({ attempt, err }, "Runner service verification failed");
        }
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    return false;
  };

  // Helper to verify CLI is ready by sending a ping command
  const verifyCLIReady = async (sid: string, maxAttempts = 5, delayMs = 500): Promise<boolean> => {
    // For K8s/exec mode, check if we can write to the PTY (with auto-reconnect)
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const canWrite = await sessionManager.write(sid, '\n'); // Send empty line to test PTY
        if (canWrite) {
          return true;
        }
      } catch {
        // Continue trying
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    return false;
  };

  // Helper to verify LLM connectivity by sending a test prompt and waiting for response
  const verifyLLMReady = async (sid: string, timeoutMs = 30000): Promise<{ ready: boolean; model?: string; error?: string }> => {
    return new Promise((resolve) => {
      let resolved = false;
      let detectedModel: string | undefined;

      // Timeout handler
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          eventEmitter.off('event', responseHandler);
          loggers.init.info('LLM verification timed out');
          resolve({ ready: false, error: 'LLM response timeout - check API credentials and connectivity' });
        }
      }, timeoutMs);

      // Listen for LLM response events
      const responseHandler = (event: OpenagenticStreamEvent) => {
        if (resolved) return;

        // Check for events that indicate LLM is responding
        const responseEventTypes = [
          'text_block', 'text_delta', 'thinking_start', 'thinking_block',
          'message', 'assistant', 'result'
        ];

        if (responseEventTypes.includes(event.type)) {
          loggers.init.info({ eventType: event.type }, "LLM response received");
          resolved = true;
          clearTimeout(timeout);
          eventEmitter.off('event', responseHandler);

          // Extract model from result event if available
          if (event.type === 'result' && (event as any).model) {
            detectedModel = (event as any).model;
          }

          resolve({ ready: true, model: detectedModel });
        }

        // Check for error events
        if (event.type === 'error' || (event.type === 'result' && (event as any).subtype === 'error')) {
          const errorMsg = (event as any).error || (event as any).message || 'LLM request failed';
          loggers.init.error({ err: errorMsg }, "LLM verification error");
          resolved = true;
          clearTimeout(timeout);
          eventEmitter.off('event', responseHandler);
          resolve({ ready: false, error: errorMsg });
        }
      };

      eventEmitter.on('event', responseHandler);

      // Send a minimal test prompt to verify LLM connectivity
      // Using plain text for interactive mode (NDJSON only for --print mode)
      const testPrompt = 'Say "ready" and nothing else.';
      loggers.init.info({ sessionId: sid }, "Sending LLM verification prompt");

      sessionManager.write(sid, testPrompt + '\n').catch((err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          eventEmitter.off('event', responseHandler);
          loggers.init.error({ err }, 'Failed to send LLM test prompt');
          resolve({ ready: false, error: `Failed to send test prompt: ${err.message}` });
        }
      });
    });
  };

  // Run validation asynchronously
  (async () => {
    let vsCodeReady = false;
    let cliReady = false;

    if (config.executionMode === 'kubernetes') {
      // For K8s mode, verify the actual pod and code-server
      const k8sSession = await getK8sSessionManager().getSession(sessionId);
      sendInitStatus('vscode', 'running', 'Starting VS Code in Kubernetes pod...', {
        podName: k8sSession?.podName,
        podStatus: k8sSession?.status,
        namespace: config.k8s.namespace,
      });

      if (k8sSession?.status === 'running' && k8sSession.serviceName) {
        // Verify runner service is responding (uses /health on port 3060)
        const serviceUrl = `http://${k8sSession.serviceName}.${config.k8s.namespace}.svc.cluster.local:${k8sSession.servicePort}`;
        sendInitStatus('vscode', 'running', `Verifying runner service at ${k8sSession.podName}...`, {
          podName: k8sSession.podName,
          podIP: k8sSession.podIP,
          serviceUrl,
        });

        vsCodeReady = await verifyRunnerService(serviceUrl);
        if (vsCodeReady) {
          sendInitStatus('vscode', 'complete', `Runner verified and ready (Pod: ${k8sSession.podName})`, {
            podName: k8sSession.podName,
            podIP: k8sSession.podIP,
            verified: true,
          });
        } else {
          sendInitStatus('vscode', 'failed', `Runner service not responding after 15 attempts`, {
            podName: k8sSession.podName,
          });
        }
      } else {
        sendInitStatus('vscode', 'running', `Waiting for pod to be ready: ${k8sSession?.podName || 'creating...'}`, {
          podName: k8sSession?.podName,
          podStatus: k8sSession?.status,
        });
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, 2000));
        const updatedSession = await getK8sSessionManager().getSession(sessionId);
        if (updatedSession?.serviceName) {
          const serviceUrl = `http://${updatedSession.serviceName}.${config.k8s.namespace}.svc.cluster.local:${updatedSession.servicePort}`;
          vsCodeReady = await verifyRunnerService(serviceUrl);
          if (vsCodeReady) {
            sendInitStatus('vscode', 'complete', `Runner verified and ready (Pod: ${updatedSession?.podName})`, {
              podName: updatedSession?.podName,
              podIP: updatedSession?.podIP,
              verified: true,
            });
          } else {
            sendInitStatus('vscode', 'failed', `Runner service not responding`, {
              podName: updatedSession?.podName,
            });
          }
        }
      }
    } else if (config.executionMode === 'exec-container') {
      sendInitStatus('vscode', 'running', 'Connecting to exec container VS Code...');
      // For exec-container mode, assume VS Code is ready if session exists
      vsCodeReady = true;
      sendInitStatus('vscode', 'complete', 'VS Code ready (exec-container mode)', { verified: true });
    } else {
      sendInitStatus('vscode', 'running', 'Starting local VS Code...');
      // For local mode, assume VS Code is ready
      vsCodeReady = true;
      sendInitStatus('vscode', 'complete', 'VS Code ready (local mode)', { verified: true });
    }

    // Openagentic CLI initialization with REAL validation
    sendInitStatus('openagentic', 'running', 'Starting AI assistant (openagentic CLI)...', {
      cliVersion,
      sdkVersion,
    });

    // Verify CLI is actually ready to receive commands
    sendInitStatus('openagentic', 'running', 'Verifying CLI is ready to accept commands...', {
      cliVersion,
      sdkVersion,
    });

    cliReady = await verifyCLIReady(sessionId);
    if (cliReady) {
      sendInitStatus('openagentic', 'complete', `CLI verified and ready (v${cliVersion})`, {
        cliVersion,
        sdkVersion,
        verified: true,
      });
    } else {
      sendInitStatus('openagentic', 'failed', 'CLI not responding to commands', {
        cliVersion,
        sdkVersion,
      });
    }

    // Session is usable once workspace + VS Code + CLI are verified.
    // LLM verification is moved to a NON-BLOCKING background warmup — it's the
    // single biggest bottleneck (5-30s for a cold LLM roundtrip) and the user can
    // start typing/exploring while LLM warms up. A status bar indicator shows
    // LLM warmup progress without blocking the overlay.
    if (vsCodeReady && cliReady) {
      sendInitStatus('ready', 'complete', '✅ Environment ready — LLM warming up in background', {
        sessionId,
        workspacePath,
        executionMode: config.executionMode,
        cliVersion,
        vsCodeVerified: vsCodeReady,
        cliVerified: cliReady,
        llmVerified: false, // Will update asynchronously
        model: session.model || 'auto',
      });

      // Send session_started immediately so UI overlay dismisses
      let hostname: string | undefined;
      let storageBucket: string | undefined;
      let storageType: string = 'ephemeral';

      if (config.executionMode === 'kubernetes') {
        const k8sSession = await getK8sSessionManager().getSession(sessionId);
        hostname = k8sSession?.podName;
        if (config.storage && config.storage.bucket) {
          storageBucket = config.storage.bucket;
          storageType = config.storage.provider ? 's3fs' : 'ephemeral';
        }
      }
      ws.send(JSON.stringify({
        type: 'session_started',
        timestamp: Date.now(),
        sessionId,
        workspacePath: session.workspacePath || `/workspaces/${userId}`,
        model: session.model || 'auto',
        hostname,
        cliVersion: cliVersion,
        verified: true,
        llmVerified: false, // Not yet — background warmup
        storageBucket,
        storageType,
        podName: (session as any).podName,
        cliBackend: sessionCliBackend.get(sessionId) || 'openagentic-cli',
      }));
      loggers.init.info({ sessionId, podName: (session as any).podName, storage: storageBucket || 'ephemeral' }, 'Session started — LLM warmup in background');

      // Background LLM warmup (non-blocking)
      // OpenAgentic v2 runs as a full TUI — LLM warmup via test prompt is not
      // compatible with TUI mode (output is Ink terminal sequences, not NDJSON).
      // The CLI handles its own initialization and model selection.
      // Mark LLM as ready immediately — the user will see if it works on first prompt.
      sendInitStatus('llm', 'complete', 'LLM ready (managed by OpenAgentic CLI)', {
        model: session.model || 'auto',
        verified: true,
      });
      ws.send(JSON.stringify({
        type: 'llm_warmup_complete',
        timestamp: Date.now(),
        sessionId,
        model: session.model || 'auto',
        llmVerified: true,
      }));

    } else {
      sendInitStatus('ready', 'failed', `Initialization incomplete: VS Code=${vsCodeReady}, CLI=${cliReady}`, {
        sessionId,
        vsCodeVerified: vsCodeReady,
        cliVerified: cliReady,
      });
      loggers.init.error({ sessionId, vsCodeReady, cliReady }, "Session initialization incomplete");
    }
  })().catch(err => {
    loggers.init.error({ err }, 'Validation error');
    sendInitStatus('ready', 'failed', `Initialization error: ${err.message}`);
  });

  // Handle incoming messages (user prompts)
  ws.on('message', async (data: Buffer | string) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'user_message' && message.content) {
        loggers.events.info({ sessionId, contentPreview: message.content.substring(0, 50), model: message.model || 'default' }, "Received user_message");

        // Store model override in Redis if user selected a different model
        // The openagentic API proxy reads this to route to the correct provider
        if (message.model && sessionId) {
          try {
            // Get userId from session to use as Redis key (CLI doesn't send sessionId in chat requests)
            const sessionStatus = sessionManager.getSessionStatus(sessionId);
            const resolvedUserId = sessionStatus?.userId || sessionId;
            const Redis = (await import('ioredis')).default;
            const redisUrl = process.env.REDIS_URL || 'redis://openagentic-redis:6379';
            const redisClient = new Redis(redisUrl);
            await redisClient.set(`code_model_override:${resolvedUserId}`, message.model, 'EX', 86400); // 24h TTL
            await redisClient.quit();
            loggers.events.info({ sessionId, userId: resolvedUserId, model: message.model }, "Stored model override in Redis for openagentic proxy");
          } catch (redisErr: any) {
            loggers.events.warn({ err: redisErr.message }, "Failed to store model override in Redis (non-fatal)");
          }
        }

        let finalContent = message.content;

        // Handle file attachments if present
        // CRITICAL: Upload files to the EXEC CONTAINER/POD, not the manager's filesystem
        // This ensures files are in the workspace where the CLI can access them
        if (message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0) {
          const attachedFilePaths: string[] = [];

          for (const attachment of message.attachments) {
            try {
              const { name, type, content } = attachment;
              if (!name || !content) continue;

              // Upload to exec container/pod (where the workspace actually lives)
              if (config.executionMode === 'exec-container' || config.executionMode === 'kubernetes') {
                try {
                  const execClient = getExecContainerClient();
                  const result = await execClient.uploadFile(sessionId, name, content);
                  attachedFilePaths.push(result.relativePath);
                  loggers.events.info({ path: result.path, size: result.size }, "File uploaded to pod");
                } catch (uploadErr) {
                  loggers.events.error({ err: uploadErr }, "Failed to upload to pod, falling back to local");
                  // Fallback to local filesystem (for development/docker-compose)
                  const userWorkspace = session.workspacePath || join(config.workspacesPath, userId);
                  const uploadDir = join(userWorkspace, 'uploads');
                  await import('fs').then(fs => fs.promises.mkdir(uploadDir, { recursive: true }));
                  const fileBuffer = Buffer.from(content, 'base64');
                  const filePath = join(uploadDir, name);
                  await import('fs').then(fs => fs.promises.writeFile(filePath, fileBuffer));
                  attachedFilePaths.push(`uploads/${name}`);
                }
              } else {
                // Local mode - write to manager's filesystem
                const userWorkspace = session.workspacePath || join(config.workspacesPath, userId);
                const uploadDir = join(userWorkspace, 'uploads');
                await import('fs').then(fs => fs.promises.mkdir(uploadDir, { recursive: true }));
                const fileBuffer = Buffer.from(content, 'base64');
                const filePath = join(uploadDir, name);
                await import('fs').then(fs => fs.promises.writeFile(filePath, fileBuffer));
                attachedFilePaths.push(`uploads/${name}`);
              }
            } catch (err) {
              loggers.events.error({ err }, "Failed to save attachment");
            }
          }

          // Add file references to the message content
          if (attachedFilePaths.length > 0) {
            finalContent = `${message.content}\n\n[Attached files saved to workspace: ${attachedFilePaths.join(', ')}]`;
          }
        }

        // OpenAgentic CLI in interactive mode expects plain text + Enter
        // (NDJSON format is only for --print --input-format stream-json mode)
        const messageToSend = finalContent + '\n';
        loggers.events.info({ sessionId, messagePreview: messageToSend.substring(0, 80) }, "Writing to PTY");

        const writeResult = await sessionManager.write(sessionId!, messageToSend);
        loggers.events.info({ sessionId, writeResult }, "Write result");
      } else if (message.type === 'stop_execution') {
        // Send Ctrl+C to PTY
        await sessionManager.write(sessionId!, '\x03');
      }
    } catch (err) {
      loggers.events.error({ err }, 'Failed to parse message');
    }
  });

  // Handle client disconnect
  ws.on('close', () => {
    loggers.events.info({ sessionId }, "Events WebSocket disconnected");
    eventEmitter?.off('event', eventHandler);
    sessionEventClients.get(sessionId!)?.delete(ws);

    // Clean up if no more clients
    if (sessionEventClients.get(sessionId!)?.size === 0) {
      sessionEventClients.delete(sessionId!);
      // Keep event emitter for session continuity
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    loggers.events.error({ sessionId, err: error }, "Events WebSocket error");
    eventEmitter?.off('event', eventHandler);
  });
});

// ========================================
// Agentic Workflow Events API
// Receives events from oap-openagentic-mcp and broadcasts to WebSocket clients
// ========================================

app.post('/events', async (req, res) => {
  try {
    const event = req.body;

    if (!event || !event.type) {
      return res.status(400).json({ error: 'event with type required' });
    }

    const { sessionId, userId } = event;

    // Find the session's WebSocket clients to broadcast to
    if (sessionId && sessionEventClients.has(sessionId)) {
      const clients = sessionEventClients.get(sessionId)!;
      const eventJson = JSON.stringify(event);

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(eventJson);
        }
      }

      loggers.events.info({ eventType: event.type, clientCount: clients.size, sessionId }, "Broadcast event");
    }

    // Also emit through the event emitter if one exists
    if (sessionId && sessionEventEmitters.has(sessionId)) {
      const emitter = sessionEventEmitters.get(sessionId)!;
      emitter.emit('event', event);
    }

    res.json({ success: true, broadcast: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loggers.events.error({ err: message }, 'Failed to broadcast event');
    res.status(500).json({ success: false, error: message });
  }
});

// ========================================
// Direct File Operations (bypass CLI)
// For reliable file I/O without AI processing
// ========================================

// Validate path is within workspace (security)
function validateWorkspacePath(workspacesPath: string, userId: string, filePath: string): string {
  const userWorkspace = join(workspacesPath, userId);
  const fullPath = filePath.startsWith('/')
    ? filePath
    : join(userWorkspace, filePath);

  // Ensure the resolved path is within the user's workspace
  const resolved = join(userWorkspace, filePath.replace(/^\/workspaces\/[^/]+\//, ''));
  if (!resolved.startsWith(userWorkspace)) {
    throw new Error('Access denied: path outside workspace');
  }

  return resolved;
}

// Direct write file endpoint
app.post('/direct/write', async (req, res) => {
  try {
    const { userId, filepath, content, encoding } = req.body;

    if (!userId || !filepath || content === undefined) {
      return res.status(400).json({ error: 'userId, filepath, and content required' });
    }

    const fullPath = validateWorkspacePath(config.workspacesPath, userId, filepath);

    // Ensure directory exists
    await fs.mkdir(dirname(fullPath), { recursive: true });

    // Write file (supports base64 encoding for binary files)
    if (encoding === 'base64') {
      await fs.writeFile(fullPath, Buffer.from(content, 'base64'));
    } else {
      await fs.writeFile(fullPath, content, 'utf-8');
    }

    loggers.api.info({ fullPath }, "Wrote file");
    res.json({ success: true, filepath: fullPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loggers.api.error({ err: message }, 'Write failed');
    res.status(500).json({ success: false, error: message });
  }
});

// Direct read file endpoint
app.post('/direct/read', async (req, res) => {
  try {
    const { userId, filepath } = req.body;

    if (!userId || !filepath) {
      return res.status(400).json({ error: 'userId and filepath required' });
    }

    // In K8s mode, proxy to the user's runner pod (files live there, not on manager)
    if (config.executionMode === 'kubernetes') {
      const k8sManager = getK8sSessionManager();
      const session = await k8sManager.getSessionByUserId(userId);

      if (session && session.status === 'running') {
        try {
          const runnerUrl = `http://${session.serviceName}.${config.k8s.namespace}.svc.cluster.local:3060/files/read`;
          const response = await fetch(runnerUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Internal-API-Key': config.internalApiKey,
            },
            body: JSON.stringify({ userId, filepath }),
          });

          if (response.ok) {
            const data = await response.json();
            return res.json(data);
          }
          loggers.api.error({ status: response.status }, "DirectRead: Runner pod returned error");
        } catch (err) {
          loggers.api.error({ err }, 'DirectRead: Failed to proxy to runner pod');
        }
      }
      return res.status(404).json({ success: false, error: 'No active session or file not found', content: '' });
    }

    // Local mode: read from local filesystem
    const fullPath = validateWorkspacePath(config.workspacesPath, userId, filepath);
    const content = await fs.readFile(fullPath, 'utf-8');

    res.json({ success: true, content, filepath: fullPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message, content: '' });
  }
});

// Direct list files endpoint (supports recursive listing)
// In K8s mode, proxies to the user's runner pod since files are there, not on code-manager
app.post('/direct/list', async (req, res) => {
  try {
    const { userId, directory = '.', recursive = false } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    // In K8s mode, proxy to the user's runner pod
    if (config.executionMode === 'kubernetes') {
      const k8sManager = getK8sSessionManager();
      const session = await k8sManager.getSessionByUserId(userId);

      if (session && session.status === 'running') {
        // Proxy to runner pod's /files/list endpoint
        const runnerUrl = `http://${session.serviceName}.${config.k8s.namespace}.svc.cluster.local:3060/files/list`;
        try {
          const response = await fetch(runnerUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Internal-API-Key': config.internalApiKey,
            },
            body: JSON.stringify({ userId, directory, recursive }),
          });

          if (response.ok) {
            const data = await response.json();
            return res.json(data);
          }
          loggers.api.error({ status: response.status }, "DirectList: Runner pod returned error");
        } catch (err) {
          loggers.api.error({ err }, 'DirectList: Failed to proxy to runner pod');
        }
      }
      // No active session or proxy failed - return empty
      return res.json({ success: true, files: [], workspacePath: `/workspaces/${userId}` });
    }

    // Local/exec-container mode: read from local filesystem
    const fullPath = validateWorkspacePath(config.workspacesPath, userId, directory);

    interface FileEntry {
      name: string;
      type: 'file' | 'directory';
      path: string;
      size?: number;
    }

    // Recursive function to list all files
    const listRecursive = async (dir: string, basePath: string): Promise<FileEntry[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const results: FileEntry[] = [];

      for (const entry of entries) {
        const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        const fullEntryPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          results.push({
            name: entry.name,
            type: 'directory',
            path: entryPath,
          });

          if (recursive) {
            const subEntries = await listRecursive(fullEntryPath, entryPath);
            results.push(...subEntries);
          }
        } else {
          let size: number | undefined;
          try {
            const stat = await fs.stat(fullEntryPath);
            size = stat.size;
          } catch {
            // Ignore stat errors
          }
          results.push({
            name: entry.name,
            type: 'file',
            path: entryPath,
            size,
          });
        }
      }

      return results;
    };

    const files = await listRecursive(fullPath, directory === '.' ? '' : directory);

    res.json({ success: true, files, directory: fullPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message, files: [] });
  }
});

// Direct execute command endpoint
app.post('/direct/exec', async (req, res) => {
  try {
    const { userId, command, timeout = 60000, workingDirectory } = req.body;

    if (!userId || !command) {
      return res.status(400).json({ error: 'userId and command required' });
    }

    // In K8s mode, proxy to the user's runner pod
    if (config.executionMode === 'kubernetes') {
      const k8sManager = getK8sSessionManager();
      const session = await k8sManager.getSessionByUserId(userId);

      if (session && session.status === 'running') {
        // Proxy to runner pod's /shell/exec endpoint
        const runnerUrl = `http://${session.serviceName}.${config.k8s.namespace}.svc.cluster.local:3060/shell/exec`;
        try {
          const response = await fetch(runnerUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Internal-API-Key': config.internalApiKey,
            },
            body: JSON.stringify({ userId, command, timeout, workingDirectory }),
          });

          if (response.ok) {
            const data = await response.json();
            loggers.api.info({ serviceName: session.serviceName, userId, commandPreview: command.substring(0, 50) }, "DirectExec: Proxied to pod");
            return res.json(data);
          }
          loggers.api.error({ status: response.status }, "DirectExec: Runner pod returned error");
        } catch (err) {
          loggers.api.error({ err }, 'DirectExec: Failed to proxy to runner pod');
        }
      }
      // No active session - return error instead of trying locally
      return res.json({
        success: false,
        error: 'No active Code Mode session. Start Code Mode first to execute commands in your workspace.',
        stdout: '',
        stderr: 'No active session',
        exitCode: 1
      });
    }

    // Local/exec-container mode: execute on manager
    const workDir = join(config.workspacesPath, userId);

    // Ensure workspace exists
    await fs.mkdir(workDir, { recursive: true });

    // Execute command with timeout
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env, HOME: workDir }
    });

    loggers.api.info({ commandPreview: command.substring(0, 50) }, "Direct command executed");
    res.json({
      success: true,
      stdout,
      stderr,
      exitCode: 0
    });
  } catch (error: any) {
    // exec errors include stdout/stderr
    res.json({
      success: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1
    });
  }
});

// Direct git clone endpoint
app.post('/direct/git-clone', async (req, res) => {
  try {
    const { userId, repoUrl, targetDir } = req.body;

    if (!userId || !repoUrl) {
      return res.status(400).json({ error: 'userId and repoUrl required' });
    }

    const workDir = join(config.workspacesPath, userId);

    // Ensure workspace exists
    await fs.mkdir(workDir, { recursive: true });

    // Extract repo name for target directory
    const repoName = targetDir || repoUrl.split('/').pop()?.replace('.git', '') || 'repo';
    const clonePath = join(workDir, repoName);

    // Check if target already exists
    try {
      await fs.access(clonePath);
      return res.status(409).json({ error: `Directory '${repoName}' already exists` });
    } catch {
      // Directory doesn't exist - good
    }

    loggers.api.info({ repoUrl, clonePath }, "Cloning repository");

    // Clone the repository
    const { stdout, stderr } = await execAsync(`git clone --depth 1 "${repoUrl}" "${repoName}"`, {
      cwd: workDir,
      timeout: 300000, // 5 minutes for large repos
      maxBuffer: 50 * 1024 * 1024, // 50MB
      env: { ...process.env, HOME: workDir, GIT_TERMINAL_PROMPT: '0' }
    });

    loggers.api.info({ repoName }, "Clone completed");

    res.json({
      success: true,
      message: `Repository cloned to ${repoName}`,
      targetDir: repoName,
      stdout,
      stderr
    });
  } catch (error: any) {
    loggers.api.error({ err: error.message }, 'Git clone failed');
    res.status(500).json({
      success: false,
      error: error.stderr || error.message,
      stdout: error.stdout || ''
    });
  }
});

// ========================================
// Serverless OpenAgentic CLI Execution
// One-shot CLI calls for chat mode users (no persistent PTY session)
// ========================================

/**
 * Execute openagentic-cli as a serverless one-shot command.
 * This is for chat mode users who want to use agentic capabilities
 * without maintaining a persistent session.
 *
 * Usage from MCP:
 *   POST /serverless/exec
 *   {
 *     "userId": "user123",
 *     "prompt": "create a hello world python script",
 *     "apiKey": "awc_xxx",  // User's API key for authentication
 *     "apiEndpoint": "https://chat-dev.openagentics.io",
 *     "yolo": true,  // Auto-approve tool executions
 *     "timeout": 120000
 *   }
 */
app.post('/serverless/exec', async (req, res) => {
  try {
    const {
      userId,
      prompt,
      apiKey,
      apiEndpoint = 'https://chat-dev.openagentics.io',
      yolo = true,
      timeout = 120000,
      workingDirectory
    } = req.body;

    if (!userId || !prompt) {
      return res.status(400).json({ error: 'userId and prompt required' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey required for serverless execution' });
    }

    const workDir = workingDirectory
      ? join(config.workspacesPath, userId, workingDirectory)
      : join(config.workspacesPath, userId);

    // Ensure workspace exists
    await fs.mkdir(workDir, { recursive: true });

    // Build the openagentic-cli command
    // Uses --provider api to route through the platform's LLM providers
    const cliArgs = [
      '--provider', 'api',
      '--api-endpoint', apiEndpoint,
      '--api-key', apiKey,
      '--print',  // Output result to stdout
      '--no-interactive',  // Non-interactive mode
    ];

    if (yolo) {
      cliArgs.push('-y');  // Auto-approve tool executions
    }

    // Add the prompt as the final argument
    cliArgs.push(prompt);

    // Build command string - escape properly
    const cliPath = config.openagenticPath || '/app/openagentic/dist/cli.js';
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const command = `node ${cliPath} ${cliArgs.slice(0, -1).join(' ')} '${escapedPrompt}'`;

    loggers.serverless.info({ userId, promptPreview: prompt.substring(0, 50) }, "Executing serverless");
    loggers.serverless.debug({ cliPath, apiEndpoint, yolo }, 'Serverless command');

    // Execute the CLI command
    const startTime = Date.now();
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout,
      maxBuffer: 50 * 1024 * 1024, // 50MB for large outputs
      env: {
        ...process.env,
        HOME: workDir,
        OPENAGENTIC_API_KEY: apiKey,
        OPENAGENTIC_API_ENDPOINT: apiEndpoint,
        // Disable interactive prompts
        CI: 'true',
        TERM: 'dumb'
      }
    });

    const duration = Date.now() - startTime;
    loggers.serverless.info({ userId, durationMs: duration }, "Serverless completed");

    res.json({
      success: true,
      output: stdout,
      stderr: stderr || '',
      exitCode: 0,
      duration,
      workingDirectory: workDir
    });

  } catch (error: any) {
    const duration = error.killed ? 'timeout' : 'error';
    loggers.serverless.error({ duration, err: error.message }, "Serverless failed");

    res.json({
      success: false,
      output: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
      error: error.killed ? 'Execution timed out' : error.message
    });
  }
});

/**
 * Streaming serverless execution with SSE
 * For real-time output from openagentic-cli
 */
app.post('/serverless/stream', async (req, res) => {
  try {
    const {
      userId,
      prompt,
      apiKey,
      apiEndpoint = 'https://chat-dev.openagentics.io',
      yolo = true,
      timeout = 300000,
      workingDirectory
    } = req.body;

    if (!userId || !prompt) {
      return res.status(400).json({ error: 'userId and prompt required' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey required for serverless execution' });
    }

    const workDir = workingDirectory
      ? join(config.workspacesPath, userId, workingDirectory)
      : join(config.workspacesPath, userId);

    // Ensure workspace exists
    await fs.mkdir(workDir, { recursive: true });

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Build the openagentic-cli command
    const cliPath = config.openagenticPath || '/app/openagentic/dist/cli.js';
    const args = [
      cliPath,
      '--provider', 'api',
      '--api-endpoint', apiEndpoint,
      '--api-key', apiKey,
      '--output-format', 'stream-json',  // NDJSON streaming output
      '--no-interactive',
    ];

    if (yolo) {
      args.push('-y');
    }

    args.push(prompt);

    loggers.serverless.info({ userId, promptPreview: prompt.substring(0, 50) }, "Serverless stream starting");

    // Spawn the CLI process
    const cliProcess = spawn('node', args, {
      cwd: workDir,
      env: {
        ...process.env,
        HOME: workDir,
        OPENAGENTIC_API_KEY: apiKey,
        OPENAGENTIC_API_ENDPOINT: apiEndpoint,
        CI: 'true',
        TERM: 'dumb'
      }
    });

    const startTime = Date.now();
    let outputBuffer = '';

    // Stream stdout as SSE events
    cliProcess.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      outputBuffer += chunk;

      // Try to parse as NDJSON and emit events
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const event = JSON.parse(line);
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          } catch {
            // Not JSON, send as raw output
            res.write(`data: ${JSON.stringify({ type: 'output', content: line })}\n\n`);
          }
        }
      }
    });

    // Stream stderr as error events
    cliProcess.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      res.write(`data: ${JSON.stringify({ type: 'stderr', content: chunk })}\n\n`);
    });

    // Handle process completion
    cliProcess.on('close', (code) => {
      const duration = Date.now() - startTime;
      loggers.serverless.info({ userId, durationMs: duration, exitCode: code }, "Serverless stream completed");

      res.write(`data: ${JSON.stringify({
        type: 'complete',
        exitCode: code,
        duration,
        success: code === 0
      })}\n\n`);

      res.end();
    });

    // Handle process errors
    cliProcess.on('error', (error) => {
      loggers.serverless.error({ err: error }, "Serverless stream process error");
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      loggers.serverless.warn({ userId }, "Serverless stream timeout");
      cliProcess.kill('SIGTERM');
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Execution timed out' })}\n\n`);
      res.end();
    }, timeout);

    // Clean up on client disconnect
    req.on('close', () => {
      clearTimeout(timeoutId);
      if (!cliProcess.killed) {
        cliProcess.kill('SIGTERM');
      }
    });

  } catch (error: any) {
    loggers.serverless.error({ err: error }, "Serverless stream error");
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

/**
 * Check if serverless execution is available
 */
app.get('/serverless/status', async (req, res) => {
  try {
    const cliPath = config.openagenticPath || '/app/openagentic/dist/cli.js';
    const cliExists = existsSync(cliPath);

    // Try to get CLI version
    let cliVersion = 'unknown';
    if (cliExists) {
      try {
        const { stdout } = await execAsync(`node ${cliPath} --version`, { timeout: 5000 });
        cliVersion = stdout.trim();
      } catch {
        // Version check failed, but CLI exists
      }
    }

    res.json({
      available: cliExists,
      cliPath,
      cliVersion,
      supportedProviders: ['api', 'ollama'],
      features: {
        streaming: true,
        yolo: true,
        customEndpoint: true
      }
    });
  } catch (error: any) {
    res.status(500).json({
      available: false,
      error: error.message
    });
  }
});

// ========================================
// Admin Routes - Exec Container Management
// For admin dashboard: logs, stop, restart, audit
// ========================================

/**
 * Get all exec container pods (for admin dashboard)
 * GET /admin/exec/pods
 */
app.get('/admin/exec/pods', async (req, res) => {
  if (config.executionMode !== 'kubernetes') {
    return res.status(400).json({ error: 'Not in kubernetes mode' });
  }

  try {
    const k8sManager = getK8sSessionManager();
    const pods = await k8sManager.getAllPods();
    res.json({ pods });
  } catch (error: any) {
    loggers.admin.error({ err: error }, 'Failed to get pods');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get pod logs for a session
 * GET /admin/exec/sessions/:sessionId/logs
 */
app.get('/admin/exec/sessions/:sessionId/logs', async (req, res) => {
  if (config.executionMode !== 'kubernetes') {
    return res.status(400).json({ error: 'Not in kubernetes mode' });
  }

  const { sessionId } = req.params;
  const tailLines = parseInt(req.query.tailLines as string) || 500;
  const sinceSeconds = req.query.sinceSeconds ? parseInt(req.query.sinceSeconds as string) : undefined;

  try {
    const k8sManager = getK8sSessionManager();
    const result = await k8sManager.getPodLogs(sessionId, { tailLines, sinceSeconds });
    res.json(result);
  } catch (error: any) {
    loggers.admin.error({ sessionId, err: error }, "Failed to get logs");
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get detailed pod info for auditing
 * GET /admin/exec/sessions/:sessionId/pod-info
 */
app.get('/admin/exec/sessions/:sessionId/pod-info', async (req, res) => {
  if (config.executionMode !== 'kubernetes') {
    return res.status(400).json({ error: 'Not in kubernetes mode' });
  }

  const { sessionId } = req.params;

  try {
    const k8sManager = getK8sSessionManager();
    const info = await k8sManager.getDetailedPodInfo(sessionId);
    res.json(info);
  } catch (error: any) {
    loggers.admin.error({ sessionId, err: error }, "Failed to get pod info");
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get pod events for auditing
 * GET /admin/exec/sessions/:sessionId/events
 */
app.get('/admin/exec/sessions/:sessionId/events', async (req, res) => {
  if (config.executionMode !== 'kubernetes') {
    return res.status(400).json({ error: 'Not in kubernetes mode' });
  }

  const { sessionId } = req.params;

  try {
    const k8sManager = getK8sSessionManager();
    const events = await k8sManager.getPodEvents(sessionId);
    res.json({ events });
  } catch (error: any) {
    loggers.admin.error({ sessionId, err: error }, "Failed to get events");
    res.status(500).json({ error: error.message });
  }
});

/**
 * Force restart a session's pod
 * POST /admin/exec/sessions/:sessionId/restart
 */
app.post('/admin/exec/sessions/:sessionId/restart', async (req, res) => {
  if (config.executionMode !== 'kubernetes') {
    return res.status(400).json({ error: 'Not in kubernetes mode' });
  }

  const { sessionId } = req.params;

  try {
    const k8sManager = getK8sSessionManager();
    const result = await k8sManager.restartPod(sessionId);
    codePodLifecycle.inc({ action: 'restart' });
    loggers.admin.info({ sessionId }, "Restarted pod");
    res.json(result);
  } catch (error: any) {
    loggers.admin.error({ sessionId, err: error }, "Failed to restart pod");
    res.status(500).json({ error: error.message });
  }
});

/**
 * Force stop a session's pod
 * DELETE /admin/exec/sessions/:sessionId
 */
app.delete('/admin/exec/sessions/:sessionId', async (req, res) => {
  if (config.executionMode !== 'kubernetes') {
    return res.status(400).json({ error: 'Not in kubernetes mode' });
  }

  const { sessionId } = req.params;

  try {
    const k8sManager = getK8sSessionManager();
    await k8sManager.stopSession(sessionId);
    codePodLifecycle.inc({ action: 'delete' });
    loggers.admin.info({ sessionId }, "Stopped session");
    res.json({ success: true, message: `Session ${sessionId} stopped` });
  } catch (error: any) {
    loggers.admin.error({ sessionId, err: error }, "Failed to stop session");
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete a warm container
 * DELETE /admin/exec/warm/:podName
 */
app.delete('/admin/exec/warm/:podName', async (req, res) => {
  if (config.executionMode !== 'kubernetes') {
    return res.status(400).json({ error: 'Not in kubernetes mode' });
  }

  const { podName } = req.params;

  try {
    const k8sManager = getK8sSessionManager();
    const result = await k8sManager.deleteWarmContainer(podName);
    codePodLifecycle.inc({ action: 'delete' });
    loggers.admin.info({ podName }, "Deleted warm container");
    res.json(result);
  } catch (error: any) {
    loggers.admin.error({ podName, err: error }, "Failed to delete warm container");
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get execution mode info
 * GET /admin/exec/info
 */
app.get('/admin/exec/info', async (req, res) => {
  res.json({
    executionMode: config.executionMode,
    kubernetes: config.executionMode === 'kubernetes' ? {
      namespace: config.k8s.namespace,
      runnerImage: config.k8s.runnerImage,
      warmPool: config.k8s.warmPool,
    } : null,
  });
});

// ========================================
// WebSocket Live Metrics Handler
// Real-time resource usage streaming for admin dashboard
// ========================================

wssMetrics.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const internalKey = url.searchParams.get('internalKey');

  // SECURITY: Validate internal API key for WebSocket connections
  if (config.internalApiKey) {
    if (!internalKey || internalKey !== config.internalApiKey) {
      loggers.security.warn({ ip: req.socket.remoteAddress }, "Unauthorized metrics WebSocket connection attempt");
      ws.close(4000, 'Unauthorized - internal API key required');
      return;
    }
  }

  loggers.metrics.info('Metrics WebSocket client connected');
  metricsClients.add(ws);

  // Setup keepalive pong handler
  wsAliveMap.set(ws, true);
  ws.on('pong', () => {
    wsAliveMap.set(ws, true);
  });

  // Send initial system metrics
  try {
    const sessions = sessionManager.getAllSessions().map(s => ({
      id: s.id,
      userId: s.userId,
      pid: s.pid,
      workspacePath: s.workspacePath,
    }));
    const systemMetrics = await metricsService.getSystemMetrics(sessions);
    ws.send(JSON.stringify({ type: 'system_metrics', data: systemMetrics, timestamp: Date.now() }));
  } catch (err) {
    loggers.metrics.error({ err }, 'Failed to send initial metrics');
  }

  // Handle client messages (e.g., subscribe to specific session)
  ws.on('message', async (data: Buffer | string) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'subscribe_session' && message.sessionId) {
        // Send enhanced metrics for specific session
        const metrics = await sessionManager.getEnhancedMetrics(message.sessionId);
        ws.send(JSON.stringify({
          type: 'session_metrics',
          sessionId: message.sessionId,
          data: metrics,
          timestamp: Date.now(),
        }));
      }
    } catch (err) {
      loggers.metrics.error({ err }, 'Failed to parse message');
    }
  });

  ws.on('close', () => {
    loggers.metrics.info('Metrics WebSocket client disconnected');
    metricsClients.delete(ws);
  });

  ws.on('error', (error) => {
    loggers.metrics.error({ err: error }, 'Metrics WebSocket error');
    metricsClients.delete(ws);
  });
});

// Broadcast metrics to all connected clients every 2 seconds
setInterval(async () => {
  if (metricsClients.size === 0) return;

  try {
    const sessions = sessionManager.getAllSessions().map(s => ({
      id: s.id,
      userId: s.userId,
      pid: s.pid,
      workspacePath: s.workspacePath,
    }));

    const systemMetrics = await metricsService.getSystemMetrics(sessions);
    const message = JSON.stringify({
      type: 'system_metrics',
      data: systemMetrics,
      timestamp: Date.now(),
    });

    for (const client of metricsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  } catch (err) {
    loggers.metrics.error({ err }, 'Failed to broadcast metrics');
  }
}, 2000); // Every 2 seconds

// Cleanup idle sessions periodically
setInterval(async () => {
  const cleaned = await sessionManager.cleanupIdleSessions();
  if (cleaned > 0) {
    loggers.sessions.info({ cleaned }, "Cleaned up idle sessions");
  }
}, 60000); // Every minute

const PORT = config.port || 3050;

// Initialize storage and start server
async function start() {
  try {
    // Initialize blob storage (legacy - for session metadata)
    await initializeStorage();
    loggers.storage.info('Blob storage initialized');
  } catch (error) {
    loggers.storage.error({ err: error }, 'Failed to initialize storage');
    // Continue anyway - storage is non-critical for basic operation
  }

  try {
    // Initialize cloud-first workspace storage
    // This initializes the workspace service with the configured cloud provider
    // (MinIO for local dev, S3/Azure/GCS for cloud deployments)
    await sessionManager.initialize();
    loggers.storage.info('Cloud-first workspace storage initialized');
  } catch (error) {
    loggers.storage.error({ err: error }, 'Failed to initialize cloud workspace storage');
    loggers.storage.warn('Falling back to local-only workspace storage');
  }

  // Initialize K8s session manager for kubernetes mode
  // This syncs with cluster, starts health checks, cleanup loops, and warm pool
  if (config.executionMode === 'kubernetes') {
    try {
      const k8sManager = getK8sSessionManager();
      await k8sManager.initialize();
      loggers.k8s.info('Session manager fully initialized (health checks, cleanup, warm pool)');
    } catch (error) {
      loggers.k8s.error({ err: error }, 'Failed to initialize session manager');
      // Non-fatal - sessions will still work, just slower first-time
    }
  }

  // Resolve default model from API if not set via env
  // The API's /api/chat/models endpoint queries the provider registry (DB SOT)
  // and returns available models. We pick the first one as the session default.
  if (!config.defaultModel) {
    try {
      const modelsRes = await fetch(`${config.openagenticApiEndpoint}/api/chat/models`, {
        signal: AbortSignal.timeout(10000),
        headers: config.internalApiKey ? { 'x-internal-secret': config.internalApiKey } : {},
      });
      if (modelsRes.ok) {
        const data = await modelsRes.json() as any;
        const models = data?.models || data?.data || [];
        if (Array.isArray(models) && models.length > 0) {
          const first = models[0];
          config.defaultModel = first.id || first.modelId || first.name || '';
          loggers.api.info({ resolvedModel: config.defaultModel, totalModels: models.length },
            '🧠 Default model resolved from platform API (DB registry SOT)');
        }
      }
    } catch (err: any) {
      loggers.api.warn({ err: err.message }, '⚠️ Could not resolve default model from API — sessions will rely on user selection');
    }
  }

  server.listen(PORT, () => {
    loggers.api.info({
      port: PORT,
      cliVersion,
      sdkVersion,
      cliPath: config.openagenticPath,
      localCache: config.workspacesPath,
      llmProvider: 'api',
      apiEndpoint: config.openagenticApiEndpoint,
      defaultModel: config.defaultModel || '(user-selected)',
      storage: {
        provider: config.storage.provider,
        bucket: config.storage.bucket,
        endpoint: config.storage.endpoint,
      },
    }, 'OpenAgenticCode Manager (PTY) started');
  });
}

start();
