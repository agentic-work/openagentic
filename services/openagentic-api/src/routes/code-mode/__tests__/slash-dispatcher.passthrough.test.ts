/**
 * slash-dispatcher.passthrough — proves the new contract.
 *
 * Phase 0 of the codemode-bridge plan: rip the static stubs that
 * shipped in 4aa49b1d. The api relay must forward every slash command
 * to the in-pod openagentic daemon — which has the REAL handlers
 * (`tryDispatchHeadlessSlashCommand`, `installPluginsForHeadless`,
 * `getAllMcpConfigs`, `loadSkillsDir`). The api may only intercept
 * commands that are PURELY browser-local: `/exit` (close the WS) and
 * `/clear` (purge browser-side transcript without round-tripping).
 *
 * Everything else — /help, /agents, /skills, /mcp, /status, /cost,
 * /config, /context, /permissions, /theme, /login, /logout, /plan,
 * /resume, /btw, /model, /compact, /plugin*, plain text, unknown
 * /xxx — must return false from interceptSlashCommand so the
 * relay's pod-forward path runs and the daemon answers.
 */

import { describe, it, expect, vi } from 'vitest';
import { interceptSlashCommand } from '../slash-dispatcher.js';

function makeWs() {
  return { readyState: 1, send: vi.fn(), close: vi.fn() };
}
function ctx(ws: { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }) {
  return { sessionId: 'sess-pt', userId: 'u-pt', browserWs: ws as any };
}

describe('slash-dispatcher passthrough — Phase 0 contract', () => {
  const passthrough = [
    '/help',
    '/agents',
    '/skills',
    '/mcp',
    '/status',
    '/cost',
    '/config',
    '/context',
    '/permissions',
    '/theme',
    '/login',
    '/logout',
    '/plan',
    '/remote-control',
    '/resume',
    '/btw',
    '/model',
    '/model gpt-oss-120b',
    '/compact',
    '/plugin marketplace add anthropics/claude-plugins-official',
    '/plugin install superpowers',
    '/foobar',
    '/xyz unknown command',
  ];

  for (const cmd of passthrough) {
    it(`returns false (forwards to daemon) for ${JSON.stringify(cmd)}`, () => {
      const ws = makeWs();
      const result = interceptSlashCommand(cmd, ctx(ws));
      expect(result).toBe(false);
      expect(ws.send).not.toHaveBeenCalled();
    });
  }

  it('returns false for plain text', () => {
    const ws = makeWs();
    expect(interceptSlashCommand('hello world', ctx(ws))).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('returns false for empty string', () => {
    const ws = makeWs();
    expect(interceptSlashCommand('', ctx(ws))).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
  });
});

describe('slash-dispatcher local-only — /exit + /clear', () => {
  it('intercepts /exit and closes the WS with code 1000', () => {
    const ws = makeWs();
    const result = interceptSlashCommand('/exit', ctx(ws));
    expect(result).toBe(true);
    expect(ws.close).toHaveBeenCalledWith(1000, expect.any(String));
  });

  it('intercepts /clear and emits a synthetic result frame', () => {
    const ws = makeWs();
    const result = interceptSlashCommand('/clear', ctx(ws));
    expect(result).toBe(true);
    expect(ws.send).toHaveBeenCalled();
    const frames = ws.send.mock.calls.map((c) => JSON.parse(String(c[0])));
    const last = frames[frames.length - 1];
    expect(last.type).toBe('result');
    expect(last.is_error).toBe(false);
  });
});

describe('slash-dispatcher JSON envelope passthrough', () => {
  it('forwards JSON-wrapped slash commands the same way as raw text', () => {
    const ws = makeWs();
    const envelope = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: '/help' },
    });
    expect(interceptSlashCommand(envelope, ctx(ws))).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
  });
});
