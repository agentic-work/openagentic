# Proprietary and confidential. Unauthorized copying prohibited.

# =============================================================================
# CDC Bedrock Proxy Test Script
# =============================================================================
# This script tests AWS Bedrock connectivity via the CDC proxy endpoint
# (bedrock-dev.cdc.gov) with SSL certificate validation.
#
# REQUIREMENTS:
#   - Must be run from WITHIN the CDC network (AKS cluster or VPN)
#   - AWS credentials must be provided
#   - The bedrock-dev.cdc.gov endpoint must be accessible
#
# USAGE:
#   ./test-cdc-bedrock-proxy.sh
#
# ENVIRONMENT VARIABLES:
#   AWS_ACCESS_KEY_ID     - AWS access key (required)
#   AWS_SECRET_ACCESS_KEY - AWS secret key (required)
#   AWS_REGION            - AWS region (default: us-east-1)
#   CDC_BEDROCK_ENDPOINT  - CDC proxy URL (default: https://bedrock-dev.cdc.gov)
# =============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CDC_BEDROCK_ENDPOINT="${CDC_BEDROCK_ENDPOINT:-https://bedrock-dev.cdc.gov}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Claude 4.6 models (inference profile IDs)
MODELS=(
    "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    "us.anthropic.claude-sonnet-4-6"
    "us.anthropic.claude-opus-4-6-v1"
)

echo "=============================================="
echo "CDC Bedrock Proxy Test"
echo "=============================================="
echo ""
echo "Endpoint: ${CDC_BEDROCK_ENDPOINT}"
echo "Region:   ${AWS_REGION}"
echo ""

# Check for required credentials
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]] || [[ -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
    echo -e "${RED}ERROR: AWS credentials not set${NC}"
    echo "Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables"
    exit 1
fi

echo -e "${GREEN}AWS credentials found${NC}"
echo ""

# =============================================================================
# Test 1: DNS Resolution
# =============================================================================
echo "Test 1: DNS Resolution"
echo "----------------------"

HOSTNAME=$(echo "$CDC_BEDROCK_ENDPOINT" | sed 's|https://||' | sed 's|/.*||')

if nslookup "$HOSTNAME" > /dev/null 2>&1; then
    RESOLVED_IP=$(nslookup "$HOSTNAME" 2>/dev/null | grep -A1 "Name:" | grep "Address:" | awk '{print $2}')
    echo -e "${GREEN}PASS${NC}: $HOSTNAME resolves to $RESOLVED_IP"
else
    echo -e "${RED}FAIL${NC}: Cannot resolve $HOSTNAME"
    echo "This script must be run from within the CDC network (AKS cluster or VPN)"
    exit 1
fi
echo ""

# =============================================================================
# Test 2: SSL Certificate Validation
# =============================================================================
echo "Test 2: SSL Certificate Validation"
echo "-----------------------------------"

# Check SSL certificate
SSL_OUTPUT=$(echo | openssl s_client -servername "$HOSTNAME" -connect "$HOSTNAME:443" 2>/dev/null)

if echo "$SSL_OUTPUT" | grep -q "Verify return code: 0 (ok)"; then
    echo -e "${GREEN}PASS${NC}: SSL certificate is valid and trusted"

    # Extract certificate info
    CERT_SUBJECT=$(echo "$SSL_OUTPUT" | openssl x509 -noout -subject 2>/dev/null || echo "N/A")
    CERT_ISSUER=$(echo "$SSL_OUTPUT" | openssl x509 -noout -issuer 2>/dev/null || echo "N/A")
    CERT_DATES=$(echo "$SSL_OUTPUT" | openssl x509 -noout -dates 2>/dev/null || echo "N/A")

    echo "  Certificate Subject: $CERT_SUBJECT"
    echo "  Certificate Issuer:  $CERT_ISSUER"
    echo "  Certificate Dates:   $CERT_DATES"
else
    VERIFY_CODE=$(echo "$SSL_OUTPUT" | grep "Verify return code:" || echo "unknown")
    echo -e "${YELLOW}WARNING${NC}: SSL certificate verification failed"
    echo "  Verification: $VERIFY_CODE"
    echo ""
    echo "  This may be expected if using CDC's internal CA."
    echo "  Ensure CDC root CA is trusted in the container/pod."
fi
echo ""

# =============================================================================
# Test 3: HTTPS Connectivity
# =============================================================================
echo "Test 3: HTTPS Connectivity"
echo "--------------------------"

# Test basic HTTPS connectivity
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 "$CDC_BEDROCK_ENDPOINT" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "000" ]]; then
    echo -e "${RED}FAIL${NC}: Cannot connect to $CDC_BEDROCK_ENDPOINT"
    echo "Check network connectivity and firewall rules"
    exit 1
