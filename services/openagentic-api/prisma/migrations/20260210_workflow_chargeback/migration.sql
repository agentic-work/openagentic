-- Copyright (c) 2024-2026 OpenAgentic LLC. All rights reserved.

-- OpenAgentic Workflow Platform & Chargeback Schema Migration
-- Date: 2026-02-10
--
-- This migration adds:
-- 1. Complete workflow execution infrastructure
-- 2. User groups and chargeback model
-- 3. Accurate per-model cost tracking
-- 4. Rate limiting infrastructure
-- 5. Secrets management

-- ============================================================================
-- MODEL PRICING - Accurate cost per provider/model
-- ============================================================================

CREATE TABLE IF NOT EXISTS "admin"."model_pricing" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "provider" VARCHAR(50) NOT NULL,          -- anthropic, openai, google, azure, ollama, aws-bedrock
    "model" VARCHAR(100) NOT NULL,            -- claude-sonnet-4-20250514, gpt-4o, gemini-1.5-pro, etc.
    "model_family" VARCHAR(50),               -- claude-3, gpt-4, gemini, llama, etc.
    "input_cost_per_1k" DECIMAL(10, 6) NOT NULL DEFAULT 0,   -- Cost per 1K input tokens
    "output_cost_per_1k" DECIMAL(10, 6) NOT NULL DEFAULT 0,  -- Cost per 1K output tokens
    "cached_input_cost_per_1k" DECIMAL(10, 6) DEFAULT 0,     -- Cost for cached input (Anthropic)
    "thinking_cost_per_1k" DECIMAL(10, 6) DEFAULT 0,         -- Cost for thinking tokens (Claude)
    "image_input_cost" DECIMAL(10, 6) DEFAULT 0,             -- Cost per image input
    "effective_date" TIMESTAMP NOT NULL DEFAULT NOW(),
    "end_date" TIMESTAMP,                                    -- NULL = current pricing
    "notes" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT "model_pricing_provider_model_date" UNIQUE ("provider", "model", "effective_date")
);

CREATE INDEX "idx_model_pricing_provider_model" ON "admin"."model_pricing"("provider", "model");
CREATE INDEX "idx_model_pricing_effective_date" ON "admin"."model_pricing"("effective_date");

-- Seed current pricing (as of 2026-02-10)
INSERT INTO "admin"."model_pricing" ("provider", "model", "model_family", "input_cost_per_1k", "output_cost_per_1k", "cached_input_cost_per_1k", "thinking_cost_per_1k", "notes") VALUES
-- Anthropic
('anthropic', 'claude-sonnet-4-20250514', 'claude-3.5', 0.003, 0.015, 0.0003, 0, 'Claude 3.5 Sonnet'),
('anthropic', 'claude-opus-4-20250514', 'claude-3.5', 0.015, 0.075, 0.00015, 0, 'Claude 3.5 Opus'),
('anthropic', 'claude-3-5-haiku-20241022', 'claude-3.5', 0.0008, 0.004, 0.00008, 0, 'Claude 3.5 Haiku'),
('anthropic', 'claude-3-opus-20240229', 'claude-3', 0.015, 0.075, 0.0015, 0, 'Claude 3 Opus'),
('anthropic', 'claude-3-sonnet-20240229', 'claude-3', 0.003, 0.015, 0.0003, 0, 'Claude 3 Sonnet'),
('anthropic', 'claude-3-haiku-20240307', 'claude-3', 0.00025, 0.00125, 0.000025, 0, 'Claude 3 Haiku'),
-- OpenAI
('openai', 'gpt-4o', 'gpt-4', 0.0025, 0.01, 0.00125, 0, 'GPT-4o'),
('openai', 'gpt-4o-mini', 'gpt-4', 0.00015, 0.0006, 0.000075, 0, 'GPT-4o Mini'),
('openai', 'gpt-4-turbo', 'gpt-4', 0.01, 0.03, 0, 0, 'GPT-4 Turbo'),
('openai', 'gpt-4', 'gpt-4', 0.03, 0.06, 0, 0, 'GPT-4'),
('openai', 'gpt-3.5-turbo', 'gpt-3.5', 0.0005, 0.0015, 0, 0, 'GPT-3.5 Turbo'),
('openai', 'o1-preview', 'o1', 0.015, 0.06, 0, 0.015, 'O1 Preview with thinking'),
('openai', 'o1-mini', 'o1', 0.003, 0.012, 0, 0.003, 'O1 Mini with thinking'),
-- Google
('google', 'gemini-1.5-pro', 'gemini-1.5', 0.00125, 0.005, 0, 0, 'Gemini 1.5 Pro'),
('google', 'gemini-1.5-flash', 'gemini-1.5', 0.000075, 0.0003, 0, 0, 'Gemini 1.5 Flash'),
('google', 'gemini-2.0-flash', 'gemini-2', 0.00015, 0.0006, 0, 0, 'Gemini 2.0 Flash'),
-- AWS Bedrock (approximate)
('aws-bedrock', 'anthropic.claude-3-sonnet-20240229-v1:0', 'claude-3', 0.003, 0.015, 0, 0, 'Claude 3 Sonnet on Bedrock'),
('aws-bedrock', 'anthropic.claude-3-haiku-20240307-v1:0', 'claude-3', 0.00025, 0.00125, 0, 0, 'Claude 3 Haiku on Bedrock'),
('aws-bedrock', 'amazon.titan-text-express-v1', 'titan', 0.0002, 0.0006, 0, 0, 'Amazon Titan Express'),
-- Azure OpenAI (same as OpenAI base pricing, region markup applied at runtime)
('azure-openai', 'gpt-4o', 'gpt-4', 0.0025, 0.01, 0.00125, 0, 'GPT-4o on Azure'),
('azure-openai', 'gpt-4o-mini', 'gpt-4', 0.00015, 0.0006, 0.000075, 0, 'GPT-4o Mini on Azure'),
('azure-openai', 'gpt-4-turbo', 'gpt-4', 0.01, 0.03, 0, 0, 'GPT-4 Turbo on Azure'),
-- Ollama (local, no cost)
('ollama', 'gpt-oss', 'local', 0, 0, 0, 0, 'Local GPT-OSS model'),
('ollama', 'llama3.1:70b', 'llama', 0, 0, 0, 0, 'Local Llama 3.1 70B'),
('ollama', 'qwen2.5-coder:32b', 'qwen', 0, 0, 0, 0, 'Local Qwen 2.5 Coder 32B'),
('ollama', 'mistral:7b', 'mistral', 0, 0, 0, 0, 'Local Mistral 7B')
ON CONFLICT ("provider", "model", "effective_date") DO NOTHING;

