

"""
C0.2 — synth-executor pod serves the CDN libs at `/lib/*`.

The pod takes over what `services/synth-cdn` (legacy nginx sidecar)
used to do. FastAPI's `StaticFiles` mount points at the baked-in
`cdn/dist/lib/` directory; the build pipeline (`cdn/build-libs.sh`,
run during Docker build) populates that directory from
`cdn/lib-manifest.json` with SHA-verified bundles.

These are source-grep tests (no FastAPI runtime dependency required to
run them). They guard:

  - `server.py` imports `StaticFiles` from `fastapi.staticfiles`
  - `server.py` mounts the static files at `/lib`
  - the mount path resolves relative to the package, not an absolute
    bake-time path that breaks distroless deployments
  - the directory is `cdn/dist/lib` (or equivalent) — same shape as the
    legacy `services/synth-cdn` nginx config
  - `build-libs.sh` is co-located with the executor (so the Dockerfile
    can run it during build without referencing the legacy path)
"""

from __future__ import annotations

from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parents[1]
SERVER_PY = PKG_ROOT / "src" / "synth_executor" / "server.py"
BUILD_SCRIPT = PKG_ROOT / "cdn" / "build-libs.sh"

def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")

def test_server_imports_staticfiles_from_fastapi() -> None:
    src = _read(SERVER_PY)
    assert "from fastapi.staticfiles import StaticFiles" in src, (
        "server.py must import StaticFiles to serve /lib/*"
    )

def test_server_mounts_lib_path_at_root() -> None:
    src = _read(SERVER_PY)
    # Must call app.mount("/lib", StaticFiles(directory=...)).
    # Allow either a single-line or multi-line invocation; the literal
    # must contain the path "/lib" and the word "StaticFiles".
    assert 'app.mount("/lib"' in src or "app.mount('/lib'" in src, (
        "server.py must mount StaticFiles at /lib"
    )

def test_server_lib_dir_is_env_overridable_with_app_lib_default() -> None:
    """The mount directory is `SYNTH_LIB_DIR` env (default `/app/lib`).
    This lets the Dockerfile bake libs into a fixed in-container path
    while local dev / k8s overrides retain flexibility. Distroless +
    StaticFiles requires an absolute path, so a hardcoded relative
    path would break."""
    src = _read(SERVER_PY)
    assert "SYNTH_LIB_DIR" in src, (
        "server.py must read SYNTH_LIB_DIR env to locate the lib payload"
    )
    assert '"/app/lib"' in src or "'/app/lib'" in src, (
        "server.py must default SYNTH_LIB_DIR to /app/lib (the Dockerfile "
        "COPY destination)"
    )

def test_build_libs_script_colocated_with_executor() -> None:
    assert BUILD_SCRIPT.exists(), (
        f"build-libs.sh must be co-located with synth-executor at "
        f"{BUILD_SCRIPT.relative_to(PKG_ROOT)} so the Dockerfile can run it without "
        f"a cross-service path. Copy from services/synth-cdn/build-libs.sh."
    )
    text = _read(BUILD_SCRIPT)
    assert text.startswith("#!"), "build-libs.sh must be a shebang-headed shell script"
    assert "lib-manifest.json" in text, "build-libs.sh must reference lib-manifest.json"
    assert "sha256" in text, "build-libs.sh must verify SHA-256 hashes"
