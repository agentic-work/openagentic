#!/usr/bin/env python3
"""
Sync from the internal upstream (~/agenticwork/agentic or $OAP_UPSTREAM)
into this OSS tree, with:
  - Path renames (agenticwork-* → openagentic-*, awp-*-mcp → oap-*-mcp, …)
  - Content renames (brand rewrite)
  - A filter list of "internal-only turds" that never belong in OSS
  - A preserve list of files that carry our local fixes (never overwritten)

Usage:
  python3 tools/sync-upstream.py [--dry-run]

Env:
  OAP_UPSTREAM    path to the internal upstream (default: ~/agenticwork/agentic)
  OAP_DRY_RUN     1 = list-only, no writes
"""
import os, shutil, re, sys

UPSTREAM = os.path.expanduser(os.environ.get('OAP_UPSTREAM', '~/agenticwork/agentic'))
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY_RUN = '--dry-run' in sys.argv or os.environ.get('OAP_DRY_RUN') == '1'

# ─── Renames (apply to upstream path to get our path) ────────────────────────
RENAMES = [
    ('services/agenticwork-api',           'services/openagentic-api'),
    ('services/agenticwork-ui',            'services/openagentic-ui'),
    ('services/agenticwork-workflows',     'services/openagentic-workflows'),
    ('services/agenticwork-mcp-proxy',     'services/openagentic-mcp-proxy'),
    ('services/agenticwork-ollama',        'services/openagentic-ollama'),
    ('services/agenticode-exec',           None),  # Code Mode removed from OSS entirely (no lock screen)
    ('services/agenticode-manager',        None),  # Code Mode removed from OSS entirely (no lock screen)
    ('services/agenticode-server',         None),  # Code Mode removed from OSS entirely (no lock screen)
    ('services/agent-proxy',               'services/openagentic-proxy'),
    ('services/oat-executor',              'services/openagentic-synth'),
    ('services/mcps/awp-admin-mcp',        'services/mcps/oap-admin-mcp'),
    ('services/mcps/awp-aws-mcp',          'services/mcps/oap-aws-mcp'),
    ('services/mcps/awp-azure-mcp',        'services/mcps/oap-azure-mcp'),
    ('services/mcps/awp-azure-cost-mcp',   'services/mcps/oap-azure-cost-mcp'),
    ('services/mcps/awp-gcp-mcp',          'services/mcps/oap-gcp-mcp'),
    ('services/mcps/awp-github-mcp',       'services/mcps/oap-github-mcp'),
    ('services/mcps/awp-kubernetes-mcp',   'services/mcps/oap-kubernetes-mcp'),
    ('services/mcps/awp-loki-mcp',         'services/mcps/oap-loki-mcp'),
    ('services/mcps/awp-prometheus-mcp',   'services/mcps/oap-prometheus-mcp'),
    ('services/mcps/awp-web-mcp',          'services/mcps/oap-web-mcp'),
    # The 9 wired built-ins are above. These 5 were removed upstream as out-of-
    # scope/redundant and are NOT wired in mcp_manager.py initialize_servers;
    # dropped from OSS entirely (None) so a sync never re-creates the dead dirs.
    ('services/mcps/awp-knowledge-mcp',       None),
    ('services/mcps/awp-alertmanager-mcp',    None),
    ('services/mcps/awp-incident-mcp',        None),
    ('services/mcps/awp-runbook-mcp',         None),
    ('services/mcps/awp-agent-architect-mcp', None),
    ('services/mcps/awp-agenticode-mcp',   None),  # Code Mode MCP — dropped from OSS entirely
    ('helm/agenticwork',                   'helm/openagentic'),
]

