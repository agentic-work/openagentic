import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { useDocsStore } from '@/stores/useDocsStore';
import { OpenAgenticWordmark } from '@/shared/components/OpenAgenticWordmark';

// ============================================================================
// CSS KEYFRAMES (injected once)
// ============================================================================

const keyframesCSS = `
@keyframes brandShimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}
@keyframes orbFloat1 {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.18; }
  33% { transform: translate(60px, -40px) scale(1.15); opacity: 0.25; }
  66% { transform: translate(-30px, 30px) scale(0.9); opacity: 0.12; }
}
@keyframes orbFloat2 {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.14; }
  40% { transform: translate(-50px, 50px) scale(1.2); opacity: 0.22; }
  70% { transform: translate(40px, -20px) scale(0.85); opacity: 0.1; }
}
@keyframes orbFloat3 {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.1; }
  50% { transform: translate(30px, 40px) scale(1.1); opacity: 0.2; }
}
@keyframes gridPulse {
  0%, 100% { opacity: 0.03; }
  50% { opacity: 0.07; }
}
@keyframes heroWordReveal {
  0% { opacity: 0; filter: blur(6px); transform: translateY(8px); }
  100% { opacity: 1; filter: blur(0); transform: translateY(0); }
}
@keyframes hereFadeIn {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
`;

// ============================================================================
// ARCHITECTURE DIAGRAM
// ============================================================================

const architectureDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'OpenAgentic System Architecture',
  description: 'Request flow from user input to response generation',
  layout: 'vertical',
  nodes: [
    { id: 'user', label: 'User', description: 'Chat / Code / Flows', shape: 'rounded', color: 'primary' },
    { id: 'frontend', label: 'Frontend', description: 'React SPA', shape: 'rounded', color: 'blue' },
    { id: 'auth', label: 'Auth', description: 'SSO / API Key', shape: 'rounded', color: 'gray' },
    { id: 'validation', label: 'Validation', description: 'Input guards', shape: 'rounded', color: 'gray' },
    { id: 'dlp', label: 'DLP Scanner', description: 'Data loss prevention', shape: 'rounded', color: 'red' },
    { id: 'rag', label: 'RAG', description: 'pgvector + Milvus', shape: 'rounded', color: 'cyan' },
    { id: 'memory', label: 'Memory', description: 'Conversation context', shape: 'rounded', color: 'purple' },
    { id: 'prompt', label: 'Prompt Builder', description: 'System prompt assembly', shape: 'rounded', color: 'indigo' },
    { id: 'router', label: 'Model Router', description: 'Capability + budget caps', shape: 'diamond', color: 'orange' },
    { id: 'mcp-proxy', label: 'MCP Proxy', description: '14 MCP servers', shape: 'server', color: 'orange' },
    { id: 'openagentic-proxy', label: 'Agent Proxy', description: '11 agent types', shape: 'server', color: 'purple' },
    { id: 'completion', label: 'LLM Completion', description: 'Multi-provider', shape: 'rounded', color: 'green' },
    { id: 'response', label: 'Response', description: 'Streaming to client', shape: 'rounded', color: 'primary' },
    { id: 'db', label: 'PostgreSQL', description: 'pgvector + metadata', shape: 'database', color: 'blue' },
    { id: 'redis', label: 'Redis', description: 'Cache + sessions', shape: 'database', color: 'red' },
    { id: 'milvus', label: 'Milvus', description: 'GPU vector search', shape: 'database', color: 'cyan' },
  ],
  edges: [
    { source: 'user', target: 'frontend', label: 'HTTPS' },
    { source: 'frontend', target: 'auth', animated: true },
    { source: 'auth', target: 'validation' },
    { source: 'validation', target: 'dlp' },
    { source: 'dlp', target: 'rag' },
    { source: 'rag', target: 'memory' },
    { source: 'memory', target: 'prompt' },
    { source: 'prompt', target: 'router' },
    { source: 'router', target: 'mcp-proxy', label: 'tools', style: 'dashed' },
    { source: 'router', target: 'openagentic-proxy', label: 'delegate', style: 'dashed' },
    { source: 'router', target: 'completion' },
    { source: 'completion', target: 'response', animated: true },
    { source: 'rag', target: 'db', style: 'dashed', color: 'blue' },
    { source: 'rag', target: 'milvus', style: 'dashed', color: 'cyan' },
    { source: 'memory', target: 'redis', style: 'dashed', color: 'red' },
  ],
};

