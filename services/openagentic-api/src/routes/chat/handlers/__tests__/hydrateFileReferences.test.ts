// hydrateFileReferences — TDD for the server-side file-reference hydration
// that replaces the "browser inlines base64 into chat payload" flow.
//
// Contract: caller passes `request.body.files` ([{id}] or legacy [{content}]).
// Helper normalizes each entry into {name, type, content (base64), size} by:
//   1. If `content` is present (legacy inline path), return it unchanged.
//   2. Else require `id`, look up `file_attachments` for the caller's user_id,
//      read the MinIO blob at the stored key, return base64.
// Auth: any id that isn't owned by the user OR is soft-deleted MUST throw.
// Missing id (neither content nor id) MUST throw so bad callers fail loud.
import { describe, it, expect, vi } from 'vitest';
import { hydrateFileReferences } from '../hydrateFileReferences';

type Row = {
  id: string;
  user_id: string;
  original_name: string;
  mime_type: string;
  size: number;
  upload_path: string;
  deleted_at: Date | null;
};

function mkPrisma(rows: Row[]) {
  return {
    fileAttachment: {
      findFirst: vi.fn(async ({ where }: any) => {
        const { id, user_id, deleted_at } = where;
        return rows.find(r =>
          r.id === id &&
          r.user_id === user_id &&
          (deleted_at === null ? r.deleted_at === null : true)
        ) ?? null;
      }),
    },
  };
}

function mkBlob(map: Record<string, string>) {
  return {
    getBase64: vi.fn(async (key: string) => map[key] ?? null),
  };
}

describe('hydrateFileReferences', () => {
  const USER = 'azure_abc';
  const OTHER_USER = 'azure_xyz';

  it('passes legacy inline {name,type,content} through unchanged', async () => {
    const out = await hydrateFileReferences(
      [{ name: 'a.png', type: 'image/png', content: 'BASE64_A' }],
      { userId: USER, prisma: mkPrisma([]) as any, blobStorage: mkBlob({}) as any },
    );
    expect(out).toEqual([
      { name: 'a.png', type: 'image/png', content: 'BASE64_A', size: undefined },
    ]);
  });

  it('hydrates {id} references from DB + MinIO', async () => {
    const row: Row = {
      id: 'file_1',
      user_id: USER,
      original_name: 'cat.png',
      mime_type: 'image/png',
      size: 1234,
      upload_path: '2026/04/azure_abc/file_1.png',
      deleted_at: null,
    };
    const prisma = mkPrisma([row]);
    const blobStorage = mkBlob({ '2026/04/azure_abc/file_1.png': 'MINIO_CAT_B64' });

    const out = await hydrateFileReferences(
      [{ id: 'file_1' }],
      { userId: USER, prisma: prisma as any, blobStorage: blobStorage as any },
    );

    expect(out).toEqual([{
      name: 'cat.png',
      type: 'image/png',
      content: 'MINIO_CAT_B64',
      size: 1234,
    }]);
    expect(prisma.fileAttachment.findFirst).toHaveBeenCalledWith({
      where: { id: 'file_1', user_id: USER, deleted_at: null },
    });
    expect(blobStorage.getBase64).toHaveBeenCalledWith('2026/04/azure_abc/file_1.png');
  });

  it('mixes inline + id references in a single call (caller order preserved)', async () => {
    const row: Row = {
      id: 'file_2',
      user_id: USER,
      original_name: 'doc.pdf',
      mime_type: 'application/pdf',
      size: 99,
      upload_path: 'k/2',
      deleted_at: null,
    };
    const out = await hydrateFileReferences(
      [
        { name: 'inline.txt', type: 'text/plain', content: 'INLINE_B64' },
        { id: 'file_2' },
      ],
      {
        userId: USER,
        prisma: mkPrisma([row]) as any,
        blobStorage: mkBlob({ 'k/2': 'PDF_B64' }) as any,
      },
    );
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('inline.txt');
    expect(out[1].name).toBe('doc.pdf');
  });

  it('throws when id belongs to a different user (cross-user leak guard)', async () => {
    const row: Row = {
      id: 'file_1',
      user_id: OTHER_USER, // owned by someone else
      original_name: 'secret.png',
      mime_type: 'image/png',
      size: 1,
      upload_path: 'k/secret',
      deleted_at: null,
    };
    await expect(
      hydrateFileReferences(
        [{ id: 'file_1' }],
        { userId: USER, prisma: mkPrisma([row]) as any, blobStorage: mkBlob({}) as any },
      ),
    ).rejects.toThrow(/not found|unauthorized/i);
  });

  it('throws when id is soft-deleted', async () => {
    const row: Row = {
      id: 'file_1',
      user_id: USER,
      original_name: 'x',
      mime_type: 'image/png',
      size: 1,
      upload_path: 'k',
      deleted_at: new Date(),
    };
    await expect(
      hydrateFileReferences(
        [{ id: 'file_1' }],
        { userId: USER, prisma: mkPrisma([row]) as any, blobStorage: mkBlob({}) as any },
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('throws when MinIO is missing the blob (DB says it exists, bucket lost it)', async () => {
    const row: Row = {
      id: 'file_1',
      user_id: USER,
      original_name: 'x',
      mime_type: 'image/png',
      size: 1,
      upload_path: 'lost/key',
      deleted_at: null,
    };
    await expect(
      hydrateFileReferences(
        [{ id: 'file_1' }],
        {
          userId: USER,
          prisma: mkPrisma([row]) as any,
          blobStorage: mkBlob({}) as any,
        },
      ),
    ).rejects.toThrow(/blob/i);
  });

  it('throws when neither id nor content is present (bad caller)', async () => {
    await expect(
      hydrateFileReferences(
        [{ name: 'x' } as any],
        { userId: USER, prisma: mkPrisma([]) as any, blobStorage: mkBlob({}) as any },
      ),
    ).rejects.toThrow(/id.*content/i);
  });

  it('returns empty array for empty input (no DB/MinIO round-trip)', async () => {
    const prisma = mkPrisma([]);
    const blobStorage = mkBlob({});
    const out = await hydrateFileReferences([], {
      userId: USER,
      prisma: prisma as any,
      blobStorage: blobStorage as any,
    });
    expect(out).toEqual([]);
    expect(prisma.fileAttachment.findFirst).not.toHaveBeenCalled();
    expect(blobStorage.getBase64).not.toHaveBeenCalled();
  });
});
