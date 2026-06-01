import React from 'react';
import { motion } from 'framer-motion';
import { DocsBookIcon } from '../components/DocsIcons';

const steps = [
  {
    number: '1',
    title: 'Sign In',
    body: 'Navigate to the OpenAgentic URL provided by your administrator. Sign in using your corporate SSO credentials (Microsoft Entra ID, Google Workspace, or OIDC). First-time users are automatically provisioned with default permissions.',
  },
  {
    number: '2',
    title: 'Choose Your Mode',
    body: 'Select Chat for conversational AI, Code for a browser-based IDE with AI pair programming, or Flows for visual workflow automation. You can switch between modes at any time from the navigation bar.',
  },
  {
    number: '3',
    title: 'Set Your Intelligence Level',
    body: 'Use the intelligence slider to control the cost/quality tradeoff. Start in the middle for balanced performance. Slide left for fast, inexpensive responses; slide right for maximum reasoning quality.',
  },
  {
    number: '4',
    title: 'Start a Conversation',
    body: 'Type a message in the chat input. The system automatically selects the best model, retrieves relevant context, and delegates to specialist agents when needed. Tools like web search, code execution, and cloud APIs are available automatically.',
  },
  {
    number: '5',
    title: 'Explore Tools and Agents',
    body: 'Ask the AI to use specific tools ("search the web for...", "check our Kubernetes pods", "analyze this CSV"). The platform has 14 MCP tool servers and 11 agent types available. Mention what you need and the system matches the right tool.',
  },
];

const QuickStartPage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ marginBottom: '56px' }}
    >
      <div style={{ marginBottom: '20px' }}><DocsBookIcon size={40} /></div>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        Quick Start
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        Get productive with OpenAgentic in five minutes. This guide walks you through
        signing in, choosing a mode, and sending your first AI-powered request.
      </p>
    </motion.div>

    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {steps.map((step, i) => (
        <motion.div
          key={step.number}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + i * 0.06, duration: 0.35 }}
          style={{
            display: 'flex',
            gap: '20px',
            padding: '24px',
            background: i % 2 === 0 ? 'var(--color-surface)' : 'transparent',
            borderRadius: '12px',
          }}
        >
          <div
            style={{
              flexShrink: 0,
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'var(--color-surfaceSecondary)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--color-primary)',
            }}
          >
            {step.number}
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '6px' }}>
              {step.title}
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--color-textSecondary)', lineHeight: 1.65 }}>
              {step.body}
            </p>
          </div>
        </motion.div>
      ))}
    </div>
  </div>
);

export default QuickStartPage;
