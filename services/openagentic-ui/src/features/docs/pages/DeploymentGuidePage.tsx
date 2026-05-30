import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { DocsInfraIcon } from '../components/DocsIcons';

// ============================================================================
// DATA
// ============================================================================

const services = [
  'openagentic-api',
  'openagentic-ui',
  'openagentic-workflows',
  'openagentic-mcp-proxy',
  'openagentic-manager',
  'openagentic-proxy',
  'openagentic-synth',
];

const helmStructure = [
  { name: 'values.yaml', desc: '1300+ lines of service configuration covering all deployments, resource limits, feature flags, and environment variables' },
  { name: 'templates/', desc: 'Kubernetes manifests for Deployment, Service, NetworkPolicy, Ingress, ConfigMap, and Secret resources' },
  { name: 'dashboards/', desc: '12 Grafana dashboard JSON files for monitoring all services, databases, and infrastructure health' },
];

const infraComponents = [
  { name: 'PostgreSQL', desc: 'Bitnami chart with pgvector extension for metadata storage and vector similarity search' },
  { name: 'Redis', desc: 'Master + replica topology for caching, session storage, and pub/sub messaging' },
  { name: 'Milvus', desc: 'Standalone or cluster mode with GPU acceleration for high-throughput vector search' },
  { name: 'MinIO', desc: 'S3-compatible object storage for workspace snapshots, file uploads, and artifact persistence' },
  { name: 'Ollama', desc: 'Local LLM inference server for on-premises model execution without external API calls' },
  { name: 'Grafana', desc: 'Monitoring dashboards with 12 pre-built views for services, databases, and cluster health' },
  { name: 'Prometheus', desc: 'Metrics collection and alerting with service discovery across all Kubernetes pods' },
  { name: 'Loki + Promtail', desc: 'Log aggregation pipeline collecting structured logs from all services and infrastructure' },
  { name: 'HashiCorp Vault', desc: 'Secrets management backend with ESO integration for Kubernetes-native secret delivery' },
  { name: 'Envoy Gateway', desc: 'L7 proxy replacing nginx ingress with advanced routing, rate limiting, and mTLS termination' },
];

const clusterNodes = [
  { name: 'gpu-node', specs: '8 cores, 31 GB RAM, 2x NVIDIA GPU, amd64', role: 'GPU workloads (Milvus, Ollama)' },
  { name: 'hal-388ac', specs: '16 cores, 31 GB RAM, amd64', role: 'Master node, control plane' },
  { name: 'k8a through k8e', specs: '4 cores each, arm64', role: 'General-purpose worker nodes' },
];

const secretsPipeline = [
  { stage: 'Vault', desc: 'All secrets stored in HashiCorp Vault with path-based ACLs and automatic rotation policies' },
  { stage: 'ESO Sync', desc: 'External Secrets Operator watches Vault paths and creates corresponding Kubernetes Secret objects' },
  { stage: 'Helm Values', desc: 'Environment variables reference K8s Secrets; no plaintext credentials in values files or Git' },
  { stage: 'Runtime Fallback', desc: 'secrets.config.ts generates ephemeral secrets if Vault is unreachable (CRITICAL warning logged)' },
];

// ============================================================================
// STYLES
// ============================================================================

const sectionStyle: React.CSSProperties = {
  marginBottom: '64px',
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: 'var(--color-textMuted)',
  marginBottom: '8px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  color: 'var(--color-text)',
  marginBottom: '16px',
  lineHeight: 1.2,
};

const sectionDescStyle: React.CSSProperties = {
  fontSize: '16px',
  color: 'var(--color-textSecondary)',
  lineHeight: 1.65,
  maxWidth: '640px',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '12px',
  padding: '24px',
};

const codeBlockStyle: React.CSSProperties = {
  background: 'var(--color-surfaceSecondary)',
  border: '1px solid var(--color-border)',
  borderRadius: '10px',
  padding: '20px 24px',
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  fontSize: '13px',
  lineHeight: 1.7,
  color: 'var(--color-text)',
  overflowX: 'auto',
  whiteSpace: 'pre',
};

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
  color: 'var(--color-textMuted)',
  marginBottom: '8px',
};

// ============================================================================
// COMPONENT
// ============================================================================

