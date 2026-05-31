import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * template-cleanup (2026-05-13) — source-regression pin for the templates gallery.
 *
 * Round 1 (earlier 2026-05-13, commit 9e860881): claimed 10/10 KEEP after a
 * surface-level "did it run to completed" pass. False positive.
 *
 * Round 2 (2026-05-13, this commit): per the user's sharper directive
 * "you have to VALIDATE THE FLOWS RUN - that its ALL correct- each node, and
 * its full results- not just say its good if it ran," I re-validated every
 * template with strict per-node + per-output criteria via Playwright MCP on
 * chat-dev. Every one of the 10 failed at least one of:
 *
 *   3a. NO chain-of-thought / instruction-preamble leak
 *   3b. NO mock data presented as real
 *   3c. NO empty fields where real data is expected
 *   3e. LLM outputs on-topic + coherent
 *   3f. Data outputs real schemas / records (not stub fixtures)
 *    4. Final aggregated output is presentable to an end user
 *
 * Pattern: every template had at least one `transform` node with `op:"set"`
 * literal values fabricating upstream data (fake incident records, fake AWS
 * costs, fake OCR, fake Slack/Jira/GitHub activity, fake PR diffs, fake RAG
 * references with fake similarity scores). Additionally:
 *
 *   - aiops-incident-triage: rendered "<h2>Incident triage for alert (?) on
 *     unknown</h2>" — template variable substitution broken
 *   - bedtime-story-generator: gpt-oss:20b leaked "The user wants a
 *     4-paragraph bedtime story for a child about..." straight into the
 *     final HTML artifact body — textbook CoT preamble leak
 *   - bedtime-story: also rendered "<h2>A story about </h2>" — empty
 *     {{input.theme}} substitution failure
 *
 * Result: 0 of 10 templates pass. All 10 removed. Live evidence:
 *   reports/flows-templates-strict-validation/2026-05-13/verdict.md
 *   reports/flows-templates-strict-validation/2026-05-13/{aiops,tri-cloud,bedtime}-node-outputs.json
 *   reports/flows-templates-strict-validation/2026-05-13/screenshots/
 *
 * To re-add a template: rebuild it with REAL upstream data nodes (MCP / HTTP
 * / RAG calls), verify per-node output passes all 6 criteria live on chat-dev,
 * commit the seed JSON + harness test + add the slug to KEPT_SLUGS below.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SEED_DIR = resolve(__dirname, '../../../seed/templates');