// ============================================================================
// MODE CARDS DATA
// ============================================================================

interface ModeData {
  title: string;
  tagline: string;
  bullets: string[];
  gradient: string;
  glowColor: string;
  iconSvg: React.ReactNode;
}

// theme-allow: per-feature illustration identity gradients + glow hues + gradient SVG
// icons below (decorative feature-card art, same carve-out as the illustration palettes).
const modes: ModeData[] = [
  {
    title: 'Chat',
    tagline: 'Conversational AI that selects the right model and tools for every message.',
    bullets: [
      'Multi-model routing with per-user × per-model budget caps',
      'Automatic MCP tool selection via vector similarity',
      'Agent delegation for complex multi-step tasks',
    ],
    gradient: 'linear-gradient(135deg, #3B82F6, #60A5FA)',
    glowColor: 'rgba(59, 130, 246, 0.35)',
    iconSvg: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <defs>
          <linearGradient id="chatGrad" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#60A5FA" />
          </linearGradient>
        </defs>
        <rect x="3" y="5" width="26" height="18" rx="4" stroke="url(#chatGrad)" strokeWidth="2" fill="none" />
        <circle cx="10" cy="14" r="1.5" fill="url(#chatGrad)" />
        <circle cx="16" cy="14" r="1.5" fill="url(#chatGrad)" />
        <circle cx="22" cy="14" r="1.5" fill="url(#chatGrad)" />
        <path d="M10 23L7 27V23H10Z" fill="url(#chatGrad)" />
      </svg>
    ),
  },
  {
    title: 'Flows',
    tagline: 'Visual workflow canvas with 34 node types and scheduled execution.',
    bullets: [
      'Drag-and-drop orchestration of AI pipelines',
      'Conditional branching, loops, human approvals',
      'Cron scheduling and webhook triggers',
    ],
    gradient: 'linear-gradient(135deg, #7C3AED, #A78BFA)',
    glowColor: 'rgba(124, 58, 237, 0.35)',
    iconSvg: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <defs>
          <linearGradient id="flowGrad" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%" stopColor="#7C3AED" />
            <stop offset="100%" stopColor="#A78BFA" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="10" height="8" rx="2" stroke="url(#flowGrad)" strokeWidth="2" fill="none" />
        <rect x="18" y="4" width="10" height="8" rx="2" stroke="url(#flowGrad)" strokeWidth="2" fill="none" />
        <rect x="11" y="20" width="10" height="8" rx="2" stroke="url(#flowGrad)" strokeWidth="2" fill="none" />
        <path d="M9 12V16L16 20" stroke="url(#flowGrad)" strokeWidth="1.5" fill="none" />
        <path d="M23 12V16L16 20" stroke="url(#flowGrad)" strokeWidth="1.5" fill="none" />
      </svg>
    ),
  },
];

// ============================================================================
// CAPABILITIES DATA
// ============================================================================

interface CapabilityData {
  title: string;
  description: string;
  badge: string;
  hoverDetail: string;
  iconSvg: React.ReactNode;
}