# ─── Filter: directories whose contents never cross the OSS boundary ─────────
SKIP_PREFIXES = (
    # Brand-leaked workflow node — the upstream ships a 'agenticwork_chat' node
    # whose path has no awp-/agenticwork- prefix to rewrite, so a sync would
    # re-create it in the public OSS tree. Removed in the 2026-06-09 cleanup;
    # SKIP so it never returns. (0 importers — dead brand leak.)
    'services/shared/workflow-engine/src/nodes/agenticwork_chat/',
    # Docs, mockups, screenshots, internal tracking
    'docs/', 'tests/uat/', 'tests/results/', 'tests/reports/',
    # Internal CI / k8s-deploy machinery
    '.github/workflows/cd-', '.github/workflows/deploy-', '.github/workflows/deploy.yaml',
    '.github/workflows/sync-main-to-develop', '.github/workflows/build-runner-image',
    '.github/workflows/build-images', '.github/workflows/test-runner',
    '.github/workflows/claude-code-review', '.github/workflows/sonar',
    '.github/workflows/trivy', '.github/workflows/gitleaks',
    '.github/workflows/dependency-review', '.github/workflows/helm-publish',
    '.github/workflows/e2e-int-test', '.github/workflows/flows-harness',
    '.github/arc/', '.github/install-arc', '.github/arc-runner-',
    '.github/SETUP.md', '.github/setup-arc-aks', '.github/arc-setup.md',
    'gitops/', 'helm/values/',
    # Runtime artifacts + leaked tokens from harness runs
    '.a2a-queue/', '.auth/', '.uc-harness-token',
    # Internal-only helm: per-tenant Kong + Milvus configs, SonarQube,
    # internal todo, customer-specific AKS prereq doc
    'helm/kong-', 'helm/milvus-', 'helm/sonarqube/',
    'helm/todo.md', 'helm/openagentic/DEPLOYMENT-PREREQS-AKS.md',
    # Companion repos / customer-specific / internal worktrees — never OSS
    'agenticode-cli/', 'ghostpilot/', 'sdk/', 'oat/',
    'brainbow/', 'peraton/', 'mocks/', 'infra/',
    'parity-evidence/', 'helm_old_do_not_use/',
    'synth/', 'companions/',
    'agenticwork-sdk/', 'agenticwork-agenticode-sdk/',
    '.worktrees/', '.worktree/',
    # Test results / UAT reports live only in the internal upstream
    'tests/MCP_', 'tests/uat',
    'test-results/', 'testing/', 'reports/',
    # Build artifacts / editor state / internal workspace
    'node_modules/', 'dist/', 'build/', '.next/', '.astro/', '__pycache__/',
    '.venv/', 'venv/', '.turbo/',
    'report/', 'todos/', 'observability/', 'k8s/',
    'published-packages/', 'iam-policies/', 'demos/',
    '.superpowers/', '.serena/', '.claude/',
    '.git/', '.playwright-mcp/', 'playwright-report/',
    # Internal deploy scripts (keep scripts/ dir but not these)
    'scripts/buildx/', 'scripts/e2e-test-suite/', 'scripts/load-tests/',
    # Agenticwork-branded helm chart copy (we ship helm/openagentic only)
    'helm/agenticwork/',
    # Upstream session notes / dev-only audit dumps
    'services/audit/',
    # Code Mode — removed from OSS entirely (too heavy to ship/operate at v1).
    # Source, exec runtime, manager, admin pages, MCPs, helm templates,
    # e2e specs — all OSS-out at sync time.
    'services/openagentic-exec/', 'services/openagentic-manager/',
    'services/openagentic-server/',
    'services/openagentic-api/src/routes/code-mode/',
    'services/openagentic-api/src/routes/admin/codemode',
    'services/openagentic-api/src/routes/admin/code-mode-config',
    'services/openagentic-api/src/routes/admin/coding-adapters',
    'services/openagentic-api/src/services/coding-adapters/',
    'services/openagentic-api/src/services/code/',
    'services/openagentic-api/src/tests/codemode/',
    'services/openagentic-ui/src/features/code/',
    'services/openagentic-ui/src/features/admin/components/CodeMode/',
    'services/openagentic-ui/src/features/admin/components/Code/',
    # New CodeMode leak paths upstream introduced post-#218 (CCR architecture).
    # Added 2026-05-26 after a sync re-leaked these into the OSS tree contra
    # commit 111ca5e (Strip CodeMode source policy).
    'services/openagentic-api/src/routes/code-ws/',
    'services/openagentic-ui/src/codemode/',
    'services/openagentic-ui/src/features/admin/pages-v3/code-mode/',
    'services/mcps/awp-agenticode-mcp/', 'services/mcps/oap-code-mcp/',
    'helm/openagentic/templates/code-manager/',
    'tests/e2e/ui/codemode', 'tests/e2e/codemode',
    'tests/load/scenarios/codemode/',
    # Playwright reports (generated artifacts)
    'services/openagentic-ui/playwright-report/',
    'services/openagentic-ui/tests/e2e/playwright-report-tests-e2e/',
    # Pytest cache / coverage / ruff cache / throwaway test venvs / editor
    # state — generated junk, never OSS. The upstream leaves .ruff_cache/ and
    # .venv-test/ scattered under services/mcps/* and at the repo root; without
    # these prefixes their contents leak into the OSS tree on sync.
    '.pytest_cache/', 'coverage/', '.ruff_cache/', '.venv-test/',
    # API internal planning docs / phase trackers / scratch
    'services/openagentic-api/PHASE',
    'services/openagentic-api/SWAGGER_',
    'services/openagentic-api/docs/SWAGGER_',
    'services/openagentic-api/docs/eval/',
    'services/openagentic-api/docs/AZURE_AI_FOUNDRY',
    'services/openagentic-api/docs/DEEPSEEK_',
    'services/openagentic-api/docs/MCP_CALL_LOGGING',
    'services/openagentic-api/docs/LLM_PROVIDER_CONFIGURATION',
    'services/openagentic-api/docs/API_SCHEMA_EXAMPLES',
    'services/openagentic-api/docs/agent-registry-coverage',
    'services/openagentic-api/temp-dist/',
    'services/openagentic-api/scripts/cleanup-',
    'services/openagentic-api/scripts/router-tuning-harness',
    'services/openagentic-api/scripts/wire-timeline',
    'services/openagentic-api/src/UNUSED_CODE_AUDIT',
    'services/openagentic-api/src/memory/IMPLEMENTATION_SUMMARY',
    'services/openagentic-api/src/routes/chat/REQUIREMENTS',
    'services/openagentic-api/src/__tests__/architecture/phase-',
    'services/openagentic-api/src/__tests__/architecture/KNOWN_VIOLATIONS_',
    # UI internal scratch / mocks / dev one-offs
    'services/openagentic-ui/docs/current/',
    'services/openagentic-ui/DEV-README',
    'services/openagentic-ui/public/mocks-',
    'services/openagentic-ui/cloud-test-',
    'services/openagentic-ui/local-cloud-test',
    'services/openagentic-ui/execute-audit-test',
    'services/openagentic-ui/test-prompt-',
    'services/openagentic-ui/test-streaming',
    'services/openagentic-ui/run-tests.sh',
    'services/openagentic-ui/playwright.config.deployed',
    'services/openagentic-ui/src/features/chat/components/KEY_CODE_SNIPPETS',
    'services/openagentic-ui/src/features/chat/components/VISUAL_GUIDE',
    # UI UAT/showcase e2e tests
    'services/openagentic-ui/e2e/headed-uat-',
    'services/openagentic-ui/e2e/uat-',
    'services/openagentic-ui/e2e/uat.sh',
    'services/openagentic-ui/e2e/v060-llm-crud-uat',
    'services/openagentic-ui/e2e/uat-session',
    'services/openagentic-ui/e2e/suite1-platform-stress',
    'services/openagentic-ui/e2e/ac-sonnet45-',
    'services/openagentic-ui/e2e/showcase-',
    'services/openagentic-ui/e2e/comprehensive-features',
    'services/openagentic-ui/e2e/full-platform-e2e',
    'services/openagentic-ui/e2e/interactive-driver',
    'services/openagentic-ui/e2e/prove-deployed-flows',
    'services/openagentic-ui/e2e/seed-templates',
    'services/openagentic-ui/e2e/v060-agents-e2e',
    'services/openagentic-ui/e2e/v060-core-features',
    'services/openagentic-ui/e2e/v060-monitoring',
    'services/openagentic-ui/e2e/smart-router-test',
    'services/openagentic-ui/e2e/streaming-artifacts',
    'services/openagentic-ui/e2e/streaming-parity',
    'services/openagentic-ui/e2e/ttft-benchmark',
    'services/openagentic-ui/e2e/page-check',
    'services/openagentic-ui/e2e/interleaved-content',
    'services/openagentic-ui/e2e/suite2-flows-agents-integration',
    'services/openagentic-ui/e2e/execute-all-ready',
    'services/openagentic-ui/e2e/large-data-handling',
    # Workflows internal QA reports
    'services/openagentic-workflows/qa-',
    # MCP internal research docs
    'services/mcps/oap-aws-mcp/FEDERATION_RESEARCH',
    'services/mcps/oap-aws-mcp/OBO_SETUP',
    'services/mcps/oap-admin-mcp/MIGRATION',
    # Synth-executor / openagentic-synth dead duplicate subdir
    'services/openagentic-synth/src/oat_executor/',
    # Helm internal-only deploy docs / customer configs
    'helm/AKS_DEPLOYMENT', 'helm/AZURE_KEYVAULT', 'helm/DEPLOYMENT_GUIDE',
    'helm/openagentic/DEPLOYMENT_AKS_FRESH',
    'helm/openagentic/GATEWAY-API-MIGRATION',
    'helm/openagentic/dashboards/',
    'helm/openagentic/milvus-standalone',
    'helm/openagentic/postgresql-values',
    'helm/openagentic/redis-values',
    'helm/openagentic/values-local-airgapped',
    'helm/openagentic/values-local-k8s',
    'helm/openagentic/values-local-registry',
    'helm/openagentic/test.sh',
    'helm/openagentic/templates/uat-dashboard/',
    # Internal CI sonar configs
    '.github/workflows/sonar-summary', '.github/workflows/sonar.yml',
    '.github/workflows/e2e-int-test.yml', '.github/workflows/flows-harness.yml',
    # GitHub Models AI-prompt repo (internal CI tooling)
    '.prompts/',
    # Tests: dumps / stress / UAT scripts / load-test docs
    'tests/FLOWISE_TEST_VERIFICATION', 'tests/MCP_INTERACTIVE_TEST_REPORT',
    'tests/uat-data-layer', 'tests/uat-v0.4.0',
    'tests/chat-api-stress', 'tests/chat-stress', 'tests/chat_api_stress',
    'tests/e2e-playwright/test-results',
    'tests/e2e/.evidence/', 'tests/e2e/test-reports/',
    'tests/e2e/chat-sse-stress',
    'tests/e2e/customer-documentation', 'tests/e2e/release-readiness',
    'tests/e2e/persona-concurrent', 'tests/e2e/sse-debug',
    'tests/e2e/full-ux-check', 'tests/e2e/concurrent-mcp-load-test',
    'tests/e2e/azure-costs-test', 'tests/e2e/performance-metrics.spec',
    'tests/e2e/ttft-benchmark',
    'tests/load/IMPLEMENTATION-SUMMARY', 'tests/load/TEST_SUMMARY',
    'tests/load/DELIVERABLES', 'tests/load/INDEX', 'tests/load/QUICK-REFERENCE',
    'tests/load/QUICKSTART-METRICS', 'tests/load/QUICKSTART.md',
    'tests/load/TEST-STRUCTURE',
    'tests/load/scenarios/stress-1000', 'tests/load/scenarios/stress.js',
    'tests/ui-dashboard/',
    # Scripts: internal harness / handoff / runner
    'scripts/harness/', 'scripts/handoff-package-bundle',
    'scripts/generate-uc-harness-token', 'scripts/rotate-csi-s3-secret',
    'scripts/run-interleave-harness', 'scripts/pre-commit.sh',
    # Pre-chainguard Dockerfiles (stale)
    'services/mcps/oap-admin-mcp/Dockerfile.pre-chainguard',
    'services/mcps/oap-aws-mcp/Dockerfile.pre-chainguard',
    'services/mcps/oap-azure-mcp/Dockerfile.pre-chainguard',
    'services/openagentic-proxy/Dockerfile.pre-chainguard',
    'services/openagentic-ui/Dockerfile.pre-chainguard',
    'services/openagentic-workflows/Dockerfile.pre-chainguard',
    'services/synth-executor/Dockerfile.slim.pre-chainguard',
    # Enterprise-only API route files (open-core split 2026-05-29)
    # These routes were removed from OSS; sync must never re-pull them.
    'services/openagentic-api/src/routes/admin-chargeback.ts',
    'services/openagentic-api/src/routes/admin-tiered-fc.ts',
    'services/openagentic-api/src/routes/admin-rate-limits.ts',
    'services/openagentic-api/src/routes/admin-webhook-security.ts',
    'services/openagentic-api/src/routes/admin-user-activity.ts',
    'services/openagentic-api/src/routes/admin-prompt-analytics.ts',
    'services/openagentic-api/src/routes/admin-rbac-system-prompts.ts',
    'services/openagentic-api/src/routes/admin-feedback.ts',
    'services/openagentic-api/src/routes/admin-mcp-tool-access.ts',
    'services/openagentic-api/src/routes/admin-audit-chat.ts',
    'services/openagentic-api/src/routes/admin-llm-metrics.ts',
    'services/openagentic-api/src/routes/admin/agent-metrics.ts',
    'services/openagentic-api/src/routes/admin-test-harness.ts',
    'services/openagentic-api/src/routes/admin-test-harness-run-e2e.ts',
    'services/openagentic-api/src/routes/admin-test-harness-helpers.ts',
    'services/openagentic-api/src/routes/admin-audit.ts',
    'services/openagentic-api/src/routes/admin-audit-logs.ts',
    'services/openagentic-api/src/routes/admin-credential-audit.ts',
    'services/openagentic-api/src/routes/admin-dashboard-metrics.ts',
    'services/openagentic-api/src/routes/admin/slo.ts',
    'services/openagentic-api/src/routes/admin-metrics.ts',
    'services/openagentic-api/src/routes/admin/feedback-advisories.ts',
    'services/openagentic-api/src/routes/admin-mcp-access.ts',
    'services/openagentic-api/src/routes/admin-mcp-management.ts',  # dead code — manifest handler ported to routes/admin/mcp-management.ts
    'services/openagentic-api/src/routes/admin-agent-schedules.ts',
    'services/openagentic-api/src/routes/admin-flow-audit.ts',
    'services/openagentic-api/src/routes/admin-usage-analytics.ts',
    'services/openagentic-api/src/routes/admin-slider.ts',
    'services/openagentic-api/src/routes/admin-user-permissions.ts',
    # Old ollama dir / empty sdk dir / fizzbuzz
    'services/ollama/', 'services/sdk/', 'services/fizzbuzz.py',
    # Old-brand duplicate inside openagentic-server extensions
    'services/openagentic-server/extensions/openagentic-ai/agenticwork-ai/',
    # API one-off scripts + build markers
    'services/openagentic-api/.force-rebuild',
    'services/openagentic-api/trigger-build.txt',
    'services/openagentic-api/test-memory-system.js',
    # MCP proxy brain-dump
    'services/openagentic-mcp-proxy/ux.md',
    # Workflows internal QA
    'services/openagentic-workflows/qa-',
    # Internal scratch env
    '.env.debug.example', '.env.debug.example',
    # Enterprise flows templates (OSS keeps only research-and-publish.json).
    # Removed 2026-05-29 as part of OSS flows cleanup; sync must never re-pull.
    'services/openagentic-workflows/seed/templates/k8s-pod-health-summary.json',
    'services/openagentic-workflows/seed/templates/k8s-pod-health-typed.json',
    'services/openagentic-workflows/seed/templates/k8s-crashloop-triage.json',
    'services/openagentic-workflows/seed/templates/k8s-deployment-rollout-status-report.json',
    'services/openagentic-workflows/seed/templates/k8s-namespace-resource-survey.json',
    'services/openagentic-workflows/seed/templates/prometheus-active-alerts-digest.json',
    'services/openagentic-workflows/seed/templates/prometheus-target-down-rca.json',
    'services/openagentic-workflows/seed/templates/platform-infra-health-digest.json',
    'services/openagentic-workflows/seed/templates/cluster-health-capstone.json',
    'services/openagentic-workflows/seed/templates/cluster-triage-watchdog.json',
    'services/openagentic-workflows/seed/templates/loki-error-log-research-report.json',
    'services/openagentic-workflows/seed/templates/azure-security-posture-snapshot.json',
    'services/openagentic-workflows/seed/templates/azure-advisor-savings-report.json',
    # rag-knowledge-qa: deliberate exclusion (2026-06-02). Brand-safe + no hardcoded
    # models, BUT it relies on advanced RAG node executors (rerank / grounding_check /
    # multi_query / guardrails / embedding) that the OSS workflow engine does not
    # implement, and ships as category:"enterprise". Shipping it would seed a template
    # that fails at runtime. OSS already has 4 working templates incl. grounded
    # research-and-publish. Revisit if/when those node executors land in OSS.
    'services/openagentic-workflows/seed/templates/rag-knowledge-qa.json',
    # Enterprise __seed__ template modules (OMHS / incident-response pack).
    # Removed 2026-05-29; sync must never re-pull these.
    'services/openagentic-api/src/services/__seed__/templates/01-pagerduty-triage.ts',
    'services/openagentic-api/src/services/__seed__/templates/02-alertmanager-pd.ts',
    'services/openagentic-api/src/services/__seed__/templates/03-splunk-detection-triage.ts',
    'services/openagentic-api/src/services/__seed__/templates/04-k8s-cluster-health.ts',
    'services/openagentic-api/src/services/__seed__/templates/05-loki-prom-incident.ts',
    'services/openagentic-api/src/services/__seed__/templates/06-pagerduty-auto-triage.ts',
    'services/openagentic-api/src/services/__seed__/templates/07-deep-research-team.ts',
    # Enterprise aiops template test harness (only tested the removed templates).
    'services/openagentic-workflows/test/harness/templates/',
    # ─── AAD/Entra + Google SSO login + OBO token exchange — removed from OSS ──
    # Local username/password auth only (2026-06-09). These whole files were
    # deleted; sync must NEVER re-create them. KEEP (not skipped): routes/auth.ts
    # (now the inter-service / local-auth path, in PRESERVE) and routes/local-auth.ts
    # (the username/password login). The SP/static/ADC cloud-MCP creds and the
    # Azure-OpenAI / Vertex LLM provider backends are unaffected.
    #   API — Azure-AD / Google-OIDC user login + group validation + OBO exchange:
    'services/openagentic-api/src/auth/azureADAuth.ts',
    'services/openagentic-api/src/auth/googleAuth.ts',
    'services/openagentic-api/src/auth/__tests__/googleAuth.adminEmails.test.ts',
    'services/openagentic-api/src/middleware/azureAdAuth.ts',
    'services/openagentic-api/src/utils/validateAzureToken.ts',
    'services/openagentic-api/src/routes/azure-ad-sync.ts',
    'services/openagentic-api/src/routes/obo.ts',
    'services/openagentic-api/src/routes/google-auth/',
    'services/openagentic-api/src/routes/account-linking.ts',
    'services/openagentic-api/src/routes/azure-integration/auth.ts',
    'services/openagentic-api/src/routes/v1/credentials.ts',
    'services/openagentic-api/src/plugins/integrations.plugin.ts',
    'services/openagentic-api/src/plugins/__tests__/integrations.plugin.test.ts',
    'services/openagentic-api/src/services/AzureOBOService.ts',
    'services/openagentic-api/src/services/AzureTokenService.ts',
    'services/openagentic-api/src/services/AzureGroupService.ts',
    'services/openagentic-api/src/services/UserAzureMCPService.ts',
    'services/openagentic-api/src/services/AdminValidationService.ts',
    'services/openagentic-api/src/services/__tests__/AzureTokenService.mfaFreshness.test.ts',
    'services/openagentic-api/src/services/__tests__/AzureTokenService.mfaFreshnessEnforcement.test.ts',
    'services/openagentic-api/src/services/__tests__/AzureTokenService.selfAudience.test.ts',
    'services/openagentic-api/src/services/__tests__/buildChatV2Deps.obo-db-token.test.ts',
    'services/openagentic-api/src/services/__tests__/buildChatV2Deps.obo-headers.test.ts',
    'services/openagentic-api/src/auth/__tests__/azureADAuth-mfa-claim-privileged.test.ts',
    'services/openagentic-api/src/auth/__tests__/azureADAuth-mfa-freshness.test.ts',
    'services/openagentic-api/src/auth/__tests__/azureADAuth-no-pii-log-leak.source-regression.test.ts',
    'services/openagentic-api/src/auth/__tests__/azureADAuth-no-pii-log-leak-whole-file.source-regression.test.ts',
    'services/openagentic-api/src/tests/AzureGroupService.simple.test.ts',
    'services/openagentic-api/src/tests/AzureGroupService.test.ts',
    'services/openagentic-api/src/__tests__/integration/oboAuthHeaders.end-to-end.test.ts',
    'services/openagentic-api/src/__tests__/architecture/server-routes-not-leaked.integrations.source-regression.test.ts',
    'services/openagentic-api/src/__tests__/architecture/account-linking-auth.source-regression.test.ts',
    #   mcp-proxy — Azure OBO user-token→cloud-token exchange + per-user sessions:
    'services/openagentic-mcp-proxy/src/azure_oauth.py',
    'services/openagentic-mcp-proxy/src/user_session_manager.py',
    'services/openagentic-mcp-proxy/src/azure_obo_strategy.py',
    'services/openagentic-mcp-proxy/tests/test_azure_obo_strategy.py',
    #   UI — Azure-AD login button + OAuth redirect callback + token client:
    'services/openagentic-ui/src/features/auth/components/AADLogin.tsx',
    'services/openagentic-ui/src/features/auth/components/AuthCallback.tsx',
    'services/openagentic-ui/src/services/AzureTokenService.ts',
)