-- ============================================================================
-- USER GROUPS - For chargeback grouping
-- ============================================================================

CREATE TABLE IF NOT EXISTS "admin"."user_groups" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL UNIQUE,
    "display_name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "parent_group_id" UUID REFERENCES "admin"."user_groups"("id"),
    "cost_center" VARCHAR(50),                    -- External cost center code
    "billing_contact_email" VARCHAR(255),
    "metadata" JSONB DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID REFERENCES "public"."users"("id"),
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_user_groups_name" ON "admin"."user_groups"("name");
CREATE INDEX "idx_user_groups_parent" ON "admin"."user_groups"("parent_group_id");
CREATE INDEX "idx_user_groups_cost_center" ON "admin"."user_groups"("cost_center");

-- ============================================================================
-- USER GROUP MEMBERSHIPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS "admin"."user_group_memberships" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
    "group_id" UUID NOT NULL REFERENCES "admin"."user_groups"("id") ON DELETE CASCADE,
    "role" VARCHAR(50) DEFAULT 'member',          -- member, admin, billing
    "is_primary" BOOLEAN DEFAULT false,           -- Primary group for billing
    "joined_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "added_by" UUID REFERENCES "public"."users"("id"),

    CONSTRAINT "user_group_membership_unique" UNIQUE ("user_id", "group_id")
);

CREATE INDEX "idx_user_group_memberships_user" ON "admin"."user_group_memberships"("user_id");
CREATE INDEX "idx_user_group_memberships_group" ON "admin"."user_group_memberships"("group_id");

-- ============================================================================
-- COST BUDGETS - Per user and per group budgets
-- ============================================================================

CREATE TABLE IF NOT EXISTS "admin"."cost_budgets" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "budget_type" VARCHAR(20) NOT NULL,           -- 'user', 'group', 'global'
    "user_id" UUID REFERENCES "public"."users"("id") ON DELETE CASCADE,
    "group_id" UUID REFERENCES "admin"."user_groups"("id") ON DELETE CASCADE,

    -- Budget amounts
    "daily_limit" DECIMAL(10, 2),                 -- Daily spend limit in USD
    "weekly_limit" DECIMAL(10, 2),                -- Weekly spend limit
    "monthly_limit" DECIMAL(10, 2) NOT NULL,      -- Monthly spend limit
    "annual_limit" DECIMAL(10, 2),                -- Annual spend limit

    -- Alert thresholds (percentage of limit)
    "alert_threshold_50" BOOLEAN DEFAULT true,    -- Alert at 50%
    "alert_threshold_75" BOOLEAN DEFAULT true,    -- Alert at 75%
    "alert_threshold_90" BOOLEAN DEFAULT true,    -- Alert at 90%
    "alert_threshold_100" BOOLEAN DEFAULT true,   -- Alert at 100%

    -- Action on limit reached
    "action_on_limit" VARCHAR(20) DEFAULT 'warn', -- 'warn', 'throttle', 'block'
    "throttle_to_model" VARCHAR(100),             -- Model to throttle to (e.g., gpt-3.5-turbo)

    -- Notifications
    "notify_emails" TEXT[],                       -- Additional emails to notify
    "notify_slack_channel" VARCHAR(100),          -- Slack channel for alerts

    -- Period tracking
    "current_period_start" DATE NOT NULL DEFAULT CURRENT_DATE,
    "current_spend" DECIMAL(10, 6) DEFAULT 0,     -- Current period spend

    "is_active" BOOLEAN DEFAULT true,
    "created_by" UUID REFERENCES "public"."users"("id"),
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT "cost_budget_scope" CHECK (
        (budget_type = 'user' AND user_id IS NOT NULL AND group_id IS NULL) OR
        (budget_type = 'group' AND group_id IS NOT NULL AND user_id IS NULL) OR
        (budget_type = 'global' AND user_id IS NULL AND group_id IS NULL)
    )
);

