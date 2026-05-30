import React from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';

// ============================================================================
// INLINE SVG ICONS
// ============================================================================

const ProtocolIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="protoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#eab308" />
      </linearGradient>
    </defs>
    <circle cx="5" cy="12" r="3" stroke="url(#protoGrad)" strokeWidth="2" />
    <circle cx="19" cy="12" r="3" stroke="url(#protoGrad)" strokeWidth="2" />
    <line x1="8" y1="12" x2="16" y2="12" stroke="url(#protoGrad)" strokeWidth="2" strokeDasharray="3 2" />
    <circle cx="12" cy="5" r="3" stroke="url(#protoGrad)" strokeWidth="2" />
    <line x1="12" y1="8" x2="12" y2="10" stroke="url(#protoGrad)" strokeWidth="2" />
  </svg>
);

const SearchPipeIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="searchPipeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#3b82f6" />
      </linearGradient>
    </defs>
    <circle cx="11" cy="11" r="7" stroke="url(#searchPipeGrad)" strokeWidth="2" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="url(#searchPipeGrad)" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M8 11h6" stroke="url(#searchPipeGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    <path d="M11 8v6" stroke="url(#searchPipeGrad)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
  </svg>
);

// ============================================================================
// DIAGRAMS
// ============================================================================

const mcpArchDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'MCP Architecture',
  description: 'How LLMs connect to external tools',
  layout: 'horizontal',
  nodes: [
    { id: 'llm', label: 'LLM', description: 'Language model', shape: 'rounded', color: 'purple' },
    { id: 'router', label: 'MCP Router', description: 'Tool selection', shape: 'rounded', color: 'blue' },
    { id: 'azure', label: 'Azure MCP', shape: 'rounded', color: 'azure' },
    { id: 'aws', label: 'AWS MCP', shape: 'rounded', color: 'aws' },
    { id: 'k8s', label: 'K8s MCP', shape: 'rounded', color: 'kubernetes' },
    { id: 'github', label: 'GitHub MCP', shape: 'rounded', color: 'gray' },
  ],
  edges: [
    { source: 'llm', target: 'router', label: 'Tool call', animated: true },
    { source: 'router', target: 'azure' },
    { source: 'router', target: 'aws' },
    { source: 'router', target: 'k8s' },
    { source: 'router', target: 'github' },
  ],
};

const selectionDiagram: DiagramDefinition = {
  type: 'flowchart',
  title: 'Semantic Tool Selection Pipeline',
  description: 'pgvector -> Milvus -> Redis fallback',
  layout: 'horizontal',
  nodes: [
    { id: 'query', label: 'User Query', shape: 'rounded', color: 'blue' },
    { id: 'embed', label: 'Embed', description: 'Generate vector', shape: 'rounded', color: 'purple' },
    { id: 'pg', label: 'pgvector', description: 'HNSW index', shape: 'database', color: 'blue' },
    { id: 'milvus', label: 'Milvus', description: 'GPU-accelerated', shape: 'database', color: 'cyan' },
    { id: 'redis', label: 'Redis', description: 'Cache layer', shape: 'database', color: 'red' },
    { id: 'rank', label: 'Rank & Select', description: 'Top-K tools', shape: 'rounded', color: 'green' },
  ],
  edges: [
    { source: 'query', target: 'embed', animated: true },
    { source: 'embed', target: 'pg', label: 'Primary' },
    { source: 'pg', target: 'milvus', label: 'Miss', style: 'dashed' },
    { source: 'milvus', target: 'redis', label: 'Miss', style: 'dashed' },
    { source: 'pg', target: 'rank', label: 'Hit', color: 'green' },
    { source: 'milvus', target: 'rank', label: 'Hit', color: 'green' },
    { source: 'redis', target: 'rank', label: 'Hit', color: 'green' },
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

const WhatIsMcpPage: React.FC = () => {
  const mcpConcepts = [
    {
      term: 'MCP Server',
      definition: 'A service that exposes tools following the Model Context Protocol specification. Each server manages a specific domain (cloud provider, observability tool, etc.).',
    },
    {
      term: 'Tool',
      definition: 'A single callable function exposed by an MCP server. Tools have typed input schemas, descriptions for the LLM, and defined output formats.',
    },
    {
      term: 'Tool Call',
      definition: 'When the LLM decides to use a tool, it generates a structured tool call with the function name and arguments. The platform executes it and returns the result.',
    },
    {
      term: 'Tool Selection',
      definition: 'The process of choosing which tools to present to the LLM for a given query. OpenAgentic uses semantic search over tool descriptions to find the most relevant tools.',
    },
    {
      term: 'OAT (On-demand Agent Tooling)',
      definition: 'A system for dynamically synthesizing new tools at runtime. When no existing tool matches the need, OAT can generate a tool definition and implementation on the fly.',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--color-text)' }}>
          What is MCP?
        </h1>
        <p className="text-lg leading-relaxed mb-10" style={{ color: 'var(--color-textSecondary)' }}>
          The Model Context Protocol (MCP) is an open standard for connecting AI models to external
          tools and data sources. It provides a uniform interface for tool discovery, invocation, and
          result handling -- regardless of the underlying service.
        </p>
      </motion.div>

      {/* Architecture */}
      <motion.section custom={1} variants={sectionVariants} initial="hidden" animate="visible" className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <ProtocolIcon />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            How It Works
          </h2>
        </div>
        <p className="mb-6 leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
          When a user sends a message, the LLM may decide it needs external data or actions. It
          generates a tool call, which the MCP router dispatches to the appropriate server. The
          server executes the operation and returns structured results back to the LLM.
        </p>
        <ReactFlowDiagram diagram={mcpArchDiagram} height={340} />
      </motion.section>

      {/* Key Concepts */}
      <motion.section custom={2} variants={sectionVariants} initial="hidden" animate="visible" className="mb-10">
        <h2 className="text-xl font-semibold mb-6" style={{ color: 'var(--color-text)' }}>
          Key Concepts
        </h2>
        <div className="space-y-4">
          {mcpConcepts.map((item, i) => (
            <motion.div
              key={item.term}
              custom={i + 3}
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
              className="rounded-lg p-4"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                {item.term}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                {item.definition}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Semantic Tool Selection */}
      <motion.section custom={8} variants={sectionVariants} initial="hidden" animate="visible">
        <div className="flex items-center gap-3 mb-4">
          <SearchPipeIcon />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            Semantic Tool Selection
          </h2>
        </div>
        <p className="mb-6 leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
          With hundreds of tools available, presenting all of them to the LLM is impractical and
          expensive. Instead, OpenAgentic uses vector similarity search to find the most relevant
          tools for each query. The search pipeline has three tiers with automatic fallback.
        </p>
        <ReactFlowDiagram diagram={selectionDiagram} height={340} />
      </motion.section>
    </div>
  );
};

export default WhatIsMcpPage;
