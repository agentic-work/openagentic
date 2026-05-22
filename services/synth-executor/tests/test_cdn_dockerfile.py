

"""
C0.3 — Dockerfile bakes the CDN lib payload into the synth-executor
image so the pod ships its own libs (no synth-cdn sidecar required).

Build-time flow:
  1. builder stage installs jq + curl + sha256sum (build-libs.sh
     dependencies)
  2. builder stage COPYs `cdn/` into the build context
  3. builder stage RUNs `cdn/build-libs.sh` which downloads each
     lib, verifies SHA-256, extracts into `cdn/dist/lib/`
  4. final stage COPYs `cdn/dist/lib/` → `/app/lib/` so the
     SYNTH_LIB_DIR env (default /app/lib) resolves to the baked
     payload at runtime
"""

from __future__ import annotations

import re
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = PKG_ROOT / "Dockerfile"

def _read() -> str:
    return DOCKERFILE.read_text(encoding="utf-8")

def test_builder_stage_installs_jq_curl_for_libs_build() -> None:
    """`build-libs.sh` requires jq + curl + sha256sum. coreutils
    (sha256sum) is in the python-slim base; jq + curl are not."""
    src = _read()
    # We're checking that the apt-get install in the builder stage
    # extends to include jq + curl (and gcc, which was already there).
    apt_lines = [line for line in src.splitlines() if "apt-get install" in line or re.match(r"^\s+(jq|curl|gcc)", line)]
    apt_block = "\n".join(apt_lines)
    assert "jq" in apt_block, "builder must install jq for cdn/build-libs.sh"
    assert "curl" in apt_block, "builder must install curl for cdn/build-libs.sh"

def test_builder_copies_cdn_directory() -> None:
    src = _read()
    # COPY cdn/ before running the build script.
    assert re.search(r"^COPY\s+cdn/?\s+", src, flags=re.MULTILINE), (
        "builder stage must COPY cdn/ into the build context"
    )

def test_builder_runs_build_libs_script() -> None:
    src = _read()
    # Match `RUN ... build-libs.sh ...` regardless of path/shell prefix.
    assert re.search(r"^RUN\b[^\n]*build-libs\.sh", src, flags=re.MULTILINE), (
        "builder stage must RUN cdn/build-libs.sh to fetch + SHA-verify libs"
    )

def test_final_stage_copies_baked_libs_to_app_lib() -> None:
    src = _read()
    # Match `COPY --from=builder ... cdn/dist/lib/ ... /app/lib/` regardless
    # of intervening flags like --chown=. The lib payload must land in
    # the runtime-stage /app/lib so SYNTH_LIB_DIR (default /app/lib)
    # resolves to it.
    pat = re.compile(
        r"^COPY\b[^\n]*--from=builder[^\n]*cdn/dist/lib/?[^\n]*/app/lib/?",
        flags=re.MULTILINE,
    )
    assert pat.search(src), (
        "final stage must COPY --from=builder ... cdn/dist/lib/ → /app/lib/ "
        "so SYNTH_LIB_DIR (/app/lib default) resolves to the baked payload"
    )

def test_final_stage_owns_app_lib_as_nonroot() -> None:
    """StaticFiles serves /app/lib as the nonroot user. The COPY must
    chown to that user, otherwise distroless can't read the bytes."""
    src = _read()
    pat = re.compile(
        r"^COPY\b[^\n]*--chown=nonroot:nonroot[^\n]*cdn/dist/lib/?[^\n]*/app/lib/?",
        flags=re.MULTILINE,
    )
    assert pat.search(src), (
        "final-stage COPY of /app/lib must include --chown=nonroot:nonroot "
        "(distroless runs as uid 65532 and can't read root-owned files)"
    )