# Exact filename bans (anywhere in tree)
SKIP_NAMES = {
    'LICENSE', 'NOTICE', 'RELEASING.md', 'SOURCE_ACCESS_AGREEMENT.md',
    '.env', '.env.local', '.env-gemini', '.env.mac', '.env.tst', '.env.template',
    '.env.helm', '.DS_Store', 'CODEOWNERS', 'dependabot.yml',
    '.gitbook.yaml', '.gitlab-ci.yml', 'pull_request_template.md',
    # Internal artifacts seen in upstream
    'admin-dom.yml', 'network_log.json', 'TASK_PROGRESS.md',
    'SECURITY_VULNERABILITIES_REPORT.md',
    'ai_provider_data_privacy_report.html',
    'Caddyfile.exec', 'Caddyfile.local',
    'sonar-project.properties',
    'test_models.sh', 'test-sse-events.sh', 'test-interleave.html',
    'API', 'app.py', 'tutorial_issues.md', 'FILE_THUMBNAILS_README.md',
    # Root-level session-note artifacts that the upstream leaves around
    'ccr-console-full.log', 'codemode-network.txt', 'codemode-snapshot.md',
    'login-snap.yml', 'knip.config.js', 'playwright.config.ts',
    'add-bedrock-form.md', 'add-model-bedrock.md', 'add-model-dialog.md',
    'add-model-vertex.md', 'add-prov-dialog.md',
    'admin-llm-0618.md', 'admin-llm-providers-overview.md', 'admin-open-0618.md',
    'after-add-imagen.md', 'after-add-to-platform.md', 'after-add2.md',
    'config-imagen.md', 'creds-pasted.md', 'dialog-current.md',
    'models-state2.md', 'models-view.md',
    'pm-0618.md', 'post-login-0618.md',
    'provider-mgmt.md', 'providers-after-add.md', 'registry-refreshed.md',
    'test-gemini.md', 'vertex-expanded.md', 'vertex-image-models.md',
    # Internal deploy scripts
    'aks-test.sh', 'backup.sh', 'deploy-aks.sh', 'deploy-helm-aks.sh',
    'fix-k3s-secret-cache.sh', 'k8s-bedrock-test-job.yaml', 'omhs-sync.sh',
    'pre-upgrade-backup.sh', 'test-cdc-bedrock-proxy.py', 'test-cdc-bedrock-proxy.sh',
    'test-codemode.sh', 'feedback-load-test.mjs', 'k6-load-test.js',
    'k6-ollama-stress.js', 'version.sh', 'BUILD.md', 'BUILD_SYSTEM.md',
    'build-local-k8s.sh', 'create-uat-workflows.sh', 'migrate-toolargs.sh',
    'model-routing-audit.sh', 'post-upgrade-verify.sh', 'validate-flows.sh',
    # Generic planning / progress / summary doc names (any path)
    'TODOS.md', 'TODO.md', 'PHASE3_CODE_CHANGES.md',
    'PHASE3_DATA_FLOW.md', 'PHASE3_FORMATTING_IMPLEMENTATION.md',
    'SWAGGER_CHANGELOG.md', 'SWAGGER_CHECKLIST.md',
    'SWAGGER_SETUP.md', 'SWAGGER_IMPLEMENTATION_SUMMARY.md',
    'IMPLEMENTATION_SUMMARY.md', 'IMPLEMENTATION-SUMMARY.md',
    'TEST_SUMMARY.md', 'DELIVERABLES.md',
    'UNUSED_CODE_AUDIT.md', 'QA-REPORT.md',
    'COMPREHENSIVE_CODEBASE_SECURITY_v0.4.0.md',
    'FEDERATION_RESEARCH.md', 'OBO_SETUP.md',
    'DEV-README.md', 'KEY_CODE_SNIPPETS.md', 'VISUAL_GUIDE.md',
    'REQUIREMENTS.md', 'FLOWISE_TEST_VERIFICATION.md',
    'MCP_INTERACTIVE_TEST_REPORT.md',
    'AZURE_AI_FOUNDRY_METRICS.md', 'DEEPSEEK_INTEGRATION.md',
    'MCP_CALL_LOGGING.md', 'LLM_PROVIDER_CONFIGURATION.md',
    'API_SCHEMA_EXAMPLES.md', 'agent-registry-coverage.md',
    'AKS_DEPLOYMENT.md', 'AZURE_KEYVAULT_SETUP.md',
    'DEPLOYMENT_GUIDE.md', 'DEPLOYMENT_AKS_FRESH.md',
    'GATEWAY-API-MIGRATION.md', 'MIGRATION.md',
    'QUICK-REFERENCE.md', 'QUICKSTART.md', 'QUICKSTART-METRICS.md',
    'TEST-STRUCTURE.md', 'INDEX.md',
    # Generic one-off filenames
    '.force-rebuild', 'trigger-build.txt', 'test-memory-system.js',
    'cleanup-synthesis-messages.sql', 'router-tuning-harness.ts',
    'wire-timeline.ts', 'ux.md',
    'cloud-test-100.sh', 'execute-audit-test.sh', 'local-cloud-test.sh',
    'test-prompt-formatting.sh', 'test-prompt-simple.sh',
    'test-streaming.sh', 'cloud-test.sh',
    'q-loop-sweep.sh', 't1-real.ts',
    'handoff-package-bundle.py', 'generate-uc-harness-token.sh',
    'rotate-csi-s3-secret.sh', 'run-interleave-harness.sh',
    'chat-api-stress-test.sh', 'chat-stress-test.sh',
    'chat_api_stress_test.py',
    'playwright.config.deployed.ts',
    'COMPREHENSIVE_CODEBASE_SECURITY_v0.4.0.md',
    # Code Mode bundle — removed from OSS entirely (no lock screen); scrub on every sync.
    'CodeModeProvisioningService.ts', 'CodeModeSyncService.ts', 'CodeModeMilvusService.ts',
    'AgenticCodeService.ts', 'AWCodeStorageService.ts',
    'code-mode-provisioning.ts', 'code-plugins.ts', 'admin-code.ts',
    'code.ts', 'awcode.ts', 'admin-awcode.ts.disabled',
    'codemode.plugin.ts',
    'CodeModeMetricsDashboard.tsx', 'useCodeModeStore.ts',
    'CodeModePage.tsx', 'AdminCodeModePage.tsx',
    'CodeSessionsPanel.tsx', 'code-mode.gen.ts',
    'agenticwork-code-mode.json', 'openagentic-code-mode.json',
    'CodingCli.tsx',
    'ChatSidebar.codeMode.test.tsx',
}

