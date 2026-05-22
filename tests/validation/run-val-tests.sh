

# v0.5.0 Interactive Multi-Turn Validation Tests
# These tests INTERACT with the platform like a real user would:
# - Send an initial request
# - Parse the response and ask follow-up questions
# - Verify corrections and final state
# - Check all relevant logs for errors

set +e  # Don't exit on error - we want all tests to run

API_URL="${API_URL:-http://localhost:8080}"
API_KEY="${API_KEY:-awc_6c0d94934b7f76fceebc37ed8ec6b3440084c8cd397e437ecb261aa5e6fbff96}"
TIMEOUT="${TIMEOUT:-180}"
RESULTS_DIR="$(dirname "$0")/results/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
PARTIAL_COUNT=0

# Create a session and return session ID
create_session() {
    local title="$1"
    local response
    response=$(curl -s -X POST "$API_URL/api/chat/sessions" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"title\": \"$title\"}" 2>/dev/null) || true
    echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin)['session']['id'])" 2>/dev/null || echo ""
}

# Send a message and capture the full SSE stream
send_message() {
    local session_id="$1"
    local message="$2"
    local outfile="$3"

    local json_msg
    json_msg=$(echo "$message" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))' 2>/dev/null)

    timeout "$TIMEOUT" curl -s -N "$API_URL/api/chat/stream" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"message\": $json_msg, \"sessionId\": \"$session_id\"}" \
        > "$outfile" 2>&1 || true
}

# Extract text content from SSE stream
extract_content() {
    local file="$1"
    grep -A1 "^event: content_block_delta" "$file" 2>/dev/null | grep "^data:" | sed 's/^data://' | python3 -c "
import json, sys, re
content = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        if d.get('blockType') == 'text':
            content.append(d.get('content',''))
    except: pass
text = ''.join(content)
text = re.sub(r'<thinking>.*?</thinking>', '', text, flags=re.DOTALL)
text = re.sub(r'<thinking>.*$', '', text, flags=re.DOTALL)
print(text.strip())
" 2>/dev/null
}

# Count tool calls in response
count_tool_calls() {
    local file="$1"
    local count
    count=$(grep -c "^event: tool_executing" "$file" 2>/dev/null) || true
    echo "${count:-0}"
}

# Extract tool names from response
extract_tool_names() {
    local file="$1"
    grep -A1 "^event: tool_executing" "$file" 2>/dev/null | grep "^data:" | sed 's/^data://' | python3 -c "
import json, sys
tools = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        name = d.get('toolName', d.get('name', ''))
        if name: tools.append(name)
    except: pass
print(', '.join(tools))
" 2>/dev/null
}

# Check for errors in SSE stream
extract_errors() {
    local file="$1"
    grep -A1 "^event: error" "$file" 2>/dev/null | grep "^data:" | sed 's/^data://' || true
}

# Check k8s logs for errors during a test
check_k8s_logs() {
    local test_id="$1"
    local since="$2"  # e.g., "5m"
    local logfile="$RESULTS_DIR/${test_id}-k8s-errors.log"

    # Check API logs
    kubectl logs -n agentic-dev -l app.kubernetes.io/component=api --since="$since" 2>/dev/null | \
        grep -i "error\|exception\|fatal\|panic" | tail -20 > "$logfile" 2>/dev/null || true

    # Check MCP proxy logs
    kubectl logs -n agentic-dev -l app.kubernetes.io/component=mcp-proxy --since="$since" 2>/dev/null | \
        grep -i "error\|exception\|fatal\|traceback" | tail -20 >> "$logfile" 2>/dev/null || true

    local error_count
    error_count=$(wc -l < "$logfile" 2>/dev/null || echo "0")
    error_count=$(echo "$error_count" | tr -d ' ')

    if [ "$error_count" -gt 0 ]; then
        echo "  [LOGS] $error_count error(s) found in k8s logs (see ${test_id}-k8s-errors.log)"
    fi
}

# Report test result
report() {
    local test_id="$1"
    local status="$2"  # PASS, FAIL, PARTIAL
    local details="$3"

    case "$status" in
        PASS)    echo -e "${GREEN}[PASS]${NC} $test_id: $details"; ((PASS_COUNT++)) ;;
        FAIL)    echo -e "${RED}[FAIL]${NC} $test_id: $details"; ((FAIL_COUNT++)) ;;
        PARTIAL) echo -e "${YELLOW}[PARTIAL]${NC} $test_id: $details"; ((PARTIAL_COUNT++)) ;;
    esac
    echo "$status: $details" >> "$RESULTS_DIR/$test_id.result"
}

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  v0.5.0 Multi-Turn Validation Suite${NC}"
echo -e "${CYAN}  $(date)${NC}"
echo -e "${CYAN}  API: $API_URL${NC}"
echo -e "${CYAN}  Results: $RESULTS_DIR${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

###############################################################################
# VAL-01: Infrastructure Health Audit (3 turns)
###############################################################################
echo -e "${CYAN}--- VAL-01: Infrastructure Health Audit (Multi-Turn) ---${NC}"
SESSION_01=$(create_session "VAL-01: Infrastructure Health Audit")
echo "  Session: $SESSION_01"

