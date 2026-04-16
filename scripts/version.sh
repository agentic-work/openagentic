# Proprietary and confidential. Unauthorized copying prohibited.

# =============================================================================
# OpenAgentic Version Management CLI
# =============================================================================
# Usage: ./scripts/version.sh <command>
# Commands: show, bump, tag, validate, image-tag
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION_FILE="$REPO_ROOT/version.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# =============================================================================
# Helpers
# =============================================================================
get_version() {
  grep '"version"' "$VERSION_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/'
}

get_codename() {
  grep '"codename"' "$VERSION_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/'
}

get_git_sha() {
  git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown"
}

get_git_sha_full() {
  git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown"
}

get_git_branch() {
  git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
}

is_dirty() {
  [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]
}

# All package.json files that should track the platform version
PACKAGE_FILES=(
  "services/openagentic-api/package.json"
  "services/openagentic-ui/package.json"
  "services/openagentic-manager/package.json"
  "services/openagentic-exec/package.json"
)

# =============================================================================
# Commands
# =============================================================================

cmd_show() {
  local version codename sha branch dirty_flag
  version=$(get_version)
  codename=$(get_codename)
  sha=$(get_git_sha)
  branch=$(get_git_branch)
  dirty_flag=""
  if is_dirty; then dirty_flag=" ${YELLOW}(dirty)${NC}"; fi

  echo -e "${GREEN}OpenAgentic Platform${NC}"
  echo -e "  Version:  ${CYAN}${version}${NC} (${codename})"
  echo -e "  Commit:   ${CYAN}${sha}${NC}${dirty_flag}"
  echo -e "  Branch:   ${CYAN}${branch}${NC}"
  echo -e "  Tag:      ${CYAN}${version}-${sha}${NC}"
}

cmd_bump() {
  local part="$1"
  if [[ ! "$part" =~ ^(patch|minor|major)$ ]]; then
    echo -e "${RED}Usage: version.sh bump <patch|minor|major>${NC}"
    exit 1
  fi

  local current
  current=$(get_version)
  IFS='.' read -r major minor patch <<< "$current"

  case "$part" in
    major) major=$((major + 1)); minor=0; patch=0 ;;
    minor) minor=$((minor + 1)); patch=0 ;;
    patch) patch=$((patch + 1)) ;;
  esac

  local new_version="${major}.${minor}.${patch}"
  echo -e "Bumping version: ${CYAN}${current}${NC} -> ${GREEN}${new_version}${NC}"

  # Update version.json (top-level version and platform component)
  sed -i "0,/\"version\": \"${current}\"/s//\"version\": \"${new_version}\"/" "$VERSION_FILE"

  # Update all package.json files
  local updated=0
  for pkg in "${PACKAGE_FILES[@]}"; do
    local full_path="$REPO_ROOT/$pkg"
    if [ -f "$full_path" ]; then
      # Update the top-level "version" field only (first occurrence)
      sed -i "0,/\"version\": \"[^\"]*\"/s//\"version\": \"${new_version}\"/" "$full_path"
      updated=$((updated + 1))
    fi
  done

  echo -e "${GREEN}Updated version.json + ${updated} package.json files to ${new_version}${NC}"
}

cmd_tag() {
  local version
  version=$(get_version)
  local tag="v${version}"

  if is_dirty; then
    echo -e "${RED}Error: Working tree is dirty. Commit or stash changes before tagging.${NC}"
    exit 1
  fi

  if git -C "$REPO_ROOT" tag -l "$tag" | grep -q "$tag"; then
    echo -e "${RED}Error: Tag ${tag} already exists.${NC}"
    echo -e "  Use 'git tag -d ${tag}' to delete it first, or bump the version."
    exit 1
  fi

  local sha
  sha=$(get_git_sha_full)
  local codename
  codename=$(get_codename)

  git -C "$REPO_ROOT" tag -a "$tag" -m "Release ${version} (${codename}) at ${sha}"
  echo -e "${GREEN}Created annotated tag: ${tag}${NC}"
  echo -e "  Push with: git push origin ${tag}"
}

cmd_validate() {
  local version
  version=$(get_version)
  local mismatches=0

  echo -e "Platform version: ${CYAN}${version}${NC}"
  echo ""

  for pkg in "${PACKAGE_FILES[@]}"; do
    local full_path="$REPO_ROOT/$pkg"
    if [ ! -f "$full_path" ]; then
      echo -e "  ${YELLOW}SKIP${NC} $pkg (file not found)"
      continue
    fi

    local pkg_version
    pkg_version=$(grep '"version"' "$full_path" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')

    if [ "$pkg_version" = "$version" ]; then
      echo -e "  ${GREEN}OK${NC}   $pkg ($pkg_version)"
    else
      echo -e "  ${RED}MISMATCH${NC} $pkg ($pkg_version != $version)"
      mismatches=$((mismatches + 1))
    fi
  done

  echo ""
  if [ $mismatches -eq 0 ]; then
    echo -e "${GREEN}All versions match.${NC}"
  else
    echo -e "${RED}${mismatches} version mismatch(es) found.${NC}"
    echo -e "  Run './scripts/version.sh bump patch' to sync, or fix manually."
    exit 1
  fi
}

cmd_image_tag() {
  local version sha
  version=$(get_version)
  sha=$(get_git_sha)
  echo "${version}-${sha}"
}

# =============================================================================
# Main
# =============================================================================
show_help() {
  echo "Usage: $0 <command> [args]"
  echo ""
  echo "Commands:"
  echo "  show                    Print current version, codename, git sha"
  echo "  bump <patch|minor|major> Bump version in version.json + all package.json"
  echo "  tag                     Create annotated git tag (refuses dirty tree)"
  echo "  validate                Verify all package.json versions match version.json"
  echo "  image-tag               Output immutable tag string: {version}-{sha}"
  echo ""
}

case "${1:-}" in
  show)      cmd_show ;;
  bump)      cmd_bump "${2:-}" ;;
  tag)       cmd_tag ;;
  validate)  cmd_validate ;;
  image-tag) cmd_image_tag ;;
  -h|--help) show_help ;;
  *)         show_help; exit 1 ;;
esac
