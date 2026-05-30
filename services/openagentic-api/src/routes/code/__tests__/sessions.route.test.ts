import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import codeSessionsRoutes from '../sessions.js';

function build(execClient: any, user: any, codeModeSettings?: any) {
  const app = Fastify();
  app.addHook('onRequest', async (req: any) => {
    req.user = user;
  });
  app.register(codeSessionsRoutes, {
    execClient,
    codeModeSettings: codeModeSettings ?? {
      setCodeModeSettings: vi.fn(),
      getCodeModeSettings: vi.fn(),
    },
  });
  return app;
}

describe('POST /sessions', () => {
  it('creates a session for an authed user', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const execClient = {
      createSession: vi.fn().mockResolvedValue({
        sessionId: 'x',
        userId: 'u1',
        status: 'running',
        workspacePath: '/workspaces/u1/x',
        pid: 7,
        createdAt: 1,
      }),
    };
    const app = build(execClient, { id: 'u1', email: 'u1@x' });
    const r = await app.inject({ method: 'POST', url: '/sessions', payload: { model: '' } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.status).toBe('running');
    expect(body.workspacePath).toContain('/workspaces/u1/');
    expect(execClient.createSession).toHaveBeenCalledOnce();
    const arg = execClient.createSession.mock.calls[0][0];
    expect(arg.userId).toBe('u1');
    expect(typeof arg.authToken).toBe('string');
    expect(arg.authToken.length).toBeGreaterThan(10);
  });

  it('returns 401 without a user', async () => {
    const app = build({ createSession: vi.fn() }, undefined);
    const r = await app.inject({ method: 'POST', url: '/sessions', payload: {} });
    expect(r.statusCode).toBe(401);
  });

  it('includes repoUrl in the response body', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const execClient = {
      createSession: vi.fn().mockResolvedValue({
        sessionId: 'sess1',
        userId: 'u2',
        status: 'running',
        workspacePath: '/workspaces/u2/sess1',
        pid: 8,
        createdAt: 2,
      }),
    };
    const app = build(execClient, { id: 'u2', email: 'u2@x' });
    const r = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { model: 'claude-opus', repoUrl: 'https://github.com/org/repo' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.repoUrl).toBe('https://github.com/org/repo');
  });

  it('passes userEmail to exec client', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const execClient = {
      createSession: vi.fn().mockResolvedValue({
        sessionId: 'abc',
        userId: 'u3',
        status: 'running',
        workspacePath: '/workspaces/u3/abc',
        pid: 9,
        createdAt: 3,
      }),
    };
    const app = build(execClient, { id: 'u3', email: 'u3@test.com' });
    await app.inject({ method: 'POST', url: '/sessions', payload: {} });
    const arg = execClient.createSession.mock.calls[0][0];
    expect(arg.userEmail).toBe('u3@test.com');
  });

  it('calls setCodeModeSettings with lastModel and lastWorkspace', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const execClient = {
      createSession: vi.fn().mockResolvedValue({
        sessionId: 'q1',
        userId: 'u4',
        status: 'running',
        workspacePath: '/workspaces/u4/q1',
        pid: 10,
        createdAt: 4,
      }),
    };
    const setCodeModeSettings = vi.fn().mockResolvedValue(undefined);
    const codeModeSettings = {
      setCodeModeSettings,
      getCodeModeSettings: vi.fn(),
    };
    const app = build(execClient, { id: 'u4', email: 'u4@x' }, codeModeSettings);
    await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { model: 'sonnet', repoUrl: 'https://github.com/x/y' },
    });
    expect(setCodeModeSettings).toHaveBeenCalledWith('u4', {
      lastModel: 'sonnet',
      lastWorkspace: 'https://github.com/x/y',
    });
  });

  it('reads userId from request.user.userId (alternate field)', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const execClient = {
      createSession: vi.fn().mockResolvedValue({
        sessionId: 'r1',
        userId: 'u5',
        status: 'running',
        workspacePath: '/workspaces/u5/r1',
        pid: 11,
        createdAt: 5,
      }),
    };
    // user has userId, not id
    const app = build(execClient, { userId: 'u5', email: 'u5@x' });
    const r = await app.inject({ method: 'POST', url: '/sessions', payload: {} });
    expect(r.statusCode).toBe(200);
    const arg = execClient.createSession.mock.calls[0][0];
    expect(arg.userId).toBe('u5');
  });
});

describe('GET /sessions/:id', () => {
  it('returns session details for authed user', async () => {
    const execClient = {
      getSession: vi.fn().mockResolvedValue({
        sessionId: 's1',
        userId: 'u1',
        status: 'running',
        workspacePath: '/workspaces/u1/s1',
        pid: 7,
        createdAt: 1,
      }),
    };
    const app = build(execClient, { id: 'u1' });
    const r = await app.inject({ method: 'GET', url: '/sessions/s1' });
    expect(r.statusCode).toBe(200);
    expect(r.json().sessionId).toBe('s1');
    expect(execClient.getSession).toHaveBeenCalledWith('s1');
  });

  it('returns 401 without a user', async () => {
    const app = build({ getSession: vi.fn() }, undefined);
    const r = await app.inject({ method: 'GET', url: '/sessions/s1' });
    expect(r.statusCode).toBe(401);
  });

  it('returns 404 when exec client throws not-found', async () => {
    const execClient = {
      getSession: vi.fn().mockRejectedValue(new Error('status 404')),
    };
    const app = build(execClient, { id: 'u1' });
    const r = await app.inject({ method: 'GET', url: '/sessions/missing' });
    expect(r.statusCode).toBe(404);
  });
});

describe('DELETE /sessions/:id', () => {
  it('stops the session', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const app = build({ stopSession: stop }, { id: 'u1' });
    const r = await app.inject({ method: 'DELETE', url: '/sessions/s1' });
    expect(r.statusCode).toBe(200);
    expect(stop).toHaveBeenCalledWith('s1');
    expect(r.json()).toEqual({ stopped: true });
  });

  it('returns 401 without a user', async () => {
    const app = build({ stopSession: vi.fn() }, undefined);
    const r = await app.inject({ method: 'DELETE', url: '/sessions/s1' });
    expect(r.statusCode).toBe(401);
  });
});

describe('POST /sessions/:id/resize', () => {
  it('proxies resize to exec client and returns ok', async () => {
    const resize = vi.fn().mockResolvedValue(undefined);
    const app = build({ resize }, { id: 'u1' });
    const r = await app.inject({
      method: 'POST',
      url: '/sessions/s1/resize',
      payload: { cols: 120, rows: 40 },
    });
    expect(r.statusCode).toBe(200);
    expect(resize).toHaveBeenCalledWith('s1', 120, 40);
    expect(r.json()).toEqual({ ok: true });
  });

  it('returns 401 without a user', async () => {
    const app = build({ resize: vi.fn() }, undefined);
    const r = await app.inject({
      method: 'POST',
      url: '/sessions/s1/resize',
      payload: { cols: 80, rows: 24 },
    });
    expect(r.statusCode).toBe(401);
  });
});
