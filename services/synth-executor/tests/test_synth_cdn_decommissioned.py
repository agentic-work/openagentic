

"""
A6 — synth-cdn pod decommissioned. The synth-executor pod owns the CDN
end-to-end (manifest + build script + StaticFiles mount + Dockerfile
bake — see C0.1-C0.3). The legacy `services/synth-cdn` nginx sidecar
must be deleted entirely; build.sh must drop the synth-cdn target;
helm must not reference it (already verified clean).
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
LEGACY_DIR = REPO_ROOT / "services" / "synth-cdn"
BUILD_SH = REPO_ROOT / "scripts" / "build.sh"
HELM_TEMPLATES = REPO_ROOT / "helm" / "openagentic" / "templates"

def test_legacy_synth_cdn_directory_deleted() -> None:
    """`services/synth-cdn/` must not exist. The CDN role lives in
    synth-executor now (see services/synth-executor/cdn/)."""
    assert not LEGACY_DIR.exists(), (
        f"{LEGACY_DIR.relative_to(REPO_ROOT)} must be deleted — synth-executor "
        f"owns the CDN role per C0 plan. Files inside the directory are now "
        f"served from the synth-executor pod's /lib/* mount."
    )

def test_build_sh_drops_synth_cdn_target() -> None:
    """`scripts/build.sh` must not declare a synth-cdn build target.
    The synth-executor build (which now bakes the libs) is the
    replacement."""
    text = BUILD_SH.read_text(encoding="utf-8")
    matches = re.findall(r'^[^#\n]*\["synth-cdn"\][^\n]*$', text, flags=re.MULTILINE)
    assert not matches, (
        f"scripts/build.sh must not declare a synth-cdn target; found:\n"
        + "\n".join(matches)
    )
    # Also reject any non-comment line mentioning services/synth-cdn.
    legacy_paths = re.findall(r'^[^#\n]*services/synth-cdn[^\n]*$', text, flags=re.MULTILINE)
    assert not legacy_paths, (
        f"build.sh references legacy services/synth-cdn paths:\n"
        + "\n".join(legacy_paths)
    )

def test_no_helm_template_references_synth_cdn() -> None:
    """Helm templates already verified clean (no synth-cdn-* templates,
    no values key). This test pins it so a future revert can't quietly
    bring the sidecar back."""
    assert HELM_TEMPLATES.exists(), f"missing helm dir at {HELM_TEMPLATES}"
    bad = []
    for yml in HELM_TEMPLATES.rglob("*.yaml"):
        text = yml.read_text(encoding="utf-8")
        if "synth-cdn" in text or "synthCdn" in text:
            bad.append(yml.relative_to(REPO_ROOT))
    assert not bad, f"helm templates reference synth-cdn: {bad}"
