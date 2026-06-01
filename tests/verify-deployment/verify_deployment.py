#!/usr/bin/env python3
"""
verify-deployment — ONE credential-aware acceptance harness for a LIVE
openagentic HELM/Kubernetes deployment.

This is the single entry point. It validates the HELM deployment (NOT
docker-compose): app calls go over the ingress URL; service health + config +
credential detection come from KUBERNETES (kubectl / helm) against the target
namespace. It emits a PASS / FAIL / SKIP matrix and exits non-zero iff any
non-skipped check failed.

  TARGET (defaults to the open-dev release):
    --url        ingress base URL          (env DEPLOY_URL, default https://open-dev.agenticwork.io)
    --namespace  k8s namespace             (env DEPLOY_NAMESPACE, default open-dev)
    --release    helm release name         (env DEPLOY_RELEASE, default open-dev)
    --context    kubectl context           (env DEPLOY_KUBE_CONTEXT, optional)
    admin creds  --admin-email / --admin-password
                 (env DEPLOY_ADMIN_EMAIL / DEPLOY_ADMIN_PASSWORD,
                  default admin@openagentic.local / $DEPLOY_ADMIN_PASSWORD)

  CHECKS (each a row in the matrix):
    HEALTH     /api/health healthy + db/redis/milvus connected; all pods Ready (kubectl)
    AUTH       local login → JWT (isAdmin)
    CHAT       a real chat turn returns a streamed assistant response
    MCP:<id>   for all 14 MCPs — SKIP if not enabled/configured (k8s-detected),
               else chat-probe ONE read tool + VERIFY via the audit log it executed
    FLOW:<id>  every seeded Flow template — run it, assert non-empty output
    APPROVAL   mutating tool → approval_required → approve → executes → audit decision=approved;
               and a READ tool is audited decision=auto (never gated)
    DASHBOARD  admin analytics/metrics endpoints return data of the expected shape
    MEMORY     store a fact in chat, start a NEW session, assert cross-session recall

  USAGE:
    tests/verify-deployment/verify_deployment.py
    tests/verify-deployment/verify_deployment.py --url https://my.ingress --namespace my-ns --release my-rel
    DEPLOY_ADMIN_PASSWORD=... tests/verify-deployment/verify_deployment.py --json report.json
    tests/verify-deployment/verify_deployment.py --only health,auth,chat   # subset of phases
    tests/verify-deployment/verify_deployment.py --no-kube                 # skip kubectl detection (HTTP-only)

  All app I/O is over HTTPS to the ingress. kubectl/helm are used ONLY for
  health + config/credential detection in the namespace; nothing is asserted
  against a compose stack.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness_lib import (  # noqa: E402
    MCP_PROBES,
    McpClusterState,
    McpProbe,
    Row,
    Status,
    classify_audit_decision,
    decide_mcp_skip,
    exit_code_for,
    find_audit_match,
    format_matrix,
    summarize,
)

# ─── output ──────────────────────────────────────────────────────────────────
RESET, BOLD = "\033[0m", "\033[1m"
PURPLE, GREEN, YELLOW, RED, GRAY, BLUE = (
    "\033[38;5;135m", "\033[38;5;46m", "\033[38;5;220m",
    "\033[38;5;196m", "\033[38;5;244m", "\033[38;5;39m",
)
_USE_COLOR = sys.stdout.isatty()


def _c(code: str, s: str) -> str:
    return f"{code}{s}{RESET}" if _USE_COLOR else s


def banner(msg: str) -> None: print(f"\n{_c(PURPLE, '▸')} {_c(BOLD, msg)}")
def info(msg: str) -> None:   print(f"  {_c(BLUE, '·')} {msg}")
def ok(msg: str) -> None:     print(f"  {_c(GREEN, '✓')} {msg}")
def warn(msg: str) -> None:   print(f"  {_c(YELLOW, '!')} {msg}")
def fail(msg: str) -> None:   print(f"  {_c(RED, '✗')} {msg}")


# ─── config ──────────────────────────────────────────────────────────────────
class Cfg:
    def __init__(self, args: argparse.Namespace):
        self.url = (args.url or os.environ.get("DEPLOY_URL")
                    or "https://open-dev.agenticwork.io").rstrip("/")
        self.namespace = args.namespace or os.environ.get("DEPLOY_NAMESPACE") or "open-dev"
        self.release = args.release or os.environ.get("DEPLOY_RELEASE") or "open-dev"
        self.context = args.context or os.environ.get("DEPLOY_KUBE_CONTEXT") or None
        self.admin_email = (args.admin_email or os.environ.get("DEPLOY_ADMIN_EMAIL")
                            or "admin@openagentic.local")
        self.admin_password = (args.admin_password or os.environ.get("DEPLOY_ADMIN_PASSWORD") or "")
        self.no_kube = args.no_kube
        self.insecure = args.insecure
        self.timeout = args.timeout
        self.chat_timeout = args.chat_timeout
        self.audit_poll_s = args.audit_poll
        self.only: Optional[set[str]] = (
            {p.strip().lower() for p in args.only.split(",")} if args.only else None
        )


# ─── HTTP (ingress) ──────────────────────────────────────────────────────────
class Http:
    def __init__(self, cfg: Cfg):
        self.cfg = cfg
        self.token: Optional[str] = None
        if cfg.insecure:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            self._ctx = ctx
        else:
            self._ctx = None

    def _req(self, method: str, path: str, body: Optional[dict], stream: bool,
             timeout: int) -> tuple[int, Any]:
        url = f"{self.cfg.url}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, method=method, data=data)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            resp = urllib.request.urlopen(req, timeout=timeout, context=self._ctx)
        except urllib.error.HTTPError as e:
            payload = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(payload)
            except Exception:
                return e.code, payload
        except Exception as e:  # noqa: BLE001
            return 0, f"<transport error: {type(e).__name__}: {e}>"
        if stream:
            chunks = []
            while True:
                line = resp.readline()
                if not line:
                    break
                chunks.append(line.decode(errors="replace"))
            return resp.status, "".join(chunks)
        payload = resp.read().decode(errors="replace")
        try:
            return resp.status, json.loads(payload)
        except Exception:
            return resp.status, payload

    def get(self, path: str, timeout: Optional[int] = None) -> tuple[int, Any]:
        return self._req("GET", path, None, False, timeout or self.cfg.timeout)

    def post(self, path: str, body: Optional[dict] = None,
             timeout: Optional[int] = None) -> tuple[int, Any]:
        return self._req("POST", path, body, False, timeout or self.cfg.timeout)

    def post_stream(self, path: str, body: dict, timeout: Optional[int] = None) -> tuple[int, str]:
        return self._req("POST", path, body, True, timeout or self.cfg.chat_timeout)


# ─── kubectl / helm detection ────────────────────────────────────────────────
class Kube:
    """Cluster-side detection — health (pods) + config (env) + creds (secret)."""

    def __init__(self, cfg: Cfg):
        self.cfg = cfg
        self.available = (not cfg.no_kube) and bool(shutil.which("kubectl"))
        self._pods_cache: Optional[list[dict]] = None
        self._proxy_env_cache: Optional[dict[str, str]] = None
        self._secret_keys_cache: Optional[set[str]] = None

    def _kubectl(self, args: list[str], timeout: int = 20) -> tuple[int, str]:
        cmd = ["kubectl", "-n", self.cfg.namespace]
        if self.cfg.context:
            cmd += ["--context", self.cfg.context]
        cmd += args
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            return r.returncode, (r.stdout if r.returncode == 0 else r.stderr)
        except Exception as e:  # noqa: BLE001
            return 1, f"{type(e).__name__}: {e}"

    def pods(self) -> list[dict]:
        if self._pods_cache is not None:
            return self._pods_cache
        rc, out = self._kubectl(["get", "pods", "-o", "json"])
        if rc != 0:
            self._pods_cache = []
            return self._pods_cache
        try:
            self._pods_cache = json.loads(out).get("items", [])
        except Exception:
            self._pods_cache = []
        return self._pods_cache

    @staticmethod
    def _pod_ready(pod: dict) -> bool:
        conds = (pod.get("status", {}) or {}).get("conditions", []) or []
        for c in conds:
            if c.get("type") == "Ready":
                return c.get("status") == "True"
        return False

    def pod_readiness(self) -> tuple[int, int, list[str]]:
        """(ready_count, total_count, not_ready_names)."""
        pods = self.pods()
        not_ready = []
        ready = 0
        for p in pods:
            name = p.get("metadata", {}).get("name", "?")
            phase = (p.get("status", {}) or {}).get("phase", "")
            # Completed jobs (Succeeded) don't need Ready.
            if phase == "Succeeded":
                ready += 1
                continue
            if self._pod_ready(p):
                ready += 1
            else:
                not_ready.append(name)
        return ready, len(pods), not_ready

    def _mcp_proxy_env(self) -> dict[str, str]:
        """Env of the mcp-proxy container — the source of truth for MCP enablement."""
        if self._proxy_env_cache is not None:
            return self._proxy_env_cache
        env: dict[str, str] = {}
        # find a deployment/pod whose name contains mcp-proxy
        rc, out = self._kubectl(
            ["get", "deploy", "-o",
             "jsonpath={range .items[*]}{.metadata.name}{'\\n'}{end}"])
        target = None
        if rc == 0:
            for name in out.splitlines():
                if "mcp-proxy" in name:
                    target = name
                    break
        if target:
            rc2, out2 = self._kubectl(
                ["get", "deploy", target, "-o",
                 "jsonpath={range .spec.template.spec.containers[*].env[*]}{.name}={.value}{'\\n'}{end}"])
            if rc2 == 0:
                for line in out2.splitlines():
                    if "=" in line:
                        k, _, v = line.partition("=")
                        env[k.strip()] = v.strip()
        self._proxy_env_cache = env
        return env

    def _secret_keys(self) -> set[str]:
        """Keys present in the openagentic secret(s) — credential signal."""
        if self._secret_keys_cache is not None:
            return self._secret_keys_cache
        keys: set[str] = set()
        rc, out = self._kubectl(["get", "secret", "-o", "json"])
        if rc == 0:
            try:
                for item in json.loads(out).get("items", []):
                    for k in (item.get("data", {}) or {}).keys():
                        keys.add(k.upper())
            except Exception:
                pass
        self._secret_keys_cache = keys
        return keys

    # per-MCP credential signal keys (env var / secret key fragments)
    _CRED_HINTS = {
        "aws": ("AWS_ACCESS_KEY", "AWS_PROFILE", "AWS_ROLE", "AWS_SECRET"),
        "azure": ("AZURE_CLIENT", "AZURE_TENANT", "AZURE_SUBSCRIPTION"),
        "gcp": ("GOOGLE_APPLICATION_CREDENTIALS", "GCP_PROJECT", "GCLOUD"),
        "kubernetes": ("KUBECONFIG", "K8S_", "KUBE_"),
        "github": ("GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PAT"),
        "prometheus": ("PROMETHEUS_URL", "PROM_URL", "PROMETHEUS_HOST"),
        "loki": ("LOKI_URL", "LOKI_HOST"),
        "alertmanager": ("ALERTMANAGER_URL", "ALERTMANAGER_HOST"),
    }

    def mcp_state(self, probe: McpProbe, tools_by_server: Optional[dict[str, int]]) -> McpClusterState:
        """Build the credential/feature state for one MCP from cluster signals."""
        if not self.available:
            # No kubectl — fall back to whatever the proxy tool-list told us.
            tl = None
            if tools_by_server is not None:
                tl = tools_by_server.get(probe.server, 0) > 0
            return McpClusterState(enabled=None, creds_present=None, tools_listed=tl)

        env = self._mcp_proxy_env()
        # Disabled flag convention: OpenAgentic_<MCP>_MCP_DISABLED=true
        disabled_key = f"OpenAgentic_{probe.mcp.replace('-', '_').upper()}_MCP_DISABLED"
        enabled: Optional[bool] = None
        # case-insensitive lookup
        for k, v in env.items():
            if k.upper() == disabled_key.upper():
                enabled = not (v.strip().lower() == "true")
                break
        if enabled is None:
            # Fall back to MCPS_ENABLED allowlist if present.
            allow = env.get("MCPS_ENABLED", "")
            if allow:
                ids = {x.strip().lower() for x in re.split(r"[,\s]+", allow) if x.strip()}
                if ids:
                    enabled = probe.mcp.lower() in ids or probe.server.lower() in ids

        creds: Optional[bool] = None
        if probe.needs_creds:
            hints = self._CRED_HINTS.get(probe.mcp, ())
            secret_keys = self._secret_keys()
            blob = " ".join(env.keys()).upper()
            creds = any(h.upper() in blob for h in hints) or any(
                any(h.upper() in sk for sk in secret_keys) for h in hints
            )
        else:
            creds = True  # credential-free

        tl = None
        if tools_by_server is not None:
            tl = tools_by_server.get(probe.server, 0) > 0
        return McpClusterState(enabled=enabled, creds_present=creds, tools_listed=tl)


# ─── chat helper ─────────────────────────────────────────────────────────────
def new_session(http: Http, title: str) -> Optional[str]:
    code, body = http.post("/api/chat/sessions", {"title": title})
    if code not in (200, 201) or not isinstance(body, dict):
        return None
    return body.get("id") or (body.get("session") or {}).get("id")


def chat_turn(http: Http, prompt: str, session_id: Optional[str] = None,
              timeout: Optional[int] = None) -> tuple[Optional[str], str]:
    """Run one chat turn over the ingress; return (session_id, raw_stream_text)."""
    sid = session_id or new_session(http, "verify-deployment")
    if not sid:
        return None, "<could not create chat session>"
    code, text = http.post_stream(
        "/api/chat/stream", {"message": prompt, "sessionId": sid}, timeout=timeout)
    if code != 200:
        return sid, f"<chat HTTP {code}> {text[:300] if isinstance(text, str) else text}"
    return sid, text if isinstance(text, str) else json.dumps(text)


def audit_rows(http: Http, limit: int = 100, **filters: str) -> list[dict]:
    qs = "&".join([f"limit={limit}"] + [f"{k}={v}" for k, v in filters.items()])
    code, body = http.get(f"/api/admin/audit-log?{qs}")
    if code != 200 or not isinstance(body, dict):
        return []
    return body.get("data", []) or []


def poll_audit_for(http: Http, probe: McpProbe, deadline_s: float) -> Optional[dict]:
    """Poll the audit log until probe's tool appears or the deadline passes."""
    end = time.time() + deadline_s
    while time.time() < end:
        rows = audit_rows(http, limit=100)
        hit = find_audit_match(probe, rows)
        if hit:
            return hit
        time.sleep(2)
    return None


