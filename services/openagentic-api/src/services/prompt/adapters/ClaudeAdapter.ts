import type { PromptModule, ModelCapabilities } from '../types.js';
import type { ModelAdapter } from './types.js';

/**
 * Renders a neutral module list into Anthropic-family prompt shape
 * (XML-tagged sections). The adapter never contributes content — identity,
 * reasoning framing, and any other prose comes from seeded modules
 * (identity-default, thinking-guidance, …). See
 * docs/architecture/composable-prompt-neutralization.md.
 */
export class ClaudeAdapter implements ModelAdapter {
  readonly family = 'claude' as const;

  transform(modules: PromptModule[], _capabilities: ModelCapabilities): string {
    return modules
      .map((mod) => `<module name="${mod.name}">${mod.content}</module>`)
      .join('\n\n');
  }
}
