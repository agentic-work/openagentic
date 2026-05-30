import { describe, test, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import { DlpScanStage } from '../routes/chat/pipeline/dlp-scan.stage.js';
import type { PipelineContext } from '../routes/chat/pipeline/pipeline.types.js';

// Neutralise Prisma — DLP service persists findings asynchronously
// which these tests don't need to exercise.
vi.mock('../utils/prisma.js', () => ({
  prisma: {
    systemConfiguration: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
    dLPFinding: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

const logger = pino({ level: 'silent' });

function mkContext(message: string): {
  context: PipelineContext;
  emitted: Array<{ event: string; data: any }>;
} {
  const emitted: Array<{ event: string; data: any }> = [];
  const context = {
    request: { message } as any,
    user: { id: 'test-user-1', email: 'test@example.com' } as any,
    session: { id: 'sess-1' } as any,
    messages: [{ role: 'user', content: message } as any],
    errors: [],
    aborted: false,
    artifacts: [],
    logger,
    emit: (event: string, data: any) => emitted.push({ event, data }),
    config: { model: 'gpt-oss:20b' } as any,
    messageId: 'msg-1',
    startTime: new Date(),
    streamContext: {} as any,
  } as unknown as PipelineContext;
  return { context, emitted };
}

describe('DlpScanStage — pre-LLM redaction + block (UC-A13, 0.6.6)', () => {
  let stage: DlpScanStage;
  beforeEach(() => {
    stage = new DlpScanStage();
  });

  test('name + priority match pipeline placement spec', () => {
    expect(stage.name).toBe('dlp-scan');
    expect(stage.priority).toBe(25); // between validation(15) and prompt(35)
  });

  test('clean message passes through with no mutation and no event', async () => {
    const { context, emitted } = mkContext('Hello, how are you today?');
    const out = await stage.execute(context);
    expect(out.request.message).toBe('Hello, how are you today?');
    expect(out.aborted).toBe(false);
    expect(emitted).toEqual([]);
  });

  test('AWS example key → blocks pipeline, emits dlp_blocked, never reaches LLM', async () => {
    // AKIAIOSFODNN7EXAMPLE matches DLP-001 (AWS access key rule).
    // Rule severity is high, which maps to action='block'.
    const { context, emitted } = mkContext(
      'my access key is AKIAIOSFODNN7EXAMPLE and the secret is wJalrXUtnFEMI/K7MDENG',
    );
    const out = await stage.execute(context);

    expect(out.aborted).toBe(true);
    expect(out.errors).toBeDefined();
    expect(out.errors!.length).toBeGreaterThan(0);
    const err = out.errors![0] as any;
    expect(err.stage).toBe('dlp-scan');
    expect(err.code).toBe('DLP_BLOCK');

    const blockEvent = emitted.find(e => e.event === 'dlp_blocked');
    expect(blockEvent).toBeDefined();
    expect(blockEvent!.data.severity).toBe('high');
    expect(blockEvent!.data.categories).toContain('credential');
  });

  test('medium-severity finding → redacts message in-place, emits dlp_scan_performed', async () => {
    // A bearer token matches the "Bearer Token" rule at medium severity,
    // which maps to action='redact' (not block). The redacted form replaces
    // the matched bytes with `[REDACTED:credential/Bearer Token]`.
    const original = 'my current token is Bearer abcDEF1234567890abcDEF1234567890abcDEF1234567890';
    const { context, emitted } = mkContext(original);
    const out = await stage.execute(context);

    expect(out.request.message).not.toBe(original);
    expect(out.request.message).toContain('[REDACTED:');
    expect(out.request.message).not.toContain('abcDEF1234567890abcDEF1234567890abcDEF1234567890');

    // context.messages array is also updated so downstream consumers
    // (memory stage, prompt assembly) see the redacted form.
    const lastUserMsg = out.messages![out.messages!.length - 1];
    expect(lastUserMsg.content).toBe(out.request.message);

    // UI pill event
    const scanEvent = emitted.find(e => e.event === 'dlp_scan_performed');
    expect(scanEvent).toBeDefined();
    expect(scanEvent!.data.action).toBe('redact');
    expect(scanEvent!.data.scanPoint).toBe('user_input');

    // Pipeline continues (redaction is non-blocking).
    expect(out.aborted).toBe(false);
  });

  test('empty message → no-op (no errors, no events)', async () => {
    const { context, emitted } = mkContext('');
    const out = await stage.execute(context);
    expect(out.aborted).toBe(false);
    expect(emitted).toEqual([]);
  });

  test('non-string message → no-op (defensive, no crash)', async () => {
    const { context, emitted } = mkContext(null as any);
    const out = await stage.execute(context);
    expect(out.aborted).toBe(false);
    expect(emitted).toEqual([]);
  });
});
