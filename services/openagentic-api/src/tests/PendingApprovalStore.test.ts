import { describe, test, expect } from 'vitest';
import { PendingApprovalStore } from '../services/PendingApprovalStore.js';

describe('PendingApprovalStore', () => {
  test('create returns a promise and id', () => {
    const store = new PendingApprovalStore();
    const { promise, id } = store.create('tool-1');
    expect(id).toMatch(/^hitl-/);
    expect(promise).toBeInstanceOf(Promise);
    store.clear();
  });

  test('resolve with approved=true resolves the promise', async () => {
    const store = new PendingApprovalStore();
    const { promise, id } = store.create('tool-1');
    store.resolve(id, true);
    const result = await promise;
    expect(result.approved).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  test('resolve with approved=false resolves as denied', async () => {
    const store = new PendingApprovalStore();
    const { promise, id } = store.create('tool-1');
    store.resolve(id, false);
    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  test('timeout resolves as denied with timedOut=true', async () => {
    const store = new PendingApprovalStore();
    const { promise } = store.create('tool-1', 50); // 50ms timeout
    const result = await promise;
    expect(result.approved).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  test('resolve returns false for unknown id', () => {
    const store = new PendingApprovalStore();
    expect(store.resolve('unknown', true)).toBe(false);
  });

  test('resolve returns false for already-resolved id', async () => {
    const store = new PendingApprovalStore();
    const { promise, id } = store.create('tool-1');
    expect(store.resolve(id, true)).toBe(true);
    expect(store.resolve(id, true)).toBe(false);
    await promise;
  });

  test('has returns true for pending, false after resolve', () => {
    const store = new PendingApprovalStore();
    const { id } = store.create('tool-1');
    expect(store.has(id)).toBe(true);
    store.resolve(id, true);
    expect(store.has(id)).toBe(false);
    store.clear();
  });

  test('size tracks pending count', () => {
    const store = new PendingApprovalStore();
    expect(store.size).toBe(0);
    const { id: id1 } = store.create('tool-1');
    const { id: id2 } = store.create('tool-2');
    expect(store.size).toBe(2);
    store.resolve(id1, true);
    expect(store.size).toBe(1);
    store.clear();
  });

  test('clear resolves all pending as denied', async () => {
    const store = new PendingApprovalStore();
    const { promise: p1 } = store.create('tool-1');
    const { promise: p2 } = store.create('tool-2');
    store.clear();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.approved).toBe(false);
    expect(r2.approved).toBe(false);
    expect(store.size).toBe(0);
  });

  test('waitMs reflects actual wait time', async () => {
    const store = new PendingApprovalStore();
    const { promise, id } = store.create('tool-1');
    await new Promise(r => setTimeout(r, 20));
    store.resolve(id, true);
    const result = await promise;
    expect(result.waitMs).toBeGreaterThanOrEqual(15);
  });
});
