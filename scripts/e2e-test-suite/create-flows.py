# Proprietary and confidential. Unauthorized copying prohibited.

"""
E2E Deployment Validation Suite -- Creates all 5 test flows via API.
Run after every deployment to validate platform health.
"""

import json
import os
import sys
import argparse
import requests

# ─── Tier 0: Infrastructure Health ──────────────────────────────────────

TIER_0 = {
    "name": "E2E Tier 0: Infrastructure",
    "description": "Validates core infrastructure: PostgreSQL, Redis, Milvus, Kubernetes pods, Ollama, MCP Proxy, API health. Must pass before other tiers run. Uses admin_full_system_test for comprehensive coverage.",
    "is_public": True,
    "tags": ["e2e", "tier-0", "infrastructure", "admin"],
    "definition": {
        "nodes": [
            {
                "id": "trigger",
                "type": "trigger",
                "position": {"x": 0, "y": 300},
                "data": {"label": "Tier 0 Trigger", "icon": "FlaskConical", "color": "#ff9800", "triggerType": "manual"}
            },
            {
                "id": "admin-full-test",
                "type": "mcp_tool",
                "position": {"x": 350, "y": 100},
                "data": {
                    "label": "Admin Full System Test",
                    "icon": "Shield",
                    "color": "#e91e63",
                    "toolName": "admin_full_system_test",
                    "toolServer": "oap-admin-mcp",
                    "toolArgs": {"include_slow_tests": True, "verbose": True}
                }
            },
            {
                "id": "api-health",
                "type": "code",
                "position": {"x": 350, "y": 250},
                "data": {
                    "label": "API + DB + Redis Health",
                    "icon": "HeartPulse",
                    "color": "#22c55e",
                    "code": "var start = Date.now(); try { var r = await fetch('http://openagentic-api.agentic-dev.svc.cluster.local:8000/admin/health/system', {headers: {'Authorization': 'Bearer ' + (input?.authToken || '')}}); var data = await r.json(); return {status: 'PASS', latency: Date.now() - start, overall: data.overall, database: data.database, prompts: data.prompts?.status}; } catch(e) { return {status: 'FAIL', error: e.message, latency: Date.now() - start}; }"
                }
            },
            {
                "id": "embeddings-health",
                "type": "code",
                "position": {"x": 350, "y": 400},
                "data": {
                    "label": "Embeddings Service Health",
                    "icon": "Cpu",
                    "color": "#7c4dff",
                    "code": "var start = Date.now(); try { var r = await fetch('http://openagentic-api.agentic-dev.svc.cluster.local:8000/api/embeddings/health'); var data = await r.json(); return {status: data.status === 'healthy' ? 'PASS' : 'FAIL', provider: data.provider, model: data.model, dimensions: data.dimensions, latency: Date.now() - start}; } catch(e) { return {status: 'FAIL', error: e.message, latency: Date.now() - start}; }"
                }
            },
            {
                "id": "k8s-pods",
                "type": "mcp_tool",
                "position": {"x": 350, "y": 550},
                "data": {
                    "label": "Kubernetes Pod Status",
                    "icon": "Server",
                    "color": "#326ce5",
                    "toolName": "k8s_list_pods",
                    "toolServer": "oap-kubernetes-mcp",
                    "toolArgs": {"namespace": "agentic-dev"}
                }
            },
            {
                "id": "merge-t0",
                "type": "merge",
                "position": {"x": 700, "y": 300},
                "data": {"label": "Merge Infrastructure Results", "icon": "GitMerge", "color": "#2196f3", "mergeStrategy": "object"}
            },
            {
                "id": "evaluate-t0",
                "type": "code",
                "position": {"x": 1000, "y": 300},
                "data": {
                    "label": "Evaluate Tier 0",
                    "icon": "CheckCircle",
                    "color": "#22c55e",
                    "code": "var checks = [];\nvar passed = 0; var failed = 0;\n\n// Check admin full test\nvar adminTest = input?.admin_full_system_test;\nvar adminOk = adminTest && !adminTest._failedBranch && !adminTest.error;\nif (adminOk) { var overall = adminTest?.results?.overall_status || adminTest?.overall_status; adminOk = overall === 'PASS'; }\nchecks.push({name: 'Admin Full System Test', status: adminOk ? 'PASS' : 'FAIL', detail: adminOk ? adminTest?.summary_message || 'All checks passed' : (adminTest?.error || 'Failed')});\nif(adminOk) passed++; else failed++;\n\n// Check API health\nvar apiHealth = input?.api___db___redis_health;\nvar apiOk = apiHealth && apiHealth.status === 'PASS';\nchecks.push({name: 'API + DB + Redis', status: apiOk ? 'PASS' : 'FAIL', detail: apiOk ? 'Overall: ' + apiHealth.overall + ' (' + apiHealth.latency + 'ms)' : (apiHealth?.error || 'Failed')});\nif(apiOk) passed++; else failed++;\n\n// Check embeddings\nvar embHealth = input?.embeddings_service_health;\nvar embOk = embHealth && embHealth.status === 'PASS';\nchecks.push({name: 'Embeddings Service', status: embOk ? 'PASS' : 'FAIL', detail: embOk ? embHealth.provider + '/' + embHealth.model + ' ' + embHealth.dimensions + 'd (' + embHealth.latency + 'ms)' : (embHealth?.error || 'Failed')});\nif(embOk) passed++; else failed++;\n\n// Check k8s pods\nvar k8sPods = input?.kubernetes_pod_status;\nvar k8sOk = k8sPods && !k8sPods._failedBranch && !k8sPods.error;\nchecks.push({name: 'Kubernetes Pods', status: k8sOk ? 'PASS' : 'FAIL', detail: k8sOk ? 'Pods retrieved successfully' : (k8sPods?.error || 'Failed')});\nif(k8sOk) passed++; else failed++;\n\nvar total = passed + failed;\nreturn {\n  tier: 'Tier 0: Infrastructure',\n  scorecard: checks,\n  summary: {total: total, passed: passed, failed: failed, passRate: Math.round(passed/total*100) + '%'},\n  verdict: failed === 0 ? 'INFRASTRUCTURE HEALTHY' : passed + '/' + total + ' PASS - ' + failed + ' CRITICAL',\n  timestamp: new Date().toISOString(),\n  gate: failed === 0\n};"
                }
            },
            {
                "id": "report-t0",
                "type": "openagentic_llm",
                "position": {"x": 1300, "y": 300},
                "data": {
                    "label": "Tier 0 Report",
                    "icon": "FileText",
                    "color": "#7c4dff",
                    "prompt": "Generate a concise Tier 0 Infrastructure Health report in Markdown.\n\nResults: {{steps.evaluate-t0.output}}\n\nFormat:\n# Tier 0: Infrastructure Health\n**Status:** [PASS/FAIL]\n**Timestamp:** [time]\n\n| Component | Status | Details |\n|-----------|--------|---------|\n[table rows]\n\n**Verdict:** [verdict]\n**Gate:** [Can proceed to Tier 1: yes/no]",
                    "temperature": 0.1,
                    "maxTokens": 800,
                    "sliderOverride": 50
                }
            }
        ],
        "edges": [
            {"id": "e1", "source": "trigger", "target": "admin-full-test"},
            {"id": "e2", "source": "trigger", "target": "api-health"},
            {"id": "e3", "source": "trigger", "target": "embeddings-health"},
            {"id": "e4", "source": "trigger", "target": "k8s-pods"},
            {"id": "e5", "source": "admin-full-test", "target": "merge-t0"},
            {"id": "e6", "source": "api-health", "target": "merge-t0"},
            {"id": "e7", "source": "embeddings-health", "target": "merge-t0"},
            {"id": "e8", "source": "k8s-pods", "target": "merge-t0"},
            {"id": "e9", "source": "merge-t0", "target": "evaluate-t0"},
            {"id": "e10", "source": "evaluate-t0", "target": "report-t0"}
        ]
    }
}


