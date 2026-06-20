/**
 * F1.7 — RED unit tests for RegistryCache.
 *
 * the design notes (F1.7)
 *
 * RegistryCache is an LRU cache (TTL=30s) wrapped around resolveModel().
 * Postgres LISTEN/NOTIFY on the `model_registry_changed` channel triggers
 * invalidation; TTL is the safety net if NOTIFY misses.
 *
 * F0.5 already shipped the trigger (`notify_model_registry_change()`) on
 * `admin.model_role_assignments` mutations. This cache consumes the channel.
 *
 * Live integration test (real Postgres + NOTIFY end-to-end) lands at F2's
 * cold-install + hot-restart deploy-verify gate. Unit tests here exercise
 * the cache contract + the listener-dispatch logic with mocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegistryCache } from '../RegistryCache.js';

describe('RegistryCache — get/set/invalidate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('caches role-default lookup and returns the cached value within TTL', async () => {
    const cache = new RegistryCache({ ttlMs: 30_000 });
    const model = { registryRowId: 'row-1', modelId: 'gpt-oss:20b', role: 'chat' } as any;

    cache.setRoleDefault('chat', model);

    expect(cache.getRoleDefault('chat')).toBe(model);
  });

  it('returns undefined after TTL expires', async () => {
    const cache = new RegistryCache({ ttlMs: 30_000 });
    const model = { registryRowId: 'row-1', modelId: 'gpt-oss:20b', role: 'chat' } as any;
    cache.setRoleDefault('chat', model);

    vi.advanceTimersByTime(30_001);

    expect(cache.getRoleDefault('chat')).toBeUndefined();
  });

  it('caches by-id lookup and returns the cached value', async () => {
    const cache = new RegistryCache({ ttlMs: 30_000 });
    const model = { registryRowId: 'row-7', modelId: 'm', role: 'chat' } as any;
    cache.setById('row-7', model);

    expect(cache.getById('row-7')).toBe(model);
  });

  it('invalidateRole(role) drops the role-default entry only', () => {
    const cache = new RegistryCache({ ttlMs: 30_000 });
    cache.setRoleDefault('chat', { registryRowId: 'a' } as any);
    cache.setRoleDefault('embedding', { registryRowId: 'b' } as any);

    cache.invalidateRole('chat');

    expect(cache.getRoleDefault('chat')).toBeUndefined();
    expect(cache.getRoleDefault('embedding')).toBeDefined();
  });

  it('invalidateById(rowId) drops the by-id entry AND any role-default entry pointing at the same row', () => {
    const cache = new RegistryCache({ ttlMs: 30_000 });
    const chatRow = { registryRowId: 'row-7', role: 'chat' } as any;
    cache.setRoleDefault('chat', chatRow);
    cache.setById('row-7', chatRow);
    cache.setById('row-other', { registryRowId: 'row-other', role: 'embedding' } as any);

    cache.invalidateById('row-7');

    expect(cache.getById('row-7')).toBeUndefined();
    expect(cache.getRoleDefault('chat')).toBeUndefined(); // role-default purged because the cached value's row id matches
    expect(cache.getById('row-other')).toBeDefined();
  });

  it('invalidateAll() clears every entry', () => {
    const cache = new RegistryCache({ ttlMs: 30_000 });
    cache.setRoleDefault('chat', { registryRowId: 'a' } as any);
    cache.setById('row-1', { registryRowId: 'row-1' } as any);

    cache.invalidateAll();

    expect(cache.getRoleDefault('chat')).toBeUndefined();
    expect(cache.getById('row-1')).toBeUndefined();
  });
});

describe('RegistryCache — LISTEN/NOTIFY listener', () => {
  it('handleNotification({action: UPDATE, registry_row_id, role}) invalidates by id AND by role', () => {
    const cache = new RegistryCache({ ttlMs: 30_000 });
    cache.setRoleDefault('chat', { registryRowId: 'row-7', role: 'chat' } as any);
    cache.setById('row-7', { registryRowId: 'row-7' } as any);

    cache.handleNotification({
      action: 'UPDATE',
      registry_row_id: 'row-7',
      role: 'chat',
    });

    expect(cache.getById('row-7')).toBeUndefined();
    expect(cache.getRoleDefault('chat')).toBeUndefined();
  });

  it('handleNotification({action: INSERT, role}) invalidates the role-default for that role', () => {
    const cache = new RegistryCache({ ttlMs: 30_000 });
    cache.setRoleDefault('chat', { registryRowId: 'old' } as any);
    cache.setRoleDefault('embedding', { registryRowId: 'emb' } as any);

    cache.handleNotification({
      action: 'INSERT',
      registry_row_id: 'row-new',
      role: 'chat',
    });

    expect(cache.getRoleDefault('chat')).toBeUndefined();
    expect(cache.getRoleDefault('embedding')).toBeDefined();
  });

  it('handleNotification({action: DELETE, registry_row_id, role}) invalidates by id AND by role', () => {
    const cache = new RegistryCache({ ttlMs: 30_000 });
    cache.setRoleDefault('chat', { registryRowId: 'row-7', role: 'chat' } as any);
    cache.setById('row-7', {} as any);

    cache.handleNotification({
      action: 'DELETE',
      registry_row_id: 'row-7',
      role: 'chat',
    });

    expect(cache.getById('row-7')).toBeUndefined();
    expect(cache.getRoleDefault('chat')).toBeUndefined();
  });

  it('handleNotification with malformed payload does not throw — TTL is the safety net', () => {
    const cache = new RegistryCache({ ttlMs: 30_000 });
    cache.setRoleDefault('chat', {} as any);

    expect(() => {
      cache.handleNotification({} as any);
      cache.handleNotification(null as any);
      cache.handleNotification('not-an-object' as any);
    }).not.toThrow();
  });
});
