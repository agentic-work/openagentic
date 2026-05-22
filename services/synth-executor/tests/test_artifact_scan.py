

"""
AC-D3 — synth-executor scans /tmp/synth-output/ after code execution
and surfaces every file as an artifact in the ExecutionResponse so the
api can upload to MinIO + emit artifact_emit NDJSON frames.

Pure-pytest tests for the helper that does the scan (no FastAPI
dependency needed). The helper is exported from
`synth_executor.artifacts` and called by the /execute route after the
sandbox subprocess exits.
"""

from __future__ import annotations

import base64
import os
import tempfile
from pathlib import Path

import pytest

def test_artifact_scan_module_is_importable() -> None:
    """The helper module must be importable from synth_executor."""
    import synth_executor.artifacts as art  # type: ignore[import-not-found]
    assert hasattr(art, 'scan_artifacts')

def test_scan_returns_empty_when_dir_missing(tmp_path: Path) -> None:
    from synth_executor.artifacts import scan_artifacts
    missing = tmp_path / 'nope'
    assert scan_artifacts(str(missing)) == []

def test_scan_returns_empty_when_dir_empty(tmp_path: Path) -> None:
    from synth_executor.artifacts import scan_artifacts
    assert scan_artifacts(str(tmp_path)) == []

def test_scan_finds_file_and_returns_metadata_with_base64_data(tmp_path: Path) -> None:
    from synth_executor.artifacts import scan_artifacts
    payload = b'%PDF-1.4 fake pdf bytes'
    (tmp_path / 'report.pdf').write_bytes(payload)
    artifacts = scan_artifacts(str(tmp_path))
    assert len(artifacts) == 1
    a = artifacts[0]
    assert a['filename'] == 'report.pdf'
    assert a['size_bytes'] == len(payload)
    assert a['content_type'] == 'application/pdf'
    assert base64.b64decode(a['data_b64']) == payload

def test_scan_infers_content_type_from_extension(tmp_path: Path) -> None:
    from synth_executor.artifacts import scan_artifacts
    cases = {
        'a.pdf': 'application/pdf',
        'b.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'c.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'd.html': 'text/html',
        'e.csv': 'text/csv',
        'f.png': 'image/png',
        'g.txt': 'text/plain',
        'h.unknown_ext': 'application/octet-stream',
    }
    for name in cases:
        (tmp_path / name).write_bytes(b'x')
    artifacts = scan_artifacts(str(tmp_path))
    by_name = {a['filename']: a['content_type'] for a in artifacts}
    for name, ct in cases.items():
        assert by_name[name] == ct, f'{name} → expected {ct}, got {by_name[name]}'

def test_scan_returns_stable_artifact_id_per_filename(tmp_path: Path) -> None:
    """artifact_id is filename-derived (slug + content-hash) so the api
    can match artifacts deterministically across the boundary."""
    from synth_executor.artifacts import scan_artifacts
    (tmp_path / 'report.pdf').write_bytes(b'identical')
    a1 = scan_artifacts(str(tmp_path))
    a2 = scan_artifacts(str(tmp_path))
    assert a1[0]['artifact_id'] == a2[0]['artifact_id']
    assert a1[0]['artifact_id'].startswith('report')

def test_scan_caps_per_artifact_size_at_50mb(tmp_path: Path) -> None:
    """Files larger than the 50MB cap are skipped with a warning so a
    runaway program doesn't OOM the api pod uploading bytes."""
    from synth_executor.artifacts import scan_artifacts, ARTIFACT_SIZE_CAP_BYTES
    big = tmp_path / 'huge.bin'
    big.write_bytes(b'x' * (ARTIFACT_SIZE_CAP_BYTES + 1))
    (tmp_path / 'small.txt').write_bytes(b'ok')
    artifacts = scan_artifacts(str(tmp_path))
    names = {a['filename'] for a in artifacts}
    assert 'small.txt' in names
    assert 'huge.bin' not in names

def test_scan_skips_subdirectories(tmp_path: Path) -> None:
    from synth_executor.artifacts import scan_artifacts
    sub = tmp_path / 'nested'
    sub.mkdir()
    (sub / 'inside.txt').write_bytes(b'hidden')
    (tmp_path / 'flat.txt').write_bytes(b'visible')
    artifacts = scan_artifacts(str(tmp_path))
    names = {a['filename'] for a in artifacts}
    assert 'flat.txt' in names
    assert 'inside.txt' not in names