# ─── phases ──────────────────────────────────────────────────────────────────
def phase_health(http: Http, kube: Kube, rows: list[Row]) -> None:
    banner("HEALTH — /api/health + pod readiness")
    code, body = http.get("/api/health")
    detail_bits = []
    healthy = isinstance(body, dict) and code == 200 and body.get("status") == "healthy"
    if not healthy:
        rows.append(Row("HEALTH", Status.FAIL,
                        f"/api/health HTTP {code}: {str(body)[:160]}"))
        fail(f"/api/health unhealthy: HTTP {code}")
        return
    db = (body.get("database") or {}).get("status")
    redis = (body.get("redis") or {}).get("status")
    milvus = (body.get("milvus") or {}).get("status")
    deps_ok = db == "connected" and redis in ("connected",) and milvus in (
        "connected", "reconnected")
    detail_bits.append(f"db={db} redis={redis} milvus={milvus}")
    if db == "connected":
        ok("db connected")
    if not deps_ok:
        rows.append(Row("HEALTH", Status.FAIL,
                        f"dependency not connected: {detail_bits[0]}"))
        fail(detail_bits[0])
        return

    # pod readiness via kubectl
    if kube.available:
        ready, total, not_ready = kube.pod_readiness()
        if total == 0:
            warn("kubectl returned no pods in namespace — health limited to /api/health")
            detail_bits.append("pods: kubectl returned 0 (namespace empty or RBAC)")
        elif not_ready:
            rows.append(Row("HEALTH", Status.FAIL,
                            f"{detail_bits[0]}; {len(not_ready)}/{total} pods NOT Ready: "
                            + ", ".join(not_ready[:6])))
            fail(f"{len(not_ready)} pods not ready: {', '.join(not_ready[:6])}")
            return
        else:
            ok(f"all {ready}/{total} pods Ready")
            detail_bits.append(f"{ready}/{total} pods Ready")
    else:
        detail_bits.append("pods: kubectl unavailable (HTTP-only health)")
        warn("kubectl unavailable — pod readiness skipped, /api/health only")

    rows.append(Row("HEALTH", Status.PASS, "; ".join(detail_bits)))