elif [[ "$HTTP_CODE" == "401" ]] || [[ "$HTTP_CODE" == "403" ]]; then
    echo -e "${GREEN}PASS${NC}: Endpoint reachable (HTTP $HTTP_CODE - auth required)"
elif [[ "$HTTP_CODE" == "200" ]] || [[ "$HTTP_CODE" == "302" ]]; then
    echo -e "${GREEN}PASS${NC}: Endpoint reachable (HTTP $HTTP_CODE)"
else
    echo -e "${YELLOW}WARNING${NC}: Unexpected HTTP code: $HTTP_CODE"
fi
echo ""

# =============================================================================
# Test 4: AWS Bedrock Model Invocation via Proxy
# =============================================================================
echo "Test 4: AWS Bedrock Model Invocation via Proxy"
echo "-----------------------------------------------"

# Test each model
for MODEL_ID in "${MODELS[@]}"; do
    echo ""
    echo "Testing model: $MODEL_ID"

    # Create request payload
    PAYLOAD=$(cat << EOF
{
    "anthropic_version": "bedrock-2023-05-31",
    "max_tokens": 50,
    "messages": [
        {
            "role": "user",
            "content": "Say 'Hello from CDC Bedrock proxy test' in exactly those words."
        }
    ]
}
EOF
)

    # Calculate AWS Signature v4 (simplified - in production use AWS SDK)
    # For this test, we'll use the AWS CLI if available

    if command -v aws &> /dev/null; then
        echo "  Using AWS CLI..."

        # Test with AWS CLI using custom endpoint
        RESULT=$(AWS_ENDPOINT_URL="${CDC_BEDROCK_ENDPOINT}" \
            aws bedrock-runtime invoke-model \
            --model-id "$MODEL_ID" \
            --region "$AWS_REGION" \
            --content-type "application/json" \
            --accept "application/json" \
            --body "$PAYLOAD" \
            /tmp/bedrock-response-$$.json 2>&1) || true

        if [[ -f "/tmp/bedrock-response-$$.json" ]]; then
            RESPONSE=$(cat "/tmp/bedrock-response-$$.json")
            rm -f "/tmp/bedrock-response-$$.json"

            if echo "$RESPONSE" | grep -q "Hello"; then
                echo -e "  ${GREEN}PASS${NC}: Model responded successfully"
                # Extract response text
                TEXT=$(echo "$RESPONSE" | jq -r '.content[0].text' 2>/dev/null || echo "N/A")
                echo "  Response: $TEXT"
            else
                echo -e "  ${YELLOW}WARNING${NC}: Unexpected response format"
                echo "  Response: $(echo "$RESPONSE" | head -c 200)"
            fi
        else
            echo -e "  ${RED}FAIL${NC}: No response received"
            echo "  Error: $RESULT"
        fi
    else
        echo -e "  ${YELLOW}SKIP${NC}: AWS CLI not available"
        echo "  Install AWS CLI to test model invocation"
    fi
done

echo ""
echo "=============================================="
echo "Test Summary"
echo "=============================================="
echo ""
echo "If all tests passed, the CDC Bedrock proxy is working correctly."
echo ""
echo "To configure OpenAgentic to use this proxy, set:"
echo "  AWS_BEDROCK_ENDPOINT=${CDC_BEDROCK_ENDPOINT}"
echo ""
echo "In Helm values:"
echo "  aws:"
echo "    bedrock:"
echo "      enabled: true"
echo "      endpoint: ${CDC_BEDROCK_ENDPOINT}"
echo ""