const DeploymentGuidePage: React.FC = () => {
  const fadeUp = useMemo(
    () => ({
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
    }),
    []
  );

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
      {/* ================================================================
          HERO
          ================================================================ */}
      <motion.section style={{ marginBottom: '80px', textAlign: 'center' }} {...fadeUp}>
        <div style={{ marginBottom: '24px' }}>
          <DocsInfraIcon size={48} />
        </div>
        <h1
          style={{
            fontSize: '42px',
            fontWeight: 700,
            color: 'var(--color-text)',
            lineHeight: 1.15,
            marginBottom: '16px',
            letterSpacing: '-0.02em',
          }}
        >
          Deployment Guide
        </h1>
        <p
          style={{
            fontSize: '18px',
            color: 'var(--color-textSecondary)',
            lineHeight: 1.6,
            maxWidth: '600px',
            margin: '0 auto',
          }}
        >
          Build, deploy, and manage the OpenAgentic platform across
          development, staging, and production Kubernetes clusters.
        </p>
      </motion.section>

      {/* ================================================================
          BUILD PROCESS
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Build</p>
        <h2 style={sectionTitleStyle}>Build Process</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          All services are built using the centralized build script. Never use
          <code style={{ color: 'var(--color-primary)', padding: '0 4px' }}>docker build</code> directly.
        </p>

        <div style={{ marginBottom: '16px' }}>
          <p style={labelStyle}>Build and push a service</p>
          <div style={codeBlockStyle}>
            {'./scripts/build.sh <service> --buildpush --no-cache [--multiarch]'}
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <p style={labelStyle}>Available services</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {services.map((svc) => (
              <span
                key={svc}
                style={{
                  display: 'inline-block',
                  fontSize: '12px',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  color: 'var(--color-primary)',
                  background: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  padding: '4px 12px',
                }}
              >
                {svc}
              </span>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ================================================================
          DEPLOYMENT
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Deploy</p>
        <h2 style={sectionTitleStyle}>Helm Deployment</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          Deployment uses Helm with environment-specific value overrides.
          After upgrading the chart, restart individual services to pick up
          new container images.
        </p>

        <div style={{ marginBottom: '16px' }}>
          <p style={labelStyle}>Upgrade the Helm release</p>
          <div style={codeBlockStyle}>
            {'helm upgrade openagentic ./helm/openagentic \\\n  -f values-k3s-local.yaml \\\n  -f values-local-registry.yaml \\\n  -n agentic-dev --no-hooks'}
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <p style={labelStyle}>Restart a specific service</p>
          <div style={codeBlockStyle}>
            {'kubectl rollout restart deployment/<service> -n agentic-dev'}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '12px',
            marginBottom: '24px',
          }}
        >
          {[
            { label: 'Kubernetes', value: 'k3s (dev), AKS (staging/prod)' },
            { label: 'Namespace', value: 'agentic-dev' },
            { label: 'Registry', value: '10.2.10.131:30500 (local dev)' },
            { label: 'URL', value: 'https://<your-deploy-host>' },
          ].map((item) => (
            <div key={item.label} style={cardStyle}>
              <p style={labelStyle}>{item.label}</p>
              <p
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  fontFamily: 'monospace',
                }}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          HELM CHART STRUCTURE
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Configuration</p>
        <h2 style={sectionTitleStyle}>Helm Chart Structure</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          The Helm chart centralizes all Kubernetes resource definitions, service
          configuration, and monitoring dashboards in a single package.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {helmStructure.map((item, i) => (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + i * 0.06, duration: 0.3 }}
              style={{
                ...cardStyle,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '16px',
              }}
            >
              <code
                style={{
                  flexShrink: 0,
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  fontFamily: 'monospace',
                  minWidth: '120px',
                }}
              >
                {item.name}
              </code>
              <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.6 }}>
                {item.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          INFRASTRUCTURE COMPONENTS
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Infrastructure</p>
        <h2 style={sectionTitleStyle}>Helm-Managed Components</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          All infrastructure runs inside the Kubernetes cluster, managed as
          Helm sub-charts or standalone releases in the same namespace.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {infraComponents.map((item, i) => (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <h4
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  marginBottom: '6px',
                }}
              >
                {item.name}
              </h4>
              <p style={{ fontSize: '12px', color: 'var(--color-textSecondary)', lineHeight: 1.6 }}>
                {item.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          CLUSTER NODES
          ================================================================ */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Cluster</p>
        <h2 style={sectionTitleStyle}>Dev Cluster Nodes</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          The development cluster runs on a heterogeneous set of nodes with
          mixed architectures and GPU capabilities.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {clusterNodes.map((node, i) => (
            <motion.div
              key={node.name}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.45 + i * 0.06, duration: 0.3 }}
              style={{
                ...cardStyle,
                display: 'grid',
                gridTemplateColumns: '140px 1fr 1fr',
                gap: '16px',
                alignItems: 'center',
              }}
            >
              <code
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                  fontFamily: 'monospace',
                }}
              >
                {node.name}
              </code>
              <span style={{ fontSize: '13px', color: 'var(--color-textSecondary)' }}>
                {node.specs}
              </span>
              <span style={{ fontSize: '13px', color: 'var(--color-textMuted)' }}>
                {node.role}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          SECRETS MANAGEMENT
          ================================================================ */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Secrets</p>
        <h2 style={sectionTitleStyle}>Secrets Pipeline</h2>
        <p style={{ ...sectionDescStyle, marginBottom: '24px' }}>
          Secrets flow from Vault through ESO into Kubernetes, with Helm values
          referencing K8s Secrets and a runtime fallback for development.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {secretsPipeline.map((step, i) => (
            <motion.div
              key={step.stage}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.08, duration: 0.35 }}
              style={{
                ...cardStyle,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '16px',
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '14px',
                  fontWeight: 700,
                  color: 'var(--color-primary)',
                }}
              >
                {i + 1}
              </div>
              <div>
                <h4
                  style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    color: 'var(--color-text)',
                    marginBottom: '6px',
                  }}
                >
                  {step.stage}
                </h4>
                <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.6 }}>
                  {step.desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>
    </div>
  );
};

export default DeploymentGuidePage;
