

#
# Code Mode E2E Test - Full Flow
#
# Tests:
# 1. Login as local admin
# 2. Create Code Mode session
# 3. Send LLM message to create a "rebirth clone" project
# 4. Wait for response
# 5. Verify VS Code URL and workspace
#
# Usage: ./tests/e2e/codemode-llm-e2e.sh

set -e

BASE_URL="${TEST_BASE_URL:-http://localhost:8000}"
UI_URL="${TEST_UI_URL:-http://localhost:3000}"
ADMIN_EMAIL="admin@openagentic.io"
ADMIN_PASSWORD="${LOCAL_ADMIN_PASSWORD:-REPLACE_WITH_REAL_TEST_PASSWORD}"

echo "========================================"
echo " Code Mode E2E Test - Full LLM Flow"
echo "========================================"
echo "API URL: $BASE_URL"
echo "UI URL: $UI_URL"
echo ""

# ========================================================================
# SECTION 1: LOGIN
# ========================================================================
echo "=== SECTION 1: LOCAL ADMIN LOGIN ==="

echo "1.1 Attempting local admin login..."
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/local/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"$ADMIN_EMAIL\", \"password\": \"$ADMIN_PASSWORD\"}")

AUTH_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // .accessToken // .access_token // empty')

if [ -z "$AUTH_TOKEN" ] || [ "$AUTH_TOKEN" = "null" ]; then
  echo "  ERROR: Login failed"
  echo "  Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "  SUCCESS: Logged in as $ADMIN_EMAIL"
echo "  Token: ${AUTH_TOKEN:0:20}..."

# Get user ID from token or response
USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.id // .userId // "admin"')
echo "  User ID: $USER_ID"

# ========================================================================
# SECTION 2: CREATE CODE MODE SESSION
# ========================================================================
echo ""
echo "=== SECTION 2: CREATE CODE MODE SESSION ==="

echo "2.1 Creating Code Mode session with API token..."
SESSION_RESPONSE=$(curl -s -X POST "$BASE_URL/api/openagentic/sessions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"userId\": \"$USER_ID\"}")

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.session.id // .sessionId // empty')

if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo "  ERROR: Session creation failed"
  echo "  Response: $SESSION_RESPONSE"
  exit 1
fi

echo "  SUCCESS: Created session $SESSION_ID"

# Check session details
WORKSPACE=$(echo "$SESSION_RESPONSE" | jq -r '.session.workspacePath // empty')
STATUS=$(echo "$SESSION_RESPONSE" | jq -r '.session.status // empty')
echo "  Workspace: $WORKSPACE"
echo "  Status: $STATUS"

# ========================================================================
# SECTION 3: GET CODE SERVER URL
# ========================================================================
echo ""
echo "=== SECTION 3: GET VS CODE URL ==="

echo "3.1 Getting code-server URL for session..."
CODE_SERVER_RESPONSE=$(curl -s "$BASE_URL/api/openagentic/sessions/$SESSION_ID/code-server" \
  -H "Authorization: Bearer $AUTH_TOKEN")

CODE_SERVER_URL=$(echo "$CODE_SERVER_RESPONSE" | jq -r '.url // empty')
CODE_SERVER_HEALTHY=$(echo "$CODE_SERVER_RESPONSE" | jq -r '.healthy // false')

echo "  URL: $CODE_SERVER_URL"
echo "  Healthy: $CODE_SERVER_HEALTHY"

# ========================================================================
# SECTION 4: SEND LLM MESSAGE - CREATE REBIRTH CLONE
# ========================================================================
echo ""
echo "=== SECTION 4: SEND LLM MESSAGE - CREATE REBIRTH CLONE ==="

# Build the message to create a rebirth clone project
REBIRTH_PROMPT="Create a simple 'rebirth' clone web application. This should be a single-page app with:
1. An index.html file with a beautiful gradient background
2. A centered card that says 'Rebirth Clone' with a subtitle
3. A button that when clicked, shows an animation and changes the card content
4. Modern CSS styling with animations
5. Vanilla JavaScript for the interactivity

Please create all the necessary files in the current workspace."

echo "4.1 Sending message to Code Mode LLM..."
echo "  Message: Create rebirth clone..."

# Create a chat message in the session
MESSAGE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/openagentic/sessions/$SESSION_ID/message" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"message\": \"$REBIRTH_PROMPT\"}" \
  --max-time 120)

echo "  Response received"
echo "  Response preview: ${MESSAGE_RESPONSE:0:200}..."

# ========================================================================
# SECTION 5: WAIT FOR LLM RESPONSE AND FILE CREATION
# ========================================================================
echo ""
echo "=== SECTION 5: WAIT FOR LLM PROCESSING ==="

echo "5.1 Waiting for LLM to process and create files..."
sleep 10

# Check if files were created in workspace
echo "5.2 Checking workspace contents..."
WORKSPACE_FILES=$(curl -s "$BASE_URL/api/openagentic/sessions/$SESSION_ID/files" \
  -H "Authorization: Bearer $AUTH_TOKEN" 2>/dev/null || echo "{}")

echo "  Workspace files: $WORKSPACE_FILES"

# ========================================================================
# SECTION 6: VERIFY VS CODE ACCESS
# ========================================================================
echo ""
echo "=== SECTION 6: VERIFY VS CODE ACCESS ==="

# Full VS Code URL
FULL_VSCODE_URL="$UI_URL$CODE_SERVER_URL"
echo "6.1 VS Code URL: $FULL_VSCODE_URL"

# Try to access VS Code
echo "6.2 Checking VS Code accessibility..."
VSCODE_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "$FULL_VSCODE_URL" --max-time 10 2>/dev/null || echo "000")
echo "  HTTP Status: $VSCODE_CHECK"

if [ "$VSCODE_CHECK" = "200" ] || [ "$VSCODE_CHECK" = "302" ]; then
  echo "  SUCCESS: VS Code is accessible"
else
  echo "  WARNING: VS Code returned $VSCODE_CHECK (may need manual browser check)"
fi

# ========================================================================
# SECTION 7: SUMMARY
# ========================================================================
echo ""
echo "========================================"
echo " E2E TEST SUMMARY"
echo "========================================"
echo "Session ID:    $SESSION_ID"
echo "Workspace:     $WORKSPACE"
echo "VS Code URL:   $FULL_VSCODE_URL"
echo ""
echo "To manually verify:"
echo "  1. Open browser to: $UI_URL"
echo "  2. Login with: $ADMIN_EMAIL"
echo "  3. Navigate to Code Mode"
echo "  4. Check VS Code loads with workspace: $WORKSPACE"
echo "  5. Verify files created by LLM"
echo ""
echo "VS Code Direct Link:"
echo "  $FULL_VSCODE_URL"
echo "========================================"

# Clean up - keep session running for manual inspection
echo ""
echo "NOTE: Session left running for manual inspection."
echo "To stop: curl -X DELETE '$BASE_URL/api/openagentic/sessions/$SESSION_ID' -H 'Authorization: Bearer $AUTH_TOKEN'"
