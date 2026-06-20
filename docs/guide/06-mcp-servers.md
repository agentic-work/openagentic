# MCP Servers

OpenAgentic ships with **nine built-in MCP servers** that give agents real,
auditable hands on your infrastructure: the three cloud providers (AWS, Azure,
GCP), Kubernetes, the Prometheus and Loki observability stack, GitHub, a
platform-administration server, and an intelligent web-research server.

These servers are **not** separate processes you run yourself. They are spawned
and managed by the `openagentic-mcp-proxy` service. The proxy:

- knows how to start each built-in server (as a local `stdio` subprocess or, for
  some, by attaching to a remote HTTP/SSE endpoint),
- runs the MCP `initialize` handshake and indexes each server's tools into the
  platform's tool-discovery catalog so chat and flows can call them,
- injects per-request user context (cloud tokens, the GitHub token, the user's
  email) into the tool calls that need it,
- enforces admin-only access on the privileged servers, and
- can enable/disable individual servers at runtime.

This page documents each server — what it does, the tools it exposes, and the
credentials it needs — followed by how the proxy spawns them and how you turn
servers on and off.

> **Authentication note for the OSS edition.** OpenAgentic OSS is **local-auth
> only** (username/password + JWT + API keys); there is no Azure AD / SSO / OBO.
> Several cloud servers were originally written to consume a per-user cloud token
> delivered through SSO. Where that is the case it is called out below, because
> it changes what "configured" means for that server in an OSS install. The
> servers still **spawn** without credentials — an unconfigured server only
> reports an error when a tool is actually called.

---

## The nine built-in servers at a glance

| Server (proxy id) | Source dir | Spawn | Purpose | Creds needed |
|---|---|---|---|---|
| `openagentic_aws` (`aws`) | `services/mcps/oap-aws-mcp` | `stdio` (or remote) | AWS operations: EC2, S3, IAM, RDS, Lambda, Bedrock, Cost Explorer, … | AWS keypair / mounted `~/.aws` |
| `openagentic_azure` (`azure`) | `services/mcps/oap-azure-mcp` | `stdio` (or remote) | Azure ARM + Cost Management: VMs, AKS, networking, Key Vault, storage, … | Per-user ARM token (see note) |
| `openagentic_gcp` (`gcp`) | `services/mcps/oap-gcp-mcp` | `stdio` | GCP: Compute, GCS, Cloud Run, Vertex AI, billing, monitoring, … | GCP service account / mounted ADC |
| `openagentic_kubernetes` (`kubernetes`) | `services/mcps/oap-kubernetes-mcp` | `stdio` | Cluster admin: pods, deployments, nodes, Helm, rollouts | In-cluster SA token or mounted `~/.kube` |
| `openagentic_prometheus` (`prometheus`) | `services/mcps/oap-prometheus-mcp` | `stdio` | Query Prometheus metrics, alerts, targets, rules | None (points at a Prometheus URL) |
| `openagentic_loki` (`loki`) | `services/mcps/oap-loki-mcp` | `stdio` | Query/search/tail logs via Loki | None to start; needs a `LOKI_URL` to query |
| `openagentic_github` (`github`) | `services/mcps/oap-github-mcp` | `stdio` | GitHub repos, issues, PRs, Actions, commits | Per-user GitHub token |
| `openagentic_admin` (`admin`) | `services/mcps/oap-admin-mcp` | `stdio` (or remote) | Platform self-observability + workflow tools (**admin only**) | None (uses platform DB/Redis/Milvus) |
| `openagentic_web` (`web`) | `services/mcps/oap-web-mcp` | `stdio` | Web search, fetch, fact-check, structured extraction | None (SearXNG + scraping fallbacks) |

`web` and `admin` need **no credentials**. The cloud servers (`aws`, `azure`,
`gcp`) read credentials either from `~/.openagentic/cloud-secrets/*.env` or from
your mounted host CLI configs (`~/.aws`, `~/.azure`, `~/.config/gcloud`). `kubernetes`
uses the in-cluster ServiceAccount token (Helm) or a mounted `~/.kube` (compose).

---

## aws — `openagentic_aws`

**What it does.** A broad AWS operations server built on `boto3`, covering
compute, storage, identity, databases, serverless, container services,
messaging, monitoring, cost, and Amazon Bedrock. It exposes roughly **69 tools**.

