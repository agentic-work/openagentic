/**
 * workspaceRailMapping — regression pin for the Flows left-rail admin leak
 * fixed 2026-05-14 (per user directive).
 *
 * Pre-fix behavior: rail items dispatched the user into the admin portal
 * via `WORKSPACE_NAV_ADMIN_SLUGS` — Runs jumped to /admin/observability,
 * Settings jumped to /admin/settings, etc. Non-admin users hit 403 walls
 * or saw cross-tenant data they had no business seeing.
 *
 * Post-fix behavior: every leaking rail id maps to a Flows-scoped
 * SidebarSectionType (consumed by WorkflowsPage's ConfigPanel). The
 * `home` and `flows` slots are handled by ChatContainer's onSelect and
 * are NOT in this map.
 */

import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_RAIL_TO_FLOWS_SECTION,
  railIdToFlowsSection,
  isFlowsScopedSection,
} from '../workspaceRailMapping';

describe('workspaceRailMapping', () => {
  it('maps every previously-leaking rail id to a Flows-scoped section', () => {
    // Pre-fix WORKSPACE_NAV_ADMIN_SLUGS keys — these MUST all be covered now.
    const previouslyLeaking = ['agents', 'tools', 'runs', 'insights', 'library', 'team', 'settings'];
    for (const id of previouslyLeaking) {
      const section = railIdToFlowsSection(id);
      expect(section, `rail id "${id}" must resolve to a Flows-scoped section`).not.toBeNull();
      expect(isFlowsScopedSection(section!)).toBe(true);
    }
  });

  it('returns null for home and flows (handled by caller)', () => {
    expect(railIdToFlowsSection('home')).toBeNull();
    expect(railIdToFlowsSection('flows')).toBeNull();
  });

  it('returns null for unknown rail ids (no admin fallback)', () => {
    expect(railIdToFlowsSection('rogue')).toBeNull();
    expect(railIdToFlowsSection('admin')).toBeNull();
    expect(railIdToFlowsSection('observability')).toBeNull();
  });

  it('every section in the map is a string that does NOT contain "/" (no admin paths)', () => {
    for (const [railId, section] of Object.entries(WORKSPACE_RAIL_TO_FLOWS_SECTION)) {
      expect(typeof section, `rail "${railId}" → section type`).toBe('string');
      expect(section, `rail "${railId}" section "${section}" must not contain "/"`).not.toMatch(/\//);
      expect(section, `rail "${railId}" must not start with "admin"`).not.toMatch(/^admin/);
    }
  });

  it('maps Runs to a user-scoped runs section (SEV-1 fix from F.5 backlog)', () => {
    // The F.5 report flagged: "Flows 'Runs' nav-rail opens admin/observability
    // dashboard instead of flow runs". Post-fix Runs MUST resolve to 'runs',
    // which renders the user's workflow executions inside the Flows shell.
    expect(railIdToFlowsSection('runs')).toBe('runs');
  });

  it('maps Settings to workflow-scoped settings, NOT admin/settings', () => {
    expect(railIdToFlowsSection('settings')).toBe('settings');
  });
});
