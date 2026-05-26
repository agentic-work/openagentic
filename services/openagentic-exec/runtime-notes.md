# Openagentic Runtime Notes

Hard-earned operational knowledge for sessions running inside the
`openagentic-exec` pod. The image is built with this file at
`/etc/openagentic/runtime-notes.md` and the entrypoint exports
`OPENAGENTIC_RUNTIME_NOTES` so a future system-prompt hook can append
this content as context for the agent — saving every fresh session
the cost of rediscovering the same gotchas.

## Workspace filesystem (geesefs / MinIO-CSI)

The per-user `/workspaces/<userId>` mount is a **CSI-S3** filesystem
(geesefs over MinIO). It looks like a regular POSIX directory but has
two surprises:

1. **Execute bits are stripped on writes.** Anything you `chmod +x` or
   any binary downloaded into this filesystem comes out without the
   execute bit set. This breaks:
   - npm `postinstall` for native binaries (esbuild, sharp, swc, etc.)
   - Python venv binaries (`./venv/bin/python`, `./venv/bin/uvicorn`)
   - Anything else that relies on `+x` being honoured.
2. **Some unusual error codes** (`-116 Unknown system error`) on
   recursive operations. Treat those as transient — retrying or
   working in `/tmp` is the fix.

### npm workflows: use `/usr/local/bin/npm-fast`

```bash
cd /workspaces/<userId>/myapp
/usr/local/bin/npm-fast install astro@5
/usr/local/bin/npm-fast install
```

`npm-fast` symlinks `./node_modules` → `/tmp/npm-staging/<projectHash>/`
before invoking npm, so all writes land on `/tmp` (real ext4, exec bits
stick). Subsequent `npm run dev` / `node node_modules/...` resolves
through the symlink and finds executable binaries.

### Python venv workflows: use `/usr/local/bin/venv-fast`

```bash
cd /workspaces/<userId>/myapp/backend
/usr/local/bin/venv-fast create venv
./venv/bin/pip install fastapi uvicorn
./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
```

Same trick: `./venv` becomes a symlink to
`/tmp/venv-staging/<projectHash>/venv` so `bin/python`, `bin/pip`,
`bin/uvicorn` all keep their `+x` bit. Without this, `./venv/bin/uvicorn`
fails with `Permission denied` even though it exists.

### Last-resort escape hatch

If a tool can't be wrapped, just install in `/tmp` directly:

```bash
mkdir -p /tmp/myapp && cp -r /workspaces/<userId>/myapp/* /tmp/myapp/
cd /tmp/myapp && npm install
```

The downside is that the user's source-of-truth files diverge from
their /workspaces copy until you rsync back.

## Node version: 20.20.x

The pod ships **Node 20**. Some npm packages now require Node 22+
(`astro@6`, recent `vite`, recent `@astrojs/*`). When that happens:

- Pin to a Node-20-compatible major: `astro@5`, `vite@5`, etc.
- Or ask the user before bumping the pod's Node — base-image change
  is a release-level operation, not a runtime fix.

## Long-running dev servers

To run a dev server (Vite, Astro, FastAPI/uvicorn) and have the
inline preview surface it, use **nohup + background + redirect** so
the agent's Bash tool can return immediately:

```bash
cd /tmp/myapp && nohup npm run dev -- --host 0.0.0.0 > /tmp/dev.log 2>&1 < /dev/null &
```

The daemon's port-rescanner (every 30s) will detect the new
listener on `/proc/net/tcp` and announce it to the api proxy with
the pod's IP, so `https://chat-dev.openagentic.io/api/code/preview/<sid>/<port>/`
becomes reachable without any extra wiring.

## Common port conflicts

If `Address already in use` on port 8000 or 4322, the previous
process is probably still running:

```bash
ps -ef | grep -E "uvicorn|astro|http\.server" | grep -v grep
```

Kill by PID. Don't try `fuser` — it's not in the image.
