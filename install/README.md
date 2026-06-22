# install/ — release trust anchor

This directory holds the **integrity trust anchor** for the `curl … | bash`
installer (`install.sh`).

## What lives here

| File | Purpose |
|---|---|
| `openagentic-compose.tgz.sha256` | The sha256 of the **published** compose bundle (`openagentic-compose.tgz`). This is the trust anchor `install.sh` verifies against. |

## Why this exists (the threat model)

`install.sh` downloads the pull-only compose bundle from the dist host
(`https://install.openagentics.io/openagentic-compose.tgz` by default — the
`OPENAGENTIC_DIST_BASE` host). That host is a **separate trust anchor outside
the public GitHub repo**: a compromise of `install.openagentics.io` or its DNS
would otherwise own every install, because the bundle used to be piped straight
into `tar` with no integrity check.

The installer now **fails closed**: it downloads the bundle to a temp file,
fetches the **expected** sha256 from *this* file in the public GitHub repo
(`https://raw.githubusercontent.com/agentic-work/openagentic/main/install/openagentic-compose.tgz.sha256`),
recomputes the actual sha256 locally, and **refuses to extract** unless they
match. Because the checksum is served from GitHub — a *different* host and DNS
owner than the download server — a compromise of the download host alone cannot
forge a bundle that passes verification.

That property only holds if **this checksum is correct and committed**.

## Release process — REQUIRED every time the bundle is rebuilt

Whenever you rebuild/republish `openagentic-compose.tgz`, you MUST regenerate
and commit the matching checksum here, in the same release:

```bash
# from the repo root, after building the bundle that will be published as
# openagentic-compose.tgz on the dist host:
#
#   Linux:
sha256sum  openagentic-compose.tgz | awk '{print $1}' > install/openagentic-compose.tgz.sha256
#   macOS:
shasum -a 256 openagentic-compose.tgz | awk '{print $1}' > install/openagentic-compose.tgz.sha256

git add install/openagentic-compose.tgz.sha256
git commit -m "release: refresh compose-bundle sha256 anchor"
```

The committed file is just the bare 64-char hex digest (one line). `install.sh`
reads only the first whitespace-delimited field, so a `sha256sum`-style
`<hash>  <filename>` line also works — but keep it to the bare digest for
clarity.

**If you publish a new bundle but forget to update this checksum, every fresh
install will fail closed with a checksum mismatch.** That is by design — a stale
or missing anchor must block the install rather than silently trust an
unverified download.

## Overriding the anchor (mirrors / air-gap)

`install.sh` reads `OPENAGENTIC_BUNDLE_SHA_URL` to point at a different checksum
source (defaults to the GitHub `raw` URL above). A mirror or air-gapped install
that ships its own bundle should publish its own `.sha256` and set this env var
so the fail-closed verification still applies.