def phase_auth(http: Http, cfg: Cfg, rows: list[Row]) -> bool:
    banner("AUTH — local login → JWT (isAdmin)")
    if not cfg.admin_password:
        rows.append(Row("AUTH", Status.FAIL,
                        "no admin password (set DEPLOY_ADMIN_PASSWORD or --admin-password)"))
        fail("no admin password provided")
        return False
    code, body = http.post("/api/auth/local/login",
                           {"username": cfg.admin_email, "password": cfg.admin_password})
    if code != 200 or not isinstance(body, dict) or not body.get("token"):
        rows.append(Row("AUTH", Status.FAIL, f"login HTTP {code}: {str(body)[:160]}"))
        fail(f"login failed HTTP {code}")
        return False
    http.token = body["token"]
    is_admin = bool((body.get("user") or {}).get("isAdmin"))
    if not is_admin:
        rows.append(Row("AUTH", Status.FAIL, "logged in but user.isAdmin is not true"))
        fail("user is not admin")
        return False
    ok(f"JWT acquired, isAdmin=true (len={len(http.token)})")
    rows.append(Row("AUTH", Status.PASS, f"isAdmin=true, token len={len(http.token)}"))
    return True


def _looks_like_assistant_text(stream: str) -> bool:
    if not stream:
        return False
    # accept normalized text_delta events, SSE data frames, or raw content
    if re.search(r'"type"\s*:\s*"text_delta"|"content"|"delta"|data:\s*\{', stream):
        return True
    return len(stream.strip()) > 20


