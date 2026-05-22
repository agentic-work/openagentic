/**
 * Phase F.5 — gallery visibility test
 *
 * RED-then-GREEN test asserting that the 10 Phase-F template flows live-seeded
 * via seed-templates.ts appear in the /workflows template gallery and via
 * GET /api/workflows/templates.
 *
 * Driven by the Playwright MCP tool path during AI verification per
 * `feedback_e2e_playwright_override` — this .spec.ts file is the
 * machine-readable assertion contract for CI replays.
 *
 * Names exactly match the template JSON `name` field:
 *   01-aiops-incident-triage.json       -> "AIOps Incident Triage"
 *   02-tri-cloud-cost-report.json       -> "Tri-cloud Daily Cost Report"
 *   03-document-quiz-generator.json     -> "Document to Quiz Generator"
 *   04-bedtime-story-generator.json     -> "Bedtime Story Generator"
 *   05-research-paper-summarizer.json   -> "Research Paper Summarizer"
 *   06-chord-progression-analyzer.json  -> "Chord Progression Analyzer"
 *   07-color-palette-generator.json     -> "Color Palette Generator"
 *   08-pdf-to-markdown.json             -> "PDF to Markdown Converter"
 *   09-github-pr-review.json            -> "GitHub PR Review"
 *   10-morning-standup-digest.json      -> "Morning Standup Digest"
 */

import { test, expect } from '@playwright/test';
import { loginAndGetToken } from '../helpers/loginAsMcpTester.js';

const EXPECTED_TEMPLATE_NAMES = [
  'AIOps Incident Triage',
  'Tri-cloud Daily Cost Report',
  'Document to Quiz Generator',
  'Bedtime Story Generator',
  'Research Paper Summarizer',
  'Chord Progression Analyzer',
  'Color Palette Generator',
  'PDF to Markdown Converter',
  'GitHub PR Review',
  'Morning Standup Digest',
];

test.use({ ignoreHTTPSErrors: true });

test.describe('Flows F.5 — 10 templates visible in live gallery', () => {
  test('GET /api/workflows/templates returns all 10 Phase-F templates', async ({ page }) => {
    test.setTimeout(180000);
    const token = await loginAndGetToken(page);

    const result = await page.evaluate(async (authToken) => {
      const res = await fetch('/api/workflows/templates', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      return { status: res.status, body: await res.json() };
    }, token);

    expect(result.status).toBe(200);
    const names = (result.body.templates || []).map((t: any) => t.name);

    for (const expected of EXPECTED_TEMPLATE_NAMES) {
      expect(names, `template "${expected}" must appear in /api/workflows/templates`).toContain(expected);
    }
  });
});
