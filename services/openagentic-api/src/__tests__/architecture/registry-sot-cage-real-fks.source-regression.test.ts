/**
 * Architecture cage — real Postgres FKs only (no Prisma soft FKs).
 *
 * the design notes
 * the design notes
 *
 * The Registry SoT v1 contract: Prisma `relationMode = "prisma"` (soft FKs)
 * is FORBIDDEN. Soft FKs let Prisma "think" a relation exists without the DB
 * actually enforcing it — an audit footgun (an auditor will catch a deleted
 * Registry row that's still referenced by built_in_agents.model_role_assignment_id).
 *
 * The cage: schema.prisma must declare `relationMode = "foreignKeys"` (the
 * Postgres-real-FK mode), or omit relationMode entirely (which defaults to
 * foreignKeys for the postgresql provider).
 *
 * EXPECTED INITIAL STATE: this test should PASS today (no soft FKs in source).
 * It locks the contract so a future PR can't sneak the soft mode in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMA_PATH = join(__dirname, '../../../prisma/schema.prisma');

describe('Registry SoT v1 cage — real Postgres FKs only', () => {
  it('schema.prisma does NOT declare relationMode = "prisma"', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    // Forbid the soft-FK mode anywhere in the schema.
    expect(schema).not.toMatch(/relationMode\s*=\s*"prisma"/);
  });

  it('schema.prisma either declares relationMode = "foreignKeys" OR omits the directive entirely', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    const matches = schema.match(/relationMode\s*=\s*"(\w+)"/g) || [];
    // If the directive is present, it must be foreignKeys.
    for (const m of matches) {
      expect(m).toMatch(/relationMode\s*=\s*"foreignKeys"/);
    }
    // If absent entirely, that's fine — Postgres provider defaults to foreignKeys.
  });
});
