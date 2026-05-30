/**
 * Tests for ACL wiring inside WorkflowSecretService.resolveSecretValue()
 *
 * These tests mock the Prisma client so they run without a real database.
 * The goal is to verify that:
 *   1. When a secret row's allowed_node_types is non-empty and the caller's
 *      nodeType is not in the list, resolveSecretValue returns null.
 *   2. A warn-level log is emitted on ACL denial (no secret value logged).
 *   3. Legacy callers that omit nodeType/userId/userGroups are unaffected.
 *   4. All three check dimensions (node_type, user, group) trigger denial.
 *   5. An all-empty row resolves normally (no restriction).
 *
 * S0-9 / B5
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the Prisma client BEFORE importing the service under test
// ---------------------------------------------------------------------------
vi.mock('../utils/prisma.js', () => ({
  prisma: {
    workflowSecret: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../utils/logger.js', () => ({
  loggers: {
    services: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { WorkflowSecretService } from './WorkflowSecretService.js';

// A minimal secret row with no meaningful encrypted value.
// The service's decryptSecret path tries to decrypt; we supply a stub that
// satisfies the field check but we intercept before decryption via early
// ACL denial — so when ACL denies, decryptSecret is never called.
function makeSecretRow(overrides: Record<string, any> = {}) {
  return {
    id: 'secret-id-1',
    name: 'test-secret',
    scope: 'global',
    group_id: null,
    workflow_id: null,
    eso_enabled: false,
    eso_remote_ref: {},
    eso_secret_store: 'openagentic-secrets',
    eso_secret_store_kind: 'ClusterSecretStore',
    k8s_secret_name: null,
    k8s_secret_namespace: 'openagentic',
    k8s_secret_key: 'value',
    encrypted_value: null,
    encryption_key_id: null,
    allowed_node_types: [],
    allowed_users: [],
    allowed_groups: [],
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const warnMock = loggers.services.warn as ReturnType<typeof vi.fn>;
const findFirstMock = prisma.workflowSecret.findFirst as ReturnType<typeof vi.fn>;

describe('WorkflowSecretService.resolveSecretValue — ACL wiring', () => {
  let service: WorkflowSecretService;

  beforeEach(() => {
    service = new WorkflowSecretService();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Denial by node_type
  // -------------------------------------------------------------------------

  it('returns null when nodeType not in allowed_node_types', async () => {
    findFirstMock.mockResolvedValue(
      makeSecretRow({ allowed_node_types: ['test-node-a'] }),
    );

    const result = await service.resolveSecretValue('test-secret', {
      nodeType: 'test-node-b',
      userId: 'user-1',
      userGroups: [],
    });

    expect(result).toBeNull();
  });

  it('emits warn log on node_type ACL denial with structured fields', async () => {
    findFirstMock.mockResolvedValue(
      makeSecretRow({ id: 'sec-abc', allowed_node_types: ['test-node-a'] }),
    );

    await service.resolveSecretValue('test-secret', {
      nodeType: 'test-node-b',
      userId: 'user-1',
      userGroups: [],
    });

    expect(warnMock).toHaveBeenCalledOnce();
    const [logObj] = warnMock.mock.calls[0];
    expect(logObj).toMatchObject({
      secretName: 'test-secret',
      secretId: 'sec-abc',
      reason: 'node_type',
      nodeType: 'test-node-b',
      userId: 'user-1',
    });
    // Must NOT log the secret value
    expect(JSON.stringify(logObj)).not.toContain('encrypted_value');
    expect(JSON.stringify(logObj)).not.toContain('decrypted');
  });

  // -------------------------------------------------------------------------
  // Denial by user
  // -------------------------------------------------------------------------

  it('returns null when userId not in allowed_users', async () => {
    findFirstMock.mockResolvedValue(
      makeSecretRow({ allowed_users: ['user-allowed'] }),
    );

    const result = await service.resolveSecretValue('test-secret', {
      nodeType: 'test-node-a',
      userId: 'user-denied',
      userGroups: [],
    });

    expect(result).toBeNull();
  });

  it('emits warn log on user ACL denial', async () => {
    findFirstMock.mockResolvedValue(
      makeSecretRow({ allowed_users: ['user-allowed'] }),
    );

    await service.resolveSecretValue('test-secret', {
      nodeType: 'test-node-a',
      userId: 'user-denied',
      userGroups: [],
    });

    expect(warnMock).toHaveBeenCalledOnce();
    const [logObj] = warnMock.mock.calls[0];
    expect(logObj).toMatchObject({ reason: 'user', userId: 'user-denied' });
  });

  // -------------------------------------------------------------------------
  // Denial by group
  // -------------------------------------------------------------------------

  it('returns null when userGroups has no intersection with allowed_groups', async () => {
    findFirstMock.mockResolvedValue(
      makeSecretRow({ allowed_groups: ['gid-allowed'] }),
    );

    const result = await service.resolveSecretValue('test-secret', {
      nodeType: 'test-node-a',
      userId: 'user-1',
      userGroups: ['gid-other'],
    });

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Legacy callers — no nodeType / userId / userGroups provided
  // -------------------------------------------------------------------------

  it('skips ACL checks when no ACL context provided (legacy pre-load path)', async () => {
    // Row has non-empty allowed_node_types but no ACL context is passed.
    // resolveSecretValue should NOT deny — ACL check skipped when ctx fields absent.
    // We return a row with eso_enabled=false and a null encrypted_value so
    // decryptSecret will also return null (no config), but we're testing no denial.
    findFirstMock.mockResolvedValue(
      makeSecretRow({ allowed_node_types: ['test-node-a'], encrypted_value: null }),
    );

    // Does not throw or emit warn log
    await service.resolveSecretValue('test-secret', { workflowId: 'wf-1' });

    expect(warnMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Pass-through — row with all-empty lists
  // -------------------------------------------------------------------------

  it('does not deny or warn when all allowed_* arrays are empty', async () => {
    // Return null from all findFirst calls except the last (global)
    findFirstMock.mockResolvedValue(
      makeSecretRow({
        allowed_node_types: [],
        allowed_users: [],
        allowed_groups: [],
        encrypted_value: null, // decryptSecret returns null — not testing that here
      }),
    );

    await service.resolveSecretValue('test-secret', {
      nodeType: 'test-node-a',
      userId: 'user-1',
      userGroups: [],
    });

    expect(warnMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // ACL pass — allowed node resolves normally (decryptSecret path omitted
  // since we don't have a real key; just verify no denial + no warn)
  // -------------------------------------------------------------------------

  it('does not deny when nodeType is in allowed_node_types', async () => {
    findFirstMock.mockResolvedValue(
      makeSecretRow({
        allowed_node_types: ['test-node-a'],
        encrypted_value: null,
      }),
    );

    // No denial → no warn; return value may be null (no encrypted_value), that's fine
    await service.resolveSecretValue('test-secret', {
      nodeType: 'test-node-a',
      userId: 'user-1',
      userGroups: [],
    });

    expect(warnMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Partial context — only userId missing → skip user check but apply others
  // -------------------------------------------------------------------------

  it('skips user check but applies node_type check when userId absent', async () => {
    findFirstMock.mockResolvedValue(
      makeSecretRow({
        allowed_node_types: ['test-node-a'],
        allowed_users: ['user-alpha'],
      }),
    );

    // nodeType doesn't match → should still deny on node_type
    const result = await service.resolveSecretValue('test-secret', {
      nodeType: 'test-node-b',
      // userId intentionally omitted
      userGroups: [],
    });

    expect(result).toBeNull();
    expect(warnMock).toHaveBeenCalledOnce();
    const [logObj] = warnMock.mock.calls[0];
    expect(logObj.reason).toBe('node_type');
  });
});
