// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildTerminalWsUrl } from '../Terminal';

describe('buildTerminalWsUrl', () => {
  it('builds a ws:// URL for http protocol', () => {
    const url = buildTerminalWsUrl('localhost:3000', 'ws', 'abc-123', 'my-token');
    expect(url).toBe('ws://localhost:3000/api/code/ws/terminal?sessionId=abc-123&token=my-token');
  });

  it('builds a wss:// URL for wss protocol', () => {
    const url = buildTerminalWsUrl('example.com', 'wss', 'session-xyz', 'tok123');
    expect(url).toBe('wss://example.com/api/code/ws/terminal?sessionId=session-xyz&token=tok123');
  });

  it('percent-encodes special characters in sessionId and token', () => {
    const url = buildTerminalWsUrl('localhost:8080', 'ws', 'id with spaces', 'token=with&special');
    expect(url).toBe(
      'ws://localhost:8080/api/code/ws/terminal?sessionId=id%20with%20spaces&token=token%3Dwith%26special'
    );
  });

  it('handles empty token gracefully', () => {
    const url = buildTerminalWsUrl('localhost:3000', 'ws', 'sess-1', '');
    expect(url).toBe('ws://localhost:3000/api/code/ws/terminal?sessionId=sess-1&token=');
  });
});
