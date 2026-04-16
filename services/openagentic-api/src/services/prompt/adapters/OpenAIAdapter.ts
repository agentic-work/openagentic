import type { PromptModule, ModelCapabilities } from '../types.js';
import type { ModelAdapter } from './types.js';

/** Strip XML tags from content */
function stripXml(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}

export class OpenAIAdapter implements ModelAdapter {
  readonly family = 'openai' as const;

  transform(modules: PromptModule[], capabilities: ModelCapabilities): string {
    const rules: string[] = [];

    // For o1/o3 style thinking models: minimal instructions — they reason internally
    if (capabilities.thinking) {
      // Keep minimal; thinking models infer behavior from context
      const coreModules = modules.filter((m) => m.category === 'core');
      coreModules.forEach((mod, i) => {
        const content = stripXml(mod.variants?.openai ?? mod.content);
        rules.push(`${i + 1}. ${content}`);
      });
      return rules.join('\n');
    }

    modules.forEach((mod, i) => {
      // Use openai variant if available, else strip XML from content
      const raw = mod.variants?.openai ?? mod.content;
      const content = stripXml(raw);
      rules.push(`${i + 1}. ${content}`);
    });

    return rules.join('\n');
  }
}
