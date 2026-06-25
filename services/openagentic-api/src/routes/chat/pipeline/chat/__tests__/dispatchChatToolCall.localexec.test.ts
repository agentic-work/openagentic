import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchChatToolCall } from '../dispatchChatToolCall.js';
import {
  getLocalExecutorRegistry,
  type DispatchFrame,
} from '../../../../../services/local-executor/LocalExecutorRegistry.js';

// The workspace_* arm returns before touching `deps`, so a bare stub suffices.
const deps = {} as any;
const call = { name: 'workspace_write_file', input: { path: 'a.txt', content: 'hi' } };

describe('dispatchChatToolCall — workspace_* (local executor arm)', () => {
  beforeEach(() => getLocalExecutorRegistry().__clear());

  it('errors with install guidance when no executor is connected', async () => {
    const r = await dispatchChatToolCall({ userId: 'u1' }, call, deps);
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/No local executor connected/);
  });

  it('dispatches to the connected executor and returns its result as ok/output', async () => {
    const pushed: DispatchFrame[] = [];
    getLocalExecutorRegistry().connect(
      'u1',
      [{ name: 'workspace_write_file', input_schema: { type: 'object' } }],
      (frame) => {
        pushed.push(frame);
        // simulate the VS Code client POSTing its result back
        getLocalExecutorRegistry().submitResult(frame.tool_use_id, {
          content: 'wrote a.txt (2 bytes)',
          isError: false,
        });
      },
    );

    const r = await dispatchChatToolCall({ userId: 'u1' }, call, deps);

    expect(pushed.length).toBe(1);
    expect(pushed[0]!.name).toBe('workspace_write_file');
    expect(pushed[0]!.input).toEqual({ path: 'a.txt', content: 'hi' });
    expect(r.ok).toBe(true);
    expect((r as any).output).toBe('wrote a.txt (2 bytes)');
  });

  it('surfaces a client error result as ok:false/error', async () => {
    getLocalExecutorRegistry().connect(
      'u1',
      [{ name: 'workspace_write_file', input_schema: { type: 'object' } }],
      (frame) =>
        getLocalExecutorRegistry().submitResult(frame.tool_use_id, {
          content: 'path escapes workspace root: ../x',
          isError: true,
        }),
    );
    const r = await dispatchChatToolCall({ userId: 'u1' }, call, deps);
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/escapes workspace root/);
  });

  it('scopes by userId — a connection for another user does not serve u1', async () => {
    getLocalExecutorRegistry().connect('someone-else', [{ name: 'workspace_write_file', input_schema: { type: 'object' } }], () => {});
    const r = await dispatchChatToolCall({ userId: 'u1' }, call, deps);
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/No local executor connected/);
  });
});
