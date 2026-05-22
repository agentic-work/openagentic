/**
 * Static-section function pack — gates tool-name-anchored bullets on
 * enabledTools.has(X), mirroring ~/anthropic/src/constants/prompts.ts:269-314
 * §getUsingYourToolsSection pattern.
 */
import { describe, it, expect } from 'vitest';
import {
  getDiscoveryFlowSection,
  getDoingTasksSection,
  getOutputSection,
  getSafetySection,
} from '../staticSections.js';

describe('staticSections — getDiscoveryFlowSection', () => {
  it('anchors model on enabledTools.has(azure_list_subscriptions) when it IS loaded', () => {
    const tools = new Set(['azure_list_subscriptions', 'tool_search']);
    const body = getDiscoveryFlowSection('member', tools);
    expect(body).toContain('azure_list_subscriptions');
    expect(body).toContain('call it directly');
    expect(body).toContain('do not `tool_search`');
  });

  it('does NOT mention azure_list_subscriptions when it is NOT loaded', () => {
    const tools = new Set(['tool_search']);
    const body = getDiscoveryFlowSection('member', tools);
    expect(body).not.toContain('azure_list_subscriptions');
  });

  it('lists every T1 primitive that IS loaded — never invents tool names', () => {
    const tools = new Set([
      'tool_search', 'agent_search', 'Task', 'agent_send',
      'agent_list', 'agent_stop', 'read_large_result',
      'web_search', 'web_fetch', 'synth', 'pattern_save', 'pattern_recall',
    ]);
    const body = getDiscoveryFlowSection('member', tools);
    for (const t of tools) {
      expect(body, `missing ${t}`).toContain(`\`${t}\``);
    }
  });

  it('describes admin role differently from member role', () => {
    const tools = new Set(['tool_search']);
    expect(getDiscoveryFlowSection('admin', tools))
      .not.toBe(getDiscoveryFlowSection('member', tools));
  });

  it('returns non-empty string for both roles', () => {
    expect(getDiscoveryFlowSection('admin', new Set(['tool_search'])).length).toBeGreaterThan(100);
    expect(getDiscoveryFlowSection('member', new Set(['tool_search'])).length).toBeGreaterThan(100);
  });
});

describe('staticSections — getDoingTasksSection', () => {
  it('contains the "same-turn tool_calls" rule for both roles', () => {
    for (const role of ['admin', 'member'] as const) {
      const body = getDoingTasksSection(role);
      expect(body).toMatch(/same.turn|on the same turn/i);
      expect(body).toMatch(/tool[_ ]call/i);
    }
  });

  it('contains a destructive-confirmation rule', () => {
    expect(getDoingTasksSection('member')).toMatch(/destructive|confirm/i);
  });
});

describe('staticSections — getOutputSection', () => {
  it('forbids filler and apologies', () => {
    const body = getOutputSection('member');
    expect(body).toMatch(/no filler|concise/i);
  });
});

describe('staticSections — getSafetySection', () => {
  it('mentions DLP + HITL + OBO', () => {
    const body = getSafetySection('member');
    expect(body).toMatch(/DLP/);
    expect(body).toMatch(/HITL/);
    expect(body).toMatch(/OBO|On.Behalf.Of/i);
  });
});
