# Install recordings

Terminal recording of the OpenAgentic install path, captured with
[VHS](https://github.com/charmbracelet/vhs) against a live stack.

| Path | Tape | Output |
|---|---|---|
| Docker Compose (5-minute path) | [`install-compose.tape`](./install-compose.tape) | `install-compose.gif` / `.mp4` |

The compose recording shows `install.sh --help`, `docker compose --profile milvus
up -d`, and the live `/api/health`.

## Re-render

```bash
cd docs/launch/recordings
vhs install-compose.tape    # needs a running compose stack for the live curl
```

Notes:
- VHS v0.10.0's `Output` directive only accepts **relative** paths — keep outputs
  in this directory.
- Each tape `cd`s to the repo root off-camera (`Hide`/`Show`) so `./install.sh`
  resolves.
- The `.mp4` files are the source of truth; the `.gif`s are for inline embedding.
