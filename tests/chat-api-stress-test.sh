

# Chat API Stress Test - Test concurrent chat sessions with MCP tools and diagrams
# This script will create 10 concurrent sessions with 5 messages each

set -e  # Exit on error

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:8000}"
ADMIN_EMAIL="admin@openagentic.io"
ADMIN_PASSWORD="6py8Q~XNcKAJ~.SIrZAIBy__l7oDoPteWp2Habm3"
NUM_SESSIONS=10
MESSAGES_PER_SESSION=5
OUTPUT_DIR="/mnt/synology/Code/company/cdc/agentic/tests/results"
RESULTS_FILE="${OUTPUT_DIR}/stress_test_results_$(date +%Y%m%d_%H%M%S).json"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create output directory
mkdir -p "${OUTPUT_DIR}"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Initialize results
cat > "${RESULTS_FILE}" << 'EOF'
{
  "test_start": "",
  "test_end": "",
  "configuration": {
    "api_base_url": "",
    "num_sessions": 10,
    "messages_per_session": 5
  },
  "authentication": {
    "success": false,
    "token": ""
  },
  "sessions": [],
  "summary": {
    "total_sessions": 0,
    "successful_sessions": 0,
    "failed_sessions": 0,
    "total_messages": 0,
    "successful_messages": 0,
    "failed_messages": 0,
    "mcp_tools_invoked": [],
    "diagrams_requested": 0,
    "diagrams_rendered": 0,
    "errors": []
  }
}
EOF

# Update configuration
jq --arg url "$API_BASE_URL" \
   --arg start "$(date -Iseconds)" \
   '.test_start = $start | .configuration.api_base_url = $url' \
   "${RESULTS_FILE}" > "${RESULTS_FILE}.tmp" && mv "${RESULTS_FILE}.tmp" "${RESULTS_FILE}"

log_info "Starting Chat API Stress Test"
log_info "API Base URL: $API_BASE_URL"
log_info "Sessions: $NUM_SESSIONS"
log_info "Messages per session: $MESSAGES_PER_SESSION"
log_info "Results file: $RESULTS_FILE"

# Step 1: Authenticate
log_info "Authenticating as $ADMIN_EMAIL..."

AUTH_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/api/auth/local/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
  2>&1)

if [ $? -ne 0 ]; then
    log_error "Authentication request failed: $AUTH_RESPONSE"
    jq '.summary.errors += ["Authentication request failed"]' "${RESULTS_FILE}" > "${RESULTS_FILE}.tmp" && mv "${RESULTS_FILE}.tmp" "${RESULTS_FILE}"
    exit 1
fi

# Extract token from response
TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.token // .access_token // empty')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    log_error "Failed to extract token from auth response"
    log_error "Response: $AUTH_RESPONSE"
    jq '.summary.errors += ["Failed to extract authentication token"]' "${RESULTS_FILE}" > "${RESULTS_FILE}.tmp" && mv "${RESULTS_FILE}.tmp" "${RESULTS_FILE}"
    exit 1
fi

log_success "Authentication successful"
jq --arg token "$TOKEN" \
   '.authentication.success = true | .authentication.token = $token' \
   "${RESULTS_FILE}" > "${RESULTS_FILE}.tmp" && mv "${RESULTS_FILE}.tmp" "${RESULTS_FILE}"

# Test questions that exercise different MCP tools and request diagrams
declare -a QUESTIONS=(
    # Azure MCP
    "List all my Azure subscriptions and resource groups"
    "Show me all virtual machines in my subscription"
    "What Azure resources are in my default resource group?"

    # Web MCP
    "Search the web for latest AWS Lambda pricing"
    "Fetch the content from https://docs.aws.amazon.com/lambda/latest/dg/welcome.html"

    # Memory MCP
    "Remember that I prefer Python for cloud automation scripts"
    "What programming languages do I prefer?"
    "Store this information: My team uses Azure DevOps for CI/CD"

    # AWS API MCP
    "List all my EC2 instances"
    "Show me my S3 buckets"

    # AWS Knowledge MCP
    "What is AWS Lambda and how does it work?"
    "Explain AWS IAM roles and policies"

    # Sequential Thinking MCP
    "Think through the architecture for a scalable web application step by step"
    "Analyze the pros and cons of microservices vs monolithic architecture"

    # Diagram requests (React Flow)
    "Draw a flowchart showing the CI/CD pipeline process"
    "Create a bar chart comparing AWS Lambda vs Azure Functions pricing"
    "Visualize a microservices architecture with API gateway, services, and databases"
    "Show me a pie chart of cloud market share between AWS, Azure, and GCP"
    "Create a network diagram showing VPC, subnets, and security groups"

    # GCP MCP
    "List all my Google Cloud projects"
    "Show me my GCP compute instances"

    # Azure Cost MCP
    "What are my Azure costs for the last month?"
    "Show me the most expensive Azure resources"

    # Flowise MCP
    "List all available Flowise workflows"
    "Show me details about my Flowise chatflows"

    # Complex multi-tool requests
    "Search the web for Azure best practices, then remember the top 3 for me"
    "List my AWS Lambda functions and create a bar chart showing their memory configurations"
    "Think through a disaster recovery plan for Azure, then draw a flowchart of the process"
)

