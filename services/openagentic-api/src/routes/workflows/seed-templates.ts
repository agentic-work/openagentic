/**
 * Built-in workflow templates + the seeding routines.
 *
 * Exposes:
 *   - SEED_WORKFLOW_TEMPLATES  — the curated template table
 *   - autoSeedWorkflowTemplates() — startup idempotent seeder (called from
 *     server.ts / startup/04-providers.ts)
 *   - seedTemplatesRoutes plugin — POST /seed-templates (manual seed)
 *
 * Sub-plugin of workflowRoutes; auth applied by the parent preHandler hook.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';
import { asJson, getReqUser } from './shared.js';
import type { FlowEdge, FlowNode } from './types.js';

// =============================================================================
// Built-in Workflow Templates for Seeding
// =============================================================================
// 8 curated templates that use ONLY confirmed-working node types with deployed
// infrastructure. All node types used: trigger, openagentic_llm, mcp_tool,
// condition, merge, transform, loop, http_request, human_approval, multi_agent,
// agent_single, rag_query — all implemented in WorkflowExecutionEngine.ts.

export interface SeedTemplate {
  name: string;
  description: string;
  icon: string;
  category: string;
  tags: string[];
  color?: string;
  definition: { nodes: FlowNode[]; edges: FlowEdge[] };
}

const X = 250; // horizontal spacing
const Y = 150; // vertical spacing

export const SEED_WORKFLOW_TEMPLATES: SeedTemplate[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // 1. Multi-Agent Research Team (grounded)
  // Uses: trigger, mcp_tool(web_search_and_read), multi_agent, merge,
  //       openagentic_llm, grounding_check
  //
  // Grounding-first design: a real web_search fires BEFORE the agents so they
  // analyze actually-fetched sources, then grounding_check verifies the report
  // against those sources. The trigger declares ONE required input (`topic`).
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Multi-Agent Research Team',
    description: 'Runs a real web search, then three specialized agents (researcher, analyst, critic) analyze the actually-fetched sources, synthesize a report with verifiable links, and a grounding check verifies every claim against the real sources — no fabrication.',
    icon: 'Bot',
    category: 'ai-analysis',
    tags: ['multi-agent', 'research', 'ai-analysis'],
    color: '#7c3aed',
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'trigger',
          position: { x: 0, y: Y },
          data: {
            label: 'Research Topic',
            triggerType: 'manual',
            icon: 'Play',
            color: '#ff9800',
            inputs: [
              {
                name: 'topic',
                label: 'Research Topic',
                type: 'string',
                required: true,
                placeholder: 'e.g., Post-quantum cryptography readiness for enterprises',
                description: 'What should the research team investigate? Be specific.',
              },
            ],
          },
        },
        {
          // DETERMINISTIC grounding: a real web search fires BEFORE the agents,
          // so they analyze actually-fetched sources instead of fabricating.
          // The old design only *told* the agents to search (they never did —
          // multi_agent ships them no tools), so reports were 100% invented.
          id: 'search',
          type: 'mcp_tool',
          position: { x: X * 0.6, y: Y },
          data: {
            label: 'Web Search (real sources)',
            icon: 'Globe',
            color: '#06b6d4',
            toolName: 'web_search_and_read',
            toolServer: 'openagentic_web',
            arguments: { query: '{{trigger.topic}}', num_results: 4 },
          },
        },
        {
          id: 'multi-research',
          type: 'multi_agent',
          position: { x: X, y: Y },
          data: {
            label: 'Research Team (grounded)',
            icon: 'Users',
            color: '#7c3aed',
            pattern: 'parallel',
            agents: [
              {
                role: 'researcher',
                taskDescription:
                  'You are the RESEARCHER. Below are REAL web search results (titles, URLs, and fetched page content) for the topic. Extract the key verifiable facts. Every fact MUST be traceable to one of these sources — quote the exact URL after each fact. If the sources do not answer something, say "not found in sources" — do NOT use prior knowledge or invent anything.\n\nTOPIC: {{trigger.topic}}\n\nREAL SOURCES:\n{{steps.search.output}}',
              },
              {
                role: 'analyst',
                taskDescription:
                  'You are the ANALYST. Using ONLY the REAL web sources below, identify trends, comparisons, and what the evidence supports. Cite the exact URL for every claim. Flag anything the sources disagree on. Never use outside knowledge.\n\nTOPIC: {{trigger.topic}}\n\nREAL SOURCES:\n{{steps.search.output}}',
              },
              {
                role: 'critic',
                taskDescription:
                  'You are the CRITIC/FACT-CHECKER. For each notable claim derivable from the REAL sources below, state whether it is well-supported, weakly supported, or unsupported BY THESE SOURCES, with the URL. Explicitly call out anything that would be a hallucination if asserted (not present in the sources).\n\nTOPIC: {{trigger.topic}}\n\nREAL SOURCES:\n{{steps.search.output}}',
              },
            ],
            strategy: 'parallel',
          },
        },
        {
          id: 'merge-findings',
          type: 'merge',
          position: { x: X * 2, y: Y },
          data: { label: 'Merge Findings', icon: 'GitMerge', color: '#9c27b0', strategy: 'combine' },
        },
        {
          id: 'llm-synthesize',
          type: 'openagentic_llm',
          position: { x: X * 3, y: Y },
          data: {
            label: 'Synthesize Report',
            icon: 'Brain',
            color: '#7c4dff',
            prompt:
              'Write a research report on "{{trigger.topic}}" using ONLY the grounded agent findings below. Every claim must cite a real source URL drawn from the findings. Include: Executive Summary, Key Findings (each with its source URL), Analysis, and Open Questions. If the sources are insufficient, say so plainly — do NOT fabricate.\n\nGROUNDED FINDINGS:\n{{steps.merge-findings.output}}',
          },
        },
        {
          // REAL grounding: verify the synthesized report against the
          // actually-fetched web content (not another LLM output). Flags any
          // entity/claim that appears in the report but not in the sources.
          id: 'ground',
          type: 'grounding_check',
          position: { x: X * 4, y: Y },
          data: {
            label: 'Grounding Check (vs real sources)',
            icon: 'ShieldCheck',
            color: '#16a34a',
            claim: '{{steps.llm-synthesize.output}}',
            groundTruth: '{{steps.search.output}}',
          },
        },
        {
          id: 'llm-finalize',
          type: 'openagentic_llm',
          position: { x: X * 5, y: Y },
          data: {
            label: 'Final Report + Sources',
            icon: 'FileCheck',
            color: '#7c4dff',
            prompt:
              'Produce the FINAL Markdown report from:\n{{steps.llm-synthesize.output}}\n\nGrounding analysis: {{steps.ground.output}}\n\nAppend a "## Sources" section listing every real URL cited (from the search results), and a "## Grounding" section stating the score and that all claims were checked against the actually-fetched web sources. If grounding flagged unfounded items, list them as caveats.',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'search', animated: true },
        { id: 'e2', source: 'search', target: 'multi-research', animated: true },
        { id: 'e3', source: 'multi-research', target: 'merge-findings', animated: true },
        { id: 'e4', source: 'merge-findings', target: 'llm-synthesize', animated: true },
        { id: 'e5', source: 'llm-synthesize', target: 'ground', animated: true },
        { id: 'e6', source: 'ground', target: 'llm-finalize', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 2. RAG Knowledge Pipeline
  // Uses: trigger, openagentic_llm, rag_query
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'RAG Knowledge Pipeline',
    description: 'Takes a user question, generates optimized search queries with LLM, retrieves relevant documents via RAG vector search, then synthesizes a grounded answer.',
    icon: 'Search',
    category: 'ai-analysis',
    tags: ['rag', 'knowledge-base', 'ai-analysis'],
    color: '#2196f3',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'User Question', triggerType: 'manual', icon: 'Play', color: '#ff9800', inputs: [{ name: 'question', label: 'Your question', type: 'string', required: true, placeholder: 'e.g., How does the smart router pick a model?', description: 'A question to answer from the indexed knowledge base (docs collection).' }] } },
        { id: 'llm-queries', type: 'openagentic_llm', position: { x: X, y: Y }, data: { label: 'Generate Queries', icon: 'Brain', color: '#7c4dff', prompt: 'Given the user question below, generate 3 diverse search queries that would help retrieve relevant information. Output them as a JSON array of strings.\n\nQuestion: {{trigger.question}}' } },
        { id: 'rag-search', type: 'rag_query', position: { x: X * 2, y: Y }, data: { label: 'Vector Search', icon: 'Database', color: '#2196f3', collection: 'docs', query: '{{steps.llm-queries.output}}', topK: 10, minScore: 0.5, filter: { file_extensions: ['md', 'mdx'] } } },
        { id: 'llm-answer', type: 'openagentic_llm', position: { x: X * 3, y: Y }, data: { label: 'Synthesize Answer', icon: 'Brain', color: '#7c4dff', prompt: 'Answer the user question using ONLY the retrieved context below. Cite specific sources. If the context is insufficient, say so.\n\nQuestion: {{trigger.question}}\n\nRetrieved Context:\n{{steps.rag-search.output}}' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'llm-queries', animated: true },
        { id: 'e2', source: 'llm-queries', target: 'rag-search', animated: true },
        { id: 'e3', source: 'rag-search', target: 'llm-answer', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Web Page → Structured Brief (grounded)
  // Uses: trigger(inputs:url), mcp_tool(web_search_and_read), openagentic_llm,
  //       grounding_check. Reads a real page/topic and briefs it WITHOUT
  //       fabrication — replaces the old "Smart Router Showcase" demo.
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Web Page → Structured Brief',
    description: 'Reads a web page (or searches a topic and reads the top results), then writes a structured brief — TL;DR, key points each with their source URL, entities, and open questions — grounded against the actually-fetched content. No fabrication.',
    icon: 'Globe',
    category: 'research',
    tags: ['web', 'summarize', 'research', 'grounded'],
    color: '#06b6d4',
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'trigger',
          position: { x: 0, y: Y },
          data: {
            label: 'Page or Topic',
            triggerType: 'manual',
            icon: 'Play',
            color: '#ff9800',
            inputs: [
              {
                name: 'url',
                label: 'Page URL or search topic',
                type: 'string',
                required: true,
                placeholder: 'https://example.com/article   — or —   latest on post-quantum cryptography',
                description: 'A URL to read, or a topic to search the web for and read.',
              },
            ],
          },
        },
        {
          id: 'fetch',
          type: 'mcp_tool',
          position: { x: X, y: Y },
          data: {
            label: 'Read the web (real content)',
            icon: 'Globe',
            color: '#06b6d4',
            toolName: 'web_search_and_read',
            toolServer: 'openagentic_web',
            arguments: { query: '{{trigger.url}}', num_results: 3 },
          },
        },
        {
          id: 'brief',
          type: 'openagentic_llm',
          position: { x: X * 2, y: Y },
          data: {
            label: 'Structured Brief',
            icon: 'Brain',
            color: '#7c4dff',
            prompt:
              'Produce a STRUCTURED BRIEF using ONLY the fetched web content below. Markdown sections:\n"## TL;DR" — 3 sentences.\n"## Key Points" — bullets, each ending with its source URL.\n"## Entities" — people / orgs / products named in the content.\n"## Open Questions".\nUse ONLY facts present in the content; do not add outside knowledge. If the content is thin or off-topic, say so plainly.\n\nFETCHED CONTENT:\n{{steps.fetch.output}}',
          },
        },
        {
          id: 'ground',
          type: 'grounding_check',
          position: { x: X * 3, y: Y },
          data: {
            label: 'Grounding Check (vs fetched content)',
            icon: 'ShieldCheck',
            color: '#16a34a',
            claim: '{{steps.brief.output}}',
            groundTruth: '{{steps.fetch.output}}',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'fetch', animated: true },
        { id: 'e2', source: 'fetch', target: 'brief', animated: true },
        { id: 'e3', source: 'brief', target: 'ground', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Code Review Agent
  // Uses: trigger, openagentic_llm, condition, agent_single
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Code Review Agent',
    description: 'Analyzes code for issues with LLM, branches on severity — spawns a fix agent for critical issues or generates an approval summary for clean code.',
    icon: 'Code',
    category: 'devops',
    tags: ['code-review', 'agent', 'devops'],
    color: '#10b981',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'Submit Code', triggerType: 'manual', icon: 'Play', color: '#ff9800', inputs: [{ name: 'code', label: 'Code to review', type: 'text', required: true, placeholder: 'Paste the code (any language) to review…', description: 'The source to analyze for bugs, security, and quality.' }] } },
        { id: 'llm-analyze', type: 'openagentic_llm', position: { x: X, y: Y }, data: { label: 'Analyze Code', icon: 'Brain', color: '#7c4dff', prompt: 'Review the following code for bugs, security vulnerabilities, and quality issues. Classify the overall severity as "critical" (must fix before merge), "warning" (should fix), or "clean" (ready to merge).\n\nRespond with a JSON object: { "severity": "critical|warning|clean", "issues": [...], "suggestions": [...] }\n\nCode:\n{{trigger.code}}' } },
        { id: 'cond-severity', type: 'condition', position: { x: X * 2, y: Y }, data: { label: 'Critical Issues?', icon: 'GitBranch', color: '#2196f3', expression: '{{steps.llm-analyze.output}}.includes("critical")' } },
        { id: 'agent-fix', type: 'agent_single', position: { x: X * 3, y: 0 }, data: { label: 'Auto-Fix Agent', icon: 'Wrench', color: '#f44336', agentType: 'coder', task: 'Fix the critical issues identified in this code review:\n\nReview:\n{{steps.llm-analyze.output}}\n\nOriginal Code:\n{{trigger.code}}\n\nReturn the corrected code with comments explaining each fix.' } },
        { id: 'llm-approve', type: 'openagentic_llm', position: { x: X * 3, y: Y * 2 }, data: { label: 'Approval Summary', icon: 'CheckCircle', color: '#4caf50', prompt: 'Generate a concise code review approval summary based on the analysis:\n\n{{steps.llm-analyze.output}}\n\nInclude any minor suggestions for future improvement.' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'llm-analyze', animated: true },
        { id: 'e2', source: 'llm-analyze', target: 'cond-severity', animated: true },
        { id: 'e3', source: 'cond-severity', target: 'agent-fix', label: 'Critical', sourceHandle: 'true' },
        { id: 'e4', source: 'cond-severity', target: 'llm-approve', label: 'Clean', sourceHandle: 'false' },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Data Transform Pipeline
  // Uses: trigger, http_request, transform, condition, openagentic_llm, merge
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Data Transform Pipeline',
    description: 'Fetches data via HTTP, transforms it, branches by content type, processes each path with specialized LLM prompts, and merges results.',
    icon: 'RefreshCw',
    category: 'data',
    tags: ['data-pipeline', 'transform', 'http'],
    color: '#06b6d4',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'Start', triggerType: 'manual', icon: 'Play', color: '#ff9800', inputs: [{ name: 'url', label: 'JSON API URL', type: 'string', required: true, placeholder: 'https://api.example.com/data.json', description: 'A URL returning JSON to fetch, transform, and analyze.' }] } },
        { id: 'http-fetch', type: 'http_request', position: { x: X, y: Y }, data: { label: 'Fetch Data', icon: 'Globe', color: '#06b6d4', url: '{{trigger.url}}', method: 'GET' } },
        { id: 'transform-parse', type: 'transform', position: { x: X * 2, y: Y }, data: { label: 'Parse & Enrich', icon: 'FileText', color: '#4caf50', expression: '(Array.isArray(input) ? { type: "array", count: input.length, items: input } : { type: "single", count: 1, items: [input] })' } },
        { id: 'cond-size', type: 'condition', position: { x: X * 3, y: Y }, data: { label: 'Large Dataset?', icon: 'GitBranch', color: '#2196f3', expression: 'JSON.parse({{steps.transform-parse.output}} || "{}").count > 3' } },
        { id: 'llm-summarize', type: 'openagentic_llm', position: { x: X * 4, y: 0 }, data: { label: 'Summarize Large', icon: 'Brain', color: '#7c4dff', prompt: 'Summarize this large dataset. Identify patterns, outliers, and key statistics:\n\n{{steps.transform-parse.output}}' } },
        { id: 'llm-detail', type: 'openagentic_llm', position: { x: X * 4, y: Y * 2 }, data: { label: 'Detailed Analysis', icon: 'Brain', color: '#7c4dff', prompt: 'Provide a detailed analysis of each item in this small dataset:\n\n{{steps.transform-parse.output}}' } },
        { id: 'merge-results', type: 'merge', position: { x: X * 5, y: Y }, data: { label: 'Final Output', icon: 'GitMerge', color: '#9c27b0', strategy: 'first_available' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'http-fetch', animated: true },
        { id: 'e2', source: 'http-fetch', target: 'transform-parse', animated: true },
        { id: 'e3', source: 'transform-parse', target: 'cond-size', animated: true },
        { id: 'e4', source: 'cond-size', target: 'llm-summarize', label: 'Large', sourceHandle: 'true' },
        { id: 'e5', source: 'cond-size', target: 'llm-detail', label: 'Small', sourceHandle: 'false' },
        { id: 'e6', source: 'llm-summarize', target: 'merge-results' },
        { id: 'e7', source: 'llm-detail', target: 'merge-results' },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 6. Contract Risk Flagging
  // Uses: trigger, openagentic_llm, loop, merge
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Contract Risk Flagging',
    description: 'Extracts clauses from a contract with LLM, iterates over each clause to score risk, then produces a consolidated risk report with recommendations.',
    icon: 'FileText',
    category: 'legal',
    tags: ['contract', 'risk-analysis', 'legal', 'loop'],
    color: '#ef4444',
    definition: {
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: Y }, data: { label: 'Submit Contract', triggerType: 'manual', icon: 'Play', color: '#ff9800', inputs: [{ name: 'contract', label: 'Contract text', type: 'text', required: true, placeholder: 'Paste the contract / agreement text…', description: 'The full contract to extract clauses from and risk-score.' }] } },
        { id: 'llm-extract', type: 'openagentic_llm', position: { x: X, y: Y }, data: { label: 'Extract Clauses', icon: 'Brain', color: '#7c4dff', prompt: 'Extract all distinct clauses from the following contract. Return them as a JSON array of objects: [{ "id": 1, "title": "...", "text": "..." }, ...]\n\nContract:\n{{trigger.contract}}' } },
        { id: 'loop-clauses', type: 'loop', position: { x: X * 2, y: Y }, data: { label: 'Iterate Clauses', icon: 'Repeat', color: '#f59e0b', iterateOver: '{{steps.llm-extract.output}}', itemVariable: 'clause' } },
        { id: 'llm-score', type: 'openagentic_llm', position: { x: X * 3, y: Y }, data: { label: 'Score Risk', icon: 'Brain', color: '#7c4dff', prompt: 'Score the risk of this contract clause on a scale of 1-10 and explain why.\n\nRespond with JSON: { "clause_title": "...", "risk_score": N, "risk_level": "low|medium|high|critical", "explanation": "...", "recommendation": "..." }\n\nClause:\n{{clause}}' } },
        { id: 'merge-scores', type: 'merge', position: { x: X * 4, y: Y }, data: { label: 'Collect Scores', icon: 'GitMerge', color: '#9c27b0', strategy: 'combine' } },
        { id: 'llm-report', type: 'openagentic_llm', position: { x: X * 5, y: Y }, data: { label: 'Risk Report', icon: 'Brain', color: '#7c4dff', prompt: 'Produce a final contract risk assessment report from the clause-level analysis below.\n\nInclude:\n1. Overall Risk Rating\n2. Critical clauses requiring immediate attention\n3. Recommended modifications\n4. Clauses that are acceptable as-is\n\nClause Analyses:\n{{steps.merge-scores.output}}' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'llm-extract', animated: true },
        { id: 'e2', source: 'llm-extract', target: 'loop-clauses', animated: true },
        { id: 'e3', source: 'loop-clauses', target: 'llm-score', animated: true },
        { id: 'e4', source: 'llm-score', target: 'merge-scores' },
        { id: 'e5', source: 'merge-scores', target: 'llm-report', animated: true },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 7. Topic Watch → Briefing (grounded, human-approved publish)
  // Uses: trigger(inputs:topic,focus), mcp_tool(web_search_and_read),
  //       openagentic_llm, grounding_check, human_approval. Searches the LIVE web
  //       and writes a dated briefing from real sources, then a human approves
  //       before it's finalized — replaces the old "Approval Gate Demo".
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'Topic Watch → Briefing',
    description: 'Searches the live web for the latest on a topic, writes a dated briefing (What\'s New / Why It Matters / Watch List / Sources) grounded against the real search results, then pauses for human approval before finalizing.',
    icon: 'Newspaper',
    category: 'research',
    tags: ['monitoring', 'briefing', 'research', 'grounded', 'human-in-the-loop'],
    color: '#0ea5e9',
    definition: {
      nodes: [
        {
          id: 'trigger-1',
          type: 'trigger',
          position: { x: 0, y: Y },
          data: {
            label: 'Watch Topic',
            triggerType: 'manual',
            icon: 'Play',
            color: '#ff9800',
            inputs: [
              {
                name: 'topic',
                label: 'Topic to brief',
                type: 'string',
                required: true,
                placeholder: 'e.g., Kubernetes security advisories',
                description: 'What should we get the latest grounded briefing on?',
              },
              {
                name: 'focus',
                label: 'Focus (optional)',
                type: 'string',
                required: false,
                placeholder: 'e.g., enterprise impact, last 30 days',
                description: 'Optional angle to emphasize in the briefing.',
              },
            ],
          },
        },
        {
          id: 'search',
          type: 'mcp_tool',
          position: { x: X, y: Y },
          data: {
            label: 'Live Web Search',
            icon: 'Globe',
            color: '#06b6d4',
            toolName: 'web_search_and_read',
            toolServer: 'openagentic_web',
            arguments: { query: 'latest {{trigger.topic}} {{trigger.focus}}', num_results: 5 },
          },
        },
        {
          id: 'brief',
          type: 'openagentic_llm',
          position: { x: X * 2, y: Y },
          data: {
            label: 'Write Briefing',
            icon: 'Brain',
            color: '#7c4dff',
            prompt:
              'Write a BRIEFING on "{{trigger.topic}}" using ONLY the live search results below. Markdown:\n"## What\'s New" — bullets, each with its source URL (and date if present).\n"## Why It Matters".\n"## Watch List" — what to track next.\n"## Sources" — every URL used.\nUse ONLY facts present in the results; if something is unclear or unsupported, say so. No fabrication.\n\nLIVE RESULTS:\n{{steps.search.output}}',
          },
        },
        {
          id: 'ground',
          type: 'grounding_check',
          position: { x: X * 3, y: Y },
          data: {
            label: 'Grounding Check (vs live results)',
            icon: 'ShieldCheck',
            color: '#16a34a',
            claim: '{{steps.brief.output}}',
            groundTruth: '{{steps.search.output}}',
          },
        },
        {
          id: 'approve',
          type: 'human_approval',
          position: { x: X * 4, y: Y },
          data: {
            label: 'Approve to Publish',
            icon: 'UserCheck',
            color: '#8b5cf6',
            message: 'Review the grounded briefing (and grounding result) below, then approve or reject before it is finalized.',
            timeout: 3600,
          },
        },
        {
          id: 'finalize',
          type: 'openagentic_llm',
          position: { x: X * 5, y: Y },
          data: {
            label: 'Finalize Briefing',
            icon: 'FileCheck',
            color: '#4caf50',
            prompt:
              'Produce the FINAL briefing from the approved draft below. Keep all source URLs. Add a one-line "_Grounding:_" footer noting it was fact-checked against the live sources.\n\nDRAFT:\n{{steps.brief.output}}\n\nGROUNDING:\n{{steps.ground.output}}\n\nAPPROVAL:\n{{steps.approve.output}}',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger-1', target: 'search', animated: true },
        { id: 'e2', source: 'search', target: 'brief', animated: true },
        { id: 'e3', source: 'brief', target: 'ground', animated: true },
        { id: 'e4', source: 'ground', target: 'approve', animated: true },
        { id: 'e5', source: 'approve', target: 'finalize', animated: true },
      ],
    },
  },

];

/**
 * Auto-seed workflow templates on server startup. Idempotent — upserts by
 * name. Called from server.ts after AgentRegistry initialization.
 *
 * Uses the first admin user found in the DB as owner, falling back to any
 * user if no admin exists (some test envs seed with non-admin only). If
 * the DB has zero users, we skip seeding entirely — the manual
 * POST /api/workflows/seed-templates endpoint still works post-login.
 */