const capabilities: CapabilityData[] = [
  {
    title: 'Multi-Model Routing',
    description: 'Route requests across providers with per-user × per-model budget caps.',
    badge: '5 providers',
    hoverDetail: 'OpenAI, Anthropic, Google, Azure, and local models.',
    iconSvg: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <defs><linearGradient id="capRoute" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#7C3AED" /><stop offset="100%" stopColor="#3B82F6" /></linearGradient></defs>
        <circle cx="12" cy="4" r="2.5" stroke="url(#capRoute)" strokeWidth="1.5" fill="none" />
        <circle cx="4" cy="20" r="2.5" stroke="url(#capRoute)" strokeWidth="1.5" fill="none" />
        <circle cx="12" cy="20" r="2.5" stroke="url(#capRoute)" strokeWidth="1.5" fill="none" />
        <circle cx="20" cy="20" r="2.5" stroke="url(#capRoute)" strokeWidth="1.5" fill="none" />
        <path d="M12 6.5V10M12 10L4 17.5M12 10L12 17.5M12 10L20 17.5" stroke="url(#capRoute)" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    title: 'MCP Tools',
    description: 'Access external services through the Model Context Protocol standard.',
    badge: '16 servers',
    hoverDetail: 'Azure, AWS, Kubernetes, GitHub, Jira, databases, web search, and more.',
    iconSvg: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <defs><linearGradient id="capTool" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#F59E0B" /><stop offset="100%" stopColor="#FBBF24" /></linearGradient></defs>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="url(#capTool)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Agent Delegation',
    description: 'Specialist agents handle research, code, analysis, and creative tasks.',
    badge: '11 types',
    hoverDetail: 'Research, code generation, data analysis, creative writing, and more.',
    iconSvg: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <defs><linearGradient id="capAgent" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#A78BFA" /><stop offset="100%" stopColor="#7C3AED" /></linearGradient></defs>
        <circle cx="12" cy="8" r="4" stroke="url(#capAgent)" strokeWidth="1.5" fill="none" />
        <path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="url(#capAgent)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M16 4l2-2M8 4L6 2M12 2V0" stroke="url(#capAgent)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Visual Workflows',
    description: 'Build automated pipelines with branching, loops, and human gates.',
    badge: '34 nodes',
    hoverDetail: 'Conditional logic, parallel execution, LLM calls, API calls, transforms.',
    iconSvg: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <defs><linearGradient id="capFlow" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#14B8A6" /><stop offset="100%" stopColor="#06B6D4" /></linearGradient></defs>
        <rect x="2" y="2" width="7" height="5" rx="1.5" stroke="url(#capFlow)" strokeWidth="1.5" fill="none" />
        <rect x="15" y="2" width="7" height="5" rx="1.5" stroke="url(#capFlow)" strokeWidth="1.5" fill="none" />
        <rect x="8.5" y="17" width="7" height="5" rx="1.5" stroke="url(#capFlow)" strokeWidth="1.5" fill="none" />
        <path d="M5.5 7V11L12 17M18.5 7V11L12 17" stroke="url(#capFlow)" strokeWidth="1.5" fill="none" />
      </svg>
    ),
  },
  {
    title: 'Enterprise Security',
    description: 'SSO, DLP scanning on every message, HITL gates, and audit trails.',
    badge: 'DLP + HITL',
    hoverDetail: 'Immutable audit logs, approval gates for sensitive operations, compliance-ready.',
    iconSvg: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <defs><linearGradient id="capShield" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#EF4444" /><stop offset="100%" stopColor="#F97316" /></linearGradient></defs>
        <path d="M12 2L4 6v5c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4z" stroke="url(#capShield)" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
        <path d="M9 12l2 2 4-4" stroke="url(#capShield)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'Full Observability',
    description: 'Request tracing, token tracking, cost attribution, and health monitoring.',
    badge: 'Prometheus',
    hoverDetail: 'Prometheus metrics, Grafana dashboards, per-user cost attribution.',
    iconSvg: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <defs><linearGradient id="capObs" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#3B82F6" /><stop offset="100%" stopColor="#60A5FA" /></linearGradient></defs>
        <rect x="2" y="3" width="20" height="18" rx="2" stroke="url(#capObs)" strokeWidth="1.5" fill="none" />
        <polyline points="6,15 10,10 14,13 18,7" stroke="url(#capObs)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

// ============================================================================
// EXAMPLE QUESTIONS
// ============================================================================

const exampleQuestions = [
  'How does SmartModelRouter pick between Claude, GPT, and Gemini?',
  'What MCP servers are available and what can they do?',
  'Walk me through building a flow with human approval gates.',
];

// ============================================================================
// FRAMER MOTION VARIANTS
// ============================================================================

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const fadeUpItem = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
};

