/**
 * #1057 Sev-0 — model MUST request_clarification when the user names a
 * proper-noun scope the model has no ground-truth mapping for, BEFORE
 * dispatching any tools.
 *
 * Live evidence (mock-02 drive, 2026-05-22):
 *   prompt: "do a full security audit across all tenants of acme-corp"
 *   actual: model assumed acme-corp === test user's dev tenant +
 *           test user's AWS account → dispatched 83 tool_use blocks →
 *           produced a verified-true 5/5 audit, but on the WRONG SCOPE.
 *           Correct customer tenant is a different tenant id entirely.
 *   expected: model first emits request_clarification asking "what is
 *             acme-corp — a tenant? subscription? AWS account?
 *             a repo? — point me at it" then waits.
 *
 * This section is the textual rule that goes into the system prompt
 * BEFORE any tool dispatch happens. It instructs the model to scan its
 * own input for unrecognized proper-noun scope-words and call
 * request_clarification first.
 */
import { describe, test, expect } from 'vitest';
import { getUnknownScopeClarificationGate } from '../staticSections.js';
import { getSystemPromptForRole } from '../getSystemPromptForRole.js';

const ROLES = ['admin', 'user', 'viewer'] as const;

describe('#1057 unknown-scope clarification gate', () => {
  test('exports a static section function', () => {
    expect(typeof getUnknownScopeClarificationGate).toBe('function');
  });

  test.each(ROLES)('renders a non-empty body for role=%s', (role) => {
    const body = getUnknownScopeClarificationGate(role);
    expect(body.length).toBeGreaterThan(200);
  });

  test('body mentions the canonical rule: unknown scope → request_clarification BEFORE tool dispatch', () => {
    const body = getUnknownScopeClarificationGate('admin');
    expect(body.toLowerCase()).toContain('request_clarification');
    expect(body.toLowerCase()).toMatch(/unknown|don'?t know|unrecognized|unfamiliar/);
    expect(body.toLowerCase()).toMatch(/before.*tool|first|no.*tool.*until/);
  });

  test('body covers the canonical scope vocabulary the user reaches for', () => {
    const body = getUnknownScopeClarificationGate('admin').toLowerCase();
    // The model must recognize ALL of these as scope words.
    for (const scopeWord of ['tenant', 'subscription', 'account', 'cluster', 'org']) {
      expect(body).toContain(scopeWord);
    }
  });

  test('body shows the acme-corp failure mode as the canonical example', () => {
    // The example is what gets pattern-matched in-context. Without a
    // concrete example, models tend to interpret abstract rules as
    // optional. Lock the live failure case in.
    const body = getUnknownScopeClarificationGate('admin').toLowerCase();
    expect(body).toMatch(/acme-corp|fictional|made-up|unknown scope name/);
  });

  test('body distinguishes unknown-scope from known-scope to avoid over-triggering on lists', () => {
    // A bare "list my Azure subs" must NOT trigger clarification — the
    // scope is the user's accessible subs, no proper noun ambiguity.
    // The rule has to thread that needle so it doesn't regress #641 C4.
    const body = getUnknownScopeClarificationGate('admin').toLowerCase();
    expect(body).toMatch(/known|recognized|already.*resolve|when the scope is/);
  });
});

describe('#1057 wiring into composed system prompt', () => {
  test('composed admin prompt includes the unknown-scope gate', async () => {
    const composed = await getSystemPromptForRole('admin', {
      enabledTools: ['azure_list_subscriptions', 'aws_list_accounts'],
    });
    expect(composed.toLowerCase()).toContain('request_clarification');
    expect(composed.toLowerCase()).toMatch(/unknown.*scope|unrecognized.*scope|don'?t know.*scope/);
  });

  test('section is registered with a stable id so cache layer can target it', async () => {
    const composed = await getSystemPromptForRole('admin', {
      enabledTools: [],
    });
    // The composed body should mention the section's anchor phrase so the
    // section-id arch test (separate) can spot it.
    expect(composed).toMatch(/Unknown.scope clarification|Unknown.proper.noun/i);
  });
});