export async function autoSeedWorkflowTemplates(): Promise<{
  created: number; updated: number; skipped: number; errors: number;
}> {
  const result = { created: 0, updated: 0, skipped: 0, errors: 0 };
  // Pick an owner: first admin, else first user, else skip.
  const owner = await prisma.user.findFirst({
    where: { is_admin: true },
    select: { id: true },
  }) || await prisma.user.findFirst({
    select: { id: true },
  });
  if (!owner) {
    loggers.routes.info('[Workflows] autoSeedWorkflowTemplates: no users in DB yet, skipping');
    return result;
  }
  const ownerId = owner.id;

  // Materialize inline ghost agents into prisma.agent SOT first.
  const { materializeTemplateAgents } = await import('../../services/materializeTemplateAgents.js');

  for (const rawTemplate of SEED_WORKFLOW_TEMPLATES) {
    try {
      // Replace inline { role, taskDescription } with { agentId } references
      // by upserting a Template__<slug>__<role> agent in the SOT.
      const template = await materializeTemplateAgents(rawTemplate);

      const existing = await prisma.workflow.findFirst({
        where: { name: template.name, is_template: true, deleted_at: null },
        select: { id: true },
      });
      if (existing) {
        await prisma.workflow.update({
          where: { id: existing.id },
          data: {
            description: template.description,
            definition: asJson(template.definition),
            tags: template.tags,
            category: template.category,
            icon: template.icon,
            color: template.color || null,
          },
        });
        await prisma.workflowVersion.updateMany({
          where: { workflow_id: existing.id, is_active: true },
          data: { definition: asJson(template.definition) },
        });
        result.updated++;
      } else {
        const workflow = await prisma.workflow.create({
          data: {
            name: template.name,
            description: template.description,
            definition: asJson(template.definition),
            tags: template.tags,
            category: template.category,
            icon: template.icon,
            color: template.color || null,
            is_template: true,
            is_public: true,
            is_active: true,
            created_by: ownerId,
          },
        });
        await prisma.workflowVersion.create({
          data: {
            workflow_id: workflow.id,
            version: 1,
            definition: asJson(template.definition),
            changelog: 'Seeded on startup',
            is_active: true,
            created_by: ownerId,
          },
        });
        result.created++;
      }
    } catch (err) {
      result.errors++;
      loggers.routes.warn({ err: err.message, template: rawTemplate.name }, '[Workflows] autoSeed template failed');
    }
  }

  // ── RECONCILE: prune stale system-seeded templates not in the kept set ────
  // Two seeders have historically written templates: this function (using ownerId,
  // the first admin user) and the workflows-service templateSeeder.ts (using the
  // fixed SYSTEM_SEED_USER constant). Both must be scoped here so enterprise
  // templates removed from source are also removed from the live DB on next boot.
  //
  // SAFETY: the created_by filter ensures we NEVER touch user-owned templates.
  // The allowlist is derived from the current SEED_WORKFLOW_TEMPLATES names plus
  // the one kept JSON template ("Research and Publish") from the workflows-service.
  // Any template NOT in this list and owned by a known seeder id will be pruned.
  try {
    // Fixed seeder id used by services/openagentic-workflows templateSeeder.ts.
    const SYSTEM_SEED_USER = 'system-00000000-0000-0000-0000-000000000000';

    // Build the allowlist: inline api templates + kept JSON templates from
    // the workflows-service. Read the exact name from the JSON at boot time
    // (templateSeeder.ts sets created_by=SYSTEM_SEED_USER for these rows).
    const keptJsonTemplateNames: string[] = ['Research and Publish'];
    const allowlist = [
      ...SEED_WORKFLOW_TEMPLATES.map((t) => t.name),
      ...keptJsonTemplateNames,
    ];

    // Scope to known seeder-owned rows only. We use OR so both the
    // api-seeder-owned rows (ownerId) and the workflows-service-seeder-owned
    // rows (SYSTEM_SEED_USER) are covered.
    const pruned = await prisma.workflow.deleteMany({
      where: {
        is_template: true,
        created_by: { in: [ownerId, SYSTEM_SEED_USER] },
        name: { notIn: allowlist },
      },
    });

    if (pruned.count > 0) {
      loggers.routes.info(
        { pruned: pruned.count, allowlist },
        '[Workflows] autoSeed reconcile: pruned stale system-seeded templates',
      );
    } else {
      loggers.routes.info(
        { allowlist },
        '[Workflows] autoSeed reconcile: no stale system templates to prune',
      );
    }
  } catch (err) {
    // Non-fatal: a prune failure must never break boot.
    loggers.routes.warn(
      { err: err.message },
      '[Workflows] autoSeed reconcile: prune step failed (non-fatal)',
    );
  }

  return result;
}

