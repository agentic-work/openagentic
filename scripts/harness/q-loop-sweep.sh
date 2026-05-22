#!/usr/bin/env bash
# scripts/harness/q-loop-sweep.sh — drive Q1-Q20 from PROMPTS.md serially.
# Captures NDJSON + meta per Q under reports/verify-cadence/Q-loop-<sha>/Q<N>/.
#
# Usage: OPENAGENTIC_TEST_KEY=awc_xxxx scripts/harness/q-loop-sweep.sh
set -uo pipefail

SHA="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
SUITE_DIR="${SUITE_DIR:-reports/verify-cadence/Q-loop-$SHA}"
mkdir -p "$SUITE_DIR"

KEY="${OPENAGENTIC_TEST_KEY:-$(test -f ~/.openagentic-test-key && cat ~/.openagentic-test-key)}"
test -n "$KEY" || { echo "ERROR: OPENAGENTIC_TEST_KEY not set" >&2; exit 2; }

# Q-loop prompts (verbatim from reports/verify-cadence/Q-loop-93f970bc-2026-05-14/PROMPTS.md)
declare -A PROMPTS=(
  [Q1]="show me my Azure subscriptions and what's in each resource group"
  [Q2]="do a full security audit across all tenants of openagentic-omhs"
  [Q3]="interrogate the Front Door + App Gateway config for the prod tenant — show traffic flow, listeners, and WAF rules"
  [Q4]="show me all my Cloud Run services across regions and their current health"
  [Q5]="the staging deploy is failing — diagnose, fix, rebuild, and verify it's healthy"
  [Q6]="audit my EKS clusters across regions, surface cost + right-sizing opportunities, and generate a runbook"
  [Q7]="Our cloud bill is up 40% MoM. Find the top 10 cost spikes across Azure/AWS/GCP and tell me what to cut."
  [Q8]="Sev-1 firing — openagentic-api p99 latency just doubled. Tell me what broke and what to do."
  [Q9]="Run a HIPAA audit on every storage bucket/account across all clouds. Flag anything public, anything without encryption, anything without versioning."
  [Q10]="I want to migrate the legacy MSSQL on-prem to Azure SQL Managed Instance. Give me a phased plan with downtime estimates."
  [Q11]="I have a production outage. Page the on-call rotation, pull the last 15min of error logs from every k8s cluster in every region across all 3 clouds, correlate with last 5 deploys, find the smoking gun, and write me the post-mortem template with timeline + root cause + 3 action items."
  [Q12]="Build me a real-time cloud-cost burn-rate dashboard: pull current spend from Azure/AWS/GCP, project monthly run-rate, flag any service category > 20% MoM, render a sankey of spend flow + a top-10 line chart of trends, AND give me a Python script I can run locally to keep this dashboard fresh."
  [Q13]="We're moving 47 microservices from on-prem k8s to a multi-cloud setup. Generate the migration plan: dependency graph, wave-based rollout (4 waves), per-wave runbook with exact kubectl + terraform commands, network-fabric topology, DR plan, AND a phased cost model."
  [Q14]="Audit every IAM principal across all 3 clouds for overly-broad permissions. List service accounts/managed identities/roles with * permissions or admin-equivalent, the resources they touch, and a least-privilege replacement. Render as a per-cloud table + a cross-cloud heatmap of risk."
  [Q15]="I need to add MFA enforcement + conditional access to all Azure subscriptions tonight. Show me which subscriptions don't have it, what would break, and give me the exact PowerShell + az CLI sequence to roll it out safely with rollback."
  [Q16]="Compute the actual SLO breach budget for the last 30 days across our top-5 services. Pull p99 latency + error rate from Prometheus, intersect with the published SLOs, render a per-service error-budget burn chart, flag anyone in the red, and recommend a freeze list."
  [Q17]="Our security team flagged 14 CVEs against our images this week. For each CVE: find every running pod across all clusters using the affected image, the blast radius, the patched version available, and the upgrade order considering dependency constraints. Generate a Jira-ready ticket set."
  [Q18]="The openagentic-api pod is OOM-killing every 7 hours in prod. Pull the last 24h of memory/CPU metrics, GC stats, correlate with traffic patterns + deploy timeline, identify the root cause, and produce a fix + a regression test."
  [Q19]="Build me a complete OpenTelemetry trace-correlation report: for a single request_id, pull the full trace span tree across api + mcp-proxy + openagentic-proxy + synth-executor + Milvus + Redis + Postgres, surface every span > 100ms, render the critical-path waterfall, AND propose 3 concrete code-level optimizations."
  [Q20]="Design + implement a FedRAMP High-compliant cross-region failover for the chatmode stack. Zero customer data leaves CONUS, RPO ≤ 5 min, RTO ≤ 15 min, dual-control HITL for region-switch. Deliver: arch diagram (mermaid), terraform module skeleton, runbook, and a chaos-engineering test plan."
)

# Drive in numeric order
for N in $(seq 1 20); do
  QID="Q$N"
  PROMPT="${PROMPTS[$QID]}"
  echo ""
  echo "================ $QID ================"
  echo "$PROMPT" | head -c 100
  echo ""
  QDIR="$SUITE_DIR/$QID"
  EVIDENCE_DIR="$QDIR" OPENAGENTIC_TEST_KEY="$KEY" OPENAGENTIC_TIMEOUT=240 scripts/harness/chat-probe.sh "$QID" "$PROMPT" 2>&1 | tee "$QDIR-summary.txt" | tail -10
  echo ""
done

echo ""
echo "================ SWEEP COMPLETE ================"
echo "Evidence: $SUITE_DIR/"
ls -la "$SUITE_DIR" | head -25
