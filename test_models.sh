# Proprietary and confidential. Unauthorized copying prohibited.

API_URL="https://chat-dev.openagentic.io"
API_KEY="awc_a9fa52d3e0a2b921c597e5741ea1345623a533f6d81df0b656b41c1561c75d7d"

run_test() {
    local title="$1"
    local msg="$2"

    SID=$(curl -s -X POST "$API_URL/api/chat/sessions" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"title":"'"$title"'"}' | jq -r '.session.id')

    MODEL=$(timeout 25 curl -sN "$API_URL/api/chat/stream" \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"message":"'"$msg"'","sessionId":"'"$SID"'"}' 2>&1 | grep completion_start | head -1 | sed 's/.*"model":"\([^"]*\)".*/\1/')

    printf "%-40s → %s\n" "$title" "$MODEL"
}

echo "=============================================="
echo "10-SESSION COMPREHENSIVE MODEL TEST"
echo "=============================================="
echo ""

run_test "1. Simple Greeting" "Hello there!"
run_test "2. Basic Math" "What is 25 times 4?"
run_test "3. Trivia Question" "When was the Eiffel Tower built?"
run_test "4. Weather Query (MCP)" "What is the weather in Seattle right now?"
run_test "5. Web Search (MCP)" "Search for latest AI developments"
run_test "6. Complex Architecture" "Design a microservices system for banking with sharding and failover"
run_test "7. Code Generation" "Write a Python async web scraper with error handling"
run_test "8. Creative Writing" "Write a haiku about coding"
run_test "9. Math Analysis" "Explain backpropagation in neural networks mathematically"
run_test "10. Philosophy" "What is consciousness?"

echo ""
echo "=============================================="
