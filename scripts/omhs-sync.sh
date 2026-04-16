# Proprietary and confidential. Unauthorized copying prohibited.

# =============================================================================
# omhs-sync.sh — sync agentic SOT into OMHS develop branch
# =============================================================================
#
# This script copies services/ + helm/ from the agentic source-of-truth repo
# into the openagentic-omhs downstream repo. It is designed to be safe and
# idempotent: it will NEVER touch downstream-only files (env overlays, CI
# workflows, OMHS-specific values files).
#
# DESIGN:
#   - Allow-list of paths to sync (NOT blacklist) — anything not on the list
#     stays untouched in OMHS.
#   - Dry-run by default. Pass --apply to actually write changes.
#   - Always reports a diff summary before applying.
#   - After --apply, leaves OMHS with uncommitted changes — you review,
#     commit, and push from the OMHS dir manually.
#
# USAGE:
#   ./scripts/omhs-sync.sh                  # dry run, show what would change
#   ./scripts/omhs-sync.sh --apply          # actually copy + delete
#   ./scripts/omhs-sync.sh --apply --commit # also auto-commit (use carefully)
#
# DEFAULT PATHS:
#   SOURCE: /mnt/synology/Code/company/openagentic/agentic
#   TARGET: /mnt/synology/Code/company/cdc/openagentic/openagentic-omhs
#
# =============================================================================

set -euo pipefail

# Defaults
SRC_REPO="${SRC_REPO:-/mnt/synology/Code/company/openagentic/agentic}"
DST_REPO="${DST_REPO:-/mnt/synology/Code/company/cdc/openagentic/openagentic-omhs}"
APPLY=false
AUTO_COMMIT=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply) APPLY=true; shift ;;
        --commit) AUTO_COMMIT=true; shift ;;
        --src) SRC_REPO="$2"; shift 2 ;;
        --dst) DST_REPO="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,32p' "$0" | sed 's/^# //;s/^#$//'
            exit 0
            ;;
        *) echo -e "${RED}unknown option: $1${NC}"; exit 1 ;;
    esac
done

# =============================================================================
# Pre-flight checks
# =============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  OMHS Sync${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Source: ${CYAN}$SRC_REPO${NC}"
echo -e "Target: ${CYAN}$DST_REPO${NC}"
echo -e "Mode:   ${CYAN}$([ "$APPLY" = true ] && echo APPLY || echo DRY-RUN)${NC}"
if [ "$AUTO_COMMIT" = true ]; then
    echo -e "Commit: ${CYAN}auto${NC}"
fi
echo ""

if [ ! -d "$SRC_REPO/.git" ]; then
    echo -e "${RED}ERROR: source is not a git repo: $SRC_REPO${NC}"
    exit 1
fi
if [ ! -d "$DST_REPO/.git" ]; then
    echo -e "${RED}ERROR: target is not a git repo: $DST_REPO${NC}"
    exit 1
fi

# Source must be clean (otherwise we'd be syncing in-flight work)
SRC_DIRTY=$(cd "$SRC_REPO" && git status --porcelain | wc -l)
if [ "$SRC_DIRTY" -gt 0 ]; then
    echo -e "${YELLOW}WARNING: source has $SRC_DIRTY uncommitted file(s)${NC}"
    echo -e "${YELLOW}  Sync will pick up those changes too. Commit first if you want a clean SOT.${NC}"
    echo ""
fi

# Target should be on develop branch
DST_BRANCH=$(cd "$DST_REPO" && git rev-parse --abbrev-ref HEAD)
if [ "$DST_BRANCH" != "develop" ]; then
    echo -e "${YELLOW}WARNING: target is on branch '$DST_BRANCH', expected 'develop'${NC}"
    echo -e "${YELLOW}  Switch with: cd $DST_REPO && git checkout develop${NC}"
    if [ "$APPLY" = true ]; then
        read -p "  Continue anyway? [y/N] " confirm
        if [[ ! "$confirm" =~ ^[Yy] ]]; then
            echo "aborted"
            exit 1
        fi
    fi
    echo ""
fi

SRC_SHA=$(cd "$SRC_REPO" && git rev-parse --short HEAD)
echo -e "Source commit: ${CYAN}$SRC_SHA${NC} ($(cd "$SRC_REPO" && git log -1 --format=%s))"
echo ""