# Turn 1: Initial health check
echo "  Turn 1: Initial health audit request..."
send_message "$SESSION_01" "Run a complete infrastructure health audit. Use admin_full_system_test, admin_system_postgres_health_check, admin_system_redis_health_check, admin_system_milvus_health_check, k8s_cluster_health, and prometheus_health_summary. Report the status of each subsystem." \
    "$RESULTS_DIR/VAL-01-T1.sse"

T1_CONTENT=$(extract_content "$RESULTS_DIR/VAL-01-T1.sse")
T1_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-01-T1.sse")
T1_TOOL_NAMES=$(extract_tool_names "$RESULTS_DIR/VAL-01-T1.sse")
echo "    Tools used ($T1_TOOLS): $T1_TOOL_NAMES"

# Turn 2: Follow-up based on results - ask about specific findings
echo "  Turn 2: Follow-up on health findings..."
if echo "$T1_CONTENT" | grep -qi "fail\|error\|down\|unhealthy\|warning"; then
    FOLLOWUP_01="I see some issues in the health audit. Please investigate further:
1. Use admin_system_postgres_raw_query to run: SELECT tablename, n_dead_tup, last_vacuum FROM pg_stat_user_tables WHERE n_dead_tup > 1000 ORDER BY n_dead_tup DESC LIMIT 5
2. Use loki_search_errors for namespace 'agentic-dev' in the last 30 minutes
3. Use k8s_list_pods in agentic-dev and show me any pods that have restarted more than once
What's causing the issues you found?"
else
    FOLLOWUP_01="Good - the systems look healthy. Now dig deeper:
1. Use admin_system_postgres_raw_query to show database size: SELECT pg_size_pretty(pg_database_size(current_database())) as db_size
2. Use admin_system_redis_list_keys_by_pattern with pattern '*' and limit 50 to show cache utilization
3. Use admin_system_milvus_list_collections and get info on the largest collection
4. How much data is stored across all three data layers?"
fi

send_message "$SESSION_01" "$FOLLOWUP_01" "$RESULTS_DIR/VAL-01-T2.sse"
T2_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-01-T2.sse")
T2_TOOL_NAMES=$(extract_tool_names "$RESULTS_DIR/VAL-01-T2.sse")
echo "    Tools used ($T2_TOOLS): $T2_TOOL_NAMES"

# Turn 3: Verification and summary
echo "  Turn 3: Summary request..."
send_message "$SESSION_01" "Based on everything you found in the last two checks, give me a final health score from 0-100 and list the top 3 things that need attention. Be specific with actual numbers from your queries." \
    "$RESULTS_DIR/VAL-01-T3.sse"

T3_CONTENT=$(extract_content "$RESULTS_DIR/VAL-01-T3.sse")
TOTAL_TOOLS=$((T1_TOOLS + T2_TOOLS + $(count_tool_calls "$RESULTS_DIR/VAL-01-T3.sse")))
echo "$T1_CONTENT" > "$RESULTS_DIR/VAL-01.txt"
echo "---TURN 2---" >> "$RESULTS_DIR/VAL-01.txt"
echo "$(extract_content "$RESULTS_DIR/VAL-01-T2.sse")" >> "$RESULTS_DIR/VAL-01.txt"
echo "---TURN 3---" >> "$RESULTS_DIR/VAL-01.txt"
echo "$T3_CONTENT" >> "$RESULTS_DIR/VAL-01.txt"

check_k8s_logs "VAL-01" "10m"

if [ "$TOTAL_TOOLS" -ge 8 ] && echo "$T3_CONTENT" | grep -qi "score\|health\|attention\|100\|recommend"; then
    report "VAL-01" "PASS" "3-turn health audit with $TOTAL_TOOLS total tool calls"
elif [ "$TOTAL_TOOLS" -ge 4 ]; then
    report "VAL-01" "PARTIAL" "$TOTAL_TOOLS tool calls across 3 turns (expected 10+)"
else
    report "VAL-01" "FAIL" "Only $TOTAL_TOOLS total tool calls across 3 turns"
fi

###############################################################################
# VAL-02: K8s Deployment Lifecycle (3 turns)
###############################################################################
echo -e "${CYAN}--- VAL-02: K8s Deployment Lifecycle (Multi-Turn) ---${NC}"
SESSION_02=$(create_session "VAL-02: K8s Deploy Lifecycle")
echo "  Session: $SESSION_02"

# Turn 1: Create deployment
echo "  Turn 1: Create test pod..."
send_message "$SESSION_02" "Create a test pod in the agentic-dev namespace using k8s_apply_yaml with this YAML:
---
apiVersion: v1
kind: Pod
metadata:
  name: val-test-nginx
  namespace: agentic-dev
  labels:
    app: val-test
    test: val-02
spec:
  containers:
  - name: nginx
    image: nginx:alpine
    ports:
    - containerPort: 80
    resources:
      limits:
        memory: 64Mi
        cpu: 100m

Then use k8s_list_pods with namespace agentic-dev and label selector 'test=val-02' to verify it was created." \
    "$RESULTS_DIR/VAL-02-T1.sse"

T1_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-02-T1.sse")
T1_CONTENT=$(extract_content "$RESULTS_DIR/VAL-02-T1.sse")
echo "    Tools used ($T1_TOOLS)"