**Representative tools** (`services/mcps/oap-aws-mcp/server.py`):

- **Universal / discovery:** `call_aws` (execute any AWS API via service/operation),
  `suggest_aws_commands`, `aws_list_accounts`, `aws_identity`.
- **Cost:** `aws_cost_summary`, `aws_cost_by_service`.
- **Compute & networking:** `aws_list_ec2`, `aws_describe_ec2_instance`,
  `aws_list_security_groups`, `aws_list_volumes`, `aws_list_vpcs`,
  `aws_list_subnets`.
- **Storage:** `aws_list_s3`.
- **IAM (read):** `aws_list_iam_users`, `aws_list_iam_roles`,
  `aws_list_iam_policies`, `aws_list_iam_groups`, `aws_get_iam_account_summary`,
  `aws_get_iam_account_password_policy`, `aws_list_iam_access_keys`,
  `aws_list_iam_mfa_devices`, and per-entity policy/attachment listings.
- **Databases & serverless:** `aws_list_rds_instances`,
  `aws_describe_rds_instance`, `aws_list_lambdas`, `aws_describe_lambda`,
  `aws_list_dynamodb_tables`, `aws_describe_dynamodb_table`.
- **Containers & messaging:** `aws_list_eks_clusters`, `aws_describe_eks_cluster`,
  `aws_list_sns_topics`, `aws_list_sqs_queues`, `aws_list_secrets`,
  `aws_list_kms_keys`.
- **Monitoring:** `aws_list_cw_alarms`, `aws_list_cw_metrics`.
- **Bedrock:** `aws_bedrock_list_foundation_models`,
  `aws_bedrock_list_inference_profiles`, `aws_bedrock_invoke_model`,
  `aws_bedrock_list_guardrails`, `aws_bedrock_agent_list_agents`,
  `aws_bedrock_agent_list_knowledge_bases`, `aws_bedrock_create_knowledge_base`,
  `aws_bedrock_invoke_agent`, and more.

