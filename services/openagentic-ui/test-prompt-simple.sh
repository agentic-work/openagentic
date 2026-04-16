# Proprietary and confidential. Unauthorized copying prohibited.


echo "=== Testing Natural Prompt Formatting ==="
echo ""

# Simple streaming test to check response format
RESPONSE=$(curl -s -X POST http://localhost:8000/api/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token-admin" \
  -d '{
    "sessionId": "test-'$(date +%s)'",
    "message": "What are the main Azure compute services?",
    "userId": "40037806-f729-4813-9561-72982a12031f"
  }' | head -100)

echo "First 100 lines of response:"
echo "$RESPONSE"
echo ""

# Count markdown bullet points (lines starting with "- ")
BULLET_LINES=$(echo "$RESPONSE" | grep -c "^- ")
echo "Lines starting with markdown bullets: $BULLET_LINES"

# Count numbered lists (lines starting with "1. ", "2. ", etc)
NUMBERED_LINES=$(echo "$RESPONSE" | grep -cE "^[0-9]+\. ")
echo "Lines starting with numbered lists: $NUMBERED_LINES"

TOTAL_LIST_LINES=$((BULLET_LINES + NUMBERED_LINES))
echo "Total list-formatted lines: $TOTAL_LIST_LINES"

if [ $TOTAL_LIST_LINES -gt 15 ]; then
  echo ""
  echo "❌ CONCERN: Many list-formatted lines detected"
else
  echo ""
  echo "✅ GOOD: Reasonable formatting"
fi