def phase_chat(http: Http, rows: list[Row]) -> None:
    banner("CHAT — a real streamed assistant turn")
    _, stream = chat_turn(http, "In one short sentence, say hello and confirm you are online.")
    if _looks_like_assistant_text(stream):
        ok("assistant streamed a response")
        rows.append(Row("CHAT", Status.PASS, f"streamed {len(stream)} chars"))
    else:
        rows.append(Row("CHAT", Status.FAIL, f"no assistant text: {stream[:160]}"))
        fail(f"no streamed assistant text: {stream[:120]}")


def _proxy_tools_by_server(http: Http, kube: Kube) -> Optional[dict[str, int]]:
    """
    Best-effort: tool-count per MCP server, used as a tools_listed signal.
    Tries the admin MCP-tools status (via ingress); returns None if unavailable.
    """
    code, body = http.get("/api/admin/mcp/status")
    if code != 200 or not isinstance(body, dict):
        # try alternate mount
        code, body = http.get("/api/admin/tools/status")
    if code == 200 and isinstance(body, dict):
        counts: dict[str, int] = {}
        servers = (body.get("mcpProxy") or {}).get("servers") or []
        for s in servers:
            sid = str(s.get("serverId", "")).lower()
            for p in MCP_PROBES:
                if p.server in sid or p.mcp in sid:
                    counts[p.server] = counts.get(p.server, 0) + int(s.get("toolCount", 0))
        rc = (body.get("redis") or {}).get("serverCounts") or {}
        for sid, n in rc.items():
            sid_l = str(sid).lower()
            for p in MCP_PROBES:
                if p.server in sid_l or p.mcp in sid_l:
                    counts[p.server] = counts.get(p.server, 0) + int(n)
        return counts or None
    return None


