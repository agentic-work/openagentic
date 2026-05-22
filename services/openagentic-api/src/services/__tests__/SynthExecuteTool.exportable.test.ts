/**
 * #781 Phase A3 — synth_execute output must carry an `exportable` manifest
 * describing the artifact kind + MIME types + source files. The UI's
 * ArtifactSlideOut reads this to enable Export PDF / Export PNG / Download
 * source buttons without re-deriving the shape from stdout.
 *
 * Plan: docs/superpowers/plans/2026-05-13-next-gen-artifact-slideouts.md §A3
 *
 * Detection rules (RED test pins one canonical shape — markdown-report):
 *   - stdout starts with markdown heading (`# ` after optional whitespace)
 *     → kind: 'python-report', mime includes 'application/pdf' + 'text/markdown'
 *   - sources always includes the user-supplied `code` (so the slide-out
 *     can offer "Download .py source" alongside the rendered report).
 *
 * Other shapes (matplotlib base64 PNG → 'chart'; pandas DataFrame HTML →
 * 'table') get their own tests once this RED→GREEN cycle closes. ONE
 * behavior per commit per TDD discipline.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeSynthExecute } from '../SynthExecuteTool.js';

describe('executeSynthExecute — #781 Phase A3 exportable manifest', () => {
  it('stamps exportable={kind:python-report, mime:[pdf,md], sources:[code]} when stdout starts with markdown heading', async () => {
    const code = 'print("# Azure Cost Report\\n\\n## Top Services\\n- AIF: $42")';
    const mockClient = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        stdout: '# Azure Cost Report\n\n## Top Services\n- AIF: $42\n',
        stderr: '',
        result: null,
        executionTimeMs: 120,
      }),
    };

    const result = await executeSynthExecute(
      { userId: 'u-a3', sessionId: 's-a3', logger: { warn: () => {} } },
      { code, intent: 'cost analysis' },
      { client: mockClient as any },
    );

    expect(result.ok, 'synth_execute must succeed').toBe(true);
    expect(
      (result.output as any)?.exportable,
      'output.exportable manifest must be stamped when stdout is markdown',
    ).toBeDefined();
    expect((result.output as any)?.exportable?.kind).toBe('python-report');
    expect((result.output as any)?.exportable?.mime).toEqual(
      expect.arrayContaining(['application/pdf', 'text/markdown']),
    );
    expect(
      (result.output as any)?.exportable?.sources,
      'sources must include the user-supplied code for .py download',
    ).toContain(code);
  });
});