# =============================================================================
# Sync paths (allow-list)
# =============================================================================
# Each entry is: SUBPATH (relative to repo root). Both directories and files.
# These are mirrored from $SRC_REPO/$path → $DST_REPO/$path.
SYNC_PATHS=(
    # Application code — full mirror
    "services"

    # Version metadata — single source of truth
    "version.json"

    # NOTE (2026-04-11): helm/openagentic is NO LONGER SYNCED from upstream
    # into omhs. The chart SoT moved to the dedicated
    # agentic-work/openagentic-helm repo. Upstream agentic still keeps
    # helm/openagentic as a legacy copy for local k3s devloop, but omhs
    # now references the external chart by pinned tag from its multi-source
    # ArgoCD Application manifests (gitops/argocd/applications/*.yaml).
    # See omhs docs/gitops/GITOPS.md for the architecture.
)

# Files/dirs to delete in target if they exist (legacy / replaced upstream)
#
# scripts/: OMHS builds via az acr build + GH Actions — it has no use for
# the upstream developer build scripts (hotdeploy, deploy-aks, etc.) and
# several of them carried hardcoded credentials. Purge any leftover scripts/
# dir on every sync.
DELETE_PATHS=(
    "services/openagentic-proxy/src/skills/cloud-operations.ts"
    "services/openagentic-ui/src/features/code/components/CLIBashDisplay.tsx"
    "services/openagentic-ui/src/features/code/components/CLIDiffDisplay.tsx"
    "services/openagentic-ui/src/features/code/components/InlineToolBlock.tsx"
    "scripts"
)

# Rsync exclude patterns — never copy these (and never delete when --delete'ing)
# NOTE: paths are matched against each rsync SRC_PATH's own root. For the
# templates/ rsync, anchored paths like external-secrets/* target files inside
# helm/openagentic/templates/.
RSYNC_EXCLUDES=(
    "--exclude=node_modules/"
    "--exclude=dist/"
    "--exclude=build/"
    "--exclude=.next/"
    "--exclude=coverage/"
    "--exclude=.turbo/"
    "--exclude=.vite/"
    "--exclude=.cache/"
    "--exclude=*.log"
    "--exclude=tmp/"
    "--exclude=.DS_Store"
    "--exclude=Thumbs.db"
    "--exclude=@eaDir"
    # CDC-specific helm templates — upstream doesn't have these and the
    # downstream flow needs Vault + ESO per env. Without these excludes, rsync
    # --delete nukes CDC's Vault/ESO templates every sync.
    "--exclude=external-secrets/vault-*.yaml"
    "--exclude=external-secrets/external-secret.yaml"
    "--exclude=code-manager/code-manager-secrets.yaml"
    "--exclude=tls-secret.yaml"
)

# =============================================================================
# Diff phase
# =============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Computing diff${NC}"
echo -e "${BLUE}========================================${NC}"

CHANGED_COUNT=0
NEW_COUNT=0
DELETED_COUNT=0

for path in "${SYNC_PATHS[@]}"; do
    SRC_PATH="$SRC_REPO/$path"
    DST_PATH="$DST_REPO/$path"
    if [ ! -e "$SRC_PATH" ]; then
        echo -e "  ${YELLOW}skip${NC}  $path (not in source)"
        continue
    fi
    # Use rsync --dry-run to get a delta count
    DELTA=$(rsync -rcni --delete "${RSYNC_EXCLUDES[@]}" "$SRC_PATH/" "$DST_PATH/" 2>/dev/null | grep -v '^\.f\.\.\.\.\.\.\.\.\.' | wc -l 2>/dev/null || echo 0)
    if [ -d "$SRC_PATH" ]; then
        # Directory: count items that differ
        if [ ! -d "$DST_PATH" ]; then
            NEW_COUNT=$((NEW_COUNT + 1))
            echo -e "  ${GREEN}NEW DIR${NC}  $path"
        elif [ "$DELTA" -gt 0 ]; then
            CHANGED_COUNT=$((CHANGED_COUNT + DELTA))
            echo -e "  ${YELLOW}~$DELTA${NC}  $path"
        else
            echo -e "  ${GREEN}=${NC}  $path  (in sync)"
        fi
    else
        # Single file
        if [ ! -e "$DST_PATH" ]; then
            NEW_COUNT=$((NEW_COUNT + 1))
            echo -e "  ${GREEN}NEW FILE${NC}  $path"
        elif ! cmp -s "$SRC_PATH" "$DST_PATH"; then
            CHANGED_COUNT=$((CHANGED_COUNT + 1))
            echo -e "  ${YELLOW}~1${NC}  $path  (modified)"
        else
            echo -e "  ${GREEN}=${NC}  $path  (in sync)"
        fi
    fi
