/**
 * Task Y.1 — Promote getArtifactDispatchMechanismRule to top of assembled
 * RBAC prompt + closing self-check + anti-fence rule + positive example.
 *
 * Sprint Y / #880/#807 regression class (2026-05-19).
 *
 * RED→GREEN: the rule MUST appear immediately after the identity sentence
 * and BEFORE any other custom section. It must also contain the three
 * new body additions:
 *   1. Anti-fence rule ("NEVER write {"slug": or {"template": …")
 *   2. End-of-turn self-check ("Before stopping")
 *   3. Positive example showing WRONG (JSON in code fence) vs RIGHT (tool_use dispatch)
 *
 * Token budget: composed prompt MUST stay ≤ 5750 tokens (23,000 chars).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getSystemPromptForRole } from '../getSystemPromptForRole.js';
import { getArtifactDispatchMechanismRule } from '../staticSections.js';
import { __clearPromptCache } from '../RoleKeyedSystemPrompt.js';

const NULL_CTX = {
  userId: 'u-test',
  sessionId: 'sess-test',
  tenantId: 'tenant-test',
  modelInUse: 'test-model',
  userMessage: 'hi',
  priorTurnCount: 0,
};

const TOKEN_CAP = 5750;
const CHARS_PER_TOKEN = 4;
const CHAR_CAP = TOKEN_CAP * CHARS_PER_TOKEN; // 23,000 chars

describe('Task Y.1 — dispatch mechanism rule: position + anti-fence + self-check', () => {
  beforeEach(() => __clearPromptCache());

  // -------------------------------------------------------------------------
  // Position: rule must be FIRST custom section after identity sentence
  // -------------------------------------------------------------------------

  it('admin: artifact_dispatch_mechanism text appears BEFORE any other custom section text', async () => {
    const out = await getSystemPromptForRole('admin', NULL_CTX, {
      memoryRecall: async () => [],
    });

    // The identity sentence starts the prompt.
    const identityIdx = out.indexOf('You are OpenAgentic');
    expect(identityIdx).toBeGreaterThanOrEqual(0);

    // The dispatch rule heading must exist.
    const dispatchRuleText = 'Artifact dispatch mechanism';
    const dispatchIdx = out.indexOf(dispatchRuleText);
    expect(dispatchIdx, 'dispatch rule must exist in composed prompt').toBeGreaterThanOrEqual(0);

    // The dispatch rule must come BEFORE the explicit-request gate.
    const gateText = 'Artifact emission — explicit-request gate';
    const gateIdx = out.indexOf(gateText);
    expect(gateIdx, 'explicit-request gate must exist').toBeGreaterThanOrEqual(0);
    expect(dispatchIdx, 'dispatch rule must appear before explicit-request gate').toBeLessThan(gateIdx);

    // The dispatch rule must come BEFORE discovery_flow.
    const discoveryText = 'Discovery flow';
    const discoveryIdx = out.indexOf(discoveryText);
    expect(discoveryIdx, 'discovery_flow must exist').toBeGreaterThanOrEqual(0);
    expect(dispatchIdx, 'dispatch rule must appear before discovery_flow').toBeLessThan(discoveryIdx);

    // The dispatch rule must come BEFORE doing_tasks.
    const doingText = 'Doing tasks';
    const doingIdx = out.indexOf(doingText);
    expect(doingIdx, 'doing_tasks must exist').toBeGreaterThanOrEqual(0);
    expect(dispatchIdx, 'dispatch rule must appear before doing_tasks').toBeLessThan(doingIdx);
  });

  it('member: artifact_dispatch_mechanism text appears BEFORE any other custom section text', async () => {
    const out = await getSystemPromptForRole('member', NULL_CTX, {
      memoryRecall: async () => [],
    });

    const dispatchRuleText = 'Artifact dispatch mechanism';
    const dispatchIdx = out.indexOf(dispatchRuleText);
    expect(dispatchIdx).toBeGreaterThanOrEqual(0);

    const gateIdx = out.indexOf('Artifact emission — explicit-request gate');
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(dispatchIdx).toBeLessThan(gateIdx);

    const discoveryIdx = out.indexOf('Discovery flow');
    expect(discoveryIdx).toBeGreaterThanOrEqual(0);
    expect(dispatchIdx).toBeLessThan(discoveryIdx);
  });

  // -------------------------------------------------------------------------
  // Anti-fence rule: the extended body must forbid inline schema writing
  // -------------------------------------------------------------------------

  it('dispatch rule body contains anti-fence patterns: {"slug": and {"template":', () => {
    const body = getArtifactDispatchMechanismRule('admin');
    expect(body).toMatch(/NEVER write|never write/i);
    // Must name the schema shapes explicitly so the model knows what to avoid.
    expect(body).toContain('{"slug":');
    expect(body).toContain('{"template":');
  });

  it('dispatch rule body names <compose_visual and <compose_app as forbidden prose shapes', () => {
    const body = getArtifactDispatchMechanismRule('admin');
    // At least one of these schema-shape patterns must be called out.
    const namedForbiddenShapes = ['<compose_visual', '<compose_app', '<html>', '<svg>'];
    const hits = namedForbiddenShapes.filter((s) => body.includes(s));
    expect(
      hits.length,
      `at least one of [${namedForbiddenShapes.join(', ')}] must be named as a forbidden prose shape`,
    ).toBeGreaterThanOrEqual(1);
  });

  it('dispatch rule body contains the "STOP and emit a tool_use block" redirect instruction', () => {
    const body = getArtifactDispatchMechanismRule('admin');
    // The anti-fence rule should tell the model what to do instead (stop → tool_use).
    expect(body).toMatch(/stop.*tool_use|STOP.*tool_use|emit.*tool_use/i);
  });

  // -------------------------------------------------------------------------
  // End-of-turn self-check
  // -------------------------------------------------------------------------

  it('dispatch rule body contains an end-of-turn self-check ("Before stopping")', () => {
    const body = getArtifactDispatchMechanismRule('admin');
    expect(body).toMatch(/Before stopping|before stopping/i);
  });

  it('dispatch rule self-check references "every artifact" or equivalent completeness check', () => {
    const body = getArtifactDispatchMechanismRule('admin');
    // The self-check must instruct the model to verify ALL artifacts went through tool_use.
    expect(body).toMatch(/every artifact|each artifact|all artifact/i);
  });

  // -------------------------------------------------------------------------
  // Positive example (WRONG shape vs RIGHT shape)
  // -------------------------------------------------------------------------

  it('dispatch rule body contains a positive contrast example (WRONG vs RIGHT)', () => {
    const body = getArtifactDispatchMechanismRule('admin');
    // Must show the wrong shape (JSON code fence) and the right shape (tool_use dispatch).
    expect(body).toMatch(/WRONG|wrong shape|wrong:/i);
    expect(body).toMatch(/RIGHT|right shape|right:|correct:/i);
  });

  it('dispatch rule example shows tool_use dispatch as the RIGHT shape', () => {
    const body = getArtifactDispatchMechanismRule('admin');
    // The example must show tool_use as the correct dispatch mechanism.
    expect(body).toContain('tool_use');
    // Should also show what bad looks like (JSON in code fence).
    expect(body).toMatch(/```json|code.?fence|prose.*(json|schema)|json.*(prose|text)/i);
  });

  // -------------------------------------------------------------------------
  // Token budget
  // -------------------------------------------------------------------------

  it('admin composed prompt with dispatch rule stays ≤ 5750 tokens (23,000 chars)', async () => {
    const out = await getSystemPromptForRole('admin', NULL_CTX, {
      memoryRecall: async () => [],
    });
    expect(out.length).toBeLessThanOrEqual(CHAR_CAP);
  });

  it('member composed prompt with dispatch rule stays ≤ 5750 tokens (23,000 chars)', async () => {
    const out = await getSystemPromptForRole('member', NULL_CTX, {
      memoryRecall: async () => [],
    });
    expect(out.length).toBeLessThanOrEqual(CHAR_CAP);
  });
});
