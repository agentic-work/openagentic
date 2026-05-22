/**
 * Template 07 — Deep Research Team
 *
 * Flow shape (approved 2026-04-25):
 *   trigger(topic) → openagentic_llm plan outline → parallel: agent_pool
 *   per question (web_search / rag_query / news_api) → merge findings →
 *   multi_agent critique (critic + fact_checker + devil's_advocate) →
 *   condition: confidence > 0.75? → loop back through Research Squad with
 *   gap-questions, OR synthesize report → optional human_approval → save
 *   artifact + return to caller.
 *
 * Hits all the refusal-detection assertions on agent / LLM nodes so a
 * "I couldn't find sources" answer fails the node loudly and the loop
 * picks it up as a gap to refine.
 */

import type { WorkflowNode, WorkflowEdge } from '@openagentic/workflow-engine';

export const nodes: WorkflowNode[] = [
  {
    id: 'trigger-research',
    type: 'trigger',
    data: {
      label: 'Research Request',
      triggerType: 'manual',
      description: 'Manual trigger. Input: { topic: string, depth: 1..3 }.',
      schema: {
        topic: { type: 'string', required: true, description: 'Research topic / question.' },
        depth: { type: 'number', required: false, default: 2, min: 1, max: 3, description: 'How deep to iterate; higher = more refinement loops.' },
      },
    },
    position: { x: 0, y: 200 },
  },
  {
    id: 'plan-outline',
    type: 'openagentic_llm',
    data: {
      label: 'Plan Research Outline',
      systemPrompt:
        'You are a research director. Decompose the user topic into 6-10 specific research questions ordered by priority. Output STRICT JSON: { questions: [{ id: number, text: string, priority: 1..3 }], plan: string }. Do not invent answers — only the question list.',
      prompt: 'Topic: {{input.topic}}\n\nDepth: {{input.depth}}',
      temperature: 0.4,
      maxTokens: 1500,
    },
    position: { x: 250, y: 200 },
  },
  {
    id: 'fan-out-questions',
    type: 'parallel',
    data: {
      label: 'Fan-Out Per Question',
      iterateOver: '{{steps.plan-outline.output.content.questions}}',
      itemVariable: 'question',
      maxConcurrency: 4,
      description:
        'For each research question, dispatch a 3-agent research squad in parallel.',
    },
    position: { x: 500, y: 200 },
  },
  {
    id: 'research-squad',
    type: 'agent_pool',
    data: {
      label: 'Research Squad (3 agents per question)',
      maxConcurrency: 3,
      aggregationStrategy: 'merge',
      sharedContext: true,
      timeoutMs: 90000,
      agents: [
        {
          role: 'researcher_web',
          taskDescription:
            'Use web_search and url_fetch to gather authoritative sources on this question. Return JSON: { findings: [{ claim: string, source_url: string, confidence: 0..1 }], summary: string }.\n\nQuestion: {{question.text}}',
          tools: ['web_search', 'url_fetch'],
        },
        {
          role: 'researcher_kb',
          taskDescription:
            'Query the shared knowledge base via rag_query for documents relevant to this question. Return JSON of findings with collection-source URIs.\n\nQuestion: {{question.text}}',
          tools: ['rag_query'],
        },
        {
          role: 'researcher_news',
          taskDescription:
            'Search recent (last 30 days) news and press releases via news_api for items relevant to this question. Return JSON of findings, each with publication date.\n\nQuestion: {{question.text}}',
          tools: ['news_api'],
        },
      ],
    },
    position: { x: 750, y: 200 },
  },
  {
    id: 'collect-findings',
    type: 'merge',
    data: {
      label: 'Collect Findings Per Question',
      strategy: 'combine',
    },
    position: { x: 1000, y: 200 },
  },
  {
    id: 'critique-round',
    type: 'multi_agent',
    data: {
      label: 'Critique Round',
      maxConcurrency: 3,
      aggregationStrategy: 'merge',
      sharedContext: true,
      timeoutMs: 90000,
      agents: [
        {
          role: 'critic',
          taskDescription:
            'Review the findings below for logical gaps, weak evidence, or unsupported claims. Output JSON: { gaps: [...], weak_claims: [...], suggested_followups: [...] }.\n\nFindings:\n{{steps.collect-findings.output}}',
        },
        {
          role: 'fact_checker',
          taskDescription:
            'For each claim in the findings, score confidence (0..1) based on source authority + corroboration count. Return JSON: { scored_claims: [{ claim, sources, confidence }], avg_confidence: 0..1, critical_low_confidence: [...] }.\n\nFindings:\n{{steps.collect-findings.output}}',
        },
        {
          role: 'devils_advocate',
          taskDescription:
            'Generate counter-arguments and alternative interpretations for the strongest findings. Output JSON: { counterarguments: [...], alt_interpretations: [...] }.\n\nFindings:\n{{steps.collect-findings.output}}',
        },
      ],
    },
    position: { x: 1250, y: 200 },
  },
  {
    id: 'sufficient-knowledge',
    type: 'condition',
    data: {
      label: 'Knowledge Sufficient?',
      condition:
        '{{steps.critique-round.output.fact_checker.avg_confidence > 0.75 && steps.critique-round.output.critic.gaps.length === 0}}',
      expression:
        'steps["critique-round"].output.fact_checker.avg_confidence > 0.75 && steps["critique-round"].output.critic.gaps.length === 0',
      description:
        'Gate: avg confidence ≥ 0.75 and no critical gaps from critic? Yes → synthesize. No → loop back through research with gap-questions.',
    },
    position: { x: 1500, y: 200 },
  },
  {
    id: 'iterate-on-gaps',
    type: 'loop',
    data: {
      label: 'Iterate on Gaps',
      iterateOver: '{{steps.critique-round.output.critic.gaps}}',
      itemVariable: 'gap',
      maxIterations: '{{input.depth || 2}}',
      description:
        'Re-fans out through the Research Squad with the critic-identified gap as the new question. Bounded by input.depth + 1.',
    },
    position: { x: 1500, y: 400 },
  },
  {
    id: 'synthesize-report',
    type: 'openagentic_llm',
    data: {
      label: 'Synthesize Final Report',
      systemPrompt:
        'You are a research director writing the final report. Output STRICT JSON: { exec_summary: string, key_findings: [...], areas_of_agreement: [...], conflicts: [...], risk_assessment: string, recommendations: [...], references: [{ title, url, type }] }. Use ONLY content from the inputs. If a claim has < 0.5 confidence, omit it from key_findings.',
      prompt:
        'Topic: {{input.topic}}\n\nFindings (per question):\n{{steps.collect-findings.output}}\n\nCritique:\n{{steps.critique-round.output}}',
      temperature: 0.3,
      maxTokens: 4096,
    },
    position: { x: 1750, y: 200 },
  },
  {
    id: 'optional-review',
    type: 'human_approval',
    data: {
      label: 'Editorial Review (optional)',
      message:
        'Please review the synthesized research report. Approve to save and return to caller, reject with feedback to revise.',
      timeout: 1800,
      channel: 'origin',
      skipWhen: '{{input.depth <= 1}}',
      description:
        'Skipped automatically when depth=1 (quick mode). For depth=2-3 the report goes through editorial review before publishing.',
    },
    position: { x: 2000, y: 200 },
  },
  {
    id: 'save-artifact',
    type: 'knowledge_ingest',
    data: {
      label: 'Save Report as Artifact',
      collection: 'research_reports',
      content: '{{steps.synthesize-report.output.content}}',
      metadata: {
        topic: '{{input.topic}}',
        depth: '{{input.depth}}',
        confidence: '{{steps.critique-round.output.fact_checker.avg_confidence}}',
        execution_id: '{{execution.id}}',
        created_at: '{{execution.created_at}}',
      },
    },
    position: { x: 2250, y: 200 },
  },
  {
    id: 'webhook-return',
    type: 'webhook_response',
    data: {
      label: 'Return Report to Caller',
      statusCode: 200,
      body: {
        report: '{{steps.synthesize-report.output.content}}',
        artifact_id: '{{steps.save-artifact.output.artifact_id}}',
        confidence: '{{steps.critique-round.output.fact_checker.avg_confidence}}',
      },
      headers: {
        'Content-Type': 'application/json',
      },
    },
    position: { x: 2500, y: 200 },
  },
];

