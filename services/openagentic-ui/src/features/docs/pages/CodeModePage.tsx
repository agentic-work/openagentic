import React from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsCodeIcon } from '../components/DocsIcons';

const ideDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'Code Mode — Three-Panel Layout',
  layout: 'horizontal',
  nodes: [
    { id: 'explorer', label: 'File Explorer', description: 'Project tree', shape: 'rounded', color: 'blue' },
    { id: 'editor', label: 'Code Editor', description: 'Monaco editor', shape: 'rounded', color: 'green' },
    { id: 'ai-panel', label: 'AI Assistant', description: 'Chat + suggestions', shape: 'rounded', color: 'purple' },
    { id: 'terminal', label: 'Terminal', description: 'Shell access', shape: 'rounded', color: 'gray' },
    { id: 'sandbox', label: 'K8s Sandbox', description: 'Isolated runtime', shape: 'server', color: 'kubernetes' },
  ],
  edges: [
    { source: 'explorer', target: 'editor', label: 'open file' },
    { source: 'editor', target: 'ai-panel', label: 'context', style: 'dashed' },
    { source: 'ai-panel', target: 'editor', label: 'apply edit', style: 'dashed' },
    { source: 'terminal', target: 'sandbox', animated: true },
    { source: 'editor', target: 'sandbox', label: 'run', style: 'dashed' },
  ],
};

const panels = [
  { title: 'File Explorer', desc: 'A project tree showing all files in the workspace. Supports file creation, renaming, deletion, drag-and-drop, and multi-file selection. The tree updates in real-time as the AI modifies files.' },
  { title: 'Code Editor', desc: 'A full-featured Monaco editor (the same engine as VS Code) with syntax highlighting for 50+ languages, intelligent autocomplete, multi-cursor editing, find-and-replace, and minimap navigation. The AI can apply edits directly to open files.' },
  { title: 'AI Assistant Panel', desc: 'A chat interface contextually aware of the current file, selection, and project structure. Ask questions about the code, request refactoring, generate tests, or describe features and let the AI implement them.' },
  { title: 'Integrated Terminal', desc: 'A web-based terminal connected to the Kubernetes sandbox. Run builds, tests, scripts, and commands with full shell access. Output is captured and available to the AI for debugging.' },
];

const CodeModePage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
      <div style={{ marginBottom: '20px' }}><DocsCodeIcon size={40} /></div>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        IDE Interface
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        Code Mode provides a browser-based development environment with AI pair programming.
        The three-panel layout gives you a file explorer, a Monaco code editor, and an AI
        assistant panel — all connected to an isolated Kubernetes sandbox for safe execution.
      </p>
    </motion.div>

    <motion.section style={{ marginBottom: '56px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
      <ReactFlowDiagram diagram={ideDiagram} height={340} interactive showControls />
    </motion.section>

    <motion.section style={{ marginBottom: '56px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px' }}>Panel Details</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {panels.map((p) => (
          <div key={p.title} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '20px 24px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '6px' }}>{p.title}</h3>
            <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.65 }}>{p.desc}</p>
          </div>
        ))}
      </div>
    </motion.section>

    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px' }}>AI Capabilities in Code Mode</h2>
      <p style={{ fontSize: '14px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px', marginBottom: '20px' }}>
        The AI assistant understands your entire project context. It reads open files, follows imports,
        and understands the project structure. Key capabilities include:
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
        {[
          { title: 'Code Generation', body: 'Describe a feature in natural language and the AI generates the implementation across multiple files.' },
          { title: 'Refactoring', body: 'Select code and ask for refactoring. The AI understands patterns and can extract functions, rename variables, and restructure code.' },
          { title: 'Bug Diagnosis', body: 'Paste an error or describe a bug. The AI reads the relevant code, traces the issue, and suggests fixes.' },
          { title: 'Test Generation', body: 'Point the AI at a function or module and it generates comprehensive unit and integration tests.' },
        ].map((c) => (
          <div key={c.title} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '18px 20px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '4px' }}>{c.title}</h4>
            <p style={{ fontSize: '12px', color: 'var(--color-textSecondary)', lineHeight: 1.6 }}>{c.body}</p>
          </div>
        ))}
      </div>
    </motion.section>
  </div>
);

export default CodeModePage;
