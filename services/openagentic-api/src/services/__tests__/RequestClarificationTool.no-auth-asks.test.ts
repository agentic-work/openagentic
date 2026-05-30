/**
 * RequestClarificationTool — HARD-FORBIDDEN clauses TDD.
 *
 * Bug: gpt-oss:20b on chatmode receives 276 tools, picks
 * `request_clarification` with text "Please authenticate with Azure AD SSO"
 * instead of calling `azure_resource_graph_query`. mcp-proxy's OBO flow
 * handles auth automatically — the model never needs to ask.
 *
 * Fix: tighten the tool's own description with Cline-style bias-phrasing
 * (https://github.com/cline/cline/blob/main/src/core/prompts/system-prompt/components/tool_use/guidelines.ts)
 * so it stops winning over cloud tools positionally.
 *
 * Plan: TASK #521 (sprightly-percolating-brook.md)
 */
import { describe, it, expect } from 'vitest';
import { REQUEST_CLARIFICATION_TOOL } from '../RequestClarificationTool.js';

const description = REQUEST_CLARIFICATION_TOOL.function.description;
// Lowercase form for case-insensitive substring checks.
const desc = description.toLowerCase();

describe('REQUEST_CLARIFICATION_TOOL — HARD-FORBIDDEN clauses (no-auth-asks)', () => {
  it('a. forbids authentication as a use case (DO NOT use for auth)', () => {
    // Must mention authentication AND have an explicit forbid framing nearby.
    expect(desc).toContain('authentication');
    // Bias-phrase: ensure the description contains explicit "NEVER ASK ABOUT"
    // or "HARD-FORBIDDEN" framing so a model parsing the description treats
    // auth as a forbidden topic, not just a topic.
    expect(desc).toMatch(/never ask about|hard-forbidden/);
  });

  it('b. forbids login / log in / sign in asks', () => {
    // At least one of these tokens must appear in the forbidden list.
    expect(desc).toMatch(/login|log in|sign-in|sign in/);
  });

  it('c. forbids SSO', () => {
    // SSO is uppercase in the description, so check the original.
    expect(description).toMatch(/SSO/);
  });

  it('d. forbids permission / permissions / access asks', () => {
    expect(desc).toMatch(/permission|permissions/);
    expect(desc).toContain('access');
  });

  it('e. forbids announce-what-you-will-do pattern (do not preview your own action)', () => {
    // Description must explicitly tell the model not to announce / preview
    // what it is about to do. Match a few phrasings.
    expect(desc).toMatch(/announc|preview|about to do|will do/);
  });

  it('f. positive: still permits the destructive-DB example ("which production database to drop")', () => {
    // The good-example block must remain — destructive ops are a legit use.
    expect(desc).toMatch(/drop the prod database|production databases|drop/i);
  });

  it('g. positive: bias-phrase keywords present ("DO NOT use" / "ONLY when" / "NEVER")', () => {
    // Cline-style guidelines.ts pattern.
    expect(description).toMatch(/DO NOT USE|DO NOT use|ONLY when|ONLY WHEN|NEVER/);
  });

  it('h. snapshot: description starts with the LAST-RESORT escape framing', () => {
    // The first line must remain the existing last-resort framing — we are
    // ADDING the HARD-FORBIDDEN block, not replacing the head of the doc.
    expect(description.startsWith('LAST-RESORT escape.')).toBe(true);
  });
});
