/**
 * RED-first TDD: generateOpenAPISpec must not throw when the filesystem
 * is read-only at the default output path.
 *
 * Bug: live pod log:
 *   {"err":{"errno":-13,"code":"EACCES","syscall":"mkdir","path":"/app/docs"},
 *    "msg":"Failed to generate static OpenAPI spec - will be available at /api/swagger/json"}
 *
 * The function already catches and logs — the real fix is to write to a
 * writable path (OPENAPI_STATIC_PATH env var, default /tmp/openapi.json)
 * so the error stops appearing in production logs at all.
 *
 * This test asserts:
 * 1. When OPENAPI_STATIC_PATH is set, that path is used.
 * 2. When OPENAPI_STATIC_PATH is unset, the default is /tmp/openapi.json (writable).
 * 3. If mkdirSync throws EACCES the function does not throw (graceful degradation).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// We test the exported helper — it must be exported from server.ts OR extracted
// into a separate module. Currently it is NOT exported. The fix must either
// export it or extract it to a testable module.
// This test imports from the extracted module path:
import { generateOpenAPISpec } from '../config/openapi-spec.js';

const silentLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  child: () => silentLogger,
} as any;

describe('generateOpenAPISpec', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('uses OPENAPI_STATIC_PATH when set', async () => {
    process.env.OPENAPI_STATIC_PATH = '/tmp/test-openapi/spec.json';
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const fakeServer = { swagger: vi.fn(() => ({ openapi: '3.1.0', paths: {} })) } as any;
    await generateOpenAPISpec(fakeServer, silentLogger);

    expect(mkdirSpy).toHaveBeenCalledWith('/tmp/test-openapi', expect.objectContaining({ recursive: true }));
    expect(writeSpy).toHaveBeenCalledWith('/tmp/test-openapi/spec.json', expect.any(String), 'utf-8');
  });

  it('defaults to /tmp/openapi.json when OPENAPI_STATIC_PATH is unset', async () => {
    delete process.env.OPENAPI_STATIC_PATH;
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const fakeServer = { swagger: vi.fn(() => ({ openapi: '3.1.0', paths: {} })) } as any;
    await generateOpenAPISpec(fakeServer, silentLogger);

    expect(mkdirSpy).toHaveBeenCalledWith('/tmp', expect.objectContaining({ recursive: true }));
    expect(writeSpy).toHaveBeenCalledWith('/tmp/openapi.json', expect.any(String), 'utf-8');
  });

  it('does not throw when mkdirSync throws EACCES (graceful degradation)', async () => {
    delete process.env.OPENAPI_STATIC_PATH;
    const eaccesErr = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw eaccesErr; });

    const fakeServer = { swagger: vi.fn(() => ({ openapi: '3.1.0', paths: {} })) } as any;
    // Must NOT throw
    await expect(generateOpenAPISpec(fakeServer, silentLogger)).resolves.toBeUndefined();
  });
});
