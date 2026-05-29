import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs'; import { tmpdir } from 'os'; import { join } from 'path';
let base: string; let stop: () => Promise<void>; let ws: string;
beforeAll(async () => {
  ws = await fs.mkdtemp(join(tmpdir(), 'wsroot-'));
  const fake = join(ws, 'fakeclaude.sh');
  await fs.writeFile(fake, '#!/bin/sh\necho READY\ncat\n'); await fs.chmod(fake, 0o755);
  process.env.PORT = '0'; process.env.INTERNAL_API_KEY = 'k1';
  process.env.WORKSPACES_PATH = ws; process.env.CLAUDE_PATH = fake;
  const { startServer } = await import('../index.js');
  const srv = await startServer(); base = `http://127.0.0.1:${srv.port}`; stop = srv.stop;
});
afterAll(async () => { await stop(); });
it('GET /health is public and healthy', async () => {
  const r = await fetch(`${base}/health`); expect(r.status).toBe(200);
  expect((await r.json()).status).toBe('healthy');
});
it('rejects session create without internal key', async () => {
  const r = await fetch(`${base}/sessions`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ sessionId:'s1', userId:'u1', workspacePath: join(ws,'u1') }) });
  expect(r.status).toBe(401);
});
it('creates a session with internal key', async () => {
  const r = await fetch(`${base}/sessions`, { method:'POST',
    headers:{'content-type':'application/json','x-internal-api-key':'k1'},
    body: JSON.stringify({ sessionId:'s2', userId:'u1', workspacePath: join(ws,'u1'),
      authToken:'t', apiEndpoint:'http://api:8000', model:'' }) });
  expect(r.status).toBe(200);
  const b = await r.json(); expect(b.sessionId).toBe('s2'); expect(b.pid).toBeGreaterThan(0);
});