CREATE INDEX "idx_cost_budgets_user" ON "admin"."cost_budgets"("user_id");
CREATE INDEX "idx_cost_budgets_group" ON "admin"."cost_budgets"("group_id");
CREATE INDEX "idx_cost_budgets_type" ON "admin"."cost_budgets"("budget_type");

-- ============================================================================
-- CHARGEBACK REPORTS - Monthly/periodic chargeback reports
-- ============================================================================

CREATE TABLE IF NOT EXISTS "admin"."chargeback_reports" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "report_period" VARCHAR(7) NOT NULL,          -- YYYY-MM format
    "group_id" UUID REFERENCES "admin"."user_groups"("id"),
    "user_id" UUID REFERENCES "public"."users"("id"),
    "cost_center" VARCHAR(50),

    -- Token metrics
    "total_input_tokens" BIGINT DEFAULT 0,
    "total_output_tokens" BIGINT DEFAULT 0,
    "total_cached_tokens" BIGINT DEFAULT 0,
    "total_thinking_tokens" BIGINT DEFAULT 0,

    -- Cost breakdown by provider
    "cost_by_provider" JSONB DEFAULT '{}',        -- { "anthropic": 10.50, "openai": 5.25 }

    -- Cost breakdown by model
    "cost_by_model" JSONB DEFAULT '{}',           -- { "claude-sonnet-4-20250514": 8.00, "gpt-4o": 5.25 }

    -- Total costs
    "total_llm_cost" DECIMAL(10, 6) DEFAULT 0,    -- Total LLM API costs
    "total_mcp_cost" DECIMAL(10, 6) DEFAULT 0,    -- Total MCP tool costs (if any)
    "total_compute_cost" DECIMAL(10, 6) DEFAULT 0, -- Total code execution costs
    "total_storage_cost" DECIMAL(10, 6) DEFAULT 0, -- Total storage costs
    "total_cost" DECIMAL(10, 6) DEFAULT 0,        -- Grand total

    -- Usage metrics
    "total_requests" INT DEFAULT 0,
    "total_sessions" INT DEFAULT 0,
    "total_workflow_executions" INT DEFAULT 0,
    "total_code_executions" INT DEFAULT 0,

    -- Status
    "status" VARCHAR(20) DEFAULT 'draft',         -- draft, finalized, exported, paid
    "finalized_at" TIMESTAMP,
    "exported_at" TIMESTAMP,
    "export_format" VARCHAR(20),                  -- csv, pdf, json

    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT "chargeback_report_scope" UNIQUE ("report_period", "group_id", "user_id")
);

CREATE INDEX "idx_chargeback_reports_period" ON "admin"."chargeback_reports"("report_period");
CREATE INDEX "idx_chargeback_reports_group" ON "admin"."chargeback_reports"("group_id");
CREATE INDEX "idx_chargeback_reports_user" ON "admin"."chargeback_reports"("user_id");

-- ============================================================================
-- ENHANCED TOKEN USAGE - Add provider and pricing reference
-- ============================================================================

ALTER TABLE "admin"."token_usage"
ADD COLUMN IF NOT EXISTS "provider" VARCHAR(50),
ADD COLUMN IF NOT EXISTS "cached_tokens" INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS "thinking_tokens" INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS "input_cost" DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS "output_cost" DECIMAL(10, 6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS "pricing_id" UUID REFERENCES "admin"."model_pricing"("id"),
ADD COLUMN IF NOT EXISTS "group_id" UUID REFERENCES "admin"."user_groups"("id"),
ADD COLUMN IF NOT EXISTS "workflow_execution_id" UUID,
ADD COLUMN IF NOT EXISTS "request_metadata" JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "idx_token_usage_provider" ON "admin"."token_usage"("provider");
CREATE INDEX IF NOT EXISTS "idx_token_usage_group" ON "admin"."token_usage"("group_id");
CREATE INDEX IF NOT EXISTS "idx_token_usage_workflow" ON "admin"."token_usage"("workflow_execution_id");
CREATE INDEX IF NOT EXISTS "idx_token_usage_timestamp_user" ON "admin"."token_usage"("timestamp", "user_id");

-- ============================================================================
-- WORKFLOWS - Core workflow definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."workflows" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,                  -- ReactFlow nodes + edges
    "triggers" JSONB DEFAULT '[]',                -- Webhook, schedule, event configs
    "settings" JSONB DEFAULT '{}',                -- Global workflow settings
    "variables" JSONB DEFAULT '{}',               -- Workflow-level variables

    -- Ownership
    "created_by" UUID NOT NULL REFERENCES "public"."users"("id"),
    "group_id" UUID REFERENCES "admin"."user_groups"("id"),

    -- Status
    "is_active" BOOLEAN DEFAULT true,
    "is_template" BOOLEAN DEFAULT false,
    "is_public" BOOLEAN DEFAULT false,            -- Public template

    -- Metadata
    "tags" TEXT[] DEFAULT '{}',
    "category" VARCHAR(50),
    "icon" VARCHAR(50),
    "color" VARCHAR(20),

    -- Statistics
    "total_executions" INT DEFAULT 0,
    "successful_executions" INT DEFAULT 0,
    "failed_executions" INT DEFAULT 0,
    "avg_execution_time_ms" INT,
    "total_cost" DECIMAL(10, 6) DEFAULT 0,

    -- Rate limiting
    "max_concurrent_executions" INT DEFAULT 5,
    "max_executions_per_hour" INT DEFAULT 100,
    "max_cost_per_execution" DECIMAL(10, 2) DEFAULT 10,

    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "deleted_at" TIMESTAMP                        -- Soft delete
);

