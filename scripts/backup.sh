# Proprietary and confidential. Unauthorized copying prohibited.

# =============================================================================
# OpenAgentic Backup Script
# =============================================================================
# Creates a timestamped tar.gz backup of the repository
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

BACKUP_DIR="/mnt/synology/Backups/agentic"

# Read version info
VERSION_FILE="$REPO_ROOT/version.json"
if [ -f "$VERSION_FILE" ]; then
  VERSION=$(grep '"version"' "$VERSION_FILE" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
else
  VERSION="unknown"
fi
SHA=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE=$(date +"%Y%m%d_%H%M%S")

FILENAME="agentic_${DATE}_v${VERSION}_${SHA}.tar.gz"
FULL_PATH="${BACKUP_DIR}/${FILENAME}"

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

echo -e "${CYAN}Creating backup...${NC}"
echo -e "  Source:  $REPO_ROOT"
echo -e "  Target:  $FULL_PATH"
echo -e "  Version: v${VERSION} (${SHA})"

tar -czf "$FULL_PATH" \
  -C "$(dirname "$REPO_ROOT")" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='build' \
  --exclude='__pycache__' \
  --exclude='@eaDir' \
  --exclude='.vite' \
  --exclude='.cache' \
  "$(basename "$REPO_ROOT")"

SIZE=$(du -sh "$FULL_PATH" | cut -f1)
echo -e "${GREEN}Backup complete: ${FILENAME} (${SIZE})${NC}"
