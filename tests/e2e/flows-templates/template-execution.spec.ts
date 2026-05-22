/**
 * Phase F.B — per-template execution test (live, self-contained Path-B).
 *
 * For each of the 10 Phase-F templates, instantiate it, run it via the
 * /api/workflows/:id/execute path, and assert it completes
 * (last frame is `execution_complete`).
 *
 * The /api/workflows/templates response intentionally does NOT expose
 * the workflow `settings` column (security: tenants shouldn't read
 * each other's per-template configuration). Per-template
 * `defaultInputs` are therefore inlined here.
 */

import { test, expect } from '@playwright/test';
import { loginAndGetToken } from '../helpers/loginAsMcpTester.js';

interface TplCase {
  name: string;
  inputs: Record<string, unknown>;
  /** Must appear in the final webhook_response body. */
  contains: readonly string[];
}

const TEMPLATES: readonly TplCase[] = [
  {
    name: 'AIOps Incident Triage',
    inputs: { alert_id: 'ALERT-42', severity: 'P2', service: 'checkout-api' },
    contains: ['runbook', 'ALERT-42', 'kafka consumer lag'],
  },
  {
    name: 'Tri-cloud Daily Cost Report',
    inputs: { date_range: 'last_7_days' },
    contains: ['cost-report', 'AWS', 'Azure', 'GCP'],
  },
  {
    name: 'Document to Quiz Generator',
    inputs: { topic: 'Mitochondrion biology basics', difficulty: 'medium' },
    contains: ['Mitochondrion biology basics', 'medium'],
  },
  {
    name: 'Bedtime Story Generator',
    inputs: { theme: 'dragons and friendship', child_age: 6 },
    contains: ['bedtime-story', 'dragons and friendship', 'Sweet dreams'],
  },
  {
    name: 'Research Paper Summarizer',
    inputs: { paper_title: 'Attention Is All You Need', authors: 'Vaswani et al.' },
    contains: ['paper-summary', 'Attention Is All You Need', 'Vaswani'],
  },
  {
    name: 'Chord Progression Analyzer',
    inputs: { progression: 'C-Am-F-G' },
    contains: ['chord-chart', 'C-Am-F-G'],
  },
  {
    name: 'Color Palette Generator',
    inputs: { mood: 'calm coastal evening', dominant_color: '#3A6EA5' },
    contains: ['palette', 'calm coastal evening', '#3A6EA5'],
  },
  {
    name: 'PDF to Markdown Converter',
    inputs: { pdf_title: 'sample-2025-q1-summary.pdf' },
    contains: ['convert-result', 'sample-2025-q1-summary.pdf'],
  },
  {
    name: 'GitHub PR Review',
    inputs: { owner: 'openagentic', repo: 'agentic', pr_number: 42 },
    contains: ['pr-review', 'openagentic/agentic#42'],
  },
  {
    name: 'Morning Standup Digest',
    inputs: { team_id: 'flows', digest_to: 'trent@openagentic.io' },
    contains: ['standup-digest', 'flows', 'trent@openagentic.io'],
  },
];

test.use({ ignoreHTTPSErrors: true });

for (const tc of TEMPLATES) {
  test(`Template "${tc.name}" runs end-to-end on live dev`, async ({ page }) => {
    test.setTimeout(240000);
    const token = await loginAndGetToken(page);

    // 1. Find the template by name
    const tplResult = await page.evaluate(async (authToken) => {
      const res = await fetch('/api/workflows/templates', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      return { status: res.status, body: await res.json() };
    }, token);
    expect(tplResult.status).toBe(200);
    const tpl = (tplResult.body.templates || []).find((t: any) => t.name === tc.name);
    expect(tpl, `template "${tc.name}" not found in /api/workflows/templates`).toBeTruthy();

    // 2. Trigger execute and collect the stream
    const execResult = await page.evaluate(
      async ({ authToken, workflowId, inputs }: any) => {
        const res = await fetch(`/api/workflows/${workflowId}/execute`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: inputs }),
        });
        const text = await res.text();
        // Stream is NDJSON-ish; parse each top-level JSON object.
        const frames: any[] = [];
        let i = 0;
        while (i < text.length) {
          while (i < text.length && /[\s]/.test(text[i])) i++;
          if (i >= text.length) break;
          let depth = 0;
          let start = i;
          let inStr = false;
          let esc = false;
          while (i < text.length) {
            const c = text[i];
            if (esc) { esc = false; }
            else if (c === '\\' && inStr) { esc = true; }
            else if (c === '"') { inStr = !inStr; }
            else if (!inStr) {
              if (c === '{') depth++;
              else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
            }
            i++;
          }
          try { frames.push(JSON.parse(text.slice(start, i))); } catch {}
        }
        const complete = frames.find((f) => f.type === 'execution_complete');
        const errors = frames.filter((f) => f.type === 'execution_error');
        return {
          status: res.status,
          frameCount: frames.length,
          completed: !!complete,
          errored: errors.length > 0,
          output: complete?.output,
          errors,
        };
      },
      {
        authToken: token,
        workflowId: tpl.id,
        inputs: tc.inputs,
      },
    );

    expect([200, 201, 202]).toContain(execResult.status);
    expect(execResult.errored, `errors: ${JSON.stringify(execResult.errors)}`).toBeFalsy();
    expect(execResult.completed, 'expected execution_complete frame').toBeTruthy();

    const output = execResult.output as { body?: string; statusCode?: number };
    expect(output, 'execution_complete missing output').toBeTruthy();
    if (output.statusCode !== undefined) expect(output.statusCode).toBe(200);

    const body = output?.body ?? '';
    for (const needle of tc.contains) {
      expect(body, `expected body to contain "${needle}"`).toContain(needle);
    }
  });
}
