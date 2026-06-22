// Upload dropped/selected files to /api/files/upload and return the backend
// file ids, in the same order as the input. Replaces the old FileReader →
// base64 → inline-in-chat-body path (see useMessageHandling.convertFilesToBase64).
//
// The backend writes bytes to MinIO + a row in file_attachments; the chat
// request then sends only `files:[{id}]` so the LLM roundtrip doesn't carry
// the bytes twice. Accept: application/json is set explicitly because the
// route content-negotiates on the header (same lesson we learned on
// /api/images/:id — a missing Accept returned raw binary).

export interface UploadedFileRef {
  id: string;
  name: string;
  type: string;
  size: number;
}

function getAuthToken(): string | null {
  // Mirror the lookup chain used by useChatStream.ts so /api/files/upload
  // sees the same Bearer token chat-stream does. Without this header the
  // upload route's getUserFromToken() returns null and the request 401s,
  // which then falls back to inline-base64 in the chat-stream body — the
  // root cause of "HTTP error! status: 413" reports on simple image asks.
  if (typeof window === 'undefined') return null;
  let token =
    localStorage.getItem('accessToken') ||
    localStorage.getItem('auth_token') ||
    sessionStorage.getItem('accessToken');
  if (!token) {
    const match = document.cookie.match(/openagentic_token=([^;]+)/);
    if (match) token = match[1];
  }
  return token;
}

async function uploadOne(file: File): Promise<UploadedFileRef> {
  const fd = new FormData();
  fd.append('file', file, file.name);

  const token = getAuthToken();
  const headers: Record<string, string> = {
    // Do NOT set Content-Type — the browser needs to set the multipart
    // boundary itself.
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch('/api/files/upload', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: fd,
  });

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j.error ? ` — ${j.error}` : '';
    } catch { /* non-JSON body, skip */ }
    throw new Error(`Upload failed (${res.status})${detail}`);
  }

  const data = await res.json();
  const id = data?.file?.id;
  if (!id) {
    throw new Error('Upload response malformed (missing id)');
  }
  return { id, name: file.name, type: file.type, size: file.size };
}

export async function uploadFilesToApi(files: File[]): Promise<UploadedFileRef[]> {
  if (files.length === 0) return [];
  return Promise.all(files.map(uploadOne));
}