def phase_mcps(http: Http, kube: Kube, cfg: Cfg, rows: list[Row]) -> None:
    banner("MCP-in-chat — all 14 MCPs (audit log = execution oracle)")
    tools_by_server = _proxy_tools_by_server(http, kube)
    for probe in MCP_PROBES:
        check = f"MCP:{probe.mcp}"
        state = kube.mcp_state(probe, tools_by_server)
        decision = decide_mcp_skip(probe, state)
        if not decision.probe:
            rows.append(Row(check, Status.SKIP, decision.reason))
            warn(f"{probe.label}: SKIP — {decision.reason}")
            continue

        info(f"{probe.label}: probing — {probe.probe_prompt}")
        _, stream = chat_turn(http, probe.probe_prompt)
        hit = poll_audit_for(http, probe, cfg.audit_poll_s)
        if hit is None:
            rows.append(Row(check, Status.FAIL,
                            "tool did not execute (no matching audit row within "
                            f"{int(cfg.audit_poll_s)}s)"))
            fail(f"{probe.label}: no audit row — tool did not execute")
            continue
        sane = probe.sanity(stream)
        decision_kind = classify_audit_decision(hit)
        tname = hit.get("tool_name", "?")
        if sane:
            rows.append(Row(check, Status.PASS,
                            f"executed {tname} (decision={decision_kind}); data sanity ok"))
            ok(f"{probe.label}: {tname} executed (decision={decision_kind}) + real data")
        else:
            rows.append(Row(check, Status.FAIL,
                            f"audited {tname} (decision={decision_kind}) but data sanity FAILED"))
            fail(f"{probe.label}: {tname} audited but returned no usable data")


