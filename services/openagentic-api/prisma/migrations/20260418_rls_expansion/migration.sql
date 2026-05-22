-- Copyright (c) 2024-2026 OpenAgentic LLC. All rights reserved.

-- 0.6.6 P5 (task #110): expand FedRAMP AC-4 row-level security coverage.
--
-- The original 20260218_row_level_security migration enabled RLS on
-- chat_sessions, chat_messages, llm_request_logs, and code_sessions.
-- That left ~20 other user-scoped tables unprotected, so a forgotten
-- `WHERE user_id = ?` filter in any Prisma query path still leaked
-- rows across users. This migration closes the gap.
--
-- Policy structure per table:
--   1. Enable RLS
--   2. FORCE RLS (applies even to table owner)
--   3. <table>_user_isolation — row-level policy using app.current_user_id
--   4. <table>_admin_bypass — admin override (app.current_user_id = '__system__')
--
-- See docs/ac/data-isolation-p0.md (§ "v0.6.6 P5 Expansion") for the
-- full threat model, inventory, and acceptance criteria.
--
-- Rollback: per-table `DROP POLICY ... ; ALTER TABLE ... DISABLE ROW LEVEL SECURITY;`

-- Helper function to centralise the policy creation and keep this
-- migration under a sane line count. Stored as a server-side function
-- (scoped to this migration via DO block) so each table doesn't need
-- four CREATE POLICY statements inline.
--
-- Postgres has no CREATE POLICY IF NOT EXISTS, so we guard each block
-- with pg_policy lookups to keep the migration re-runnable during
-- development.

-- ============================================================================
-- Direct user_id tables (public schema)
-- ============================================================================

DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        -- Memory + preferences
        'user_memory',
        'user_memory_entries',
        'user_profile',
        'user_setting',
        'user_settings',
        'user_technique_preference',
        -- Prompts
        'user_prompts',
        'user_prompt_assignments',
        -- Vector routing
        'user_vector_collections',
        -- Activity + audit (read-your-own-writes)
        'user_activity',
        'user_query_audit',
        -- Credentials (highest priority)
        'user_github_credential',
        'user_auth_token',
        -- Session-less metrics that already carry user_id
        'token_usage',
        'response_feedback',
        'multi_model_metrics',
        'chat_metrics',
        -- Tool-learning caches (shared-verified carve-out handled separately below)
        'tool_success_records'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        -- Only enable/policy tables that actually exist in this schema.
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = tbl
        ) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
            EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = tbl
                  AND policyname = tbl || '_user_isolation'
            ) THEN
                EXECUTE format(
                    'CREATE POLICY %I ON public.%I USING (user_id = current_setting(''app.current_user_id'', true)::text) WITH CHECK (user_id = current_setting(''app.current_user_id'', true)::text)',
                    tbl || '_user_isolation', tbl
                );
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = tbl
                  AND policyname = tbl || '_admin_bypass'
            ) THEN
                EXECUTE format(
                    'CREATE POLICY %I ON public.%I USING (current_setting(''app.current_user_id'', true) = ''__system__'')',
                    tbl || '_admin_bypass', tbl
                );
            END IF;
        END IF;
    END LOOP;
END
$$;

-- ============================================================================
-- Session-scoped tables (public schema) — join through chat_sessions
-- ============================================================================

DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'file_attachments',
        'conversation_branches'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = tbl
        ) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
            EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = tbl
                  AND policyname = tbl || '_user_isolation'
            ) THEN
                EXECUTE format(
                    'CREATE POLICY %I ON public.%I USING (session_id IN (SELECT id FROM public.chat_sessions WHERE user_id = current_setting(''app.current_user_id'', true)::text)) WITH CHECK (session_id IN (SELECT id FROM public.chat_sessions WHERE user_id = current_setting(''app.current_user_id'', true)::text))',
                    tbl || '_user_isolation', tbl
                );
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = tbl
                  AND policyname = tbl || '_admin_bypass'
            ) THEN
                EXECUTE format(
                    'CREATE POLICY %I ON public.%I USING (current_setting(''app.current_user_id'', true) = ''__system__'')',
                    tbl || '_admin_bypass', tbl
                );
            END IF;
        END IF;
    END LOOP;
END
$$;