# Function to send a chat message
send_chat_message() {
    local session_id=$1
    local message=$2
    local session_index=$3
    local message_index=$4

    log_info "Session $session_index, Message $message_index: $message"

    # Create request payload
    local request_payload=$(jq -n \
        --arg msg "$message" \
        --arg sid "$session_id" \
        '{
            messages: [{role: "user", content: $msg}],
            sessionId: $sid,
            stream: false,
            model: "gpt-4o"
        }')

    # Send request
    local response=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE_URL}/api/chat/completions" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${TOKEN}" \
        -d "$request_payload" \
        2>&1)

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n-1)

    # Validate response
    if [ "$http_code" != "200" ]; then
        log_error "Request failed with HTTP $http_code"
        log_error "Response: $body"
        echo "{\"success\": false, \"error\": \"HTTP $http_code\", \"response\": $(echo "$body" | jq -Rs .)}"
        return 1
    fi

    # Check if response is valid JSON
    if ! echo "$body" | jq empty 2>/dev/null; then
        log_error "Invalid JSON response"
        log_error "Response: $body"
        echo "{\"success\": false, \"error\": \"Invalid JSON\", \"response\": $(echo "$body" | jq -Rs .)}"
        return 1
    fi

    # Extract response content
    local content=$(echo "$body" | jq -r '.choices[0].message.content // .message // empty')
    local mcp_tools=$(echo "$body" | jq -r '.mcpToolsUsed // [] | @json')
    local has_diagram=$(echo "$content" | grep -i -E "flowchart|diagram|chart|graph" | wc -l)

    if [ -z "$content" ]; then
        log_warning "Empty response content"
        echo "{\"success\": false, \"error\": \"Empty response\", \"response\": $body}"
        return 1
    fi

    # Check for quality issues
    local content_length=$(echo "$content" | wc -c)
    if [ "$content_length" -lt 10 ]; then
        log_warning "Response too short (${content_length} chars)"
    fi

    log_success "Response received (${content_length} chars)"

    # Return structured result
    echo "{
        \"success\": true,
        \"message\": $(echo "$message" | jq -Rs .),
        \"response\": $(echo "$content" | jq -Rs .),
        \"response_length\": $content_length,
        \"mcp_tools\": $mcp_tools,
        \"has_diagram\": $([ "$has_diagram" -gt 0 ] && echo "true" || echo "false"),
        \"http_code\": $http_code
    }"
}

