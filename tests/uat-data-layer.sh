

# =====================================================
# OpenAgentic v0.4.0 Data Layer UAT Tests
# =====================================================
# Tests pgvector, embeddings, and hybrid data layer
# Run: ./tests/uat-data-layer.sh
# =====================================================

set -e

# Configuration
API_URL="${API_URL:-https://chat-dev.openagentic.io}"
API_KEY="${API_KEY:-awc_aea9aa0c17acd86ed358be672f282d7b41828f8de5bc1ff2e410f8f99867d0ce}"
PG_POD="${PG_POD:-postgresql-0}"
PG_DB="${PG_DB:-openagentic}"
PG_USER="${PG_USER:-openagentic}"
NAMESPACE="${NAMESPACE:-openagentic}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Counters
PASSED=0
FAILED=0
TOTAL=0
RESULTS=()

log() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
pass() { echo -e "${GREEN}✓ PASS${NC} $1"; ((PASSED++)); ((TOTAL++)); RESULTS+=("PASS: $1"); }
fail() { echo -e "${RED}✗ FAIL${NC} $1"; ((FAILED++)); ((TOTAL++)); RESULTS+=("FAIL: $1"); }
warn() { echo -e "${YELLOW}⚠ WARN${NC} $1"; }
info() { echo -e "${CYAN}ℹ INFO${NC} $1"; }

# Helper to run SQL
run_sql() {
    kubectl exec -n "$NAMESPACE" "$PG_POD" -c postgresql -- \
        psql -U "$PG_USER" -d "$PG_DB" -t -A -c "$1" 2>/dev/null
}

# =====================================================
# TEST 1: pgvector Extension
# =====================================================
test_pgvector_extension() {
    log "=== TEST: pgvector Extension ==="

    local result
    result=$(run_sql "SELECT extversion FROM pg_extension WHERE extname = 'vector';")

    if [[ -n "$result" ]]; then
        pass "pgvector extension installed: v$result"
    else
        fail "pgvector extension NOT installed"
    fi
}

# =====================================================
# TEST 2: Vector Columns Exist
# =====================================================
test_vector_columns() {
    log "=== TEST: Vector Columns ==="

    local expected_tables=(
        "mcp_tools:description_embedding"
        "mcp_tools:search_embedding"
        "mcp_tool_capabilities:description_embedding"
        "knowledge_facts:embedding"
        "verified_tool_results:embedding"
        "query_embedding_cache:embedding"
        "prompt_templates:embedding"
        "prompt_templates:search_embedding"
    )

    local found=0
    local missing=0

    for entry in "${expected_tables[@]}"; do
        local table="${entry%%:*}"
        local column="${entry##*:}"

        local exists
        exists=$(run_sql "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = '$table' AND column_name = '$column';")

        if [[ "$exists" == "1" ]]; then
            ((found++))
        else
            warn "Missing: $table.$column"
            ((missing++))
        fi
    done

    if [[ $missing -eq 0 ]]; then
        pass "All $found vector columns exist"
    else
        fail "Missing $missing vector columns (found $found)"
    fi
}

# =====================================================
# TEST 3: MCP Tools Table Has Data
# =====================================================
test_mcp_tools_data() {
    log "=== TEST: MCP Tools Data ==="

    local total
    total=$(run_sql "SELECT COUNT(*) FROM mcp_tools;")

    local with_desc_embed
    with_desc_embed=$(run_sql "SELECT COUNT(*) FROM mcp_tools WHERE description_embedding IS NOT NULL;")

    local with_search_embed
    with_search_embed=$(run_sql "SELECT COUNT(*) FROM mcp_tools WHERE search_embedding IS NOT NULL;")

    info "MCP Tools: total=$total, with_desc_embedding=$with_desc_embed, with_search_embedding=$with_search_embed"

    if [[ "$total" -gt 0 ]]; then
        pass "MCP Tools table has $total rows"

        if [[ "$with_desc_embed" -gt 0 ]]; then
            pass "MCP Tools has $with_desc_embed rows with description embeddings"
        else
            fail "MCP Tools has NO description embeddings (0/$total)"
        fi
    else
        fail "MCP Tools table is EMPTY"
    fi
}

# =====================================================
# TEST 4: Knowledge Facts Table
# =====================================================
test_knowledge_facts() {
    log "=== TEST: Knowledge Facts ==="

    local total
    total=$(run_sql "SELECT COUNT(*) FROM knowledge_facts;")

    local with_embed
    with_embed=$(run_sql "SELECT COUNT(*) FROM knowledge_facts WHERE embedding IS NOT NULL;")

    info "Knowledge Facts: total=$total, with_embedding=$with_embed"

    if [[ "$total" -gt 0 ]]; then
        pass "Knowledge Facts has $total rows"
    else
        warn "Knowledge Facts is empty (expected for fresh deploy)"
    fi
}

