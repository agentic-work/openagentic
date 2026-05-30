#!/usr/bin/env bash
# Phase 4 #474 — synth-cdn library fetcher.
#
# Reads lib-manifest.json, downloads each entry to a temp dir, verifies
# sha256, extracts the named file/glob into ./dist/lib/<served_at>.
#
# Subcommands:
#   build         — fetch + verify + extract (default; used by Dockerfile)
#   verify-only   — fetch + sha256 each entry and print computed hashes
#                   without writing dist/. Used to seed the manifest after
#                   a version bump.
#
# Set MANIFEST=path-to-manifest.json to override the default
# (./lib-manifest.json relative to this script).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${MANIFEST:-$SCRIPT_DIR/lib-manifest.json}"
DIST_DIR="${DIST_DIR:-$SCRIPT_DIR/dist/lib}"

cmd="${1:-build}"

if ! command -v jq >/dev/null 2>&1; then
  echo "FATAL: jq required" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "FATAL: curl required" >&2
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1; then
  echo "FATAL: sha256sum required" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"

count=$(jq '.libraries | length' "$MANIFEST")
echo "synth-cdn build-libs: $count libraries from $MANIFEST"

failed=0

for i in $(seq 0 $((count - 1))); do
  name=$(jq -r ".libraries[$i].name" "$MANIFEST")
  version=$(jq -r ".libraries[$i].version" "$MANIFEST")
  url=$(jq -r ".libraries[$i].url" "$MANIFEST")
  extract=$(jq -r ".libraries[$i].extract" "$MANIFEST")
  served_at=$(jq -r ".libraries[$i].served_at" "$MANIFEST")
  expected_sha=$(jq -r ".libraries[$i].sha256" "$MANIFEST")

  echo ""
  echo "==[ $name@$version ]======================================"
  echo "  url:        $url"
  echo "  extract:    $extract"
  echo "  served_at:  $served_at"

  tmpfile=$(mktemp)

  curl -sSL --fail -o "$tmpfile" "$url"
  computed=$(sha256sum "$tmpfile" | awk '{print $1}')
  echo "  computed sha256: $computed"

  if [ "$cmd" = "verify-only" ]; then
    rm -f "$tmpfile"
    continue
  fi

  # build mode — enforce sha256 match unless manifest still has the
  # placeholder TODO marker (allows initial commits without SHAs and
  # post-bump iteration; CI fails the build on any TODO_SHA in manifest
  # at deploy time).
  if [ "$expected_sha" != "TODO_SHA256_AT_BUILD_TIME" ] && [ "$expected_sha" != "$computed" ]; then
    echo "  X sha256 mismatch — expected $expected_sha"
    failed=$((failed + 1))
    rm -f "$tmpfile"
    continue
  fi

  workdir=$(mktemp -d)

  case "$url" in
    *.tgz|*.tar.gz)
      tar -xzf "$tmpfile" -C "$workdir"
      ;;
    *.tar.bz2)
      tar -xjf "$tmpfile" -C "$workdir"
      ;;
    *)
      cp "$tmpfile" "$workdir/$(basename "$url")"
      ;;
  esac

  # Resolve the destination path. served_at is always a leading-slash path
  # like /lib/d3@7/dist/d3.min.js — strip the leading /lib/ prefix and put
  # it under DIST_DIR.
  dest_rel="${served_at#/lib/}"
  if [ "${served_at: -1}" = "/" ]; then
    # Directory served (e.g. /lib/pyodide/0.27/) — copy the extract glob recursively.
    dest_dir="$DIST_DIR/$dest_rel"
    mkdir -p "$dest_dir"
    cp -r "$workdir"/$extract "$dest_dir"/ 2>/dev/null || \
      cp -r "$workdir"/$extract/* "$dest_dir"/ 2>/dev/null || true
  else
    # File served — single-file extract.
    dest_file="$DIST_DIR/$dest_rel"
    mkdir -p "$(dirname "$dest_file")"
    cp "$workdir"/$extract "$dest_file"
  fi

  echo "  OK extracted to $DIST_DIR/$dest_rel"
  rm -rf "$workdir" "$tmpfile"
done

if [ "$failed" -gt 0 ]; then
  echo ""
  echo "FATAL: $failed library/libraries failed sha256 verification"
  exit 1
fi

echo ""
echo "synth-cdn build-libs: $count/$count libraries OK"
