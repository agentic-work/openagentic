/**
 * Phase F Layer 1 — Per-provider canonical event replay assertions
 *
 * Reads the saved primitive-5-step probe captures at
 *   reports/provider-probe/<date>/primitive-5-step/
 * and asserts the 5-step chat primitive's wire-level invariants on each
 * (provider, model) capture. The probe runner
 * (scripts/probe-real-provider.ts --scenario primitive-5-step) IS responsible
 * for producing these captures — this test is a REPLAY assertion, not a
 * provider call. That keeps CI deterministic + offline-safe and pins the
 * captures as the SoT.
 *
 * Per memory rule feedback_no_synthetic_chunks_only_real_provider_captures.md
 * every assertion here MUST be backed by a real-wire capture saved at runtime
 * by the probe runner. The test does NOT synthesize chunks.
 *
 * 5-step primitive (the user's canonical bar for "chat works"):
 *   1. User asks a question                                  (input)
 *   2. Model picks the right tools (or none)                 (capability — may
 *      not fire on a direct-provider probe that doesn't pass tools; tested
 *      end-to-end in Layer 3)
 *   3. Tools dispatch + return data                          (Layer 2 / 3)
 *   4. Model synthesizes the response                        (≥1 text_delta)
 *   5. UI renders inline per openagentic-sdk canonical       (envelope clean:
 *      exactly 1 message_start + 1 message_stop + ≥1 content_block_start +
 *      ≥1 content_block_stop)
 *
 * On a skipped (loud-warn) capture (e.g. no Vertex creds) the test SKIPS
 * the case with `it.skip` so CI stays green while making the deferral
 * visible in the report.
 *
 * Re-capture:
 *   AIF_TENANT_ID=… AIF_CLIENT_ID=… AIF_CLIENT_SECRET=… AIF_ENDPOINT_URL=… \
 *     bun scripts/probe-real-provider.ts --scenario primitive-5-step --provider aif-chat --model gpt-5.4
 *   OLLAMA_BASE_URL=http://host.docker.internal:11434 \
 *     bun scripts/probe-real-provider.ts --scenario primitive-5-step --provider ollama --model gpt-oss:20b
 *   (etc for vertex, bedrock, aif-responses)
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CanonicalEvent } from '../CanonicalEvent.js';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PROBE_REPORTS_DIR = join(REPO_ROOT, 'reports', 'provider-probe');

interface CaptureSummary {
  provider: string;
  endpoint: string;
  model: string;
  prompt: string;
  scenario?: string;
  httpStatus?: number;
  rawChunkCount?: number;
  canonicalEventCount?: number;
  scenarioAssertion?: {
    scenario: string;
    pass: boolean;
    failures: string[];
    observed: {
      textDeltaCount: number;
      toolUseCount: number;
      messageStopCount: number;
      messageStartCount: number;
    };
  };
  skipped?: boolean;
  skipReason?: string;
  capturedAt: string;
}

interface DiscoveredCapture {
  baseName: string;
  date: string;
  summary: CaptureSummary;
  canonicalPath: string;
  rawPath: string;
  summaryPath: string;
}

function discoverPrimitive5StepCaptures(): DiscoveredCapture[] {
  if (!existsSync(PROBE_REPORTS_DIR)) return [];
  const dateDirs = readdirSync(PROBE_REPORTS_DIR).filter((d) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d),
  );
  const out: DiscoveredCapture[] = [];
  for (const date of dateDirs) {
    const scenarioDir = join(PROBE_REPORTS_DIR, date, 'primitive-5-step');
    if (!existsSync(scenarioDir)) continue;
    const files = readdirSync(scenarioDir);
    for (const f of files) {
      if (!f.endsWith('.summary.json')) continue;
      const baseName = f.replace(/\.summary\.json$/, '');
      const summaryPath = join(scenarioDir, f);
      const canonicalPath = join(scenarioDir, `${baseName}.canonical.ndjson`);
      const rawPath = join(scenarioDir, `${baseName}.raw.ndjson`);
      let summary: CaptureSummary;
      try {
        summary = JSON.parse(readFileSync(summaryPath, 'utf-8')) as CaptureSummary;
      } catch {
        continue;
      }
      out.push({ baseName, date, summary, canonicalPath, rawPath, summaryPath });
    }
  }
  return out;
}

function loadCanonicalEvents(path: string): CanonicalEvent[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf-8');
  const events: CanonicalEvent[] = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      events.push(JSON.parse(s));
    } catch {
      // Tolerate trailing garbage; assert on what we got.
    }
  }
  return events;
}

const captures = discoverPrimitive5StepCaptures();

describe('Phase F Layer 1 — primitive-5-step canonical replay (real-wire captures)', () => {
  it('at least one primitive-5-step capture exists on disk', () => {
    expect(
      captures.length,
      `No primitive-5-step captures found under ${PROBE_REPORTS_DIR}/<date>/primitive-5-step/. Run:\n  bun scripts/probe-real-provider.ts --scenario primitive-5-step --provider ollama --model gpt-oss:20b`,
    ).toBeGreaterThan(0);
  });

  // One describe-block per capture so the report reads cleanly.
  for (const cap of captures) {
    const label = `${cap.summary.provider}/${cap.summary.model} (${cap.date})`;

    if (cap.summary.skipped) {
      it.skip(`${label} — DEFERRED: ${cap.summary.skipReason}`, () => {});
      continue;
    }

    // If the capture's httpStatus is not 2xx, the (provider, model) combo
    // is a known-broken platform config (e.g. Bedrock Sonnet 4-6 on-demand
    // throughput unsupported — needs inference-profile ARN). We assert ONCE
    // at the top describe — the assertion itself is the visible RED signal
    // — and skip the rest so the test report stays scannable. The probe
    // capture remains on disk as evidence; re-running the probe with the
    // correct model id will refresh it and the test will go GREEN.
    const httpStatusOk =
      typeof cap.summary.httpStatus === 'number' &&
      cap.summary.httpStatus >= 200 &&
      cap.summary.httpStatus < 300;

    if (!httpStatusOk) {
      describe(label, () => {
        it(`KNOWN-BROKEN — httpStatus=${cap.summary.httpStatus} — re-run probe with corrected model id / region`, () => {
          // Surface the broken capture loudly. This is what flags platform
          // bugs (e.g. Bedrock Sonnet-4-6 needs inference-profile ARN, AIF
          // model rolled out of preview, etc).
          // The assertion that the http call succeeded is the actual gate;
          // wire-level assertions on an empty stream are noise.
          expect(
            httpStatusOk,
            `httpStatus=${cap.summary.httpStatus}. ` +
              `Body snippet: ${(cap as any).summary.httpBodySnippet ?? '(none)'}. ` +
              `Re-run: bun scripts/probe-real-provider.ts --scenario primitive-5-step ` +
              `--provider ${cap.summary.provider} --model <corrected-model-id>`,
          ).toBe(true);
        });
      });
      continue;
    }

    describe(label, () => {
      const events = loadCanonicalEvents(cap.canonicalPath);

      it('Step 5 — wire envelope: exactly 1 message_start + 1 message_stop', () => {
        const messageStartCount = events.filter((e) => e.type === 'message_start').length;
        const messageStopCount = events.filter((e) => e.type === 'message_stop').length;
        expect(messageStartCount, 'message_start count').toBe(1);
        expect(messageStopCount, 'message_stop count').toBe(1);
      });

      it('Step 5 — at least 1 content_block_start + 1 content_block_stop', () => {
        const cbStart = events.filter((e) => e.type === 'content_block_start').length;
        const cbStop = events.filter((e) => e.type === 'content_block_stop').length;
        expect(cbStart, 'content_block_start count').toBeGreaterThanOrEqual(1);
        expect(cbStop, 'content_block_stop count').toBeGreaterThanOrEqual(1);
      });

      it('Step 5 — exactly 1 message_delta with stop_reason', () => {
        const messageDeltas = events.filter((e) => e.type === 'message_delta');
        expect(messageDeltas.length, 'message_delta count').toBe(1);
        const md = messageDeltas[0] as Extract<CanonicalEvent, { type: 'message_delta' }>;
        expect(md.delta.stop_reason).toBeTruthy();
      });

      it('Step 4 — model synthesized text (≥1 text_delta)', () => {
        const textDeltas = events.filter(
          (e) => e.type === 'content_block_delta' && (e.delta as any).type === 'text_delta',
        );
        expect(
          textDeltas.length,
          `Synthesis step requires ≥1 text_delta. observed=${textDeltas.length}. ` +
            `Model emitted ${events.length} canonical events total.`,
        ).toBeGreaterThanOrEqual(1);
      });

      it('Step 4 — accumulated text is non-empty (synthesized content is real)', () => {
        let acc = '';
        for (const e of events) {
          if (e.type === 'content_block_delta' && (e.delta as any).type === 'text_delta') {
            acc += (e.delta as any).text ?? '';
          }
        }
        expect(acc.length, 'synthesized text length').toBeGreaterThan(0);
      });

      it('scenarioAssertion in summary.json passed', () => {
        expect(
          cap.summary.scenarioAssertion?.pass,
          `summary.json scenarioAssertion.failures=${JSON.stringify(cap.summary.scenarioAssertion?.failures)}`,
        ).toBe(true);
      });
    });
  }
});
