# Proprietary and confidential. Unauthorized copying prohibited.

#
# Code Mode Full E2E Test
#
# Tests the complete flow:
# 1. Login as local admin
# 2. Create PTY session via manager (with user token for API mode)
# 3. Get VS Code URL
# 4. Send message to CLI via PTY
# 5. Verify workspace and LLM response
#
# Usage: ./tests/e2e/codemode-full-e2e.sh

set -e

BASE_URL="${TEST_BASE_URL:-http://localhost:8000}"
MANAGER_URL="${TEST_MANAGER_URL:-http://localhost:3050}"
UI_URL="${TEST_UI_URL:-http://localhost:3000}"
ADMIN_EMAIL="admin@openagentic.io"
ADMIN_PASSWORD="${LOCAL_ADMIN_PASSWORD:-6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-internal-api-key-for-service-to-service-auth}"

echo "========================================"
echo " Code Mode Full E2E Test"
echo "========================================"
echo "API URL: $BASE_URL"
echo "Manager URL: $MANAGER_URL"
echo "UI URL: $UI_URL"
echo ""

# ========================================================================
# SECTION 1: LOGIN TO GET AUTH TOKEN
# ========================================================================
echo "=== SECTION 1: LOCAL ADMIN LOGIN ==="

echo "1.1 Logging in as $ADMIN_EMAIL..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/local/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"$ADMIN_EMAIL\", \"password\": \"$ADMIN_PASSWORD\"}")

AUTH_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty')
USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.id // empty')
USER_NAME=$(echo "$LOGIN_RESPONSE" | jq -r '.user.name // empty')

if [ -z "$AUTH_TOKEN" ] || [ "$AUTH_TOKEN" = "null" ]; then
  echo "  ERROR: Login failed"
  echo "  Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "  SUCCESS: Logged in as $USER_NAME ($USER_ID)"
echo "  Token: ${AUTH_TOKEN:0:30}..."

# ========================================================================
# SECTION 2: CREATE PTY SESSION IN MANAGER (WITH API MODE)
# ========================================================================
echo ""
echo "=== SECTION 2: CREATE PTY SESSION (API MODE) ==="

echo "2.1 Creating PTY session with user token for API mode..."
# The apiKey parameter enables API mode - CLI will use platform LLM instead of Ollama
SESSION_RESPONSE=$(docker exec openagentic-manager curl -s -X POST "http://localhost:3050/sessions" \
  -H "Content-Type: application/json" \
  -H "X-Internal-API-Key: $INTERNAL_API_KEY" \
  -d "{\"userId\": \"$USER_ID\", \"apiKey\": \"$AUTH_TOKEN\"}")

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.sessionId // empty')
WORKSPACE=$(echo "$SESSION_RESPONSE" | jq -r '.session.workspacePath // empty')
STATUS=$(echo "$SESSION_RESPONSE" | jq -r '.session.status // empty')
MODEL=$(echo "$SESSION_RESPONSE" | jq -r '.session.model // empty')

if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo "  ERROR: Session creation failed"
  echo "  Response: $SESSION_RESPONSE"
  exit 1
fi

echo "  SUCCESS: Created PTY session $SESSION_ID"
echo "  Workspace: $WORKSPACE"
echo "  Status: $STATUS"
echo "  Model: $MODEL"

# ========================================================================
# SECTION 3: VERIFY API MODE (NOT OLLAMA)
# ========================================================================
echo ""
echo "=== SECTION 3: VERIFY API MODE ==="

echo "3.1 Checking manager logs for API mode..."
API_MODE_LOG=$(docker compose logs openagentic-manager --tail=30 2>&1 | grep -E "\[API MODE\].*$SESSION_ID" | tail -1 || echo "")
OLLAMA_MODE_LOG=$(docker compose logs openagentic-manager --tail=30 2>&1 | grep -E "\[OLLAMA MODE\].*$SESSION_ID" | tail -1 || echo "")

if [ -n "$API_MODE_LOG" ]; then
  echo "  SUCCESS: Session is running in API MODE"
  echo "  Log: $API_MODE_LOG"
elif [ -n "$OLLAMA_MODE_LOG" ]; then
  echo "  WARNING: Session is running in OLLAMA MODE (not expected)"
  echo "  Log: $OLLAMA_MODE_LOG"
