/**
 * seedRbacSystemPromptsFromFiles — bootstrap-once seeder that copies the
 * verbatim contents of `prompts/chat-system-{admin,member}.md` into the
 * `rbac_system_prompts` table (v1, is_active=true) ON FRESH DATABASES.
 *
 * Idempotent: if a row already exists for the role, the seed is skipped.
 * After P-Live-8 the .md files are deleted; on fresh installs we'll
 * supply default bodies via env or chart values, but for the cutover
 * window the .md files are the bootstrap source of truth.
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-prompts-db-editable.md
 */
import type { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
// Source layout: services/openagentic-api/src/services/prompt/seedRbacSystemPrompts.ts
// Prompt files:  services/openagentic-api/prompts/chat-system-{admin,member}.md
const PROMPT_DIR = resolve(__filename, '../../../../prompts');

export interface SeedResult {
  created: string[];
  skipped: string[];
}

const ROLES = ['admin', 'member'] as const;

export async function seedRbacSystemPromptsFromFiles(
  prisma: PrismaClient,
): Promise<SeedResult> {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const role of ROLES) {
    const existing = await prisma.rbacSystemPrompt.findFirst({
      where: { role_key: role },
    });
    if (existing) {
      skipped.push(role);
      continue;
    }

    const path = resolve(PROMPT_DIR, `chat-system-${role}.md`);
    const body = await readFile(path, 'utf8');

    await (prisma as any).$transaction(async (tx: any) => {
      const row = await tx.rbacSystemPrompt.create({
        data: {
          role_key: role,
          body,
          version: 1,
          is_active: true,
          description: `Seeded from chat-system-${role}.md (P-Live-1 bootstrap).`,
        },
      });
      await tx.rbacSystemPromptAudit.create({
        data: {
          prompt_id: row.id,
          role_key: role,
          action: 'create',
          before_body: null,
          after_body: body,
          before_version: null,
          after_version: 1,
          actor_user_id: null,
          reason: 'bootstrap-from-file',
        },
      });
    });

    created.push(role);
  }

  return { created, skipped };
}
