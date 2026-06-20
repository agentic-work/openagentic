#!/usr/bin/env python3
# Auto-updates the LIVE fields of status.json from real state (git, k8s, builds, event log).
# Preserves curated fields (architecture, AC gates, workLeft, workflows).
# "Live work" feed: anything can append a line to events.ndjson (see dash-event.sh) and it
# shows up on the dashboard within one tick. The updater ALSO auto-emits events when it
# observes a new deploy / new commit / a build starting or finishing. Run on a loop.
import json, subprocess, time, os, glob, datetime, re
ROOT = "/home/trent/openagentic/agentic"
SJ   = os.path.join(ROOT, "live-dashboard/public/status.json")
EV   = os.path.join(ROOT, "live-dashboard/events.ndjson")

def sh(c):
    try: return subprocess.run(c, shell=True, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception: return ""

def now_hms(): return datetime.datetime.now().strftime("%H:%M:%S")
def now_iso(): return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def emit(msg):
    """Append one event to the append-only log (deduped against the last line)."""
    try:
        last = ""
        if os.path.exists(EV):
            with open(EV) as f:
                lines = f.readlines()
                if lines: last = json.loads(lines[-1]).get("m", "")
        if msg == last: return
        with open(EV, "a") as f:
            f.write(json.dumps({"t": now_hms(), "m": msg}) + "\n")
    except Exception: pass

def read_events(n=30):
    out = []
    try:
        with open(EV) as f:
            for l in f:
                l = l.strip()
                if l:
                    try: out.append(json.loads(l))
                    except Exception: pass
    except Exception: pass
    return out[-n:][::-1]  # newest first

def build_state():
    """Inspect /tmp/build-*.log to see if a service image build is in flight or just finished."""
    running, done = [], []
    for lg in glob.glob("/tmp/build-*.log"):
        try:
            tail = sh("tail -4 %s 2>/dev/null" % lg)
            name = os.path.basename(lg).replace("build-", "").replace(".log", "")
            if re.search(r"Build Complete|successfully|Pushed|digest:", tail, re.I): done.append(name)
            elif re.search(r"error|failed|RED", tail, re.I) and "harness" not in tail.lower(): pass
            else:
                # still being written to in the last ~3 min?
                age = sh("echo $(( $(date +%%s) - $(stat -c %%Y %s 2>/dev/null || echo 0) ))" % lg)
                try:
                    if int(age or "9999") < 180: running.append(name)
                except Exception: pass
        except Exception: pass
    return running, done

def update():
    try: s = json.load(open(SJ))
    except Exception: return

    # --- live deployed SHAs (ready pods only) ---
    jp = ("kubectl get pods -n openagentic-dev -o jsonpath="
          "'{range .items[*]}{.spec.containers[0].image}{\" \"}{.status.containerStatuses[0].ready}{\"\\n\"}{end}' 2>/dev/null")
    api = sh(jp + " | grep 'openagentic-api:' | grep ' true' | head -1 | sed 's#.*api:0.7.1-##;s# .*##'")
    ui  = sh(jp + " | grep 'openagentic-ui:'  | grep ' true' | head -1 | sed 's#.*ui:0.7.1-##;s# .*##'")
    prev_api = s.get("live", {}).get("api")
    if api:
        s.setdefault("live", {})["api"] = api
        if prev_api and prev_api != api:
            emit("api deployed + ready: %s" % api)
    if ui: s["live"]["ui"] = ui

    # --- recent commits (auto-emit on new HEAD) ---
    prev_head = (s.get("commits") or [{}])[0].get("sha")
    log = sh("cd %s && git log --oneline -6 --format='%%h|%%s' 2>/dev/null" % ROOT)
    if log:
        s["commits"] = [{"sha": l.split("|",1)[0], "title": l.split("|",1)[1][:70]}
                        for l in log.splitlines() if "|" in l]
        head = s["commits"][0]["sha"]
        if prev_head and prev_head != head:
            emit("committed %s — %s" % (head, s["commits"][0]["title"][:54]))

    # --- build state -> a transient workflow chip + events ---
    running, done = build_state()
    wf = [w for w in s.get("workflows", []) if not str(w.get("id","")).startswith("build:")]
    for name in running:
        wf.insert(0, {"id": "build:%s" % name, "name": "build %s" % name, "phase": "image build in flight", "status": "running"})
        emit("building image: %s" % name)
    for name in done:
        emit("build complete: %s" % name)
    s["workflows"] = wf

    # --- merge the append-only event feed ---
    s["events"] = read_events(30)
    s["updatedAt"] = now_iso()
    json.dump(s, open(SJ, "w"), indent=2)

if __name__ == "__main__":
    import sys
    if "--once" in sys.argv:
        update()
    else:
        emit("dashboard auto-updater online")
        while True:
            try: update()
            except Exception: pass
            time.sleep(15)
