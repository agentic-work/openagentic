

###############################################################################
# k6 Load Test Runner for OpenAgentic
#
# Usage: ./run-k6.sh [smoke|load|stress] [--key YOUR_API_KEY]
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
K6="${K6_BIN:-$HOME/bin/k6}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Defaults
BASE_URL="${BASE_URL:-http://localhost:8080}"
API_KEY="${API_KEY:-}"
SCENARIO="${1:-smoke}"
RESULTS_DIR="${SCRIPT_DIR}/results"

# Parse args
shift 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case $1 in
    --key) API_KEY="$2"; shift 2 ;;
    --url) BASE_URL="$2"; shift 2 ;;
    --help)
      echo "Usage: $0 [smoke|load|stress] [--key API_KEY] [--url BASE_URL]"
      echo ""
      echo "Scenarios:"
      echo "  smoke   1 VU, 1 min  - Quick health check"
      echo "  load    10 VUs, 7 min - Realistic concurrent load"
      echo "  stress  50 VUs, 12 min - Find breaking points"
      exit 0
      ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

# Validate
if [ -z "$API_KEY" ]; then
  echo -e "${RED}Error: API_KEY required. Use --key or export API_KEY${NC}"
  echo "  Example: $0 smoke --key awc_your_key_here"
  exit 1
fi

if ! command -v "$K6" &>/dev/null; then
  echo -e "${RED}Error: k6 not found at $K6${NC}"
  echo "  Install: curl -sL https://github.com/grafana/k6/releases/download/v0.54.0/k6-v0.54.0-linux-amd64.tar.gz | tar xz && mv k6-*/k6 ~/bin/"
  exit 1
fi

SCENARIO_FILE="${SCRIPT_DIR}/scenarios/${SCENARIO}.js"
if [ ! -f "$SCENARIO_FILE" ]; then
  echo -e "${RED}Error: Scenario file not found: ${SCENARIO_FILE}${NC}"
  echo "  Available: smoke, load, stress"
  exit 1
fi

mkdir -p "$RESULTS_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SUMMARY_FILE="${RESULTS_DIR}/${SCENARIO}_${TIMESTAMP}.json"

echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  k6 Load Test: ${SCENARIO}${NC}"
echo -e "${CYAN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║  Target:  ${BASE_URL}${NC}"
echo -e "${CYAN}║  Key:     ${API_KEY:0:20}...${NC}"
echo -e "${CYAN}║  Output:  ${SUMMARY_FILE}${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Pre-flight
echo -e "${YELLOW}Pre-flight check...${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "${BASE_URL}/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}  API healthy (${HTTP_CODE})${NC}"
else
  echo -e "${RED}  API returned ${HTTP_CODE} - test may fail${NC}"
fi

AUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 -H "Authorization: Bearer ${API_KEY}" "${BASE_URL}/api/chat/sessions" 2>/dev/null || echo "000")
if [ "$AUTH_CODE" = "200" ]; then
  echo -e "${GREEN}  Auth valid (${AUTH_CODE})${NC}"
else
  echo -e "${RED}  Auth failed (${AUTH_CODE}) - check API key${NC}"
  exit 1
fi

echo ""

# Run k6
"$K6" run \
  --env BASE_URL="${BASE_URL}" \
  --env API_KEY="${API_KEY}" \
  --summary-export="${SUMMARY_FILE}" \
  "${SCENARIO_FILE}"

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}Test PASSED${NC}"
else
  echo -e "${RED}Test FAILED (thresholds breached)${NC}"
fi

echo -e "Results: ${SUMMARY_FILE}"
exit $EXIT_CODE
