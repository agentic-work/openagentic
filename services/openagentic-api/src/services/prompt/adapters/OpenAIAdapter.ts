import type { PromptModule, ModelCapabilities } from '../types.js';
import type { ModelAdapter } from './types.js';

/**
 * Renders a neutral module list into OpenAI-family prompt shape
 * (numbered rules). For thinking models (o1/o3) the adapter also trims
 * to core modules — thinking models infer domain behavior from context
 * and over-instruction degrades them. That trim is a structural render
 * choice, not vendor content. See
 * docs/architecture/composable-prompt-neutralization.md.
 */
export class OpenAIAdapter implements ModelAdapter {
  readonly family = 'openai' as const;

  transform(modules: PromptModule[], capabilities: ModelCapabilities): string {
    const selected = capabilities.thinking
      ? modules.filter((m) => m.category === 'core')
      : modules;

    return selected.map((mod, i) => `${i + 1}. ${mod.content}`).join('\n');
  }
}
