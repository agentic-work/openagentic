/**
 * TDD red→green for the @kubernetes/client-node v1.4.x object-arg API
 * wrappers in boot-events.handler.ts.
 *
 * Background: @kubernetes/client-node v1.x exports `CoreV1Api` aliased
 * to `ObjectCoreV1Api` — object-arg ONLY. Calling it positionally with
 * strings makes the library's RequiredError validator read `.name` off
 * the first string arg, get undefined, and throw:
 *
 *   "Required parameter name was null or undefined when calling
 *    CoreV1Api.readNamespacedPod."
 *
 * The prior shim (commit e0e5dd9c) tried object-arg first and, on any
 * error, fell back to positional. On v1.4 this fallback ALWAYS throws
 * RequiredError and the shim threw `posErr` — which MASKED the real
 * k8s HTTP error (404 pod-not-found, 403 RBAC, etc.) behind that
 * useless validator message. That's why the boot modal showed
 * "k8s err: Required parameter name was null or undefined…" instead
 * of "pod not yet scheduled" or "api SA missing RBAC on pods".
 *
 * Correct contract the helpers MUST satisfy on the pinned v1.4 lib:
 *
 *   readPodWithShimFallback(k8sApi, name, namespace)
 *     1. Call k8sApi.readNamespacedPod({name, namespace}).
 *     2. On success, unwrap `{body: Pod}` (v0.22 pattern) OR return
 *        the bare Pod (v1.x pattern).
 *     3. On failure, propagate the original error — preserving
 *        `statusCode` / `code` so the caller can discriminate 404/403.
 *     4. Never try positional: the lib is object-arg only, and a
 *        positional call would trigger RequiredError and hide the
 *        true error.
 *
 *   listEventsWithShimFallback(k8sApi, namespace, fieldSelector, resourceVersion)
 *     Same semantics for listNamespacedEvent. Returns `items: any[]`
 *     (empty array if the API returns no items).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  readPodWithShimFallback,
  listEventsWithShimFallback,
} from '../boot-events.handler.js';

describe('readPodWithShimFallback — v1.4 object-arg CoreV1Api', () => {
  it('returns the bare pod when the lib already unwraps (v1.x default)', async () => {
    const readNamespacedPod = vi.fn().mockResolvedValue({
      metadata: { name: 'p' },
      status: { phase: 'Running' },
    });
    const api = { readNamespacedPod };
    const out = await readPodWithShimFallback(api as any, 'p', 'ns');
    expect(out).toEqual({ metadata: { name: 'p' }, status: { phase: 'Running' } });
    expect(readNamespacedPod).toHaveBeenCalledTimes(1);
    expect(readNamespacedPod).toHaveBeenCalledWith({ name: 'p', namespace: 'ns' });
  });

  it('unwraps `{body: Pod}` when the lib returns the v0.22 wrapper shape', async () => {
    const readNamespacedPod = vi.fn().mockResolvedValue({
      body: { metadata: { name: 'p' }, status: { phase: 'Running' } },
    });
    const api = { readNamespacedPod };
    const out = await readPodWithShimFallback(api as any, 'p', 'ns');
    expect(out).toEqual({ metadata: { name: 'p' }, status: { phase: 'Running' } });
  });

  it('propagates a 404 with statusCode preserved so caller can detect pod-not-yet-scheduled', async () => {
    const err = Object.assign(new Error('pods "p" not found'), { statusCode: 404 });
    const readNamespacedPod = vi.fn().mockRejectedValue(err);
    const api = { readNamespacedPod };
    await expect(readPodWithShimFallback(api as any, 'p', 'ns')).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining('not found'),
    });
    // Must NOT attempt a positional call (would corrupt the error with RequiredError).
    expect(readNamespacedPod).toHaveBeenCalledTimes(1);
  });

  it('propagates a 403 with statusCode preserved so caller can detect missing RBAC', async () => {
    const err = Object.assign(new Error('forbidden'), { statusCode: 403 });
    const readNamespacedPod = vi.fn().mockRejectedValue(err);
    const api = { readNamespacedPod };
    await expect(readPodWithShimFallback(api as any, 'p', 'ns')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(readNamespacedPod).toHaveBeenCalledTimes(1);
  });

  it('does NOT swallow a RequiredError into a positional retry (the retry would throw the same error and mask the cause)', async () => {
    // Simulates what'd happen if the lib itself threw RequiredError —
    // e.g., someone passed undefined for name/namespace upstream. The
    // helper must NOT try positional as a "fallback" because positional
    // on v1.4 triggers RequiredError too, not the real root cause.
    const reqErr = Object.assign(new Error(
      'Required parameter name was null or undefined when calling CoreV1Api.readNamespacedPod.'
    ), { name: 'RequiredError' });
    const readNamespacedPod = vi.fn().mockRejectedValue(reqErr);
    const api = { readNamespacedPod };
    await expect(readPodWithShimFallback(api as any, 'p', 'ns')).rejects.toBe(reqErr);
    expect(readNamespacedPod).toHaveBeenCalledTimes(1);
  });

  it('normalizes v1.4 ApiException .code onto .statusCode so the outer catch can detect 404', async () => {
    // v1.4 @kubernetes/client-node throws ApiException with `.code` (the
    // HTTP status) and a multi-line `message` like:
    //   "HTTP-Code: 404\nMessage: ...\nBody: ..."
    // The outer catch in boot-events.handler.ts branches on `err.statusCode`
    // (`404 → "pod not yet scheduled"`, `403 → "api SA missing RBAC on pods"`).
    // If we don't normalize, the UI shows the raw multi-line blob instead.
    const apiErr = Object.assign(
      new Error(
        'HTTP-Code: 404\nMessage: Unknown API Status Code!\nBody: {"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure","message":"pods \\"openagentic-abc\\" not found","reason":"NotFound","details":{"name":"openagentic-abc","kind":"pods"},"code":404}\nHeaders: {}'
      ),
      { code: 404, body: { kind: 'Status', reason: 'NotFound' }, headers: {} },
    );
    const readNamespacedPod = vi.fn().mockRejectedValue(apiErr);
    const api = { readNamespacedPod };
    await expect(readPodWithShimFallback(api as any, 'p', 'ns')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(readNamespacedPod).toHaveBeenCalledTimes(1);
  });

  it('normalizes v1.4 ApiException 403 onto .statusCode so the outer catch can detect RBAC gap', async () => {
    const apiErr = Object.assign(
      new Error('HTTP-Code: 403\nMessage: Forbidden\nBody: ...\nHeaders: {}'),
      { code: 403 },
    );
    const readNamespacedPod = vi.fn().mockRejectedValue(apiErr);
    const api = { readNamespacedPod };
    await expect(readPodWithShimFallback(api as any, 'p', 'ns')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe('listEventsWithShimFallback — v1.4 object-arg CoreV1Api', () => {
  it('returns items when the lib yields a bare body with items', async () => {
    const listNamespacedEvent = vi.fn().mockResolvedValue({
      items: [
        { metadata: { resourceVersion: '100' }, reason: 'Scheduled', message: 'ok' },
      ],
    });
    const api = { listNamespacedEvent };
    const out = await listEventsWithShimFallback(api as any, 'ns', 'involvedObject.name=p', '0');
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('Scheduled');
    expect(listNamespacedEvent).toHaveBeenCalledTimes(1);
    expect(listNamespacedEvent).toHaveBeenCalledWith({
      namespace: 'ns',
      fieldSelector: 'involvedObject.name=p',
      resourceVersion: '0',
    });
  });

  it('unwraps `{body: {items}}` v0.22 wrapper shape', async () => {
    const listNamespacedEvent = vi.fn().mockResolvedValue({
      body: { items: [{ metadata: { resourceVersion: '1' }, reason: 'Pulled' }] },
    });
    const api = { listNamespacedEvent };
    const out = await listEventsWithShimFallback(api as any, 'ns', 'sel', '0');
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('Pulled');
  });

  it('returns [] when the api returns no items', async () => {
    const listNamespacedEvent = vi.fn().mockResolvedValue({ items: [] });
    const api = { listNamespacedEvent };
    const out = await listEventsWithShimFallback(api as any, 'ns', 'sel', '0');
    expect(out).toEqual([]);
  });

  it('propagates real HTTP errors (e.g., 403) with statusCode preserved', async () => {
    const err = Object.assign(new Error('forbidden'), { statusCode: 403 });
    const listNamespacedEvent = vi.fn().mockRejectedValue(err);
    const api = { listNamespacedEvent };
    await expect(listEventsWithShimFallback(api as any, 'ns', 'sel', '0')).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(listNamespacedEvent).toHaveBeenCalledTimes(1);
  });

  it('normalizes v1.4 ApiException .code onto .statusCode (same as readPod)', async () => {
    const apiErr = Object.assign(
      new Error('HTTP-Code: 403\nMessage: Forbidden\nBody: ...\nHeaders: {}'),
      { code: 403 },
    );
    const listNamespacedEvent = vi.fn().mockRejectedValue(apiErr);
    const api = { listNamespacedEvent };
    await expect(listEventsWithShimFallback(api as any, 'ns', 'sel', '0')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
