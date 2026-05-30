import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs'; import { tmpdir } from 'os'; import { join } from 'path';
import { PtyManager } from '../ptyManager.js';

async function makeFakeClaude(dir: string): Promise<string> {
  const fake = join(dir, 'fakeclaude.sh');
  await fs.writeFile(fake, '#!/bin/sh\necho READY\ncat\n');
  await fs.chmod(fake, 0o755);
  return fake;
}

describe('PtyManager (integration, fake claude)', () => {
  it('creates a session and streams PTY output', async () => {
    const ws = await fs.mkdtemp(join(tmpdir(), 'ws-'));
    const fake = await makeFakeClaude(ws);
    const mgr = new PtyManager({ claudePath: fake });
    const out: string[] = [];
    const s = await mgr.createSession({ sessionId: 's1', userId: 'u1', workspacePath: ws,
      apiEndpoint: 'http://api:8000', authToken: 't', model: '', home: ws });
    mgr.onData('s1', d => out.push(d));
    await new Promise(r => setTimeout(r, 300));
    expect(s.pid).toBeGreaterThan(0);
    expect(out.join('')).toContain('READY');
    mgr.write('s1', 'hello\n');
    await new Promise(r => setTimeout(r, 200));
    expect(out.join('')).toContain('hello');
    await mgr.stopSession('s1');
    expect(mgr.getStatus('s1')).toBe('stopped');
  });

  // C2: removeListener — only remaining listener should fire
  it('removeListener stops the removed listener from receiving data', async () => {
    const ws = await fs.mkdtemp(join(tmpdir(), 'ws-'));
    const fake = await makeFakeClaude(ws);
    const mgr = new PtyManager({ claudePath: fake });
    await mgr.createSession({ sessionId: 'rl1', userId: 'u1', workspacePath: ws,
      apiEndpoint: 'http://api:8000', authToken: 't', model: '', home: ws });
    await new Promise(r => setTimeout(r, 300)); // let READY flush

    const calls1: string[] = [];
    const calls2: string[] = [];
    const cb1 = (d: string) => calls1.push(d);
    const cb2 = (d: string) => calls2.push(d);

    mgr.onData('rl1', cb1);
    mgr.onData('rl1', cb2);

    // Remove cb1 — only cb2 should receive subsequent data
    mgr.removeListener('rl1', cb1);

    // Write data and wait for it
    mgr.write('rl1', 'ping\n');
    await new Promise(r => setTimeout(r, 300));

    expect(calls2.join('')).toContain('ping');
    expect(calls1.join('')).toBe('');

    await mgr.stopSession('rl1');
  });

  // I1: stopped session can be recreated (new process, new pid)
  it('allows recreating a session after it is stopped', async () => {
    const ws = await fs.mkdtemp(join(tmpdir(), 'ws-'));
    const fake = await makeFakeClaude(ws);
    const mgr = new PtyManager({ claudePath: fake });

    const s1 = await mgr.createSession({ sessionId: 'r1', userId: 'u1', workspacePath: ws,
      apiEndpoint: 'http://api:8000', authToken: 't', model: '', home: ws });
    const pid1 = s1.pid;
    expect(pid1).toBeGreaterThan(0);

    await mgr.stopSession('r1');
    expect(mgr.getStatus('r1')).toBe('stopped');

    // Recreate — should get a fresh session with a new pid
    const s2 = await mgr.createSession({ sessionId: 'r1', userId: 'u1', workspacePath: ws,
      apiEndpoint: 'http://api:8000', authToken: 't', model: '', home: ws });
    expect(s2.pid).toBeGreaterThan(0);
    expect(s2.pid).not.toBe(pid1);
    expect(mgr.getStatus('r1')).toBe('running');

    await mgr.stopSession('r1');
  });
});