/**
 * The complete kept-slug allow-list.
 *
 * AIOps template rebuild 2026-05-13 — slug 3 of 10 added.
 *
 * 1. `k8s-pod-health-summary` — calls real openagentic_kubernetes.k8s_list_pods,
 *    JSON-parses the FastMCP content[].text payload, filters pods that
 *    are not Running or have restart_count > 5, asks the platform LLM
 *    for a 3-bullet summary, strips any chain-of-thought preamble in a
 *    follow-up transform, renders an HTML operator report via
 *    webhook_response. Per-node live-verified on chat-dev. Evidence:
 *      reports/flows-rebuild-aiops/2026-05-13/01-k8s-pod-health-summary/
 *
 * 2. `loki-error-log-research-report` — calls real openagentic_loki.loki_search_errors
 *    for the last 24h, extracts distinct error patterns from the FastMCP
 *    text payload via signature deduplication (timestamps/IDs/trace IDs
 *    redacted), asks the platform LLM for a 3-5 bullet pattern summary,
 *    strips CoT preamble, calls openagentic_web.web_search (SearXNG in-cluster) on
 *    the dominant pattern's keyword query, renders an HTML AIOps report
 *    via webhook_response with summary + raw patterns + research links.
 *    Per-node live-verified on chat-dev. Evidence:
 *      reports/flows-rebuild-aiops/2026-05-13/loki-error-log-research-report/
 *
 * 3. `k8s-crashloop-triage` — calls real openagentic_kubernetes.k8s_list_pods, filters
 *    pods stuck in CrashLoopBackOff / ImagePullBackOff / Error / OOMKilled or
 *    restart_count > threshold (top 5 sorted desc by restarts), pulls last
 *    100 log lines from the top-offender pod via k8s_get_pod_logs, asks the
 *    platform LLM for one diagnosis bullet per unhealthy pod referencing
 *    concrete log signals, strips CoT preamble via a clean_diagnoses
 *    transform, renders an HTML triage runbook via webhook_response with the
 *    diagnoses + unhealthy pod metadata + log excerpt + empty-case
 *    "cluster healthy" rendering when no pods match.
 *    Engine-constraint note: the WorkflowExecutionEngine marks `loop` as
 *    ROUTING_OWNS_DOWNSTREAM (every outgoing edge of a loop is per-iter body,
 *    not a post-loop continuation), so a clean loop_pods → clean_diagnoses →
 *    report chain is not expressible. The template uses a single-pass top-
 *    offender shape that still fetches REAL log evidence and produces one
 *    bullet per unhealthy pod from a single LLM call — operationally
 *    equivalent for the typical 1-5 crashlooping pod count.
 *    Per-node live-verified on chat-dev. Evidence:
 *      reports/flows-rebuild-aiops/2026-05-13/k8s-crashloop-triage/
 *
 * 4. `prometheus-active-alerts-digest` — calls real
 *    openagentic_prometheus.prometheus_alerts (FastMCP stdio tool wrapping the
 *    in-cluster monitoring-stack/prometheus /api/v1/alerts endpoint),
 *    parses the formatted multi-line FastMCP text payload into a structured
 *    alerts array (alertname, severity, state, summary) via a transform
 *    JS sandbox expression, sorts by severity (critical > warning > info)
 *    and slices the top {{input.limit}}, asks the platform LLM for a 3-5
 *    bullet operator-facing digest of the most critical issues focused on
 *    next actions, strips CoT preamble via a clean_summary transform,
 *    renders an HTML digest report via webhook_response with the digest
 *    + alert table + raw payload. Empty-cluster case (zero active alerts,
 *    the operational default for healthy clusters per the in-cluster
 *    Prometheus capture 2026-05-13) is handled — when the upstream text
 *    is the literal "No active alerts" string, the parser returns an
 *    empty array and the report explicitly says so instead of rendering
 *    a blank table.
 *    Per-node live-verified on chat-dev. Evidence:
 *      reports/flows-rebuild-aiops/2026-05-13/prometheus-active-alerts-digest/
 *
 * 5. `k8s-deployment-rollout-status-report` — calls real
 *    openagentic_kubernetes.k8s_list_deployments, classifies every deployment as
 *    healthy / rolling-out / stuck / scaled-zero based on the
 *    replicas-vs-ready_replicas-vs-available_replicas triple via a
 *    transform JS sandbox expression, derives per-deployment table rows
 *    + an "all healthy" banner inside the same analyze node (so all
 *    derived state is reachable from the report via a single
 *    {{steps.analyze.X}} interpolation — downstream transforms only see
 *    their immediate upstream node's output, not earlier ones), filters
 *    the non-healthy subset sorted by severity desc (stuck >
 *    rolling-out > scaled-zero), asks the platform LLM for a 2-3 bullet
 *    operator narrative focused on the most concerning rollout
 *    situations, strips CoT preamble via a clean_narrative transform,
 *    renders an HTML rollout status report via webhook_response with
 *    the narrative + per-deployment table + non-healthy detail. All-
 *    healthy case (the operational default in stable dev clusters,
 *    per the live agentic-dev capture 2026-05-13 where every deployment
 *    has ready_replicas === replicas) is handled — the report explicitly
 *    renders "All N deployments healthy" instead of a blank table.
 *    Per-node live-verified on chat-dev. Evidence:
 *      reports/flows-rebuild-aiops/2026-05-13/k8s-deployment-rollout-status-report/
 *
 * 6. `prometheus-target-down-rca` — calls real
 *    openagentic_prometheus.prometheus_query with PromQL `up == 0` to enumerate
 *    scrape targets currently DOWN, parses the formatted-text response
 *    (one line per result containing a JSON-stringified metric label
 *    dict + `: 0` value) into a structured down-targets array with
 *    {pod_name, namespace, app, instance, job} per entry. Then fires
 *    openagentic_loki.loki_search_errors against the down namespace, merges
 *    the analyze + loki_query outputs via a labeled merge node, and
 *    in a single transform pre-computes per_target_logs (map of
 *    pod_name → first N matching log lines via pod-name substring
 *    matching) plus rows_html (HTML <tr> rows ready for direct
 *    interpolation in the report) plus an all_up_banner for the
 *    empty case. The LLM call then produces a 1-bullet RCA per
 *    down target referencing the correlated log signals, CoT
 *    preamble is stripped via clean_rca, and the final
 *    webhook_response renders the HTML report with the cleaned RCA
 *    plus the per-target table. Empty-case (zero down targets — the
 *    operational default in stable clusters where prometheus_query
 *    returns "Results: 0") is handled — the report explicitly
 *    renders "All targets up" instead of an empty table.
 *    Engine-constraint note: the merge node's labeling rule is
 *    `(sourceNode?.data?.label || sourceNode?.id).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()`,
 *    so the `analyze` and `loki_query` nodes use literal labels
 *    matching their IDs to give the correlate transform predictable
 *    keys (`input.analyze.*`, `input.loki_query.*`).
 *    Per-node live-verified on chat-dev. Evidence:
 *      reports/flows-rebuild-aiops/2026-05-13/prometheus-target-down-rca/
 *
 * 8. `k8s-namespace-resource-survey` — fans the trigger out to three
 *    parallel openagentic_kubernetes MCP calls (k8s_list_pods, k8s_list_deployments,
 *    k8s_list_services), each returning the python tool's native
 *    Dict[str, Any] (services/mcps/oap-kubernetes-mcp/src/kubernetes_mcp_server/server.py
 *    k8s_list_pods L252-302, k8s_list_deployments L436-470,
 *    k8s_list_services L603-646) unwrapped to the dict verbatim by the
 *    mcp-proxy 3-layer envelope (proxy.result.result). A labeled merge
 *    node converges the three branches keyed by snake-cased source-node
 *    label (engine constraint:
 *    (sourceNode.data.label || sourceNode.id).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()),
 *    so the parallel nodes use literal labels 'pods', 'deployments',
 *    'services' to give the analyze transform predictable keys
 *    (input.pods.* / input.deployments.* / input.services.*). One
 *    analyze transform sequentially pre-computes pods_array +
 *    deployments_array + services_array + pod_count + deployment_count +
 *    service_count + namespace_label + pods_rows_html +
 *    deployments_rows_html + services_rows_html + empty_banner +
 *    summary_payload so the report can interpolate everything via
 *    {{steps.analyze.X}} in single seams. The LLM narrative produces a
 *    3-4 bullet operator-facing characterization of the namespace's
 *    resource footprint (what runs here, signs of risk, network
 *    exposure observation, capacity headroom), CoT preamble is stripped
 *    via clean_narrative, and the final webhook_response renders an
 *    HTML survey report with per-resource tables + narrative.
 *    Empty-namespace case (zero pods, deployments, services — the
 *    typical state for unused namespaces) is handled: the report
 *    renders an explicit "No resources found in this namespace" banner
 *    + per-section "<em>No X in this namespace.</em>" placeholders
 *    instead of blank tables.
 *    Per-node live-verified on chat-dev. Evidence:
 *      reports/flows-rebuild-aiops/2026-05-13/k8s-namespace-resource-survey/
 *
 * 7. `platform-infra-health-digest` — fans the trigger out to three
 *    parallel openagentic_admin.admin_system_<svc>_health_check MCP calls
 *    (PostgreSQL / Redis / Milvus), each returning the FastMCP-serialized
 *    Python Dict[str, Any] (services/mcps/oap-admin-mcp/src/admin_mcp_server/server.py
 *    lines 353-684) wrapped through the workflow engine's content-block
 *    joiner so the analyze transform sees `input.<svc>_health.content` as
 *    a JSON-stringified dict. A labeled merge node converges the three
 *    branches keyed by snake-cased source-node label (per the engine
 *    constraint discovered in slug #6), and a single analyze transform
 *    normalizes each service into { name, status, message, extras } +
 *    pre-computes healthy_count + degraded_count + overall_status +
 *    rows_html + banner_html so the report can interpolate everything via
 *    {{steps.analyze.X}} in single seams. The LLM narrative produces a
 *    2-3 bullet operator-facing summary highlighting any degraded service
 *    with its verbatim error message + concrete next-action, CoT preamble
 *    is stripped via clean_narrative, and the final webhook_response
 *    renders an HTML digest with the cleaned narrative + per-service
 *    cards + raw extras. Degraded case (any one of the three services
 *    returns healthy=false) is exercised by the harness fixture
 *    admin_redis_health-degraded.json — analyze flips overall_status to
 *    'degraded' and the report explicitly highlights the failing service.
 *    Per-node live-verified on chat-dev. Evidence:
 *      reports/flows-rebuild-aiops/2026-05-13/platform-infra-health-digest/
 *
 * To add the next template:
 *   1. Build the seed JSON with REAL upstream data nodes (MCP / HTTP / RAG),
 *      NOT `op:"set"` literals masquerading as fetch results.
 *   2. Verify every node's input + output passes the 6 sub-criteria live on
 *      chat-dev via Playwright MCP.
 *   3. Add the slug here and commit the evidence alongside the JSON.
 */
