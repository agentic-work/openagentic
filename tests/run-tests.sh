# Proprietary and confidential. Unauthorized copying prohibited.


# OpenAgentic Comprehensive Test Runner
# Usage: ./run-tests.sh [options]
#
# Options:
#   --env docker|helm|local    Set test environment (default: docker)
#   --suite all|unit|e2e|...   Run specific test suite
#   --parallel                 Run tests in parallel
#   --ci                       Run in CI mode (non-interactive)
#   --report                   Generate HTML report

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Defaults
TEST_ENV="docker"
TEST_SUITE="all"
PARALLEL=false
CI_MODE=false
GENERATE_REPORT=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --env)
            TEST_ENV="$2"
            shift 2
            ;;
        --suite)
            TEST_SUITE="$2"
            shift 2
            ;;
        --parallel)
            PARALLEL=true
            shift
            ;;
        --ci)
            CI_MODE=true
            shift
            ;;
        --report)
            GENERATE_REPORT=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}  OpenAgentic Test Suite Runner${NC}"
echo -e "${BLUE}=====================================${NC}"
echo ""
echo -e "Environment: ${GREEN}$TEST_ENV${NC}"
echo -e "Suite: ${GREEN}$TEST_SUITE${NC}"
echo ""

# Load environment
if [[ "$TEST_ENV" == "docker" ]]; then
    export $(cat .env.docker | xargs)
elif [[ "$TEST_ENV" == "helm" ]]; then
    export $(cat .env.helm | xargs)
fi

# Check dependencies
check_deps() {
    echo -e "${YELLOW}Checking dependencies...${NC}"

    if ! command -v node &> /dev/null; then
        echo -e "${RED}Node.js not found. Please install Node.js 18+${NC}"
        exit 1
    fi

    if ! command -v npm &> /dev/null; then
        echo -e "${RED}npm not found. Please install npm${NC}"
        exit 1
    fi

    echo -e "${GREEN}Dependencies OK${NC}"
}

# Install test dependencies
install_deps() {
    echo -e "${YELLOW}Installing test dependencies...${NC}"
    npm install
    npx playwright install --with-deps
}

# Run unit tests
run_unit_tests() {
    echo -e "${BLUE}Running Unit Tests...${NC}"
    npx vitest run --dir unit --reporter=verbose
}

# Run integration tests
run_integration_tests() {
    echo -e "${BLUE}Running Integration Tests...${NC}"
    npx vitest run --dir integration --reporter=verbose
}

# Run contract tests
run_contract_tests() {
    echo -e "${BLUE}Running Contract Tests...${NC}"
    npx vitest run --dir contract --reporter=verbose
}

# Run security tests
run_security_tests() {
    echo -e "${BLUE}Running Security Tests...${NC}"
    npx vitest run --dir security --reporter=verbose
}

# Run performance tests
run_performance_tests() {
    echo -e "${BLUE}Running Performance Tests...${NC}"
    npx vitest run --dir performance --reporter=verbose
}

# Run E2E API tests
run_api_tests() {
    echo -e "${BLUE}Running E2E API Tests...${NC}"
    npx vitest run --dir e2e/api --reporter=verbose
}

# Run E2E UI tests
run_ui_tests() {
    echo -e "${BLUE}Running E2E UI Tests...${NC}"
    npx playwright test e2e/ui
}

# Run E2E MCP tests
run_mcp_tests() {
    echo -e "${BLUE}Running MCP Tool Tests...${NC}"
    npx vitest run --dir e2e/mcp --reporter=verbose
}

# Run accessibility tests
run_accessibility_tests() {
    echo -e "${BLUE}Running Accessibility Tests...${NC}"
    npx playwright test accessibility
}

# Run load tests
run_load_tests() {
    echo -e "${BLUE}Running Load Tests...${NC}"

    if command -v k6 &> /dev/null; then
        k6 run load/scenarios/smoke.js
    else
        echo -e "${YELLOW}k6 not installed. Skipping load tests.${NC}"
        echo "Install k6: https://k6.io/docs/getting-started/installation/"
    fi
}

# Run all tests
run_all_tests() {
    run_unit_tests
    run_integration_tests
    run_contract_tests
    run_security_tests
    run_performance_tests
    run_api_tests
    run_mcp_tests
    run_ui_tests
    run_accessibility_tests
}

# Generate report
generate_report() {
    echo -e "${BLUE}Generating Test Reports...${NC}"

    # Generate Allure report if available
    if command -v allure &> /dev/null; then
        allure generate allure-results --clean -o allure-report
        echo -e "${GREEN}Allure report generated: allure-report/index.html${NC}"
    fi

    # Playwright report
    if [[ -d "playwright-report" ]]; then
        echo -e "${GREEN}Playwright report: playwright-report/index.html${NC}"
    fi
}

# Main execution
main() {
    check_deps

    # Install deps if node_modules doesn't exist
    if [[ ! -d "node_modules" ]]; then
        install_deps
    fi

    # Run selected suite
    case $TEST_SUITE in
        all)
            run_all_tests
            ;;
        unit)
            run_unit_tests
            ;;
        integration)
            run_integration_tests
            ;;
        contract)
            run_contract_tests
            ;;
        security)
            run_security_tests
            ;;
        performance)
            run_performance_tests
            ;;
        api)
            run_api_tests
            ;;
        ui)
            run_ui_tests
            ;;
        mcp)
            run_mcp_tests
            ;;
        accessibility)
            run_accessibility_tests
            ;;
        load)
            run_load_tests
            ;;
        *)
            echo -e "${RED}Unknown test suite: $TEST_SUITE${NC}"
            exit 1
            ;;
    esac

    # Generate report if requested
    if [[ "$GENERATE_REPORT" == true ]]; then
        generate_report
    fi

    echo ""
    echo -e "${GREEN}=====================================${NC}"
    echo -e "${GREEN}  Tests Complete!${NC}"
    echo -e "${GREEN}=====================================${NC}"
}

main