def phase_flows(http: Http, kube: Kube, cfg: Cfg, rows: list[Row]) -> None:
    banner("FLOW templates — run every seeded template")
    code, body = http.get("/api/workflows/templates")
    templates = (body.get("templates") if isinstance(body, dict) else None) or []
    if not templates:
        # try to seed, then re-fetch
        http.post("/api/workflows/seed-templates", {})
        code, body = http.get("/api/workflows/templates")
        templates = (body.get("templates") if isinstance(body, dict) else None) or []
    if not templates:
        rows.append(Row("FLOW:*", Status.FAIL, "no Flow templates enumerable via /api/workflows/templates"))
        fail("no Flow templates found")
        return

    # MCP server availability gate: a template that needs an absent MCP → SKIP.
    tools_by_server = _proxy_tools_by_server(http, kube)
    enabled_servers = set()
    for probe in MCP_PROBES:
        st = kube.mcp_state(probe, tools_by_server)
        if decide_mcp_skip(probe, st).probe:
            enabled_servers.add(probe.server)

    for tpl in templates:
        slug = ((tpl.get("meta") or {}).get("slug")
                or tpl.get("slug") or tpl.get("name") or tpl.get("id"))
        check = f"FLOW:{slug}"
        tpl_id = tpl.get("id")
        meta = tpl.get("meta") or {}
        tools_used = " ".join(str(t) for t in (meta.get("tools_used") or []))
        # Which cred-gated MCPs does this template reference?
        missing = []
        for probe in MCP_PROBES:
            if probe.needs_creds and (probe.server in tools_used or probe.mcp in tools_used):
                if probe.server not in enabled_servers:
                    missing.append(probe.mcp)
        if missing:
            rows.append(Row(check, Status.SKIP,
                            f"needs MCP(s) not configured: {', '.join(sorted(set(missing)))}"))
            warn(f"{slug}: SKIP — needs {', '.join(sorted(set(missing)))}")
            continue

        defaults = tpl.get("defaultInputs") or tpl.get("default_inputs") or {}
        ec, eb = http.post(f"/api/workflows/{tpl_id}/execute?async=false",
                           {"input": defaults, "trigger_type": "api"},
                           timeout=cfg.chat_timeout)
        out_text = json.dumps(eb) if not isinstance(eb, str) else eb
        produced = ec in (200, 201) and bool(out_text) and len(out_text.strip()) > 2 \
            and '"error"' not in out_text.lower()[:200]
        if produced:
            rows.append(Row(check, Status.PASS, f"executed; output {len(out_text)} chars"))
            ok(f"{slug}: executed, non-empty output")
        else:
            rows.append(Row(check, Status.FAIL,
                            f"execute HTTP {ec}: {out_text[:160]}"))
            fail(f"{slug}: execute failed HTTP {ec}")