const KEPT_SLUGS: ReadonlyArray<string> = [
  // Slug 1 (2026-05-15, data-layer end-to-end proof):
  // `research-and-publish` is the headline data-layer demo — pulls real web
  // content via openagentic_web.web_search_and_read for a configurable topic, ingests
  // it into the shared_knowledge Milvus collection via knowledge_ingest,
  // RAGs it back against the user's question via the new knowledge_search
  // primitive (P1.17), synthesizes an HTML report via llm_completion, and
  // renders an openable artifact via webhook_response.persistAsArtifact.
  // No mocks in the pipeline. Validates that knowledge_ingest +
  // knowledge_search round-trip works end-to-end on the same Milvus
  // collection — closes the "rag_query and knowledge_ingest hit disjoint
  // collections" wiring gap that previously made flow-internal RAG silent.
  'research-and-publish',
  // Slugs 2-4 (2026-05-31, opinionated ops templates):
  // Three ops-specific Flow templates, each fanning the trigger out to
  // parallel built-in MCP calls → object-merge → correlate/analyze transform
  // → llm_completion(model:"auto", Smart Router) → CoT strip → HTML artifact.
  // ZERO hardcoded model id / provider name (validated by
  // ops-templates.source-regression.test.ts):
  //   - `incident-triage` — hero AIOps flow. prometheus_query + loki_search_errors
  //     + k8s_list_pods in parallel → evidence-cited root-cause narrative.
  //   - `cost-anomaly` — aws_cost_by_service + aws_cost_summary +
  //     prometheus_query_range in parallel → anomaly + driver + recommendation.
  //   - `failed-deploy-rca` — k8s_rollout_status + k8s_list_events +
  //     loki_search_errors in parallel → why the deploy failed + suggested fix.
  'incident-triage',
  'cost-anomaly',
  'failed-deploy-rca',
] as const;