# Extension-level bans (screenshots, archives, ad-hoc mockups)
SKIP_EXTS = {'.png','.jpg','.jpeg','.webp','.gif','.pdf','.tgz','.tar','.zip','.bak','.mp4','.mov','.avi','.mkv'}
SKIP_SUFFIX = ('-mockup.html', '-mockup.js', '.bak', '.bak.1', '.bak.2')

SKIP_CONTENT_HINTS = (
    # Internal companion CLIs we never ship
    'agenticode-cli', 'managedSettings.json', 'managed-mcp.json',
    'GhostPilot', 'ghostpilot', 'GHOSTPILOT',
    # Code Mode markers — drop any file dominated by them
    'awcode', 'AWCode', 'AgenticCodeService', 'AgenticCodeSession',
    'CodeModeProvisioning', 'CodeModeSession', 'useCodeModeWebSocket',
    # Enterprise paywall / upsell / 402-gate / lock-screen markers. The OSS
    # product has NO monetization gate (clean install, everything works); the
    # upstream still carries upsell/paywall UI + 402 license-gate components.
    # Drop any file dominated by these so a sync can never re-introduce them.
    'GuestPassesUpsell', 'OverageCreditUpsell', 'DesktopUpsell',
    'PaywallModal', 'UpsellModal', 'LicenseGate', 'LockScreen',
)

