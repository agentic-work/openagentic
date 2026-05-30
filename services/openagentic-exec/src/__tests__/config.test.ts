import { describe, it, expect, beforeEach } from 'vitest';
describe('config', () => {
  beforeEach(() => { delete process.env.CLAUDE_PATH; delete process.env.PORT; });
  it('defaults claudePath and port', async () => {
    const { loadConfig } = await import('../config.js');
    const c = loadConfig();
    expect(c.claudePath).toBe('/usr/local/bin/claude');
    expect(c.port).toBe(3060);
    expect(c.workspacesPath).toBe('/workspaces');
  });
  it('honors env overrides', async () => {
    process.env.CLAUDE_PATH = '/x/claude'; process.env.PORT = '9999';
    const { loadConfig } = await import('../config.js');
    const c = loadConfig();
    expect(c.claudePath).toBe('/x/claude'); expect(c.port).toBe(9999);
  });
});
