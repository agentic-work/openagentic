// uploadFilesToApi — helper that POSTs each File to /api/files/upload via
// multipart/form-data and returns the backend-issued file ids. Replaces the
// old FileReader-based convertFilesToBase64 path that inlined bytes in
// /api/chat/stream.
//
// Why a separate helper: the hook consumer (useMessageHandling) should get
// to block sendMessage on upload completion *and* surface per-file errors
// to the UI. Pulling this into a plain async function keeps the hook body
// small and lets vitest stub fetch without touching React.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadFilesToApi } from '../uploadFilesToApi';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; vi.restoreAllMocks(); });

function mkFile(name: string, type: string, body = 'content'): File {
  return new File([body], name, { type });
}

describe('uploadFilesToApi', () => {
  it('returns [] for empty input without touching fetch', async () => {
    const f = vi.fn();
    global.fetch = f as any;
    const out = await uploadFilesToApi([]);
    expect(out).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('POSTs each file to /api/files/upload as multipart/form-data', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ file: { id: 'file_1' } }),
    });
    global.fetch = mockFetch as any;

    await uploadFilesToApi([mkFile('a.png', 'image/png'), mkFile('b.pdf', 'application/pdf')]);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/files/upload');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.body).toBeInstanceOf(FormData);
    // No explicit Content-Type header — the browser sets multipart boundary.
    expect(init.headers?.['Content-Type']).toBeUndefined();
  });

  it('sets Accept: application/json (backend content-negotiates like /api/images)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ file: { id: 'file_1' } }),
    });
    global.fetch = mockFetch as any;

    await uploadFilesToApi([mkFile('a.png', 'image/png')]);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers.Accept).toBe('application/json');
  });

  it('returns one {id, name, type, size} per file, caller order preserved', async () => {
    let call = 0;
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ file: { id: `file_${++call}` } }),
    })) as any;

    const out = await uploadFilesToApi([
      mkFile('a.png', 'image/png', 'aaa'),
      mkFile('b.pdf', 'application/pdf', 'bbb'),
    ]);

    expect(out).toEqual([
      { id: 'file_1', name: 'a.png', type: 'image/png', size: 3 },
      { id: 'file_2', name: 'b.pdf', type: 'application/pdf', size: 3 },
    ]);
  });

  it('throws a descriptive error when a single file upload fails (status code included)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      json: async () => ({ error: 'File too large' }),
    }) as any;

    await expect(uploadFilesToApi([mkFile('huge.pdf', 'application/pdf')]))
      .rejects.toThrow(/413|too large/i);
  });

  it('throws when the response has no file.id (malformed backend reply)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as any;

    await expect(uploadFilesToApi([mkFile('a.png', 'image/png')]))
      .rejects.toThrow(/missing id|malformed/i);
  });
});