# Turn 2: Inspect and modify
echo "  Turn 2: Inspect and modify pod..."
if echo "$T1_CONTENT" | grep -qi "created\|running\|val-test-nginx"; then
    FOLLOWUP="Great, the pod was created. Now:
1. Use k8s_get_pod to get the pod details including its IP address and node
2. Use k8s_patch_resource to add annotation 'validated-by=openagentic-val-suite' to the pod
3. Use k8s_get_pod again to confirm the annotation was applied
Show me the pod's IP, node, and annotations."
else
    FOLLOWUP="The pod creation may have failed. Please:
1. Use k8s_get_events in namespace agentic-dev to see what happened
2. Try creating it again or check if it already exists with k8s_list_pods
3. Report what went wrong and the actual error."
fi

send_message "$SESSION_02" "$FOLLOWUP" "$RESULTS_DIR/VAL-02-T2.sse"
T2_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-02-T2.sse")
echo "    Tools used ($T2_TOOLS)"

# Turn 3: Cleanup and verify
echo "  Turn 3: Cleanup test pod..."
send_message "$SESSION_02" "Now clean up:
1. Use k8s_delete_pod to delete the val-test-nginx pod from agentic-dev namespace
2. Use k8s_list_pods with label selector 'test=val-02' to confirm it's gone
Report the final status - was the full lifecycle successful?" \
    "$RESULTS_DIR/VAL-02-T3.sse"

T3_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-02-T3.sse")
T3_CONTENT=$(extract_content "$RESULTS_DIR/VAL-02-T3.sse")
TOTAL_TOOLS=$((T1_TOOLS + T2_TOOLS + T3_TOOLS))

echo "$(extract_content "$RESULTS_DIR/VAL-02-T1.sse")" > "$RESULTS_DIR/VAL-02.txt"
echo "---TURN 2---" >> "$RESULTS_DIR/VAL-02.txt"
echo "$(extract_content "$RESULTS_DIR/VAL-02-T2.sse")" >> "$RESULTS_DIR/VAL-02.txt"
echo "---TURN 3---" >> "$RESULTS_DIR/VAL-02.txt"
echo "$T3_CONTENT" >> "$RESULTS_DIR/VAL-02.txt"

check_k8s_logs "VAL-02" "10m"

if [ "$TOTAL_TOOLS" -ge 6 ] && echo "$T3_CONTENT" | grep -qi "deleted\|cleaned\|success\|gone"; then
    report "VAL-02" "PASS" "3-turn K8s lifecycle with $TOTAL_TOOLS tool calls"
elif [ "$TOTAL_TOOLS" -ge 3 ]; then
    report "VAL-02" "PARTIAL" "$TOTAL_TOOLS tool calls across 3 turns (expected 7+)"
else
    report "VAL-02" "FAIL" "Only $TOTAL_TOOLS tool calls - lifecycle incomplete"
fi

###############################################################################
# VAL-03: Research + Knowledge Synthesis (2 turns)
###############################################################################
echo -e "${CYAN}--- VAL-03: Research + Knowledge Synthesis (Multi-Turn) ---${NC}"
SESSION_03=$(create_session "VAL-03: Research + Knowledge Synthesis")
echo "  Session: $SESSION_03"

# Turn 1: Research
echo "  Turn 1: Research FedRAMP for AI..."
send_message "$SESSION_03" "Search for 'FedRAMP AI ML authorization requirements 2025 2026' using web_search. Also search for 'NIST AI Risk Management Framework'. Fetch the top 2 most relevant URLs using web_fetch. Store a summary of key findings using web_store_knowledge. Report what you found." \
    "$RESULTS_DIR/VAL-03-T1.sse"

T1_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-03-T1.sse")
T1_CONTENT=$(extract_content "$RESULTS_DIR/VAL-03-T1.sse")
echo "    Tools used ($T1_TOOLS)"

# Turn 2: Follow-up - synthesize and compare
echo "  Turn 2: Synthesize and create gap analysis..."
send_message "$SESSION_03" "Based on the FedRAMP research you just did, now:
1. Use admin_system_postgres_raw_query to check our platform data: SELECT COUNT(*) as total_users FROM \"User\"; and SELECT COUNT(*) as total_sessions FROM \"ChatSession\";
2. Create a gap analysis: compare FedRAMP AI requirements against what you know about this OpenAgentic platform
3. List the top 5 compliance gaps with severity ratings (Critical/High/Medium/Low)
4. What specific changes would we need to make to achieve FedRAMP Moderate authorization?" \
    "$RESULTS_DIR/VAL-03-T2.sse"

T2_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-03-T2.sse")
T2_CONTENT=$(extract_content "$RESULTS_DIR/VAL-03-T2.sse")
TOTAL_TOOLS=$((T1_TOOLS + T2_TOOLS))

echo "$T1_CONTENT" > "$RESULTS_DIR/VAL-03.txt"
echo "---TURN 2---" >> "$RESULTS_DIR/VAL-03.txt"
echo "$T2_CONTENT" >> "$RESULTS_DIR/VAL-03.txt"

check_k8s_logs "VAL-03" "10m"

