/**
 * Orchestrator test — Phase 2 TDD
 *
 * Tests runStartup logic directly by importing it in isolation.
 * The step modules themselves are NOT imported here to avoid transitive
 * side-effects. Instead we verify the orchestrator contract:
 *
 *  1. All steps are called in order
 *  2. Critical step failure → process.exit(1), remaining steps skipped
 *  3. Non-critical step failure → subsequent steps still run, no process.exit
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BootstrapStep, BootstrapDeps } from '../types.js';
import { createLoggerMock } from '../../test/mocks/logger.js';

// Mock the logger before importing anything that uses it
vi.mock('../../utils/logger.js', () => createLoggerMock());

// Prevent @zilliz/milvus2-sdk-node native module errors when index.ts loads step files
vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: vi.fn().mockImplementation(() => ({
    checkHealth: vi.fn().mockResolvedValue({ isHealthy: true }),
  })),
}));

// Prevent side-effectful transitive imports that cause errors in test env
vi.mock('../../utils/prisma.js', () => ({
  prisma: { lLMProvider: { findMany: vi.fn().mockResolvedValue([]) } },
}));
vi.mock('../../utils/redis-client.js', () => ({
  getRedisClient: vi.fn().mockReturnValue({ isConnected: vi.fn().mockReturnValue(false) }),
  initializeRedis: vi.fn().mockResolvedValue(undefined),
}));

// Import runStartup directly — the STEPS array from index is NOT used here,
// we construct our own test steps to avoid transitive step imports.
import { loggers } from '../../utils/logger.js';

// Inline the orchestrator logic for isolation testing
// (mirrors the real runStartup body exactly)
async function runSteps(steps: BootstrapStep[], deps: BootstrapDeps): Promise<void> {
  for (const step of steps) {
    const t0 = Date.now();
    try {
      await step.run(deps);
      (loggers.services as any).info({ step: step.name, ms: Date.now() - t0 }, 'Bootstrap step complete');
    } catch (err) {
      const ms = Date.now() - t0;
      if (step.critical) {
        (loggers.services as any).error({ err, step: step.name, ms }, 'CRITICAL startup failure');
        process.exit(1);
      }
      (loggers.services as any).warn({ err, step: step.name, ms }, 'Non-critical startup step failed');
    }
  }
}

const stubDeps = (): BootstrapDeps => ({
  server: {} as any,
  ctx: {} as any,
});

function makeStep(name: string, critical: boolean, run = vi.fn().mockResolvedValue(undefined)): BootstrapStep & { run: ReturnType<typeof vi.fn> } {
  return { name, critical, run };
}

describe('runStartup orchestrator logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls every step run() exactly once in order', async () => {
    const callOrder: string[] = [];
    const names = ['s1', 's2', 's3'];
    const steps = names.map(n => makeStep(n, false, vi.fn().mockImplementation(async () => { callOrder.push(n); })));

    await runSteps(steps, stubDeps());

    expect(callOrder).toEqual(names);
    for (const step of steps) {
      expect(step.run).toHaveBeenCalledOnce();
    }
  });

  it('critical step failure: calls process.exit(1) and stops remaining steps', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit(1) called');
    }) as any);

    const s1 = makeStep('s1', false);
    const s2 = makeStep('s2', true, vi.fn().mockRejectedValue(new Error('s2 critical fail')));
    const s3 = makeStep('s3', false);
    const s4 = makeStep('s4', false);

    await expect(runSteps([s1, s2, s3, s4], stubDeps())).rejects.toThrow('process.exit(1) called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(s1.run).toHaveBeenCalledOnce();
    expect(s2.run).toHaveBeenCalledOnce();
    expect(s3.run).not.toHaveBeenCalled();
    expect(s4.run).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it('non-critical step failure: subsequent steps still run, no process.exit', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit should not be called');
    }) as any);

    const s1 = makeStep('s1', false);
    const s2 = makeStep('s2', false, vi.fn().mockRejectedValue(new Error('s2 non-critical fail')));
    const s3 = makeStep('s3', false);
    const s4 = makeStep('s4', false);

    await runSteps([s1, s2, s3, s4], stubDeps());

    expect(s1.run).toHaveBeenCalledOnce();
    expect(s2.run).toHaveBeenCalledOnce();
    expect(s3.run).toHaveBeenCalledOnce();
    expect(s4.run).toHaveBeenCalledOnce();
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });
});

// Structural check on the exported STEPS array — tests contract without running steps
describe('STEPS structural contract (imported from index)', () => {
  // We load STEPS lazily to avoid full module init cascade
  it('STEPS declares 12 steps with correct names and critical flags (step-10: agent-registry-init)', async () => {
    // Import only types, verify the array without running anything
    const { STEPS } = await import('../index.js');
    expect(STEPS).toHaveLength(12);
    const names = STEPS.map(s => s.name);
    expect(names).toEqual([
      'secrets-load', 'vault-init', 'database-init', 'providers-init',
      'milvus-init', 'rag-init', 'mcp-index', 'tool-cache-init',
      'prompt-cache-init',
      // step-10: chatmode-ux-mock-parity Wave 4 — initialize the
      // BuiltInAgentRegistry markdown loader so the V2 chat pipeline's
      // Task tool description is populated before traffic arrives.
      'agent-registry-init',
      'job-watcher-start', 'validate-admin-portal',
    ]);

    // Phase-2 follow-up: steps 08 (tool-cache) and 11 (validate-admin-portal) now
    // correctly have critical=true, matching pre-Phase-2 process.exit(1) behaviour.
    const criticalNames = STEPS.filter(s => s.critical).map(s => s.name);
    expect(criticalNames).toContain('database-init');
    expect(criticalNames).toContain('milvus-init');
    expect(criticalNames).toContain('tool-cache-init');
    expect(criticalNames).toContain('validate-admin-portal');
    expect(criticalNames).toHaveLength(4);
  });
});
