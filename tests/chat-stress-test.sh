# Proprietary and confidential. Unauthorized copying prohibited.

# Comprehensive Chat Mode Stress Test
# Tests all tools, tracks metrics, monitors compaction

API_URL="https://chat-dev.openagentic.io"
API_KEY="awc_ee9773dc4385e4067f8f4d55f7fae7483aa9b02a8b8c675b9f410f0c50a99c92"
SESSION_ID="session_1767618006864_hrdzgbexo"
LOG_FILE="/tmp/chat-stress-test-$(date +%Y%m%d_%H%M%S).log"
METRICS_FILE="/tmp/chat-metrics-$(date +%Y%m%d_%H%M%S).csv"

# Initialize metrics CSV
echo "request_num,message,start_time,end_time,duration_ms,tokens_used,cost,response_length,tool_calls,error" > "$METRICS_FILE"

# Function to send a message and track metrics
send_message() {
    local request_num=$1
    local message=$2
    local start_time=$(date +%s%3N)

    echo "[$request_num] Sending: ${message:0:80}..." | tee -a "$LOG_FILE"

    # Send streaming request and capture response
    local response=$(timeout 120 curl -s -N "$API_URL/api/chat/stream" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"message\": \"$message\", \"sessionId\": \"$SESSION_ID\"}" 2>&1)

    local end_time=$(date +%s%3N)
    local duration=$((end_time - start_time))

    # Extract metrics from response
    local response_length=${#response}
    local tokens=$(echo "$response" | grep -o '"totalTokens":[0-9]*' | tail -1 | cut -d: -f2 || echo "0")
    local cost=$(echo "$response" | grep -o '"totalCost":"[^"]*"' | tail -1 | cut -d'"' -f4 || echo "0")
    local tool_calls=$(echo "$response" | grep -c '"tool_calls"' || echo "0")
    local error=""

    # Check for errors
    if echo "$response" | grep -q '"error"'; then
        error=$(echo "$response" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
        echo "  ERROR: $error" | tee -a "$LOG_FILE"
    else
        echo "  Done in ${duration}ms, ${response_length} chars, tools: $tool_calls" | tee -a "$LOG_FILE"
    fi

    # Log to CSV
    echo "$request_num,\"${message:0:50}\",$(date -d @$((start_time/1000)) +%H:%M:%S),$((end_time/1000)),$duration,$tokens,$cost,$response_length,$tool_calls,\"$error\"" >> "$METRICS_FILE"

    # Small delay between requests
    sleep 1
}

echo "=== Chat Stress Test Started ===" | tee -a "$LOG_FILE"
echo "Session: $SESSION_ID" | tee -a "$LOG_FILE"
echo "Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "Metrics: $METRICS_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# ============================================================================
# PHASE 1: Azure Discovery (Requests 1-20)
# ============================================================================
echo "=== PHASE 1: Azure Discovery ===" | tee -a "$LOG_FILE"

send_message 1 "List all my Azure subscriptions with their IDs and names"
send_message 2 "Show me all resource groups across all subscriptions"
send_message 3 "What is the total count of resources in each subscription?"
send_message 4 "List all virtual machines across all subscriptions with their sizes and status"
send_message 5 "Show me all storage accounts and their tiers"
send_message 6 "What App Services and Function Apps do I have?"
send_message 7 "List all SQL databases and their pricing tiers"
send_message 8 "Show me all Key Vaults and their access policies"
send_message 9 "What networking resources exist? VNets, NSGs, Load Balancers?"
send_message 10 "List all Azure Kubernetes Service clusters"

send_message 11 "Show me all Container Registries and their SKUs"
send_message 12 "What Cosmos DB accounts do I have?"
send_message 13 "List all Redis Cache instances"
send_message 14 "Show me all Event Hubs and Service Bus namespaces"
send_message 15 "What Azure Monitor resources and Log Analytics workspaces exist?"
send_message 16 "List all Application Insights resources"
send_message 17 "Show me all Azure AD applications registered"
send_message 18 "What managed identities are configured?"
send_message 19 "List all role assignments at subscription level"
send_message 20 "Show me resources by tag - what tagging strategy is in use?"

# ============================================================================
# PHASE 2: Cost Analysis (Requests 21-40)
# ============================================================================
echo "=== PHASE 2: Cost Analysis ===" | tee -a "$LOG_FILE"

send_message 21 "What was my total Azure spend last month?"
send_message 22 "Break down costs by subscription for the past 30 days"
send_message 23 "Show me the top 10 most expensive resources"
send_message 24 "What is the cost trend over the past 6 months?"
send_message 25 "Identify any cost anomalies or spikes"
send_message 26 "Show compute costs vs storage costs vs networking costs"
send_message 27 "What reserved instances do I have and are they being utilized?"
send_message 28 "Show me underutilized resources that could be downsized"
send_message 29 "What is my forecasted spend for next month?"
send_message 30 "Create a cost allocation report by resource group"

send_message 31 "Show me cost by service category over time"
send_message 32 "What percentage of spend is on VMs vs PaaS services?"
send_message 33 "Identify any resources with unusually high data transfer costs"
send_message 34 "Show me dev/test resources that could be shut down off-hours"
send_message 35 "What savings would we get from right-sizing VMs?"
send_message 36 "Compare costs between regions"
send_message 37 "Show me orphaned resources costing money"
send_message 38 "What is the cost per environment (dev/staging/prod)?"
send_message 39 "Calculate potential savings from reserved capacity"
send_message 40 "Show me billing alerts and budget thresholds configured"

# ============================================================================
# PHASE 3: Diagrams and Visualizations (Requests 41-60)
# ============================================================================
echo "=== PHASE 3: Diagrams ===" | tee -a "$LOG_FILE"

send_message 41 "Create a network topology diagram of my Azure infrastructure"
send_message 42 "Generate an architecture diagram showing all VNets and their peering"
send_message 43 "Create a diagram showing the flow from App Service to databases"
send_message 44 "Generate a visual representation of my resource group hierarchy"
send_message 45 "Create a diagram showing my AKS cluster architecture"
send_message 46 "Generate a data flow diagram for my application"
send_message 47 "Create a security diagram showing NSG rules and traffic flow"
send_message 48 "Generate an IAM diagram showing role assignments"
send_message 49 "Create a diagram of my CI/CD pipeline in Azure DevOps"
send_message 50 "Generate a disaster recovery architecture diagram"

send_message 51 "Create a cost breakdown pie chart by service"
send_message 52 "Generate a timeline diagram of resource deployments"
send_message 53 "Create an ER diagram of my database schema if accessible"
send_message 54 "Generate a microservices communication diagram"
send_message 55 "Create a monitoring and alerting flow diagram"
send_message 56 "Generate a backup and retention policy diagram"
send_message 57 "Create a multi-region architecture diagram"
send_message 58 "Generate a compliance and security zones diagram"
send_message 59 "Create a diagram showing integration with external services"
send_message 60 "Generate a complete Azure landing zone diagram"

# ============================================================================
# PHASE 4: Detailed Analysis (Requests 61-80)
# ============================================================================
echo "=== PHASE 4: Detailed Analysis ===" | tee -a "$LOG_FILE"

send_message 61 "Analyze VM performance metrics - CPU, memory, disk"
send_message 62 "What are the current health alerts for my resources?"
send_message 63 "Show me failed deployments in the last week"
send_message 64 "Analyze application performance from App Insights"
send_message 65 "What are the most common errors in my applications?"
send_message 66 "Show me database query performance issues"
send_message 67 "Analyze network latency between regions"
send_message 68 "What security recommendations does Azure have?"
send_message 69 "Show me compliance status against Azure policies"
send_message 70 "Analyze storage account access patterns"

send_message 71 "What are the current resource quotas and usage?"
send_message 72 "Show me auto-scaling history and effectiveness"
send_message 73 "Analyze backup job success rates"
send_message 74 "What certificates are expiring soon?"
send_message 75 "Show me secrets that need rotation"
send_message 76 "Analyze API Management usage and quotas"
send_message 77 "What is the SLA performance for my services?"
send_message 78 "Show me resource locks and their purposes"
send_message 79 "Analyze Azure Advisor recommendations"
send_message 80 "What activity logs show unusual patterns?"

# ============================================================================
# PHASE 5: Complex Multi-step Tasks (Requests 81-100)
# ============================================================================
echo "=== PHASE 5: Complex Tasks ===" | tee -a "$LOG_FILE"

send_message 81 "Create a comprehensive inventory report of all Azure resources as an artifact"
send_message 82 "Generate a security audit report with findings and recommendations"
send_message 83 "Create a cost optimization plan with specific actions"
send_message 84 "Generate a disaster recovery playbook for my environment"
send_message 85 "Create a capacity planning report for next quarter"
send_message 86 "Generate a compliance report for SOC 2 requirements"
send_message 87 "Create a network security assessment document"
send_message 88 "Generate a migration assessment for moving to newer services"
send_message 89 "Create an operational runbook for common tasks"
send_message 90 "Generate a monthly executive summary of Azure usage"

send_message 91 "Compare my Azure setup against Well-Architected Framework"
send_message 92 "Create a roadmap for improving reliability"
send_message 93 "Generate a performance optimization guide"
send_message 94 "Create a security hardening checklist"
send_message 95 "Generate a cost governance policy document"
send_message 96 "Create a tagging strategy recommendation"
send_message 97 "Generate a monitoring and alerting strategy"
send_message 98 "Create a backup and recovery strategy document"
send_message 99 "Generate a complete environment documentation package"
send_message 100 "Create an action plan summarizing all findings from this session"

# ============================================================================
# PHASE 6: Context/Compaction Test (Requests 101-110)
# ============================================================================
echo "=== PHASE 6: Context Test ===" | tee -a "$LOG_FILE"

send_message 101 "Summarize everything we discussed about costs"
send_message 102 "What were the key security findings from earlier?"
send_message 103 "Remind me of the top expensive resources we identified"
send_message 104 "What diagrams did we create in this session?"
send_message 105 "Summarize the optimization recommendations"
send_message 106 "What were the main issues found across all analysis?"
send_message 107 "Create a final consolidated report combining all artifacts"
send_message 108 "What is the overall health score of my Azure environment?"
send_message 109 "List the top 5 priority actions I should take"
send_message 110 "Generate a one-page executive brief of this entire analysis"

echo "" | tee -a "$LOG_FILE"
echo "=== Test Complete ===" | tee -a "$LOG_FILE"
echo "Total requests: 110" | tee -a "$LOG_FILE"
echo "Metrics saved to: $METRICS_FILE" | tee -a "$LOG_FILE"

# Get final session stats
echo "" | tee -a "$LOG_FILE"
echo "=== Final Session Stats ===" | tee -a "$LOG_FILE"
curl -s "$API_URL/api/chat/sessions/$SESSION_ID" \
    -H "Authorization: Bearer $API_KEY" | jq '.session | {messageCount, totalTokens, totalCost, model}' | tee -a "$LOG_FILE"

echo "" | tee -a "$LOG_FILE"
echo "Log file: $LOG_FILE"
echo "Metrics CSV: $METRICS_FILE"