# Stale filename patterns left behind by past renames — filter by path, not content.
SKIP_PATH_HINTS = (
    'doc-generators/agenticode-cli.gen.ts',
    'doc-generators/oat-executor.gen.ts',
    'doc-generators/oat-synth.gen.ts',
    'doc-generators/oat-framework.gen.ts',
    # Internal phase regression tests — these only assert "we ripped X out"
    'architecture/phase-',
    # UAT / showcase / stress / customer e2e patterns anywhere in tree
    '/uat-', '-uat-', '/showcase-', '-showcase-',
    '/stress-', '-stress-',
    # Pre-chainguard build artifacts
    '.pre-chainguard',
    # Code Mode removed from OSS entirely (no lock screen) — block anything with the marker.
    'doc-generators/code-mode.gen.ts',
    '/codemode-', '/code-mode-', '/codemode.', '/code-mode.',
    'codemode.plugin', 'codemode.test', 'codemode-test', 'code-mode-test',
    # Enterprise monetization surfaces — OSS has NO paywall / 402 / upsell /
    # license lock-screen. Block by path so a sync can never re-add the gate UI
    # or its routes/services anywhere in the tree.
    'Upsell', 'upsell', 'paywall', 'Paywall',
    'lock-screen', 'LockScreen', 'license-gate', 'LicenseGate',
)

