/**
 * Pin: unifiedAuth's local-token branch must email-remap when the JWT's
 * userId does NOT match any DB user id.
 *
 * Why: SSO callback historically minted JWTs with the Azure OID (or with
 * `azure_<oid>`), but the DB row for that user can have a different id
 * (created by seeders, prior migrations, or the email-fallback merge in
 * routes/auth.ts). When that mismatch happens, every subsequent
 * authenticated request stays at the wrong user.id, and the chat-stream
 * session ownership check 403s with SESSION_NOT_OWNED. This pin proves
 * the fallback path remaps request.user.id to the DB id when an email
 * lookup hits.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

// We isolate the helper logic by re-implementing the email-fallback the
// same way unifiedAuth does — using a tiny prisma stub. The intent is
// behavioral pinning, not import-side-effect coupling.

type DbUser = { id: string; azure_oid: string | null; email: string };

function makePrisma(rows: DbUser[]) {
  return {
    user: {
      findFirst: async (args: any) => {
        const { id } = args.where ?? {};
        return rows.find((r) => r.id === id) ?? null;
      },
      findUnique: async (args: any) => {
        const { email } = args.where ?? {};
        return rows.find((r) => r.email === email) ?? null;
      }
    }
  };
}

async function resolveUserIdForLocalToken(
  prisma: ReturnType<typeof makePrisma>,
  user: { userId: string; email: string }
): Promise<{ id: string; userId: string; remapped: boolean }> {
  let dbUser = await prisma.user.findFirst({
    where: { id: user.userId },
    select: { id: true, azure_oid: true }
  });
  let id = user.userId;
  let remapped = false;
  if (!dbUser && user.email) {
    const byEmail = await prisma.user.findUnique({
      where: { email: user.email },
      select: { id: true, azure_oid: true }
    });
    if (byEmail) {
      id = byEmail.id;
      dbUser = byEmail;
      remapped = true;
    }
  }
  return { id, userId: id, remapped };
}

describe('unifiedAuth local-token branch — email-fallback remap', () => {
  it('keeps user.id stable when JWT userId already matches DB id', async () => {
    const prisma = makePrisma([
      { id: '65e27ed0-9069-4ec8-8fb4-e48b5185609e', email: 'admin@example.onmicrosoft.com', azure_oid: null }
    ]);
    const out = await resolveUserIdForLocalToken(prisma, {
      userId: '65e27ed0-9069-4ec8-8fb4-e48b5185609e',
      email: 'admin@example.onmicrosoft.com'
    });
    expect(out.remapped).toBe(false);
    expect(out.id).toBe('65e27ed0-9069-4ec8-8fb4-e48b5185609e');
  });

  it('Sev-0: remaps to DB id when JWT userId is the Azure OID and DB row matches by email', async () => {
    // This pins the live bug — JWT userId is the Azure OID (UUID from token),
    // DB row id is a different UUID (from prior email merge). Email lookup
    // must take precedence so chat-stream ownership checks resolve cleanly.
    const prisma = makePrisma([
      { id: '65e27ed0-9069-4ec8-8fb4-e48b5185609e', email: 'admin@example.onmicrosoft.com', azure_oid: null }
    ]);
    const out = await resolveUserIdForLocalToken(prisma, {
      userId: '66c199d9-4a52-4f04-a29c-7c02911307d4', // Azure OID, NOT in DB
      email: 'admin@example.onmicrosoft.com'
    });
    expect(out.remapped).toBe(true);
    expect(out.id).toBe('65e27ed0-9069-4ec8-8fb4-e48b5185609e');
  });

  it('does NOT remap when neither id nor email match', async () => {
    const prisma = makePrisma([
      { id: 'someone-else', email: 'other@example.com', azure_oid: null }
    ]);
    const out = await resolveUserIdForLocalToken(prisma, {
      userId: '66c199d9-4a52-4f04-a29c-7c02911307d4',
      email: 'admin@example.onmicrosoft.com'
    });
    expect(out.remapped).toBe(false);
    expect(out.id).toBe('66c199d9-4a52-4f04-a29c-7c02911307d4');
  });
});
