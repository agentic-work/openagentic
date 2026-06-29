/**
 * Architecture cage — no bespoke embedding/chat fetch fallbacks in
 * pipeline stages or admin routes.
 *
 * Per docs/rules/no-hardcoded-models.md, the only authorized readers of
 * provider/model config are UniversalEmbeddingService (embeddings) and
 * ProviderManager / ModelConfigurationService (chat). Any module that does
 * its own `fetch('${OLLAMA}/api/embeddings'…)` or
 * `http.request('${OLLAMA}/api/chat'…)` with an inline model literal
 * is bypassing the SoT.
 *
 * Audit 2026-05-05 (memory project_provider_model_sot_audit_2026_05_05.md)
 * flagged:
 *   H6: routes/admin/dlp.ts:257 — `process.env.DEFAULT_MODEL || 'gpt-oss'`
 *       plus a bespoke `${ollamaUrl}/api/chat` http.request.
 *   H7: routes/chat/pipeline/rag.stage.ts — `'nomic-embed-text'` literal
 *       plus a bespoke `${ollamaUrl}/api/embeddings` fetch. (RIPPED
 *       2026-05-05 along with the rest of V1; entry kept here only as
 *       historical context, no longer in CAGED_FILES.)
 * This cage locks the surviving fixes in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..');

interface ForbiddenPattern {
  pattern: RegExp;
  description: string;
}

/** Files cage applies to. Each entry is checked against every pattern. */
const CAGED_FILES: string[] = [
  // routes/chat/pipeline/rag.stage.ts ripped 2026-05-05 (V1 deletion).
  'routes/admin/dlp.ts',
  'services/MilvusVectorService.ts',
];

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  {
    pattern: /['"`]nomic-embed-text['"`]/,
    description: "model literal 'nomic-embed-text'",
  },
  {
    pattern: /['"`]text-embedding-3-(small|large)['"`]/,
    description: "model literal 'text-embedding-3-*'",
  },
  {
    pattern: /['"`]gpt-oss['"`]/,
    description: "model literal 'gpt-oss'",
  },
  {
    pattern: /['"`]gpt-oss:20b['"`]/,
    description: "model literal 'gpt-oss:20b'",
  },
  {
    pattern: /['"`]gemini-2\.\d+-flash['"`]/,
    description: "model literal 'gemini-2.X-flash'",
  },
  {
    pattern: /['"`]claude-(opus|sonnet|haiku)-[0-9-]+['"`]/,
    description: "model literal 'claude-{opus,sonnet,haiku}-…'",
  },
  // Direct fetch to embedding endpoint — must go through UniversalEmbeddingService.
  {
    pattern: /fetch\s*\(\s*[`'"][^`'"]*\/api\/embeddings/,
    description: "bespoke fetch to /api/embeddings (must use UniversalEmbeddingService)",
  },
  // Direct chat completion bypassing ProviderManager.
  {
    pattern: /(?:fetch|http\.request|https\.request)\s*\(\s*[`'"]?[^`'"]*\/api\/(chat|generate)/,
    description: "bespoke chat fetch to /api/chat or /api/generate (must use ProviderManager)",
  },
  // URL-construction form used by node http.request — also a bypass.
  {
    pattern: /new URL\s*\(\s*[`'"][^`'"]*\/api\/(chat|generate|embeddings)[`'"]/,
    description: "URL constructed for bespoke /api/chat|generate|embeddings call (must use ProviderManager / UniversalEmbeddingService)",
  },
  // Hardcoded Ollama port literal as embedding/chat endpoint.
  {
    pattern: /:11434[^\s'"]*\/api\/(embeddings|chat|generate)/,
    description: "hardcoded Ollama endpoint",
  },
];

interface Violation { file: string; description: string; line: number; excerpt: string; }

describe('Architecture cage — no bespoke embedding fallback in pipeline stages', () => {
  it('all caged files route embeddings through UniversalEmbeddingService', () => {
    const violations: Violation[] = [];

    for (const rel of CAGED_FILES) {
      const filePath = join(SRC, rel);
      const src = readFileSync(filePath, 'utf8');
      const lines = src.split('\n');

      for (const { pattern, description } of FORBIDDEN_PATTERNS) {
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            violations.push({ file: rel, description, line: i + 1, excerpt: lines[i].trim() });
          }
        }
      }
    }

    const summary = violations.length === 0
      ? ''
      : `\n${violations.length} forbidden embedding-fallback reference(s):\n` +
        violations.map(v => `  ${v.file}:${v.line} — ${v.description}\n      ${v.excerpt}`).join('\n') +
        `\n\nFix: route through UniversalEmbeddingService.generateEmbedding(text). The service\n` +
        `reads provider+model from admin.llm_providers, which is the only authorized SoT.`;

    expect(violations, summary).toEqual([]);
  });
});