if [ "$TOTAL_TOOLS" -ge 5 ] && echo "$T2_CONTENT" | grep -qi "gap\|compliance\|FedRAMP\|risk\|critical\|recommendation"; then
    report "VAL-03" "PASS" "2-turn research + gap analysis with $TOTAL_TOOLS tool calls"
elif [ "$TOTAL_TOOLS" -ge 3 ]; then
    report "VAL-03" "PARTIAL" "$TOTAL_TOOLS tool calls (expected 6+)"
else
    report "VAL-03" "FAIL" "Only $TOTAL_TOOLS tool calls - research incomplete"
fi

###############################################################################
# VAL-04: Incident Response (3 turns)
###############################################################################
echo -e "${CYAN}--- VAL-04: Incident Response Simulation (Multi-Turn) ---${NC}"
SESSION_04=$(create_session "VAL-04: Incident Response")
echo "  Session: $SESSION_04"

# Turn 1: Create incident and initial diagnostics
echo "  Turn 1: Create incident + initial diagnostics..."
send_message "$SESSION_04" "Create a P2 incident using incident_create titled 'VAL-04 Test: API Latency Spike' with description 'Automated test - elevated p99 latency detected'. Then immediately start diagnostics:
1. Use prometheus_query with query 'up' to check service availability
2. Use k8s_list_pods in agentic-dev to check pod health
3. Use loki_search_errors for namespace 'agentic-dev' in the last 15 minutes
Report the incident ID and initial findings." \
    "$RESULTS_DIR/VAL-04-T1.sse"

T1_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-04-T1.sse")
T1_CONTENT=$(extract_content "$RESULTS_DIR/VAL-04-T1.sse")
echo "    Tools used ($T1_TOOLS)"

# Turn 2: Deeper investigation based on findings
echo "  Turn 2: Investigate findings..."
send_message "$SESSION_04" "Based on what you found, dig deeper:
1. Use runbook_list to find available runbooks
2. Use runbook_quick_diagnostics for the 'openagentic-api' service
3. Use incident_add_note to add your findings to the incident
What's the likely root cause based on your investigation?" \
    "$RESULTS_DIR/VAL-04-T2.sse"

T2_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-04-T2.sse")
echo "    Tools used ($T2_TOOLS)"

# Turn 3: Resolve incident
echo "  Turn 3: Resolve incident..."
send_message "$SESSION_04" "Now resolve the incident:
1. Use incident_resolve with a summary of what was found and the likely root cause
2. Use incident_list to verify the incident shows as resolved
Report the final incident state and lessons learned." \
    "$RESULTS_DIR/VAL-04-T3.sse"

T3_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-04-T3.sse")
T3_CONTENT=$(extract_content "$RESULTS_DIR/VAL-04-T3.sse")
TOTAL_TOOLS=$((T1_TOOLS + T2_TOOLS + T3_TOOLS))

echo "$(extract_content "$RESULTS_DIR/VAL-04-T1.sse")" > "$RESULTS_DIR/VAL-04.txt"
echo "---TURN 2---" >> "$RESULTS_DIR/VAL-04.txt"
echo "$(extract_content "$RESULTS_DIR/VAL-04-T2.sse")" >> "$RESULTS_DIR/VAL-04.txt"
echo "---TURN 3---" >> "$RESULTS_DIR/VAL-04.txt"
echo "$T3_CONTENT" >> "$RESULTS_DIR/VAL-04.txt"

check_k8s_logs "VAL-04" "10m"

if [ "$TOTAL_TOOLS" -ge 6 ] && echo "$T3_CONTENT" | grep -qi "resolve\|resolved\|root cause\|finding\|closed"; then
    report "VAL-04" "PASS" "3-turn incident lifecycle with $TOTAL_TOOLS tool calls"
elif [ "$TOTAL_TOOLS" -ge 3 ]; then
    report "VAL-04" "PARTIAL" "$TOTAL_TOOLS tool calls (expected 8+)"
else
    report "VAL-04" "FAIL" "Only $TOTAL_TOOLS tool calls - incident incomplete"
fi

###############################################################################
# VAL-05: Cross-Cloud Cost Analysis (2 turns)
###############################################################################
echo -e "${CYAN}--- VAL-05: Cross-Cloud Cost Analysis (Multi-Turn) ---${NC}"
SESSION_05=$(create_session "VAL-05: Cross-Cloud Cost Analysis")
echo "  Session: $SESSION_05"

# Turn 1: Gather cost data from both clouds
echo "  Turn 1: Gather cost data..."
send_message "$SESSION_05" "Get cost data from both clouds:
1. Use aws_identity to check AWS account
2. Use aws_cost_summary for current month's AWS spend
3. Use aws_cost_by_service for AWS service breakdown
4. Use azure_list_subscriptions to check Azure subscriptions
5. Use azure_cost_query with timeframe 'MonthToDate'
6. Use azure_cost_by_service with timeframe 'MonthToDate'
Report all data even if some calls fail due to permissions." \
    "$RESULTS_DIR/VAL-05-T1.sse"

T1_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-05-T1.sse")
T1_CONTENT=$(extract_content "$RESULTS_DIR/VAL-05-T1.sse")
echo "    Tools used ($T1_TOOLS)"