# Function to run a chat session
run_chat_session() {
    local session_index=$1
    local session_id="test-session-$(date +%s)-${session_index}"

    log_info "Starting session $session_index (ID: $session_id)"

    local session_result="{
        \"session_id\": \"$session_id\",
        \"session_index\": $session_index,
        \"messages\": [],
        \"success\": true,
        \"errors\": []
    }"

    # Send messages
    for ((msg_idx=0; msg_idx<MESSAGES_PER_SESSION; msg_idx++)); do
        # Pick a question (cycle through them)
        local question_idx=$(( (session_index * MESSAGES_PER_SESSION + msg_idx) % ${#QUESTIONS[@]} ))
        local question="${QUESTIONS[$question_idx]}"

        # Send message
        local msg_result=$(send_chat_message "$session_id" "$question" "$session_index" "$msg_idx")

        # Add to session results
        session_result=$(echo "$session_result" | jq --argjson msg "$msg_result" '.messages += [$msg]')

        # Check if message failed
        local msg_success=$(echo "$msg_result" | jq -r '.success')
        if [ "$msg_success" != "true" ]; then
            session_result=$(echo "$session_result" | jq '.success = false')
            local error=$(echo "$msg_result" | jq -r '.error // "Unknown error"')
            session_result=$(echo "$session_result" | jq --arg err "$error" '.errors += [$err]')
        fi

        # Small delay between messages
        sleep 1
    done

    # Output session result
    echo "$session_result"
}

# Run sessions concurrently
log_info "Starting $NUM_SESSIONS concurrent chat sessions..."

# Array to hold background PIDs
declare -a PIDS=()
declare -a SESSION_FILES=()

# Start sessions in parallel
for ((i=0; i<NUM_SESSIONS; i++)); do
    session_file="${OUTPUT_DIR}/session_${i}.json"
    SESSION_FILES+=("$session_file")

    # Run session in background
    run_chat_session $i > "$session_file" 2>&1 &
    PIDS+=($!)

    # Small stagger to avoid thundering herd
    sleep 0.5
done

log_info "All sessions started, waiting for completion..."

# Wait for all sessions to complete
for pid in "${PIDS[@]}"; do
    wait $pid
done

log_success "All sessions completed"

# Aggregate results
log_info "Aggregating results..."

for session_file in "${SESSION_FILES[@]}"; do
    if [ -f "$session_file" ]; then
        session_data=$(cat "$session_file")
        jq --argjson sess "$session_data" '.sessions += [$sess]' "${RESULTS_FILE}" > "${RESULTS_FILE}.tmp" && mv "${RESULTS_FILE}.tmp" "${RESULTS_FILE}"
    fi
done

# Calculate summary statistics
jq '
.summary.total_sessions = (.sessions | length) |
.summary.successful_sessions = ([.sessions[] | select(.success == true)] | length) |
.summary.failed_sessions = ([.sessions[] | select(.success == false)] | length) |
.summary.total_messages = ([.sessions[].messages] | flatten | length) |
.summary.successful_messages = ([.sessions[].messages[] | select(.success == true)] | length) |
.summary.failed_messages = ([.sessions[].messages[] | select(.success == false)] | length) |
.summary.mcp_tools_invoked = ([.sessions[].messages[].mcp_tools // [] | fromjson] | flatten | unique) |
.summary.diagrams_requested = ([.sessions[].messages[] | select(.message | test("draw|create.*chart|visualize|show.*diagram"; "i"))] | length) |
.summary.diagrams_rendered = ([.sessions[].messages[] | select(.has_diagram == true)] | length) |
.summary.errors = ([.sessions[].errors] | flatten | unique) |
.test_end = (now | todate)
' "${RESULTS_FILE}" > "${RESULTS_FILE}.tmp" && mv "${RESULTS_FILE}.tmp" "${RESULTS_FILE}"

# Clean up temporary session files
rm -f "${OUTPUT_DIR}/session_"*.json

log_success "Results saved to $RESULTS_FILE"

# Display summary
echo ""
echo "=========================================="
echo "        TEST RESULTS SUMMARY"
echo "=========================================="
echo ""

jq -r '
"Total Sessions: \(.summary.total_sessions)",
"Successful Sessions: \(.summary.successful_sessions)",
"Failed Sessions: \(.summary.failed_sessions)",
"",
"Total Messages: \(.summary.total_messages)",
"Successful Messages: \(.summary.successful_messages)",
"Failed Messages: \(.summary.failed_messages)",
"",
"MCP Tools Invoked: \(.summary.mcp_tools_invoked | length)",
"MCP Tools: \(.summary.mcp_tools_invoked | join(", "))",
"",
"Diagrams Requested: \(.summary.diagrams_requested)",
"Diagrams Rendered: \(.summary.diagrams_rendered)",
"",
"Errors: \(.summary.errors | length)",
if (.summary.errors | length) > 0 then
  "Error Types: \(.summary.errors | join(", "))"
else
  "No errors!"
end
' "${RESULTS_FILE}"

echo ""
echo "=========================================="

# Exit with appropriate code
if jq -e '.summary.failed_sessions > 0' "${RESULTS_FILE}" > /dev/null; then
    log_error "Some sessions failed"
    exit 1
else
    log_success "All sessions completed successfully!"
    exit 0
fi