done

echo ""
echo -e "${BLUE}Files to delete (legacy):${NC}"
for path in "${DELETE_PATHS[@]}"; do
    DST_PATH="$DST_REPO/$path"
    if [ -e "$DST_PATH" ]; then
        DELETED_COUNT=$((DELETED_COUNT + 1))
        echo -e "  ${RED}DEL${NC}  $path"
    else
        echo -e "  ${GREEN}=${NC}  $path  (already absent)"
    fi
done

echo ""
echo -e "${CYAN}Summary: ${YELLOW}$CHANGED_COUNT changed${CYAN}, ${GREEN}$NEW_COUNT new${CYAN}, ${RED}$DELETED_COUNT to delete${NC}"
echo ""

if [ "$APPLY" != true ]; then
    echo -e "${CYAN}Dry run complete. Re-run with --apply to actually sync.${NC}"
    exit 0
fi

# =============================================================================
# Apply phase
# =============================================================================
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Applying sync${NC}"
echo -e "${BLUE}========================================${NC}"

for path in "${SYNC_PATHS[@]}"; do
    SRC_PATH="$SRC_REPO/$path"
    DST_PATH="$DST_REPO/$path"
    if [ ! -e "$SRC_PATH" ]; then
        continue
    fi
    if [ -d "$SRC_PATH" ]; then
        mkdir -p "$DST_PATH"
        rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$SRC_PATH/" "$DST_PATH/"
        echo -e "  ${GREEN}✓${NC}  $path/"
    else
        mkdir -p "$(dirname "$DST_PATH")"
        cp "$SRC_PATH" "$DST_PATH"
        echo -e "  ${GREEN}✓${NC}  $path"
    fi
done

echo ""
echo -e "${BLUE}Deleting legacy paths:${NC}"
for path in "${DELETE_PATHS[@]}"; do
    DST_PATH="$DST_REPO/$path"
    if [ -d "$DST_PATH" ]; then
        rm -rf "$DST_PATH"
        echo -e "  ${RED}✗${NC}  $path/"
    elif [ -e "$DST_PATH" ]; then
        rm -f "$DST_PATH"
        echo -e "  ${RED}✗${NC}  $path"
    fi
done

echo ""
echo -e "${GREEN}Sync applied successfully${NC}"

# =============================================================================
# Post-sync OMHS reminders
# =============================================================================
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  OMHS post-sync notes${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${YELLOW}1.${NC} OMHS values-aks-*.yaml files were NOT touched (env overlays)."
echo -e "${YELLOW}2.${NC} If your env needs oap-azure-mcp in stdio mode (no standalone container),"
echo -e "   add this to values-aks-*.yaml:"
echo -e "     ${CYAN}mcpProxy:${NC}"
echo -e "     ${CYAN}  env:${NC}"
echo -e "     ${CYAN}    OpenAgentic_AZURE_MCP_REMOTE: \"false\"${NC}"
echo -e "${YELLOW}3.${NC} If OMHS docker builds use the git-mode install path, the PAT secret"
echo -e "   must be added to GitHub Actions as ${CYAN}AGENTIC_GH_PAT${NC} and the workflow"
echo -e "   must pass it via ${CYAN}--secret id=gh_pat,env=GH_PAT${NC} to docker buildx."
echo ""

if [ "$AUTO_COMMIT" = true ]; then
    echo -e "${BLUE}Auto-committing to OMHS develop...${NC}"
    cd "$DST_REPO"
    git add -A
    git commit -m "sync: $SRC_SHA from agentic main

Synced from $SRC_REPO @ $SRC_SHA via scripts/omhs-sync.sh.
$CHANGED_COUNT changed, $NEW_COUNT new, $DELETED_COUNT deleted.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
    echo ""
    echo -e "${GREEN}Committed. Push with: cd $DST_REPO && git push origin develop${NC}"
else
    echo -e "${CYAN}Review changes in $DST_REPO and commit when ready:${NC}"
    echo -e "  cd $DST_REPO"
    echo -e "  git status"
    echo -e "  git diff"
    echo -e "  git add -A && git commit -m 'sync: $SRC_SHA from agentic main'"
    echo -e "  git push origin develop"
fi