CREATE INDEX "idx_workflows_created_by" ON "public"."workflows"("created_by");
CREATE INDEX "idx_workflows_group" ON "public"."workflows"("group_id");
CREATE INDEX "idx_workflows_is_active" ON "public"."workflows"("is_active");
CREATE INDEX "idx_workflows_category" ON "public"."workflows"("category");
CREATE INDEX "idx_workflows_is_template" ON "public"."workflows"("is_template", "is_public");

-- ============================================================================
-- WORKFLOW VERSIONS - Version history
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."workflow_versions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workflow_id" UUID NOT NULL REFERENCES "public"."workflows"("id") ON DELETE CASCADE,
    "version" INT NOT NULL,
    "definition" JSONB NOT NULL,
    "triggers" JSONB DEFAULT '[]',
    "settings" JSONB DEFAULT '{}',
    "changelog" TEXT,
    "is_active" BOOLEAN DEFAULT false,
    "created_by" UUID NOT NULL REFERENCES "public"."users"("id"),
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT "workflow_version_unique" UNIQUE ("workflow_id", "version")
);

CREATE INDEX "idx_workflow_versions_workflow" ON "public"."workflow_versions"("workflow_id");
CREATE INDEX "idx_workflow_versions_is_active" ON "public"."workflow_versions"("workflow_id", "is_active");

-- ============================================================================
-- WORKFLOW EXECUTIONS - Execution instances with persistent state
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."workflow_executions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workflow_id" UUID NOT NULL REFERENCES "public"."workflows"("id"),
    "version_id" UUID REFERENCES "public"."workflow_versions"("id"),

    -- Trigger info
    "trigger_type" VARCHAR(20) NOT NULL,          -- webhook, schedule, manual, event
    "trigger_data" JSONB,
    "webhook_id" VARCHAR(100),                    -- For webhook triggers

    -- Execution state (persistent for resume)
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, running, paused, completed, failed, cancelled
    "current_node_id" VARCHAR(100),
    "state" JSONB NOT NULL DEFAULT '{}',          -- Full execution state snapshot
    "node_outputs" JSONB DEFAULT '{}',            -- Output per node
    "checkpoints" JSONB DEFAULT '[]',             -- Array of checkpoint snapshots

    -- Input/Output
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "error_node_id" VARCHAR(100),

    -- Metrics
    "total_nodes" INT DEFAULT 0,
    "completed_nodes" INT DEFAULT 0,
    "execution_time_ms" INT,
    "cost" DECIMAL(10, 6) DEFAULT 0,

    -- Ownership
    "started_by" UUID REFERENCES "public"."users"("id"),
    "group_id" UUID REFERENCES "admin"."user_groups"("id"),

    -- Timing
    "started_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "completed_at" TIMESTAMP,
    "paused_at" TIMESTAMP,
    "resume_at" TIMESTAMP                         -- Scheduled resume time
);

CREATE INDEX "idx_workflow_executions_workflow" ON "public"."workflow_executions"("workflow_id");
CREATE INDEX "idx_workflow_executions_status" ON "public"."workflow_executions"("status");
CREATE INDEX "idx_workflow_executions_started_by" ON "public"."workflow_executions"("started_by");
CREATE INDEX "idx_workflow_executions_started_at" ON "public"."workflow_executions"("started_at");
CREATE INDEX "idx_workflow_executions_webhook" ON "public"."workflow_executions"("webhook_id");