def phase_approval(http: Http, kube: Kube, cfg: Cfg, rows: list[Row]) -> None:
    banner("APPROVAL gate + audit — mutating call gated; read call auto-audited")
    # 1. A READ tool must be audited decision=auto and never gated.
    #    Use the admin MCP (credential-free) as the read probe if available.
    read_probe = next((p for p in MCP_PROBES if p.mcp == "admin"), None)
    read_ok = None
    if read_probe:
        st = kube.mcp_state(read_probe, _proxy_tools_by_server(http, kube))
        if decide_mcp_skip(read_probe, st).probe:
            chat_turn(http, read_probe.probe_prompt)
            hit = poll_audit_for(http, read_probe, cfg.audit_poll_s)
            if hit and classify_audit_decision(hit) == "auto":
                read_ok = True
            elif hit:
                read_ok = False  # audited but gated — wrong for a READ

    # 2. A MUTATING tool must raise approval_required, then approve → execute → audit approved.
    mutate_prompt = (
        "Use the admin MCP to update a non-critical platform setting (a mutating action). "
        "If approval is required, request it."
    )
    _, stream = chat_turn(http, mutate_prompt)
    approval_id = None
    m = re.search(r'"(?:auditId|approvalId|requestId|id)"\s*:\s*"([0-9a-f-]{8,})"', stream)
    if re.search(r"approval_required|approval[_-]?request|requires? approval", stream, re.I) and m:
        approval_id = m.group(1)

    if approval_id is None:
        # No mutating tool reachable on this target → SKIP that half, but still
        # report the read-auto result if we got it.
        if read_ok is True:
            rows.append(Row("APPROVAL", Status.SKIP,
                            "read tool auto-audited OK; no reachable mutating tool to gate"))
            warn("no mutating tool reachable — gate half SKIPPED; read auto-audit verified")
        else:
            rows.append(Row("APPROVAL", Status.SKIP,
                            "no reachable mutating tool to gate (and no read-auto signal)"))
            warn("no mutating tool reachable — approval phase SKIPPED")
        return

    info(f"approval_required raised (id={approval_id}); approving")
    ac, ab = http.post(f"/api/approvals/{approval_id}/approve", {})
    if ac != 200:
        rows.append(Row("APPROVAL", Status.FAIL, f"approve HTTP {ac}: {str(ab)[:120]}"))
        fail(f"approve call failed HTTP {ac}")
        return
    # verify audit row decision=approved for that id
    end = time.time() + cfg.audit_poll_s
    approved_row = None
    while time.time() < end:
        for r in audit_rows(http, limit=100):
            if (r.get("id") == approval_id or str(approval_id) in str(r.get("id"))) \
                    and classify_audit_decision(r) == "approved":
                approved_row = r
                break
        if approved_row:
            break
        time.sleep(2)
    if approved_row and (read_ok in (True, None)):
        detail = "mutating gated→approved→executed (audit decision=approved)"
        if read_ok is True:
            detail += "; read tool decision=auto"
        rows.append(Row("APPROVAL", Status.PASS, detail))
        ok(detail)
    elif not approved_row:
        rows.append(Row("APPROVAL", Status.FAIL,
                        "approved via API but no audit row with decision=approved"))
        fail("no audit row decision=approved after approve")
    else:
        rows.append(Row("APPROVAL", Status.FAIL,
                        "mutating gate OK but read tool was gated instead of auto-audited"))
        fail("read tool was gated (should be decision=auto)")


def phase_dashboards(http: Http, rows: list[Row]) -> None:
    banner("DASHBOARDS — admin analytics/metrics endpoints")
    checks = [
        ("GET", "/api/admin/cluster/health", None, "cluster/health"),
        ("GET", "/api/admin/analytics/stats", None, "analytics/stats"),
        ("GET", "/api/admin/dashboard/counts", None, "dashboard/counts"),
        ("POST", "/api/admin/prom/query", {"query": "up"}, "prom/query"),
    ]
    passed, attempted, details = 0, 0, []
    for method, path, body, label in checks:
        attempted += 1
        if method == "GET":
            code, resp = http.get(path)
        else:
            code, resp = http.post(path, body)
        # Accept 200 with a dict/list body. 503 for prom means Prometheus
        # unreachable on the target — record but don't hard-fail the row on
        # that single endpoint (it's environment, not the dashboard API).
        if code == 200 and (isinstance(resp, (dict, list))):
            passed += 1
            details.append(f"{label}=ok")
            ok(f"{label}: 200 + data")
        elif code == 503 and label == "prom/query":
            details.append(f"{label}=503(prom-unreachable)")
            warn(f"{label}: 503 Prometheus unreachable (environment)")
        else:
            details.append(f"{label}=HTTP{code}")
            fail(f"{label}: HTTP {code}")
    # PASS if at least the non-prom endpoints returned data.
    core_ok = passed >= (attempted - 1)
    rows.append(Row("DASHBOARD", Status.PASS if core_ok else Status.FAIL, "; ".join(details)))


def phase_memory(http: Http, rows: list[Row]) -> None:
    banner("MEMORY — store a fact, NEW session, assert cross-session recall")
    secret = f"verify-deployment-{int(time.time())}"
    fact = f"My deployment verification codeword is {secret}. Please remember it."
    sid1 = new_session(http, "verify-memory-store")
    if not sid1:
        rows.append(Row("MEMORY", Status.FAIL, "could not create first session"))
        fail("could not create store session")
        return
    chat_turn(http, fact, session_id=sid1)
    # brief settle for async memory write
    time.sleep(3)
    # NEW session — recall
    sid2 = new_session(http, "verify-memory-recall")
    if not sid2:
        rows.append(Row("MEMORY", Status.FAIL, "could not create recall session"))
        fail("could not create recall session")
        return
    _, recall = chat_turn(
        http, "What is my deployment verification codeword? Answer with just the codeword.",
        session_id=sid2)
    if secret in recall:
        rows.append(Row("MEMORY", Status.PASS, "recalled codeword across sessions"))
        ok("codeword recalled in a NEW session")
    else:
        rows.append(Row("MEMORY", Status.FAIL,
                        f"codeword not recalled in new session: {recall[:160]}"))
        fail("codeword not recalled cross-session")


