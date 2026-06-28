import React from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsAgentIcon } from '../components/DocsIcons';

const delegationDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'Multi-Agent Orchestration',
  description: 'The orchestrator analyzes intent and delegates to specialists',
  layout: 'vertical',
  nodes: [
    { id: 'user', label: 'User Message', shape: 'rounded', color: 'primary' },
    { id: 'orch', label: 'Orchestrator', description: 'Intent analysis', shape: 'rounded', color: 'primary' },
    { id: 'data_query', label: 'data_query', description: 'Dataset queries', shape: 'rounded', color: 'cyan' },
    { id: 'data_extraction', label: 'data_extraction', description: 'Extract/filter data', shape: 'rounded', color: 'blue' },
    { id: 'tool_orchestration', label: 'tool_orchestration', description: 'Tool selection', shape: 'rounded', color: 'orange' },
    { id: 'reasoning', label: 'reasoning', description: 'Multi-step reasoning', shape: 'rounded', color: 'purple' },
    { id: 'summarization', label: 'summarization', description: 'Content summarization', shape: 'rounded', color: 'green' },
    { id: 'code_execution', label: 'code_execution', description: 'Code gen/execution', shape: 'rounded', color: 'green' },
    { id: 'planning', label: 'planning', description: 'Task breakdown', shape: 'rounded', color: 'indigo' },
    { id: 'validation', label: 'validation', description: 'Output validation', shape: 'rounded', color: 'red' },
    { id: 'synthesis', label: 'synthesis', description: 'Final synthesis', shape: 'rounded', color: 'blue' },
    { id: 'artifact_creation', label: 'artifact_creation', description: 'Visual artifacts', shape: 'rounded', color: 'pink' },
    { id: 'synth', label: 'Response Synthesis', description: 'Merge results', shape: 'rounded', color: 'primary' },
  ],
  edges: [
    { source: 'user', target: 'orch', animated: true },
    { source: 'orch', target: 'data_query', style: 'dashed' },
    { source: 'orch', target: 'data_extraction', style: 'dashed' },
    { source: 'orch', target: 'tool_orchestration', style: 'dashed' },
    { source: 'orch', target: 'reasoning', style: 'dashed' },
    { source: 'orch', target: 'summarization', style: 'dashed' },
    { source: 'orch', target: 'code_execution', style: 'dashed' },
    { source: 'orch', target: 'planning', style: 'dashed' },
    { source: 'orch', target: 'validation', style: 'dashed' },
    { source: 'orch', target: 'synthesis', style: 'dashed' },
    { source: 'orch', target: 'artifact_creation', style: 'dashed' },
    { source: 'data_query', target: 'synth', color: 'cyan' },
    { source: 'data_extraction', target: 'synth', color: 'blue' },
    { source: 'tool_orchestration', target: 'synth', color: 'orange' },
    { source: 'reasoning', target: 'synth', color: 'purple' },
    { source: 'summarization', target: 'synth', color: 'green' },
    { source: 'code_execution', target: 'synth', color: 'green' },
    { source: 'planning', target: 'synth', color: 'indigo' },
    { source: 'validation', target: 'synth', color: 'red' },
    { source: 'synthesis', target: 'synth', color: 'blue' },
    { source: 'artifact_creation', target: 'synth', color: 'pink' },
  ],
};

const AgentDelegationPage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
      <div style={{ marginBottom: '20px' }}><DocsAgentIcon size={40} /></div>
      <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        Agents and Delegation
      </h1>
      <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
        OpenAgentic uses a multi-agent architecture where a primary orchestrator analyzes each
        request and delegates to one or more specialist agents. Each specialist has a tuned
        system prompt, curated tool access, and domain expertise. All agents use the SmartRouter
        for model selection. The delegation is transparent to the user — results are synthesized into a single coherent response.
      </p>
    </motion.div>

    <motion.section style={{ marginBottom: '56px' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.5 }}>
      <ReactFlowDiagram diagram={delegationDiagram} height={560} interactive showControls />
    </motion.section>

    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.5 }}>
      <h2 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px' }}>How Delegation Works</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {[
          { title: 'Intent Analysis', body: 'The orchestrator examines the user message, conversation history, and any tool results to determine which specialist(s) would handle the request best.' },
          { title: 'Parallel Delegation', body: 'For complex requests, the orchestrator can delegate to multiple agents simultaneously. A request like "analyze this data and summarize findings" spawns both the data_query and summarization agents in parallel.' },
          { title: 'Tool Inheritance', body: 'Each agent has its own curated tool set. The code_execution agent gets file system and GitHub tools; the tool_orchestration agent gets access to all available MCP tools. This prevents tool confusion and improves accuracy.' },
          { title: 'Response Synthesis', body: 'When multiple agents return results, the orchestrator merges them into a unified response. It resolves conflicts, ensures consistency, and presents the information in a coherent structure.' },
        ].map((item) => (
          <div key={item.title} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '20px 24px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '6px' }}>{item.title}</h4>
            <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.6 }}>{item.body}</p>
          </div>
        ))}
      </div>
    </motion.section>
  </div>
);

export default AgentDelegationPage;
