import React from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';

// ============================================================================
// INLINE SVG ICONS
// ============================================================================

const ShieldLayerIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="shieldLayerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ef4444" />
        <stop offset="100%" stopColor="#f97316" />
      </linearGradient>
    </defs>
    <path d="M12 2l8 4v6c0 5.25-3.5 9.75-8 11-4.5-1.25-8-5.75-8-11V6l8-4z" stroke="url(#shieldLayerGrad)" strokeWidth="2" fill="url(#shieldLayerGrad)" fillOpacity="0.1" />
    <path d="M12 6l5 2.5v3.75c0 3.28-2.19 6.09-5 6.88" stroke="url(#shieldLayerGrad)" strokeWidth="1.5" opacity="0.6" />
    <path d="M9 12l2 2 4-4" stroke="url(#shieldLayerGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const KubeIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="kubeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#326CE5" />
        <stop offset="100%" stopColor="#60a5fa" />
      </linearGradient>
    </defs>
    <polygon points="12,2 22,8 22,16 12,22 2,16 2,8" stroke="url(#kubeGrad)" strokeWidth="2" fill="url(#kubeGrad)" fillOpacity="0.1" />
    <circle cx="12" cy="12" r="3" stroke="url(#kubeGrad)" strokeWidth="1.5" />
    <line x1="12" y1="9" x2="12" y2="2" stroke="url(#kubeGrad)" strokeWidth="1" opacity="0.5" />
    <line x1="14.6" y1="13.5" x2="22" y2="16" stroke="url(#kubeGrad)" strokeWidth="1" opacity="0.5" />
    <line x1="9.4" y1="13.5" x2="2" y2="16" stroke="url(#kubeGrad)" strokeWidth="1" opacity="0.5" />
  </svg>
);

// ============================================================================
// DIAGRAM
// ============================================================================

const isolationDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'Sandbox Isolation Layers',
  layout: 'vertical',
  nodes: [
    { id: 'user', label: 'User Request', shape: 'rounded', color: 'blue' },
    { id: 'api', label: 'API Gateway', description: 'Auth + session lookup', shape: 'rounded', color: 'purple' },
    { id: 'k8s', label: 'Kubernetes API', description: 'Pod scheduling', shape: 'rounded', color: 'kubernetes' },
    { id: 'ns', label: 'Isolated Namespace', description: 'NetworkPolicy enforced', shape: 'container', color: 'cyan' },
    { id: 'pod', label: 'Sandbox Pod', description: 'seccomp + Landlock', shape: 'server', color: 'orange' },
    { id: 'fs', label: 'Workspace FS', description: 'emptyDir volume', shape: 'database', color: 'green' },
  ],
  edges: [
    { source: 'user', target: 'api', animated: true },
    { source: 'api', target: 'k8s' },
    { source: 'k8s', target: 'ns' },
    { source: 'ns', target: 'pod' },
    { source: 'pod', target: 'fs', style: 'dashed' },
  ],
};

// ============================================================================
// ANIMATION VARIANTS
// ============================================================================

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
};

// ============================================================================
// COMPONENT
// ============================================================================

const SandboxSecurityPage: React.FC = () => {
  const layers = [
    {
      name: 'Container Isolation',
      description: 'Each sandbox runs as a non-root user inside a minimal container image. The root filesystem is mounted read-only, and only the workspace directory is writable via an emptyDir volume.',
    },
    {
      name: 'Landlock LSM',
      description: 'The Linux Landlock security module restricts the process to a specific set of filesystem paths. The sandbox process can only read and write within /workspace, blocking access to host paths, /proc, and other sensitive locations.',
    },
    {
      name: 'seccomp Profiles',
      description: 'A custom seccomp profile limits the system calls available to the container. Dangerous calls like mount, ptrace, and init_module are blocked at the kernel level.',
    },
    {
      name: 'Kubernetes NetworkPolicy',
      description: 'Each sandbox pod has a NetworkPolicy that blocks all ingress and egress except for specific allowed endpoints (package registries, the API server). Cross-pod communication is denied.',
    },
    {
      name: 'Resource Limits',
      description: 'CPU and memory limits are enforced via Kubernetes resource quotas. A single sandbox cannot consume more than its allocated share, preventing noisy-neighbor problems.',
    },
    {
      name: 'Automatic Termination',
      description: 'Idle pods are detected via heartbeat checks and terminated after a configurable timeout (default: 30 minutes). A final workspace snapshot is taken before termination.',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--color-text)' }}>
          Sandbox Security
        </h1>
        <p className="text-lg leading-relaxed mb-10" style={{ color: 'var(--color-textSecondary)' }}>
          Code Mode sandboxes are designed with defense in depth. Multiple independent isolation
          layers ensure that even if one layer is bypassed, the others contain the threat.
        </p>
      </motion.div>

      {/* Architecture Diagram */}
      <motion.section custom={1} variants={sectionVariants} initial="hidden" animate="visible" className="mb-10">
        <ReactFlowDiagram diagram={isolationDiagram} height={420} />
      </motion.section>

      {/* Isolation Layers */}
      <motion.section custom={2} variants={sectionVariants} initial="hidden" animate="visible">
        <div className="flex items-center gap-3 mb-4">
          <ShieldLayerIcon />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            Isolation Layers
          </h2>
        </div>
        <div className="space-y-4 mb-10">
          {layers.map((layer, i) => (
            <motion.div
              key={layer.name}
              custom={i + 3}
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
              className="rounded-xl p-5"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="flex items-center gap-3 mb-2">
                <span
                  className="text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}
                >
                  {i + 1}
                </span>
                <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                  {layer.name}
                </h3>
              </div>
              <p className="text-sm leading-relaxed ml-9" style={{ color: 'var(--color-textSecondary)' }}>
                {layer.description}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Pod Lifecycle */}
      <motion.section custom={9} variants={sectionVariants} initial="hidden" animate="visible">
        <div className="flex items-center gap-3 mb-4">
          <KubeIcon />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            Pod Lifecycle
          </h2>
        </div>
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface)' }}>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Phase</th>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Description</th>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Provisioning', 'Kubernetes schedules pod, pulls image, applies policies', '5-15s'],
                ['Initialization', 'Restore workspace from MinIO, start code-server', '3-8s'],
                ['Active', 'User interacts with IDE and AI', 'Until idle'],
                ['Idle detection', 'No heartbeat for configured period', '30m default'],
                ['Termination', 'Snapshot workspace, delete pod and resources', '5-10s'],
              ].map(([phase, desc, dur], i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="p-3 font-medium" style={{ color: 'var(--color-text)' }}>{phase}</td>
                  <td className="p-3" style={{ color: 'var(--color-textSecondary)' }}>{desc}</td>
                  <td className="p-3 font-mono text-xs" style={{ color: 'var(--color-textMuted)' }}>{dur}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>
    </div>
  );
};

export default SandboxSecurityPage;