# ─── Preserve: our local fixes (never overwrite) ─────────────────────────────
PRESERVE = {
    'services/openagentic-api/src/server.ts',  # boot made non-fatal on empty MCP index + integrity check
    'services/openagentic-api/src/utils/redis-client.ts',
    'services/openagentic-api/package.json',  # OSS-added deps (undici) + any upstream strips
    'services/openagentic-api/src/features.ts',  # OSS edition flag (no gating)
    # Belt-and-suspenders: this carries the agentic-memory-mcp phantom-removal.
    # Even with the AGENTIC_PREFIX rewrite above, preserving the file guarantees
    # the local fix survives the next sync regardless of how the upstream names it.
    'services/openagentic-api/src/services/InitializationService.ts',
    '.github/workflows/oss-integrity.yml',
    '.github/workflows/sonar.yml',
    '.github/workflows/sonar-summary.yml',
    'sonar-project.properties',
    'tools/verify-oss-integrity.sh',
    'tools/gate-enterprise-routes.py',
    'tools/fix-fastapi-annotated.py',
    'services/openagentic-api/create-api-key.js',  # DATABASE_URL env-only, no hardcoded creds
    # Admin routes that carry OSS 402 gates — always re-apply via
    # gate-enterprise-routes.py after sync if the upstream edition flipped them.
    'services/openagentic-api/src/routes/admin-chargeback.ts',
    'services/openagentic-api/src/routes/admin-audit.ts',
    'services/openagentic-api/src/routes/admin-audit-logs.ts',
    'services/openagentic-api/src/routes/admin-audit-chat.ts',
    'services/openagentic-api/src/routes/admin-credential-audit.ts',
    'services/openagentic-api/src/routes/admin-metrics.ts',
    'services/openagentic-api/src/routes/admin-llm-metrics.ts',
    'services/openagentic-api/src/routes/admin-dashboard-metrics.ts',
    'services/openagentic-api/src/routes/admin-user-permissions.ts',
    'services/openagentic-api/src/routes/admin-rate-limits.ts',
    'services/openagentic-api/src/routes/admin-webhook-security.ts',
    'services/openagentic-api/src/routes/admin-tiered-fc.ts',
    'services/openagentic-api/src/routes/admin-slider.ts',
    'services/openagentic-api/src/routes/admin/dlp.ts',
    'services/openagentic-mcp-proxy/src/main.py',  # Annotated FastAPI deps
    '.env.example',  # REPLACE_ME_AT_INSTALL_TIME placeholder for secrets
    'docker-compose.yml',  # log rotation + compose-env (duplicates earlier entry)
    'services/openagentic-api/src/routes/chat/pipeline/validation.stage.ts',
    'services/openagentic-api/src/services/llm-providers/OllamaProvider.ts',
    'services/openagentic-ui/docker-entrypoint.sh',
    'services/openagentic-api/docker-entrypoint.sh',  # we added prisma migrate deploy here
    'services/openagentic-ui/nginx.conf.template',
    'services/openagentic-ui/Dockerfile',
    'services/openagentic-ui/src/features/chat/components/SettingsMenu.tsx',
    'services/openagentic-ui/src/features/auth/components/Login.tsx',
    'services/openagentic-ui/src/features/admin/components/Shell/AdminPortal.tsx',
    'services/openagentic-ui/scripts/doc-generators/index.ts',
    'services/openagentic-ui/scripts/generate-docs.ts',
    'services/openagentic-synth/Dockerfile',
    'services/openagentic-mcp-proxy/.env.example',
    'docker-compose.yml', '.env.example', '.env', '.gitignore',
    '.licenserc.yaml', 'version.json', 'install.sh',
    'README.md', 'CLAUDE.md', 'SECURITY.md',
    # Phase 1c surgical fixes — these files have local OSS edits
    # (NormalizerState, sliderConfig, codeModeProvisioning stubs, etc.)
    # that the upstream sync would otherwise stomp on.
    'services/openagentic-api/src/services/llm-providers/ILLMProvider.ts',
    'services/openagentic-api/src/services/llm-providers/AWSBedrockProvider.ts',
    'services/openagentic-api/src/services/llm-providers/OllamaProvider.ts',
    'services/openagentic-api/src/services/LLMMetricsService.ts',
    'services/openagentic-api/src/services/ModelConfigurationService.ts',
    'services/openagentic-api/src/services/TaskAnalysisService.ts',
    'services/openagentic-api/src/services/multi-model/MultiModelOrchestrator.ts',
    'services/openagentic-api/src/services/multi-model/MultiModelOrchestrator.types.ts',
    'services/openagentic-api/src/services/TieredFunctionCallingService.ts',
    'services/openagentic-api/src/services/ContextManagementService.ts',
    'services/openagentic-api/src/routes/admin-user-activity.ts',
    'services/openagentic-api/src/routes/admin-user-permissions.ts',
    'services/openagentic-api/src/routes/admin-dashboard-metrics.ts',
    'services/openagentic-api/src/routes/admin/llm-providers.ts',
    'services/openagentic-api/src/routes/admin/v3-extras-mutations.ts',
    'services/openagentic-api/src/routes/admin-tiered-fc.ts',
    'services/openagentic-api/src/routes/chat/handlers/stream.handler.ts',
    'services/openagentic-api/src/plugins/index.ts',
    'services/openagentic-api/src/plugins/admin.plugin.ts',
    'services/openagentic-api/src/plugins/admin-audit.plugin.ts',
    'services/openagentic-api/src/middleware/requireFlowsAccess.ts',
    'services/openagentic-api/src/server.ts',
    'services/openagentic-api/src/routes/local-auth.ts',
    'services/openagentic-api/src/features.ts',
    'services/openagentic-api/prisma/schema.prisma',
    'services/openagentic-api/Dockerfile',
    'services/openagentic-ui/Dockerfile',
    'services/openagentic-workflows/Dockerfile',
    'services/openagentic-api/package.json',
    'services/openagentic-workflows/package.json',
    'services/openagentic-ui/package.json',
    'services/openagentic-ui/src/index.css',
    'services/openagentic-ui/src/features/admin/hooks/useUserManagement.ts',
    'services/openagentic-ui/src/features/admin/hooks/useDashboardMetrics.ts',
    'services/openagentic-ui/src/shared/components/OpenAgenticWordmark.tsx',
    'services/openagentic-ui/src/app/App.tsx',
    'services/openagentic-ui/src/features/chat/components/ChatSidebar.tsx',
    'services/openagentic-ui/src/__tests__/transcript-width-parity.test.ts',
    'services/openagentic-ui/src/features/chat/components/__tests__/ChatContainer.subAgents.test.tsx',
    'services/openagentic-ui/src/features/admin/shell-v2/__tests__/pageRouter.test.tsx',
    'services/openagentic-ui/src/features/admin/components/Monitoring/index.tsx',
    'services/openagentic-ui/src/features/docs/components/DocsPageRenderer.tsx',
    'services/shared/workflow-engine/package.json',
    'services/shared/llm-sdk/package.json',
    'pnpm-workspace.yaml',
    'services/openagentic-ui/src/features/admin/components/Shell/AdminPortal.tsx',
    'services/openagentic-ui/src/features/admin/components/Shell/AdminPortalHostV3.tsx',
    'services/openagentic-ui/src/features/admin/shell-v2/pageRouter.tsx',
    'services/openagentic-ui/src/features/chat/components/ChatContainer.tsx',
    'services/openagentic-workflows/prisma/schema.prisma',
    'services/openagentic-workflows/src/services/WorkflowExecutionEngine.ts',
    'services/openagentic-workflows/src/services/WorkflowSecretService.ts',

    # ─── OSS-launch session work (brand/theme + chat rewire + audit-log +
    #     dead-admin-endpoints + mcp-fleet + dashboard + glass + the backend
    #     stream drop-fix). These files carry OSS-only edits made for the public
    #     release; a sync must NEVER overwrite them with the enterprise upstream.
    #     Added so this session's work survives `sync-upstream.py`.

    # SOT theme (Terminal Glass + accent system + glass-everywhere)
    'services/openagentic-ui/src/styles/theme.css',
    'services/openagentic-ui/src/features/admin/primitives-v3/styles.css',
    'services/openagentic-ui/src/features/workflows/styles/workflow-canvas.css',

    # Chat rewire — the OSS streaming hooks + container (drop-fix consumer +
    # approval-gate SSE wiring + glass presentation). useChatStream is the
    # ported engine; useSSEChat is the OSS hook with the approval-required path.
    'services/openagentic-ui/src/features/chat/hooks/useChatStream.ts',
    'services/openagentic-ui/src/features/chat/hooks/useSSEChat.ts',
    'services/openagentic-ui/src/stores/useChatStore.ts',
    'services/openagentic-ui/src/features/chat/components/MessageBubble.tsx',
    'services/openagentic-ui/src/features/chat/components/ChatInputBar.tsx',
    'services/openagentic-ui/src/features/chat/components/ChatInputToolbar.tsx',
    'services/openagentic-ui/src/features/chat/streamEngine/StreamEngine.ts',

    # Audit-log (unified all-activity admin log) — backend route + plugin mount
    # + the UI page the launch-headline trust feature lands in.
    'services/openagentic-api/src/routes/admin-audit-log.ts',
    'services/openagentic-api/src/plugins/admin-audit.plugin.ts',
    'services/openagentic-ui/src/features/admin/pages-v3/AuditLogsPage.tsx',
    # Approval-gate + audit seam (mutating-tool gate, append-only audit).
    'services/openagentic-api/src/routes/chat/approval-gate.routes.ts',
    'services/openagentic-api/src/pipeline/built-in-hooks.ts',

    # Dead-admin-endpoints build — every admin route the UI called but the API
    # never served, now implemented against real data, plus the plugin mounts.
    'services/openagentic-api/src/routes/admin-kpis.ts',
    'services/openagentic-api/src/routes/admin-metrics-extra.ts',
    'services/openagentic-api/src/routes/admin-prompt-analytics.ts',
    'services/openagentic-api/src/routes/admin-tiered-fc.ts',
    'services/openagentic-api/src/routes/admin-service-prompts.ts',
    'services/openagentic-api/src/routes/admin-context-metrics.ts',
    'services/openagentic-api/src/routes/admin-missing-routes.ts',
    'services/openagentic-api/src/routes/admin/v3-extras.ts',
    'services/openagentic-api/src/routes/admin/v3-extras-mutations.ts',
    'services/openagentic-api/src/routes/admin/ai/admin-page-corpus.ts',
    'services/openagentic-api/src/plugins/admin-extras.plugin.ts',
    'services/openagentic-api/src/plugins/admin.plugin.ts',
    'services/openagentic-api/src/plugins/user.plugin.ts',
    'services/openagentic-api/src/services/prompt/ServicePromptService.ts',

    # MCP fleet — phantom-removal + registry reconciliation + env-disabled
    # built-ins surfaced as "available", and the catalog they read from.
    'services/openagentic-api/src/services/InitializationService.ts',
    'services/openagentic-api/src/routes/admin/mcp-management.ts',
    'services/openagentic-api/src/services/mcpBuiltinCatalog.ts',
    'services/openagentic-ui/src/features/admin/pages-v3/MCPFleetV3.tsx',

    # Dashboard — recharts panes + metric chart + prom queries + the GenAI
    # tracer metric emit (the 3 newly-emitted gen_ai_* metrics).
    'services/openagentic-ui/src/features/admin/pages-v3/AnalyticsPanes.tsx',
    'services/openagentic-ui/src/features/admin/primitives-v3/MetricChart.tsx',
    'services/openagentic-ui/src/features/admin/pages-v3/llm-performance/promQueries.ts',
    'services/openagentic-api/src/services/observability/GenAITracer.ts',

    # Backend stream drop-fix trio — streamProvider dropped Ollama tool calls
    # riding the finish chunk (fixed 8b0b328f4); chatLoop + OllamaProvider are
    # the rest of the fix. OllamaProvider is already preserved above; the other
    # two are added here. UI must never be re-synced over these.
    'services/openagentic-api/src/routes/chat/pipeline/chat/streamProvider.ts',
    'services/openagentic-api/src/routes/chat/pipeline/chat/chatLoop.ts',

    # Glass-everywhere — flows/docs/about surfaces brought onto the glass +
    # accent system this session.
    'services/openagentic-ui/src/features/about/AboutModal.tsx',
    'services/openagentic-ui/src/features/docs/DocsViewer.tsx',
    'services/openagentic-ui/src/features/workflows/components/WorkflowsPage.tsx',

    # Tool-dispatch + the LLM provider interface — dispatchTool.ts routes the
    # model's tool call through the approval/audit seam (and carries the OSS
    # auto-resolve-unknown-tool fix); ILLMProvider.ts already preserved above.
    'services/openagentic-api/src/routes/chat/pipeline/chat/dispatchTool.ts',

    # Docs Code-Mode scrub — the in-app Changelog prose page (Code-Mode
    # highlights removed) + the docs sync-guard that now scans it (allowlist
    # hole closed) + the source-scanned generator manifest. A sync must never
    # re-leak Code-Mode changelog copy or re-open the allowlist.
    'services/openagentic-ui/src/features/docs/pages/ChangelogPage.tsx',
    'services/openagentic-ui/scripts/docs/__tests__/no-removed-features.test.ts',
    'services/openagentic-ui/scripts/docs/manifest.ts',

    # ─── OSS-only SECURITY / SECRET / PII fixes the full sync REGRESSES ──────
    # Found by the 2026-06-09 PRESERVE-hardening audit (62 in-both security
    # files diffed main vs a full-sync base; these 12 are where OSS main holds
    # a security property the enterprise upstream LACKS or actively regresses).
    # A sync must NEVER overwrite these or it re-introduces the listed defect.
    #
    #   googleAuth.ts / google-auth/index.ts — Google SSO login was EXCISED from
    #     OSS (local-auth only, 2026-06-09); these source files are deleted and
    #     now live in SKIP_PREFIXES so a sync never re-creates them. (They are no
    #     longer preserved.)
    #   featureFlags.ts — carries the OSS approvalGateMutating (default-ON
    #     human-approval gate); preserving it ALSO blocks the upstream Code-Mode
    #     re-leak (codeManagerUrl / codemode.plugin.ts / controlPlaneCodemode).
    #     (Upstream's stronger mfaFreshnessSecs / hitlApprovalTimeoutMs / fail-
    #     closed posInt() are ported SURGICALLY in remediation, not via clobber.)
    'services/openagentic-api/src/config/featureFlags.ts',
    #   routes/auth.ts — OSS edited this to the local-auth-only / inter-service
    #     auth path (Azure/Google SSO login excised 2026-06-09). The OSS version
    #     must win; a sync would re-introduce the federated-identity login routes.
    'services/openagentic-api/src/routes/auth.ts',
    #   DLPScannerService.ts — main has NO cloud-inventory PII exemption; upstream
    #     #1144 unconditionally skips the `pii` category for gcp_/aws_/azure_/k8s_
    #     read tools. Main's stricter PII posture is the FedRAMP-correct one.
    'services/openagentic-api/src/services/DLPScannerService.ts',
    #   utils/secrets.ts — upstream getVaultServiceInstance() calls ITSELF
    #     (infinite recursion / stack overflow); main calls getVaultService().
    'services/openagentic-api/src/utils/secrets.ts',
    #   LoginDev.tsx — main scrubbed the dev IP allowlist to loopback + Docker
    #     bridge (env-configurable); upstream ships a real personal public IP+LAN.
    'services/openagentic-ui/src/features/auth/components/LoginDev.tsx',
    #   Test files that scrubbed real PII / internal infra the upstream still ships
    #   (personal emails, real-key-shaped fallbacks, AAD tenant domains, live
    #   internal *-dev.openagentic.io hostnames) — a sync would re-leak them.
    'services/openagentic-mcp-proxy/tests/test_jwt_auth.py',
    'tests/config.js',
    'tests/e2e/auth.setup.ts',
    'tests/e2e/helpers/loginAsMcpTester.ts',
    'tests/e2e/helpers/saveAuthState.ts',

    # ─── A+++/FedRAMP remediation campaign (2026-06-09) — local-auth-only ──
    # Every file the FedRAMP remediation + AAD/OBO/Google-SSO excision edited.
    # A re-sync MUST NOT overwrite these or it re-injects the enterprise AAD/OBO
    # surface and undoes the security hardening (fail-closed secrets, jwt alg-pin,
    # mcp-proxy HMAC auth, SSRF gate, CORS, etc.). The deleted AAD/OBO/SSO files
    # are in SKIP (above) so they never re-appear. Generated docs manifests are
    # intentionally NOT here — they rebuild from source at build time.
    #
    # AU-10 admin-audit hash-chain wiring (every admin_audit_log writer routed
    # through the single chained writer services/audit/adminAuditChain.ts, which
    # lives under the PRESERVE'd audit/ prefix):
    'services/openagentic-api/src/__tests__/architecture/admin-audit-chained-writes.source-regression.test.ts',
    'services/openagentic-api/src/routes/admin/permissions.ts',
    'services/openagentic-api/src/routes/admin/v3-extras.ts',
    'services/openagentic-api/src/routes/chat/user-data-management.ts',
    'services/openagentic-api/src/services/AuditLogger.ts',
    'services/openagentic-api/src/services/DatabaseService.ts',
    'services/openagentic-api/src/utils/auditTrail.ts',
    '.githooks/pre-commit',
    'CONTRIBUTING.md',
    'docs/enterprise-setup/README.md',
    'docs/enterprise-setup/aws.md',
    'docs/enterprise-setup/azure.md',
    'docs/enterprise-setup/setup.sh',
    'helm/openagentic/templates/ui.yaml',
    'helm/openagentic/values-local-airgapped.yaml.template',
    'helm/openagentic/values-local-k8s.yaml.template',
    'helm/openagentic/values.yaml',
    'services/openagentic-api/prisma/seed-docs-assistant.sql',
    'services/openagentic-api/prisma/seed-flows-agent.sql',
    'services/openagentic-api/src/__tests__/architecture/no-hardcoded-model-literals.source-regression.test.ts',
    'services/openagentic-api/src/__tests__/architecture/registry-sot-cage-no-env-vars.source-regression.test.ts',
    'services/openagentic-api/src/auth/tokenValidator.ts',
    'services/openagentic-api/src/config/featureFlags.ts',
    'services/openagentic-api/src/config/secrets.config.ts',
    'services/openagentic-api/src/middleware/authorization.ts',
    'services/openagentic-api/src/middleware/unifiedAuth.ts',
    'services/openagentic-api/src/plugins/__tests__/v1.plugin.test.ts',
    'services/openagentic-api/src/plugins/auth.plugin.ts',
    'services/openagentic-api/src/plugins/cluster.plugin.ts',
    'services/openagentic-api/src/routes/admin-mcp-logs.ts',
    'services/openagentic-api/src/routes/admin.ts',
    'services/openagentic-api/src/routes/admin/__tests__/mcp-tools-list-auth-forward.test.ts',
    'services/openagentic-api/src/routes/admin/registry-tombstones.ts',
    'services/openagentic-api/src/routes/advanced-prompting/prompts.ts',
    'services/openagentic-api/src/routes/analytics-monitoring/prompt-metrics.ts',
    'services/openagentic-api/src/routes/auth.ts',
    'services/openagentic-api/src/routes/azure-integration/index.ts',
    'services/openagentic-api/src/routes/chat/index.ts',
    'services/openagentic-api/src/routes/chat/middleware/auth.middleware.ts',
    'services/openagentic-api/src/routes/chat/services/ChatAuthService.ts',
    'services/openagentic-api/src/routes/cluster/services.handler.ts',
    'services/openagentic-api/src/routes/memory-vector/contexts.ts',
    'services/openagentic-api/src/routes/setup.ts',
    'services/openagentic-api/src/routes/v1/index.ts',
    'services/openagentic-api/src/routes/workflows.ts',
    'services/openagentic-api/src/services/VaultInitService.ts',
    'services/openagentic-api/src/services/WorkflowExecutionEngine.ts',
    'services/openagentic-api/src/services/WorkflowScheduler.ts',
    'services/openagentic-api/src/services/buildChatV2Deps.ts',
    'services/openagentic-api/src/services/composeAppTemplates/build-progress.template.ts',
    'services/openagentic-api/src/startup/01-secrets.ts',
    'services/openagentic-api/src/startup/06-rag.ts',
    'services/openagentic-mcp-proxy/Dockerfile',
    'services/openagentic-mcp-proxy/README.md',
    'services/openagentic-mcp-proxy/requirements.txt',
    'services/openagentic-mcp-proxy/src/mcp_manager.py',
    'services/openagentic-mcp-proxy/tests/test_auth_hardening.py',
    'services/openagentic-ui/src/config/runtime.ts',
    'services/openagentic-ui/src/features/docs/pages/ApiRoutesPage.tsx',
    'services/openagentic-ui/src/types/modules.d.ts',
}

