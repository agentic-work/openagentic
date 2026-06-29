// Server-side hydration of file references sent by the chat client.
//
// The legacy flow had the browser base64-encode every dropped file and embed
// it directly in the /api/chat/stream JSON body. That inflated request sizes
// (a 20 MB image → ~27 MB body), forced us to raise nginx+ingress limits,
// and — worst of all — meant the bytes were discarded when the turn ended;
// the same file could not be re-referenced in a later turn.
//
// New flow: the UI first calls POST /api/files/upload, which writes the
// bytes to MinIO and returns a file id. The chat request then sends
// `files: [{ id }]` only. This helper takes that list, authorizes each id
// against the caller's user_id, and fetches the base64 back from MinIO so
// the LLM completion stage can pass it to the provider unchanged.
//
// Backward compat: if a caller still sends `{ content }` (tests, older UIs,
// or the fallback path for tiny files), we pass it straight through.
//
// Design goals this module intentionally hits:
//   - Cross-user leakage is a throw, not a null. A compromised client must
//     not be able to enumerate other users' file ids.
//   - Missing MinIO blob (DB says yes, bucket says no) is a throw; silent
//     null would pass empty base64 to the LLM and produce an unrelated
//     response the user can't debug.
//   - Empty input short-circuits — no DB or MinIO round-trip.

export interface FileRefInline {
  name?: string;
  type?: string;
  content: string; // base64
  size?: number;
}

export interface FileRefId {
  id: string;
}

export type FileRef = FileRefInline | FileRefId | (FileRefInline & FileRefId);

export interface HydratedFile {
  name: string;
  type: string;
  content: string; // base64
  size: number | undefined;
}

export interface HydrateDeps {
  userId: string;
  prisma: {
    fileAttachment: {
      findFirst: (args: {
        where: { id: string; user_id: string; deleted_at: null };
      }) => Promise<{
        id: string;
        original_name: string;
        mime_type: string;
        size: number;
        upload_path: string;
      } | null>;
    };
  };
  blobStorage: {
    getBase64: (key: string) => Promise<string | null>;
  };
}

function hasContent(f: FileRef): f is FileRefInline {
  return typeof (f as FileRefInline).content === 'string' && (f as FileRefInline).content.length > 0;
}
function hasId(f: FileRef): f is FileRefId {
  return typeof (f as FileRefId).id === 'string' && (f as FileRefId).id.length > 0;
}

export async function hydrateFileReferences(
  refs: FileRef[],
  deps: HydrateDeps,
): Promise<HydratedFile[]> {
  if (refs.length === 0) return [];

  return Promise.all(refs.map(async (ref) => {
    // Inline path: trust the caller. Kept for the small-file fast path and
    // for tests. Content must be non-empty base64.
    if (hasContent(ref)) {
      const inline = ref as FileRefInline;
      return {
        name: inline.name ?? 'file',
        type: inline.type ?? 'application/octet-stream',
        content: inline.content,
        size: inline.size,
      };
    }

    if (!hasId(ref)) {
      throw new Error('File reference missing both id and content');
    }

    const { id } = ref;
    const row = await deps.prisma.fileAttachment.findFirst({
      where: { id, user_id: deps.userId, deleted_at: null },
    });
    if (!row) {
      // Conflate "doesn't exist", "belongs to someone else", and "soft-deleted"
      // into a single error. Distinguishing them would leak the existence of
      // other users' ids to a probing client.
      throw new Error(`File ${id} not found`);
    }

    const base64 = await deps.blobStorage.getBase64(row.upload_path);
    if (!base64) {
      throw new Error(`File ${id} blob missing in storage (key=${row.upload_path})`);
    }

    return {
      name: row.original_name,
      type: row.mime_type,
      content: base64,
      size: row.size,
    };
  }));
}
