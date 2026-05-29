import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs'; import { tmpdir } from 'os'; import { join } from 'path';
import { PtyManager } from '../ptyManager.js';
describe('PtyManager (integration, fake claude)', () => {
  it('creates a session and streams PTY output', async () => {
    const ws = await fs.mkdtemp(join(tmpdir(), 'ws-'));
    const fake = join(ws, 'fakeclaude.sh');
    await fs.writeFile(fake, '#!/bin/sh\necho READY\ncat\n'); await fs.chmod(fake, 0o755);
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
});
