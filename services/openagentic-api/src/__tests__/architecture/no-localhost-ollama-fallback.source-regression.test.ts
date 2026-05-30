/**
 * Arch gate: no NEW source code may add a literal 'http://localhost:11434' fallback.
 * The existing two occurrences (admin-ollama.ts:40,61 and OllamaModelSyncService.ts:127)
 * are grandfathered until Phase 1 patches them. After Phase 1 they must read auth_config
 * BEFORE falling through to the literal default.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC = join(__dirname, '../..');

const NEW_FILES_THAT_MUST_NOT_HAVE_LITERAL_FALLBACK = [
  join(API_SRC, 'services/llm-providers/extractOllamaBaseUrl.ts'),
];

describe('Architecture: no localhost:11434 literal in NEW URL-extraction code', () => {
  for (const fp of NEW_FILES_THAT_MUST_NOT_HAVE_LITERAL_FALLBACK) {
    it(`${fp.split('/').slice(-2).join('/')} must not contain 'localhost:11434' literal`, () => {
      try {
        const src = readFileSync(fp, 'utf8');
        expect(src).not.toMatch(/['"`]http:\/\/localhost:11434['"`]/);
      } catch (e: any) {
        if (e.code === 'ENOENT') return; // file doesn't exist yet — Phase 1 will create it
        throw e;
      }
    });
  }
});