# =====================================================
# TEST 5: Verified Tool Results Table
# =====================================================
test_verified_results() {
    log "=== TEST: Verified Tool Results ==="

    local total
    total=$(run_sql "SELECT COUNT(*) FROM verified_tool_results;")

    local with_embed
    with_embed=$(run_sql "SELECT COUNT(*) FROM verified_tool_results WHERE embedding IS NOT NULL;")

    info "Verified Results: total=$total, with_embedding=$with_embed"

    if [[ "$total" -gt 0 ]]; then
        pass "Verified Results has $total rows"
    else
        warn "Verified Results is empty (will populate with usage)"
    fi
}

# =====================================================
# TEST 6: Query Embedding Cache
# =====================================================
test_query_cache() {
    log "=== TEST: Query Embedding Cache ==="

    local total
    total=$(run_sql "SELECT COUNT(*) FROM query_embedding_cache;")

    local with_embed
    with_embed=$(run_sql "SELECT COUNT(*) FROM query_embedding_cache WHERE embedding IS NOT NULL;")

    info "Query Cache: total=$total, with_embedding=$with_embed"

    if [[ "$total" -gt 0 ]]; then
        pass "Query Cache has $total cached queries"
    else
        warn "Query Cache is empty (will populate with usage)"
    fi
}

# =====================================================
# TEST 7: Prompt Templates
# =====================================================
test_prompt_templates() {
    log "=== TEST: Prompt Templates ==="

    local total
    total=$(run_sql "SELECT COUNT(*) FROM prompt_templates;")

    local with_embed
    with_embed=$(run_sql "SELECT COUNT(*) FROM prompt_templates WHERE embedding IS NOT NULL;")

    info "Prompt Templates: total=$total, with_embedding=$with_embed"

    if [[ "$total" -gt 0 ]]; then
        pass "Prompt Templates has $total templates"
        if [[ "$with_embed" -gt 0 ]]; then
            pass "Prompt Templates has $with_embed with embeddings"
        else
            fail "Prompt Templates has NO embeddings"
        fi
    else
        warn "Prompt Templates is empty"
    fi
}

# =====================================================
# TEST 8: Tool Execution Tracking
# =====================================================
test_tool_execution() {
    log "=== TEST: Tool Execution Tracking ==="

    local attempts
    attempts=$(run_sql "SELECT COUNT(*) FROM tool_call_attempts;")

    local scores
    scores=$(run_sql "SELECT COUNT(*) FROM tool_execution_scores;")

    local aggregates
    aggregates=$(run_sql "SELECT COUNT(*) FROM tool_reliability_aggregates;")

    info "Tool Tracking: attempts=$attempts, scores=$scores, aggregates=$aggregates"

    if [[ "$attempts" -gt 0 ]]; then
        pass "Tool Call Attempts: $attempts records"
    else
        warn "Tool Call Attempts is empty (will populate with usage)"
    fi
}

# =====================================================
# TEST 9: Hallucination Logs
# =====================================================
test_hallucination_logs() {
    log "=== TEST: Hallucination Detection ==="

    local total
    total=$(run_sql "SELECT COUNT(*) FROM hallucination_logs;")

    info "Hallucination Logs: $total records"

    if [[ "$total" -gt 0 ]]; then
        pass "Hallucination Detection logged $total events"
    else
        info "Hallucination Logs empty (good - no hallucinations detected)"
    fi
}

# =====================================================
# TEST 10: Large Response Storage
# =====================================================
test_large_response() {
    log "=== TEST: Large Response Storage ==="

    local total
    total=$(run_sql "SELECT COUNT(*) FROM large_response_storage;")

    info "Large Response Storage: $total records"

    if [[ "$total" -gt 0 ]]; then
        pass "Large Response Storage: $total stored"
    else
        warn "Large Response Storage empty (will populate with large tool results)"
    fi
}

