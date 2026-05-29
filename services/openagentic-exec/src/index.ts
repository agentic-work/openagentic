import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import crypto from 'crypto';

import { loadConfig } from './config.js';
import { writeClaudeSettings } from './claudeSettings.js';
import { PtyManager } from './ptyManager.js';

export async function startServer(): Promise<{ port: number; stop: () => Promise<void> }> {
  const config = loadConfig();
  const ptyManager = new PtyManager({ claudePath: config.claudePath });

  const app = express();
  app.use(express.json());

  // ─── Internal-key middleware (all routes except GET /health) ────────────
  const validateAuth = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void => {
    if (req.method === 'GET' && req.path === '/health') {
      next();
      return;
    }

    if (!config.internalApiKey) {
      res.status(503).json({ error: 'Service misconfigured: INTERNAL_API_KEY required' });
      return;
    }

    const internalKeyHeader = req.headers['x-internal-api-key'];
    const authHeader = req.headers['authorization'];

    let provided: string | undefined;
    if (internalKeyHeader) {
      provided = Array.isArray(internalKeyHeader) ? internalKeyHeader[0] : internalKeyHeader;
    } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      provided = authHeader.slice(7);
    } else if (typeof authHeader === 'string' && authHeader.startsWith('Internal ')) {
      provided = authHeader.slice(9);
    }

    if (!provided) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // timing-safe compare when lengths match; length mismatch → reject
    const expected = config.internalApiKey;
    let ok = false;
    if (provided.length === expected.length) {
      try {
        ok = crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
      } catch {
        ok = false;
      }
    }

    if (!ok) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    next();
  };

  app.use(validateAuth);

  // ─── GET /health ─────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      activeSessions: ptyManager.getAllSessions().length,
      config: {
        sandboxEnabled: config.sandboxEnabled,
        workspacesPath: config.workspacesPath,
      },
    });
  });

  // ─── POST /sessions ───────────────────────────────────────────────────────
  app.post('/sessions', async (req, res) => {
    const { sessionId, userId, userEmail, workspacePath: rawWorkspacePath, model, apiKey, authToken, apiEndpoint } = req.body || {};

    if (!sessionId || !userId || !rawWorkspacePath) {
      res.status(400).json({ error: 'sessionId, userId, and workspacePath are all required' });
      return;
    }

    // Path traversal guard: resolved path must be within workspacesPath
    const resolvedWorkspace = resolve(rawWorkspacePath);
    const resolvedRoot = resolve(config.workspacesPath);
    if (!resolvedWorkspace.startsWith(resolvedRoot + '/') && resolvedWorkspace !== resolvedRoot) {
      res.status(403).json({ error: 'workspacePath is outside allowed workspacesPath' });
      return;
    }

    try {
      await fs.mkdir(resolvedWorkspace, { recursive: true });
      await writeClaudeSettings(resolvedWorkspace, { model: model || undefined });

      const s = await ptyManager.createSession({
        sessionId,
        userId,
        userEmail: userEmail || undefined,
        workspacePath: resolvedWorkspace,
        home: resolvedWorkspace,
        model: model || '',
        apiEndpoint: apiEndpoint || config.apiEndpoint,
        authToken: authToken || apiKey || '',
      });

      res.json({
        sessionId: s.sessionId,
        userId: s.userId,
        status: s.status,
        workspacePath: s.workspacePath,
        pid: s.pid,
        createdAt: s.createdAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── GET /sessions/:id ────────────────────────────────────────────────────
  app.get('/sessions/:id', (req, res) => {
    const sessions = ptyManager.getAllSessions();
    const s = sessions.find(x => x.sessionId === req.params.id);
    if (!s) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(s);
  });

  // ─── DELETE /sessions/:id ─────────────────────────────────────────────────
  app.delete('/sessions/:id', async (req, res) => {
    try {
      await ptyManager.stopSession(req.params.id);
      res.json({ stopped: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── POST /sessions/:id/resize ────────────────────────────────────────────
  app.post('/sessions/:id/resize', (req, res) => {
    const { cols, rows } = req.body || {};
    ptyManager.resize(req.params.id, Number(cols), Number(rows));
    res.json({ ok: true });
  });

  // ─── POST /files/list ─────────────────────────────────────────────────────
  app.post('/files/list', async (req, res) => {
    const { userId, directory = '.', recursive = false } = req.body || {};

    if (!userId) {
      res.status(400).json({ error: 'userId required' });
      return;
    }

    const userRoot = join(config.workspacesPath, userId);
    const targetDir = join(userRoot, directory);

    // Traversal guard
    const resolvedTarget = resolve(targetDir);
    const resolvedUserRoot = resolve(userRoot);
    if (!resolvedTarget.startsWith(resolvedUserRoot + '/') && resolvedTarget !== resolvedUserRoot) {
      res.status(400).json({ error: 'directory is outside user workspace' });
      return;
    }

    try {
      const listDir = async (dir: string, basePath: string): Promise<Array<{ name: string; type: 'file' | 'directory'; path: string; size?: number }>> => {
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return [];
        }
        const results: Array<{ name: string; type: 'file' | 'directory'; path: string; size?: number }> = [];
        for (const entry of entries) {
          const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            results.push({ name: entry.name, type: 'directory', path: entryPath });
            if (recursive) {
              const children = await listDir(fullPath, entryPath);
              results.push(...children);
            }
          } else {
            const stats = await fs.stat(fullPath).catch(() => null);
            results.push({ name: entry.name, type: 'file', path: entryPath, size: stats?.size });
          }
        }
        return results;
      };

      const files = await listDir(targetDir, '');
      res.json({ success: true, files, workspacePath: userRoot });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ─── POST /files/read ─────────────────────────────────────────────────────
  app.post('/files/read', async (req, res) => {
    const { userId, filepath } = req.body || {};

    if (!userId || !filepath) {
      res.status(400).json({ error: 'userId and filepath required' });
      return;
    }

    const userRoot = join(config.workspacesPath, userId);
    const fullPath = join(userRoot, filepath);

    // Traversal guard
    const resolvedFull = resolve(fullPath);
    const resolvedUserRoot = resolve(userRoot);
    if (!resolvedFull.startsWith(resolvedUserRoot + '/') && resolvedFull !== resolvedUserRoot) {
      res.status(400).json({ error: 'filepath is outside user workspace' });
      return;
    }

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      res.json({ success: true, content, filepath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // ─── HTTP server + WebSocket ──────────────────────────────────────────────
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    const match = url.match(/^\/ws\/terminal\/([^/?]+)$/);
    if (!match) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (socket, req) => {
    const url = req.url || '';
    const match = url.match(/^\/ws\/terminal\/([^/?]+)$/);
    const sessionId = match ? match[1] : null;

    if (!sessionId || ptyManager.getStatus(sessionId) === 'unknown') {
      socket.close(1008, 'Session not found');
      return;
    }

    // Replay buffered output so late-connecting WS clients see prior output.
    // Use a short setTimeout (vs setImmediate) to let the client's 'message'
    // listener be registered after the 'open' event resolves its await.
    setTimeout(() => {
      const buffered = ptyManager.getOutputBuffer(sessionId);
      if (buffered && socket.readyState === socket.OPEN) {
        socket.send(buffered);
      }
    }, 20);

    ptyManager.onData(sessionId, (data: string) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(data);
      }
    });

    socket.on('message', (msg) => {
      ptyManager.write(sessionId, msg.toString());
    });
  });

  // ─── Listen ───────────────────────────────────────────────────────────────
  await new Promise<void>((resolvePromise, reject) => {
    httpServer.listen(config.port, '127.0.0.1', () => resolvePromise());
    httpServer.on('error', reject);
  });

  const address = httpServer.address();
  const actualPort = typeof address === 'object' && address ? address.port : config.port;

  // ─── stop() ───────────────────────────────────────────────────────────────
  const stop = (): Promise<void> => {
    return new Promise((resolveStop) => {
      const sessions = ptyManager.getAllSessions();
      const stopPromises = sessions.map(s => ptyManager.stopSession(s.sessionId));

      Promise.allSettled(stopPromises).then(() => {
        // Terminate all open WS clients so wss.close() doesn't hang
        for (const client of wss.clients) {
          try { client.terminate(); } catch { /* ignore */ }
        }
        wss.close(() => {
          httpServer.closeAllConnections?.();
          httpServer.close(() => resolveStop());
        });
      });
    });
  };

  return { port: actualPort, stop };
}

// Boot when run directly
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
