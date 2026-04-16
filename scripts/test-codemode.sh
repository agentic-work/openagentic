# Proprietary and confidential. Unauthorized copying prohibited.

# =============================================================================
# Code Mode Test Harness Runner
# =============================================================================
#
# Usage:
#   ./scripts/test-codemode.sh                    # Run all tests
#   ./scripts/test-codemode.sh --verbose          # Verbose output
#   ./scripts/test-codemode.sh --quick            # Quick smoke test only
#
# Environment variables:
#   BASE_URL          - Target URL (default: https://chat-dev.openagentic.io)
#   TEST_USER_EMAIL   - Test user email (default: codemode-test-1@openagentic.io)
#   TEST_USER_PASSWORD - Test user password (default: TestPass123!)
#   VERBOSE           - Enable verbose output (true/false)
#   TEST_TIMEOUT      - Test timeout in ms (default: 30000)
#
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
QUICK_MODE=false
VERBOSE=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --quick)
      QUICK_MODE=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Configuration
export BASE_URL="${BASE_URL:-https://chat-dev.openagentic.io}"
export TEST_USER_EMAIL="${TEST_USER_EMAIL:-codemode-test-1@openagentic.io}"
export TEST_USER_PASSWORD="${TEST_USER_PASSWORD:-TestPass123!}"
export VERBOSE="${VERBOSE}"
export TEST_TIMEOUT="${TEST_TIMEOUT:-30000}"

echo "=============================================="
echo "       CODE MODE SESSION TEST HARNESS"
echo "=============================================="
echo ""
echo "Target URL: $BASE_URL"
echo "Test User: $TEST_USER_EMAIL"
echo "Verbose: $VERBOSE"
echo "Quick Mode: $QUICK_MODE"
echo ""

# Change to API service directory
cd "$(dirname "$0")/../services/openagentic-api"

if [ "$QUICK_MODE" = true ]; then
  echo -e "${YELLOW}Running quick smoke test...${NC}"
  echo ""

  # Quick test - just authentication and basic provision
  echo "Step 1: Authenticating..."
  TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/local" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_USER_EMAIL\",\"password\":\"$TEST_USER_PASSWORD\"}" \
    | jq -r '.accessToken // empty')

  if [ -z "$TOKEN" ]; then
    echo -e "${RED}FAIL: Authentication failed${NC}"
    exit 1
  fi
  echo -e "${GREEN}PASS: Authentication successful${NC}"

  echo ""
  echo "Step 2: Checking preflight..."
  PREFLIGHT=$(curl -s -X GET "$BASE_URL/api/openagentic/preflight" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{"ready":false}')

  if echo "$PREFLIGHT" | jq -e '.ready == true' > /dev/null 2>&1; then
    echo -e "${GREEN}PASS: Preflight checks passed${NC}"
  else
    echo -e "${YELLOW}WARN: Preflight endpoint may not exist, continuing...${NC}"
  fi

  echo ""
  echo "Step 3: Provisioning session..."
  PROVISION=$(curl -s -X POST "$BASE_URL/api/openagentic/provision" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"model":"claude-sonnet-4-20250514"}')

  SESSION_ID=$(echo "$PROVISION" | jq -r '.sessionId // empty')
  if [ -z "$SESSION_ID" ]; then
    echo -e "${RED}FAIL: Session provisioning failed${NC}"
    echo "$PROVISION" | jq .
    exit 1
  fi
  echo -e "${GREEN}PASS: Session provisioned - $SESSION_ID${NC}"

  echo ""
  echo "Step 4: Checking session health..."
  HEALTH=$(curl -s -X GET "$BASE_URL/api/openagentic/sessions/$SESSION_ID/health" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{}')

  if echo "$HEALTH" | jq -e '.cliStatus == "running" or .ptyActive == true' > /dev/null 2>&1; then
    echo -e "${GREEN}PASS: CLI is healthy and running${NC}"
  else
    echo -e "${YELLOW}WARN: Could not verify CLI status${NC}"
    echo "$HEALTH" | jq .
  fi

  echo ""
  echo "=============================================="
  echo "         QUICK SMOKE TEST COMPLETE"
  echo "=============================================="
  exit 0
fi

# Full test suite
echo "Running full test suite with TypeScript runner..."
echo ""

# Check if tsx is available
if ! command -v npx &> /dev/null; then
  echo -e "${RED}npx not found. Please install Node.js${NC}"
  exit 1
fi

# Run the TypeScript test harness
npx tsx src/tests/codemode/index.ts

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}=============================================="
  echo "         ALL TESTS PASSED"
  echo "==============================================${NC}"
else
  echo -e "${RED}=============================================="
  echo "         SOME TESTS FAILED"
  echo "==============================================${NC}"
fi

exit $EXIT_CODE
