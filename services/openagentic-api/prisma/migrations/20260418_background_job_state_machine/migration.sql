

-- 0.6.6 P8 (task #113): extend BackgroundJob for a proper state machine.
--
-- Existing columns: id, type, prompt, model, priority, status,
-- created_at, started_at, completed_at, result, error, progress,
-- todos, logs, metadata, user_id, session_id.
--
-- New columns:
--   checkpoint_data    JSONB — serialized agent state so a parked job
--                             can resume without re-planning from scratch
--                             (tool-call history, partial outputs, subagent
--                             state).
--   resume_at          TIMESTAMP — set when a job is parked; the
--                             BackgroundJobPoller moves parked jobs whose
--                             resume_at <= now() into 'resumable' state.
--   state_transitions  JSONB — append-only list of [{from,to,ts,reason}]
--                             so admins can forensically answer "why did
--                             this job park?" without digging through logs.
--
-- Status value set (documented in Prisma schema comment):
--   queued → running → [parked → resumable →] running → completed|failed
--   The bracket group is the new cycle that a long-running agent can
--   opt into via ctx.checkpoint({data, resume_at}).
--
-- Rollback: `ALTER TABLE ... DROP COLUMN` for each; data loss is
-- acceptable because no job survives a revert window.

ALTER TABLE "public"."background_jobs"
    ADD COLUMN IF NOT EXISTS "checkpoint_data"   JSONB,
    ADD COLUMN IF NOT EXISTS "resume_at"         TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "state_transitions" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Poller query pattern: "find all parked jobs whose resume_at has passed."
CREATE INDEX IF NOT EXISTS "background_jobs_status_resume_at_idx"
    ON "public"."background_jobs" ("status", "resume_at")
    WHERE "resume_at" IS NOT NULL;
