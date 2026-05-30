import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs'; import { tmpdir } from 'os'; import { join } from 'path';
import WebSocket from 'ws';
let base: string; let wsBase: string; let stop: () => Promise<void>; let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'wsroot-'));
  const fake = join(root, 'fakeclaude.sh');
  await fs.writeFile(fake, '#!/bin/sh\necho READY\ncat\n'); await fs.chmod(fake, 0o755);
  process.env.PORT='0'; process.env.INTERNAL_API_KEY='k1'; process.env.WORKSPACES_PATH=root; process.env.CLAUDE_PATH=fake;
  process.env.CLAUDE_HOME = join(root, 'claudehome'); // writable home for claude config on the host
  const { startServer } = await import('../index.js');
  const srv = await startServer(); base=`http://127.0.0.1:${srv.port}`; wsBase=`ws://127.0.0.1:${srv.port}`; stop=srv.stop;
  await fetch(`${base}/sessions`, { method:'POST', headers:{'content-type':'application/json','x-internal-api-key':'k1'},
    body: JSON.stringify({ sessionId:'w1', userId:'u1', workspacePath: join(root,'u1'), authToken:'t', apiEndpoint:'http://api:8000', model:'' }) });
});
afterAll(async () => { await stop(); });

// C1: WS upgrade must enforce internal-key auth
it('rejects WS connection without internal key', async () => {
  const client = new WebSocket(`${wsBase}/ws/terminal/w1`);
  // The server should reject with 401 — ws client emits 'error' or 'close' without opening
  const result = await new Promise<'error' | 'close' | 'open'>((resolve) => {
    client.on('error', () => resolve('error'));
    client.on('close', () => resolve('close'));
    client.on('open', () => resolve('open'));
  });
  expect(result).not.toBe('open');
  try { client.terminate(); } catch { /* already closed */ }
});

// C1: WS upgrade must accept valid internal key
// I2: attach message listener BEFORE awaiting open so buffered bytes aren't missed
it('streams pty output and accepts input over /ws/terminal/:id', async () => {
  const client = new WebSocket(`${wsBase}/ws/terminal/w1`, { headers: { 'x-internal-api-key': 'k1' } });
  const chunks: string[] = [];
  // Attach message listener synchronously (before the open event fires) so we
  // don't miss any buffered output the server flushes on connection.
  client.on('message', d => chunks.push(d.toString()));
  await new Promise<void>((res, rej) => { client.on('open', () => res()); client.on('error', rej); });
  await new Promise(r => setTimeout(r, 400));
  expect(chunks.join('')).toContain('READY');
  client.send('echo hi\n');
  await new Promise(r => setTimeout(r, 400));
  expect(chunks.join('')).toContain('hi');
  client.close();
});