export const edges: WorkflowEdge[] = [
  { id: 'e-trig-plan', source: 'trigger-research', target: 'plan-outline' },
  { id: 'e-plan-fanout', source: 'plan-outline', target: 'fan-out-questions' },
  { id: 'e-fanout-squad', source: 'fan-out-questions', target: 'research-squad' },
  { id: 'e-squad-collect', source: 'research-squad', target: 'collect-findings' },
  { id: 'e-collect-critique', source: 'collect-findings', target: 'critique-round' },
  { id: 'e-critique-gate', source: 'critique-round', target: 'sufficient-knowledge' },
  { id: 'e-sufficient', source: 'sufficient-knowledge', target: 'synthesize-report', label: 'sufficient', sourceHandle: 'true' },
  { id: 'e-insufficient', source: 'sufficient-knowledge', target: 'iterate-on-gaps', label: 'insufficient', sourceHandle: 'false' },
  // The loop re-feeds the squad — engine resolves loop-back edges via iterateOver.
  { id: 'e-iterate-back', source: 'iterate-on-gaps', target: 'research-squad', label: 'next gap' },
  { id: 'e-syn-review', source: 'synthesize-report', target: 'optional-review' },
  { id: 'e-review-save', source: 'optional-review', target: 'save-artifact' },
  { id: 'e-save-return', source: 'save-artifact', target: 'webhook-return' },
];
