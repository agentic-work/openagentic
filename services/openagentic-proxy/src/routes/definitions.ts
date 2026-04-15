/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import axios from 'axios';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

// Built-in agent definitions (fallback when DB is unreachable)
// model: 'auto' → SmartModelRouter selects based on intelligence slider + available providers
const BUILTIN_AGENTS = [
  { id: 'research', name: 'Research Agent', role: 'reasoning', model: 'auto', tools: ['web_search', 'web_fetch'], category: 'platform', icon: 'search', background: null },
  { id: 'data-analyst', name: 'Data Analyst', role: 'data_query', model: 'auto', tools: ['admin_postgres_raw_query'], category: 'platform', icon: 'database', background: null },
  { id: 'tool-orchestrator', name: 'Tool Orchestrator', role: 'tool_orchestration', model: 'auto', tools: [], category: 'platform', icon: 'wrench', background: null },
  { id: 'deep-reasoner', name: 'Deep Reasoner', role: 'reasoning', model: 'auto', tools: [], category: 'platform', icon: 'brain', background: null },
  { id: 'summarizer', name: 'Summarizer', role: 'summarization', model: 'auto', tools: [], category: 'platform', icon: 'file-text', background: null },
  { id: 'code-generator', name: 'Code Generator', role: 'code_execution', model: 'auto', tools: ['openagentic_execute'], category: 'platform', icon: 'code', background: null },
  { id: 'planner', name: 'Planner', role: 'planning', model: 'auto', tools: [], category: 'platform', icon: 'list', background: null },
  { id: 'validator', name: 'Validator', role: 'validation', model: 'auto', tools: ['web_search'], category: 'platform', icon: 'check-circle', background: null },
  { id: 'synthesizer', name: 'Synthesizer', role: 'synthesis', model: 'auto', tools: [], category: 'platform', icon: 'layers', background: null },
  { id: 'artifact-gen', name: 'Artifact Generator', role: 'custom', model: 'auto', tools: [], category: 'background', icon: 'box', background: { trigger: 'code_blocks' } },
  { id: 'diagram-agent', name: 'Diagram Agent', role: 'custom', model: 'auto', tools: [], category: 'background', icon: 'git-branch', background: { trigger: 'architecture_discussion' } },
  { id: 'fact-checker', name: 'Fact-Checker', role: 'validation', model: 'auto', tools: ['web_search'], category: 'background', icon: 'shield', background: { trigger: 'factual_claims' } },
  { id: 'flows-agent', name: 'Flows Agent', role: 'custom', model: 'auto', tools: ['web_search', 'web_news_search'], category: 'platform', icon: 'workflow', background: null, description: 'Expert workflow builder and debugger. Can see the currently open flow, build new flows from plain language, diagnose failing nodes, fix configurations, execute test runs, and optimize workflows. Deep knowledge of all 35+ node types, template interpolation, MCP tools, and execution patterns.' },
];

const API_URL = process.env.API_URL || 'http://openagentic-api:8000';

// Cache DB agents for 60s to avoid hammering the API
let dbAgentsCache: any[] | null = null;
let dbAgentsCacheTime = 0;
const CACHE_TTL_MS = 60_000;

async function getDBAgents(authHeader?: string): Promise<any[]> {
  const now = Date.now();
  if (dbAgentsCache && (now - dbAgentsCacheTime) < CACHE_TTL_MS) {
    return dbAgentsCache;
  }
  try {
    const res = await axios.get(`${API_URL}/api/admin/agents/db`, {
      headers: authHeader ? { Authorization: authHeader } : {},
      timeout: 5000,
    });
    dbAgentsCache = (res.data?.agents || []).map((a: any) => ({
      id: a.id,
      name: a.display_name || a.name,
      description: a.description || '',
      role: a.agent_type,
      model: a.model_id || a.model_config?.primaryModel || 'auto',
      tools: a.tools_whitelist || [],
      skills: a.skills || [],
      systemPrompt: a.system_prompt || undefined,
      category: a.background ? 'background' : (a.category || 'custom'),
      icon: a.icon || 'bot',
      color: a.color,
      background: a.background,
      triggers: a.triggers || [],
      tags: a.tags || [],
      source: 'database',
    }));
    dbAgentsCacheTime = now;
    return dbAgentsCache!;
  } catch (err: any) {
    logger.debug({ err: err.message }, 'Could not fetch DB agents, using built-in only');
    return [];
  }
}

export async function definitionRoutes(app: FastifyInstance): Promise<void> {
  // List all agent definitions (built-in + DB-backed)
  app.get('/api/agents/definitions', {
    preHandler: authMiddleware,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const dbAgents = await getDBAgents(request.headers.authorization);
    // Merge: DB agents override built-in if same id
    const dbIds = new Set(dbAgents.map(a => a.id));
    const merged = [
      ...BUILTIN_AGENTS.filter(a => !dbIds.has(a.id)),
      ...dbAgents,
    ];
    return reply.send({ agents: merged });
  });

  // Get single agent definition
  app.get<{ Params: { id: string } }>('/api/agents/definitions/:id', {
    preHandler: authMiddleware,
  }, async (request, reply: FastifyReply) => {
    const dbAgents = await getDBAgents(request.headers.authorization);
    const agent = dbAgents.find(a => a.id === request.params.id) ||
                  BUILTIN_AGENTS.find(a => a.id === request.params.id);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }
    return reply.send(agent);
  });
}