-- ============================================================================
-- Tool-result caches with shared-verified carve-out
-- Per-user rows follow the user_id rule; rows marked is_verified=true or
-- is_shared=true are readable across users (the org-verified shared
-- knowledge base from task #83).
-- ============================================================================

DO $$
DECLARE
    t record;
    tables_cursor CURSOR FOR
        SELECT schemaname, tablename, user_col
        FROM (
            VALUES
                ('public',  'tool_result_cache',     'original_user_id'),
                ('public',  'verified_tool_results', 'user_id')
        ) AS t(schemaname, tablename, user_col);
BEGIN
    FOR t IN tables_cursor LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = t.schemaname AND table_name = t.tablename
        ) THEN
            EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
            EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', t.schemaname, t.tablename);

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = t.schemaname AND tablename = t.tablename
                  AND policyname = t.tablename || '_user_isolation'
            ) THEN
                -- USING allows read if: (a) owner, (b) admin context, (c) row is verified/shared
                -- WITH CHECK only permits writes to owner's rows; admin can write anywhere.
                EXECUTE format(
                    'CREATE POLICY %I ON %I.%I
                     USING (%I = current_setting(''app.current_user_id'', true)::text
                            OR current_setting(''app.current_user_id'', true) = ''__system__''
                            OR COALESCE(is_verified, false) = true
                            OR COALESCE(is_shared, false) = true)
                     WITH CHECK (%I = current_setting(''app.current_user_id'', true)::text
                                 OR current_setting(''app.current_user_id'', true) = ''__system__'')',
                    t.tablename || '_user_isolation',
                    t.schemaname, t.tablename,
                    t.user_col, t.user_col
                );
            END IF;
        END IF;
    END LOOP;
END
$$;

-- ============================================================================
-- users table — self-read only (plus admin bypass)
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users') THEN
        ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='users' AND policyname='users_self_read') THEN
            CREATE POLICY users_self_read ON public.users
                USING (id = current_setting('app.current_user_id', true)::text
                       OR current_setting('app.current_user_id', true) = '__system__');
        END IF;
    END IF;
END
$$;

-- ============================================================================
-- Append-only cross-user access audit table
-- Written by DataAccessAuditService on tool invocation, RLS reject, and
-- any cross-user attempt. Readable only with admin context.
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin.data_access_audit (
    id              BIGSERIAL PRIMARY KEY,
    actor_user_id   TEXT NOT NULL,
    target_user_id  TEXT,
    action          TEXT NOT NULL,                       -- 'query' | 'read' | 'write' | 'delete' | 'cross_user_reject' | 'tool_exec' | 'approval_decision'
    resource        TEXT NOT NULL,                       -- 'chat_session:<id>' | 'milvus:user_<uid>' | 'tool:<name>' | ...
    request_id      TEXT,
    route           TEXT,
    method          TEXT,
    client_ip       TEXT,
    user_agent      TEXT,
    details         JSONB,
    created_at      TIMESTAMP(3) DEFAULT NOW()
);

-- Indexes for typical queries (actor history, target-user forensics, recent events).
CREATE INDEX IF NOT EXISTS data_access_audit_actor_created_idx
    ON admin.data_access_audit (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS data_access_audit_target_created_idx
    ON admin.data_access_audit (target_user_id, created_at DESC)
    WHERE target_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS data_access_audit_action_created_idx
    ON admin.data_access_audit (action, created_at DESC);

-- Append-only: deny UPDATE / DELETE to everyone including the service role.
-- Admin cleanup (retention) uses a superuser migration, not runtime DELETEs.
ALTER TABLE admin.data_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.data_access_audit FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='admin' AND tablename='data_access_audit' AND policyname='data_access_audit_insert') THEN
        CREATE POLICY data_access_audit_insert ON admin.data_access_audit
            FOR INSERT WITH CHECK (true);  -- any authenticated request may write its own audit row
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='admin' AND tablename='data_access_audit' AND policyname='data_access_audit_admin_read') THEN
        CREATE POLICY data_access_audit_admin_read ON admin.data_access_audit
            FOR SELECT USING (current_setting('app.current_user_id', true) = '__system__');
    END IF;
    -- No UPDATE or DELETE policies → append-only.
END
$$;
