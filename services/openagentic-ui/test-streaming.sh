

# Test SSE streaming behavior
# This tests the API directly to verify content_block events are working

API_URL="${1:-https://chat-dev.openagentic.io}"
API_KEY="${2:?API_KEY required as \$2 or via env}"

echo "=== SSE Streaming Test ==="
echo "API: $API_URL"
echo ""

# Create session
echo "Creating session..."
SESSION_RESP=$(curl -s -X POST "$API_URL/api/chat/sessions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Streaming Test"}')

SESSION_ID=$(echo "$SESSION_RESP" | jq -r '.session.id // empty')
if [ -z "$SESSION_ID" ]; then
  echo "Failed to create session"
  echo "Response: $SESSION_RESP"
  exit 1
fi
echo "Session ID: $SESSION_ID"
echo ""

# Send message and analyze events
echo "Sending message and analyzing SSE events..."
echo ""

# Track event types
TEMP_FILE=$(mktemp)

timeout 45 curl -sN "$API_URL/api/chat/stream" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d "{\"message\": \"What is 2+2? Think step by step.\", \"sessionId\": \"$SESSION_ID\", \"enableExtendedThinking\": true}" 2>/dev/null > "$TEMP_FILE"

# Analyze results
echo "=== Event Analysis ==="
echo ""

# Count event types
BLOCK_STARTS=$(grep -c "event: content_block_start" "$TEMP_FILE" || echo "0")
BLOCK_DELTAS=$(grep -c "event: content_block_delta" "$TEMP_FILE" || echo "0")
BLOCK_STOPS=$(grep -c "event: content_block_stop" "$TEMP_FILE" || echo "0")
STREAM_EVENTS=$(grep -c "event: stream$" "$TEMP_FILE" || echo "0")
DONE_EVENTS=$(grep -c "event: done" "$TEMP_FILE" || echo "0")

echo "content_block_start: $BLOCK_STARTS"
echo "content_block_delta: $BLOCK_DELTAS"
echo "content_block_stop: $BLOCK_STOPS"
echo "stream events: $STREAM_EVENTS"
echo "done events: $DONE_EVENTS"
echo ""

# Check block types
echo "=== Block Types Detected ==="
grep "content_block_start" "$TEMP_FILE" | while read -r line; do
  if echo "$line" | grep -q "thinking"; then
    echo "- thinking block"
  elif echo "$line" | grep -q '"type":"text"'; then
    echo "- text block"
  elif echo "$line" | grep -q "tool_use"; then
    echo "- tool_use block"
  fi
done
echo ""

# Validation
echo "=== Validation ==="
if [ "$BLOCK_STARTS" -gt "0" ]; then
  echo "✓ PASS: Interleaved mode detected ($BLOCK_STARTS content_block_start events)"
else
  echo "✗ FAIL: No content_block_start events - not using interleaved mode"
fi

if [ "$STREAM_EVENTS" -gt "$BLOCK_DELTAS" ]; then
  echo "⚠ WARNING: More stream events ($STREAM_EVENTS) than block_deltas ($BLOCK_DELTAS) - potential duplication"
else
  echo "✓ OK: stream events ($STREAM_EVENTS) <= block_deltas ($BLOCK_DELTAS)"
fi

if [ "$DONE_EVENTS" -eq "1" ]; then
  echo "✓ PASS: Exactly 1 done event"
else
  echo "⚠ WARNING: $DONE_EVENTS done events (expected 1)"
fi

# Cleanup
rm -f "$TEMP_FILE"
echo ""
echo "Test complete."
