/**
 * mapGroupsToRoles — unit tests for the pure group→role/admin mapping
 * extracted from auth/azureADAuth.ts (~:250-366).
 *
 * Covers: authorized (gate pass/deny + empty gate), admin (admin-group),
 * role (groupRoleMappings), allow-all (SKIP_GROUP_VALIDATION replacement),
 * and external-admin (EXTERNAL_ADMIN_EMAILS bypass) cases.
 */

import { describe, it, expect } from 'vitest';
import { mapGroupsToRoles, type GroupRoleMapping } from './mapGroupsToRoles.js';

const GROUP_USER = '11111111-1111-1111-1111-111111111111';
const GROUP_ADMIN = '22222222-2222-2222-2222-222222222222';
const GROUP_OTHER = '33333333-3333-3333-3333-333333333333';

function cfg(over: Partial<GroupRoleMapping> = {}): GroupRoleMapping {
  return {
    authorizedGroups: [],
    adminGroups: [],
    groupRoleMappings: {},
    allowAllAuthenticated: false,
    externalAdminEmails: [],
    email: 'user@example.com',
    ...over,
  };
}

describe('mapGroupsToRoles — authorized (login gate)', () => {
  it('authorizes a user who is a member of an authorized group', () => {
    const r = mapGroupsToRoles([GROUP_USER], cfg({ authorizedGroups: [GROUP_USER] }));
    expect(r.authorized).toBe(true);
    expect(r.isAdmin).toBe(false);
    expect(r.roles).toEqual([]);
  });

  it('denies a user with no matching group when the gate is non-empty', () => {
    const r = mapGroupsToRoles([GROUP_OTHER], cfg({ authorizedGroups: [GROUP_USER] }));
    expect(r.authorized).toBe(false);
    expect(r.isAdmin).toBe(false);
  });

  it('authorizes everyone when the gate is empty (no group requirement)', () => {
    const r = mapGroupsToRoles([], cfg({ authorizedGroups: [], adminGroups: [] }));
    expect(r.authorized).toBe(true);
    expect(r.isAdmin).toBe(false);
  });

  it('counts adminGroups membership toward the login gate (union gate)', () => {
    // authorizedGroups empty but adminGroups present → admin group is also a gate
    const r = mapGroupsToRoles([GROUP_ADMIN], cfg({ authorizedGroups: [], adminGroups: [GROUP_ADMIN] }));
    expect(r.authorized).toBe(true);
    expect(r.isAdmin).toBe(true);
  });

  it('denies a user not in the union gate when only adminGroups are configured', () => {
    const r = mapGroupsToRoles([GROUP_OTHER], cfg({ authorizedGroups: [], adminGroups: [GROUP_ADMIN] }));
    expect(r.authorized).toBe(false);
  });

  it('treats null/undefined userGroups as empty (denied against a non-empty gate)', () => {
    expect(mapGroupsToRoles(undefined, cfg({ authorizedGroups: [GROUP_USER] })).authorized).toBe(false);
    expect(mapGroupsToRoles(null, cfg({ authorizedGroups: [GROUP_USER] })).authorized).toBe(false);
  });
});

describe('mapGroupsToRoles — admin (admin group)', () => {
  it('grants isAdmin + admin role for an admin-group member', () => {
    const r = mapGroupsToRoles(
      [GROUP_USER, GROUP_ADMIN],
      cfg({ authorizedGroups: [GROUP_USER], adminGroups: [GROUP_ADMIN] })
    );
    expect(r.authorized).toBe(true);
    expect(r.isAdmin).toBe(true);
    expect(r.roles).toContain('admin');
  });

  it('does not grant admin to a non-admin authorized user', () => {
    const r = mapGroupsToRoles(
      [GROUP_USER],
      cfg({ authorizedGroups: [GROUP_USER], adminGroups: [GROUP_ADMIN] })
    );
    expect(r.isAdmin).toBe(false);
    expect(r.roles).not.toContain('admin');
  });
});

