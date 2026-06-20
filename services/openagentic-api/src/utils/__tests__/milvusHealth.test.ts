/**
 * #1055 Milvus health-classifier — distinguish transient recovery
 * from fatal connection failure.
 *
 * Live evidence captured from an `openagentic-api` pod
 * `openagentic-api-<pod>`:
 *
 *   {
 *     "reasons": ["loaded collection do not found any channel in target,
 *                  may be in recovery: collection on recovering[
 *                  collection=466456455935201500]"],
 *     "status": {"error_code": "Success", "code": 0, "retriable": false},
 *     "isHealthy": false
 *   }
 *
 * Old behaviour: 08-tool-cache.ts treated isHealthy=false as fatal and
 * exhausted its 10-attempt 135s budget while Milvus segment-load was
 * still mid-flight. Result: CrashLoopBackOff for the entire api.
 *
 * New behaviour: classifier returns:
 *   - 'ready'      when isHealthy is true
 *   - 'recovering' when isHealthy is false BUT status.error_code is
 *                  'Success' and reasons[] mentions recovery / loading
 *                  / channel-in-target. Caller waits longer.
 *   - 'fatal'      when isHealthy is false AND status indicates a real
 *                  connect failure (or unrecognised state). Caller
 *                  fails fast.
 */
import { describe, it, expect } from 'vitest';
import { classifyMilvusHealth, MilvusRecoveringError } from '../milvusHealth.js';

describe('classifyMilvusHealth', () => {
  it('returns "ready" when the SDK reports isHealthy=true', () => {
    expect(
      classifyMilvusHealth({
        isHealthy: true,
        reasons: [],
        status: { error_code: 'Success', code: 0 },
      } as any)
    ).toBe('ready');
  });

  it('returns "recovering" for the exact live failure response', () => {
    const liveResponse = {
      reasons: [
        'loaded collection do not found any channel in target, may be in recovery: collection on recovering[collection=466456455935201500]',
      ],
      quota_states: [],
      status: {
        extra_info: {},
        error_code: 'Success',
        reason: '',
        code: 0,
        retriable: false,
        detail: '',
      },
      isHealthy: false,
    };
    expect(classifyMilvusHealth(liveResponse as any)).toBe('recovering');
  });

  it('returns "recovering" when reasons mention generic loading state', () => {
    expect(
      classifyMilvusHealth({
        isHealthy: false,
        reasons: ['collection 466 is currently loading segments'],
        status: { error_code: 'Success', code: 0 },
      } as any)
    ).toBe('recovering');
  });

  it('returns "fatal" when status.error_code is non-Success', () => {
    expect(
      classifyMilvusHealth({
        isHealthy: false,
        reasons: ['connection refused'],
        status: { error_code: 'UnexpectedError', code: 1 },
      } as any)
    ).toBe('fatal');
  });

  it('returns "fatal" when health response is malformed / empty', () => {
    expect(classifyMilvusHealth(null as any)).toBe('fatal');
    expect(classifyMilvusHealth({} as any)).toBe('fatal');
    expect(classifyMilvusHealth({ isHealthy: false } as any)).toBe('fatal');
  });

  it('returns "fatal" when isHealthy is false but no recovery hint in reasons', () => {
    expect(
      classifyMilvusHealth({
        isHealthy: false,
        reasons: ['something completely different went wrong'],
        status: { error_code: 'Success', code: 0 },
      } as any)
    ).toBe('fatal');
  });
});

describe('MilvusRecoveringError', () => {
  it('is named so callers can branch on `error.name`', () => {
    const e = new MilvusRecoveringError('still loading');
    expect(e.name).toBe('MilvusRecoveringError');
    expect(e.message).toContain('still loading');
    expect(e instanceof Error).toBe(true);
  });
});
