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
    ('services/agenticode-exec',           None),  # Code Mode is enterprise-only — OSS shows lock screen
    ('services/agenticode-manager',        None),  # Code Mode is enterprise-only — OSS shows lock screen
    ('services/agenticode-server',         None),  # Code Mode is enterprise-only — OSS shows lock screen
    ('services/agent-proxy',               'services/openagentic-proxy'),
    ('services/oat-executor',              'services/openagentic-synth'),
    ('services/mcps/awp-admin-mcp',        'services/mcps/oap-admin-mcp'),
    ('services/mcps/awp-aws-mcp',          'services/mcps/oap-aws-mcp'),
    ('services/mcps/awp-azure-mcp',        'services/mcps/oap-azure-mcp'),
    ('services/mcps/awp-azure-cost-mcp',   'services/mcps/oap-azure-cost-mcp'),
    ('services/mcps/awp-gcp-mcp',          'services/mcps/oap-gcp-mcp'),
    ('services/mcps/awp-github-mcp',       'services/mcps/oap-github-mcp'),
    ('services/mcps/awp-knowledge-mcp',    'services/mcps/oap-knowledge-mcp'),
    ('services/mcps/awp-kubernetes-mcp',   'services/mcps/oap-kubernetes-mcp'),
    ('services/mcps/awp-loki-mcp',         'services/mcps/oap-loki-mcp'),
    ('services/mcps/awp-prometheus-mcp',   'services/mcps/oap-prometheus-mcp'),
    ('services/mcps/awp-alertmanager-mcp', 'services/mcps/oap-alertmanager-mcp'),
    ('services/mcps/awp-incident-mcp',     'services/mcps/oap-incident-mcp'),
    ('services/mcps/awp-runbook-mcp',      'services/mcps/oap-runbook-mcp'),
    ('services/mcps/awp-web-mcp',          'services/mcps/oap-web-mcp'),
    ('services/mcps/awp-agent-architect-mcp', 'services/mcps/oap-agent-architect-mcp'),
    ('services/mcps/awp-agenticode-mcp',   'services/mcps/oap-code-mcp'),
    ('helm/agenticwork',                   'helm/openagentic'),
]

# ─── Filter: directories whose contents never cross the OSS boundary ─────────
SKIP_PREFIXES = (
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
    # Code Mode — enterprise-only; OSS shows lock screen with upsell URL.
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
    # Pytest cache / coverage / editor state — generated, never OSS
    '.pytest_cache/', 'coverage/',
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
    # Code Mode bundle — enterprise-only; OSS shows lock screen.
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
    # Code Mode is enterprise-only — block anything with the marker.
    # OSS shows lock screen via the UI entry point only.
    'doc-generators/code-mode.gen.ts',
    '/codemode-', '/code-mode-', '/codemode.', '/code-mode.',
    'codemode.plugin', 'codemode.test', 'codemode-test', 'code-mode-test',
)

# ─── Preserve: our local fixes (never overwrite) ─────────────────────────────
PRESERVE = {
    'services/openagentic-api/src/server.ts',  # boot made non-fatal on empty MCP index + integrity check
    'services/openagentic-api/src/utils/redis-client.ts',
    'services/openagentic-api/package.json',  # OSS-added deps (undici) + any upstream strips
    'services/openagentic-api/src/features.ts',  # OSS edition flag — integrity-guarded
    'services/openagentic-api/src/utils/oss-integrity.ts',
    'services/openagentic-api/src/middleware/enterpriseOnly.ts',
    'services/openagentic-ui/src/features/admin/Upsell.tsx',
    'tools/setup/src/ui/Upsell.tsx',
    '.github/required-upsell-strings.tsv',
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
    'services/openagentic-ui/src/features/admin/Upsell.tsx',
    'services/openagentic-ui/src/features/admin/components/Shell/AdminPortal.tsx',
    'services/openagentic-ui/src/features/admin/components/Shell/AdminPortalHostV3.tsx',
    'services/openagentic-ui/src/features/admin/shell-v2/pageRouter.tsx',
    'services/openagentic-ui/src/features/chat/components/ChatContainer.tsx',
    'services/openagentic-workflows/prisma/schema.prisma',
    'services/openagentic-workflows/src/services/WorkflowExecutionEngine.ts',
    'services/openagentic-workflows/src/services/WorkflowSecretService.ts',
}

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
            if mapped in PRESERVE:
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
