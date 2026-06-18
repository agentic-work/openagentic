import React, { useState } from 'react';
import {
  SavingsCard,
  KpiGrid,
  SeverityTag,
  CostPill,
  StreamingTable,
  ToolParallelHeader,
  SubAgentCard,
  HandoffPill,
  MessageHeader,
  WidgetRenderer,
  AppRenderer,
  ToolCard,
  CitationChip,
  AvatarCrumb,
  StatusRow,
  // Phase 14-24 specialty primitives
  Findings,
  CorrectionCard,
  AgentTree,
  PassChip,
  ArtifactPane,
  Runbook,
  WaveTimeline,
  StackGrid,
  AnnotatedCode,
} from '@/features/chat/components/v2';

/**
 * PrimitivesShowcase — dev-only landing page that renders every
 * mock-parity primitive (#502) with realistic sample data sourced from
 * `mocks/UX/01-cloud-ops.html`. Visual proof of component fidelity
 * before integration into the live ChatMessages render path.
 *
 * Lazy-loaded under `/dev/v2-primitives` (same pattern as
 * `/dev/codemode-slash-mocks` — gated by `!import.meta.env.PROD`).
 *
 * Theme toggle stored in local component state — the v2 components all
 * fall back to the same hardcoded color tokens (`#09090b` bg, `#f8fafc`
 * fg, `#8b5cf6` accent) when the surrounding `--bg-0` / `--fg-0` CSS
 * vars aren't set, so the toggle here just swaps the page chrome to
 * verify legibility against light backgrounds. The components
 * themselves remain dark-themed.
 */

// The showcase renders StreamingTable with a legacy flat prop shape
// (caption / label+align columns / JSX cells) that predates the current
// scalar `table`-prop API. This gallery is dev-only and intentionally
// preserves the original sample markup, so render through a loosely-typed
// alias rather than rewriting the mock data into the new shape.
const StreamingTableShowcase = StreamingTable as unknown as React.ComponentType<Record<string, unknown>>;

const SECTION_GAP = 32;

const PAGE_BG_DARK = '#09090b';
const PAGE_FG_DARK = '#f8fafc';
const PAGE_BG_LIGHT = '#fafafa';
const PAGE_FG_LIGHT = '#09090b';
const ACCENT = 'var(--user-accent-primary)';
const LINE = 'rgba(255,255,255,0.10)';

interface SectionProps {
  name: string;
  reference: string;
  children: React.ReactNode;
}