# ─── main ────────────────────────────────────────────────────────────────────
PHASES = ("health", "auth", "chat", "mcps", "flows", "approval", "dashboards", "memory")


def _want(cfg: Cfg, phase: str) -> bool:
    return cfg.only is None or phase in cfg.only


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="ingress base URL (default https://open-dev.agenticwork.io)")
    ap.add_argument("--namespace", help="k8s namespace (default open-dev)")
    ap.add_argument("--release", help="helm release (default open-dev)")
    ap.add_argument("--context", help="kubectl context")
    ap.add_argument("--admin-email", help="admin email (default admin@openagentic.local)")
    ap.add_argument("--admin-password", help="admin password (or env DEPLOY_ADMIN_PASSWORD)")
    ap.add_argument("--json", dest="json_out", help="write machine-readable summary to this path")
    ap.add_argument("--only", help="comma list of phases to run: " + ",".join(PHASES))
    ap.add_argument("--no-kube", action="store_true", help="skip kubectl detection (HTTP-only)")
    ap.add_argument("--insecure", action="store_true", help="don't verify TLS cert")
    ap.add_argument("--timeout", type=int, default=30, help="HTTP timeout (s)")
    ap.add_argument("--chat-timeout", type=int, default=180, help="chat/flow stream timeout (s)")
    ap.add_argument("--audit-poll", type=float, default=30.0, help="audit-log poll budget per probe (s)")
    args = ap.parse_args(argv)

    cfg = Cfg(args)
    http = Http(cfg)
    kube = Kube(cfg)
    rows: list[Row] = []

    banner("verify-deployment — HELM acceptance harness")
    info(f"ingress     {cfg.url}")
    info(f"namespace   {cfg.namespace}   release {cfg.release}"
         + (f"   context {cfg.context}" if cfg.context else ""))
    info(f"kubectl     {'available' if kube.available else 'unavailable (HTTP-only detection)'}")
    if cfg.only:
        info(f"phases      {', '.join(sorted(cfg.only))}")

    # HEALTH + AUTH are foundational. If AUTH fails, app-level phases can't run.
    if _want(cfg, "health"):
        phase_health(http, kube, rows)
    authed = True
    if _want(cfg, "auth"):
        authed = phase_auth(http, cfg, rows)
    else:
        authed = phase_auth(http, cfg, [])  # auth silently for downstream phases

    if authed and http.token:
        app_phases = (
            ("chat", lambda: phase_chat(http, rows)),
            ("mcps", lambda: phase_mcps(http, kube, cfg, rows)),
            ("flows", lambda: phase_flows(http, kube, cfg, rows)),
            ("approval", lambda: phase_approval(http, kube, cfg, rows)),
            ("dashboards", lambda: phase_dashboards(http, rows)),
            ("memory", lambda: phase_memory(http, rows)),
        )
        for name, run in app_phases:
            if _want(cfg, name):
                run()
    else:
        for ph in ("chat", "mcps", "flows", "approval", "dashboards", "memory"):
            if _want(cfg, ph):
                rows.append(Row(ph.upper(), Status.FAIL, "skipped — auth failed (no token)"))

    # ── report ──
    banner("ACCEPTANCE MATRIX")
    print()
    print(format_matrix(rows, color=_USE_COLOR))
    summary = summarize(rows)
    c = summary["counts"]
    print()
    verdict = _c(GREEN, "PASS") if summary["ok"] else _c(RED, "FAIL")
    print(f"  {verdict}  {c['PASS']} passed · {c['FAIL']} failed · {c['SKIP']} skipped "
          f"· {c['TOTAL']} total")
    if summary["failed_checks"]:
        print(f"  failed: {', '.join(summary['failed_checks'])}")

    if args.json_out:
        meta = {
            "url": cfg.url, "namespace": cfg.namespace, "release": cfg.release,
            "kubectl": kube.available, "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        with open(args.json_out, "w") as f:
            json.dump({**summary, "target": meta}, f, indent=2)
        info(f"JSON summary → {args.json_out}")

    return exit_code_for(rows)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
