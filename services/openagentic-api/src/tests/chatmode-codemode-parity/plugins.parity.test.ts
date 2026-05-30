/**
 * Plugins Parity — chat ↔ codemode for plugin resolution.
 *
 * Chat pipeline emits `plugin_loaded` top-level NDJSON frames whenever a
 * plugin bundle is loaded (claude-plugins-official:* etc).
 *
 * Codemode pipeline: openagentic's `print.ts` boundary handler relays
 * `emitPluginLoadedOnce()` calls as `{ type:'system',
 * subtype:'plugin_loaded', data:{ pluginId, version?, marketplace?,
 * tools?, skills? } }`. The codemode UI's `streamReducer.ts` consumes
 * that envelope as a `BoundaryPart` of subtype `'plugin'`. (#299 closed
 * 2026-05-07.)
 *
 * Covered plugins (representative sample from the deferred-tool list
 * visible at the top of this conversation):
 *   - claude-plugins-official:playwright
 *   - claude-plugins-official:figma
 *   - claude-plugins-official:gmail
 *   - claude-plugins-official:google-drive
 */

import { describe, test, expect } from 'vitest';
import { runParity, type ParityScenario } from './parity-harness.js';

const REPRESENTATIVE_PLUGINS = [
  'claude-plugins-official:playwright',
  'claude-plugins-official:figma',
  'claude-plugins-official:gmail',
  'claude-plugins-official:google-drive',
];

describe('Plugins parity — chat ↔ codemode', () => {
  for (const plugin of REPRESENTATIVE_PLUGINS) {
    test(`${plugin}: chat AND codemode both emit plugin_loaded (parity)`, () => {
      const scenario: ParityScenario = {
        name: `plugin-${plugin}`,
        userPrompt: `Use the ${plugin} plugin.`,
        script: [
          { kind: 'plugin_load', pluginName: plugin },
          { kind: 'assistant_text', text: `Loaded ${plugin}.` },
        ],
      };

      const run = runParity(scenario);

      // chat emits top-level `plugin_loaded` NDJSON
      const chatPluginFrame = run.chat.parsed.find(
        f => f.type === 'plugin_loaded' && (f as any).pluginName === plugin,
      );
      expect(chatPluginFrame).toBeTruthy();

      // codemode emits the `system/plugin_loaded` envelope
      const codemodePluginFrame = run.codemode.parsed.find(
        f =>
          (f as any).type === 'system' &&
          (f as any).subtype === 'plugin_loaded' &&
          (f as any).data?.pluginId === plugin,
      );
      expect(codemodePluginFrame).toBeTruthy();

      const pluginDivergences = run.diff.divergences.filter(
        d => d.chat?.kind === 'plugin_load' || d.codemode?.kind === 'plugin_load',
      );
      expect(pluginDivergences).toHaveLength(0);
    });
  }

  test('multiple plugins load sequentially on both surfaces', () => {
    const scenario: ParityScenario = {
      name: 'plugin-sequence',
      userPrompt: 'Load multiple plugins.',
      script: REPRESENTATIVE_PLUGINS.map(p => ({
        kind: 'plugin_load' as const,
        pluginName: p,
      })),
    };
    const run = runParity(scenario);

    const chatPluginFrames = run.chat.parsed.filter(f => f.type === 'plugin_loaded');
    expect(chatPluginFrames).toHaveLength(REPRESENTATIVE_PLUGINS.length);
    for (let i = 0; i < REPRESENTATIVE_PLUGINS.length; i++) {
      expect((chatPluginFrames[i] as any).pluginName).toBe(REPRESENTATIVE_PLUGINS[i]);
    }

    const codemodePluginFrames = run.codemode.parsed.filter(
      f => (f as any).type === 'system' && (f as any).subtype === 'plugin_loaded',
    );
    expect(codemodePluginFrames).toHaveLength(REPRESENTATIVE_PLUGINS.length);
    for (let i = 0; i < REPRESENTATIVE_PLUGINS.length; i++) {
      expect((codemodePluginFrames[i] as any).data.pluginId).toBe(REPRESENTATIVE_PLUGINS[i]);
    }
  });
});