function Section({ name, reference, children }: SectionProps): JSX.Element {
  return (
    <section style={{ marginTop: SECTION_GAP }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 600,
          margin: 0,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {name}
      </h2>
      <small
        style={{
          display: 'block',
          fontSize: 11,
          color: '#71717a',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          marginTop: 2,
          marginBottom: 12,
        }}
      >
        {reference}
      </small>
      <div>{children}</div>
    </section>
  );
}

export default function PrimitivesShowcase(): JSX.Element {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const isDark = theme === 'dark';
  const pageBg = isDark ? PAGE_BG_DARK : PAGE_BG_LIGHT;
  const pageFg = isDark ? PAGE_FG_DARK : PAGE_FG_LIGHT;

  return (
    <div
      data-theme={theme}
      data-testid="v2-primitives-page"
      style={{
        minHeight: '100vh',
        background: pageBg,
        color: pageFg,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Sticky toolbar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: pageBg,
          borderBottom: `1px solid ${LINE}`,
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 12, color: '#71717a' }}>Theme:</span>
        <button
          type="button"
          onClick={() => setTheme('dark')}
          aria-pressed={isDark}
          data-testid="theme-toggle-dark"
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            background: isDark ? ACCENT : 'transparent',
            color: isDark ? '#fff' : pageFg,
            border: `1px solid ${isDark ? ACCENT : LINE}`,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Dark
        </button>
        <button
          type="button"
          onClick={() => setTheme('light')}
          aria-pressed={!isDark}
          data-testid="theme-toggle-light"
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            background: !isDark ? ACCENT : 'transparent',
            color: !isDark ? '#fff' : pageFg,
            border: `1px solid ${!isDark ? ACCENT : LINE}`,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Light
        </button>
      </div>

      {/* Page body — single column, max-width 800px */}
      <div
        style={{
          maxWidth: 800,
          margin: '0 auto',
          padding: '24px',
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 0 }}>
          v2 primitives showcase — mock parity reference
        </h1>
        <p style={{ fontSize: 13, color: '#71717a', marginTop: 4 }}>
          Visual smoke test for every primitive shipped under{' '}
          <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            @/features/chat/components/v2
          </code>
          . Sample data sourced from <code>mocks/UX/01-cloud-ops.html</code>.
        </p>

        <Section name="SavingsCard" reference="mocks/UX/01-cloud-ops.html:1142-1155">
          <SavingsCard
            cells={[
              { label: 'Monthly savings', value: '$2,847', suffix: '.12', tone: 'g' },
              { label: 'Annual savings', value: '$34,165', suffix: '.44', tone: 'g' },
              { label: '% reduction', value: '46.0', suffix: '%' },
            ]}
          />
        </Section>

        <Section name="KpiGrid" reference="mocks/UX/02-kubernetes-health-report.html">
          <KpiGrid
            tiles={[
              { title: 'Cluster CPU', value: '73%', severity: 'warn' },
              { title: 'Memory', value: '61%', severity: 'ok' },
              { title: 'Pods Running', value: '142', severity: 'ok' },
              { title: 'Restarts', value: '3', severity: 'err' },
            ]}
          />
        </Section>

        <Section name="SeverityTag" reference="mocks/UX/01-cloud-ops.html:1015-1071">
          <p style={{ fontSize: 13, lineHeight: 2 }}>
            Status pills inline:&nbsp;
            <SeverityTag severity="ok">OK</SeverityTag>&nbsp;
            <SeverityTag severity="warn">WARN</SeverityTag>&nbsp;
            <SeverityTag severity="err">ERROR</SeverityTag>&nbsp;
            <SeverityTag severity="info">INFO</SeverityTag>
          </p>
        </Section>

        <Section name="CostPill" reference="mocks/UX/01-cloud-ops.html:811">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <CostPill costUsd={0.058} />
            <CostPill costUsd={0.158} done />
          </div>
        </Section>

        <Section name="StreamingTable" reference="mocks/UX/01-cloud-ops.html:991-1080">
          <StreamingTableShowcase
            caption="VM right-sizing recommendations"
            columns={[
              { key: 'vm', label: 'VM' },
              { key: 'current', label: 'Current' },
              { key: 'recommended', label: 'Recommended' },
              { key: 'savings', label: 'Savings', align: 'right' },
            ]}
            rows={[
              {
                id: 'vm-api-blue-01',
                cells: {
                  vm: 'vm-api-blue-01',
                  current: <SeverityTag severity="warn">D4s_v5</SeverityTag>,
                  recommended: <SeverityTag severity="ok">D2s_v5</SeverityTag>,
                  savings: '$82/mo',
                },
              },
              {
                id: 'vm-redis-cache-01',
                cells: {
                  vm: 'vm-redis-cache-01',
                  current: <SeverityTag severity="warn">D4s_v5</SeverityTag>,
                  recommended: <SeverityTag severity="ok">D2s_v5</SeverityTag>,
                  savings: '$82/mo',
                },
              },
              {
                id: 'vm-grafana-01',
                cells: {
                  vm: 'vm-grafana-01',
                  current: <SeverityTag severity="ok">D2s_v5</SeverityTag>,
                  recommended: <SeverityTag severity="info">keep</SeverityTag>,
                  savings: '$0',
                },
              },
              {
                id: 'vm-jumpbox-prod',
                cells: {
                  vm: 'vm-jumpbox-prod',
                  current: <SeverityTag severity="warn">E2s_v5</SeverityTag>,
                  recommended: <SeverityTag severity="ok">B2s</SeverityTag>,
                  savings: '$95/mo',
                },
              },
              {
                id: 'vm-dev-sandbox-01',
                cells: {
                  vm: 'vm-dev-sandbox-01',
                  current: <SeverityTag severity="err">D8s_v5</SeverityTag>,
                  recommended: <SeverityTag severity="err">retire</SeverityTag>,
                  savings: '$164/mo',
                },
              },
            ]}
          />
        </Section>

        <Section
          name="ToolParallelHeader"
          reference="mocks/UX/01-cloud-ops.html:900-905 — collapsed + expanded"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ToolParallelHeader
              label="ran 4 tools in parallel"
              total={4}
              succeeded={4}
              failed={0}
              wallMs={823}
              expanded={false}
            />
            <ToolParallelHeader
              label="ran 4 tools in parallel"
              total={4}
              succeeded={4}
              failed={0}
              wallMs={823}
              expanded
            />
          </div>
        </Section>

        <Section name="SubAgentCard" reference="mocks/UX/01-cloud-ops.html:1083-1133">
          <SubAgentCard
            name="cost-analysis"
            role="sub-agent · spawned by cloud-ops"
            variant="c"
            stats={{ turns: 5, tokens: 1247, wallMs: 3800, costUsd: 0.014 }}
            returnValue="{ savings_monthly: $2,847.12, baseline: $6,190.40 }"
          >
            <ToolCard
              name="azure_retail_prices"
              status="ok"
              durationLabel="0.41s"
              input={{ region: 'westus2', sku: 'D2s_v5' }}
              result={{ price_per_hour: 0.096 }}
            />
            <ToolCard
              name="azure_sku_compatibility"
              status="ok"
              durationLabel="0.18s"
              input={{ from: 'D4s_v5', to: 'D2s_v5' }}
              result={{ compatible: true, family: 'Dsv5' }}
            />
          </SubAgentCard>
        </Section>

        <Section name="MessageHeader" reference="mocks/UX/01-cloud-ops.html:184-214">
          <MessageHeader
            name="Bob (cloud-ops)"
            variant="asst"
            modelTag="claude"
            modelId="Sonnet 4"
            timestamp="5:11 PM"
          />
        </Section>

        <Section name="HandoffPill" reference="mocks/UX/02 + 04 + 06 inline transcript">
          <HandoffPill
            fromModel="gpt-oss:20b"
            toModel="gemini-2.5-flash"
            reason="cloud-list classifier escalation"
          />
        </Section>

        <Section name="CitationChip" reference="mocks/UX/01-cloud-ops.html:1139,1168">
          <p style={{ fontSize: 13, lineHeight: 1.7 }}>
            "This recommendation is in-family"
            <CitationChip
              index={1}
              source="Azure SKU resize compatibility matrix"
            />
          </p>
        </Section>

        <Section name="AvatarCrumb" reference="mocks/UX/01-cloud-ops.html:1085 + .av-* CSS">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(['sm', 'md', 'lg'] as const).map((size) => (
              <div
                key={size}
                style={{ display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <span style={{ fontSize: 11, color: '#71717a', width: 24 }}>
                  {size}
                </span>
                <AvatarCrumb variant="asst" size={size} />
                <AvatarCrumb variant="c" size={size} />
                <AvatarCrumb variant="g" size={size} />
                <AvatarCrumb variant="s" size={size} />
                <AvatarCrumb variant="k" size={size} />
                <AvatarCrumb variant="user" size={size} />
              </div>
            ))}
          </div>
        </Section>

        <Section name="StatusRow" reference="mocks/UX/01-cloud-ops.html:818-895">
          <StatusRow
            items={[
              { label: 'API health', value: 'healthy', severity: 'ok' },
              { label: 'Latency', value: '142ms', severity: 'warn' },
              { label: 'Errors', value: '7', severity: 'err' },
              { label: 'Build', value: '#4823', severity: 'info' },
            ]}
          />
        </Section>

        <Section name="WidgetRenderer" reference="compose_visual sandboxed iframe">
          <WidgetRenderer
            template="sparkline"
            kind="svg"
            title="Sample sparkline"
            content={`<svg viewBox="0 0 50 20" width="50" height="20" xmlns="http://www.w3.org/2000/svg"><polyline fill="none" stroke="#8b5cf6" stroke-width="1.5" points="0,15 10,8 20,12 30,4 40,9 50,2" /></svg>`}
          />
        </Section>

        <Section name="AppRenderer" reference="compose_app sandboxed iframe (#474)">
          <AppRenderer
            artifactId="showcase-hello"
            title="Hello sandbox"
            html={`<div style="padding:24px;font-family:Inter,system-ui,sans-serif;color:#f8fafc;background:#16181c;border-radius:8px">Hello from sandbox</div>`}
          />
        </Section>

        <Section name="ToolCard" reference="mocks/UX/01-cloud-ops.html:271-355">
          <ToolCard
            name="azure_list_resource_groups"
            status="ok"
            durationLabel="0.62s"
            input={{ subscription_id: 'sub-1234' }}
            result={{ count: 14, region: 'westus2' }}
          />
        </Section>

        <Section name="Findings" reference="mocks 03, 07, 08, 09 — security/audit findings">
          <Findings
            items={[
              {
                id: '1',
                title: 'ClickHouse JDBC URL uses HTTP, not HTTPS',
                severity: 'med',
                body: 'plaintext credentials over Flink → ClickHouse hop',
              },
              {
                id: '2',
                title: 'Kafka SASL password read from env, but env not gated',
                severity: 'high',
                body: <>fail-fast at boot with explicit missing-env error</>,
              },
              {
                id: '3',
                title: 'RLS policy missing on SubscriptionItem table',
                severity: 'critical',
                body: 'cross-tenant read possible',
              },
              {
                id: '4',
                title: 'OpenTelemetry tracing wired correctly',
                severity: 'ok',
                body: 'Resource attributes include service.name, deployment.environment',
              },
            ]}
          />
        </Section>

        <Section name="CorrectionCard" reference="mocks 04, 05, 06 — self-correction strip">
          <CorrectionCard
            title="Self-correction · Milvus RPO breaches budget"
            body="Milvus async replication gives 8min RPO but requirement is ≤5min. Re-planning: pin Milvus writes to primary only + cold-restore from snapshot on failover. Re-delegating to data-replication for revised model."
          />
        </Section>

        <Section name="AgentTree" reference="mocks 04, 05, 06, 09 — sidebar agent hierarchy">
          <AgentTree
            nodes={[
              { id: 'orch', label: 'cloud-arch · orchestrator', variant: 'asst' },
              { id: 'a', label: 'k8s-topology', variant: 'k', count: '18t', parentId: 'orch' },
              { id: 'b', label: 'cost-analysis', variant: 'c', count: '11t', parentId: 'orch' },
              { id: 'c', label: 'network-latency', variant: 's', count: '9t', parentId: 'orch' },
              { id: 'd', label: 'data-replication', variant: 'g', count: '14t', parentId: 'orch' },
            ]}
          />
        </Section>

        <Section name="PassChip" reference="mock 04 — sub-agent multi-pass">
          <div style={{ display: 'flex', gap: 8 }}>
            <PassChip pass={2} />
            <PassChip pass={3} />
            <PassChip pass={4} />
          </div>
        </Section>

        <Section name="ArtifactPane" reference="mocks 02, 03, 06, 07, 08, 09 — split-pane viewer">
          <div style={{ height: 420, border: '1px solid var(--cm-line-2, rgba(255,255,255,0.10))', borderRadius: 8, overflow: 'hidden' }}>
            <ArtifactPane
              title="k8s-health-report.md"
              meta="markdown"
              tabs={[
                { id: 'a', label: 'report.md' },
                { id: 'b', label: 'severity-matrix.csv' },
                { id: 'c', label: 'remediation.yaml' },
              ]}
              activeTabId="a"
              onTabChange={() => {}}
              onClose={() => {}}
              onCopy={() => {}}
              onExport={() => {}}
              onFullscreen={() => {}}
            >
              <h1>Production Kubernetes Health · Weekly Summary</h1>
              <div className="art-sub">omhs-prod-eastus2 · window 2026-03-20 → 2026-04-19 · for CTO review</div>
              <h2>Top 3 incidents this window</h2>
              <p>1. Argo Image Updater pinned to a force-moved tag, repo-server cache stale for 4h.</p>
              <p>2. Milvus replica eviction cascade after node-pool autoscale.</p>
              <p>3. NGINX ingress 502s during cert renewal due to missing graceful reload hook.</p>
            </ArtifactPane>
          </div>
        </Section>

        <Section name="Runbook" reference="mocks 04, 05, 08 — DR/playbook step list">
          <Runbook
            title="us-east-1 region loss → us-west-2 promotion"
            budget="budget 15m · actual 11m42s"
            steps={[
              { tag: 'T+0', title: 'Detect', body: <>Prometheus alert <code>region_health_us_east_1 == 0</code> fires on &gt;50% AZ packet loss for 60s; paged to on-call.</>, owner: 'auto · no human required', duration: '60s' },
              { tag: 'T+1', title: 'Confirm', body: 'automated health probe from 3 non-affected regions; if all 3 report primary unreachable, advance.', owner: 'synth-executor · auto', duration: '30s' },
              { tag: 'T+1.5', title: 'GSLB withdraw', body: 'Route 53 health-check forces us-east-1 out of the rotation.', owner: 'auto', duration: '90s (TTL)' },
              { tag: 'T+3', title: 'Patroni promote', body: 'etcd quorum in us-west-2 elects local replica; new leader fsync\'ed, pgBouncer reroutes.', owner: 'patroni · auto', duration: '45s' },
              { tag: 'T+4', title: 'Human gate', body: <>SRE on-call confirms via Slack approval (<code>/dr-approve us-west-2</code>). Last chance to abort.</>, owner: 'SRE on-call (human)', duration: '120s cap', severity: 'warn' },
              { tag: 'T+11.5', title: 'Verify', body: 'synthetic probe from 3 regions hits /healthz on all 7 services; k6 soak at 10% traffic.', owner: 'auto', duration: '60s', severity: 'ok' },
            ]}
          />
        </Section>

        <Section name="WaveTimeline" reference="mocks 06, 08 — multi-wave horizontal timeline">
          <WaveTimeline
            title="90-day cutover · 4 waves"
            rows={[
              { id: '1', label: 'Wave 1', dates: 'day 1-14', segments: [{ left: 0, width: 15, label: 'retire · 34 VMs', tone: 'a' }] },
              { id: '2', label: 'Wave 2', dates: 'day 15-42', segments: [{ left: 16, width: 30, label: 'stateless migration · 48 VMs', tone: 'b' }] },
              { id: '3', label: 'Wave 3', dates: 'day 43-70', segments: [{ left: 48, width: 30, label: 'stateful + SCCs · 35 VMs', tone: 'c' }] },
              { id: '4', label: 'Wave 4', dates: 'day 71-90', segments: [{ left: 79, width: 20, label: 'crown-jewels · 17 VMs', tone: 'd' }] },
            ]}
          />
        </Section>

        <Section name="StackGrid" reference="mock 09 — full-stack scaffold tech grid">
          <StackGrid
            layers={[
              { role: 'Frontend', tech: 'React 18 + Vite 5', meta: 'TanStack Query · Tailwind · Zustand' },
              { role: 'Backend', tech: 'Fastify 4 + Prisma 5', meta: 'Zod · pino · graceful-shutdown' },
              { role: 'DB', tech: 'Postgres 16 + RLS', meta: 'tenant_id on every row' },
              { role: 'Cache', tech: 'Redis 7', meta: 'session + rate-limit + queue' },
              { role: 'Billing', tech: 'Stripe Billing', meta: 'webhook ⇒ reconcile' },
              { role: 'Auth', tech: 'OIDC + app-JWT', meta: 'Auth0 / Okta plug compatible' },
              { role: 'Infra', tech: 'Helm + ArgoCD', meta: 'HPA · PDB · NetworkPolicy' },
              { role: 'CI', tech: 'GitHub Actions', meta: 'image build · trivy · argo sync' },
              { role: 'Observe', tech: 'OpenTelemetry', meta: 'traces + Prom metrics' },
            ]}
          />
        </Section>

        <Section name="AnnotatedCode" reference="mocks 03, 07 — line-flagged code review">
          <AnnotatedCode
            ariaLabel="handlers/user.go"
            language="go"
            annotatedLines={[3, 4, 5]}
            lines={[
              'package handlers',
              '',
              'func (h *UserHandler) getUserByEmail(ctx context.Context, email string) (*models.User, error) {',
              '    err := h.DB.QueryRow(ctx,',
              '        `SELECT id, email, pw_hash, created_at FROM users WHERE email = $1`,',
              '        email).Scan(&u.ID, &u.Email, &u.PWHash, &u.CreatedAt)',
              '    if errors.Is(err, pgx.ErrNoRows) { return nil, nil }',
              '    return &u, err',
              '}',
            ]}
          />
        </Section>
      </div>
    </div>
  );
}
