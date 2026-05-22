# Proprietary and confidential. Unauthorized copying prohibited.

"""
AC-D3 — synth-executor artifact scan.

After every /execute call, the server scans `/tmp/synth-output/` for
top-level files and surfaces them as `artifacts` in the
`ExecutionResponse`. The api side (SynthService.executeCode) then
uploads each artifact to MinIO via `UserStorageService.put`, computes
a presigned URL via `getPresignedDownloadUrl`, and emits an
`artifact_emit` NDJSON frame on the chat stream.

Sandboxed Python programs write files via plain `open(...)`; the
prompt module instructs the model to write to the well-known directory
`/tmp/synth-output/` so the scan picks them up. No special helper
module is needed.

Cap: 50MB per artifact (anything larger is dropped with a warning to
avoid OOMing the api pod uploading bytes).
"""

from __future__ import annotations

import base64
import hashlib
import mimetypes
import os
import re
from pathlib import Path
from typing import List, TypedDict

# 50MB cap per artifact — anything larger is dropped with a warning.
ARTIFACT_SIZE_CAP_BYTES: int = 50 * 1024 * 1024

# Well-known synth-output directory — sandboxed code writes files
# here, the scan picks them up after execution.
SYNTH_OUTPUT_DIR: str = '/tmp/synth-output'

# Extensions we ship explicit content-type fallbacks for. mimetypes
# already covers most, but DOCX / XLSX / PPTX have rare or unstable
# entries on minimal distroless images, so we override.
_CONTENT_TYPE_OVERRIDES: dict[str, str] = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.html': 'text/html',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.zip': 'application/zip',
}

class ArtifactRecord(TypedDict):
    artifact_id: str
    filename: str
    content_type: str
    size_bytes: int
    data_b64: str

def _content_type_for(filename: str) -> str:
    ext = os.path.splitext(filename.lower())[1]
    if ext in _CONTENT_TYPE_OVERRIDES:
        return _CONTENT_TYPE_OVERRIDES[ext]
    guess, _ = mimetypes.guess_type(filename)
    return guess or 'application/octet-stream'

def _slug_for(filename: str) -> str:
    """Filename → stable slug usable as part of an artifact_id."""
    stem = re.sub(r'[^a-zA-Z0-9._-]', '-', filename)
    return stem[:120] or 'artifact'

def _artifact_id_for(filename: str, data: bytes) -> str:
    """Stable per-(filename, content-hash) identifier so repeat scans
    produce the same artifact_id."""
    h = hashlib.sha256(data).hexdigest()[:12]
    return f'{_slug_for(filename)}-{h}'

def scan_artifacts(out_dir: str = SYNTH_OUTPUT_DIR) -> List[ArtifactRecord]:
    """Walk `out_dir` (top-level files only — subdirs ignored), build
    one ArtifactRecord per file under the size cap, return as a list.

    Empty / missing directory returns []. Files larger than
    ARTIFACT_SIZE_CAP_BYTES are skipped silently (the caller logs).
    """
    out: List[ArtifactRecord] = []
    p = Path(out_dir)
    if not p.exists() or not p.is_dir():
        return out
    for entry in sorted(p.iterdir()):
        if not entry.is_file():
            continue
        try:
            size = entry.stat().st_size
        except OSError:
            continue
        if size > ARTIFACT_SIZE_CAP_BYTES:
            continue
        try:
            data = entry.read_bytes()
        except OSError:
            continue
        rec: ArtifactRecord = {
            'artifact_id': _artifact_id_for(entry.name, data),
            'filename': entry.name,
            'content_type': _content_type_for(entry.name),
            'size_bytes': size,
            'data_b64': base64.b64encode(data).decode('ascii'),
        }
        out.append(rec)
    return out