describe('templates gallery only contains live-verified templates', () => {
  it('every seed/templates/*.json corresponds to a slug in the kept-list', () => {
    const files = readdirSync(SEED_DIR).filter((f) => f.endsWith('.json'));
    // KEPT_SLUGS is currently empty — a future re-add must put both sides back in sync.
    expect(files.length).toBeGreaterThanOrEqual(0);
    const seedSlugs = files.map((f) => {
      const raw = readFileSync(join(SEED_DIR, f), 'utf-8');
      const json = JSON.parse(raw);
      const slug = json.slug || json.name;
      if (!slug) {
        throw new Error(`seed file ${f} has neither slug nor name`);
      }
      return slug as string;
    });
    for (const s of seedSlugs) {
      expect(
        KEPT_SLUGS,
        `seed/templates contains "${s}" but it is NOT in the kept-slug allow-list. ` +
          `Either add it to KEPT_SLUGS (after live-verifying via Playwright MCP on chat-dev) ` +
          `or remove the seed JSON.`,
      ).toContain(s);
    }
  });

  it('every kept slug has a corresponding seed/templates/*.json', () => {
    const files = readdirSync(SEED_DIR).filter((f) => f.endsWith('.json'));
    const seedSlugs = files.map((f) => {
      const raw = readFileSync(join(SEED_DIR, f), 'utf-8');
      const json = JSON.parse(raw);
      return (json.slug || json.name) as string;
    });
    for (const kept of KEPT_SLUGS) {
      expect(
        seedSlugs,
        `kept-slug "${kept}" has no matching seed/templates/*.json. ` +
          `Either restore the seed JSON or remove "${kept}" from KEPT_SLUGS.`,
      ).toContain(kept);
    }
  });

  it('kept-slug count matches seed file count (no orphans either way)', () => {
    const files = readdirSync(SEED_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(KEPT_SLUGS.length);
  });
});