**Credentials.** Uses the standard `boto3` default credential chain. In compose,
the proxy mounts `~/.aws` read-only and also loads
`~/.openagentic/cloud-secrets/aws.env`, so a static keypair
(`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) or your existing AWS CLI profile
both work. The proxy passes `AWS_REGION`, `AWS_ACCOUNT_ID`, the keypair, and Redis
connection info (for credential caching) into the subprocess.

> The server also contains an OBO path that exchanges an Azure AD token for AWS
> credentials via AWS Identity Center. That path depends on SSO and is **not** used
> in an OSS local-auth install — the static keypair / mounted profile is the OSS path.

**Spawn.** Local `stdio` by default:
`fastmcp run -t stdio /app/mcp-servers/oap-aws-mcp/server.py`. If
`OpenAgentic_AWS_MCP_URL` is set, the proxy attaches to a remote HTTP server instead.

---

## azure — `openagentic_azure`

**What it does.** A consolidated Azure server covering **both** ARM operations
**and** Cost Management. It exposes roughly **96 tools** spanning subscriptions,
resource groups, compute, AKS, networking, storage, Key Vault, identity, cost,
security, Log Analytics / App Insights, Resource Graph, and Advisor.

**Representative tools** (`services/mcps/oap-azure-mcp/src/server.py`):

- **Discovery & inventory:** `azure_help`, `azure_list_subscriptions`,
  `azure_list_resource_groups`, `azure_get_resource_group_inventory`,
  `azure_resource_graph_query`, `azure_resource_graph_query_tenant_wide`,
  `azure_list_public_facing_resources`, `azure_list_management_groups`.
- **Resource group lifecycle:** `azure_create_resource_group`,
  `azure_delete_resource_group`.
- **Compute (VMs):** `azure_list_vms`, `azure_get_vm`, `azure_start_vm`,
  `azure_stop_vm`, `azure_restart_vm`, `azure_deallocate_vm`,
  `azure_resize_vm`, `azure_delete_vm`.
- **AKS:** `azure_list_aks_clusters`, `azure_get_aks_cluster`,
  `azure_get_aks_credentials`.
- **Networking:** `azure_list_vnets`, `azure_create_vnet`, `azure_create_subnet`,
  `azure_list_nsgs`, `azure_create_nsg`, `azure_list_load_balancers`,
  app-gateway tools (`azure_list_app_gateways`, `azure_get_app_gateway`,
  `azure_app_gateway_backend_health`, start/stop/create), and Front Door tools.
- **Storage & secrets:** `azure_list_storage_accounts`, `azure_list_containers`,
  `azure_list_blobs`, `azure_list_keyvaults`, `azure_list_secrets`,
  `azure_get_secret`, `azure_set_secret`.
- **Identity:** `azure_list_users`, `azure_get_user`, `azure_list_groups`,
  `azure_list_apps`.
- **Cost:** `azure_cost_query`, `azure_cost_by_service`, `azure_cost_forecast`,
  `azure_cost_forecast_for_resource_group`.
- **Security & ops:** `azure_security_list_assessments`,
  `azure_security_secure_score`, `azure_security_list_alerts`,
  `azure_log_analytics_query`, `azure_app_insights_query`,
  `azure_advisor_recommendations`, `azure_service_health_events`,
  `azure_activity_log`, `azure_get_metrics`.

**Credentials (read this).** The Azure MCP source is written for **direct
per-user Azure AD tokens only** — it explicitly has *no* service-principal
auth, *no* `DefaultAzureCredential`, and *no* OBO exchange. Every tool calls
`require_user_token(meta)` and **hard-fails if no `userAccessToken` is present**.
The proxy injects Azure tokens (`userAccessToken`, `graphAccessToken`,
`keyvaultAccessToken`, …) into the tool call's `meta` block, but those tokens
originate from an Azure AD SSO session.

Because **OSS is local-auth only with no AAD/SSO**, this server will **spawn**
but cannot authenticate Azure calls out of the box — there is no user ARM token
to inject. The `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` /
`AZURE_SUBSCRIPTION_ID` env vars that the proxy forwards are **not consumed** by
this server. Treat the Azure server as present-but-unauthenticated in OSS unless
you supply an ARM access token via the tool's `meta`.

**Spawn.** Local `stdio` by default:
`fastmcp run -t stdio /app/mcp-servers/oap-azure-mcp/src/server.py`. If
`OpenAgentic_AZURE_MCP_URL` is set, the proxy attaches to a remote HTTP server.

---

## gcp — `openagentic_gcp`

**What it does.** A Google Cloud server using **service-account authentication**.
It exposes roughly **71 tools** covering Compute Engine, Cloud Storage, projects,
networking, IAM, Cloud SQL, Secret Manager, Artifact Registry, Cloud Run, GKE,
billing/cost, monitoring, and Vertex AI.

**Representative tools** (`services/mcps/oap-gcp-mcp/src/server.py`):

- **Universal / discovery:** `gcp_api_execute`, `gcp_api_help`,
  `gcp_list_projects`, `gcp_get_project`, `gcp_list_zones`, `gcp_list_regions`.
- **Compute:** `gcp_list_instances`, `gcp_get_instance`, `gcp_start_instance`,
  `gcp_stop_instance`, `gcp_list_machine_types`, `gcp_list_disks`.
- **Storage:** `gcp_list_buckets`, `gcp_list_bucket_objects`.
- **Networking:** `gcp_list_networks`, `gcp_list_firewalls`.
- **Billing & cost:** `gcp_get_billing_info`, `gcp_list_billing_accounts`,
  `gcp_get_billing_account`, `gcp_list_billing_account_projects`,
  `gcp_query_cost_usage`.
- **IAM & security:** `gcp_list_service_accounts`, `gcp_get_iam_policy`,
  `gcp_list_secrets`.
- **Data & artifacts:** `gcp_list_cloud_sql_instances`,
  `gcp_describe_cloud_sql_instance`, `gcp_list_artifact_repositories`.
- **Cloud Run:** `gcp_list_cloud_run_services`, `gcp_get_cloud_run_service`,
  `gcp_delete_cloud_run_service`, plus revisions, jobs, executions, and
  operations tools.
- **GKE & logs:** `gcp_list_gke_clusters`, `gcp_list_log_entries`,
  `gcp_monitoring_query`.
- **Vertex AI:** `vertex_ai_list_models`, `vertex_ai_list_endpoints`,
  `vertex_ai_generative_models`, `gcp_vertex_deploy_model`,
  `gcp_vertex_create_endpoint`, and related model/endpoint lifecycle tools.

**Credentials.** Resolves GCP credentials in this order:

1. `GCP_CREDENTIALS_JSON` (service-account JSON as a string env var),
2. `GCP_CREDENTIALS_FILE` (path to a service-account JSON file),
3. Application Default Credentials (ADC).

In compose, the proxy mounts `~/.config/gcloud` read-only and loads
`~/.openagentic/cloud-secrets/gcp.env`, so a mounted `gcloud` ADC session or an
exported service-account JSON both work. `GCP_PROJECT_ID` and `GCP_REGION`
(default `us-central1`) are also passed through. The server has an optional
per-user OBO context, but the OSS path is service-account / ADC.

**Spawn.** Local `stdio` only:
`fastmcp run -t stdio /app/mcp-servers/oap-gcp-mcp/src/server.py`.

---

## kubernetes — `openagentic_kubernetes`

**What it does.** A full Kubernetes administration server (read **and** write,
with a critical safety rail). It exposes tools for namespaces, pods, deployments,
services, ConfigMaps/Secrets, ReplicaSets, DaemonSets, ServiceAccounts, Ingresses,
events, nodes, rollouts, and Helm releases.

**Representative tools** (`services/mcps/oap-kubernetes-mcp/src/kubernetes_mcp_server/server.py`):

- **Inventory:** `k8s_list_namespaces`, `k8s_get_namespace`, `k8s_list_pods`,
  `k8s_get_pod`, `k8s_get_pod_logs`, `k8s_list_deployments`,
  `k8s_get_deployment`, `k8s_list_services`, `k8s_get_service`,
  `k8s_list_configmaps`, `k8s_get_configmap`, `k8s_list_secrets` (values **not**
  returned), `k8s_list_replicasets`, `k8s_list_daemonsets`,
  `k8s_list_serviceaccounts`, `k8s_list_ingresses`, `k8s_list_nodes`,
  `k8s_list_events` / `k8s_get_events`, `k8s_cluster_health`.
- **Mutating ops:** `k8s_create_namespace`, `k8s_delete_namespace`,
  `k8s_delete_pod`, `k8s_scale_deployment`, `k8s_restart_deployment`,
  `k8s_apply_yaml`, `k8s_patch_resource`, `k8s_cleanup_pods`.
- **Rollouts:** `k8s_rollout_status`, `k8s_rollout_history`, `k8s_rollout_undo`.
- **Nodes:** `k8s_cordon_node`, `k8s_uncordon_node`, `k8s_drain_node`.
- **Discovery & Helm:** `k8s_list_contexts`, `k8s_get_current_context`,
  `k8s_list_api_resources`, `k8s_explain_resource`, `helm_list`, `helm_status`.

**Protected-namespace safety rail.** The namespace OpenAgentic itself runs in is
**read-only**. The server reads `OPENAGENTIC_NAMESPACE` (default `openagentic`,
set to the release namespace by Helm) and **blocks every mutating operation** —
create/delete/scale/restart/apply/patch/cleanup/drain — against that namespace,
returning an "Access denied … read-only for safety" error. Read tools still work
everywhere, and each result is tagged with `is_protected`.

**Credentials.** Kubernetes config is auto-detected: in-cluster
(`load_incluster_config()`) when running as a pod, otherwise a kubeconfig
(`load_kube_config()`). On Helm, the mcp-proxy pod's ServiceAccount token plus a
read-oriented RBAC role (`templates/mcp-proxy-rbac.yaml`) is what authorizes the
calls — no external creds. The proxy re-injects `KUBERNETES_SERVICE_HOST` /
`KUBERNETES_SERVICE_PORT` (which the hardened env filter strips) so in-cluster
auth works. On compose, mount `~/.kube` (the proxy does this read-only) and/or
set `KUBECONFIG`.

**Access control.** This is an **admin-only** server — the proxy denies it to
non-admin users (see [Admin-only servers](#admin-only-access-control)).

**Spawn.** Local `stdio`:
`fastmcp run -t stdio /app/mcp-servers/oap-kubernetes-mcp/server.py`.

---

## prometheus — `openagentic_prometheus`

**What it does.** A read-only metrics server that queries a Prometheus instance.
It exposes **8 tools** (`services/mcps/oap-prometheus-mcp/src/prometheus_mcp_server/server.py`):

| Tool | Purpose |
|---|---|
| `prometheus_query` | Run an instant PromQL query |
| `prometheus_query_range` | Run a PromQL range query (time series) |
| `prometheus_alerts` | List currently firing/pending alerts |
| `prometheus_targets` | List scrape targets and their health |
| `prometheus_metrics_list` | List available metric names |
| `prometheus_metric_info` | Describe a metric (type/help/labels) |
| `prometheus_rules` | List recording & alerting rules |
| `prometheus_health_summary` | Roll-up health view |

**Credentials.** None required. The server points at `PROMETHEUS_URL` (default
`http://prometheus:9090`). Compose wires this to the in-stack Prometheus; Helm
sets it from `mcps.prometheus.url`. Optional basic-auth
(`PROMETHEUS_USERNAME` / `PROMETHEUS_PASSWORD`) is supported for protected
Prometheus endpoints.

**Spawn.** Local `stdio`:
`fastmcp run -t stdio /app/mcp-servers/oap-prometheus-mcp/server.py`. Admin-oriented.

---

## loki — `openagentic_loki`

**What it does.** A log-aggregation server that queries Grafana Loki. It exposes
**9 tools** (`services/mcps/oap-loki-mcp/src/loki_mcp_server/server.py`):

| Tool | Purpose |
|---|---|
| `loki_query` | Run a LogQL query |
| `loki_search_errors` | Find error-level log lines |
| `loki_tail` | Tail recent logs for a stream |
| `loki_labels` | List available label names |
| `loki_label_values` | List values for a label |
| `loki_count_logs` | Count matching log lines |
| `loki_log_rate` | Compute log throughput / rate |
| `loki_context` | Fetch surrounding lines for a log entry |
| `loki_streams` | List active log streams |

**Credentials.** None required to **start**. To actually query, point it at your
Loki with `LOKI_URL` (default in code is `http://loki:3100`). The compose stack
leaves `LOKI_URL` unset by default (you supply your own Loki); optional basic-auth
(`LOKI_USERNAME` / `LOKI_PASSWORD`) is supported.

**Spawn.** Local `stdio`:
`fastmcp run -t stdio /app/mcp-servers/oap-loki-mcp/server.py`. Admin-oriented.

---

## github — `openagentic_github`

**What it does.** A GitHub server that performs operations with a **per-user
GitHub token**. It exposes **19 tools** (`services/mcps/oap-github-mcp/server.py`):

- **User & repos:** `get_user`, `list_repos`, `get_repo`, `search_repos`,
  `list_branches`, `get_file_contents`.
- **Issues:** `list_issues`, `get_issue`, `create_issue`, `update_issue`.
- **Pull requests:** `list_pull_requests`, `get_pull_request`,
  `create_pull_request`.
- **Code search:** `search_code`.
- **Actions:** `list_workflows`, `get_workflow_runs`, `trigger_workflow`.
- **Commits:** `list_commits`, `get_commit`.

**Credentials.** Every tool reads a token from the request `meta` —
`extract_token()` looks for `meta.githubToken` (falling back to
`meta.userAccessToken`) and raises *"Please connect your GitHub account in
Settings"* if absent. The proxy injects the user's GitHub token into the call.
In compose you can supply a token via `GITHUB_TOKEN` in `.env`. GitHub Enterprise
Server is supported via the optional `GITHUB_HOST` (the base URL becomes
`https://<host>/api/v3`); otherwise it targets `GITHUB_API_URL`
(default `https://api.github.com`).

The proxy marks this server `supports_obo=True`, meaning it expects a per-user
token rather than a shared service credential.

**Spawn.** Local `stdio`:
`fastmcp run -t stdio /app/mcp-servers/oap-github-mcp/server.py`.

---

## admin — `openagentic_admin`

**What it does.** The platform self-observability and workflow-operations server.
It does **not** touch any cloud — its tools read OpenAgentic's own PostgreSQL,
Redis, and Milvus, report platform health, surface audit data, manage platform
users, and drive workflows. It is composed from several modules under
`services/mcps/oap-admin-mcp/src/admin_mcp_server/`.

**System observability** (`server.py`):

- **PostgreSQL:** `admin_system_postgres_raw_query` (**SELECT-only**, see below),
  `admin_system_postgres_list_tables`, `admin_system_postgres_health_check`,
  `admin_system_postgres_active_connections`,
  `admin_system_pgvector_list_collections`.
- **Redis:** `admin_system_redis_get_key`,
  `admin_system_redis_list_keys_by_pattern`, `admin_system_redis_health_check`,
  `admin_system_redis_stats`.
- **Milvus:** `admin_system_milvus_list_collections`,
  `admin_system_milvus_get_collection_info`, `admin_system_milvus_health_check`,
  `admin_system_milvus_collection_stats`.
- **Platform health:** `admin_system_user_sessions`,
  `admin_system_llm_provider_status`, `admin_system_network_connectivity_check`,
  `admin_system_api_health`, `admin_system_infrastructure_health_check`,
  `admin_full_system_test`.

**Users** (`user_tools.py`): `admin_system_users_list_all`,
`admin_system_users_get_by_id` (platform users — *not* Azure AD users).

**Audit** (`audit_tools.py`): `admin_audit_get_user_activity`,
`admin_audit_get_user_chats`, `admin_audit_get_login_history`,
`admin_audit_get_error_analysis`, `admin_audit_get_usage_statistics`.

**Workflows** (`workflow_tools.py`): `workflow_list`, `workflow_get`,
`workflow_create`, `workflow_create_from_description`, `workflow_update`,
`workflow_execute`, `workflow_execute_by_name`, `workflow_status`,
`workflow_execution_list`, `workflow_execution_get`, `workflow_delete`,
`workflow_duplicate`, `workflow_test`.

**Read-only SQL guard.** `admin_system_postgres_raw_query` is restricted to
read-only access: the query must begin with `SELECT`, `WITH`, or `EXPLAIN`, and
is rejected if it contains any of `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`,
`TRUNCATE`, `CREATE`, etc. Write operations are blocked for safety.

**Credentials.** None external. The server connects to the platform's own
PostgreSQL/Redis/Milvus using connection info the proxy forwards
(`DATABASE_URL`, and best-effort `REDIS_*` / `MILVUS_*`). The proxy only forwards
those vars when they are **set and non-empty**, so the server can fall back to its
own sane defaults (`milvus`, `redis`) rather than stalling on an empty host.

**Access control.** **Admin only.** The proxy denies `openagentic_admin` (and
`openagentic_kubernetes`) to non-admin users.

**Spawn.** Local `stdio` by default:
`fastmcp run -t stdio /app/mcp-servers/oap-admin-mcp/server.py`. If
`OpenAgentic_ADMIN_MCP_URL` is set, the proxy attaches to a remotely-hosted admin
server over HTTP instead.

---

## web — `openagentic_web`

**What it does.** An intelligent web-research server for search, fetching, and
fact verification. It exposes **8 tools** (`services/mcps/oap-web-mcp/server.py`):

| Tool | Purpose |
|---|---|
| `web_search` | Search the web |
| `web_fetch` | Fetch and clean a page |
| `web_search_and_read` | Search, then read the top results |
| `web_verify_fact` | Cross-check a claim against sources |
| `web_store_knowledge` | Persist a finding to platform memory |
| `web_extract_structured_data` | Pull structured fields from a page |
| `web_news_search` | News-oriented search |
| `web_help` | Usage guidance for the model |

**Search backend.** Primary backend is a self-hosted **SearXNG**
(`SEARXNG_URL`, default `http://searxng:8080`) — the compose stack ships a
`searxng` service for exactly this, so web search works **with no paid API key**.
If SearXNG is unavailable, the server falls back to scraping DuckDuckGo (HTML),
Bing, and Google.

**Credentials.** None. Outbound fetches go through an **SSRF guard**
(`oap-web-mcp/ssrf_guard.py`) so the tool can't be coerced into hitting internal
addresses. `web_store_knowledge` posts to the platform memory endpoint via
`MEMORY_MCP_URL` (default `http://mcp-proxy:3100`).

**Spawn.** Local `stdio`:
`python /app/mcp-servers/oap-web-mcp/server.py`.

---

## How the mcp-proxy spawns the servers

All of the above is wired in `MCPManager.initialize_servers()` in
`services/openagentic-mcp-proxy/src/mcp_manager.py`. When the proxy boots it
constructs one server object per built-in MCP and registers it in
`self.servers` keyed by its proxy id (`openagentic_aws`, `openagentic_web`, …).

There are two server types:

- **`MCPServer` (stdio).** The default. The proxy `Popen`s a subprocess (almost
  all built-ins use `fastmcp run -t stdio <path>`; `web` uses `python <path>`)
  and talks **JSON-RPC over stdin/stdout**. On start it runs the MCP `initialize`
  handshake (with bounded retry — a merely-slow server is left `RUNNING` and its
  tools get indexed lazily on the next `tools/list`).
- **`RemoteMCPServer` (HTTP/SSE).** Used when a `*_MCP_URL` env var is set
  (`aws`, `azure`, `admin` support this). The proxy health-checks the remote
  endpoint, runs `initialize` over HTTP, and **eagerly caches** its tool list.

A few important behaviors:

- **Filtered child environment (NIST 800-53 SC-4).** Subprocesses do **not** inherit
  the proxy's full environment. Only a small allow-list
  (`PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `TZ`, `PYTHONPATH`, `NODE_PATH`,
  `NODE_ENV`, `LOG_LEVEL`) plus each server's explicit per-server env dict is
  passed in. This is why, e.g., the Kubernetes server config has to **re-inject**
  `KUBERNETES_SERVICE_HOST/PORT`.
- **Per-request user context.** On a `tools/call`, the proxy injects a `meta`
  block into the tool arguments — but **only** for the servers that need it:
  `openagentic_azure`, `openagentic_aws`, `openagentic_gcp`,
  `openagentic_github` (and the legacy `openagentic_openagentic`). For Azure it
  injects the full set of audience-scoped tokens; for GitHub it injects the
  GitHub token; everywhere it can attach `userEmail` for workspace isolation.
  Servers like `web` and `admin` are deliberately **not** given `meta` (it would
  trip FastMCP validation).
- **Tool indexing.** After start, `list_all_tools()` calls `tools/list` on every
  `RUNNING` server; those tools flow into the platform's discovery catalog so the
  model can find and call them in chat and flows.
- **Lazy reconnect.** A failed **remote** server is retried on the next tool call.

> The proxy also registers two helpers when enabled: a `sequential_thinking` MCP
> (`@modelcontextprotocol/server-sequential-thinking`, **off by default** —
> `SEQUENTIAL_THINKING_MCP_DISABLED=true`) and an `aws_knowledge` remote MCP
> (AWS-hosted docs). These are not part of the nine documented built-ins.
> Several historically-bundled servers (Alertmanager, Incident, Runbook,
> Agent-Architect, Knowledge) were **removed upstream** as out-of-scope or
> redundant and are no longer registered.

---

## Enabling and disabling servers

There are three layers of control.

### 1. The `*_MCP_DISABLED` env flags (the real switch)

`initialize_servers()` reads one `OpenAgentic_<NAME>_MCP_DISABLED` flag per
server. If a flag is `"true"` the server is **never registered, never spawned,
and never indexed**. These are set in `docker-compose.yml` (mcp-proxy service)
and `helm/openagentic/templates/mcp-proxy.yaml`.

Compose defaults — all nine built-ins **spawn out of the box**:

```yaml
OpenAgentic_WEB_MCP_DISABLED:        ${OpenAgentic_WEB_MCP_DISABLED:-false}
OpenAgentic_ADMIN_MCP_DISABLED:      ${OpenAgentic_ADMIN_MCP_DISABLED:-false}
OpenAgentic_AWS_MCP_DISABLED:        ${OpenAgentic_AWS_MCP_DISABLED:-false}
OpenAgentic_AZURE_MCP_DISABLED:      ${OpenAgentic_AZURE_MCP_DISABLED:-false}
OpenAgentic_GCP_MCP_DISABLED:        ${OpenAgentic_GCP_MCP_DISABLED:-false}
OpenAgentic_KUBERNETES_MCP_DISABLED: ${OpenAgentic_KUBERNETES_MCP_DISABLED:-false}
OpenAgentic_GITHUB_MCP_DISABLED:     ${OpenAgentic_GITHUB_MCP_DISABLED:-false}
OpenAgentic_PROMETHEUS_MCP_DISABLED: ${OpenAgentic_PROMETHEUS_MCP_DISABLED:-false}
OpenAgentic_LOKI_MCP_DISABLED:       ${OpenAgentic_LOKI_MCP_DISABLED:-false}
# helper servers, off by default:
SEQUENTIAL_THINKING_MCP_DISABLED:    ${SEQUENTIAL_THINKING_MCP_DISABLED:-true}
```

To turn a server off in compose, set its flag in `.env`, e.g.:

```bash
OpenAgentic_LOKI_MCP_DISABLED=true
```

> **An unconfigured server still starts.** None of the built-ins hard-require a
> credential or URL to *spawn*. A server with no usable creds (e.g. AWS with no
> keypair, Loki with no `LOKI_URL`) boots fine and only surfaces a
> "needs config" / connection error when a tool is actually called.

Helm has different defaults than compose, tuned for a barebones cluster install:
`web`, `admin`, and the in-cluster ops MCPs (`kubernetes`, `prometheus`) are
**on**, while the cloud MCPs (`aws`, `azure`, `gcp`) and `github`/`loki` default
to **disabled** because they need credentials a fresh cluster doesn't have. The
`kubernetes` and `prometheus` flags are templated off the structured toggles:

```yaml
# helm/openagentic/values.yaml
mcps:
  enabled: "web,knowledge,admin,kubernetes,prometheus"   # legacy CSV (display/back-compat only)
  kubernetes:
    enabled: true          # uses the pod ServiceAccount + read RBAC
  prometheus:
    enabled: true
    url: "http://prometheus:9090"
```

> **`MCPS_ENABLED` / `mcps.enabled` is documentary only.** The proxy does **not**
> read the CSV list to decide what to spawn — the comment in `docker-compose.yml`
> is explicit about this. The per-MCP `*_MCP_DISABLED` flags are the actual gate.
> Keep the CSV in sync for readability, but flipping it alone does nothing.

### 2. Runtime enable/disable (Redis-backed)

Build-time flags decide what gets registered. Once registered, a server can be
toggled **at runtime** without redeploying:

- `MCPManager.set_server_enabled(server_id, enabled)` flips
  `config.enabled`, starts or stops the subprocess accordingly, and **persists**
  the state to Redis under `mcp:server:enabled:<server_id>`.
- On boot, `_load_enabled_states_from_redis()` applies any persisted overrides on
  top of the build-time config, so a runtime toggle survives restarts.

This is the mechanism behind enabling/disabling servers from the **admin
console's MCP fleet** view.

### 3. Admin-only access control

Two servers are gated to admins regardless of whether they're enabled. In the
proxy (`main.py`), `check_server_access()` treats `admin`, `openagentic_admin`,
and `openagentic_kubernetes` as **admin-only** and denies them to non-admin
users. (In an OSS local-auth install where auth is disabled, the local user
runs as a system admin and has access.)

---

## The admin MCP fleet

The admin console surfaces a **fleet view** of every registered MCP server. It is
backed by the proxy's status/management surface:

- **Status.** `MCPManager.get_server_status()` returns, per server: `status`
  (`stopped` / `starting` / `running` / `failed`), `enabled`, `last_error`,
  `transport` (`stdio` or `remote`), and the subprocess `pid`. This is what the
  fleet view renders.
- **Enabled state.** `list_server_enabled_states()` and `get_server_enabled()`
  report the on/off state; `set_server_enabled()` changes it (and persists to
  Redis, per above).
- **Lifecycle.** The manager also exposes `start_server`, `stop_server`,
  `restart_server`, `add_server`, and `remove_server` for managing servers
  dynamically. `add_server` accepts both a flat config and the Claude-Desktop
  `{"mcpServers": {...}}` shape; a config whose command is the literal
  `"builtin"` is treated as an in-process no-op (it is not `Popen`ed).

In short: the nine built-in MCP servers give OpenAgentic agents real reach into
clouds, clusters, observability, source control, and the web — spawned and
indexed automatically by the mcp-proxy, gated by per-MCP disable flags and
runtime toggles, with the privileged `admin` and `kubernetes` servers locked to
admins and the deployment namespace protected as read-only.
