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
    ('services/agenticode-exec',           'services/openagentic-exec'),
    ('services/agenticode-manager',        None),                        # deleted — single-user
    ('services/agenticode-server',         'services/openagentic-server'),
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
    '.github/arc/', '.github/install-arc', '.github/arc-runner-',
    '.github/SETUP.md', '.github/setup-arc-aks',
    'gitops/', 'helm/values/',
    # Companion repos (pulled at build time, not synced)
    'agenticode-cli/', 'ghostpilot/', 'sdk/', 'oat/',
    # Test results / UAT reports live only in the internal upstream
    'tests/MCP_', 'tests/uat',
    # Build artifacts / editor state / internal workspace
    'node_modules/', 'dist/', 'build/', '.next/', '.astro/', '__pycache__/',
    '.venv/', 'venv/', '.turbo/',
    'report/', 'todos/', 'observability/', 'k8s/',
    'published-packages/', 'iam-policies/', 'demos/',
    '.superpowers/', '.serena/', '.claude/',
    '.git/', '.playwright-mcp/', 'playwright-report/',
    # Internal deploy scripts (keep scripts/ dir but not these)
    'scripts/buildx/', 'scripts/e2e-test-suite/', 'scripts/load-tests/',
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
    # Internal deploy scripts
    'aks-test.sh', 'backup.sh', 'deploy-aks.sh', 'deploy-helm-aks.sh',
    'fix-k3s-secret-cache.sh', 'k8s-bedrock-test-job.yaml', 'omhs-sync.sh',
    'pre-upgrade-backup.sh', 'test-cdc-bedrock-proxy.py', 'test-cdc-bedrock-proxy.sh',
    'test-codemode.sh', 'feedback-load-test.mjs', 'k6-load-test.js',
    'k6-ollama-stress.js', 'version.sh', 'BUILD.md', 'BUILD_SYSTEM.md',
    'build-local-k8s.sh', 'create-uat-workflows.sh', 'migrate-toolargs.sh',
    'model-routing-audit.sh', 'post-upgrade-verify.sh', 'validate-flows.sh',
}

# Extension-level bans (screenshots, archives, ad-hoc mockups)
SKIP_EXTS = {'.png','.jpg','.jpeg','.webp','.gif','.pdf','.tgz','.tar','.zip','.bak'}
SKIP_SUFFIX = ('-mockup.html', '-mockup.js', '.bak', '.bak.1', '.bak.2')

# Agenticode-specific patterns — user won't ship these
SKIP_CONTENT_HINTS = (
    'awcode', 'AWCode', 'AgenticCodeService', 'AgenticCodeSession',
    'agenticode-cli', 'managedSettings.json', 'managed-mcp.json',
    # Upstream ghostpilot bits — we removed all of these
    'GhostPilot', 'ghostpilot', 'GHOSTPILOT',
)

# Stale filename patterns left behind by past renames — filter by path, not content.
SKIP_PATH_HINTS = (
    'doc-generators/agenticode-cli.gen.ts',
    'doc-generators/oat-executor.gen.ts',
    'doc-generators/oat-synth.gen.ts',
    'doc-generators/oat-framework.gen.ts',
)

# ─── Preserve: our local fixes (never overwrite) ─────────────────────────────
PRESERVE = {
    'services/openagentic-api/src/server.ts',  # boot made non-fatal on empty MCP index
    'services/openagentic-api/src/utils/redis-client.ts',
    'services/openagentic-api/src/routes/chat/pipeline/validation.stage.ts',
    'services/openagentic-api/src/services/llm-providers/OllamaProvider.ts',
    'services/openagentic-api/src/routes/admin/codemode.ts',
    'services/openagentic-exec/src/index.ts',
    'services/openagentic-exec/src/userSandbox.ts',
    'services/openagentic-exec/src/ptyManager.ts',
    'services/openagentic-exec/Dockerfile',
    'services/openagentic-ui/docker-entrypoint.sh',
    'services/openagentic-api/docker-entrypoint.sh',  # we added prisma migrate deploy here
    'services/openagentic-ui/nginx.conf.template',
    'services/openagentic-ui/Dockerfile',
    'services/openagentic-ui/src/features/chat/components/SettingsMenu.tsx',
    'services/openagentic-ui/src/features/auth/components/Login.tsx',
    'services/openagentic-ui/src/features/code/components/EditorPanel.tsx',
    'services/openagentic-ui/src/features/admin/components/CodeMode/CodeModeSettingsView.tsx',
    'services/openagentic-ui/src/features/admin/components/Shell/AdminPortal.tsx',
    'services/openagentic-ui/src/features/code/components/chat-messages/toolRenderers.ts',
    'services/openagentic-ui/src/features/code/hooks/useCodeModeWebSocket.ts',
    'services/openagentic-ui/scripts/doc-generators/index.ts',
    'services/openagentic-ui/scripts/generate-docs.ts',
    'services/openagentic-synth/Dockerfile',
    'services/openagentic-mcp-proxy/.env.example',
    'docker-compose.yml', '.env.example', '.env', '.gitignore',
    '.licenserc.yaml', 'version.json', 'install.sh',
    'README.md', 'CLAUDE.md', 'SECURITY.md',
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
            '.venv','venv','.turbo','@eaDir'
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