-- ============================================================================
-- WORKFLOW APPROVALS - Human-in-the-loop approval requests
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."workflow_approvals" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "execution_id" UUID NOT NULL REFERENCES "public"."workflow_executions"("id") ON DELETE CASCADE,
    "node_id" VARCHAR(100) NOT NULL,

    -- Approval configuration
    "required_approvers" TEXT[] NOT NULL,         -- User IDs or group names
    "required_count" INT DEFAULT 1,               -- Number of approvals needed
    "timeout_seconds" INT DEFAULT 86400,          -- 24 hour default
    "timeout_action" VARCHAR(20) DEFAULT 'reject', -- approve, reject, escalate

    -- Approval status
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, approved, rejected, timeout, escalated
    "approved_by" TEXT[] DEFAULT '{}',
    "rejected_by" UUID REFERENCES "public"."users"("id"),
    "escalated_to" TEXT[],

    -- Context
    "message" TEXT,                               -- Message shown to approvers
    "context_data" JSONB,                         -- Additional context
    "response" TEXT,                              -- Approver's response/comment

    -- Notifications
    "notification_channels" TEXT[] DEFAULT '{}', -- email, slack, teams
    "notifications_sent" JSONB DEFAULT '[]',

    -- Timing
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "timeout_at" TIMESTAMP NOT NULL,
    "decided_at" TIMESTAMP
);

CREATE INDEX "idx_workflow_approvals_execution" ON "public"."workflow_approvals"("execution_id");
CREATE INDEX "idx_workflow_approvals_status" ON "public"."workflow_approvals"("status");
CREATE INDEX "idx_workflow_approvals_timeout" ON "public"."workflow_approvals"("timeout_at") WHERE "status" = 'pending';

-- ============================================================================
-- WORKFLOW EXECUTION LOGS - Detailed execution logs
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."workflow_execution_logs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "execution_id" UUID NOT NULL REFERENCES "public"."workflow_executions"("id") ON DELETE CASCADE,
    "node_id" VARCHAR(100),
    "level" VARCHAR(10) NOT NULL,                 -- debug, info, warn, error
    "message" TEXT NOT NULL,
    "data" JSONB,
    "trace_id" VARCHAR(100),                      -- OpenTelemetry trace ID
    "span_id" VARCHAR(100),                       -- OpenTelemetry span ID
    "timestamp" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_workflow_execution_logs_execution" ON "public"."workflow_execution_logs"("execution_id");
CREATE INDEX "idx_workflow_execution_logs_timestamp" ON "public"."workflow_execution_logs"("timestamp");
CREATE INDEX "idx_workflow_execution_logs_level" ON "public"."workflow_execution_logs"("level");
CREATE INDEX "idx_workflow_execution_logs_trace" ON "public"."workflow_execution_logs"("trace_id");

-- ============================================================================
-- WORKFLOW WEBHOOKS - Webhook trigger endpoints
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."workflow_webhooks" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workflow_id" UUID NOT NULL REFERENCES "public"."workflows"("id") ON DELETE CASCADE,
    "webhook_key" VARCHAR(64) NOT NULL UNIQUE,    -- Random key for URL
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,

    -- Security
    "secret" VARCHAR(100),                        -- HMAC secret for verification
    "allowed_ips" TEXT[],                         -- IP whitelist
    "require_auth" BOOLEAN DEFAULT false,

    -- Configuration
    "method" VARCHAR(10) DEFAULT 'POST',          -- HTTP method
    "response_mode" VARCHAR(20) DEFAULT 'async',  -- async (immediate 202), sync (wait for result)
    "timeout_ms" INT DEFAULT 30000,               -- For sync mode

    -- Rate limiting
    "rate_limit_per_minute" INT DEFAULT 60,

    -- Statistics
    "total_calls" INT DEFAULT 0,
    "last_called_at" TIMESTAMP,

    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_workflow_webhooks_workflow" ON "public"."workflow_webhooks"("workflow_id");
CREATE INDEX "idx_workflow_webhooks_key" ON "public"."workflow_webhooks"("webhook_key");

-- ============================================================================
-- WORKFLOW SCHEDULES - Cron-based triggers
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."workflow_schedules" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workflow_id" UUID NOT NULL REFERENCES "public"."workflows"("id") ON DELETE CASCADE,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,

    -- Schedule configuration
    "cron_expression" VARCHAR(100) NOT NULL,      -- Standard cron format
    "timezone" VARCHAR(50) DEFAULT 'UTC',
    "input_template" JSONB DEFAULT '{}',          -- Input for each execution

    -- Status
    "is_active" BOOLEAN DEFAULT true,
    "next_run_at" TIMESTAMP,
    "last_run_at" TIMESTAMP,
    "last_run_status" VARCHAR(20),

    -- Statistics
    "total_runs" INT DEFAULT 0,
    "successful_runs" INT DEFAULT 0,
    "failed_runs" INT DEFAULT 0,

    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_workflow_schedules_workflow" ON "public"."workflow_schedules"("workflow_id");
CREATE INDEX "idx_workflow_schedules_next_run" ON "public"."workflow_schedules"("next_run_at") WHERE "is_active" = true;

-- ============================================================================
-- WORKFLOW SECRETS - Metadata for ESO-managed secrets
-- NOTE: Actual secret values are stored in External Secrets Operator (ESO)
-- This table stores metadata and references to ESO ExternalSecret resources
-- ============================================================================

