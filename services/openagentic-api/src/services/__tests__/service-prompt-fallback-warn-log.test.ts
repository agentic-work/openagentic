/**
 * Gap #3 — RED: when DEFAULT_SERVICE_PROMPTS fallback is taken, a WARN-level
 * log MUST fire with `key` + `reason` (`FALLBACK_REASON`) before the
 * inline constant is returned. The fallback STAYS (it's load-bearing for
 * boot before DB seeds) but it must scream so drift becomes visible.
 *
 * Sites under test:
 *   - SlackIntegrationService.getSlackSystemPrompt
 *   - AITitleGenerationService.getTitleGenerationPrompt
 *   - TitleGenerationClient.getMultipleTitlesPrompt
 *   - CodeModeSessionService.getSummarySystemPrompt
 *   - MemoryContextService.getContextSystemPrompt
 *
 * For each site: invoke with a ServicePromptLike whose `getPrompt` throws,
 * then assert (a) the returned value matches the inline default and
 * (b) a `warn` was emitted with `{ key, reason: '...' }` AND the message
 * mentions "ServicePrompt fallback".
 */
import { describe, it, expect, vi } from 'vitest';

function makeThrowingSvc() {
  return {
    getPrompt: vi.fn(async () => {
      throw new Error('synthetic DB read failure');
    }),
  };
}

function makeLogger() {
  const warn = vi.fn();
  const child = vi.fn(() => ({ warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() }));
  return { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn(), child };
}

