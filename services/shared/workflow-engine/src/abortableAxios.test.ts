/**
 * abortableAxios.test.ts — TDD for B7: AbortController.signal threading
 *
 * Tests:
 *   1. Helper forwards signal to axios config
 *   2. AbortController.abort() mid-flight rejects with CanceledError
 *   3. Completed call before abort returns result cleanly
 *   4. abortableAxiosGet forwards signal
 *   5. abortableAxios (generic) forwards signal
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

// ---- RED: import helpers that do not yet exist ----
import {
  abortableAxiosPost,
  abortableAxiosGet,
  abortableAxios,
} from './abortableAxios.js';

describe('abortableAxiosPost', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the signal from the context into the axios config', async () => {
    const ctrl = new AbortController();
    const mockPost = vi
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { ok: true }, status: 200 } as any);

    await abortableAxiosPost({ signal: ctrl.signal }, 'http://example.com/api', { foo: 1 }, { timeout: 5000 });

    expect(mockPost).toHaveBeenCalledOnce();
    const [, , config] = mockPost.mock.calls[0];
    expect((config as any).signal).toBe(ctrl.signal);
    expect((config as any).timeout).toBe(5000);
  });

  it('rejects when the controller is aborted mid-flight', async () => {
    const ctrl = new AbortController();

    // Simulate a slow axios call that respects the abort signal
    vi.spyOn(axios, 'post').mockImplementationOnce((_url, _data, config) => {
      return new Promise((_resolve, reject) => {
        const sig: AbortSignal = (config as any).signal;
        if (sig.aborted) {
          const err: any = new Error('canceled');
          err.code = 'ERR_CANCELED';
          err.name = 'CanceledError';
          return reject(err);
        }
        const onAbort = () => {
          const err: any = new Error('canceled');
          err.code = 'ERR_CANCELED';
          err.name = 'CanceledError';
          reject(err);
        };
        sig.addEventListener('abort', onAbort);
      });
    });

    const start = Date.now();
    const promise = abortableAxiosPost({ signal: ctrl.signal }, 'http://slow-endpoint.io/api', {});

    // Abort after a short tick
    await Promise.resolve();
    ctrl.abort();

    await expect(promise).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    // Must reject fast — not waiting for the (fake) slow response
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('returns the response cleanly when the call completes before abort', async () => {
    const ctrl = new AbortController();
    const expectedData = { result: 'success' };

    vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: expectedData, status: 200 } as any);

    const response = await abortableAxiosPost({ signal: ctrl.signal }, 'http://example.com/api', {});
    // Abort AFTER the call already resolved
    ctrl.abort();

    expect(response.data).toEqual(expectedData);
    expect(response.status).toBe(200);
  });

  it('merges caller config with signal (signal wins if already set)', async () => {
    const ctrl = new AbortController();
    const otherCtrl = new AbortController();
    const mockPost = vi
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: {}, status: 200 } as any);

    // Caller passes their own signal — the wrapper's ctx.signal should take precedence
    await abortableAxiosPost(
      { signal: ctrl.signal },
      'http://example.com/api',
      {},
      { signal: otherCtrl.signal, timeout: 9000 }
    );

    const [, , config] = mockPost.mock.calls[0];
    // ctx.signal always wins (spread order: { ...config, signal: ctx.signal })
    expect((config as any).signal).toBe(ctrl.signal);
    expect((config as any).timeout).toBe(9000);
  });
});

describe('abortableAxiosGet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes signal into axios.get config', async () => {
    const ctrl = new AbortController();
    const mockGet = vi
      .spyOn(axios, 'get')
      .mockResolvedValueOnce({ data: { items: [] }, status: 200 } as any);

    await abortableAxiosGet({ signal: ctrl.signal }, 'http://example.com/api/list', { timeout: 3000 });

    expect(mockGet).toHaveBeenCalledOnce();
    const [, config] = mockGet.mock.calls[0];
    expect((config as any).signal).toBe(ctrl.signal);
    expect((config as any).timeout).toBe(3000);
  });

  it('rejects when aborted mid-flight', async () => {
    const ctrl = new AbortController();

    vi.spyOn(axios, 'get').mockImplementationOnce((_url, config) => {
      return new Promise((_resolve, reject) => {
        const sig: AbortSignal = (config as any).signal;
        const onAbort = () => {
          const err: any = new Error('canceled');
          err.code = 'ERR_CANCELED';
          err.name = 'CanceledError';
          reject(err);
        };
        sig.addEventListener('abort', onAbort);
      });
    });

    const promise = abortableAxiosGet({ signal: ctrl.signal }, 'http://slow.io/api');
    await Promise.resolve();
    ctrl.abort();
    await expect(promise).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  });
});

describe('abortableAxios (generic)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('merges signal into the config object passed to axios()', async () => {
    const ctrl = new AbortController();
    const mockAxios = vi
      .spyOn(axios, 'request')
      .mockResolvedValueOnce({ data: {}, status: 200 } as any);

    await abortableAxios({ signal: ctrl.signal }, {
      method: 'get',
      url: 'http://example.com/api',
      timeout: 5000,
    });

    expect(mockAxios).toHaveBeenCalledOnce();
    const [config] = mockAxios.mock.calls[0];
    expect((config as any).signal).toBe(ctrl.signal);
    expect((config as any).timeout).toBe(5000);
    expect((config as any).method).toBe('get');
  });

  it('rejects when aborted mid-flight', async () => {
    const ctrl = new AbortController();

    vi.spyOn(axios, 'request').mockImplementationOnce((config) => {
      return new Promise((_resolve, reject) => {
        const sig: AbortSignal = (config as any).signal;
        const onAbort = () => {
          const err: any = new Error('canceled');
          err.code = 'ERR_CANCELED';
          err.name = 'CanceledError';
          reject(err);
        };
        sig.addEventListener('abort', onAbort);
      });
    });

    const promise = abortableAxios({ signal: ctrl.signal }, { method: 'post', url: 'http://slow.io/api' });
    await Promise.resolve();
    ctrl.abort();
    await expect(promise).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  });
});

describe('http_request node integration: abort cancels in-flight call', () => {
  it('an aborted signal passed as ctx.signal causes the axios call to reject', async () => {
    const ctrl = new AbortController();

    vi.spyOn(axios, 'request').mockImplementationOnce((config) => {
      return new Promise((_resolve, reject) => {
        const sig: AbortSignal = (config as any).signal;
        if (sig?.aborted) {
          const err: any = new Error('canceled');
          err.code = 'ERR_CANCELED';
          reject(err);
          return;
        }
        const onAbort = () => {
          const err: any = new Error('canceled');
          err.code = 'ERR_CANCELED';
          reject(err);
        };
        sig?.addEventListener('abort', onAbort);
      });
    });

    // Simulate what executeHttpRequestNode does after the signal is threaded
    const callPromise = abortableAxios({ signal: ctrl.signal }, {
      method: 'post',
      url: 'http://internal-api/slow',
      data: { query: 'test' },
      timeout: 30000,
      validateStatus: () => true,
    });

    ctrl.abort(new Error('workflow aborted'));

    await expect(callPromise).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  });
});