CREATE TABLE IF NOT EXISTS "admin"."workflow_secrets" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,                 -- Secret name (matches K8s secret name)
    "description" TEXT,

    -- Scope
    "scope" VARCHAR(20) NOT NULL,                 -- global, group, workflow
    "group_id" UUID REFERENCES "admin"."user_groups"("id") ON DELETE CASCADE,
    "workflow_id" UUID REFERENCES "public"."workflows"("id") ON DELETE CASCADE,

    -- ESO Configuration (External Secrets Operator)
    -- These fields define how ESO should fetch the secret
    "eso_enabled" BOOLEAN NOT NULL DEFAULT true,  -- Use ESO (required for K8s deployments)
    "eso_secret_store" VARCHAR(100) NOT NULL DEFAULT 'openagentic-secrets', -- ESO SecretStore/ClusterSecretStore name
    "eso_secret_store_kind" VARCHAR(50) DEFAULT 'ClusterSecretStore', -- SecretStore or ClusterSecretStore
    "eso_remote_ref" JSONB NOT NULL,              -- { "key": "path/to/secret", "property": "value" }

    -- Supported ESO backends (configured in SecretStore):
    -- - AWS Secrets Manager: { "key": "prod/openagentic/api-keys", "property": "openai" }
    -- - Azure Key Vault: { "key": "openai-api-key" }
    -- - GCP Secret Manager: { "key": "projects/123/secrets/openai-key/versions/latest" }
    -- - HashiCorp Vault: { "key": "secret/data/openagentic/api-keys", "property": "openai" }

    -- K8s Secret reference (created by ESO)
    "k8s_secret_name" VARCHAR(100),               -- K8s Secret name (auto-generated if null)
    "k8s_secret_namespace" VARCHAR(100) DEFAULT 'openagentic',
    "k8s_secret_key" VARCHAR(100) DEFAULT 'value', -- Key within the K8s Secret

    -- Fallback: Direct encrypted value (for local/dev only, NOT for production)
    -- WARNING: Only use this for local development without ESO
    "encrypted_value" TEXT,                       -- AES-256-GCM encrypted, base64 encoded
    "encryption_key_id" VARCHAR(100),             -- Reference to encryption key

    -- Metadata
    "version" INT DEFAULT 1,
    "last_rotated_at" TIMESTAMP,
    "expires_at" TIMESTAMP,
    "rotation_schedule" VARCHAR(50),              -- Cron expression for rotation

    -- Access control
    "allowed_node_types" TEXT[],                  -- Which node types can access
    "allowed_users" UUID[],                       -- Specific users (optional)
    "allowed_groups" UUID[],                      -- Specific groups (optional)

    -- Audit
    "last_accessed_at" TIMESTAMP,
    "access_count" INT DEFAULT 0,

    "created_by" UUID REFERENCES "public"."users"("id"),
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT "workflow_secret_scope" CHECK (
        (scope = 'global' AND group_id IS NULL AND workflow_id IS NULL) OR
        (scope = 'group' AND group_id IS NOT NULL AND workflow_id IS NULL) OR
        (scope = 'workflow' AND workflow_id IS NOT NULL)
    ),
    CONSTRAINT "workflow_secret_name_scope" UNIQUE ("name", "scope", "group_id", "workflow_id"),
    CONSTRAINT "workflow_secret_eso_or_encrypted" CHECK (
        eso_enabled = true OR encrypted_value IS NOT NULL
    )
);

CREATE INDEX "idx_workflow_secrets_scope" ON "admin"."workflow_secrets"("scope");
CREATE INDEX "idx_workflow_secrets_group" ON "admin"."workflow_secrets"("group_id");
CREATE INDEX "idx_workflow_secrets_workflow" ON "admin"."workflow_secrets"("workflow_id");
CREATE INDEX "idx_workflow_secrets_k8s" ON "admin"."workflow_secrets"("k8s_secret_name", "k8s_secret_namespace");

-- ============================================================================
-- ESO SECRET STORES - Track configured ESO SecretStores
-- ============================================================================

CREATE TABLE IF NOT EXISTS "admin"."eso_secret_stores" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL UNIQUE,          -- SecretStore name in K8s
    "kind" VARCHAR(50) NOT NULL DEFAULT 'ClusterSecretStore', -- SecretStore or ClusterSecretStore
    "provider" VARCHAR(50) NOT NULL,              -- aws, azure, gcp, vault, kubernetes

    -- Provider-specific configuration reference
    -- Note: Actual credentials are in K8s, this is just metadata
    "provider_config" JSONB NOT NULL,             -- Provider-specific config (no secrets!)
    -- AWS: { "service": "SecretsManager", "region": "us-east-1", "role": "arn:aws:iam::..." }
    -- Azure: { "vaultUrl": "https://myvault.vault.azure.net", "tenantId": "..." }
    -- GCP: { "projectID": "my-project" }
    -- Vault: { "server": "https://vault.example.com", "path": "secret" }

    -- Health
    "last_health_check" TIMESTAMP,
    "health_status" VARCHAR(20) DEFAULT 'unknown', -- healthy, degraded, unhealthy, unknown
    "health_message" TEXT,

    -- Usage stats
    "secrets_count" INT DEFAULT 0,
    "last_sync_at" TIMESTAMP,

    "is_default" BOOLEAN DEFAULT false,           -- Default store for new secrets
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_eso_secret_stores_provider" ON "admin"."eso_secret_stores"("provider");
CREATE INDEX "idx_eso_secret_stores_is_default" ON "admin"."eso_secret_stores"("is_default");

