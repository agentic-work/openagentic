/**
 * Sev-0 #780 follow-up — no-confabulation clause must be present in
 * the admin + member RBAC system prompts.
 *
 * Live verify on chat-dev 0.7.1-3d7fb248 (2026-05-13) showed Sonnet 4.6
 * fabricating per-model AWS Bedrock cost breakdowns ($518/$83/$74 for
 * Claude Sonnet 4.6 / Opus 4.6 / Opus 4.7) — AWS Cost Explorer does NOT
 * expose model-name-level cost data; the figures came entirely from the
 * model's imagination. Same regression pattern as #780 (tri-cloud cost
 * spike fabrication).
 *
 * Contract: both RBAC prompts must contain explicit anti-fabrication
 * guidance that names this exact failure mode (synthesizing per-model
 * Bedrock breakdowns / inventing per-service splits not present in tool
 * output). Pin via source grep — the clause is non-negotiable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ADMIN_PROMPT = join(__dirname, '..', '..', '..', 'prompts', 'chat-system-admin.md');
const MEMBER_PROMPT = join(__dirname, '..', '..', '..', 'prompts', 'chat-system-member.md');

describe('Anti-confab clause — Sev-0 #780 + 2026-05-13 regression', () => {
  it('admin prompt forbids fabricating dollar figures not in tool output', () => {
    const src = readFileSync(ADMIN_PROMPT, 'utf8');
    expect(src.toLowerCase()).toMatch(/never fabricate|do not fabricate|never invent/);
    expect(src.toLowerCase()).toMatch(/dollar|cost|\$/);
  });

  it('admin prompt names the Bedrock per-model breakdown failure mode explicitly', () => {
    const src = readFileSync(ADMIN_PROMPT, 'utf8');
    // The model must be told that AWS Cost Explorer does not expose
    // per-Bedrock-model granularity. Match either "per-model" or the
    // explicit Bedrock + model-name guidance.
    expect(src.toLowerCase()).toMatch(/per-model|bedrock.*model|model.*bedrock/);
  });

  it('admin prompt requires the response to cite tool output verbatim for $-figures', () => {
    const src = readFileSync(ADMIN_PROMPT, 'utf8');
    expect(src.toLowerCase()).toMatch(/verbatim|exactly as|in the tool output|from the tool/);
  });

  it('member prompt has the same anti-confab clause', () => {
    const src = readFileSync(MEMBER_PROMPT, 'utf8');
    expect(src.toLowerCase()).toMatch(/never fabricate|do not fabricate|never invent/);
    expect(src.toLowerCase()).toMatch(/dollar|cost|\$/);
  });
});
