# Proprietary and confidential. Unauthorized copying prohibited.

echo "Testing new prompt formatting..."

# Test with a simple query
RESPONSE=$(curl -s -X POST http://localhost:8000/api/chat/completion \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token-admin" \
  -d '{
    "sessionId": "test-session-prompt-check",
    "message": "List the top 3 Azure services for data storage and briefly explain each one.",
    "userId": "40037806-f729-4813-9561-72982a12031f"
  }')

echo "Response received:"
echo "$RESPONSE" | jq -r '.message // .error // .'

# Count bullet points in response
BULLET_COUNT=$(echo "$RESPONSE" | grep -o "\-" | wc -l)
echo ""
echo "Bullet point count: $BULLET_COUNT"

if [ $BULLET_COUNT -gt 10 ]; then
  echo "❌ FAIL: Too many bullet points detected ($BULLET_COUNT)"
  exit 1
else
  echo "✅ PASS: Reasonable bullet point usage ($BULLET_COUNT)"
  exit 0
fi