# Turn 2: Analysis and optimization
echo "  Turn 2: Analyze and optimize..."
send_message "$SESSION_05" "Based on the cost data you gathered:
1. Use azure_cost_forecast to project end-of-month costs
2. Create a unified cost comparison table (AWS vs Azure)
3. Identify the top 3 cost optimization opportunities with estimated monthly savings
4. Which services could we right-size or consolidate?
5. Are there any anomalous charges that look unexpected?" \
    "$RESULTS_DIR/VAL-05-T2.sse"

T2_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-05-T2.sse")
T2_CONTENT=$(extract_content "$RESULTS_DIR/VAL-05-T2.sse")
TOTAL_TOOLS=$((T1_TOOLS + T2_TOOLS))

echo "$T1_CONTENT" > "$RESULTS_DIR/VAL-05.txt"
echo "---TURN 2---" >> "$RESULTS_DIR/VAL-05.txt"
echo "$T2_CONTENT" >> "$RESULTS_DIR/VAL-05.txt"

check_k8s_logs "VAL-05" "10m"

if [ "$TOTAL_TOOLS" -ge 5 ] && echo "$T2_CONTENT" | grep -qi "cost\|saving\|optim\|forecast\|total"; then
    report "VAL-05" "PASS" "2-turn cost analysis with $TOTAL_TOOLS tool calls"
elif [ "$TOTAL_TOOLS" -ge 3 ]; then
    report "VAL-05" "PARTIAL" "$TOTAL_TOOLS tool calls (expected 7+)"
else
    report "VAL-05" "FAIL" "Only $TOTAL_TOOLS tool calls"
fi

###############################################################################
# VAL-06: Flowise Workflow Lifecycle (3 turns)
###############################################################################
echo -e "${CYAN}--- VAL-06: Flowise Workflow Lifecycle (Multi-Turn) ---${NC}"
SESSION_06=$(create_session "VAL-06: Flowise Workflow CRUD")
echo "  Session: $SESSION_06"

# Turn 1: Discover and create
echo "  Turn 1: Discover and create workflow..."
send_message "$SESSION_06" "Test Flowise workflow management:
1. Use flowise_health_check to verify Flowise is running
2. Use flowise_list_chatflows to see existing workflows
3. Use flowise_list_nodes to discover available node types
4. Use flowise_create_chatflow to create a workflow called 'VAL-06-Test-Flow' with a basic LLM chain
Report what you created and the chatflow ID." \
    "$RESULTS_DIR/VAL-06-T1.sse"

T1_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-06-T1.sse")
T1_CONTENT=$(extract_content "$RESULTS_DIR/VAL-06-T1.sse")
echo "    Tools used ($T1_TOOLS)"

# Turn 2: Validate and inspect
echo "  Turn 2: Validate the workflow..."
send_message "$SESSION_06" "Now validate the workflow you created:
1. Use flowise_validate_flow on the 'VAL-06-Test-Flow' chatflow
2. Use flowise_list_chatflows to confirm it appears in the list
3. Use flowise_get_workflow_analytics to check analytics
Is the workflow valid? What did the validation report say?" \
    "$RESULTS_DIR/VAL-06-T2.sse"

T2_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-06-T2.sse")
echo "    Tools used ($T2_TOOLS)"

# Turn 3: Cleanup
echo "  Turn 3: Cleanup..."
send_message "$SESSION_06" "Clean up the test workflow:
1. Use flowise_delete_chatflow to delete 'VAL-06-Test-Flow'
2. Use flowise_list_chatflows to confirm it's gone
Was the full CRUD lifecycle successful? What was the final chatflow count?" \
    "$RESULTS_DIR/VAL-06-T3.sse"

T3_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-06-T3.sse")
T3_CONTENT=$(extract_content "$RESULTS_DIR/VAL-06-T3.sse")
TOTAL_TOOLS=$((T1_TOOLS + T2_TOOLS + T3_TOOLS))

echo "$(extract_content "$RESULTS_DIR/VAL-06-T1.sse")" > "$RESULTS_DIR/VAL-06.txt"
echo "---TURN 2---" >> "$RESULTS_DIR/VAL-06.txt"
echo "$(extract_content "$RESULTS_DIR/VAL-06-T2.sse")" >> "$RESULTS_DIR/VAL-06.txt"
echo "---TURN 3---" >> "$RESULTS_DIR/VAL-06.txt"
echo "$T3_CONTENT" >> "$RESULTS_DIR/VAL-06.txt"

check_k8s_logs "VAL-06" "10m"

if [ "$TOTAL_TOOLS" -ge 7 ] && echo "$T3_CONTENT" | grep -qi "deleted\|removed\|success\|lifecycle\|gone"; then
    report "VAL-06" "PASS" "3-turn Flowise lifecycle with $TOTAL_TOOLS tool calls"
elif [ "$TOTAL_TOOLS" -ge 4 ]; then
    report "VAL-06" "PARTIAL" "$TOTAL_TOOLS tool calls (expected 9+)"
else
    report "VAL-06" "FAIL" "Only $TOTAL_TOOLS tool calls"
fi

###############################################################################
# VAL-07: GitHub Analysis (2 turns)
###############################################################################
echo -e "${CYAN}--- VAL-07: GitHub + CI/CD Analysis (Multi-Turn) ---${NC}"
SESSION_07=$(create_session "VAL-07: GitHub CI/CD Analysis")
echo "  Session: $SESSION_07"

