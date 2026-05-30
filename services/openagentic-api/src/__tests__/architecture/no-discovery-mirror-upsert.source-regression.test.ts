/**
 * Architecture cage — ModelRegistrySeeder.ts must not contain discovery-mirror
 * write patterns (upsertDiscoveredModels or prisma.lLMProvider.update mutations).
 *
 * Plan: docs/superpowers/plans/2026-05-01-registry-sot-v1.md (Task F2.4)
 * Spec: docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md
 *
 * ModelRegistrySeeder was the bulldozer: on every restart it called
 * prisma.lLMProvider.update() to write discovered models back into
 * provider_config.models[] and model_config. This re-stamps admin-edited rows.
 *
 * After F2.4:
 *   - ModelRegistrySeeder.ts is informational-only (discovery list for the
 *     Add-Model wizard UI). It exposes discoverFromProvider + types but does
 *     NOT call .update() at boot.
 *   - The only legitimate discovery → Registry write path is RegistrySyncJob
 *     (periodic, not boot-time) and AzureAIFoundryProvider/OllamaModelSyncService
 *     (event-driven). Both call upsertDiscoveredModels into model_role_assignments,
 *     not into the JSONB provider_config blob.
 *
 * This cage ensures the removed write loops do not creep back into
 * ModelRegistrySeeder.ts.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..');

const TARGET_FILE = join(SRC, 'services/model-routing/ModelRegistrySeeder.ts');

interface ForbiddenPattern {
  pattern: RegExp;
  name: string;
}

/**
 * Patterns that indicate a discovery-mirror write loop inside ModelRegistrySeeder.
 * These are the exact bulldozer surfaces that F2.4 removes.
 *
 * Note: patterns are matched against non-comment lines only (lines that are not
 * purely a // or * comment). This avoids false positives where the removed code
 * is referenced in a comment explaining WHY it was removed.
 */
const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  {
    // Actual call-site: upsertDiscoveredModels( — not in a comment.
    // The pattern excludes lines that start with optional whitespace + // or *.
    pattern: /\bupsertDiscoveredModels\s*\(/,
    name: 'upsertDiscoveredModels() call-site (discovery-mirror write)',
  },
  {
    // Match prisma.lLMProvider.update({ or this.prisma.lLMProvider.update({
    pattern: /\bprisma\.lLMProvider\.update\s*\(\s*\{/,
    name: 'prisma.lLMProvider.update({ mutation (boot-time bulldozer write)',
  },
];

describe('Registry SoT v1 cage — ModelRegistrySeeder must not contain discovery-mirror upsert', () => {
  it('ModelRegistrySeeder.ts file exists (was narrowed, not deleted)', () => {
    expect(
      existsSync(TARGET_FILE),
      `ModelRegistrySeeder.ts is missing at ${TARGET_FILE} — F2.4 narrows it, not deletes it.`,
    ).toBe(true);
  });

  it('ModelRegistrySeeder.ts does not contain discovery-mirror write patterns', () => {
    const src = readFileSync(TARGET_FILE, 'utf8');
    const lines = src.split('\n');
    const violations: Array<{ name: string; line: number; text: string }> = [];

    for (const { pattern, name } of FORBIDDEN_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimStart();
        // Skip pure comment lines (// ... or * ...) — we only care about live code
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (pattern.test(lines[i])) {
          violations.push({ name, line: i + 1, text: lines[i].trim() });
        }
      }
    }

    const summary = violations.length === 0
      ? ''
      : `\n${violations.length} forbidden discovery-mirror write pattern(s) in ModelRegistrySeeder.ts:\n` +
        violations.map(v => `  line ${v.line}: ${v.name}\n    > ${v.text}`).join('\n') +
        `\n\nFix: ModelRegistrySeeder.ts must be informational-only after F2.4.\n` +
        `Discovery writes go through RegistrySyncJob (periodic) or provider-level sync services.\n` +
        `See docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md for the correct write path.`;

    expect(violations, summary).toEqual([]);
  });
});
