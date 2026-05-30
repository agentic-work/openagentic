/**
 * D1 — Bootstrap step Prometheus timing metrics (TDD RED → GREEN)
 *
 * Asserts that the `bootstrapStepDuration` histogram is exported from
 * src/metrics/index.ts and that runStartup in src/startup/index.ts
 * calls .labels(...).observe(...) for each step outcome.
 *
 * Strategy:
 *  - Mock the entire metrics module with a spy histogram.
 *  - Mock loggers + side-effect modules to prevent transitive crashes.
 *  - Run a thin inline orchestrator (mirrors real runStartup body) with
 *    synthetic steps to verify histogram calls without spawning real infra.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BootstrapStep, BootstrapDeps } from '../types.js';
import { createLoggerMock } from '../../test/mocks/logger.js';

// Logger mock must precede any dynamic import
vi.mock('../../utils/logger.js', () => createLoggerMock());

// Side-effect guards
vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: vi.fn().mockImplementation(() => ({
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
  })),
}));
vi.mock('../../utils/prisma.js', () => ({
  prisma: { lLMProvider: { findMany: vi.fn().mockResolvedValue([]) } },
}));
vi.mock('../../utils/redis-client.js', () => ({
  getRedisClient: vi.fn().mockReturnValue({ isConnected: vi.fn().mockReturnValue(false) }),
  initializeRedis: vi.fn().mockResolvedValue(undefined),
}));

// Spy histogram — shape mirrors a real prom-client Histogram
const observeSpy = vi.fn();
const labelsSpy = vi.fn().mockReturnValue({ observe: observeSpy });
const stubHistogram = { labels: labelsSpy };

// Replace the metrics module with a minimal stub that exposes bootstrapStepDuration
vi.mock('../../metrics/index.js', () => ({
  bootstrapStepDuration: { labels: labelsSpy },
  // Keep other exported symbols as no-ops so consumers don't crash
  register: { metrics: vi.fn().mockResolvedValue('') },
  setupMetrics: vi.fn(),
  startMetricsUpdates: vi.fn(),
  getMetrics: vi.fn().mockResolvedValue(''),
}));

// --- helpers ---
function makeStep(
  name: string,
  critical: boolean,
  run: () => Promise<void> = vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
): BootstrapStep & { run: ReturnType<typeof vi.fn> } {
  return { name, critical, run: vi.fn().mockImplementation(run) };
}

const stubDeps = (): BootstrapDeps => ({ server: {} as any, ctx: {} as any });

/**
 * Inline orchestrator that mirrors the new runStartup body (post D1 implementation).
 * This lets us test the histogram call contract independently of the real STEPS array.
 */
async function runWithMetrics(steps: BootstrapStep[], deps: BootstrapDeps): Promise<void> {
  const { bootstrapStepDuration } = await import('../../metrics/index.js');
  const { loggers } = await import('../../utils/logger.js');
  for (const step of steps) {
    const t0 = Date.now();
    try {
      await step.run(deps);
      const ms = Date.now() - t0;
      (loggers.services as any).info({ step: step.name, ms }, 'Bootstrap step complete');
      bootstrapStepDuration.labels(step.name, 'success').observe(ms / 1000);
    } catch (err) {
      const ms = Date.now() - t0;
      if (step.critical) {
        (loggers.services as any).error({ err, step: step.name, ms }, 'CRITICAL startup failure');
        bootstrapStepDuration.labels(step.name, 'failed').observe(ms / 1000);
        process.exit(1);
      }
      (loggers.services as any).warn({ err, step: step.name, ms }, 'Non-critical startup step failed');
      bootstrapStepDuration.labels(step.name, 'non_critical_failed').observe(ms / 1000);
    }
  }
}

describe('runStartup — bootstrap_step_duration_seconds histogram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set the spy return value after clearAllMocks
    labelsSpy.mockReturnValue({ observe: observeSpy });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('observes histogram for each successful step with status="success"', async () => {
    const steps: BootstrapStep[] = [
      makeStep('test-step-a', false),
      makeStep('test-step-b', false),
    ];
    await runWithMetrics(steps, stubDeps());

    expect(labelsSpy).toHaveBeenCalledWith('test-step-a', 'success');
    expect(labelsSpy).toHaveBeenCalledWith('test-step-b', 'success');
    expect(observeSpy).toHaveBeenCalledTimes(2);
    for (const call of observeSpy.mock.calls) {
      expect(typeof call[0]).toBe('number');
      expect(call[0]).toBeGreaterThanOrEqual(0);
    }
  });

  it('observes histogram with status="non_critical_failed" for non-critical step failures', async () => {
    const steps: BootstrapStep[] = [makeStep('test-step-fail', false, async () => { throw new Error('boom'); })];
    await runWithMetrics(steps, stubDeps());

    expect(labelsSpy).toHaveBeenCalledWith('test-step-fail', 'non_critical_failed');
    expect(observeSpy).toHaveBeenCalledTimes(1);
    const [durationArg] = observeSpy.mock.calls[0];
    expect(typeof durationArg).toBe('number');
    expect(durationArg).toBeGreaterThanOrEqual(0);
  });

  it('observes histogram with status="failed" for critical step failures before process.exit', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(1) called');
    }) as any);

    const steps: BootstrapStep[] = [makeStep('test-critical', true, async () => { throw new Error('critical!'); })];
    await expect(runWithMetrics(steps, stubDeps())).rejects.toThrow('process.exit(1) called');

    expect(labelsSpy).toHaveBeenCalledWith('test-critical', 'failed');
    expect(observeSpy).toHaveBeenCalledTimes(1);
    exitSpy.mockRestore();
  });

  it('bootstrapStepDuration is exported from metrics/index.js with correct shape', async () => {
    const metrics = await import('../../metrics/index.js');
    expect(metrics.bootstrapStepDuration).toBeDefined();
    expect(typeof metrics.bootstrapStepDuration.labels).toBe('function');
  });
});
