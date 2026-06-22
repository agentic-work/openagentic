import { describe, it, expect } from 'vitest';
import {
  LocalExecutorRegistry,
  type DispatchFrame,
  type ExecutorToolDef,
} from '../LocalExecutorRegistry.js';

const TOOLS: ExecutorToolDef[] = [
  { name: 'workspace_write_file', description: 'write', input_schema: { type: 'object' } },
];
const call = (id: string, name = 'workspace_write_file'): DispatchFrame => ({
  name,
  tool_use_id: id,
  input: { path: 'a.txt', content: 'hi' },
});

describe('LocalExecutorRegistry', () => {
  it('registers a connection and advertises its tools', () => {
    const reg = new LocalExecutorRegistry();
    expect(reg.isConnected('u1')).toBe(false);
    reg.connect('u1', TOOLS, () => {});
    expect(reg.isConnected('u1')).toBe(true);
    expect(reg.getTools('u1')).toEqual(TOOLS);
    expect(reg.getTools('nobody')).toBeNull();
  });

  it('dispatches a frame to the connected client and resolves on submitResult', async () => {
    const reg = new LocalExecutorRegistry();
    const pushed: DispatchFrame[] = [];
    reg.connect('u1', TOOLS, (f) => pushed.push(f));

    const p = reg.dispatch('u1', call('t1'), 1000);
    // the client received exactly the dispatched frame
    expect(pushed).toEqual([call('t1')]);
    // ...and the result the client posts back resolves the awaited dispatch
    const ok = reg.submitResult('t1', { content: 'wrote a.txt (2 bytes)', isError: false });
    expect(ok).toBe(true);
    await expect(p).resolves.toEqual({ content: 'wrote a.txt (2 bytes)', isError: false });
  });

  it('returns an error result when no executor is connected', async () => {
    const reg = new LocalExecutorRegistry();
    const r = await reg.dispatch('ghost', call('t2'), 1000);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/no local executor/i);
  });

  it('resolves to a timeout error if the client never responds', async () => {
    const reg = new LocalExecutorRegistry();
    reg.connect('u1', TOOLS, () => {});
    const r = await reg.dispatch('u1', call('t3'), 20);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/timed out/i);
    // a late submit after timeout is a no-op
    expect(reg.submitResult('t3', { content: 'late', isError: false })).toBe(false);
  });

  it('submitResult for an unknown id is a no-op', () => {
    const reg = new LocalExecutorRegistry();
    expect(reg.submitResult('nope', { content: 'x', isError: false })).toBe(false);
  });

  it('disconnect clears the connection and fails that user\'s in-flight calls', async () => {
    const reg = new LocalExecutorRegistry();
    const disconnect = reg.connect('u1', TOOLS, () => {});
    const p = reg.dispatch('u1', call('t4'), 5000);
    disconnect();
    expect(reg.isConnected('u1')).toBe(false);
    expect(reg.getTools('u1')).toBeNull();
    const r = await p;
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/disconnect/i);
  });

  it('latest connection wins for a user (reconnect replaces)', () => {
    const reg = new LocalExecutorRegistry();
    reg.connect('u1', TOOLS, () => {});
    const tools2: ExecutorToolDef[] = [{ name: 'workspace_git', input_schema: { type: 'object' } }];
    reg.connect('u1', tools2, () => {});
    expect(reg.getTools('u1')).toEqual(tools2);
  });
});
