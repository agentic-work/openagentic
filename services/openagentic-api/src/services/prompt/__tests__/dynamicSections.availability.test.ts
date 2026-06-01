/**
 * #51 (2026-06-01) — connected-MCP + needs-auth availability section.
 *
 * The agent must be told which MCP servers are actually CONNECTED this
 * session (open-dev: only openagentic_web + aws_knowledge) vs which are
 * unavailable / require credentials or Azure AD OBO (azure/gcp/github/…).
 * Then it can answer "Azure isn't connected (needs Azure login/OBO)"
 * immediately instead of looping tool_search forever.
 *
 * Dynamic section (below the cache boundary) because connected-server
 * state is per-session, not cache-global.
 */
import { describe, it, expect } from 'vitest';
import { getAvailabilitySection } from '../dynamicSections.js';

describe('dynamicSections — getAvailabilitySection (#51)', () => {
  it('lists the connected servers and the not-connected (needs-auth) servers', () => {
    const out = getAvailabilitySection(
      ['openagentic_web', 'aws_knowledge'],
      ['azure', 'gcp', 'github'],
    );
    expect(out).toContain('openagentic_web');
    expect(out).toContain('aws_knowledge');
    expect(out).toContain('azure');
    expect(out).toContain('gcp');
    expect(out).toContain('github');
    // Must steer the model away from the spin.
    expect(out.toLowerCase()).toMatch(/do not loop `?tool_search`?|do not.*tool_search/);
    // Must name the auth reason so the model can explain it.
    expect(out.toLowerCase()).toMatch(/credential|login|on-behalf-of|obo/);
  });

  it('renders a CONNECTED line even when only needs-auth is non-empty', () => {
    const out = getAvailabilitySection([], ['azure']);
    expect(out).toContain('azure');
    expect(out.toLowerCase()).toMatch(/connected/);
  });

  it('returns empty string when both lists are empty (no breakage)', () => {
    expect(getAvailabilitySection([], [])).toBe('');
    expect(getAvailabilitySection(undefined as any, undefined as any)).toBe('');
  });

  it('does not emit a needs-auth enumeration line when only connected is provided', () => {
    const out = getAvailabilitySection(['openagentic_web'], []);
    expect(out).toContain('openagentic_web');
    // The enumeration line ("NOT connected (require credentials …): a, b, c")
    // must NOT appear when needsAuth is empty. (The generic steering bullet
    // that names Azure as an EXAMPLE is allowed and expected.)
    expect(out).not.toMatch(/NOT connected \(require credentials/);
  });
});
