import type { PromptModule, ModelCapabilities, AdapterFamily } from '../types.js';

export interface ModelAdapter {
  family: AdapterFamily;
  transform(modules: PromptModule[], capabilities: ModelCapabilities): string;
}
