-- Copyright 2026 Gnomus.ai
--
-- Licensed under the Apache License, Version 2.0 (the "License");
-- you may not use this file except in compliance with the License.
-- You may obtain a copy of the License at
--
--     http://www.apache.org/licenses/LICENSE-2.0
--
-- Unless required by applicable law or agreed to in writing, software
-- distributed under the License is distributed on an "AS IS" BASIS,
-- WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
-- See the License for the specific language governing permissions and
-- limitations under the License.

-- Documentation Assistant Agent: Seed Script
-- Inserts the docs_assistant agent into the agentic_loops table
-- Run via: kubectl exec -n agentic-dev openagentic-postgresql-0 -- env PGPASSWORD=openagentic123 psql -U openagentic -d openagentic -f /dev/stdin < seed-docs-assistant.sql

-- Delete existing docs_assistant if present (for idempotency)
DELETE FROM agentic_loops WHERE name = 'docs_assistant';

INSERT INTO agentic_loops (
  id, name, display_name, description,
  agent_type, category,
  graph_definition, model_config, system_prompt,
  state_schema, input_schema, output_schema,
  rate_limits, cost_limits, alert_config, logging_config,
  enabled, is_default,
  version, tags, icon, color,
  prompt_modules, prompt_strategy, prompt_mode,
  skills, delegation, background,
  tools_whitelist, tools_deny_list,
  max_spawn_depth, max_children,
  retry_strategy, handoff_schema,
  triggers, isolation, memory_scope,
  created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'docs_assistant',
  'Documentation Assistant',
  'Answers questions about OpenAgentic using platform documentation',

  'custom',
  'platform',

  -- graph_definition
  '{}',

  -- model_config
  '{"primaryModel":"auto","fallbackModel":"auto","maxTokens":4096,"temperature":0.3,"thinkingEnabled":false,"timeoutMs":30000,"retryAttempts":1}',

  -- system_prompt
  E'You are the OpenAgentic Documentation Assistant. You answer questions about the platform using the provided documentation context. Be concise and factual. When referencing other sections, use docs://section-id links. After answering, suggest 2-3 related topics the user might want to explore.',

  -- state/input/output schemas
  '{}', '{}', '{}',

  -- rate_limits, cost_limits, alert_config, logging_config
  '{"maxPerMinute":20,"maxPerHour":200,"maxConcurrent":5}',
  '{"maxCostPerCall":0.10,"maxDailyCost":5.00}',
  '{}',
  '{"verboseLogging":false,"logInputs":false,"logOutputs":false,"sampleRate":0.1}',

  -- enabled, is_default
  true, false,

  -- version, tags, icon, color
  '1.0.0',
  ARRAY['docs', 'documentation', 'help', 'assistant'],
  'BookOpen',
  '#2563eb',

  -- prompt_modules, prompt_strategy, prompt_mode
  ARRAY[]::text[],
  'custom',
  'full',

  -- skills, delegation, background
  ARRAY[]::text[],
  '{"allowed":false,"maxDepth":1,"maxSubAgents":0,"allowedRoles":[]}',
  NULL,

  -- tools_whitelist, tools_deny_list
  ARRAY[]::text[],
  ARRAY[]::text[],

  -- max_spawn_depth, max_children
  1, 0,

  -- retry_strategy, handoff_schema
  '{"maxRetries":1,"fallbackToMinimal":false,"partialResultsOk":false}',
  '{}',

  -- triggers, isolation, memory_scope
  ARRAY['docs', 'documentation', 'help', 'how to', 'what is'],
  'none',
  'session',

  -- timestamps
  NOW(), NOW()
);

-- Verify insertion
SELECT id, name, display_name, enabled, agent_type FROM agentic_loops WHERE name = 'docs_assistant';
