/**
 * ArtifactsPage - Comprehensive documentation for interactive AI artifacts.
 *
 * Covers artifact types (HTML, React, SVG), live streaming, security model,
 * toolbar controls, and use cases with interactive examples.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { DocsCodeIcon } from '../components/DocsIcons';
import DocsScreenshot from '../components/DocsScreenshot';

// ============================================================================
// DATA
// ============================================================================

const artifactTypes = [
  {
    type: 'artifact:html',
    label: 'HTML',
    description:
      'Complete HTML/CSS/JS applications rendered in a sandboxed iframe. The AI generates self-contained HTML documents that can include inline styles, scripts, and external CDN libraries. Ideal for dashboards, calculators, interactive forms, and data visualizations.',
    examples: ['Interactive dashboards', 'Calculator apps', 'Survey forms', 'Data tables with filtering'],
  },
  {
    type: 'artifact:react',
    label: 'React',
    description:
      'React components compiled and rendered on-the-fly in an isolated environment. The AI generates JSX with hooks, state management, and component composition. Supports common libraries like recharts, d3, and framer-motion.',
    examples: ['Chart components', 'Stateful widgets', 'Interactive tutorials', 'Component previews'],
  },
  {
    type: 'artifact:svg',
    label: 'SVG',
    description:
      'Scalable vector graphics for diagrams, icons, illustrations, and technical drawings. Generated as inline SVG markup with full support for gradients, animations, filters, and interactivity via embedded scripts.',
    examples: ['Architecture diagrams', 'Infographics', 'Animated illustrations', 'Technical drawings'],
  },
];

const securityRules = [
  { rule: 'Sandboxed iframe', detail: 'All artifacts render in an iframe with sandbox="allow-scripts allow-forms". This prevents access to the parent page DOM, cookies, and storage.' },
  { rule: 'No cross-origin access', detail: 'The iframe cannot make requests to the parent origin or access cross-origin resources unless explicitly allowed via CORS headers on the target.' },
  { rule: 'No popups or navigation', detail: 'The sandbox disallows popups (allow-popups is not set) and prevents the iframe from navigating the top-level page.' },
  { rule: 'Content Security Policy', detail: 'A strict CSP header is applied to artifact content, limiting script sources and preventing inline event handlers from executing arbitrary code.' },
  { rule: 'No persistent storage', detail: 'Artifacts cannot use localStorage, sessionStorage, or IndexedDB. Each render starts with a clean slate.' },
];

const toolbarActions = [
  { action: 'Expand / Collapse', description: 'Toggle between inline and full-screen artifact view. Full-screen provides maximum space for complex visualizations.' },
  { action: 'Code / Preview', description: 'Switch between the rendered artifact and the raw source code. Useful for inspecting and learning from the generated code.' },
  { action: 'Copy', description: 'Copy the artifact source code to the clipboard. Works for HTML, React, and SVG content.' },
  { action: 'Refresh', description: 'Re-render the artifact from its source. Useful if the artifact has internal state that needs resetting.' },
  { action: 'Open in new tab', description: 'Open the artifact in a standalone browser tab. The artifact runs with the same sandbox restrictions applied.' },
];

const useCases = [
  {
    title: 'Dashboards',
    description: 'Ask the AI to create a metrics dashboard from your data. It generates an interactive HTML artifact with charts, KPI cards, and filters — all in a single response.',
  },
  {
    title: 'Calculators and Tools',
    description: 'Financial calculators, unit converters, estimation tools — the AI generates fully functional web apps that run directly in the chat.',
  },
  {
    title: 'Games and Simulations',
    description: 'Simple games (tic-tac-toe, memory, snake) and physics simulations that demonstrate concepts interactively.',
  },
  {
    title: 'Data Visualization',
    description: 'Bar charts, scatter plots, heatmaps, and geographic maps generated from raw data. The AI selects the appropriate chart type and formats labels automatically.',
  },
  {
    title: 'Interactive Forms',
    description: 'Multi-step forms with validation, conditional fields, and calculated results. Useful for surveys, intake forms, and configuration wizards.',
  },
  {
    title: 'Educational Content',
    description: 'Interactive tutorials, quizzes, and step-by-step walkthroughs that teach concepts through hands-on exploration.',
  },
];

// ============================================================================
// STYLES
// ============================================================================

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  textTransform: 'uppercase',
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

const proseStyle: React.CSSProperties = {
  fontSize: '15px',
  color: 'var(--color-textSecondary)',
  lineHeight: 1.7,
  maxWidth: '680px',
};

// ============================================================================
// COMPONENT
// ============================================================================

const ArtifactsPage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    {/* HEADER */}
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ marginBottom: '56px' }}
    >
      <div style={{ marginBottom: '20px' }}>
        <DocsCodeIcon size={40} />
      </div>
      <h1
        style={{
          fontSize: '36px',
          fontWeight: 700,
          color: 'var(--color-text)',
          marginBottom: '16px',
          letterSpacing: '-0.02em',
        }}
      >
        Artifacts
      </h1>
      <p style={proseStyle}>
        Artifacts are interactive HTML, React, and SVG applications generated by the AI
        directly within chat responses. They go beyond plain text to deliver live dashboards,
        calculators, games, data visualizations, and interactive forms — all rendered inline
        in the conversation and streaming as they are generated.
      </p>
    </motion.div>

    {/* WHAT ARE ARTIFACTS */}
    <motion.section
      style={{ marginBottom: '64px' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1, duration: 0.5 }}
    >
      <p style={sectionHeadingStyle}>Overview</p>
      <h2 style={sectionTitleStyle}>What Are Artifacts?</h2>
      <p style={{ ...proseStyle, marginBottom: '24px' }}>
        When the AI determines that a task is best served by a visual, interactive result
        rather than plain text, it generates an artifact. Artifacts are self-contained
        applications that render in a sandboxed iframe within the chat interface.
        Users can interact with them, view the source code, expand to full screen,
        and open them in a new tab.
      </p>
      <p style={proseStyle}>
        Since v0.3.0, artifacts render progressively as the AI streams its response.
        You see the HTML or React code appear and the preview update in real-time,
        providing immediate visual feedback even for complex generated applications.
      </p>
    </motion.section>

    {/* ARTIFACT TYPES */}
    <motion.section
      style={{ marginBottom: '64px' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15, duration: 0.5 }}
    >
      <p style={sectionHeadingStyle}>Types</p>
      <h2 style={sectionTitleStyle}>Three Artifact Types</h2>
      <p style={{ ...proseStyle, marginBottom: '28px' }}>
        Each artifact type is identified by a content-type prefix in the AI response.
        The frontend detects this prefix and routes the content to the appropriate renderer.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {artifactTypes.map((artifact) => (
          <div
            key={artifact.type}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              padding: '24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              <h3
                style={{
                  fontSize: '17px',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                }}
              >
                {artifact.label}
              </h3>
              <code
                style={{
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--color-textMuted)',
                  background: 'var(--color-surfaceSecondary)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--color-border)',
                }}
              >
                {artifact.type}
              </code>
            </div>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--color-textSecondary)',
                lineHeight: 1.65,
                marginBottom: '12px',
              }}
            >
              {artifact.description}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {artifact.examples.map((ex) => (
                <span
                  key={ex}
                  style={{
                    fontSize: '11px',
                    color: 'var(--color-textMuted)',
                    background: 'var(--color-surfaceSecondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '4px',
                    padding: '3px 8px',
                  }}
                >
                  {ex}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </motion.section>

    {/* LIVE STREAMING */}
    <motion.section
      style={{ marginBottom: '64px' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.5 }}
    >
      <p style={sectionHeadingStyle}>Streaming</p>
      <h2 style={sectionTitleStyle}>Live Streaming Render</h2>
      <p style={{ ...proseStyle, marginBottom: '24px' }}>
        Since v0.3.0, artifacts stream to the browser as the AI generates them.
        The frontend maintains a live preview that updates with each token, so
        users see the artifact take shape in real-time. This provides immediate
        feedback and makes the generation process transparent.
      </p>
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '12px',
          padding: '20px 24px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            { step: '1', text: 'AI response starts streaming via SSE' },
            { step: '2', text: 'Frontend detects artifact content-type prefix' },
            { step: '3', text: 'Sandbox iframe is created and connected to stream' },
            { step: '4', text: 'HTML/JSX tokens are appended to the iframe document in real-time' },
            { step: '5', text: 'Artifact renders progressively as code arrives' },
            { step: '6', text: 'Stream completes; toolbar becomes fully active' },
          ].map((item) => (
            <div
              key={item.step}
              style={{
                display: 'flex',
                gap: '14px',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: '24px',
                  height: '24px',
                  borderRadius: '6px',
                  background: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: 'var(--color-textMuted)',
                }}
              >
                {item.step}
              </div>
              <span
                style={{
                  fontSize: '13px',
                  color: 'var(--color-textSecondary)',
                }}
              >
                {item.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </motion.section>

    {/* SECURITY MODEL */}
    <motion.section
      style={{ marginBottom: '64px' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.25, duration: 0.5 }}
    >
      <p style={sectionHeadingStyle}>Security</p>
      <h2 style={sectionTitleStyle}>Security Model</h2>
      <p style={{ ...proseStyle, marginBottom: '28px' }}>
        AI-generated code running in the browser requires strict isolation. All artifacts
        execute within a sandboxed iframe with limited permissions. The sandbox attribute
        allows scripts and forms but blocks everything else by default.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {securityRules.map((rule, i) => (
          <div
            key={rule.rule}
            style={{
              display: 'flex',
              gap: '16px',
              padding: '16px 20px',
              background: i % 2 === 0 ? 'var(--color-surface)' : 'transparent',
              borderRadius: '10px',
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: 'var(--color-primary)',
                marginTop: '7px',
              }}
            />
            <div>
              <h4
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  marginBottom: '4px',
                }}
              >
                {rule.rule}
              </h4>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--color-textSecondary)',
                  lineHeight: 1.6,
                }}
              >
                {rule.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </motion.section>

    {/* TOOLBAR */}
    <motion.section
      style={{ marginBottom: '64px' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3, duration: 0.5 }}
    >
      <p style={sectionHeadingStyle}>Controls</p>
      <h2 style={sectionTitleStyle}>Artifact Toolbar</h2>
      <p style={{ ...proseStyle, marginBottom: '28px' }}>
        Each artifact includes a toolbar with controls for interacting with the
        generated content. The toolbar appears above the artifact preview.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: '12px',
        }}
      >
        {toolbarActions.map((item) => (
          <div
            key={item.action}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '10px',
              padding: '18px 20px',
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
              {item.action}
            </h4>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--color-textSecondary)',
                lineHeight: 1.55,
              }}
            >
              {item.description}
            </p>
          </div>
        ))}
      </div>
    </motion.section>

    {/* USE CASES */}
    <motion.section
      style={{ marginBottom: '64px' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.35, duration: 0.5 }}
    >
      <p style={sectionHeadingStyle}>Applications</p>
      <h2 style={sectionTitleStyle}>Use Cases</h2>
      <p style={{ ...proseStyle, marginBottom: '28px' }}>
        Artifacts turn the chat interface into a creative workspace. Here are
        some common ways users leverage artifact generation.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '14px',
        }}
      >
        {useCases.map((uc) => (
          <div
            key={uc.title}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
              padding: '24px',
            }}
          >
            <h3
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--color-text)',
                marginBottom: '8px',
              }}
            >
              {uc.title}
            </h3>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--color-textSecondary)',
                lineHeight: 1.6,
              }}
            >
              {uc.description}
            </p>
          </div>
        ))}
      </div>
    </motion.section>

    {/* SCREENSHOT (if available) */}
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.4, duration: 0.5 }}
    >
      <p style={sectionHeadingStyle}>Preview</p>
      <h2 style={sectionTitleStyle}>Artifacts in Action</h2>
      <p style={{ ...proseStyle, marginBottom: '24px' }}>
        Below is an example of the chat interface with an artifact rendered inline.
        The artifact toolbar is visible above the preview panel.
      </p>
      <DocsScreenshot
        src="/docs/screenshots/chat-conversation.png"
        alt="Chat interface showing an inline artifact with the artifact toolbar"
        caption="A conversation with an interactive HTML artifact rendered inline. The toolbar provides expand, code view, copy, refresh, and open-in-new-tab controls."
        maxWidth={800}
      />
    </motion.section>
  </div>
);

export default ArtifactsPage;
