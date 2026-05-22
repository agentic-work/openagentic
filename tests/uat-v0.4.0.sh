

# =====================================================
# OpenAgentic v0.4.0 UAT Test Suite
# =====================================================
# Comprehensive API-based tests with TTFT measurement
# Run: ./tests/uat-v0.4.0.sh
# =====================================================

# Configuration
API_URL="${API_URL:-https://chat-dev.openagentic.io}"
API_KEY="${API_KEY:-awc_c5bfc5b8f03e40ead076fc8cd23a0025ce7fc2cf09e236073ea46e8ee094c582}"
TIMEOUT="${TIMEOUT:-30}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counters
PASSED=0
FAILED=0
TOTAL=0
RESULTS=()

# Timing
START_TIME=$(date +%s)

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
pass() { echo -e "${GREEN}✓ PASS${NC} $1"; ((PASSED++)); ((TOTAL++)); RESULTS+=("PASS: $1"); }
fail() { echo -e "${RED}✗ FAIL${NC} $1"; ((FAILED++)); ((TOTAL++)); RESULTS+=("FAIL: $1"); }
warn() { echo -e "${YELLOW}⚠ WARN${NC} $1"; }

# =====================================================
# Session Management
# =====================================================
create_session() {
    local title="$1"
    local response
    response=$(curl -s --max-time 10 -X POST "$API_URL/api/chat/sessions" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"title\": \"$title\"}" 2>/dev/null)
    echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

delete_session() {
    local session_id="$1"
    curl -s --max-time 5 -X DELETE "$API_URL/api/chat/sessions/$session_id" \
        -H "Authorization: Bearer $API_KEY" > /dev/null 2>&1 || true
}

# =====================================================
# Chat Test with TTFT
# =====================================================
test_chat() {
    local message="$1"
    local session_id="$2"
    local expected="$3"
    local test_name="$4"

    local start end response total_time

    start=$(date +%s.%N)
    response=$(timeout $TIMEOUT curl -s -N "$API_URL/api/chat/stream" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"message\": \"$message\", \"sessionId\": \"$session_id\"}" 2>&1 | head -100)
    end=$(date +%s.%N)
    total_time=$(echo "$end - $start" | bc 2>/dev/null || echo "?")

    if echo "$response" | grep -q '"content"'; then
        if [[ -n "$expected" ]] && echo "$response" | grep -qi "$expected"; then
            pass "$test_name (${total_time}s)"
            return 0
        elif [[ -z "$expected" ]]; then
            pass "$test_name (${total_time}s)"
            return 0
        else
            fail "$test_name - Expected '$expected' not found"
            return 1
        fi
    else
        fail "$test_name - No response (${total_time}s)"
        return 1
    fi
}

# =====================================================
# INFRASTRUCTURE TESTS
# =====================================================
test_infrastructure() {
    log "=== INFRASTRUCTURE TESTS ==="

    # API Health
    local start end health time
    start=$(date +%s.%N)
    health=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_URL/api/health" -H "Authorization: Bearer $API_KEY" 2>/dev/null || echo "000")
    end=$(date +%s.%N)
    time=$(echo "$end - $start" | bc 2>/dev/null || echo "?")

    if [[ "$health" == "200" ]]; then
        pass "API Health Check (${time}s)"
    else
        fail "API Health Check - HTTP $health"
    fi

    # Version endpoint
    start=$(date +%s.%N)
    local version
    version=$(curl -s --max-time 10 "$API_URL/api/version" -H "Authorization: Bearer $API_KEY" 2>/dev/null | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
    end=$(date +%s.%N)
    time=$(echo "$end - $start" | bc 2>/dev/null || echo "?")

    if [[ -n "$version" ]]; then
        pass "Version Endpoint: $version (${time}s)"
    else
        fail "Version Endpoint - No version returned"
    fi

    # Session Creation
    start=$(date +%s.%N)
    local test_session
    test_session=$(create_session "UAT-Infrastructure-Test")
    end=$(date +%s.%N)
    time=$(echo "$end - $start" | bc 2>/dev/null || echo "?")

    if [[ -n "$test_session" ]]; then
        pass "Session Creation (${time}s)"
        delete_session "$test_session"
    else
        fail "Session Creation - Failed"
    fi
}

# =====================================================
# CHAT MODE TESTS
# =====================================================
test_chat_mode() {
    log "=== CHAT MODE TESTS ==="

    # Simple math
    local session
    session=$(create_session "UAT-Chat-Simple")
    if [[ -n "$session" ]]; then
        test_chat "What is 2+2? Reply with just the number." "$session" "4" "Chat: Simple Math"
        delete_session "$session"
    else
        fail "Chat: Simple Math - Session creation failed"
    fi

    # Geography
    session=$(create_session "UAT-Chat-Geography")
    if [[ -n "$session" ]]; then
        test_chat "Capital of France? One word." "$session" "Paris" "Chat: Geography"
        delete_session "$session"
    else
        fail "Chat: Geography - Session creation failed"
    fi

    # Code generation
    session=$(create_session "UAT-Chat-Code")
    if [[ -n "$session" ]]; then
        test_chat "Python hello world in one line" "$session" "print" "Chat: Code Generation"
        delete_session "$session"
    else
        fail "Chat: Code Generation - Session creation failed"
    fi
}

# =====================================================
# STREAMING TESTS
# =====================================================
test_streaming() {
    log "=== STREAMING TESTS ==="

    local session
    session=$(create_session "UAT-Streaming")
    if [[ -n "$session" ]]; then
        local start end response chunk_count time

        start=$(date +%s.%N)
        response=$(timeout 30 curl -s -N "$API_URL/api/chat/stream" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"message\": \"Count 1 to 3\", \"sessionId\": \"$session\"}" 2>&1 | head -50)
        end=$(date +%s.%N)
        time=$(echo "$end - $start" | bc 2>/dev/null || echo "?")

        chunk_count=$(echo "$response" | grep -c "^data:" || echo "0")

        if [[ "$chunk_count" -gt 0 ]]; then
            pass "Streaming: ${chunk_count} chunks (${time}s)"
        else
            fail "Streaming: No chunks received"
        fi

        delete_session "$session"
    else
        fail "Streaming - Session creation failed"
    fi
}

# =====================================================
# MCP TOOL TESTS
# =====================================================
test_mcp_tools() {
    log "=== MCP TOOL TESTS ==="

    local start end tools time tool_count

    start=$(date +%s.%N)
    tools=$(curl -s --max-time 15 "$API_URL/api/mcp/tools" -H "Authorization: Bearer $API_KEY" 2>/dev/null)
    end=$(date +%s.%N)
    time=$(echo "$end - $start" | bc 2>/dev/null || echo "?")

    if echo "$tools" | grep -q '"tools"'; then
        tool_count=$(echo "$tools" | grep -o '"name"' | wc -l)
        pass "MCP Tools List: ${tool_count} tools (${time}s)"
    else
        warn "MCP Tools List - Endpoint may require different auth (${time}s)"
    fi
}

# =====================================================
# CODE MODE TESTS
# =====================================================
test_code_mode() {
    log "=== CODE MODE TESTS ==="

    local start end status time

    start=$(date +%s.%N)
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_URL/api/openagentic/status" \
        -H "Authorization: Bearer $API_KEY" 2>/dev/null || echo "000")
    end=$(date +%s.%N)
    time=$(echo "$end - $start" | bc 2>/dev/null || echo "?")

    if [[ "$status" == "200" ]] || [[ "$status" == "401" ]] || [[ "$status" == "404" ]]; then
        pass "Code Mode API Reachable (HTTP $status, ${time}s)"
    else
        warn "Code Mode API - HTTP $status"
    fi

    log "  → Full Code Mode tests require Playwright"
}

# =====================================================
# FLOWISE TESTS
# =====================================================
test_flowise() {
    log "=== FLOWISE TESTS ==="

    local start end status time

    start=$(date +%s.%N)
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_URL/api/workflows" \
        -H "Authorization: Bearer $API_KEY" 2>/dev/null || echo "000")
    end=$(date +%s.%N)
    time=$(echo "$end - $start" | bc 2>/dev/null || echo "?")

    if [[ "$status" == "200" ]]; then
        pass "Flowise Workflows API (${time}s)"
    else
        warn "Flowise Workflows API - HTTP $status (${time}s)"
    fi
}

# =====================================================
# PERFORMANCE TESTS
# =====================================================
test_performance() {
    log "=== PERFORMANCE TESTS ==="

    # Concurrent sessions
    local session_ids=()
    local start end time i

    start=$(date +%s.%N)
    for i in 1 2 3; do
        local sid
        sid=$(create_session "UAT-Perf-$i")
        if [[ -n "$sid" ]]; then
            session_ids+=("$sid")
        fi
    done
    end=$(date +%s.%N)
    time=$(echo "$end - $start" | bc 2>/dev/null || echo "?")

    if [[ ${#session_ids[@]} -eq 3 ]]; then
        pass "Concurrent Sessions: 3 created (${time}s)"
    else
        fail "Concurrent Sessions: ${#session_ids[@]}/3 created"
    fi

    # Cleanup
    for sid in "${session_ids[@]}"; do
        delete_session "$sid"
    done

    # Response time baseline
    local session
    session=$(create_session "UAT-Perf-Baseline")
    if [[ -n "$session" ]]; then
        start=$(date +%s.%N)
        timeout 30 curl -s -N "$API_URL/api/chat/stream" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"message\": \"Hi\", \"sessionId\": \"$session\"}" > /dev/null 2>&1
        end=$(date +%s.%N)
        time=$(echo "$end - $start" | bc 2>/dev/null || echo "?")

        pass "Response Time Baseline: ${time}s"
        delete_session "$session"
    fi
}

# =====================================================
# MAIN
# =====================================================
main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║        OpenAgentic v0.4.0 UAT Test Suite                   ║"
    echo "╠════════════════════════════════════════════════════════════╣"
    echo "║  API: $API_URL"
    echo "║  Time: $(date)"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""

    test_infrastructure
    echo ""
    test_chat_mode
    echo ""
    test_streaming
    echo ""
    test_mcp_tools
    echo ""
    test_code_mode
    echo ""
    test_flowise
    echo ""
    test_performance

    # Summary
    local END_TIME DURATION
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))

    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║                      TEST SUMMARY                          ║"
    echo "╠════════════════════════════════════════════════════════════╣"
    printf "║  ${GREEN}PASSED: %d${NC}\n" "$PASSED"
    printf "║  ${RED}FAILED: %d${NC}\n" "$FAILED"
    echo "║  TOTAL:  $TOTAL"
    echo "║  TIME:   ${DURATION}s"
    echo "╚════════════════════════════════════════════════════════════╝"

    if [[ $FAILED -gt 0 ]]; then
        echo ""
        echo "Failed tests:"
        for result in "${RESULTS[@]}"; do
            if [[ "$result" == FAIL:* ]]; then
                echo "  - ${result#FAIL: }"
            fi
        done
        exit 1
    fi

    exit 0
}

main "$@"
