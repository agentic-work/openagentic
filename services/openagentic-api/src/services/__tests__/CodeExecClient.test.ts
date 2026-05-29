import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeExecClient } from '../CodeExecClient.js';
describe('CodeExecClient', () => {
  beforeEach(() => { process.env.CODE_EXEC_URL='http://exec:3060'; process.env.CODE_EXEC_INTERNAL_KEY='k1'; });
  it('createSession POSTs to /sessions with internal key header and returns the session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ sessionId:'s1', userId:'u1', status:'running', workspacePath:'/w', pid:42, createdAt:1 }) });
    (global as any).fetch = fetchMock;
    const c = new CodeExecClient();
    const s = await c.createSession({ sessionId:'s1', userId:'u1', workspacePath:'/w', model:'', authToken:'t', apiEndpoint:'http://api:8000' });
    expect(s.pid).toBe(42);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://exec:3060/sessions');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-internal-api-key']).toBe('k1');
    expect(JSON.parse(opts.body).sessionId).toBe('s1');
  });
  it('stopSession DELETEs /sessions/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ stopped: true }) });
    (global as any).fetch = fetchMock;
    await new CodeExecClient().stopSession('s1');
    expect(fetchMock.mock.calls[0][0]).toBe('http://exec:3060/sessions/s1');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });
});
