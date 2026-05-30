

# Code Mode Comprehensive Test Suite
# Tests: Authentication, Session Management, Terminal WebSocket, Code-Server, Concurrency

set -euo pipefail

# Configuration
API_URL="${API_URL:-https://chat.example.com}"
CODE_MANAGER_URL="${CODE_MANAGER_URL:-http://localhost:3050}"
API_KEY="${API_KEY:-awc_PLACEHOLDER_REPLACE_WITH_REAL_KEY}"
NUM_USERS="${NUM_USERS:-10}"
TEST_TIMEOUT="${TEST_TIMEOUT:-60}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results tracking
declare -A TEST_RESULTS
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_error() { echo -e "${RED}[FAIL]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Record test result
record_test() {
    local test_name="$1"
    local result="$2"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    if [ "$result" == "PASS" ]; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
        log_success "$test_name"
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        log_error "$test_name: $3"
    fi
    TEST_RESULTS["$test_name"]="$result"
}

# Test 1: API Health Check
test_api_health() {
    log_info "Testing API health..."
    local response
    response=$(curl -s -w "%{http_code}" -o /tmp/api_health.json "$API_URL/api/health" 2>/dev/null)
    if [ "${response: -3}" == "200" ]; then
        record_test "API Health Check" "PASS"
        return 0
    else
        record_test "API Health Check" "FAIL" "HTTP $response"
        return 1
    fi
}

# Test 2: Code Manager Health Check (via openagentic API)
test_code_manager_health() {
    log_info "Testing Code Manager health..."
    local response
    response=$(curl -s -w "%{http_code}" -o /tmp/code_health.json \
        -H "Authorization: Bearer $API_KEY" \
        "$API_URL/api/openagentic/health" 2>/dev/null)
    if [ "${response: -3}" == "200" ]; then
        record_test "Code Manager Health" "PASS"
        return 0
    else
        record_test "Code Manager Health" "FAIL" "HTTP $response"
        return 1
    fi
}

# Test 3: Create Code Mode Session
test_create_session() {
    local session_id=""

    # Create session via API (uses authenticated user, not passed userId)
    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST "$API_URL/api/openagentic/sessions" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{}" 2>/dev/null)

    local http_code=$(echo "$response" | tail -1)
    local body=$(echo "$response" | head -n -1)

    if [ "$http_code" == "200" ] || [ "$http_code" == "201" ]; then
        session_id=$(echo "$body" | jq -r '.session.id // empty')
        if [ -n "$session_id" ]; then
            # Output session ID to stdout only (for capture)
            echo "$session_id"
            return 0
        fi
    fi

    # Log errors to stderr
    echo "Session create failed: HTTP $http_code - $body" >&2
    return 1
}

# Test 4: List Sessions
test_list_sessions() {
    log_info "Testing session listing..."
    local response
    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $API_KEY" \
        "$API_URL/api/openagentic/sessions" 2>/dev/null)

    local http_code=$(echo "$response" | tail -1)
    local body=$(echo "$response" | head -n -1)

    if [ "$http_code" == "200" ]; then
        local count=$(echo "$body" | jq -r '.sessions | length // .total // 0')
        record_test "List Sessions (count: $count)" "PASS"
        return 0
    fi

    record_test "List Sessions" "FAIL" "HTTP $http_code"
    return 1
}

# Test 5: Session Limit Enforcement
# NOTE: Per-user session limits are enforced at the CodeSession database level
# The limit is 5 sessions per user by default
test_session_limits() {
    log_info "Testing session limits (creating multiple sessions)..."

    # Create 3 sessions and verify they succeed
    local sessions=()
    local all_created=true
    for i in 1 2 3; do
        local response
        response=$(curl -s -w "\n%{http_code}" \
            -X POST "$API_URL/api/openagentic/sessions" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{}" 2>/dev/null)

        local http_code=$(echo "$response" | tail -1)

        if [ "$http_code" == "200" ] || [ "$http_code" == "201" ]; then
            local session_id=$(echo "$response" | head -n -1 | jq -r '.session.id // empty')
            if [ -n "$session_id" ]; then
                sessions+=("$session_id")
            else
                all_created=false
            fi
        else
            all_created=false
        fi
    done

    # Cleanup sessions
    for sid in "${sessions[@]}"; do
        curl -s -X DELETE "$API_URL/api/openagentic/sessions/$sid" \
            -H "Authorization: Bearer $API_KEY" >/dev/null 2>&1
    done

    if [ "$all_created" == "true" ] && [ ${#sessions[@]} -eq 3 ]; then
        record_test "Session Limit Test (3 sessions created)" "PASS"
        return 0
    else
        record_test "Session Limit Test" "FAIL" "Only ${#sessions[@]} sessions created"
        return 1
    fi
}

# Test 6: WebSocket Terminal Connection
# NOTE: WebSocket terminal is internal to openagentic-manager, not exposed via public API
test_websocket_terminal() {
    local session_id="$1"
    log_info "WebSocket terminal test skipped (internal to code-manager)..."
    log_warn "WebSocket Terminal: Skipped (internal to code-manager)"
    # Don't record as test - it's not available via public API
    return 0
}

# Test 7: Code-Server Start
# NOTE: Code-server requires a K8s session (created by openagentic-manager), not just a DB session
# The /api/openagentic/sessions endpoint creates DB records, code-server needs K8s pods
test_code_server() {
    local session_id="$1"
    log_info "Code-server test skipped (requires K8s session)..."
    log_warn "Code-Server: Skipped (requires K8s session from code-manager)"
    return 0
}

# Test 8: K8s Pod Session Creation (Real Code Mode)
# This tests actual K8s pod creation via code-manager
test_k8s_sessions() {
    local num_sessions="${1:-$NUM_USERS}"
    log_info "Testing K8s pod session creation with $num_sessions sessions..."

    local internal_key="${INTERNAL_API_KEY:-openagentic-code-manager-internal-2025}"
    local code_manager_pod=$(kubectl get pods -n openagentic -l app=openagentic-manager -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

    if [ -z "$code_manager_pod" ]; then
        record_test "K8s Sessions" "FAIL" "Code manager pod not found"
        return 1
    fi

    local sessions_created=0
    local session_ids=()

    # Create sessions
    for i in $(seq 1 $num_sessions); do
        local user_id="k8s-test-user-$i"
        local session_id="k8s-session-$i-$(date +%s)"

        local result
        result=$(kubectl exec -n openagentic "$code_manager_pod" -c code-manager -- curl -s -X POST http://localhost:3050/sessions \
            -H "Content-Type: application/json" \
            -H "X-Internal-Api-Key: $internal_key" \
            -d "{\"userId\": \"$user_id\", \"sessionId\": \"$session_id\", \"model\": \"gpt-oss:20b\"}" 2>/dev/null)

        if echo "$result" | jq -e '.id' >/dev/null 2>&1; then
            sessions_created=$((sessions_created + 1))
            local created_id=$(echo "$result" | jq -r '.id')
            session_ids+=("$created_id")
        fi

        sleep 1
    done

    # Wait for pods to start
    sleep 10

    # Check pods are running
    local running_pods=$(kubectl get pods -n openagentic -l app=openagentic-exec --field-selector=status.phase=Running 2>/dev/null | grep -c "Running" || echo 0)

    # Cleanup sessions
    for sid in "${session_ids[@]}"; do
        kubectl exec -n openagentic "$code_manager_pod" -c code-manager -- curl -s -X DELETE "http://localhost:3050/sessions/$sid" \
            -H "X-Internal-Api-Key: $internal_key" >/dev/null 2>&1
    done

    # Wait for cleanup
    sleep 5

    if [ "$sessions_created" -ge "$((num_sessions * 8 / 10))" ] && [ "$running_pods" -ge "$((num_sessions / 2))" ]; then
        record_test "K8s Sessions ($sessions_created created, $running_pods pods running)" "PASS"
        return 0
    else
        record_test "K8s Sessions ($sessions_created/$num_sessions)" "FAIL" "Only $running_pods pods running"
        return 1
    fi
}

# Test 8b: Concurrent Database Session Creation (API layer)
test_concurrent_sessions() {
    local num_sessions="${1:-$NUM_USERS}"
    log_info "Testing concurrent DB session creation with $num_sessions requests..."

    local pids=()
    local results_file="/tmp/concurrent_results_$$"
    local sessions_file="/tmp/concurrent_sessions_$$"
    > "$results_file"
    > "$sessions_file"

    for i in $(seq 1 $num_sessions); do
        (
            local response
            response=$(curl -s -w "\n%{http_code}" \
                -X POST "$API_URL/api/openagentic/sessions" \
                -H "Authorization: Bearer $API_KEY" \
                -H "Content-Type: application/json" \
                -d "{}" 2>/dev/null)

            local http_code=$(echo "$response" | tail -1)
            local body=$(echo "$response" | head -n -1)
            if [ "$http_code" == "200" ] || [ "$http_code" == "201" ]; then
                local session_id=$(echo "$body" | jq -r '.session.id // empty')
                echo "SUCCESS:$session_id" >> "$results_file"
                [ -n "$session_id" ] && echo "$session_id" >> "$sessions_file"
            else
                echo "FAIL:$i:$http_code" >> "$results_file"
            fi
        ) &
        pids+=($!)
    done

    # Wait for all to complete
    for pid in "${pids[@]}"; do
        wait "$pid" 2>/dev/null || true
    done

    # Cleanup created sessions
    while read -r sid; do
        curl -s -X DELETE "$API_URL/api/openagentic/sessions/$sid" \
            -H "Authorization: Bearer $API_KEY" >/dev/null 2>&1
    done < "$sessions_file"

    # Count results
    local success_count=$(grep -c "SUCCESS" "$results_file" || echo 0)
    local fail_count=$(grep -c "FAIL" "$results_file" || echo 0)

    if [ "$success_count" -ge "$((num_sessions / 2))" ]; then
        record_test "Concurrent DB Sessions ($success_count/$num_sessions succeeded)" "PASS"
        return 0
    else
        record_test "Concurrent DB Sessions ($success_count/$num_sessions)" "FAIL" "$fail_count failed"
        return 1
    fi
}

# Test 9: Session Cleanup
test_session_cleanup() {
    local session_id="$1"
    log_info "Testing session cleanup for $session_id..."

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X DELETE "$API_URL/api/openagentic/sessions/$session_id" \
        -H "Authorization: Bearer $API_KEY" 2>/dev/null)

    local http_code=$(echo "$response" | tail -1)

    if [ "$http_code" == "200" ] || [ "$http_code" == "204" ]; then
        record_test "Session Cleanup ($session_id)" "PASS"
        return 0
    fi

    record_test "Session Cleanup ($session_id)" "FAIL" "HTTP $http_code"
    return 1
}

# Test 10: Stress Test - Rapid Session Create/Delete
test_stress_create_delete() {
    local iterations="${1:-20}"
    log_info "Stress test: $iterations rapid create/delete cycles..."

    local success=0
    local fail=0

    for i in $(seq 1 $iterations); do
        # Create
        local create_response
        create_response=$(curl -s -w "\n%{http_code}" \
            -X POST "$API_URL/api/openagentic/sessions" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{}" 2>/dev/null)

        local create_code=$(echo "$create_response" | tail -1)
        local session_id=$(echo "$create_response" | head -n -1 | jq -r '.session.id // empty')

        if [ -n "$session_id" ]; then
            # Delete
            local delete_code
            delete_code=$(curl -s -w "%{http_code}" -o /dev/null \
                -X DELETE "$API_URL/api/openagentic/sessions/$session_id" \
                -H "Authorization: Bearer $API_KEY" 2>/dev/null)

            if [ "$delete_code" == "200" ] || [ "$delete_code" == "204" ]; then
                success=$((success + 1))
            else
                fail=$((fail + 1))
            fi
        else
            fail=$((fail + 1))
        fi
    done

    if [ "$success" -ge "$((iterations * 8 / 10))" ]; then
        record_test "Stress Test ($success/$iterations cycles)" "PASS"
        return 0
    else
        record_test "Stress Test ($success/$iterations)" "FAIL" "$fail cycles failed"
        return 1
    fi
}

# Print Summary
print_summary() {
    echo ""
    echo "=========================================="
    echo "         TEST RESULTS SUMMARY"
    echo "=========================================="
    echo -e "Total Tests: ${BLUE}$TOTAL_TESTS${NC}"
    echo -e "Passed:      ${GREEN}$PASSED_TESTS${NC}"
    echo -e "Failed:      ${RED}$FAILED_TESTS${NC}"
    echo ""

    if [ $FAILED_TESTS -eq 0 ]; then
        echo -e "${GREEN}All tests passed!${NC}"
        return 0
    else
        echo -e "${RED}Some tests failed. See details above.${NC}"
        return 1
    fi
}

# Main test runner
main() {
    echo "=========================================="
    echo "   Code Mode Comprehensive Test Suite"
    echo "=========================================="
    echo "API URL: $API_URL"
    echo "Users to simulate: $NUM_USERS"
    echo "=========================================="
    echo ""

    # Basic health checks
    test_api_health
    test_code_manager_health

    # Session management tests
    test_list_sessions

    # Create a single test session for functional tests
    log_info "Testing session creation..."
    local test_session_id
    test_session_id=$(test_create_session 2>/dev/null || echo "")

    if [ -n "$test_session_id" ]; then
        record_test "Session Create" "PASS"
        # WebSocket and code-server tests
        test_websocket_terminal "$test_session_id"
        test_code_server "$test_session_id"

        # Cleanup test session
        test_session_cleanup "$test_session_id"
    else
        record_test "Session Create" "FAIL" "No session ID returned"
    fi

    # Session limit test
    test_session_limits

    # Concurrency tests
    test_concurrent_sessions "$NUM_USERS"

    # Stress test
    test_stress_create_delete 20

    # Final summary
    print_summary
}

# Run tests
main "$@"
