

###############################################################################
# Load Test Runner Script
#
# Quick script to run the concurrent chat sessions load test with common
# configurations.
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default configuration
API_URL="${API_URL:-http://localhost:8000}"
API_KEY="${API_KEY:-awc_test_PLACEHOLDER_REPLACE_WITH_REAL_KEY}"
NUM_SESSIONS="${NUM_SESSIONS:-100}"
MESSAGES_PER_SESSION="${MESSAGES_PER_SESSION:-20}"
DEFAULT_MODEL="${DEFAULT_MODEL:-gemini-2.0-flash-001}"

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "\n${CYAN}╔════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  $1${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════╝${NC}\n"
}

# Parse command line arguments
MODE="full"

while [[ $# -gt 0 ]]; do
    case $1 in
        --smoke)
            MODE="smoke"
            NUM_SESSIONS=10
            MESSAGES_PER_SESSION=5
            shift
            ;;
        --stress)
            MODE="stress"
            NUM_SESSIONS=200
            MESSAGES_PER_SESSION=30
            shift
            ;;
        --quick)
            MODE="quick"
            NUM_SESSIONS=20
            MESSAGES_PER_SESSION=10
            shift
            ;;
        --sessions)
            NUM_SESSIONS="$2"
            shift 2
            ;;
        --messages)
            MESSAGES_PER_SESSION="$2"
            shift 2
            ;;
        --model)
            DEFAULT_MODEL="$2"
            shift 2
            ;;
        --api-url)
            API_URL="$2"
            shift 2
            ;;
        --api-key)
            API_KEY="$2"
            shift 2
            ;;
        --help)
            echo "Load Test Runner Script"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --smoke              Quick smoke test (10 sessions, 5 messages)"
            echo "  --quick              Quick test (20 sessions, 10 messages)"
            echo "  --stress             Stress test (200 sessions, 30 messages)"
            echo "  --sessions N         Set number of sessions"
            echo "  --messages N         Set messages per session"
            echo "  --model MODEL        Set LLM model to use"
            echo "  --api-url URL        Set API URL"
            echo "  --api-key KEY        Set API key"
            echo "  --help               Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                   # Run full test (100 sessions, 20 messages)"
            echo "  $0 --smoke           # Quick smoke test"
            echo "  $0 --stress          # Stress test with 200 sessions"
            echo "  $0 --sessions 50     # Custom session count"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Display configuration
print_header "Load Test Configuration"
print_info "Mode: $MODE"
print_info "API URL: $API_URL"
print_info "API Key: ${API_KEY:0:30}..."
print_info "Sessions: $NUM_SESSIONS"
print_info "Messages per session: $MESSAGES_PER_SESSION"
print_info "Total messages: $((NUM_SESSIONS * MESSAGES_PER_SESSION))"
print_info "Model: $DEFAULT_MODEL"

# Check if API is reachable
print_header "Pre-flight Checks"
print_info "Checking API connectivity..."

if curl -s -f -o /dev/null -m 5 "$API_URL/health" 2>/dev/null; then
    print_success "API is reachable at $API_URL"
else
    print_warning "Could not reach API at $API_URL/health"
    print_warning "The test will continue but may fail if the API is not available"
fi

# Check if results directory exists
RESULTS_DIR="../test-results"
if [ ! -d "$RESULTS_DIR" ]; then
    print_info "Creating results directory: $RESULTS_DIR"
    mkdir -p "$RESULTS_DIR"
fi

# Run the test
print_header "Starting Load Test"

export API_URL
export API_KEY
export NUM_SESSIONS
export MESSAGES_PER_SESSION
export DEFAULT_MODEL

TEST_START_TIME=$(date +%s)

# Run the test and capture exit code
if node concurrent-chat-sessions.test.js; then
    TEST_EXIT_CODE=0
    TEST_STATUS="PASSED"
else
    TEST_EXIT_CODE=$?
    TEST_STATUS="FAILED"
fi

TEST_END_TIME=$(date +%s)
TEST_DURATION=$((TEST_END_TIME - TEST_START_TIME))

# Display results
print_header "Test Execution Complete"

if [ $TEST_EXIT_CODE -eq 0 ]; then
    print_success "Test $TEST_STATUS"
    print_success "Duration: ${TEST_DURATION}s"
else
    print_error "Test $TEST_STATUS"
    print_error "Duration: ${TEST_DURATION}s"
    print_error "Exit code: $TEST_EXIT_CODE"
fi

# Check if results file was created
RESULTS_FILE="$RESULTS_DIR/concurrent-chat-sessions-results.json"
if [ -f "$RESULTS_FILE" ]; then
    print_success "Results saved to: $RESULTS_FILE"

    # Display quick summary from results
    if command -v jq &> /dev/null; then
        print_info "Quick Summary:"
        echo ""
        jq -r '.summary | "  Total Messages: \(.totalMessages)\n  Successful: \(.successfulMessages)\n  Failed: \(.failedMessages)\n  Error Rate: \(.errorRate)\n  Avg Response Time: \(.avgResponseTime)ms\n  P99 Response Time: \(.p99ResponseTime)ms"' "$RESULTS_FILE"
        echo ""
    fi
else
    print_warning "Results file not found at: $RESULTS_FILE"
fi

# Generate report
print_header "Next Steps"
print_info "View detailed results: cat $RESULTS_FILE | jq"
print_info "Run another test: $0 --help"
print_info "Check API logs for errors if test failed"

exit $TEST_EXIT_CODE
