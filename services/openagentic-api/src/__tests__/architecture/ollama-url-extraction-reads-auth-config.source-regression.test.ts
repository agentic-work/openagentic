/**
 * Arch gate: every Ollama URL fallback chain reads auth_config BEFORE
 * falling through to literal defaults. Closes the live bug where the
 * Add-Provider wizard saves URL to auth_config but consumers only
 * read provider_config, falling through to localhost.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC = join(__dirname, '../..');

const FILES_THAT_MUST_READ_AUTH_CONFIG = [
  join(API_SRC, 'routes/admin-ollama.ts'),
  join(API_SRC, 'services/OllamaModelSyncService.ts'),
];

describe('Architecture: Ollama URL extraction reads auth_config', () => {
  for (const fp of FILES_THAT_MUST_READ_AUTH_CONFIG) {
    it(`${fp.split('/').slice(-1)[0]} reads auth_config in URL fallback`, () => {
      const src = readFileSync(fp, 'utf8');
      expect(src).toMatch(/auth_config/);
      expect(src).toMatch(/(ac\.baseUrl|ac\.endpoint|authConfig\.baseUrl|authConfig\.endpoint)/);
    });
  }
});