-- ============================================================================
-- RATE LIMITS - Per-user/group rate limiting configuration
-- ============================================================================

CREATE TABLE IF NOT EXISTS "admin"."rate_limits" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,

    -- Scope
    "scope" VARCHAR(20) NOT NULL,                 -- global, group, user
    "group_id" UUID REFERENCES "admin"."user_groups"("id") ON DELETE CASCADE,
    "user_id" UUID REFERENCES "public"."users"("id") ON DELETE CASCADE,

    -- Rate limits
    "requests_per_minute" INT DEFAULT 60,
    "requests_per_hour" INT DEFAULT 1000,
    "requests_per_day" INT DEFAULT 10000,

    -- Token limits
    "tokens_per_minute" INT DEFAULT 100000,
    "tokens_per_hour" INT DEFAULT 1000000,
    "tokens_per_day" INT DEFAULT 10000000,

    -- Workflow limits
    "workflow_executions_per_hour" INT DEFAULT 100,
    "concurrent_workflows" INT DEFAULT 10,

    -- Code execution limits
    "code_executions_per_hour" INT DEFAULT 50,
    "code_execution_timeout_seconds" INT DEFAULT 300,

    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT "rate_limit_scope" CHECK (
        (scope = 'global' AND group_id IS NULL AND user_id IS NULL) OR
        (scope = 'group' AND group_id IS NOT NULL AND user_id IS NULL) OR
        (scope = 'user' AND user_id IS NOT NULL)
    )
);

CREATE INDEX "idx_rate_limits_scope" ON "admin"."rate_limits"("scope");
CREATE INDEX "idx_rate_limits_group" ON "admin"."rate_limits"("group_id");
CREATE INDEX "idx_rate_limits_user" ON "admin"."rate_limits"("user_id");

-- ============================================================================
-- WORKFLOW TESTS - Test definitions for workflows
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."workflow_tests" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "workflow_id" UUID NOT NULL REFERENCES "public"."workflows"("id") ON DELETE CASCADE,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,

    -- Test configuration
    "input" JSONB NOT NULL,
    "mocks" JSONB DEFAULT '{}',                   -- Mock responses for nodes
    "assertions" JSONB NOT NULL DEFAULT '[]',     -- Array of assertions

    -- Expected results
    "expected_output" JSONB,
    "expected_nodes_called" TEXT[],
    "expected_max_duration_ms" INT,

    -- Last run
    "last_run_at" TIMESTAMP,
    "last_run_passed" BOOLEAN,
    "last_run_error" TEXT,
    "last_run_duration_ms" INT,

    "is_active" BOOLEAN DEFAULT true,
    "created_by" UUID REFERENCES "public"."users"("id"),
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_workflow_tests_workflow" ON "public"."workflow_tests"("workflow_id");

-- ============================================================================
-- Add foreign key to token_usage for workflow execution
-- ============================================================================

ALTER TABLE "admin"."token_usage"
ADD CONSTRAINT "fk_token_usage_workflow_execution"
FOREIGN KEY ("workflow_execution_id")
REFERENCES "public"."workflow_executions"("id")
ON DELETE SET NULL;

-- ============================================================================
-- FUNCTIONS - Utility functions
-- ============================================================================

-- Function to calculate cost for a token usage record
CREATE OR REPLACE FUNCTION calculate_token_cost(
    p_provider VARCHAR,
    p_model VARCHAR,
    p_input_tokens INT,
    p_output_tokens INT,
    p_cached_tokens INT DEFAULT 0,
    p_thinking_tokens INT DEFAULT 0
) RETURNS DECIMAL(10, 6) AS $$
DECLARE
    v_pricing RECORD;
    v_total_cost DECIMAL(10, 6);
BEGIN
    -- Get current pricing
    SELECT * INTO v_pricing
    FROM "admin"."model_pricing"
    WHERE provider = p_provider
      AND model = p_model
      AND (end_date IS NULL OR end_date > NOW())
    ORDER BY effective_date DESC
    LIMIT 1;

    IF v_pricing IS NULL THEN
        -- Fallback to conservative estimate
        RETURN ((p_input_tokens + p_output_tokens) / 1000.0) * 0.01;
    END IF;

    -- Calculate total cost
    v_total_cost :=
        (p_input_tokens / 1000.0) * v_pricing.input_cost_per_1k +
        (p_output_tokens / 1000.0) * v_pricing.output_cost_per_1k +
        (p_cached_tokens / 1000.0) * COALESCE(v_pricing.cached_input_cost_per_1k, 0) +
        (p_thinking_tokens / 1000.0) * COALESCE(v_pricing.thinking_cost_per_1k, 0);

    RETURN ROUND(v_total_cost, 6);
END;
$$ LANGUAGE plpgsql;

