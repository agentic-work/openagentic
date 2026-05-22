/**
 * synthPrompt — TDD spec (tests first).
 *
 * Contract: when the synth_synthesize tool is available, the system prompt
 * must explicitly tell the model:
 *   1. The env vars the sandbox will receive for each cloud capability
 *   2. That the API auto-injects short-lived user-scoped tokens (no keys to pass)
 *   3. The abuse policy — refused categories, all audited
 *   4. Risk tiers and the human-in-the-middle approval rule
 */

import { describe, it, expect } from 'vitest';
import { buildSynthToolPrompt } from '../synthPrompt.js';

describe('buildSynthToolPrompt', () => {
  describe('env-var contract', () => {
    it('documents AWS env vars when aws capability is in scope', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['aws'] });
      expect(p).toContain('AWS_ACCESS_KEY_ID');
      expect(p).toContain('AWS_SECRET_ACCESS_KEY');
      expect(p).toContain('AWS_SESSION_TOKEN');
    });

    it('documents AZURE_ACCESS_TOKEN when azure capability is in scope', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['azure'] });
      expect(p).toContain('AZURE_ACCESS_TOKEN');
    });

    it('documents GOOGLE_SA_JSON when gcp capability is in scope', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['gcp'] });
      expect(p).toContain('GOOGLE_SA_JSON');
    });

    it('documents all three when all capabilities are in scope', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['aws', 'azure', 'gcp'] });
      expect(p).toContain('AWS_ACCESS_KEY_ID');
      expect(p).toContain('AZURE_ACCESS_TOKEN');
      expect(p).toContain('GOOGLE_SA_JSON');
    });

    it('does NOT document cloud env vars when only http/json are in scope', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['http', 'json'] });
      expect(p).not.toContain('AWS_ACCESS_KEY_ID');
      expect(p).not.toContain('AZURE_ACCESS_TOKEN');
      expect(p).not.toContain('GOOGLE_SA_JSON');
    });

    it('instructs model to list `capabilities` matching what the code touches', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['aws', 'azure', 'gcp'] });
      expect(p).toMatch(/declare.*capabilities|list the capabilities|capabilities.*must match/i);
    });

    it('states that tokens are short-lived and user-scoped (no keys exposed to LLM)', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['aws'] });
      expect(p).toMatch(/short-lived|1 hour|1hr|user-scoped|user identity/i);
      expect(p).toMatch(/never (write|pass|include) .*(keys|credentials|secrets)/i);
    });
  });

  describe('abuse policy', () => {
    const ABUSE_CATEGORIES = [
      'adult',           // porn
      'piracy',          // warez
      'crypto',          // mining
      'exfil',           // data theft
      'scrape',          // mass-scraping
      'DoS',             // flood / denial
    ];

    it('includes an explicit abuse policy block', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['http'] });
      expect(p).toMatch(/prohibited|forbidden|refuse|policy|abuse/i);
    });

    it.each(ABUSE_CATEGORIES)('names %s as a refused category', (cat) => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['http'] });
      expect(p.toLowerCase()).toContain(cat.toLowerCase());
    });

    it('states that every call is audited with user identity + code hash', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['http'] });
      expect(p).toMatch(/audit/i);
      expect(p).toMatch(/code.*hash|hash.*code/i);
    });
  });

  describe('risk / approval', () => {
    it('documents the risk tiers and approval rule', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['aws'] });
      expect(p).toMatch(/low.*medium.*high.*critical/is);
      expect(p).toMatch(/approval/i);
    });

    it('warns that cloud-write operations escalate risk', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: ['aws', 'azure', 'gcp'] });
      expect(p).toMatch(/(write|modif|create|delete).*approval|approval.*(write|modif|create|delete)/i);
    });
  });

  describe('determinism', () => {
    it('returns the same string for the same input (prompt is stable)', () => {
      const a = buildSynthToolPrompt({ availableCapabilities: ['aws', 'azure'] });
      const b = buildSynthToolPrompt({ availableCapabilities: ['azure', 'aws'] }); // order differs
      expect(a).toBe(b); // capabilities are sorted internally
    });

    it('always includes a "last resort" note — prefer dedicated MCP tools first', () => {
      const p = buildSynthToolPrompt({ availableCapabilities: [] });
      expect(p).toMatch(/last resort|fallback|dedicated .*tool/i);
    });
  });
});