const sectionReveal = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] } },
};

// ============================================================================
// COMPONENT
// ============================================================================

const WelcomePage: React.FC = () => {
  const toggleChat = useDocsStore((s) => s.toggleChat);

  const handleOpenAssistant = useCallback(() => {
    toggleChat();
  }, [toggleChat]);

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '0 32px 96px' }}>
      <style>{keyframesCSS}</style>

      {/* ================================================================
          HERO SECTION
          ================================================================ */}
      <section
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '20px',
          marginBottom: '80px',
          padding: '72px 40px 64px',
          textAlign: 'center',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* Animated background orbs */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        >
          {/* theme-allow: decorative animated background "orb" glows (illustration art) */}
          <div
            style={{
              position: 'absolute',
              top: '-20%',
              left: '10%',
              width: '300px',
              height: '300px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 70%)',
              animation: 'orbFloat1 12s ease-in-out infinite',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '30%',
              right: '5%',
              width: '250px',
              height: '250px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)',
              animation: 'orbFloat2 15s ease-in-out infinite',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '-10%',
              left: '40%',
              width: '350px',
              height: '350px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 70%)',
              animation: 'orbFloat3 10s ease-in-out infinite',
            }}
          />
          {/* Subtle grid overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              animation: 'gridPulse 4s ease-in-out infinite',
            }}
          />
        </div>

        {/* Hero content */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* 1. Animated [openagentic] wordmark — per-char brand chord */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: 10,
              animation: 'hereFadeIn 0.6s ease-out 0.1s both',
            }}
          >
            <OpenAgenticWordmark size={44} animate />
          </div>

          {/* 2. DOCUMENTATION subtitle */}
          <p
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--color-textSecondary)',
              marginBottom: 28,
              animation: 'hereFadeIn 0.6s ease-out 0.3s both',
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
            }}
          >
            Documentation
          </p>

          {/* 3. AGENTICHAT hero artwork — release v0.7.1.
              Static PNG (atlas mp4 ripped 2026-05-11 alongside the codename
              rename Atlas Donzo → AGENTICHAT). */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: 18,
              animation: 'hereFadeIn 0.7s ease-out 0.45s both',
            }}
          >
            <img
              src="/agentichat.png"
              alt="AGENTICHAT — v0.7.1 release artwork"
              style={{
                maxWidth: '100%',
                maxHeight: 360,
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                display: 'block',
                borderRadius: 12,
                filter:
                  'drop-shadow(0 30px 40px rgba(0,0,0,0.45)) drop-shadow(0 12px 20px rgba(0,0,0,0.30))',
                transform: 'perspective(1400px) rotateX(2deg)',
                transformStyle: 'preserve-3d',
              }}
            />
          </div>

          {/* 4. Version pill */}
          <span
            className="font-mono"
            style={{
              display: 'inline-block',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.06em',
              padding: '5px 16px',
              borderRadius: 20,
              color: 'var(--color-primary)',
              background: 'var(--color-surfaceSecondary)',
              border: '1px solid var(--color-border)',
              animation: 'hereFadeIn 0.6s ease-out 0.7s both',
            }}
          >
            v{import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_VERSION || '0.0.0'}
            {import.meta.env.VITE_CODENAME ? ` · ${import.meta.env.VITE_CODENAME}` : ''}
          </span>
        </div>
      </section>

      {/* ================================================================
          THREE WAYS TO WORK
          ================================================================ */}
      <motion.section
        style={{ marginBottom: '80px' }}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        variants={sectionReveal}
      >
        <p
          style={{
            fontSize: '13px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--color-textMuted)',
            marginBottom: '8px',
          }}
        >
          Platform Modes
        </p>
        <h2
          style={{
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--color-text)',
            marginBottom: '12px',
            lineHeight: 1.2,
          }}
        >
          Three Ways to Work
        </h2>
        <p
          style={{
            fontSize: '16px',
            color: 'var(--color-textSecondary)',
            lineHeight: 1.65,
            maxWidth: '640px',
            marginBottom: '32px',
          }}
        >
          OpenAgentic adapts to how you think. Choose a conversational interface,
          a full development environment, or a visual workflow canvas.
        </p>

        <motion.div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-40px' }}
          variants={staggerContainer}
        >
          {modes.map((mode) => (
            <motion.div
              key={mode.title}
              variants={fadeUpItem}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              style={{
                position: 'relative',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '14px',
                overflow: 'hidden',
                cursor: 'default',
                transition: 'box-shadow 0.3s ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow =
                  `0 8px 32px ${mode.glowColor}, 0 0 0 1px ${mode.glowColor}`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              {/* Gradient top border */}
              <div
                style={{
                  height: '3px',
                  background: mode.gradient,
                }}
              />
              <div style={{ padding: '28px 24px 24px' }}>
                <div style={{ marginBottom: '16px' }}>{mode.iconSvg}</div>
                <h3
                  style={{
                    fontSize: '18px',
                    fontWeight: 600,
                    color: 'var(--color-text)',
                    marginBottom: '8px',
                  }}
                >
                  {mode.title}
                </h3>
                <p
                  style={{
                    fontSize: '14px',
                    color: 'var(--color-textSecondary)',
                    lineHeight: 1.55,
                    marginBottom: '14px',
                  }}
                >
                  {mode.tagline}
                </p>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {mode.bullets.map((b) => (
                    <li
                      key={b}
                      style={{
                        fontSize: '13px',
                        color: 'var(--color-textMuted)',
                        lineHeight: 1.5,
                        padding: '3px 0',
                        paddingLeft: '14px',
                        position: 'relative',
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '10px',
                          width: '5px',
                          height: '5px',
                          borderRadius: '50%',
                          background: mode.gradient,
                        }}
                      />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </motion.section>

      {/* ================================================================
          ARCHITECTURE DIAGRAM
          ================================================================ */}
      <motion.section
        style={{ marginBottom: '80px' }}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        variants={sectionReveal}
      >
        <p
          style={{
            fontSize: '13px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--color-textMuted)',
            marginBottom: '8px',
          }}
        >
          Architecture
        </p>
        <h2
          style={{
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--color-text)',
            marginBottom: '12px',
            lineHeight: 1.2,
          }}
        >
          How It Works
        </h2>
        <p
          style={{
            fontSize: '16px',
            color: 'var(--color-textSecondary)',
            lineHeight: 1.65,
            maxWidth: '640px',
            marginBottom: '32px',
          }}
        >
          Every request flows through a multi-stage pipeline: authentication,
          validation, DLP scanning, RAG retrieval, memory injection, prompt
          assembly, and model routing. Tools and agents are invoked on demand.
        </p>

        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '16px',
            overflow: 'hidden',
          }}
        >
          <ReactFlowDiagram
            diagram={architectureDiagram}
            height={580}
            interactive
            showControls
            showMiniMap={false}
          />
        </div>
      </motion.section>

      {/* ================================================================
          CAPABILITIES GRID
          ================================================================ */}
      <motion.section
        style={{ marginBottom: '80px' }}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        variants={sectionReveal}
      >
        <p
          style={{
            fontSize: '13px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--color-textMuted)',
            marginBottom: '8px',
          }}
        >
          Capabilities
        </p>
        <h2
          style={{
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--color-text)',
            marginBottom: '12px',
            lineHeight: 1.2,
          }}
        >
          What It Can Do
        </h2>
        <p
          style={{
            fontSize: '16px',
            color: 'var(--color-textSecondary)',
            lineHeight: 1.65,
            maxWidth: '640px',
            marginBottom: '32px',
          }}
        >
          A unified platform combining large language models with enterprise-grade
          security, tooling, and orchestration.
        </p>

        <motion.div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-40px' }}
          variants={staggerContainer}
        >
          {capabilities.map((cap) => (
            <motion.div
              key={cap.title}
              variants={fadeUpItem}
              whileHover={{ y: -3, transition: { duration: 0.2 } }}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '12px',
                padding: '24px',
                cursor: 'default',
                transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
                position: 'relative',
                overflow: 'hidden',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'var(--color-primary)';
                el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
                const detail = el.querySelector('[data-hover-detail]') as HTMLElement | null;
                if (detail) detail.style.maxHeight = '60px';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = 'var(--color-border)';
                el.style.boxShadow = 'none';
                const detail = el.querySelector('[data-hover-detail]') as HTMLElement | null;
                if (detail) detail.style.maxHeight = '0px';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '10px' }}>
                <div style={{ flexShrink: 0, marginTop: '2px' }}>{cap.iconSvg}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <h4
                      style={{
                        fontSize: '15px',
                        fontWeight: 600,
                        color: 'var(--color-text)',
                        margin: 0,
                      }}
                    >
                      {cap.title}
                    </h4>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        letterSpacing: '0.03em',
                        color: 'var(--color-primary)',
                        background: 'var(--color-surfaceSecondary)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '10px',
                        padding: '2px 8px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cap.badge}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: '13px',
                      color: 'var(--color-textSecondary)',
                      lineHeight: 1.55,
                      margin: 0,
                    }}
                  >
                    {cap.description}
                  </p>
                </div>
              </div>
              {/* Hover-reveal detail */}
              <div
                data-hover-detail
                style={{
                  maxHeight: '0px',
                  overflow: 'hidden',
                  transition: 'max-height 0.3s ease',
                }}
              >
                <p
                  style={{
                    fontSize: '12px',
                    color: 'var(--color-textMuted)',
                    lineHeight: 1.5,
                    margin: 0,
                    paddingTop: '10px',
                    borderTop: '1px solid var(--color-border)',
                    marginTop: '4px',
                  }}
                >
                  {cap.hoverDetail}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </motion.section>

      {/* ================================================================
          AI AGENT TIPS
          ================================================================ */}
      <motion.section
        style={{ marginBottom: '80px' }}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        variants={sectionReveal}
      >
        <p
          style={{
            fontSize: '13px',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--color-textMuted)',
            marginBottom: '8px',
          }}
        >
          AI Assistant
        </p>
        <h2
          style={{
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--color-text)',
            marginBottom: '12px',
            lineHeight: 1.2,
          }}
        >
          Using the Docs Agent
        </h2>
        <p
          style={{
            fontSize: '16px',
            color: 'var(--color-textSecondary)',
            lineHeight: 1.65,
            maxWidth: '640px',
            marginBottom: '24px',
          }}
        >
          The documentation agent can answer questions about any feature, navigate you to
          the right page, and explain complex concepts step by step. Click "Ask AI" in
          the header to get started.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '16px',
          }}
        >
          {[
            { tip: 'Be specific', detail: 'Name the feature, config key, or endpoint you need help with.' },
            { tip: 'Ask about features by name', detail: '"How does the DLP scanner work?" gets better results than vague questions.' },
            { tip: 'Request step-by-step instructions', detail: '"Walk me through setting up MCP tools" gives you actionable guidance.' },
          ].map((item) => (
            <div
              key={item.tip}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '10px',
                padding: '20px',
              }}
            >
              <h4
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  marginBottom: '6px',
                }}
              >
                {item.tip}
              </h4>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--color-textMuted)',
                  lineHeight: 1.5,
                  margin: 0,
                }}
              >
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      </motion.section>

      {/* ================================================================
          ASK THE AKASHIC LIBRARY
          ================================================================ */}
      <motion.section
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        variants={sectionReveal}
      >
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            borderRadius: '20px',
            padding: '56px 40px',
            textAlign: 'center',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          {/* Subtle gradient accent along the top */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3px',
              background: 'linear-gradient(90deg, #7C3AED, #3B82F6, #F59E0B, #FBBF24)',
            }}
          />

          {/* Icon */}
          <div style={{ marginBottom: '20px' }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <defs>
                <linearGradient id="akashicGrad" x1="0" y1="0" x2="40" y2="40">
                  <stop offset="0%" stopColor="#7C3AED" />
                  <stop offset="50%" stopColor="#3B82F6" />
                  <stop offset="100%" stopColor="#F59E0B" />
                </linearGradient>
              </defs>
              <path
                d="M20 4C11.16 4 4 11.16 4 20s7.16 16 16 16 16-7.16 16-16S28.84 4 20 4zm0 28c-6.63 0-12-5.37-12-12S13.37 8 20 8s12 5.37 12 12-5.37 12-12 12z"
                fill="url(#akashicGrad)"
                fillOpacity="0.15"
                stroke="url(#akashicGrad)"
                strokeWidth="1.5"
              />
              <circle cx="20" cy="16" r="2" fill="url(#akashicGrad)" />
              <path d="M20 20v8" stroke="url(#akashicGrad)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>

          <h2
            style={{
              fontSize: '28px',
              fontWeight: 700,
              color: 'var(--color-text)',
              marginBottom: '10px',
              lineHeight: 1.2,
            }}
          >
            Need help? Ask the Akashic Library
          </h2>
          <p
            style={{
              fontSize: '16px',
              color: 'var(--color-textSecondary)',
              lineHeight: 1.6,
              maxWidth: '520px',
              margin: '0 auto 28px',
            }}
          >
            Our AI documentation assistant knows everything about OpenAgentic.
            Ask it anything.
          </p>

          {/* Example question chips */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '10px',
              marginBottom: '32px',
            }}
          >
            {exampleQuestions.map((q) => (
              <span
                key={q}
                style={{
                  fontSize: '13px',
                  color: 'var(--color-textSecondary)',
                  background: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '20px',
                  padding: '8px 16px',
                  lineHeight: 1.4,
                }}
              >
                {q}
              </span>
            ))}
          </div>

          {/* CTA button */}
          <motion.button
            onClick={handleOpenAssistant}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--color-on-accent)',
              background: 'linear-gradient(135deg, var(--user-accent-primary), var(--user-accent-secondary))',
              border: 'none',
              borderRadius: '12px',
              padding: '12px 28px',
              cursor: 'pointer',
              boxShadow: '0 4px 16px color-mix(in srgb, var(--user-accent-primary) 30%, transparent)',
              transition: 'box-shadow 0.3s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow =
                '0 6px 24px color-mix(in srgb, var(--user-accent-primary) 45%, transparent)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow =
                '0 4px 16px color-mix(in srgb, var(--user-accent-primary) 30%, transparent)';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1C4.13 1 1 3.69 1 7c0 1.8 1.02 3.4 2.62 4.47L3 14l3.08-1.54C6.69 12.82 7.33 13 8 13c3.87 0 7-2.69 7-6s-3.13-6-7-6z"
                fill="currentColor"
              />
            </svg>
            Open AI Assistant
          </motion.button>
        </div>
      </motion.section>

      {/* Site link footer */}
      <footer
        style={{
          marginTop: '64px',
          paddingTop: '24px',
          borderTop: '1px solid var(--color-border)',
          textAlign: 'center',
        }}
      >
        <a
          href="https://openagentic.io"
          target="_blank"
          rel="noreferrer noopener"
          style={{
            fontSize: '13px',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            color: 'var(--color-primary)',
            textDecoration: 'none',
            letterSpacing: '0.04em',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.textDecoration = 'underline';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.textDecoration = 'none';
          }}
        >
          openagentic.io
        </a>
      </footer>
    </div>
  );
};

export default WelcomePage;
