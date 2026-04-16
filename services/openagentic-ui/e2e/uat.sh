# Proprietary and confidential. Unauthorized copying prohibited.

# UAT Interactive Driver wrapper
# Usage: ./e2e/uat.sh <command> [args...]
# Example: ./e2e/uat.sh login
#          ./e2e/uat.sh sendwait "List all Azure subscriptions"
#          ./e2e/uat.sh screenshot

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LD_LIBRARY_PATH="/home/trent/.local/lib/playwright-deps:${LD_LIBRARY_PATH:-}"
export HEADLESS="${HEADLESS:-true}"

exec npx tsx "$SCRIPT_DIR/e2e/interactive-driver.ts" "$@"