# Turn 1: Discover repos
echo "  Turn 1: Discover GitHub repos..."
send_message "$SESSION_07" "Analyze GitHub repositories:
1. Use get_user to check the authenticated GitHub account
2. Use list_repos to list available repositories
3. Use search_repos to search for 'openagentic' repositories
4. For any repo found, use list_branches and list_commits for the main branch
Even if some calls fail, report what you can access." \
    "$RESULTS_DIR/VAL-07-T1.sse"

T1_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-07-T1.sse")
T1_CONTENT=$(extract_content "$RESULTS_DIR/VAL-07-T1.sse")
echo "    Tools used ($T1_TOOLS)"

# Turn 2: CI/CD and issues analysis
echo "  Turn 2: Analyze CI/CD and issues..."
send_message "$SESSION_07" "Now check CI/CD and issues:
1. Use list_workflows to check CI/CD pipelines
2. Use get_workflow_runs for recent run results
3. Use list_issues to check open issues
4. Use list_pull_requests for open PRs
Summarize: Is CI/CD green? How many open issues/PRs? What's the project health?" \
    "$RESULTS_DIR/VAL-07-T2.sse"

T2_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-07-T2.sse")
T2_CONTENT=$(extract_content "$RESULTS_DIR/VAL-07-T2.sse")
TOTAL_TOOLS=$((T1_TOOLS + T2_TOOLS))

echo "$T1_CONTENT" > "$RESULTS_DIR/VAL-07.txt"
echo "---TURN 2---" >> "$RESULTS_DIR/VAL-07.txt"
echo "$T2_CONTENT" >> "$RESULTS_DIR/VAL-07.txt"

check_k8s_logs "VAL-07" "10m"

if [ "$TOTAL_TOOLS" -ge 4 ] && echo "$T2_CONTENT" | grep -qi "github\|repo\|branch\|workflow\|commit\|issue"; then
    report "VAL-07" "PASS" "2-turn GitHub analysis with $TOTAL_TOOLS tool calls"
elif [ "$TOTAL_TOOLS" -ge 2 ]; then
    report "VAL-07" "PARTIAL" "$TOTAL_TOOLS tool calls (expected 6+)"
else
    report "VAL-07" "FAIL" "Only $TOTAL_TOOLS tool calls"
fi

###############################################################################
# VAL-08: Database Forensics (2 turns)
###############################################################################
echo -e "${CYAN}--- VAL-08: Database Forensics (Multi-Turn) ---${NC}"
SESSION_08=$(create_session "VAL-08: Database Forensics")
echo "  Session: $SESSION_08"

# Turn 1: Enumerate and size
echo "  Turn 1: Database enumeration..."
send_message "$SESSION_08" "Run database forensics:
1. Use admin_system_postgres_list_tables to enumerate all tables
2. Use admin_system_postgres_raw_query: SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 15
3. Use admin_system_redis_health_check
4. Use admin_system_redis_list_keys_by_pattern with pattern '*' limit 50
5. Use admin_system_milvus_list_collections
Report the data layer status: total tables, largest tables, Redis key count, Milvus collections." \
    "$RESULTS_DIR/VAL-08-T1.sse"

T1_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-08-T1.sse")
T1_CONTENT=$(extract_content "$RESULTS_DIR/VAL-08-T1.sse")
echo "    Tools used ($T1_TOOLS)"

