/**
 * sessionMetaFromInit — TDD coverage for the system/init →
 * sessionMeta projection. The metadata strip's correctness depends
 * on this mapping never substituting a hardcoded sentinel for a
 * missing field; em-dashes downstream depend on undefined surviving
 * round-trip.
 */

import { describe, it, expect } from 'vitest';
import { sessionMetaFromInit } from '../sdkAdapter';

describe('sessionMetaFromInit — required fields', () => {
  it('lifts cwd verbatim — including /workspaces/<userId>', () => {
    const meta = sessionMetaFromInit({ cwd: '/workspaces/u-9abc' });
    expect(meta.cwd).toBe('/workspaces/u-9abc');
  });

  it('lifts openagentic_version into openagenticVersion', () => {
    const meta = sessionMetaFromInit({ openagentic_version: '0.6.6' });
    expect(meta.openagenticVersion).toBe('0.6.6');
  });

  it('passes through tool / mcp_server / agent / skill / plugin lists', () => {
    const meta = sessionMetaFromInit({
      tools: ['Read', 'Write', 'Bash'],
      mcp_servers: [{ name: 'k8s', status: 'ready' }],
      agents: ['general', 'reviewer'],
      skills: ['claude-api'],
      plugins: ['playwright'],
    });
    expect(meta.tools).toEqual(['Read', 'Write', 'Bash']);
    expect(meta.mcpServers).toEqual([{ name: 'k8s', status: 'ready' }]);
    expect(meta.agents).toEqual(['general', 'reviewer']);
    expect(meta.skills).toEqual(['claude-api']);
    expect(meta.plugins).toEqual(['playwright']);
  });
});

describe('sessionMetaFromInit — budget_cap_usd projection', () => {
  it('preserves a numeric cap', () => {
    expect(sessionMetaFromInit({ budget_cap_usd: 25 }).budgetCapUsd).toBe(25);
  });

  it('preserves null (admin-set "no cap") instead of substituting a default', () => {
    expect(sessionMetaFromInit({ budget_cap_usd: null }).budgetCapUsd).toBeNull();
  });

  it('preserves undefined (daemon hasn\'t reported a cap yet)', () => {
    expect(sessionMetaFromInit({}).budgetCapUsd).toBeUndefined();
  });

  it('does NOT default the cap to a hardcoded $5 sentinel', () => {
    expect(sessionMetaFromInit({}).budgetCapUsd).not.toBe(5);
  });
});

describe('sessionMetaFromInit — empty-payload safety', () => {
  it('returns empty arrays for missing list fields, not undefined', () => {
    const meta = sessionMetaFromInit({});
    expect(meta.tools).toEqual([]);
    expect(meta.mcpServers).toEqual([]);
    expect(meta.agents).toEqual([]);
    expect(meta.plugins).toEqual([]);
    expect(meta.skills).toEqual([]);
    expect(meta.slashCommands).toEqual([]);
  });

  it('returns empty strings for missing scalar fields, not undefined', () => {
    const meta = sessionMetaFromInit({});
    expect(meta.cwd).toBe('');
    expect(meta.permissionMode).toBe('');
    expect(meta.openagenticVersion).toBe('');
  });
});

describe('sessionMetaFromInit — live update contract', () => {
  it('produces a fresh object every call so React identity changes drive re-render', () => {
    const a = sessionMetaFromInit({ cwd: '/workspaces/u', plugins: ['p1'] });
    const b = sessionMetaFromInit({ cwd: '/workspaces/u', plugins: ['p1', 'p2'] });
    expect(a).not.toBe(b);
    expect(a.plugins).not.toBe(b.plugins);
    expect(b.plugins).toHaveLength(2);
  });
});
