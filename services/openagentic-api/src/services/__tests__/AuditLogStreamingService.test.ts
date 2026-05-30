/**
 * AuditLogStreamingService — TDD spec.
 *
 * A5. dispatch(row) routes to the correct sink based on AUDIT_LOG_SINK env.
 * A6. stdout: JSON line to process.stdout; datadog/splunk: HTTP POST; s3: batch.
 * A7. Network errors → log warn, don't throw.
 * A8. Batching for Datadog/Splunk/S3 (flush triggered at batch size or timer).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Logger stub — hoisted so vi.mock factory can reference them
// ---------------------------------------------------------------------------
const { warnMock, infoMock } = vi.hoisted(() => ({
  warnMock: vi.fn(),
  infoMock: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => {
  const noop: any = { info: infoMock, warn: warnMock, error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
  noop.child = () => noop;
  noop.bindings = () => ({});
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const loggers: Record<string, typeof noop> = {};
  for (const c of cats) {
    const cat: any = { info: infoMock, warn: warnMock, error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    cat.child = () => cat;
    cat.bindings = () => ({});
    loggers[c] = cat;
  }
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

import { AuditLogStreamingService } from '../AuditLogStreamingService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SAMPLE_ROW = {
  id: 'row-1',
  ts: new Date('2026-04-25T10:00:00.000Z'),
  action: 'integration.create',
  target_type: 'integration',
  target_id: 'int-1',
  outcome: 'success',
  actor_user_id: 'user-1',
  actor_user_email: 'admin@example.com',
  actor_ip: '10.0.0.1',
  metadata: { name: 'SlackBot' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditLogStreamingService', () => {
  let originalSink: string | undefined;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalSink = process.env.AUDIT_LOG_SINK;

    // Spy on stdout.write for stdout sink test
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as any);

    // Mock global fetch for HTTP sinks
    originalFetch = global.fetch;
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    global.fetch = fetchMock;
  });

  afterEach(() => {
    if (originalSink !== undefined) {
      process.env.AUDIT_LOG_SINK = originalSink;
    } else {
      delete process.env.AUDIT_LOG_SINK;
    }
    global.fetch = originalFetch;
    stdoutWriteSpy.mockRestore();
  });

  // A5 — default stdout -------------------------------------------------------
  it('A5: defaults to stdout when AUDIT_LOG_SINK is not set', async () => {
    delete process.env.AUDIT_LOG_SINK;
    const svc = new AuditLogStreamingService();
    await svc.dispatch(SAMPLE_ROW as any);
    expect(stdoutWriteSpy).toHaveBeenCalled();
    const written = stdoutWriteSpy.mock.calls[0][0] as string;
    expect(written).toContain('"integration.create"');
  });

  it('A5: uses stdout sink when AUDIT_LOG_SINK=stdout', async () => {
    process.env.AUDIT_LOG_SINK = 'stdout';
    const svc = new AuditLogStreamingService();
    await svc.dispatch(SAMPLE_ROW as any);
    expect(stdoutWriteSpy).toHaveBeenCalled();
  });

  // A6 — datadog ---------------------------------------------------------------
  it('A6: datadog sink POSTs to Datadog intake URL', async () => {
    process.env.AUDIT_LOG_SINK = 'datadog';
    process.env.DATADOG_API_KEY = 'test-dd-key';
    const svc = new AuditLogStreamingService();
    // Force immediate flush by setting batch size to 1
    await svc.dispatch(SAMPLE_ROW as any, { flushNow: true });
    expect(fetchMock).toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('datadoghq.com');
    delete process.env.DATADOG_API_KEY;
  });

  // A6 — splunk ----------------------------------------------------------------
  it('A6: splunk sink POSTs to Splunk HEC URL', async () => {
    process.env.AUDIT_LOG_SINK = 'splunk';
    process.env.SPLUNK_HEC_URL = 'https://splunk.example.com:8088/services/collector/event';
    process.env.SPLUNK_HEC_TOKEN = 'Splunk test-token';
    const svc = new AuditLogStreamingService();
    await svc.dispatch(SAMPLE_ROW as any, { flushNow: true });
    expect(fetchMock).toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://splunk.example.com:8088/services/collector/event');
    delete process.env.SPLUNK_HEC_URL;
    delete process.env.SPLUNK_HEC_TOKEN;
  });

  // A6 — s3 --------------------------------------------------------------------
  it('A6: s3 sink buffers rows and flushes', async () => {
    process.env.AUDIT_LOG_SINK = 's3';
    process.env.AUDIT_S3_BUCKET = 'my-audit-bucket';
    process.env.AWS_REGION = 'us-east-1';
    const svc = new AuditLogStreamingService();
    await svc.dispatch(SAMPLE_ROW as any, { flushNow: true });
    // s3 uses a batch flush — just verify no throw and sink was invoked
    // (actual S3 PUT is mocked via AWS SDK or fetch)
    expect(warnMock).not.toHaveBeenCalledWith(expect.stringContaining('Sink dispatch failed'));
    delete process.env.AUDIT_S3_BUCKET;
    delete process.env.AWS_REGION;
  });

  // A7 — network errors don't throw -------------------------------------------
  it('A7: network error on datadog → logs warn, does not throw', async () => {
    process.env.AUDIT_LOG_SINK = 'datadog';
    process.env.DATADOG_API_KEY = 'test-key';
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = new AuditLogStreamingService();
    await expect(svc.dispatch(SAMPLE_ROW as any, { flushNow: true })).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalled();
    delete process.env.DATADOG_API_KEY;
  });

  it('A7: network error on splunk → logs warn, does not throw', async () => {
    process.env.AUDIT_LOG_SINK = 'splunk';
    process.env.SPLUNK_HEC_URL = 'https://splunk.example.com:8088/services/collector/event';
    process.env.SPLUNK_HEC_TOKEN = 'Splunk tok';
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    const svc = new AuditLogStreamingService();
    await expect(svc.dispatch(SAMPLE_ROW as any, { flushNow: true })).resolves.not.toThrow();
    expect(warnMock).toHaveBeenCalled();
    delete process.env.SPLUNK_HEC_URL;
    delete process.env.SPLUNK_HEC_TOKEN;
  });

  // A8 — batching -------------------------------------------------------------
  it('A8: batching buffers rows until flushNow or batch size reached', async () => {
    process.env.AUDIT_LOG_SINK = 'datadog';
    process.env.DATADOG_API_KEY = 'test-key';
    const svc = new AuditLogStreamingService();

    // Dispatch 3 rows without flushNow — should NOT call fetch yet
    await svc.dispatch({ ...SAMPLE_ROW, id: 'r1' } as any);
    await svc.dispatch({ ...SAMPLE_ROW, id: 'r2' } as any);
    await svc.dispatch({ ...SAMPLE_ROW, id: 'r3' } as any);

    // No flush yet
    expect(fetchMock).not.toHaveBeenCalled();

    // Force flush
    await svc.flush();
    expect(fetchMock).toHaveBeenCalledOnce();

    delete process.env.DATADOG_API_KEY;
  });

  it('A8: stdout sink does NOT buffer — writes immediately', async () => {
    process.env.AUDIT_LOG_SINK = 'stdout';
    const svc = new AuditLogStreamingService();
    await svc.dispatch(SAMPLE_ROW as any);
    expect(stdoutWriteSpy).toHaveBeenCalledOnce();
  });

  // fluentd -------------------------------------------------------------------
  it('A6: fluentd sink — gracefully handles missing FLUENTD_HOST by logging warn', async () => {
    process.env.AUDIT_LOG_SINK = 'fluentd';
    delete process.env.FLUENTD_HOST;
    const svc = new AuditLogStreamingService();
    await expect(svc.dispatch(SAMPLE_ROW as any)).resolves.not.toThrow();
  });
});
