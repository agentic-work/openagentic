

# Test Multi-Cloud Query Script
# Tests Azure + AWS tool discovery and execution

set -e

API_URL="https://agentic-api-dev.cdc.gov"
USER_EMAIL="zbh6@cdc.gov"

echo "=== Multi-Cloud Test Script ==="

# Step 1: Use the provided API key
echo "Step 1: Using provided API key..."

API_KEY="awc_7738640db365c7aeac138b3cb1a97ad438336d60af0c3a8f98ed8832021156b6"

echo "Using API Key: ${API_KEY:0:20}..."
echo ""

# Step 2: Create a new chat session
echo "Step 2: Creating chat session..."

SESSION_RESPONSE=$(curl -s -X POST "$API_URL/api/chat/sessions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"title": "Multi-Cloud Test"}')

SESSION_ID=$(echo "$SESSION_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$SESSION_ID" ]; then
  echo "Failed to create session. Response:"
  echo "$SESSION_RESPONSE"
  exit 1
fi

echo "Session ID: $SESSION_ID"
echo ""

# Step 3: Send the multi-cloud query
echo "Step 3: Sending multi-cloud query..."
echo "Query: please show me my azure default subscription and the resource groups in it- and then show me my AWS account information and the users in IAM in a table."
echo ""
echo "=== Streaming Response ==="
echo ""

curl -s -N -X POST "$API_URL/api/chat/stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"message\": \"please show me my azure default subscription and the resource groups in it- and then show me my AWS account information and the users in IAM in a table.\"}"

echo ""
echo ""
echo "=== Test Complete ==="