describe('Gap #3 — ServicePrompt fallback MUST emit a WARN log', () => {
  it('SlackIntegrationService: DB read failure → WARN { key, reason } + fallback body', async () => {
    // Replace the module-scope logger used by SlackIntegrationService
    const warn = vi.fn();
    vi.doMock('../../utils/logger.js', () => ({
      loggers: {
        services: { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
      },
    }));
    vi.resetModules();
    const { SlackIntegrationService } = await import('../SlackIntegrationService.js');
    const svc = new (SlackIntegrationService as any)(makeThrowingSvc());

    const result = await svc.getSlackSystemPrompt();
    expect(result).toContain('OpenAgentic AI');

    // Expect at least ONE warn call carrying the structured shape
    const fallbackWarn = warn.mock.calls.find((args) => {
      const obj = args[0];
      const msg = String(args[1] ?? '');
      return (
        obj &&
        obj.key === 'slack.integration_prompt' &&
        typeof obj.reason === 'string' &&
        /ServicePrompt fallback/.test(msg)
      );
    });
    expect(fallbackWarn, `warn calls = ${JSON.stringify(warn.mock.calls)}`).toBeTruthy();
    expect(String(fallbackWarn?.[1] ?? '')).toMatch(/ServicePrompt fallback/);
    vi.doUnmock('../../utils/logger.js');
    vi.resetModules();
  });

  it('AITitleGenerationService: no svc provided → WARN { key, reason } + fallback body', async () => {
    vi.resetModules();
    const { AITitleGenerationService } = await import('../AITitleGenerationService.js');
    const logger = makeLogger();
    const svc = new AITitleGenerationService(logger as any, {});
    // Calling with undefined svc should still warn — "fallback because no svc"
    // is also a drift signal worth logging.
    const result = await (svc as any).getTitleGenerationPrompt(undefined);
    expect(result).toContain('title generator');
    const warnCalls = logger.warn.mock.calls;
    const fallbackWarn = warnCalls.find((args: any[]) => {
      const obj = args[0];
      const msg = String(args[1] ?? '');
      return (
        obj &&
        obj.key === 'title_gen.ai_service' &&
        typeof obj.reason === 'string' &&
        /ServicePrompt fallback/.test(msg)
      );
    });
    expect(fallbackWarn, `warn calls = ${JSON.stringify(warnCalls)}`).toBeTruthy();
    expect(String(fallbackWarn?.[1] ?? '')).toMatch(/ServicePrompt fallback/);
  });

  it('AITitleGenerationService: svc.getPrompt throws → WARN { key, reason } + fallback', async () => {
    vi.resetModules();
    const { AITitleGenerationService } = await import('../AITitleGenerationService.js');
    const logger = makeLogger();
    const svc = new AITitleGenerationService(logger as any, {});
    const result = await (svc as any).getTitleGenerationPrompt(makeThrowingSvc());
    expect(result).toContain('title generator');
    const fallbackWarn = logger.warn.mock.calls.find((args: any[]) => {
      const obj = args[0];
      const msg = String(args[1] ?? '');
      return (
        obj &&
        obj.key === 'title_gen.ai_service' &&
        typeof obj.reason === 'string' &&
        /ServicePrompt fallback/.test(msg)
      );
    });
    expect(fallbackWarn, `warn calls = ${JSON.stringify(logger.warn.mock.calls)}`).toBeTruthy();
    expect(String(fallbackWarn?.[1] ?? '')).toMatch(/ServicePrompt fallback/);
  });

  it('TitleGenerationClient: svc.getPrompt throws → WARN { key, reason } + fallback', async () => {
    vi.resetModules();
    const { TitleGenerationClient } = await import('../TitleGenerationClient.js');
    const logger = makeLogger();
    const client = new TitleGenerationClient(logger as any, {});
    const result = await (client as any).getMultipleTitlesPrompt(makeThrowingSvc());
    expect(result).toContain('title');
    const fallbackWarn = logger.warn.mock.calls.find((args: any[]) => {
      const obj = args[0];
      const msg = String(args[1] ?? '');
      return (
        obj &&
        obj.key === 'title_gen.client' &&
        typeof obj.reason === 'string' &&
        /ServicePrompt fallback/.test(msg)
      );
    });
    expect(fallbackWarn, `warn calls = ${JSON.stringify(logger.warn.mock.calls)}`).toBeTruthy();
    expect(String(fallbackWarn?.[1] ?? '')).toMatch(/ServicePrompt fallback/);
  });

  it('CodeModeSessionService: svc.getPrompt throws → WARN { key, reason } + fallback', async () => {
    vi.resetModules();
    const { CodeModeSessionService } = await import('../CodeModeSessionService.js');
    const logger = makeLogger();
    const fakePm = {} as any;
    const svc = new CodeModeSessionService(logger as any, fakePm);
    const result = await (svc as any).getSummarySystemPrompt(makeThrowingSvc());
    expect(result).toContain('summariz'); // 'summarizes coding'
    const fallbackWarn = logger.warn.mock.calls.find((args: any[]) => {
      const obj = args[0];
      const msg = String(args[1] ?? '');
      return (
        obj &&
        obj.key === 'codemode.summary_prompt' &&
        typeof obj.reason === 'string' &&
        /ServicePrompt fallback/.test(msg)
      );
    });
    expect(fallbackWarn, `warn calls = ${JSON.stringify(logger.warn.mock.calls)}`).toBeTruthy();
    expect(String(fallbackWarn?.[1] ?? '')).toMatch(/ServicePrompt fallback/);
  });

  it('MemoryContextService: svc.getPrompt throws → WARN { key, reason } + fallback', async () => {
    vi.resetModules();
    const mod = await import('../../memory/services/MemoryContextService.js');
    const MemoryContextService = (mod as any).MemoryContextService;
    expect(MemoryContextService).toBeTruthy();
    const logger = makeLogger();
    // MemoryContextService constructor signature varies — try minimal init
    let svc: any;
    try {
      svc = new MemoryContextService({ logger });
    } catch {
      try {
        svc = new MemoryContextService(logger);
      } catch {
        svc = new MemoryContextService();
      }
    }
    // Inject logger on the instance for the warn assertion if needed.
    if (!('logger' in svc) || !svc.logger) svc.logger = logger;
    const result = await svc.getContextSystemPrompt(makeThrowingSvc(), 'context_system');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    const fallbackWarn = logger.warn.mock.calls.find((args: any[]) => {
      const obj = args[0];
      const msg = String(args[1] ?? '');
      return (
        obj &&
        (obj.key === 'memory.context_system' || obj.key === 'memory.context_build') &&
        typeof obj.reason === 'string' &&
        /ServicePrompt fallback/.test(msg)
      );
    });
    expect(fallbackWarn, `warn calls = ${JSON.stringify(logger.warn.mock.calls)}`).toBeTruthy();
    expect(String(fallbackWarn?.[1] ?? '')).toMatch(/ServicePrompt fallback/);
  });
});
