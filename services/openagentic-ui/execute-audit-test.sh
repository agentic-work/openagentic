

echo "=== Starting Azure Infrastructure Security Audit Test ==="
echo "Time: $(date)"
echo ""

# Start log monitoring
echo "Starting log monitoring..."
docker logs -f openagenticchat-api 2>&1 | grep -E "(ChatPipeline|MCP|background|Admin Mode|completion)" > /tmp/audit-test-logs.txt &
LOG_PID=$!

# Send the audit request
echo "Sending audit request to API..."
RESPONSE=$(curl -s -X POST http://localhost:8000/api/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI0MDAzNzgwNi1mNzI5LTQ4MTMtOTU2MS03Mjk4MmExMjAzMWYiLCJlbWFpbCI6ImFkbWluQGFnZW50aWN3b3JrLmlvIiwiaXNBZG1pbiI6dHJ1ZSwiaWF0IjoxNzM1MzkxNjcxLCJleHAiOjE3MzU0NzgwNzF9.kP_6fN8uO2-gKEYT9X0LMJ3u0qW-y_jZxVQYH3mF8hU" \
  -d '{
    "sessionId": "test-audit-'$(date +%s)'",
    "message": "Perform a comprehensive Azure infrastructure security audit:\n\n1. Analyze EACH of our 194 Azure subscriptions individually for:\n   - Security compliance issues\n   - Cost optimization opportunities\n   - Resource misconfigurations\n   - Network security gaps\n\n2. For each subscription, check:\n   - AKS cluster configurations\n   - Network security groups\n   - Storage account access\n   - Identity and access management\n\n3. Generate a detailed executive report with:\n   - Executive summary\n   - Findings by severity\n   - Remediation recommendations\n   - Cost impact analysis\n\nThis requires deep analysis of each subscription individually.",
    "userId": "40037806-f729-4813-9561-72982a12031f"
  }')

echo ""
echo "Response received. Saving to /tmp/audit-response.txt..."
echo "$RESPONSE" > /tmp/audit-response.txt

# Give it time to process
echo "Waiting for AI to complete analysis (60 seconds)..."
sleep 60

# Stop log monitoring
kill $LOG_PID 2>/dev/null

echo ""
echo "=== Test Complete ==="
echo ""
echo "Response summary (first 500 chars):"
echo "$RESPONSE" | head -c 500
echo ""
echo ""
echo "Full response saved to: /tmp/audit-response.txt"
echo "Logs saved to: /tmp/audit-test-logs.txt"
echo ""
echo "Analyzing response for bullet points..."
BULLET_COUNT=$(echo "$RESPONSE" | grep -o "^- " | wc -l)
echo "Bullet points found: $BULLET_COUNT"
echo ""
echo "Checking if response mentions background job..."
if echo "$RESPONSE" | grep -iq "background\|job\|queued"; then
  echo "✓ Response mentions background processing"
else
  echo "✗ No mention of background processing"
fi