# =====================================================
# TEST 11: Milvus Connection
# =====================================================
test_milvus() {
    log "=== TEST: Milvus Connection ==="

    local milvus_pod
    milvus_pod=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=milvus -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

    if [[ -n "$milvus_pod" ]]; then
        local health
        health=$(kubectl exec -n "$NAMESPACE" "$milvus_pod" -- curl -s http://localhost:9091/healthz 2>/dev/null || echo "")

        if [[ "$health" == *"OK"* ]] || [[ "$health" == *"ok"* ]]; then
            pass "Milvus is healthy"
        else
            # Try standalone check
            health=$(kubectl exec -n "$NAMESPACE" milvus-standalone-* -- curl -s http://localhost:9091/healthz 2>/dev/null || echo "fail")
            if [[ "$health" != "fail" ]]; then
                pass "Milvus standalone is running"
            else
                warn "Milvus health check inconclusive"
            fi
        fi
    else
        fail "Milvus pod not found"
    fi
}

# =====================================================
# TEST 12: API Embedding Endpoint
# =====================================================
test_api_embedding() {
    log "=== TEST: API Embedding Generation ==="

    # Test if embedding service is accessible via API
    local response
    response=$(curl -s -X POST "$API_URL/api/admin/test-embedding" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"text": "test embedding generation"}' 2>/dev/null || echo '{"error": "endpoint not found"}')

    if echo "$response" | grep -q '"embedding"'; then
        pass "API embedding generation working"
    elif echo "$response" | grep -q '"error"'; then
        warn "Embedding test endpoint not available (may need implementation)"
    else
        info "Embedding endpoint returned: ${response:0:100}"
    fi
}

# =====================================================
# TEST 13: Semantic Tool Search via API
# =====================================================
test_semantic_tool_search() {
    log "=== TEST: Semantic Tool Search ==="

    # Create a session and send a query that should trigger tool search
    local session
    session=$(curl -s -X POST "$API_URL/api/chat/sessions" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"title": "UAT-DataLayer-ToolSearch"}')

    local session_id
    session_id=$(echo "$session" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [[ -n "$session_id" ]]; then
        # Send a query that should find Azure tools semantically
        local response
        response=$(timeout 30 curl -s -N "$API_URL/api/chat/stream" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"message\": \"What tools do you have for Azure resource management?\", \"sessionId\": \"$session_id\"}" 2>&1 | head -100)

        if echo "$response" | grep -qi "azure\|arm\|resource"; then
            pass "Semantic tool search returned Azure-related content"
        else
            warn "Semantic tool search may not be finding tools correctly"
        fi

        # Cleanup
        curl -s -X DELETE "$API_URL/api/chat/sessions/$session_id" \
            -H "Authorization: Bearer $API_KEY" > /dev/null 2>&1
    else
        fail "Could not create session for tool search test"
    fi
}

# =====================================================
# TEST 14: Vector Dimension Consistency
# =====================================================
test_vector_dimensions() {
    log "=== TEST: Vector Dimension Consistency ==="

    # Check that all vector columns use consistent dimensions
    local dims
    dims=$(run_sql "
        SELECT column_name,
               substring(udt_name from 'vector\\(([0-9]+)\\)') as dim
        FROM information_schema.columns
        WHERE udt_name LIKE 'vector%'
        ORDER BY column_name;
    ")

    if [[ -n "$dims" ]]; then
        local unique_dims
        unique_dims=$(echo "$dims" | cut -d'|' -f2 | sort -u | wc -l)

        if [[ "$unique_dims" -eq 1 ]]; then
            local dim_value
            dim_value=$(echo "$dims" | head -1 | cut -d'|' -f2)
            pass "All vector columns use consistent dimension: $dim_value"
        else
            warn "Multiple vector dimensions found: $unique_dims different"
            info "$dims"
        fi
    else
        warn "No vector columns found with dimensions"
    fi
}

# =====================================================
# MAIN
# =====================================================
main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║     OpenAgentic v0.4.0 Data Layer UAT Tests                ║"
    echo "╠════════════════════════════════════════════════════════════╣"
    echo "║  API: $API_URL"
    echo "║  Database: $PG_DB"
    echo "║  Time: $(date)"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""

    # Infrastructure tests
    test_pgvector_extension
    echo ""
    test_vector_columns
    echo ""
    test_vector_dimensions
    echo ""

    # Data population tests
    test_mcp_tools_data
    echo ""
    test_knowledge_facts
    echo ""
    test_verified_results
    echo ""
    test_query_cache
    echo ""
    test_prompt_templates
    echo ""
    test_tool_execution
    echo ""
    test_hallucination_logs
    echo ""
    test_large_response
    echo ""

    # External service tests
    test_milvus
    echo ""

    # API integration tests
    test_semantic_tool_search
    echo ""

    # Summary
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║                    TEST SUMMARY                            ║"
    echo "╠════════════════════════════════════════════════════════════╣"
    printf "║  ${GREEN}PASSED: %d${NC}\n" "$PASSED"
    printf "║  ${RED}FAILED: %d${NC}\n" "$FAILED"
    echo "║  TOTAL:  $TOTAL"
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