def create_flow(base_url: str, token: str, flow_def: dict) -> dict:
    """Create or update a workflow via the API."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "x-api-key": token,
    }

    # Check if flow exists by name
    r = requests.get(f"{base_url}/api/workflows", headers=headers)
    r.raise_for_status()
    existing = [w for w in r.json().get("workflows", []) if w["name"] == flow_def["name"]]

    if existing:
        wf_id = existing[0]["id"]
        r = requests.put(f"{base_url}/api/workflows/{wf_id}", headers=headers, json={"definition": flow_def["definition"]})
        r.raise_for_status()
        print(f"  Updated: {flow_def['name']} ({wf_id})")
        return r.json()
    else:
        r = requests.post(f"{base_url}/api/workflows", headers=headers, json=flow_def)
        r.raise_for_status()
        wf = r.json().get("workflow", r.json())
        print(f"  Created: {flow_def['name']} ({wf.get('id', '?')})")
        return wf


def main():
    parser = argparse.ArgumentParser(description="Create E2E test flows")
    parser.add_argument("--base-url", default="https://chat-dev.openagentic.io")
    parser.add_argument("--token", default=os.environ.get("OpenAgentic_API_KEY", ""),
                        help="API token (or set OpenAgentic_API_KEY env var)")
    parser.add_argument("--tier", choices=["0", "1", "2", "3", "master", "all"], default="all")
    args = parser.parse_args()

    if not args.token:
        print("Error: No API token. Set OpenAgentic_API_KEY env var or pass --token")
        sys.exit(1)

    flows = {"0": TIER_0}  # More tiers added in subsequent tasks

    if args.tier == "all":
        for name, flow in sorted(flows.items()):
            print(f"Creating Tier {name}...")
            create_flow(args.base_url, args.token, flow)
    else:
        if args.tier in flows:
            print(f"Creating Tier {args.tier}...")
            create_flow(args.base_url, args.token, flows[args.tier])
        else:
            print(f"Tier {args.tier} not yet implemented")
            sys.exit(1)

    print("Done.")


if __name__ == "__main__":
    main()
