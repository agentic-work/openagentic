-- Task #1049 (2026-05-22) — Rip hardcoded SmartModelRouter T3 floors +
-- EXPLICIT_MOST_CAPABLE_RE regex + per-taskType CAPABILITY_PROFILES
-- literals to admin-editable RouterTuning DB columns. Source-of-truth
-- moves from TypeScript constants into this row; admin UI tunes via
-- /admin#router-tuning.
--
-- Adds 5 columns to admin.router_tuning:
--   fcaT3Floor                 — T3 capability gate FCA floor (was 0.93)
--   contextT3Floor             — T3 capability gate context-window floor (was 200000)
--   t3TriggerTaskTypes         — JSON array of TaskType strings that fire the T3 gate
--   capabilityProfileFloors    — JSON map TaskType → required FCA floor
--   capabilityContextFloors    — JSON map TaskType → required context-window tokens

ALTER TABLE "admin"."router_tuning"
  ADD COLUMN "fcaT3Floor" DOUBLE PRECISION NOT NULL DEFAULT 0.93,
  ADD COLUMN "contextT3Floor" INTEGER NOT NULL DEFAULT 200000,
  ADD COLUMN "t3TriggerTaskTypes" JSONB NOT NULL DEFAULT '["cost-audit", "architecture-design-agentic", "multi-cloud-agentic", "multi-system-agentic"]'::jsonb,
  ADD COLUMN "capabilityProfileFloors" JSONB NOT NULL DEFAULT '{"multi-cloud-agentic": 0.90, "multi-system-agentic": 0.90, "cost-analysis-agentic": 0.90, "cost-audit": 0.93, "security-audit-agentic": 0.90, "architecture-design-agentic": 0.90, "single-system-read": 0.85, "file-read": 0.85, "pure-chat": 0.82}'::jsonb,
  ADD COLUMN "capabilityContextFloors" JSONB NOT NULL DEFAULT '{"multi-cloud-agentic": 30000, "multi-system-agentic": 30000, "cost-analysis-agentic": 100000, "cost-audit": 100000, "security-audit-agentic": 30000, "architecture-design-agentic": 30000, "single-system-read": 8000, "file-read": 16000, "pure-chat": 4000}'::jsonb;
