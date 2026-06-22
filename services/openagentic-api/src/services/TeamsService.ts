/**
 * TeamsService — CRUD for UserGroup (Teams) + membership + flow sharing.
 *
 * Writes audit log entries on every mutation via AuditLogService.
 *
 * Error codes thrown as { code, message } plain objects:
 *   TEAM_NAME_CONFLICT — name already taken (Prisma P2002)
 *   USER_NOT_FOUND     — email lookup failed when adding a member
 */

import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';
import { auditLogService } from './AuditLogService.js';
import type { AuditActor } from './AuditLogService.js';

const logger = loggers.services.child({ component: 'TeamsService' });

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TeamListItem {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  parent_group_id: string | null;
  cost_center: string | null;
  billing_contact_email: string | null;
  metadata: unknown;
  is_active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  member_count: number;
  shared_flows_count: number;
}

export interface CreateTeamInput {
  name: string;
  display_name: string;
  description?: string;
  parent_group_id?: string;
  cost_center?: string;
  billing_contact_email?: string;
}

export interface UpdateTeamInput {
  display_name?: string;
  description?: string;
  parent_group_id?: string;
  cost_center?: string;
  billing_contact_email?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Domain error factory
// ---------------------------------------------------------------------------

function domainError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TeamsService {
  // ── Teams CRUD ────────────────────────────────────────────────────────────

  async listTeams(): Promise<TeamListItem[]> {
    const groups = await prisma.userGroup.findMany({
      where: { is_active: true },
      include: { memberships: { select: { id: true } } },
      orderBy: { name: 'asc' },
    });

    // Fetch shared-flows counts for all groups in one query
    const groupIds = groups.map(g => g.id);
    const shares = groupIds.length
      ? await prisma.workflowShare.findMany({
          where: { share_type: 'group', target_id: { in: groupIds } },
          select: { target_id: true },
        })
      : [];

    const shareCountMap = new Map<string, number>();
    for (const s of shares) {
      shareCountMap.set(s.target_id, (shareCountMap.get(s.target_id) ?? 0) + 1);
    }

    return groups.map(g => ({
      id: g.id,
      name: g.name,
      display_name: g.display_name,
      description: g.description,
      parent_group_id: g.parent_group_id,
      cost_center: g.cost_center,
      billing_contact_email: g.billing_contact_email,
      metadata: g.metadata,
      is_active: g.is_active,
      created_by: g.created_by,
      created_at: g.created_at,
      updated_at: g.updated_at,
      member_count: (g as any).memberships?.length ?? 0,
      shared_flows_count: shareCountMap.get(g.id) ?? 0,
    }));
  }

  async createTeam(input: CreateTeamInput, actor: AuditActor) {
    try {
      const group = await prisma.userGroup.create({
        data: {
          name: input.name,
          display_name: input.display_name,
          description: input.description ?? null,
          parent_group_id: input.parent_group_id ?? null,
          cost_center: input.cost_center ?? null,
          billing_contact_email: input.billing_contact_email ?? null,
          created_by: actor.userId ?? null,
        },
      });

      await auditLogService.write({
        action: 'team.create',
        target_type: 'team',
        target_id: group.id,
        outcome: 'success',
        actor,
        metadata: { name: group.name },
      });

      logger.info({ groupId: group.id }, 'Team created');
      return group;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw domainError('TEAM_NAME_CONFLICT', `Team name '${input.name}' is already taken`);
      }
      throw err;
    }
  }

  async updateTeam(id: string, input: UpdateTeamInput, actor: AuditActor) {
    const updateData: Record<string, unknown> = {};
    if (input.display_name !== undefined) updateData.display_name = input.display_name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.parent_group_id !== undefined) updateData.parent_group_id = input.parent_group_id;
    if (input.cost_center !== undefined) updateData.cost_center = input.cost_center;
    if (input.billing_contact_email !== undefined) updateData.billing_contact_email = input.billing_contact_email;
    if (input.metadata !== undefined) updateData.metadata = input.metadata as any;

    const group = await prisma.userGroup.update({
      where: { id },
      data: updateData as any,
    });

    await auditLogService.write({
      action: 'team.update',
      target_type: 'team',
      target_id: id,
      outcome: 'success',
      actor,
      metadata: { changes: input },
    });

    return group;
  }

  async deleteTeam(id: string, actor: AuditActor) {
    await prisma.userGroup.update({
      where: { id },
      data: { is_active: false },
    });

    await auditLogService.write({
      action: 'team.delete',
      target_type: 'team',
      target_id: id,
      outcome: 'success',
      actor,
    });
  }

  // ── Members ───────────────────────────────────────────────────────────────

  async listMembers(teamId: string) {
    const memberships = await prisma.userGroupMembership.findMany({
      where: { group_id: teamId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    return memberships;
  }

  async addMember(teamId: string, userEmail: string, actor: AuditActor) {
    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) {
      throw domainError('USER_NOT_FOUND', `No user with email '${userEmail}'`);
    }

    const membership = await prisma.userGroupMembership.create({
      data: {
        user_id: user.id,
        group_id: teamId,
        added_by: actor.userId ?? null,
      },
    });

    await auditLogService.write({
      action: 'team.member.add',
      target_type: 'team',
      target_id: teamId,
      outcome: 'success',
      actor,
      metadata: { user_id: user.id, user_email: userEmail },
    });

    return membership;
  }

  async removeMember(teamId: string, userId: string, actor: AuditActor) {
    await prisma.userGroupMembership.deleteMany({
      where: { group_id: teamId, user_id: userId },
    });

    await auditLogService.write({
      action: 'team.member.remove',
      target_type: 'team',
      target_id: teamId,
      outcome: 'success',
      actor,
      metadata: { user_id: userId },
    });
  }

  // ── Shared flows ──────────────────────────────────────────────────────────

  async listSharedFlows(teamId: string) {
    return prisma.workflowShare.findMany({
      where: { share_type: 'group', target_id: teamId },
      include: { workflow: { select: { id: true, name: true, is_active: true } } },
    });
  }

  async shareFlow(
    teamId: string,
    workflowId: string,
    role: 'viewer' | 'editor' | 'executor' | 'admin',
    actor: AuditActor,
  ) {
    const share = await prisma.workflowShare.create({
      data: {
        workflow_id: workflowId,
        share_type: 'group',
        target_id: teamId,
        role,
        shared_by: actor.userId ?? 'system',
      },
    });

    await auditLogService.write({
      action: 'team.flow.share',
      target_type: 'team',
      target_id: teamId,
      outcome: 'success',
      actor,
      metadata: { workflow_id: workflowId, role },
    });

    return share;
  }

  async revokeFlowShare(teamId: string, shareId: string, actor: AuditActor) {
    await prisma.workflowShare.delete({ where: { id: shareId } });

    await auditLogService.write({
      action: 'team.flow.revoke',
      target_type: 'team',
      target_id: teamId,
      outcome: 'success',
      actor,
      metadata: { share_id: shareId },
    });
  }
}

// Singleton
export const teamsService = new TeamsService();
