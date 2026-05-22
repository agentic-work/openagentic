

# 100-Message Cloud Resource Test - LOCAL API
# Tests progressively harder cloud resource queries to trigger MCP tools

API_URL="http://localhost:8000"
API_KEY="${API_KEY:?API_KEY env var required}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
SUCCESS=0
FAILED=0
TOTAL=0

# Log file
LOG_FILE="/tmp/cloud-test-100-local.log"
ERROR_LOG="/tmp/cloud-test-errors-local.log"

echo "Starting 100-Message Cloud Resource Test (LOCAL)" | tee $LOG_FILE
echo "================================================" | tee -a $LOG_FILE
echo "" > $ERROR_LOG

# Create session
echo -e "${YELLOW}Creating test session...${NC}"
SESSION_RESPONSE=$(curl -s -X POST "$API_URL/api/chat/sessions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "100-Message Cloud Test LOCAL"}')

SESSION_ID=$(echo "$SESSION_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$SESSION_ID" ]; then
  echo -e "${RED}Failed to create session${NC}"
  echo "Response: $SESSION_RESPONSE"
  exit 1
fi

echo -e "${GREEN}Session created: $SESSION_ID${NC}" | tee -a $LOG_FILE

# Function to send a message and check response
send_message() {
  local MSG_NUM=$1
  local MESSAGE=$2
  local CATEGORY=$3

  TOTAL=$((TOTAL + 1))

  echo -e "\n${BLUE}[$MSG_NUM/100] $CATEGORY${NC}" | tee -a $LOG_FILE
  echo "Q: ${MESSAGE:0:60}..." | tee -a $LOG_FILE

  # Send message with timeout
  RESPONSE=$(timeout 90 curl -s -N "$API_URL/api/chat/stream" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"message\": \"$MESSAGE\", \"sessionId\": \"$SESSION_ID\"}" 2>&1)

  # Check for error events
  if echo "$RESPONSE" | grep -q "event: error"; then
    FAILED=$((FAILED + 1))
    ERROR_MSG=$(echo "$RESPONSE" | grep "event: error" -A 1 | grep "data:" | head -1)
    echo -e "${RED}✗ FAILED${NC}" | tee -a $LOG_FILE
    echo "[$MSG_NUM] $CATEGORY: $MESSAGE" >> $ERROR_LOG
    echo "Error: $ERROR_MSG" >> $ERROR_LOG
    echo "---" >> $ERROR_LOG
  else
    RESP_LEN=${#RESPONSE}
    if [ $RESP_LEN -gt 200 ]; then
      SUCCESS=$((SUCCESS + 1))
      echo -e "${GREEN}✓ SUCCESS (${RESP_LEN} chars)${NC}" | tee -a $LOG_FILE
    else
      FAILED=$((FAILED + 1))
      echo -e "${RED}✗ FAILED (too short: ${RESP_LEN} chars)${NC}" | tee -a $LOG_FILE
      echo "[$MSG_NUM] $CATEGORY: $MESSAGE" >> $ERROR_LOG
      echo "Response too short: $RESP_LEN chars" >> $ERROR_LOG
      echo "---" >> $ERROR_LOG
    fi
  fi

  # Calculate current success rate
  RATE=$(echo "scale=1; ($SUCCESS * 100) / $TOTAL" | bc)
  echo -e "Running: ${SUCCESS}/${TOTAL} (${RATE}%)" | tee -a $LOG_FILE

  # Brief pause between messages
  sleep 1
}

# ============================================================================
# AWS QUESTIONS (1-35)
# ============================================================================
echo -e "\n${YELLOW}=== AWS QUESTIONS ===${NC}" | tee -a $LOG_FILE

send_message 1 "List my AWS S3 buckets" "AWS-Easy"
send_message 2 "Show me my EC2 instances" "AWS-Easy"
send_message 3 "What AWS regions do I have resources in?" "AWS-Easy"
send_message 4 "List my AWS IAM users" "AWS-Easy"
send_message 5 "Show my AWS Lambda functions" "AWS-Easy"
send_message 6 "What RDS databases do I have?" "AWS-Easy"
send_message 7 "List my AWS VPCs" "AWS-Easy"
send_message 8 "Show my AWS CloudWatch alarms" "AWS-Easy"
send_message 9 "What EBS volumes do I have?" "AWS-Easy"
send_message 10 "List my AWS security groups" "AWS-Easy"
send_message 11 "Show me the cost breakdown for my AWS account for the last month" "AWS-Medium"
send_message 12 "Which EC2 instances are running and what are their specs?" "AWS-Medium"
send_message 13 "List all S3 buckets with their storage sizes" "AWS-Medium"
send_message 14 "Show me AWS resources that are publicly accessible" "AWS-Medium"
send_message 15 "What are my top 5 most expensive AWS services?" "AWS-Medium"
send_message 16 "List Lambda functions with their memory configurations" "AWS-Medium"
send_message 17 "Show me RDS instances and their backup configurations" "AWS-Medium"
send_message 18 "What ECS clusters do I have and their task counts?" "AWS-Medium"
send_message 19 "List my AWS Route53 hosted zones" "AWS-Medium"
send_message 20 "Show me AWS CloudFormation stacks and their statuses" "AWS-Medium"
send_message 21 "Analyze my AWS cost trends over the last 3 months and identify anomalies" "AWS-Hard"
send_message 22 "Find all AWS resources without proper tagging" "AWS-Hard"
send_message 23 "Show me security vulnerabilities in my AWS configuration" "AWS-Hard"
send_message 24 "List all cross-account IAM roles and their trust relationships" "AWS-Hard"
send_message 25 "Analyze my EC2 instance utilization and recommend rightsizing" "AWS-Hard"
send_message 26 "Show me unused AWS resources that could be deleted to save costs" "AWS-Hard"
send_message 27 "List all S3 buckets without encryption enabled" "AWS-Hard"
send_message 28 "Analyze my VPC network architecture and identify single points of failure" "AWS-Hard"
send_message 29 "Show me AWS API calls from the last 24 hours that failed" "AWS-Hard"
send_message 30 "List all IAM policies with admin privileges" "AWS-Hard"
send_message 31 "Create a comprehensive cost optimization report for my AWS account" "AWS-Expert"
send_message 32 "Analyze my AWS security posture against CIS benchmarks" "AWS-Expert"
send_message 33 "Generate a disaster recovery plan based on my current AWS resources" "AWS-Expert"
send_message 34 "Show me a dependency map of all my AWS resources" "AWS-Expert"
send_message 35 "Analyze my AWS Well-Architected Framework compliance" "AWS-Expert"

# ============================================================================
# AZURE QUESTIONS (36-70)
# ============================================================================
echo -e "\n${YELLOW}=== AZURE QUESTIONS ===${NC}" | tee -a $LOG_FILE

send_message 36 "List my Azure subscriptions" "Azure-Easy"
send_message 37 "Show me my Azure resource groups" "Azure-Easy"
send_message 38 "What Azure VMs do I have?" "Azure-Easy"
send_message 39 "List my Azure storage accounts" "Azure-Easy"
send_message 40 "Show my Azure SQL databases" "Azure-Easy"
send_message 41 "What Azure App Services do I have?" "Azure-Easy"
send_message 42 "List my Azure virtual networks" "Azure-Easy"
send_message 43 "Show my Azure Key Vaults" "Azure-Easy"
send_message 44 "What Azure Function Apps do I have?" "Azure-Easy"
send_message 45 "List my Azure Cosmos DB accounts" "Azure-Easy"
send_message 46 "Show me my Azure cost for the last 6 months in a breakdown by resource group" "Azure-Medium"
send_message 47 "Which Azure VMs are running and what are their sizes?" "Azure-Medium"
send_message 48 "List Azure resources by subscription with their costs" "Azure-Medium"
send_message 49 "Show me Azure resources exposed to the internet" "Azure-Medium"
send_message 50 "What are my most expensive Azure resources?" "Azure-Medium"
send_message 51 "List Azure storage accounts with their access tiers" "Azure-Medium"
send_message 52 "Show me Azure SQL databases and their performance tiers" "Azure-Medium"
send_message 53 "What AKS clusters do I have and their node counts?" "Azure-Medium"
send_message 54 "List my Azure DNS zones" "Azure-Medium"
send_message 55 "Show me Azure DevOps projects and their pipelines" "Azure-Medium"
send_message 56 "Analyze my Azure spending trends and forecast next month costs" "Azure-Hard"
send_message 57 "Find all Azure resources without proper tagging compliance" "Azure-Hard"
send_message 58 "Show me security vulnerabilities in my Azure configuration" "Azure-Hard"
send_message 59 "List all Azure AD applications and their permissions" "Azure-Hard"
send_message 60 "Analyze my Azure VM utilization and recommend sizing changes" "Azure-Hard"
send_message 61 "Show me unused Azure resources that could be deleted" "Azure-Hard"
send_message 62 "List all storage accounts without encryption at rest" "Azure-Hard"
send_message 63 "Analyze my Azure network architecture for security gaps" "Azure-Hard"
send_message 64 "Show me Azure Activity Log events for failed operations" "Azure-Hard"
send_message 65 "List all Azure RBAC assignments with owner permissions" "Azure-Hard"
send_message 66 "Create a comprehensive Azure cost optimization report" "Azure-Expert"
send_message 67 "Analyze my Azure security posture against Azure Security Benchmark" "Azure-Expert"
send_message 68 "Generate a business continuity plan based on my Azure resources" "Azure-Expert"
send_message 69 "Show me a complete architecture diagram of my Azure environment" "Azure-Expert"
send_message 70 "Analyze my Azure Landing Zone compliance" "Azure-Expert"

# ============================================================================
# GCP QUESTIONS (71-100)
# ============================================================================
echo -e "\n${YELLOW}=== GCP QUESTIONS ===${NC}" | tee -a $LOG_FILE

send_message 71 "List my GCP projects" "GCP-Easy"
send_message 72 "Show me my GCP Compute Engine instances" "GCP-Easy"
send_message 73 "What GCP Cloud Storage buckets do I have?" "GCP-Easy"
send_message 74 "List my GCP Cloud SQL instances" "GCP-Easy"
send_message 75 "Show my GCP Cloud Functions" "GCP-Easy"
send_message 76 "What GKE clusters do I have?" "GCP-Easy"
send_message 77 "List my GCP VPC networks" "GCP-Easy"
send_message 78 "Show my GCP BigQuery datasets" "GCP-Easy"
send_message 79 "What GCP Pub Sub topics do I have?" "GCP-Easy"
send_message 80 "List my GCP Cloud Run services" "GCP-Easy"
send_message 81 "Show me my GCP billing for the last quarter" "GCP-Medium"
send_message 82 "Which GCP VMs are running and what are their machine types?" "GCP-Medium"
send_message 83 "List GCP resources by project with their costs" "GCP-Medium"
send_message 84 "Show me GCP resources with external IPs" "GCP-Medium"
send_message 85 "What are my most expensive GCP services?" "GCP-Medium"
send_message 86 "List Cloud Storage buckets with their storage classes" "GCP-Medium"
send_message 87 "Show me Cloud SQL instances and their configurations" "GCP-Medium"
send_message 88 "What GKE clusters and their node pool configurations?" "GCP-Medium"
send_message 89 "List my Cloud DNS managed zones" "GCP-Medium"
send_message 90 "Show me GCP Cloud Build triggers and their statuses" "GCP-Medium"
send_message 91 "Analyze my GCP cost trends and identify optimization opportunities" "GCP-Hard"
send_message 92 "Find all GCP resources without proper labels" "GCP-Hard"
send_message 93 "Show me security vulnerabilities in my GCP configuration" "GCP-Hard"
send_message 94 "List all GCP IAM bindings with editor or owner roles" "GCP-Hard"
send_message 95 "Analyze my GCP VM utilization and recommend rightsizing" "GCP-Hard"
send_message 96 "Create a comprehensive GCP cost optimization report" "GCP-Expert"
send_message 97 "Analyze my GCP security posture against CIS GCP Foundation Benchmark" "GCP-Expert"
send_message 98 "Generate a disaster recovery assessment for my GCP resources" "GCP-Expert"
send_message 99 "Show me a complete resource dependency graph for my GCP environment" "GCP-Expert"
send_message 100 "Provide a multi-cloud comparison of my AWS Azure and GCP costs and resources" "Multi-Cloud"

# ============================================================================
# SUMMARY
# ============================================================================
echo -e "\n${YELLOW}=========================================${NC}" | tee -a $LOG_FILE
echo -e "${YELLOW}TEST COMPLETE${NC}" | tee -a $LOG_FILE
echo -e "${YELLOW}=========================================${NC}" | tee -a $LOG_FILE
echo -e "Total Messages: $TOTAL" | tee -a $LOG_FILE
echo -e "${GREEN}Successful: $SUCCESS${NC}" | tee -a $LOG_FILE
echo -e "${RED}Failed: $FAILED${NC}" | tee -a $LOG_FILE

RATE=$(echo "scale=2; ($SUCCESS / $TOTAL) * 100" | bc)
echo -e "Success Rate: ${RATE}%" | tee -a $LOG_FILE

if [ $FAILED -gt 0 ]; then
  echo -e "\n${RED}ERRORS LOGGED TO: $ERROR_LOG${NC}"
fi

echo -e "\nFull log: $LOG_FILE"