# Directory PREFIXES whose every (current + future) file must survive a sync.
# Exact membership in PRESERVE can't cover a directory of OSS-only code that may
# grow new files, so these are matched by `mapped.startswith(prefix)`.
#   approval/ — the mutating-tool approval gate + tool classifier + registry.
#   audit/    — the append-only auth/activity audit aggregation.
# Both are the launch-headline trust seam (approval + immutable audit) and have
# NO enterprise upstream equivalent; a sync must never write into them.
PRESERVE_PREFIXES = (
    'services/openagentic-api/src/services/approval/',
    'services/openagentic-api/src/services/audit/',
)

# Content-level brand rewrite
CONTENT_RENAMES = [
    ('AGENTICWORK', 'OPENAGENTIC'),
    ('AgenticWork', 'OpenAgentic'),
    ('Agenticwork', 'Openagentic'),
    ('agenticwork', 'openagentic'),
    ('AGENTICODE',  'OPENAGENTIC'),
    ('AgentiCode',  'OpenAgentic'),
    ('Agenticode',  'Openagentic'),
    ('agenticode',  'openagentic'),
    ('AgentProxy',  'OpenAgenticProxy'),
    ('agent-proxy', 'openagentic-proxy'),
    ('agent_proxy', 'openagentic_proxy'),
    ('OatExecutor', 'OpenAgenticSynth'),
    ('oat-executor','openagentic-synth'),
    ('oat_executor','openagentic_synth'),
    ('AGENT_PROXY', 'OPENAGENTIC_PROXY'),
    ('agentProxy',  'openagenticProxy'),
    ('AWP',         'OpenAgentic'),
    ('awp-',        'openagentic-'),
    ('awp_',        'openagentic_'),
]
MCP_KEBAB = re.compile(r'openagentic-([a-z0-9-]+)-mcp')
MCP_SNAKE = re.compile(r'openagentic_([a-z0-9_]+)_mcp')
MCP_CAMEL = re.compile(r'openagentic([A-Z][A-Za-z0-9]*)Mcp')

