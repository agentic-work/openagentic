#!/usr/bin/env python3
"""Deterministic merge of an evidence-grounded patch into the dashboard status.json.

The dashboard (index.astro) client-polls /status.json, so writing this file IS
the live-update mechanism. This script merges ONLY the dynamic fields and
PRESERVES all diagram geometry (x/y/edges/lanes/viewBox/labels) — so an agent
or the controller can refresh real status without ever clobbering the layout.

Usage:
    python3 sync-status.py < patch.json
    echo '{"nodeStatus": {...}, "ac": {...}}' | python3 sync-status.py
    python3 sync-status.py patch.json

Patch schema (every field optional — only present fields are applied):
{
  "headline":  "string",                       # top banner
  "live":      {"api": "...", "ui": "..."},    # deployed image tags (merged)
  "ac":        {"pass": N, "fail": N, "unverified": N, "total": N},
  "nodeStatus": {"<nodeId>": "live|building|working|broken|unverified", ...},
                 # applied to BOTH architecture.nodes and archFull.nodes by id
  "working":   ["<nodeId>", ...],              # force status='working' on these (in-flight)
  "workLeft":  [{"id","title","status","note"}],   # REPLACES the list
  "inFlight":  [{"nodeId","title","note"}],        # REPLACES the list (new field)
  "workflows": [{"id","name","phase","status"}],   # REPLACES the list
  "event":     "string"                        # appended to events feed (timestamped)
}

`updatedAt` is always stamped (UTC). Unknown node ids in nodeStatus are ignored
(logged to stderr) so a stale patch can never inject phantom nodes.
"""
import json
import sys
import os
from datetime import datetime, timezone

STATUS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "status.json")
VALID_STATUSES = {"live", "building", "working", "broken", "unverified", "todo", "done", "running"}


def _read_patch() -> dict:
    if len(sys.argv) > 1 and sys.argv[1] not in ("-", ""):
        with open(sys.argv[1], "r") as f:
            return json.load(f)
    return json.load(sys.stdin)


def _apply_node_status(nodes: list, node_status: dict, working: set, found: set) -> None:
    """Apply statuses to nodes in THIS block; record which ids were found (a
    node may live in only one of the two diagram blocks, so unknown-detection
    is done by the caller across the UNION of found ids)."""
    by_id = {n.get("id"): n for n in nodes}
    for nid, st in (node_status or {}).items():
        if nid in by_id:
            found.add(nid)
            if st in VALID_STATUSES:
                by_id[nid]["status"] = st
            else:
                print(f"[sync-status] WARN ignoring invalid status {st!r} for {nid}", file=sys.stderr)
    for nid in (working or set()):
        if nid in by_id:
            found.add(nid)
            by_id[nid]["status"] = "working"


def main() -> int:
    patch = _read_patch()
    with open(STATUS_PATH, "r") as f:
        status = json.load(f)

    if "headline" in patch:
        status["headline"] = str(patch["headline"])

    if isinstance(patch.get("live"), dict):
        status.setdefault("live", {})
        status["live"].update({k: v for k, v in patch["live"].items() if isinstance(v, str)})

    if isinstance(patch.get("ac"), dict):
        ac = status.setdefault("ac", {})
        for k in ("pass", "fail", "unverified", "total"):
            if k in patch["ac"]:
                ac[k] = patch["ac"][k]
        # keep total consistent if not explicitly given
        if "total" not in patch["ac"]:
            ac["total"] = ac.get("pass", 0) + ac.get("fail", 0) + ac.get("unverified", 0)

    node_status = patch.get("nodeStatus") or {}
    working = set(patch.get("working") or [])
    found: set = set()
    if node_status or working:
        for key in ("architecture", "archFull"):
            block = status.get(key) or {}
            _apply_node_status(block.get("nodes") or [], node_status, working, found)
        requested = set(node_status.keys()) | working
        unknown = requested - found
        if unknown:
            print(f"[sync-status] WARN unknown node ids (in NO diagram block): {sorted(unknown)}", file=sys.stderr)

    if isinstance(patch.get("workLeft"), list):
        status["workLeft"] = patch["workLeft"]
    if isinstance(patch.get("inFlight"), list):
        status["inFlight"] = patch["inFlight"]
    if isinstance(patch.get("workflows"), list):
        status["workflows"] = patch["workflows"]

    if patch.get("event"):
        ev = status.setdefault("events", [])
        ev.insert(0, {"t": datetime.now(timezone.utc).strftime("%H:%M:%S"), "m": str(patch["event"])})
        status["events"] = ev[:40]

    status["updatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    with open(STATUS_PATH, "w") as f:
        json.dump(status, f, indent=2, ensure_ascii=False)

    ac = status.get("ac", {})
    print(
        f"[sync-status] written: ac={ac.get('pass')}P/{ac.get('fail')}F/{ac.get('unverified')}U "
        f"nodeStatus={len(node_status)} working={sorted(working)} "
        f"workLeft={len(status.get('workLeft') or [])} inFlight={len(status.get('inFlight') or [])}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
