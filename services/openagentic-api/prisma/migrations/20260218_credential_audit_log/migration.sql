-- Copyright (c) 2024-2026 OpenAgentic LLC. All rights reserved.
-- Proprietary and confidential. Unauthorized copying prohibited.

-- Credential Audit Log - Tracks admin CRUD operations on LLM providers, MCP servers, API keys
-- Date: 2026-02-18
-- Bolt: 03 - Credential Change Audit Logging

CREATE SCHEMA IF NOT EXISTS "admin";

CREATE TABLE IF NOT EXISTS "admin"."credential_audit_log" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" VARCHAR(255) NOT NULL,
    "user_email" VARCHAR(255),
    "action" VARCHAR(50) NOT NULL,         -- create, update, delete, view, enable, disable
    "entity_type" VARCHAR(50) NOT NULL,     -- llm_provider, mcp_server, api_key
    "entity_id" VARCHAR(255) NOT NULL,
    "entity_name" VARCHAR(255),
    "changes" JSONB,                        -- { field: { old: x, new: y } } for updates
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS "credential_audit_log_user_id_idx" ON "admin"."credential_audit_log" ("user_id");
CREATE INDEX IF NOT EXISTS "credential_audit_log_entity_type_idx" ON "admin"."credential_audit_log" ("entity_type");
CREATE INDEX IF NOT EXISTS "credential_audit_log_entity_id_idx" ON "admin"."credential_audit_log" ("entity_id");
CREATE INDEX IF NOT EXISTS "credential_audit_log_action_idx" ON "admin"."credential_audit_log" ("action");
CREATE INDEX IF NOT EXISTS "credential_audit_log_created_at_idx" ON "admin"."credential_audit_log" ("created_at");
