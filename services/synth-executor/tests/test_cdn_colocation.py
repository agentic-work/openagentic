

"""
C0 — synth-executor pod owns the CDN.

The synth-executor pod is the synth runtime; the CDN libs are part of
that runtime, not a separate sidecar. The legacy `services/synth-cdn`
nginx pod is being deprecated and folded into synth-executor.

These tests guarantee:
  - the lib manifest is co-located with synth-executor at
    `services/synth-executor/cdn/lib-manifest.json`
  - it SHA-matches the legacy `services/synth-cdn/lib-manifest.json`
    so we don't drift while the migration is in flight
  - every `served_at` path is locked under `/lib/` (no off-prefix
    paths, no `..` traversal)

Pure-Python; no FastAPI dependency.
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
EXECUTOR_MANIFEST = REPO_ROOT / "services" / "synth-executor" / "cdn" / "lib-manifest.json"
LEGACY_MANIFEST = REPO_ROOT / "services" / "synth-cdn" / "lib-manifest.json"

def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))

def test_executor_manifest_exists() -> None:
    assert EXECUTOR_MANIFEST.exists(), (
        f"synth-executor must own its CDN manifest at {EXECUTOR_MANIFEST.relative_to(REPO_ROOT)} "
        f"— C0 lib-colocation slice"
    )

def test_executor_manifest_is_valid_json_with_libraries() -> None:
    data = _load(EXECUTOR_MANIFEST)
    assert "libraries" in data, "manifest must declare a `libraries` array"
    assert isinstance(data["libraries"], list), "`libraries` must be a list"
    assert len(data["libraries"]) > 0, "manifest must declare at least one library"

def test_executor_manifest_sha_matches_legacy_synth_cdn() -> None:
    """While both manifests exist, they must agree on every SHA. Once
    A6 deletes the legacy `services/synth-cdn/`, this test passes
    trivially — synth-executor is the only manifest left."""
    if not LEGACY_MANIFEST.exists():
        # A6 complete: legacy synth-cdn deleted. Nothing to compare.
        return
    legacy = _load(LEGACY_MANIFEST)
    new = _load(EXECUTOR_MANIFEST)
    legacy_shas = {lib["name"]: lib["sha256"] for lib in legacy["libraries"]}
    new_shas = {lib["name"]: lib["sha256"] for lib in new["libraries"]}
    missing_in_new = set(legacy_shas) - set(new_shas)
    assert not missing_in_new, f"libraries dropped from executor manifest: {missing_in_new}"
    drifted = {
        name: (legacy_shas[name], new_shas[name])
        for name in legacy_shas
        if legacy_shas[name] != new_shas.get(name)
    }
    assert not drifted, f"SHA drift between executor + legacy manifests: {drifted}"

def test_served_at_paths_locked_under_lib_prefix() -> None:
    """Every `served_at` must begin with `/lib/` and contain no
    traversal sequences. The CDN serves a single static-file mount;
    nothing else is exposed."""
    data = _load(EXECUTOR_MANIFEST)
    bad = []
    for lib in data["libraries"]:
        served_at = lib.get("served_at", "")
        if not served_at.startswith("/lib/"):
            bad.append(("not /lib/-prefixed", lib["name"], served_at))
        if ".." in served_at:
            bad.append(("traversal", lib["name"], served_at))
        if "//" in served_at[1:]:
            bad.append(("double-slash", lib["name"], served_at))
    assert not bad, f"served_at policy violations: {bad}"

def test_each_library_has_required_fields() -> None:
    """Each lib needs name, version, url, sha256, served_at, license,
    extract — the CDN builder + UI iframe both depend on the full
    record."""
    data = _load(EXECUTOR_MANIFEST)
    required = {"name", "version", "url", "sha256", "served_at", "license", "extract"}
    for lib in data["libraries"]:
        missing = required - set(lib.keys())
        assert not missing, f"library {lib.get('name', '?')} missing fields: {missing}"
