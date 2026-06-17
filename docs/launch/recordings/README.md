# Install recordings

Terminal recordings of the two OpenAgentic install paths, captured with
[VHS](https://github.com/charmbracelet/vhs) against a live stack.

| Path | Tape | Output |
|---|---|---|
| Docker Compose (5-minute path) | [`install-compose.tape`](./install-compose.tape) | `install-compose.gif` / `.mp4` |
| Kubernetes / Helm | [`install-helm.tape`](./install-helm.tape) | `install-helm.gif` / `.mp4` |

The compose recording shows `install.sh --help`, `docker compose --profile milvus
up -d`, and the live `/api/health`. The helm recording shows
`helm upgrade --install`, the running pods (Harbor images), the
`open.agenticwork.io` nginx Ingress, and the live health check over the public
HTTPS hostname (served by the `*.agenticwork.io` wildcard cert).

## Re-render

```bash
cd docs/launch/recordings
vhs install-compose.tape    # needs a running compose stack for the live curl
vhs install-helm.tape       # needs the helm release up for the live kubectl/curl
```

Notes:
- VHS v0.10.0's `Output` directive only accepts **relative** paths — keep outputs
  in this directory.
- Each tape `cd`s to the repo root off-camera (`Hide`/`Show`) so `./install.sh`
  and `./helm/...` resolve.
- The `.mp4` files are the source of truth; the `.gif`s are for inline embedding.
