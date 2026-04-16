# Proprietary and confidential. Unauthorized copying prohibited.

# Quick SSE event test - shows raw events from the API
# Usage: ./test-sse-events.sh [api_url] [message]

API_URL="${1:-http://localhost:3000}"
MESSAGE="${2:-Think step by step: what is 15% of 85?}"

echo "=== SSE Event Test ==="
echo "API: $API_URL"
echo "Message: $MESSAGE"
echo ""

# Create session
echo "Creating session..."
SESSION_RESP=$(curl -s -X POST "$API_URL/api/chat/sessions" \
  -H "Content-Type: application/json" \
  -d '{"title": "SSE Test"}' 2>/dev/null)

SESSION_ID=$(echo "$SESSION_RESP" | jq -r '.session.id // .id // empty' 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  echo "Failed to create session. Using test ID."
  echo "Response: $SESSION_RESP"
  SESSION_ID="test-$(date +%s)"
fi

echo "Session ID: $SESSION_ID"
echo ""
echo "=== Streaming Response (first 100 events) ==="
echo ""

# Send message and capture SSE events
curl -s -N "$API_URL/api/chat/stream" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"message\": \"$MESSAGE\", \"enableExtendedThinking\": true}" \
  2>/dev/null | head -200 | while IFS= read -r line; do
    if [[ "$line" == "event:"* ]]; then
      EVENT_TYPE="${line#event: }"
      echo -e "\033[36m[$EVENT_TYPE]\033[0m"
    elif [[ "$line" == "data:"* ]]; then
      DATA="${line#data: }"
      # Pretty print first 150 chars
      echo "  ${DATA:0:150}..."
    fi
  done

echo ""
echo "=== Key Events to Look For ==="
echo "  - content_block_start (type: thinking/text/tool_use)"
echo "  - content_block_delta (thinking_delta/text_delta)"
echo "  - content_block_stop"
echo ""
echo "If you see these events, interleaved mode is working!"
