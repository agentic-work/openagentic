/**
 * Tests for the pure ACL decision helper: checkSecretAcl()
 *
 * All tests use generic node types / IDs — no model-specific literals.
 */
import { describe, it, expect } from 'vitest';
import { checkSecretAcl } from './secretAcl.js';
import type { AclSecretRow, AclDecisionContext } from './secretAcl.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(overrides: Partial<AclDecisionContext> = {}): AclDecisionContext {
  return {
    nodeType: 'test-node-a',
    userId: 'user-alpha',
    userGroups: [],
    ...overrides,
  };
}

function row(overrides: Partial<AclSecretRow> = {}): AclSecretRow {
  return {
    allowed_node_types: null,
    allowed_users: null,
    allowed_groups: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// All-empty / null lists → no restriction
// ---------------------------------------------------------------------------

describe('checkSecretAcl — all-empty / null lists', () => {
  it('allows when all three fields are null', () => {
    const result = checkSecretAcl(row(), ctx());
    expect(result.allowed).toBe(true);
  });

  it('allows when all three fields are empty arrays', () => {
    const result = checkSecretAcl(
      row({ allowed_node_types: [], allowed_users: [], allowed_groups: [] }),
      ctx(),
    );
    expect(result.allowed).toBe(true);
  });

  it('allows when node_types is empty but user/group lists are also empty', () => {
    const result = checkSecretAcl(
      row({ allowed_node_types: [], allowed_users: [], allowed_groups: [] }),
      ctx({ nodeType: 'test-node-b', userId: 'user-beta', userGroups: ['gid-x'] }),
    );
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// allowed_node_types checks
// ---------------------------------------------------------------------------

describe('checkSecretAcl — allowed_node_types', () => {
  it('denies when nodeType not in allowed_node_types (single entry)', () => {
    const result = checkSecretAcl(
      row({ allowed_node_types: ['test-node-a'] }),
      ctx({ nodeType: 'test-node-b' }),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('node_type');
  });

  it('allows when nodeType is in allowed_node_types (single entry)', () => {
    const result = checkSecretAcl(
      row({ allowed_node_types: ['test-node-a'] }),
      ctx({ nodeType: 'test-node-a' }),
    );
    expect(result.allowed).toBe(true);
  });

  it('allows when nodeType is one of multiple allowed_node_types', () => {
    const result = checkSecretAcl(
      row({ allowed_node_types: ['test-node-a', 'test-node-c'] }),
      ctx({ nodeType: 'test-node-c' }),
    );
    expect(result.allowed).toBe(true);
  });

  it('denies when nodeType does not match any of multiple allowed_node_types', () => {
    const result = checkSecretAcl(
      row({ allowed_node_types: ['test-node-a', 'test-node-c'] }),
      ctx({ nodeType: 'test-node-b' }),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('node_type');
  });

  it('deny result includes a non-empty details string', () => {
    const result = checkSecretAcl(
      row({ allowed_node_types: ['test-node-a'] }),
      ctx({ nodeType: 'test-node-b' }),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.details.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// allowed_users checks
// ---------------------------------------------------------------------------

describe('checkSecretAcl — allowed_users', () => {
  it('denies when userId not in allowed_users', () => {
    const result = checkSecretAcl(
      row({ allowed_users: ['user-alpha'] }),
      ctx({ userId: 'user-beta' }),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('user');
  });

  it('allows when userId is in allowed_users', () => {
    const result = checkSecretAcl(
      row({ allowed_users: ['user-alpha'] }),
      ctx({ userId: 'user-alpha' }),
    );
    expect(result.allowed).toBe(true);
  });

  it('allows when userId is one of multiple allowed_users', () => {
    const result = checkSecretAcl(
      row({ allowed_users: ['user-alpha', 'user-gamma'] }),
      ctx({ userId: 'user-gamma' }),
    );
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// allowed_groups checks
// ---------------------------------------------------------------------------

describe('checkSecretAcl — allowed_groups', () => {
  it('denies when userGroups has no member of allowed_groups', () => {
    const result = checkSecretAcl(
      row({ allowed_groups: ['gid-1'] }),
      ctx({ userGroups: ['gid-2'] }),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('group');
  });

  it('allows when userGroups contains an allowed group (single intersection)', () => {
    const result = checkSecretAcl(
      row({ allowed_groups: ['gid-1'] }),
      ctx({ userGroups: ['gid-2', 'gid-1'] }),
    );
    expect(result.allowed).toBe(true);
  });

  it('allows when userGroups has multiple members, one in allowed_groups', () => {
    const result = checkSecretAcl(
      row({ allowed_groups: ['gid-3', 'gid-4'] }),
      ctx({ userGroups: ['gid-99', 'gid-3'] }),
    );
    expect(result.allowed).toBe(true);
  });

  it('denies when userGroups is empty and allowed_groups is non-empty', () => {
    const result = checkSecretAcl(
      row({ allowed_groups: ['gid-1'] }),
      ctx({ userGroups: [] }),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('group');
  });
});

// ---------------------------------------------------------------------------
// Multiple non-empty lists — AND semantics + deterministic order
// ---------------------------------------------------------------------------

describe('checkSecretAcl — combined ACL checks, deterministic order', () => {
  it('denies on node_type first when both node_type and user checks fail', () => {
    // ctx fails allowed_node_types AND allowed_users
    const result = checkSecretAcl(
      row({ allowed_node_types: ['test-node-a'], allowed_users: ['user-alpha'] }),
      ctx({ nodeType: 'test-node-b', userId: 'user-beta' }),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('node_type'); // node_type checked first
  });

  it('denies on node_type first when all three checks fail', () => {
    const result = checkSecretAcl(
      row({
        allowed_node_types: ['test-node-a'],
        allowed_users: ['user-alpha'],
        allowed_groups: ['gid-1'],
      }),
      ctx({ nodeType: 'test-node-b', userId: 'user-beta', userGroups: ['gid-9'] }),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('node_type');
  });

  it('denies on user when node_type passes but user fails', () => {
    const result = checkSecretAcl(
      row({ allowed_node_types: ['test-node-a'], allowed_users: ['user-alpha'] }),
      ctx({ nodeType: 'test-node-a', userId: 'user-beta' }),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('user');
  });

  it('denies on group when node_type and user pass but group fails', () => {
    const result = checkSecretAcl(
      row({
        allowed_node_types: ['test-node-a'],
        allowed_users: ['user-alpha'],
        allowed_groups: ['gid-1'],
      }),
      ctx({ nodeType: 'test-node-a', userId: 'user-alpha', userGroups: ['gid-9'] }),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe('group');
  });

  it('allows when all three lists non-empty and ctx satisfies each', () => {
    const result = checkSecretAcl(
      row({
        allowed_node_types: ['test-node-a'],
        allowed_users: ['user-alpha'],
        allowed_groups: ['gid-1'],
      }),
      ctx({ nodeType: 'test-node-a', userId: 'user-alpha', userGroups: ['gid-1'] }),
    );
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Null treated same as empty array
// ---------------------------------------------------------------------------

describe('checkSecretAcl — null vs empty array equivalence', () => {
  it('treats null allowed_node_types as no restriction', () => {
    const result = checkSecretAcl(
      row({ allowed_node_types: null, allowed_users: ['user-alpha'] }),
      ctx({ nodeType: 'any-node-type', userId: 'user-alpha' }),
    );
    expect(result.allowed).toBe(true);
  });

  it('treats null allowed_users as no restriction', () => {
    const result = checkSecretAcl(
      row({ allowed_node_types: ['test-node-a'], allowed_users: null }),
      ctx({ nodeType: 'test-node-a', userId: 'user-whoever' }),
    );
    expect(result.allowed).toBe(true);
  });

  it('treats null allowed_groups as no restriction', () => {
    const result = checkSecretAcl(
      row({ allowed_groups: null }),
      ctx({ userGroups: [] }),
    );
    expect(result.allowed).toBe(true);
  });
});
