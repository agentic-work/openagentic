/**
 * TDD — TeamsService
 *
 * Tests:
 *   S1  listTeams returns teams with member_count and shared_flows_count
 *   S2  createTeam creates a UserGroup and writes audit log
 *   S3  createTeam throws on duplicate name (P2002)
 *   S4  updateTeam updates fields and writes audit log
 *   S5  deleteTeam soft-deletes and writes audit log
 *   S6  addMember adds UserGroupMembership and writes audit log
 *   S7  addMember throws when user not found
 *   S8  removeMember deletes membership and writes audit log
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (must be at top before any imports)
// ---------------------------------------------------------------------------
const mockAuditWrite = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockPrismaFns = vi.hoisted(() => ({
  userGroup: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  userGroupMembership: {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  workflowShare: {
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock prisma
// ---------------------------------------------------------------------------
vi.mock('../../utils/prisma.js', () => ({
  prisma: mockPrismaFns,
}));

// ---------------------------------------------------------------------------
// Mock AuditLogService
// ---------------------------------------------------------------------------
vi.mock('../../services/AuditLogService.js', () => ({
  auditLogService: { write: mockAuditWrite },
}));

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
vi.mock('../../utils/logger.js', () => ({
  loggers: {
    services: {
      child: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    },
  },
}));

import { TeamsService } from '../TeamsService.js';

const mockPrisma = mockPrismaFns as any;

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grp-1',
    name: 'engineering',
    display_name: 'Engineering',
    description: 'Eng team',
    parent_group_id: null,
    cost_center: 'CC-100',
    billing_contact_email: 'billing@example.com',
    metadata: {},
    is_active: true,
    created_by: 'user-1',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-02'),
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-99',
    email: 'alice@example.com',
    name: 'Alice',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TeamsService', () => {
  let svc: TeamsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new TeamsService();
  });

  // S1 — listTeams
  it('S1: listTeams returns teams with member_count and shared_flows_count', async () => {
    mockPrisma.userGroup.findMany.mockResolvedValue([
      {
        ...makeGroup(),
        memberships: [{ id: 'm1' }, { id: 'm2' }],
      },
    ]);
    mockPrisma.workflowShare.findMany.mockResolvedValue([{ target_id: 'grp-1' }]);

    const result = await svc.listTeams();

    expect(result).toHaveLength(1);
    expect(result[0].member_count).toBe(2);
    expect(result[0].shared_flows_count).toBe(1);
    expect(mockPrisma.userGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { is_active: true } }),
    );
  });

  // S2 — createTeam
  it('S2: createTeam creates a UserGroup and writes an audit log', async () => {
    const group = makeGroup();
    mockPrisma.userGroup.create.mockResolvedValue(group);

    const result = await svc.createTeam(
      { name: 'engineering', display_name: 'Engineering' },
      { userId: 'user-1', userEmail: 'admin@example.com' },
    );

    expect(result.id).toBe('grp-1');
    expect(mockPrisma.userGroup.create).toHaveBeenCalledOnce();
    expect(mockAuditWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'team.create',
        target_type: 'team',
        outcome: 'success',
      }),
    );
  });

  // S3 — createTeam duplicate name
  it('S3: createTeam throws on duplicate name (Prisma P2002)', async () => {
    const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    mockPrisma.userGroup.create.mockRejectedValue(p2002Error);

    await expect(
      svc.createTeam({ name: 'engineering', display_name: 'Engineering' }, {}),
    ).rejects.toMatchObject({ code: 'TEAM_NAME_CONFLICT' });
  });

  // S4 — updateTeam
  it('S4: updateTeam updates fields and writes audit log', async () => {
    const updated = makeGroup({ display_name: 'Eng Team Updated' });
    mockPrisma.userGroup.update.mockResolvedValue(updated);

    const result = await svc.updateTeam('grp-1', { display_name: 'Eng Team Updated' }, {});

    expect(result.display_name).toBe('Eng Team Updated');
    expect(mockPrisma.userGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grp-1' },
        data: expect.objectContaining({ display_name: 'Eng Team Updated' }),
      }),
    );
    expect(mockAuditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.update', outcome: 'success' }),
    );
  });

  // S5 — deleteTeam (soft-delete)
  it('S5: deleteTeam soft-deletes (is_active=false) and writes audit log', async () => {
    const deactivated = makeGroup({ is_active: false });
    mockPrisma.userGroup.update.mockResolvedValue(deactivated);

    await svc.deleteTeam('grp-1', {});

    expect(mockPrisma.userGroup.update).toHaveBeenCalledWith({
      where: { id: 'grp-1' },
      data: { is_active: false },
    });
    expect(mockAuditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.delete', outcome: 'success' }),
    );
  });

  // S6 — addMember
  it('S6: addMember creates UserGroupMembership and writes audit log', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.userGroupMembership.create.mockResolvedValue({
      id: 'mem-1',
      user_id: 'user-99',
      group_id: 'grp-1',
      role: 'member',
    });

    const result = await svc.addMember('grp-1', 'alice@example.com', {});

    expect(result.user_id).toBe('user-99');
    expect(mockAuditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.member.add', outcome: 'success' }),
    );
  });

  // S7 — addMember throws when user not found
  it('S7: addMember throws USER_NOT_FOUND when user email does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(svc.addMember('grp-1', 'ghost@example.com', {})).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
    expect(mockPrisma.userGroupMembership.create).not.toHaveBeenCalled();
  });

  // S8 — removeMember
  it('S8: removeMember deletes membership and writes audit log', async () => {
    mockPrisma.userGroupMembership.deleteMany.mockResolvedValue({ count: 1 });

    await svc.removeMember('grp-1', 'user-99', {});

    expect(mockPrisma.userGroupMembership.deleteMany).toHaveBeenCalledWith({
      where: { group_id: 'grp-1', user_id: 'user-99' },
    });
    expect(mockAuditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.member.remove', outcome: 'success' }),
    );
  });
});