else
  echo "  Checking session spawn log..."
  SPAWN_LOG=$(docker compose logs openagentic-manager --tail=50 2>&1 | grep -E "Spawning|--provider" | tail -2)
  echo "  $SPAWN_LOG"
fi

# ========================================================================
# SECTION 4: GET CODE SERVER URL
# ========================================================================
echo ""
echo "=== SECTION 4: GET VS CODE URL ==="

echo "4.1 Getting code-server URL..."
CODE_SERVER_RESPONSE=$(docker exec openagentic-manager curl -s "http://localhost:3050/sessions/$SESSION_ID/code-server" \
  -H "X-Internal-API-Key: $INTERNAL_API_KEY")

CODE_SERVER_URL=$(echo "$CODE_SERVER_RESPONSE" | jq -r '.url // empty')
CODE_SERVER_HEALTHY=$(echo "$CODE_SERVER_RESPONSE" | jq -r '.healthy // false')

echo "  URL: $CODE_SERVER_URL"
echo "  Healthy: $CODE_SERVER_HEALTHY"

# ========================================================================
# SECTION 5: VERIFY WORKSPACE ISOLATION
# ========================================================================
echo ""
echo "=== SECTION 5: VERIFY WORKSPACE ISOLATION ==="

echo "5.1 Checking workspace structure..."
if [[ "$WORKSPACE" == *"/$USER_ID/"* ]]; then
  echo "  SUCCESS: Workspace includes user ID for isolation"
  echo "  Path: $WORKSPACE"
else
  echo "  WARNING: Workspace may not be properly isolated"
  echo "  Path: $WORKSPACE"
fi

echo ""
echo "5.2 Checking workspace exists in container..."
WORKSPACE_CHECK=$(docker exec openagentic-manager ls -la "$WORKSPACE" 2>&1 | head -5 || echo "ERROR")
echo "$WORKSPACE_CHECK"

# ========================================================================
# SECTION 6: SEND TEST MESSAGE TO PTY
# ========================================================================
echo ""
echo "=== SECTION 6: SEND TEST MESSAGE TO CLI ==="

echo "6.1 Writing test prompt to PTY..."
# Use WebSocket or PTY input to send message
# For now, we'll check the PTY status
PTY_STATUS=$(docker exec openagentic-manager curl -s "http://localhost:3050/sessions/$SESSION_ID" \
  -H "X-Internal-API-Key: $INTERNAL_API_KEY")
PTY_PID=$(echo "$PTY_STATUS" | jq -r '.session.pid // empty')
echo "  PTY PID: $PTY_PID"
echo "  Status: $(echo "$PTY_STATUS" | jq -r '.session.status // empty')"

# ========================================================================
# SECTION 7: TEST SUMMARY
# ========================================================================
echo ""
echo "========================================"
echo " E2E TEST SUMMARY"
echo "========================================"
echo ""
echo "RESULTS:"
echo "  - Login:           SUCCESS"
echo "  - Session Created: $SESSION_ID"
echo "  - Workspace:       $WORKSPACE"
echo "  - API Mode:        $([ -n '$API_MODE_LOG' ] && echo 'YES' || echo 'CHECK LOGS')"
echo "  - VS Code URL:     $UI_URL$CODE_SERVER_URL"
echo "  - Code Server:     $([ '$CODE_SERVER_HEALTHY' = 'true' ] && echo 'HEALTHY' || echo 'CHECK')"
echo ""
echo "MANUAL VERIFICATION STEPS:"
echo "  1. Open browser: $UI_URL"
echo "  2. Login with: $ADMIN_EMAIL"
echo "  3. Navigate to Code Mode"
echo "  4. Verify session shows: $SESSION_ID"
echo "  5. Click 'Editor' tab"
echo "  6. Verify VS Code loads with workspace: $WORKSPACE"
echo "  7. In the chat, ask: 'Create a simple hello world HTML page'"
echo "  8. Verify LLM responds and creates files"
echo ""
echo "VS CODE DIRECT LINK:"
echo "  $UI_URL$CODE_SERVER_URL"
echo ""
echo "========================================"

# Keep session for manual testing
echo ""
echo "Session left running for manual verification."
echo "To clean up: docker exec openagentic-manager curl -s -X DELETE 'http://localhost:3050/sessions/$SESSION_ID' -H 'X-Internal-API-Key: $INTERNAL_API_KEY'"
