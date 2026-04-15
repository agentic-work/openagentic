/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
