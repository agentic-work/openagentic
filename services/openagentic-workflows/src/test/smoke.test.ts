import { describe, it, expect } from 'vitest';
import { testUtils } from './setup.js';

describe('vitest harness smoke', () => {
  it('runs a passing test', () => {
    expect(1 + 1).toBe(2);
  });

  it('exposes testUtils', () => {
    const id = testUtils.generateTestId();
    expect(id).toMatch(/^test-\d+-/);
  });

  it('honors process.env from setup', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.WORKFLOW_SECRET_KEY).toBeDefined();
  });
});
