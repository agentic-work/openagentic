import { describe, it, expect } from 'vitest';
import { buildClaudeSpawn } from '../buildClaudeSpawn.js';
describe('buildClaudeSpawn', () => {
  const base = { claudePath: '/usr/local/bin/claude', workspacePath: '/workspaces/u1/ws',
    apiEndpoint: 'http://api:8000', authToken: 'jwt-abc', model: 'reg-model-1', home: '/workspaces/u1' };
  it('spawns claude as the shell command in the workspace', () => {
    const s = buildClaudeSpawn(base);
    expect(s.command).toBe('/usr/local/bin/claude');
    expect(s.cwd).toBe('/workspaces/u1/ws');
  });
  it('sets ANTHROPIC routing env', () => {
    const { env } = buildClaudeSpawn(base);
    expect(env.ANTHROPIC_BASE_URL).toBe('http://api:8000');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('jwt-abc');
    expect(env.ANTHROPIC_MODEL).toBe('reg-model-1');
    expect(env.HOME).toBe('/workspaces/u1');
  });
  it('omits ANTHROPIC_MODEL when model empty (smart router)', () => {
    const { env } = buildClaudeSpawn({ ...base, model: '' });
    expect('ANTHROPIC_MODEL' in env).toBe(false);
  });
});