# Turn 2: User activity and health
echo "  Turn 2: User activity analysis..."
send_message "$SESSION_08" "Now analyze user activity and system config:
1. Use admin_system_postgres_raw_query: SELECT u.email, COUNT(cs.id) as sessions, MAX(cs.\"updatedAt\") as last_active FROM \"User\" u LEFT JOIN \"ChatSession\" cs ON u.id = cs.\"userId\" GROUP BY u.email ORDER BY sessions DESC LIMIT 10
2. Use admin_system_postgres_raw_query: SELECT role, COUNT(*) as count FROM \"ChatMessage\" GROUP BY role
3. Use admin_system_postgres_raw_query: SELECT name, value FROM \"SystemConfiguration\" LIMIT 10
4. For any Milvus collection found, use admin_system_milvus_get_collection_info
Summarize: Who are the most active users? How many messages total? What's the system configuration?" \
    "$RESULTS_DIR/VAL-08-T2.sse"

T2_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-08-T2.sse")
T2_CONTENT=$(extract_content "$RESULTS_DIR/VAL-08-T2.sse")
TOTAL_TOOLS=$((T1_TOOLS + T2_TOOLS))

echo "$T1_CONTENT" > "$RESULTS_DIR/VAL-08.txt"
echo "---TURN 2---" >> "$RESULTS_DIR/VAL-08.txt"
echo "$T2_CONTENT" >> "$RESULTS_DIR/VAL-08.txt"

check_k8s_logs "VAL-08" "10m"

if [ "$TOTAL_TOOLS" -ge 7 ] && echo "$T2_CONTENT" | grep -qi "user\|session\|message\|table\|rows"; then
    report "VAL-08" "PASS" "2-turn DB forensics with $TOTAL_TOOLS tool calls"
elif [ "$TOTAL_TOOLS" -ge 4 ]; then
    report "VAL-08" "PARTIAL" "$TOTAL_TOOLS tool calls (expected 9+)"
else
    report "VAL-08" "FAIL" "Only $TOTAL_TOOLS tool calls"
fi

###############################################################################
# VAL-09: Agent Architect (2 turns)
###############################################################################
echo -e "${CYAN}--- VAL-09: Agent Architect + Design (Multi-Turn) ---${NC}"
SESSION_09=$(create_session "VAL-09: Agent Architecture Design")
echo "  Session: $SESSION_09"

# Turn 1: Discover capabilities
echo "  Turn 1: Discover agentic capabilities..."
send_message "$SESSION_09" "I want to design a multi-agent security incident response system. First, discover what's available:
1. Use list_agent_templates to see existing agent templates
2. Use get_framework_status to check which frameworks are active
3. Use list_available_tools to see MCP tools we can assign to agents
4. Use suggest_tools_for_task with task 'automated security incident response'
Report what templates, frameworks, and tools are available for building agents." \
    "$RESULTS_DIR/VAL-09-T1.sse"

T1_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-09-T1.sse")
T1_CONTENT=$(extract_content "$RESULTS_DIR/VAL-09-T1.sse")
echo "    Tools used ($T1_TOOLS)"

# Turn 2: Design agents
echo "  Turn 2: Design custom agents..."
send_message "$SESSION_09" "Based on the available tools, design 3 custom agents:
1. Use design_custom_agent for a 'SecurityTriageAgent' with triage tools (incident_create, loki_search_errors, prometheus_alerts)
2. Use design_custom_agent for a 'ForensicsAgent' with investigation tools (admin_system_postgres_raw_query, loki_query, k8s_get_pod_logs)
3. Use design_custom_agent for a 'RemediationAgent' with fix tools (runbook_execute, incident_resolve)
4. Use search_tool_documentation to find docs for incident management

Present the complete multi-agent architecture showing how they work together, which tools each uses, and the escalation flow." \
    "$RESULTS_DIR/VAL-09-T2.sse"

T2_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-09-T2.sse")
T2_CONTENT=$(extract_content "$RESULTS_DIR/VAL-09-T2.sse")
TOTAL_TOOLS=$((T1_TOOLS + T2_TOOLS))

echo "$T1_CONTENT" > "$RESULTS_DIR/VAL-09.txt"
echo "---TURN 2---" >> "$RESULTS_DIR/VAL-09.txt"
echo "$T2_CONTENT" >> "$RESULTS_DIR/VAL-09.txt"

check_k8s_logs "VAL-09" "10m"

if [ "$TOTAL_TOOLS" -ge 5 ] && echo "$T2_CONTENT" | grep -qi "agent\|triage\|forensic\|remediation\|architecture"; then
    report "VAL-09" "PASS" "2-turn agent design with $TOTAL_TOOLS tool calls"
elif [ "$TOTAL_TOOLS" -ge 3 ]; then
    report "VAL-09" "PARTIAL" "$TOTAL_TOOLS tool calls (expected 7+)"
else
    report "VAL-09" "FAIL" "Only $TOTAL_TOOLS tool calls"
fi

###############################################################################
# VAL-10: Platform Observability (3 turns)
###############################################################################
echo -e "${CYAN}--- VAL-10: Platform Observability Stress Test (Multi-Turn) ---${NC}"
SESSION_10=$(create_session "VAL-10: Observability Stress Test")
echo "  Session: $SESSION_10"

# Turn 1: Prometheus monitoring
echo "  Turn 1: Prometheus monitoring..."
send_message "$SESSION_10" "Check all Prometheus monitoring:
1. Use prometheus_health_summary for overall health
2. Use prometheus_targets to list scrape targets
3. Use prometheus_alerts for active alerts
4. Use prometheus_query with query 'up' to check service availability
5. Use prometheus_metrics_list to show available metrics
Report which services are being monitored and their status." \
    "$RESULTS_DIR/VAL-10-T1.sse"

T1_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-10-T1.sse")
echo "    Tools used ($T1_TOOLS)"

# Turn 2: Loki log analysis
echo "  Turn 2: Loki log analysis..."
send_message "$SESSION_10" "Now analyze logs with Loki:
1. Use loki_labels to show all log labels
2. Use loki_label_values for label 'container'
3. Use loki_search_errors for namespace 'agentic-dev' last 2 hours
4. Use loki_count_logs for '{namespace=\"agentic-dev\"}' to show log volume
5. Use loki_log_rate for '{namespace=\"agentic-dev\"}' for log rate trends
How many errors did you find? What's the log volume? Any concerning patterns?" \
    "$RESULTS_DIR/VAL-10-T2.sse"

T2_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-10-T2.sse")
echo "    Tools used ($T2_TOOLS)"

# Turn 3: K8s + synthesis
echo "  Turn 3: K8s state + synthesis..."
send_message "$SESSION_10" "Final checks:
1. Use k8s_cluster_health for cluster status
2. Use k8s_list_nodes for node health
3. Use k8s_list_pods in agentic-dev for all pod statuses
4. Use admin_full_system_test for end-to-end app test

Now create a 'Platform Health Dashboard' with:
- Overall health score (0-100)
- Per-service status (green/yellow/red)
- Error rate trends
- Top 3 improvement recommendations
- Any critical issues requiring immediate attention" \
    "$RESULTS_DIR/VAL-10-T3.sse"

T3_TOOLS=$(count_tool_calls "$RESULTS_DIR/VAL-10-T3.sse")
T3_CONTENT=$(extract_content "$RESULTS_DIR/VAL-10-T3.sse")
TOTAL_TOOLS=$((T1_TOOLS + T2_TOOLS + T3_TOOLS))

echo "$(extract_content "$RESULTS_DIR/VAL-10-T1.sse")" > "$RESULTS_DIR/VAL-10.txt"
echo "---TURN 2---" >> "$RESULTS_DIR/VAL-10.txt"
echo "$(extract_content "$RESULTS_DIR/VAL-10-T2.sse")" >> "$RESULTS_DIR/VAL-10.txt"
echo "---TURN 3---" >> "$RESULTS_DIR/VAL-10.txt"
echo "$T3_CONTENT" >> "$RESULTS_DIR/VAL-10.txt"

check_k8s_logs "VAL-10" "15m"

if [ "$TOTAL_TOOLS" -ge 10 ] && echo "$T3_CONTENT" | grep -qi "health\|score\|dashboard\|recommend"; then
    report "VAL-10" "PASS" "3-turn observability audit with $TOTAL_TOOLS tool calls"
elif [ "$TOTAL_TOOLS" -ge 5 ]; then
    report "VAL-10" "PARTIAL" "$TOTAL_TOOLS tool calls (expected 15+)"
else
    report "VAL-10" "FAIL" "Only $TOTAL_TOOLS tool calls"
fi

###############################################################################
# SUMMARY
###############################################################################
echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  VALIDATION RESULTS SUMMARY${NC}"
echo -e "${CYAN}============================================${NC}"
echo -e "${GREEN}  PASS:    $PASS_COUNT${NC}"
echo -e "${YELLOW}  PARTIAL: $PARTIAL_COUNT${NC}"
echo -e "${RED}  FAIL:    $FAIL_COUNT${NC}"
echo -e "  Total:   $((PASS_COUNT + PARTIAL_COUNT + FAIL_COUNT))/10"
echo ""
echo "  Full results: $RESULTS_DIR/"
echo ""

# Write summary file
cat > "$RESULTS_DIR/SUMMARY.md" << HEREDOC
# v0.5.0 Multi-Turn Validation Suite Results

**Date:** $(date)
**API:** $API_URL
**Tests:** 10 (multi-turn interactive)

## Results

| Test | Status | Turns | Description |
|------|--------|-------|-------------|
HEREDOC

for i in $(seq -w 1 10); do
    if [ -f "$RESULTS_DIR/VAL-$i.result" ]; then
        status=$(head -1 "$RESULTS_DIR/VAL-$i.result" | cut -d: -f1)
        details=$(head -1 "$RESULTS_DIR/VAL-$i.result" | cut -d: -f2-)
        echo "| VAL-$i | $status | 2-3 | $details |" >> "$RESULTS_DIR/SUMMARY.md"
    fi
done

cat >> "$RESULTS_DIR/SUMMARY.md" << HEREDOC

## Counts
- **PASS:** $PASS_COUNT
- **PARTIAL:** $PARTIAL_COUNT
- **FAIL:** $FAIL_COUNT

## Multi-Turn Test Architecture
Each test follows this pattern:
1. **Turn 1**: Initial complex request with multiple tool calls
2. **Turn 2**: Follow-up based on actual response content (adaptive)
3. **Turn 3**: Verification/cleanup/synthesis request
4. **Log Check**: k8s logs scanned for errors during the test

## Test Descriptions
- **VAL-01**: Infrastructure health (3 turns: audit → deep-dive → scoring)
- **VAL-02**: K8s lifecycle (3 turns: create → inspect/modify → cleanup/verify)
- **VAL-03**: FedRAMP research (2 turns: search → gap analysis)
- **VAL-04**: Incident response (3 turns: create → investigate → resolve)
- **VAL-05**: Cloud cost analysis (2 turns: gather → analyze/optimize)
- **VAL-06**: Flowise workflow (3 turns: discover/create → validate → cleanup)
- **VAL-07**: GitHub CI/CD (2 turns: repos → CI/CD + issues)
- **VAL-08**: Database forensics (2 turns: enumerate → user activity)
- **VAL-09**: Agent architect (2 turns: discover → design 3 agents)
- **VAL-10**: Observability (3 turns: prometheus → loki → k8s + synthesis)
HEREDOC

echo "Summary written to $RESULTS_DIR/SUMMARY.md"

if [ "$FAIL_COUNT" -eq 0 ] && [ "$PASS_COUNT" -ge 7 ]; then
    echo -e "\n${GREEN}VALIDATION SUITE: PASSED${NC}"
    exit 0
elif [ "$FAIL_COUNT" -le 2 ]; then
    echo -e "\n${YELLOW}VALIDATION SUITE: PARTIAL (some tests need review)${NC}"
    exit 1
else
    echo -e "\n${RED}VALIDATION SUITE: FAILED${NC}"
    exit 2
fi
