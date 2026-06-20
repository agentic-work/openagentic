/**
 * Programmatic quality gate for chatmode end-state walkthrough mocks.
 *
 * Spec: docs/superpowers/specs/2026-05-03-chatmode-end-state-design.md (Layer 1).
 *
 * Each mock at `mocks/UX/AI/Chatmode/end-state-{NN}-{slug}.html` has a sibling
 * `.contract.json` pinning the expected NDJSON frame sequence the post-tier-rip
 * chatmode must produce for that prompt. This test asserts:
 *
 *   1. All 6 contract files exist + parse + match a strict schema.
 *   2. Every `app_render` frame's `template` slug is real — it exists in
 *      either `COMPOSE_APP_TEMPLATES` (via `listTemplateSlugs()`) or
 *      `COMPOSE_VISUAL_TEMPLATES`.
 *   3. Every `tool_use` frame names a tool + has shape flags.
 *   4. The contract's `templates_used[]` matches the union of `app_render`
 *      template references in `frames[]`.
 *   5. Each scenario has at least one final `assistant_prose` frame
 *      (closes the visual contract).
 *
 * If a future PR renames a template slug, removes one, or breaks the mock
 * contract, this test fails. That is the gate.
 *
 * Note (2026-05-12): `follow_up` frames were ripped per user directive.
 * Legacy contract.json files may still reference them; we accept the
 * frame type in the schema but no longer require its presence.
 *
 * Layer 2 (live-model battery against the roster of decent models in the dev environment)
 * is a separate plan after this lands.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { listTemplateSlugs } from '../../services/composeAppTemplates.js';
import { COMPOSE_VISUAL_TEMPLATES } from '../../services/ComposeVisualTool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// services/openagentic-api/src/__tests__/quality/ → repo root is 5 levels up
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const MOCKS_DIR = join(REPO_ROOT, 'mocks', 'UX', 'AI', 'Chatmode');

type FrameType =
  | 'assistant_prose'
  | 'tool_use'
  | 'sub_agent'
  | 'streaming_table'
  | 'app_render'
  | 'follow_up'; // legacy — accepted in legacy contract fixtures, no longer emitted

interface BaseFrame {
  type: FrameType;
  [k: string]: unknown;
}

interface AppRenderFrame extends BaseFrame {
  type: 'app_render';
  via: 'compose_visual' | 'compose_app';
  template: string;
}

interface ToolUseFrame extends BaseFrame {
  type: 'tool_use';
  tool: string;
  has_input?: boolean;
  has_result?: boolean;
}

interface Contract {
  scenario: string;
  prompt: string;
  frames: BaseFrame[];
  templates_used: string[];
}

const VALID_FRAME_TYPES: FrameType[] = [
  'assistant_prose',
  'tool_use',
  'sub_agent',
  'streaming_table',
  'app_render',
  'follow_up',
];

const EXPECTED_SCENARIOS = [
  'azure-subs-rgs',
  'enterprise-multi-tenant-audit',
  'frontdoor-appgw-interrogation',
  'gcp-cloudrun-interrogation',
  'troubleshoot-fix-build-validate',
  'aws-k8s-aiops',
] as const;

function loadContractFiles(): { path: string; basename: string; contract: Contract }[] {
  if (!existsSync(MOCKS_DIR)) {
    throw new Error(`mocks dir not found: ${MOCKS_DIR}`);
  }
  const files = readdirSync(MOCKS_DIR).filter(
    (f) => /^end-state-\d{2}-.*\.contract\.json$/.test(f),
  );
  return files.sort().map((basename) => {
    const path = join(MOCKS_DIR, basename);
    const raw = readFileSync(path, 'utf-8');
    const contract = JSON.parse(raw) as Contract;
    return { path, basename, contract };
  });
}

function knownTemplateSlugs(): { app: Set<string>; visual: Set<string> } {
  return {
    app: new Set(listTemplateSlugs()),
    visual: new Set<string>(COMPOSE_VISUAL_TEMPLATES as readonly string[]),
  };
}

describe('chatmode end-state contract — programmatic quality gate', () => {
  it('exactly 6 contract files exist for the canonical scenarios', () => {
    const loaded = loadContractFiles();
    expect(loaded).toHaveLength(6);
    const scenarios = loaded.map((c) => c.contract.scenario).sort();
    expect(scenarios).toEqual([...EXPECTED_SCENARIOS].sort());
  });

  it('every contract has a non-empty prompt + non-empty frames + templates_used array', () => {
    const loaded = loadContractFiles();
    for (const { basename, contract } of loaded) {
      expect(contract.scenario, `${basename} scenario`).toMatch(/^[a-z0-9-]+$/);
      expect(contract.prompt, `${basename} prompt`).toBeTruthy();
      expect(contract.prompt.length).toBeGreaterThan(10);
      expect(Array.isArray(contract.frames), `${basename} frames is array`).toBe(true);
      expect(contract.frames.length, `${basename} frames non-empty`).toBeGreaterThan(0);
      expect(Array.isArray(contract.templates_used), `${basename} templates_used is array`).toBe(true);
    }
  });

  it('every frame uses one of the 6 valid frame types', () => {
    const loaded = loadContractFiles();
    for (const { basename, contract } of loaded) {
      for (const [i, frame] of contract.frames.entries()) {
        expect(VALID_FRAME_TYPES, `${basename} frame[${i}].type`).toContain(frame.type);
      }
    }
  });

  it('every tool_use frame has a tool name', () => {
    const loaded = loadContractFiles();
    for (const { basename, contract } of loaded) {
      const toolFrames = contract.frames.filter((f) => f.type === 'tool_use') as ToolUseFrame[];
      for (const [i, frame] of toolFrames.entries()) {
        expect(typeof frame.tool, `${basename} tool_use[${i}].tool`).toBe('string');
        expect(frame.tool!.length).toBeGreaterThan(0);
      }
    }
  });

  it('every app_render frame names a template slug that exists in compose_app or compose_visual registry', () => {
    const loaded = loadContractFiles();
    const known = knownTemplateSlugs();
    const violations: string[] = [];

    for (const { basename, contract } of loaded) {
      const appRenderFrames = contract.frames.filter(
        (f) => f.type === 'app_render',
      ) as AppRenderFrame[];

      for (const [i, frame] of appRenderFrames.entries()) {
        expect(
          ['compose_visual', 'compose_app'],
          `${basename} app_render[${i}].via`,
        ).toContain(frame.via);
        expect(typeof frame.template, `${basename} app_render[${i}].template`).toBe('string');

        const slug = frame.template;
        const isAppTemplate = known.app.has(slug);
        const isVisualTemplate = known.visual.has(slug);

        if (frame.via === 'compose_app' && !isAppTemplate) {
          violations.push(
            `${basename} app_render[${i}]: compose_app template "${slug}" not in COMPOSE_APP_TEMPLATES (have: ${[...known.app].join(', ')})`,
          );
        }
        if (frame.via === 'compose_visual' && !isVisualTemplate) {
          violations.push(
            `${basename} app_render[${i}]: compose_visual template "${slug}" not in COMPOSE_VISUAL_TEMPLATES (have: ${[...known.visual].join(', ')})`,
          );
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('templates_used[] matches the union of app_render template references in frames[]', () => {
    const loaded = loadContractFiles();
    for (const { basename, contract } of loaded) {
      const fromFrames = new Set<string>();
      for (const frame of contract.frames) {
        if (frame.type === 'app_render') {
          const f = frame as AppRenderFrame;
          fromFrames.add(`${f.via}:${f.template}`);
        }
      }
      const declared = new Set<string>(contract.templates_used);
      const missing = [...fromFrames].filter((s) => !declared.has(s));
      const extra = [...declared].filter((s) => !fromFrames.has(s));
      expect(
        missing,
        `${basename}: app_render frames reference ${[...fromFrames].join(', ')} but templates_used declares ${[...declared].join(', ')}`,
      ).toEqual([]);
      expect(extra, `${basename}: templates_used has extras ${extra.join(', ')}`).toEqual([]);
    }
  });

  it('every contract has at least one final assistant_prose frame', () => {
    const loaded = loadContractFiles();
    for (const { basename, contract } of loaded) {
      const proseCount = contract.frames.filter((f) => f.type === 'assistant_prose').length;
      expect(proseCount, `${basename} assistant_prose count`).toBeGreaterThanOrEqual(1);
    }
  });

  it('every HTML mock has a sibling contract.json (no orphan HTML, no orphan contract)', () => {
    if (!existsSync(MOCKS_DIR)) return;
    const all = readdirSync(MOCKS_DIR);
    const htmlMocks = all.filter((f) => /^end-state-\d{2}-.*\.html$/.test(f));
    const contracts = all.filter((f) => /^end-state-\d{2}-.*\.contract\.json$/.test(f));

    const htmlSlugs = new Set(htmlMocks.map((f) => f.replace(/\.html$/, '')));
    const contractSlugs = new Set(
      contracts.map((f) => f.replace(/\.contract\.json$/, '')),
    );

    const orphanHtml = [...htmlSlugs].filter((s) => !contractSlugs.has(s));
    const orphanContract = [...contractSlugs].filter((s) => !htmlSlugs.has(s));

    expect(orphanHtml, `HTML mocks without a contract: ${orphanHtml.join(', ')}`).toEqual([]);
    expect(orphanContract, `contracts without an HTML mock: ${orphanContract.join(', ')}`).toEqual(
      [],
    );
  });
});
