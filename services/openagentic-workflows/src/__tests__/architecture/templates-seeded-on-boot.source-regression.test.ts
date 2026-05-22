import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * templates-seeded-on-boot (2026-05-14) — source-regression pin for the
 * permanent template seeding wire-up.
 *
 * The one-shot CLI at `seed/scripts/seed-templates.ts` is NOT a permanent
 * seeding path — it has to be hand-run per environment. The permanent path
 * is `services/templateSeeder.ts` invoked from `index.ts` on workflows-svc
 * boot. This test cages that wiring so a future refactor cannot silently
 * regress to "templates only land on the dev environment because someone ran a script".
 *
 * Caged invariants:
 *   1. `services/templateSeeder.ts` exists and exports `seedTemplatesOnBoot`.
 *   2. `index.ts` imports `seedTemplatesOnBoot` from `./services/templateSeeder.js`.
 *   3. `index.ts` calls `seedTemplatesOnBoot(` somewhere in `start()` (the
 *      function body — not just an import).
 *   4. The Dockerfile copies `seed/templates` into the runtime image at
 *      `/app/templates` so the seeder has files to read at boot.
 *   5. The seeder is idempotent (uses `findFirst` + create/update, NOT bare
 *      `create` which would error on every restart after the first).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVICE_ROOT = resolve(__dirname, '..', '..', '..');

function read(p: string): string {
  return readFileSync(p, 'utf-8');
}

describe('templates-seeded-on-boot wire-up (source regression)', () => {
  it('templateSeeder.ts exists and exports seedTemplatesOnBoot', () => {
    const seederPath = join(SERVICE_ROOT, 'src', 'services', 'templateSeeder.ts');
    expect(existsSync(seederPath)).toBe(true);
    const src = read(seederPath);
    expect(src).toMatch(/export\s+async\s+function\s+seedTemplatesOnBoot\b/);
  });

  it('index.ts imports seedTemplatesOnBoot from templateSeeder', () => {
    const indexPath = join(SERVICE_ROOT, 'src', 'index.ts');
    const src = read(indexPath);
    expect(src).toMatch(
      /import\s*\{\s*seedTemplatesOnBoot\s*\}\s*from\s*['"]\.\/services\/templateSeeder\.js['"]/,
    );
  });

  it('index.ts invokes seedTemplatesOnBoot() in the start() function', () => {
    const indexPath = join(SERVICE_ROOT, 'src', 'index.ts');
    const src = read(indexPath);

    // Locate `async function start()` block boundary.
    const startIdx = src.indexOf('async function start()');
    expect(startIdx).toBeGreaterThan(-1);
    const startBlock = src.slice(startIdx);

    // The call site MUST live inside start() (not just an import line).
    expect(startBlock).toMatch(/seedTemplatesOnBoot\s*\(/);

    // And MUST land before fastify.listen() so the seed happens before the
    // first user request hits the gallery endpoint.
    const seedCallPos = startBlock.indexOf('seedTemplatesOnBoot(');
    const listenPos = startBlock.indexOf('fastify.listen(');
    expect(seedCallPos).toBeGreaterThan(-1);
    expect(listenPos).toBeGreaterThan(-1);
    expect(seedCallPos).toBeLessThan(listenPos);
  });

  it('Dockerfile copies seed/templates into the runtime image at /app/templates', () => {
    const dockerfilePath = join(SERVICE_ROOT, 'Dockerfile');
    const src = read(dockerfilePath);
    // Builder stage must stage the templates payload …
    expect(src).toMatch(
      /COPY\s+services\/openagentic-workflows\/seed\/templates\s+\.\/templates/,
    );
    // … and the runtime stage must forward them via the multi-stage copy.
    expect(src).toMatch(
      /COPY\s+--from=builder\s+\/app\/templates\s+\.\/templates/,
    );
  });

  it('seedTemplatesOnBoot is idempotent (findFirst + create/update — not bare create)', () => {
    const seederPath = join(SERVICE_ROOT, 'src', 'services', 'templateSeeder.ts');
    const src = read(seederPath);
    expect(src).toMatch(/findFirst\s*\(/);
    expect(src).toMatch(/prisma\.workflow\.update\s*\(/);
    expect(src).toMatch(/prisma\.workflow\.create\s*\(/);
  });

  it('all template JSONs ship to the runtime image (no rot in seed/templates/)', () => {
    const tplDir = join(SERVICE_ROOT, 'seed', 'templates');
    expect(existsSync(tplDir)).toBe(true);
    const files = readdirSync(tplDir).filter((f) => f.endsWith('.json'));
    // Sanity floor — at least one template is shipping; the actual count
    // grows over time, no upper bound asserted.
    expect(files.length).toBeGreaterThan(0);
    // Every file must parse + carry the required gallery fields.
    for (const f of files) {
      const raw = read(join(tplDir, f));
      const tpl = JSON.parse(raw);
      expect(typeof tpl.slug).toBe('string');
      expect(typeof tpl.name).toBe('string');
      expect(typeof tpl.category).toBe('string');
      expect(tpl.template).toBe(true);
      expect(tpl.definition).toBeTruthy();
      expect(Array.isArray(tpl.definition.nodes)).toBe(true);
      expect(Array.isArray(tpl.definition.edges)).toBe(true);
    }
  });
});
