/**
 * D2 — Code-WS auth helper (TDD RED → GREEN)
 *
 * Tests for src/routes/code-ws/_auth.ts:
 *   validateWsRequest(token, ws) → { user, sliceIdLookup } | null
 *
 * Contract:
 *  - Valid token + valid permissions  → returns { user, canAccessAwcode }
 *  - Missing token                    → closes socket with 4001, returns null
 *  - Invalid token                    → closes socket with 4001, returns null
 *  - Valid token, no permission       → closes socket with 4003, returns null
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLoggerMock } from '../../../test/mocks/logger.js';

// Logger mock must precede any dynamic import
vi.mock('../../../utils/logger.js', () => createLoggerMock());

// Mock validateAnyToken
const mockValidateAnyToken = vi.fn();
vi.mock('../../../auth/tokenValidator.js', () => ({
  validateAnyToken: mockValidateAnyToken,
}));

// Mock UserPermissionsService
const mockCanAccessAwcode = vi.fn();
vi.mock('../../../services/UserPermissionsService.js', () => ({
  UserPermissionsService: vi.fn().mockImplementation(() => ({
    canAccessAwcode: mockCanAccessAwcode,
  })),
}));

// Mock prisma
vi.mock('../../../utils/prisma.js', () => ({
  prisma: { codeSession: { findFirst: vi.fn().mockResolvedValue(null) } },
}));

// Stub WS socket
function makeWs() {
  return { close: vi.fn(), send: vi.fn() };
}

describe('validateWsRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns user and canAccessAwcode=true when token is valid and permission is granted', async () => {
    const { validateWsRequest } = await import('../_auth.js');

    mockValidateAnyToken.mockResolvedValue({
      isValid: true,
      user: { userId: 'user-1', email: 'a@b.com', isAdmin: false, groups: [] },
    });
    mockCanAccessAwcode.mockResolvedValue(true);

    const ws = makeWs();
    const result = await validateWsRequest('valid-token', ws);

    expect(result).not.toBeNull();
    expect(result!.user.userId).toBe('user-1');
    expect(result!.canAccessAwcode).toBe(true);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('closes socket with 4001 and returns null when token is missing', async () => {
    const { validateWsRequest } = await import('../_auth.js');

    const ws = makeWs();
    const result = await validateWsRequest(undefined, ws);

    expect(result).toBeNull();
    expect(ws.close).toHaveBeenCalledWith(4001, expect.any(String));
    expect(mockValidateAnyToken).not.toHaveBeenCalled();
  });

  it('closes socket with 4001 and returns null when token is invalid', async () => {
    const { validateWsRequest } = await import('../_auth.js');

    mockValidateAnyToken.mockResolvedValue({
      isValid: false,
      error: 'token expired',
    });

    const ws = makeWs();
    const result = await validateWsRequest('bad-token', ws);

    expect(result).toBeNull();
    expect(ws.close).toHaveBeenCalledWith(4001, expect.any(String));
  });

  it('closes socket with 4003 and returns null when user lacks AWCode permission', async () => {
    const { validateWsRequest } = await import('../_auth.js');

    mockValidateAnyToken.mockResolvedValue({
      isValid: true,
      user: { userId: 'user-2', email: 'b@c.com', isAdmin: false, groups: [] },
    });
    mockCanAccessAwcode.mockResolvedValue(false);

    const ws = makeWs();
    const result = await validateWsRequest('valid-token', ws);

    expect(result).toBeNull();
    expect(ws.close).toHaveBeenCalledWith(4003, expect.any(String));
  });

  it('returns canAccessAwcode=true for admin users regardless of group membership', async () => {
    const { validateWsRequest } = await import('../_auth.js');

    mockValidateAnyToken.mockResolvedValue({
      isValid: true,
      user: { userId: 'admin-1', email: 'admin@b.com', isAdmin: true, groups: [] },
    });
    mockCanAccessAwcode.mockResolvedValue(true);

    const ws = makeWs();
    const result = await validateWsRequest('admin-token', ws);

    expect(result).not.toBeNull();
    expect(result!.user.isAdmin).toBe(true);
    // Verify the helper passed isAdmin=true to permissions service
    expect(mockCanAccessAwcode).toHaveBeenCalledWith('admin-1', true, []);
  });
});
