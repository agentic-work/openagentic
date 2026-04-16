import type { PromptModule, ModelCapabilities } from '../types.js';
import type { ModelAdapter } from './types.js';

const TOKEN_BUDGET = 1000;
const CHARS_PER_TOKEN = 3.5;
const MAX_CHARS = Math.floor(TOKEN_BUDGET * CHARS_PER_TOKEN); // ~3500 chars

/** Strip all markdown and XML formatting */
function stripFormatting(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')   // XML tags
    .replace(/#{1,6}\s+/g, '') // Markdown headers
    .replace(/\*\*/g, '')      // Bold
    .replace(/\*/g, '')        // Italic
    .replace(/`/g, '')         // Code
    .trim();
}

export class LocalAdapter implements ModelAdapter {
  readonly family = 'local' as const;

  transform(modules: PromptModule[], _capabilities: ModelCapabilities): string {
    const rules: string[] = [];
    let totalChars = 0;

    // Core modules first
    const coreModules = modules.filter((m) => m.category === 'core');
    // At most 1 domain module (highest priority)
    const domainModules = modules
      .filter((m) => m.category === 'domain')
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 1);

    const selected = [...coreModules, ...domainModules];

    for (let i = 0; i < selected.length; i++) {
      const mod = selected[i];
      // Prefer local variant — it's already ultra-short
      const raw = mod.variants?.local ?? mod.content;
      const content = stripFormatting(raw);

      const line = `${i + 1}. ${content}`;
      if (totalChars + line.length > MAX_CHARS) {
        break;
      }

      rules.push(line);
      totalChars += line.length + 1; // +1 for newline
    }

    return rules.join('\n');
  }
}