# Bare `agentic-`/`agentic_` identifier prefix (e.g. the upstream's
# `agentic-memory-mcp` MCP id / display name) → `openagentic-`/`openagentic_`.
# The other CONTENT_RENAMES only handle `agenticwork`/`agenticode`/`oat-`/`awp-`,
# so a plain `agentic-…` id slipped through and re-leaked the proprietary name.
# CAREFULLY scoped so it never touches the word "agentic" inside "openagentic"
# or in prose ("agentic work platform"):
#   (?<![A-Za-z0-9]) — only at an identifier boundary (not mid-word: reagentic-)
#   (?<!open/Open/OPEN) — never re-prefix something already openagentic-…
#   agentic([-_])   — literal prefix followed by an identifier separator only
#                     (hyphen/underscore — NOT a space, so prose is untouched)
#   (?!work(?![a-z0-9])) — CRITICAL: never rewrite the org/scope `agentic-work`
#                     (e.g. `@agentic-work/llm-sdk`, `ghcr.io/agentic-work`).
#                     `work` must be a COMPLETE token here, so `agentic-workflows`
#                     / `agentic-worker` still fold to openagentic-… correctly.
#   (?=[a-z0-9])    — separator must lead into an identifier token
AGENTIC_PREFIX = re.compile(
    r'(?<![A-Za-z0-9])(?<!open)(?<!Open)(?<!OPEN)agentic([-_])(?!work(?![a-z0-9]))(?=[a-z0-9])'
)

def map_path(path):
    for src, dst in RENAMES:
        if path == src or path.startswith(src + '/'):
            return None if dst is None else path.replace(src, dst, 1)
    return path

def should_skip(rel):
    base = os.path.basename(rel)
    if base in SKIP_NAMES: return True
    ext = os.path.splitext(base)[1].lower()
    if ext in SKIP_EXTS: return True
    for sfx in SKIP_SUFFIX:
        if rel.endswith(sfx): return True
    for p in SKIP_PREFIXES:
        if rel.startswith(p): return True
    for h in SKIP_PATH_HINTS:
        if h in rel: return True
    return False

def rewrite(text):
    for old, new in CONTENT_RENAMES: text = text.replace(old, new)
    # Fix bare `agentic-`/`agentic_` identifier prefixes BEFORE the MCP-id
    # kebab/snake passes so `agentic-memory-mcp` first becomes
    # `openagentic-memory-mcp` and then folds into `oap-memory-mcp`.
    text = AGENTIC_PREFIX.sub(lambda m: 'openagentic' + m.group(1), text)
    text = MCP_KEBAB.sub(r'oap-\1-mcp', text)
    text = MCP_SNAKE.sub(r'oap_\1_mcp', text)
    text = MCP_CAMEL.sub(r'oap\1Mcp', text)
    return text

def main():
    stats = {'written': 0, 'binary': 0, 'preserved': 0, 'filtered': 0,
             'content_skip': 0, 'new': 0}
    preserved_seen = []

    for dp, dirs, files in os.walk(UPSTREAM):
        dirs[:] = [d for d in dirs if d not in (
            '.git','node_modules','dist','build','.next','__pycache__',
            '.venv','venv','.turbo','@eaDir',
            '.worktrees','.worktree','.serena','.superpowers','.claude',
            '.playwright-mcp','playwright-report','coverage',
            '.pytest_cache','.ruff_cache','.venv-test',
        )]
        for fn in files:
            abs_up = os.path.join(dp, fn)
            rel_up = os.path.relpath(abs_up, UPSTREAM)
            mapped = map_path(rel_up)
            if mapped is None:
                continue
            if should_skip(rel_up) or should_skip(mapped):
                stats['filtered'] += 1
                continue
            if mapped in PRESERVE or any(
                mapped.startswith(p) for p in PRESERVE_PREFIXES
            ):
                preserved_seen.append(mapped)
                stats['preserved'] += 1
                continue
            abs_ours = os.path.join(REPO, mapped)
            existed = os.path.exists(abs_ours)

            if DRY_RUN:
                stats['written'] += 1
                if not existed: stats['new'] += 1
                continue

            try:
                with open(abs_up, 'rb') as f: raw = f.read()
            except Exception:
                continue
            if b'\0' in raw:
                os.makedirs(os.path.dirname(abs_ours), exist_ok=True)
                shutil.copy2(abs_up, abs_ours)
                stats['binary'] += 1
                continue
            text = raw.decode('utf-8', errors='replace')
            # Skip whole files that are dominated by agenticode/ghostpilot content
            lower = text.lower()
            if any(h.lower() in lower for h in SKIP_CONTENT_HINTS if len(h) > 4):
                # …unless the hit is just a stray mention we can tolerate. For now, skip hard.
                if 'awcode' in lower or 'agenticcodeservice' in lower or 'ghostpilot' in lower:
                    stats['content_skip'] += 1
                    continue
            text = rewrite(text)
            os.makedirs(os.path.dirname(abs_ours), exist_ok=True)
            with open(abs_ours, 'w', encoding='utf-8') as f: f.write(text)
            stats['written'] += 1
            if not existed: stats['new'] += 1

    print("=== Sync summary ===")
    for k, v in sorted(stats.items()): print(f"  {k:>14}: {v}")
    print(f"\nPreserved (your local fixes — kept untouched): {len(set(preserved_seen))} files")
    if DRY_RUN:
        print("\n(dry-run — no writes)")
        return

    # Post-pass: strip copyright/license boilerplate the upstream keeps reintroducing.
    scrubber = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scrub-headers.py')
    if os.path.exists(scrubber):
        print("\nScrubbing upstream copyright/license headers…")
        os.system(f"python3 {scrubber}")

if __name__ == '__main__':
    main()