-- Function to update chargeback report for a period
CREATE OR REPLACE FUNCTION update_chargeback_report(
    p_report_period VARCHAR,
    p_group_id UUID DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_report_id UUID;
    v_cost_by_provider JSONB;
    v_cost_by_model JSONB;
BEGIN
    -- Upsert the report
    INSERT INTO "admin"."chargeback_reports" (
        report_period, group_id, user_id
    ) VALUES (
        p_report_period, p_group_id, p_user_id
    )
    ON CONFLICT (report_period, group_id, user_id) DO UPDATE
    SET updated_at = NOW()
    RETURNING id INTO v_report_id;

    -- Calculate aggregates from token_usage
    UPDATE "admin"."chargeback_reports" cr
    SET
        total_input_tokens = agg.total_input,
        total_output_tokens = agg.total_output,
        total_cached_tokens = agg.total_cached,
        total_thinking_tokens = agg.total_thinking,
        total_llm_cost = agg.total_cost,
        total_cost = agg.total_cost,
        total_requests = agg.request_count,
        cost_by_provider = agg.provider_costs,
        cost_by_model = agg.model_costs
    FROM (
        SELECT
            COALESCE(SUM(prompt_tokens), 0) as total_input,
            COALESCE(SUM(completion_tokens), 0) as total_output,
            COALESCE(SUM(cached_tokens), 0) as total_cached,
            COALESCE(SUM(thinking_tokens), 0) as total_thinking,
            COALESCE(SUM(total_cost), 0) as total_cost,
            COUNT(*) as request_count,
            jsonb_object_agg(COALESCE(provider, 'unknown'), provider_cost) as provider_costs,
            jsonb_object_agg(model, model_cost) as model_costs
        FROM (
            SELECT
                provider,
                model,
                SUM(prompt_tokens) as prompt_tokens,
                SUM(completion_tokens) as completion_tokens,
                SUM(cached_tokens) as cached_tokens,
                SUM(thinking_tokens) as thinking_tokens,
                SUM(total_cost) as total_cost,
                SUM(total_cost) as provider_cost,
                SUM(total_cost) as model_cost
            FROM "admin"."token_usage"
            WHERE TO_CHAR(timestamp, 'YYYY-MM') = p_report_period
              AND (p_group_id IS NULL OR group_id = p_group_id)
              AND (p_user_id IS NULL OR user_id = p_user_id)
            GROUP BY provider, model
        ) subq
        GROUP BY (SELECT 1)  -- Force single row
    ) agg
    WHERE cr.id = v_report_id;

    RETURN v_report_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update budget current_spend on token_usage insert
CREATE OR REPLACE FUNCTION update_budget_on_token_usage() RETURNS TRIGGER AS $$
BEGIN
    -- Update user budget
    UPDATE "admin"."cost_budgets"
    SET current_spend = current_spend + NEW.total_cost,
        updated_at = NOW()
    WHERE budget_type = 'user'
      AND user_id = NEW.user_id
      AND is_active = true
      AND current_period_start <= CURRENT_DATE;

    -- Update group budget if group_id is set
    IF NEW.group_id IS NOT NULL THEN
        UPDATE "admin"."cost_budgets"
        SET current_spend = current_spend + NEW.total_cost,
            updated_at = NOW()
        WHERE budget_type = 'group'
          AND group_id = NEW.group_id
          AND is_active = true
          AND current_period_start <= CURRENT_DATE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_budget_on_token_usage
AFTER INSERT ON "admin"."token_usage"
FOR EACH ROW
EXECUTE FUNCTION update_budget_on_token_usage();

-- ============================================================================
-- DEFAULT DATA
-- ============================================================================

-- Create default global rate limit
INSERT INTO "admin"."rate_limits" (
    "name", "scope", "requests_per_minute", "requests_per_hour", "tokens_per_minute"
) VALUES (
    'Default Global', 'global', 100, 5000, 200000
) ON CONFLICT DO NOTHING;

-- Create default global budget (unlimited)
INSERT INTO "admin"."cost_budgets" (
    "name", "budget_type", "monthly_limit", "action_on_limit"
) VALUES (
    'Default Global', 'global', 999999.99, 'warn'
) ON CONFLICT DO NOTHING;

COMMENT ON TABLE "admin"."model_pricing" IS 'Accurate per-model pricing for cost calculation';
COMMENT ON TABLE "admin"."user_groups" IS 'User groups for chargeback and access control';
COMMENT ON TABLE "admin"."cost_budgets" IS 'Budget limits per user/group with alerting';
COMMENT ON TABLE "admin"."chargeback_reports" IS 'Monthly chargeback reports per user/group';
COMMENT ON TABLE "public"."workflows" IS 'Workflow definitions with ReactFlow nodes/edges';
COMMENT ON TABLE "public"."workflow_executions" IS 'Workflow execution instances with persistent state';
COMMENT ON TABLE "public"."workflow_approvals" IS 'Human-in-the-loop approval requests';
COMMENT ON TABLE "admin"."workflow_secrets" IS 'Encrypted secrets for workflow nodes';
COMMENT ON TABLE "admin"."rate_limits" IS 'Rate limiting configuration per scope';