describe('mapGroupsToRoles — role (groupRoleMappings)', () => {
  it('resolves extra roles from groupRoleMappings for the user groups', () => {
    const r = mapGroupsToRoles(
      [GROUP_USER, GROUP_OTHER],
      cfg({
        authorizedGroups: [GROUP_USER, GROUP_OTHER],
        groupRoleMappings: { [GROUP_USER]: 'editor', [GROUP_OTHER]: 'viewer' },
      })
    );
    expect(r.authorized).toBe(true);
    expect(r.isAdmin).toBe(false);
    expect(r.roles).toEqual(['editor', 'viewer']);
  });

  it('ignores mappings for groups the user does not have', () => {
    const r = mapGroupsToRoles(
      [GROUP_USER],
      cfg({
        authorizedGroups: [GROUP_USER],
        groupRoleMappings: { [GROUP_OTHER]: 'viewer' },
      })
    );
    expect(r.roles).toEqual([]);
  });

  it('puts admin first, then mapped roles, de-duplicated', () => {
    const r = mapGroupsToRoles(
      [GROUP_ADMIN, GROUP_USER, GROUP_OTHER],
      cfg({
        authorizedGroups: [GROUP_USER],
        adminGroups: [GROUP_ADMIN],
        // a duplicate 'admin' mapping must not double up
        groupRoleMappings: { [GROUP_ADMIN]: 'admin', [GROUP_USER]: 'editor', [GROUP_OTHER]: 'viewer' },
      })
    );
    expect(r.isAdmin).toBe(true);
    expect(r.roles).toEqual(['admin', 'editor', 'viewer']);
  });
});

describe('mapGroupsToRoles — allow-all (SKIP_GROUP_VALIDATION replacement)', () => {
  it('authorizes + grants admin regardless of groups when allowAllAuthenticated', () => {
    const r = mapGroupsToRoles(
      [],
      cfg({ authorizedGroups: [GROUP_USER], allowAllAuthenticated: true })
    );
    expect(r.authorized).toBe(true);
    expect(r.isAdmin).toBe(true);
    expect(r.roles).toContain('admin');
  });

  it('allowAll bypasses a gate the user would otherwise fail', () => {
    const r = mapGroupsToRoles(
      [GROUP_OTHER],
      cfg({ authorizedGroups: [GROUP_USER], adminGroups: [GROUP_ADMIN], allowAllAuthenticated: true })
    );
    expect(r.authorized).toBe(true);
    expect(r.isAdmin).toBe(true);
  });
});

describe('mapGroupsToRoles — external-admin (EXTERNAL_ADMIN_EMAILS bypass)', () => {
  it('authorizes + grants admin for an external-admin email, bypassing the group gate', () => {
    const r = mapGroupsToRoles(
      [], // no groups (typical guest user)
      cfg({
        email: 'guest@partner.com',
        authorizedGroups: [GROUP_USER],
        externalAdminEmails: ['guest@partner.com'],
      })
    );
    expect(r.authorized).toBe(true);
    expect(r.isAdmin).toBe(true);
    expect(r.roles).toContain('admin');
  });

  it('matches external-admin email case-insensitively and trims whitespace', () => {
    const r = mapGroupsToRoles(
      [],
      cfg({
        email: 'Guest@Partner.com',
        authorizedGroups: [GROUP_USER],
        externalAdminEmails: ['  guest@partner.com  '],
      })
    );
    expect(r.authorized).toBe(true);
    expect(r.isAdmin).toBe(true);
  });

  it('does not treat a non-listed email as external admin', () => {
    const r = mapGroupsToRoles(
      [GROUP_OTHER],
      cfg({
        email: 'someone@partner.com',
        authorizedGroups: [GROUP_USER],
        externalAdminEmails: ['guest@partner.com'],
      })
    );
    expect(r.authorized).toBe(false);
    expect(r.isAdmin).toBe(false);
  });

  it('does not crash / match when email is undefined', () => {
    const r = mapGroupsToRoles(
      [GROUP_USER],
      cfg({ email: undefined, authorizedGroups: [GROUP_USER], externalAdminEmails: ['guest@partner.com'] })
    );
    expect(r.authorized).toBe(true); // authorized via group, not external admin
    expect(r.isAdmin).toBe(false);
  });
});