/**
 * POST /api/workflows/seed-templates
 * Seed built-in workflow templates to the database.
 * Upserts by name — skips templates that already exist, creates new ones.
 * Requires authentication (uses calling user as owner).
 */
export const seedTemplatesRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  fastify.post(
    '/seed-templates',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        if (!userId) {
          return reply.code(401).send({ error: 'Authentication required' });
        }

        const results = { created: 0, skipped: 0, errors: 0, details: [] as string[] };

        // Materialize inline ghost agents into prisma.agent SOT before persistence.
        const { materializeTemplateAgents } = await import('../../services/materializeTemplateAgents.js');

        for (const rawTemplate of SEED_WORKFLOW_TEMPLATES) {
          try {
            const template = await materializeTemplateAgents(rawTemplate);

            // Check if a template with this name already exists
            const existing = await prisma.workflow.findFirst({
              where: {
                name: template.name,
                is_template: true,
                deleted_at: null,
              },
              select: { id: true },
            });

            if (existing) {
              // Update existing template with latest definition
              await prisma.workflow.update({
                where: { id: existing.id },
                data: {
                  description: template.description,
                  definition: asJson(template.definition),
                  tags: template.tags,
                  category: template.category,
                  icon: template.icon,
                  color: template.color || null,
                },
              });
              // Also update the active version's definition (execution prefers version over workflow)
              await prisma.workflowVersion.updateMany({
                where: { workflow_id: existing.id, is_active: true },
                data: { definition: asJson(template.definition) },
              });
              results.skipped++;
              results.details.push(`Updated "${template.name}" (${existing.id})`);
              continue;
            }

            // Create the template workflow
            const workflow = await prisma.workflow.create({
              data: {
                name: template.name,
                description: template.description,
                definition: asJson(template.definition),
                tags: template.tags,
                category: template.category,
                icon: template.icon,
                color: template.color || null,
                is_template: true,
                is_public: true,
                is_active: true,
                created_by: userId,
              },
            });

            // Create initial version
            await prisma.workflowVersion.create({
              data: {
                workflow_id: workflow.id,
                version: 1,
                definition: asJson(template.definition),
                changelog: 'Seeded from built-in templates',
                is_active: true,
                created_by: userId,
              },
            });

            results.created++;
            results.details.push(`Created "${template.name}" (${workflow.id})`);
          } catch (templateError) {
            results.errors++;
            results.details.push(`Error seeding "${rawTemplate.name}": ${templateError.message}`);
            logger.error({ error: templateError, templateName: rawTemplate.name }, '[Workflows] Failed to seed template');
          }
        }

        logger.info(
          { created: results.created, skipped: results.skipped, errors: results.errors },
          '[Workflows] Template seeding completed'
        );

        return reply.send({
          success: true,
          message: `Seeded ${results.created} templates (${results.skipped} skipped, ${results.errors} errors)`,
          ...results,
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to seed templates');
        return reply.code(500).send({
          error: 'Failed to seed templates',
          message: error.message,
        });
      }
    }
  );
};

export default seedTemplatesRoutes;
