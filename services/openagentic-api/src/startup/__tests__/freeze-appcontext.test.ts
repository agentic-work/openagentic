/**
 * Wave C Fix C3 — AppContext freeze after runStartup.
 *
 * Contract: once all bootstrap writes are complete, ctx must be
 * Object.frozen so that accidental post-startup mutations throw
 * a TypeError in strict mode (ESM modules are always strict).
 *
 * The freeze is applied in server.ts after all startup assignments
 * complete via a dedicated freezeAppContext() helper exported from
 * context/AppContext.ts.
 *
 * RED: AppContext is mutable before the freeze helper exists.
 * GREEN: after freeze helper + server.ts wiring, mutations throw.
 */
import { describe, it, expect } from 'vitest';
import { AppContext, freezeAppContext } from '../../context/AppContext.js';

describe('Fix C3 — AppContext frozen post-runStartup', () => {
  it('freezeAppContext() is exported from AppContext.ts', () => {
    expect(typeof freezeAppContext).toBe('function');
  });

  it('after freezeAppContext(ctx), top-level field write throws TypeError', () => {
    const ctx = new AppContext({ prisma: {} as any, logger: {} as any });
    freezeAppContext(ctx);
    expect(() => {
      // In ESM strict mode, writing to a frozen object throws TypeError
      (ctx as any).providerManager = {} as any;
    }).toThrow(TypeError);
  });

  it('after freezeAppContext(ctx), ctx.deps field write throws TypeError', () => {
    const ctx = new AppContext({ prisma: {} as any, logger: {} as any });
    freezeAppContext(ctx);
    expect(() => {
      (ctx.deps as any).prisma = null;
    }).toThrow(TypeError);
  });

  it('Object.isFrozen(ctx) is true after freezeAppContext', () => {
    const ctx = new AppContext({ prisma: {} as any, logger: {} as any });
    expect(Object.isFrozen(ctx)).toBe(false);
    freezeAppContext(ctx);
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it('Object.isFrozen(ctx.deps) is true after freezeAppContext', () => {
    const ctx = new AppContext({ prisma: {} as any, logger: {} as any });
    freezeAppContext(ctx);
    expect(Object.isFrozen(ctx.deps)).toBe(true);
  });
});
