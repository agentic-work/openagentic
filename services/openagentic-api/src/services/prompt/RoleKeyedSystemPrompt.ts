/**
 * RoleKeyedSystemPrompt — loads `prompts/chat-system-{admin,member}.md`
 * from disk, file-cached after first read.
 *
 * The two `.md` files are the source of truth for chatmode system prompts.
 * Editing prompts = PR + redeploy (compliance boundary; not an admin-UI
 * feature). Selection happens upstream via `request.user.is_admin`.
 *
 * the design notes-1
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type UserRole = 'admin' | 'member';

const __filename = fileURLToPath(import.meta.url);
// Source layout: services/openagentic-api/src/services/prompt/RoleKeyedSystemPrompt.ts
// Prompt files:  services/openagentic-api/prompts/chat-system-{admin,member}.md
// Resolve from this file's location so the path works whether we're running
// from src (vitest) or dist (production build).
const PROMPT_DIR = resolve(__filename, '../../../../prompts');

const cache = new Map<UserRole, string>();

const VALID_ROLES: ReadonlySet<UserRole> = new Set(['admin', 'member']);

export async function loadStaticPromptForRole(role: UserRole): Promise<string> {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`Unknown role: ${String(role)}. Valid: admin, member.`);
  }
  const cached = cache.get(role);
  if (cached !== undefined) return cached;
  const path = resolve(PROMPT_DIR, `chat-system-${role}.md`);
  const body = await readFile(path, 'utf8');
  cache.set(role, body);
  return body;
}

/** Test-only: invalidate the cache. Production code should not call this. */
export function __clearPromptCache(): void {
  cache.clear();
}
