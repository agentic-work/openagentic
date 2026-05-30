import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs'; import { tmpdir } from 'os'; import { join } from 'path';
import { PtyManager } from '../ptyManager.js';

// A fake "claude" that emits the two first-run dialog prompts and reads a line
// after each — so if PtyManager auto-presses the accept key, the fake echoes an
// ACK we can assert on. Proves the event-driven onboarding auto-accept works.
describe('PtyManager onboarding auto-accept', () => {
  it('auto-dismisses the trust + bypass-permissions dialogs', async () => {
    const ws = await fs.mkdtemp(join(tmpdir(), 'oa-'));
    const fake = join(ws, 'fakeclaude.sh');
    await fs.writeFile(fake,
      '#!/bin/sh\n' +
      'echo "Is this a project you created or one you trust? trust this folder"\n' +
      'read a; echo "ACK_TRUST"\n' +
      'echo "WARNING: Claude Code running in Bypass Permissions mode"\n' +
      'read b; echo "ACK_BYPASS"\n' +
      'cat\n');
    await fs.chmod(fake, 0o755);

    const mgr = new PtyManager({ claudePath: fake }); // autoDismiss defaults on
    let out = '';
    const s = await mgr.createSession({ sessionId: 'a1', userId: 'u1', workspacePath: ws,
      apiEndpoint: 'http://api:8000', authToken: 't', model: '', home: ws });
    mgr.onData('a1', d => { out += d; });
    expect(s.pid).toBeGreaterThan(0);

    await new Promise(r => setTimeout(r, 2500));
    expect(out).toContain('ACK_TRUST');   // PtyManager pressed Enter on the trust dialog
    expect(out).toContain('ACK_BYPASS');  // PtyManager pressed Yes on the bypass dialog
    await mgr.stopSession('a1');
  });

  it('does not inject keystrokes when autoDismissOnboarding is false', async () => {
    const ws = await fs.mkdtemp(join(tmpdir(), 'oa-'));
    const fake = join(ws, 'fakeclaude.sh');
    await fs.writeFile(fake,
      '#!/bin/sh\necho "trust this folder"\nread a; echo "ACK_TRUST"\ncat\n');
    await fs.chmod(fake, 0o755);
    const mgr = new PtyManager({ claudePath: fake, autoDismissOnboarding: false });
    let out = '';
    await mgr.createSession({ sessionId: 'a2', userId: 'u1', workspacePath: ws,
      apiEndpoint: 'http://api:8000', authToken: 't', model: '', home: ws });
    mgr.onData('a2', d => { out += d; });
    await new Promise(r => setTimeout(r, 1500));
    expect(out).toContain('trust this folder');
    expect(out).not.toContain('ACK_TRUST'); // no auto key press → fake still blocked on read
    await mgr.stopSession('a2');
  });
});
