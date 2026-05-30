-- Copyright (c) 2024-2026 OpenAgentic LLC. All rights reserved.

-- 0.6.6 P1 (UC-A14): seed admin.system_configuration with the HITL policy row.
--
-- Context: ToolApprovalGate reads admin.system_configuration.hitl_policy at
-- loadConfig() to decide whether MEDIUM-risk tools require human approval.
-- Prior behavior was a *runtime* seed in loadConfig() itself — idempotent, but
-- only runs when the gate is first instantiated. On fresh DBs or between the
-- API boot and the first tool call there was a window where the row was
-- missing and the gate fell back to in-memory defaults, which (a) obscured the
-- policy from the admin UI and (b) didn't persist operator tuning.
--
-- This migration creates the row up-front so the admin console has something
-- to read/edit on day 1. HIGH and CRITICAL-risk approvals are structurally
-- enforced in ToolApprovalGate.requiresApproval() and never read from config —
-- the row below only governs MEDIUM-risk routing, timeouts, and trust scoring.

INSERT INTO "admin"."system_configuration"
    ("key", "value", "description", "is_active", "created_at", "updated_at")
VALUES
    (
        'hitl_policy',
        '{"mediumRiskRequiresApproval":true,"timeoutMs":120000,"trustThreshold":0.85,"minCallsForTrust":5,"seededAt":"2026-04-18T00:00:00.000Z","seededBy":"0.6.6_P1_migration"}'::jsonb,
        'HITL approval gate runtime policy. Governs MEDIUM-risk tool routing (HIGH/CRITICAL are structural). Edit via admin UI to tune approval timeouts and trust thresholds.',
        TRUE,
        NOW(),
        NOW()
    )
ON CONFLICT ("key") DO NOTHING;
