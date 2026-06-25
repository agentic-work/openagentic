-- ============================================================================
-- OpenAgentic DB security hardening — consolidated, idempotent, OSS-robust.
-- ============================================================================
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The boot path syncs schema with `prisma db push` (see docker-entrypoint.sh).
-- `db push` is schema-only: it creates tables/columns but SKIPS the raw-SQL
-- security objects that live in prisma/migrations/ (row-level-security policies
-- and audit-immutability triggers). Those never shipped on a stock install.
--
-- This file consolidates every one of those security objects into ONE place
-- and is applied right after `db push` succeeds, on EVERY boot. It satisfies:
--   * NIST 800-53 AC-4  — Row-Level Security for multi-tenant data isolation
--   * NIST 800-53 AU-9  — Audit-record immutability (no UPDATE / DELETE)
--
-- INVARIANTS (every statement here must uphold these)
-- ---------------------------------------------------
--   1. IDEMPOTENT — safe to re-run on every boot. No statement errors if the
--      object already exists. Postgres has no `CREATE POLICY IF NOT EXISTS`,
--      so every policy is guarded by a `NOT EXISTS (SELECT 1 FROM pg_policies …)`
--      check. Triggers use `DROP TRIGGER IF EXISTS … ; CREATE TRIGGER …`.
--   2. OSS-ROBUST — every table is guarded with an existence check, so tables
--      that are absent in the OSS schema (code_sessions, synth_capability_audit,
--      credential_exchange_audit, and the ~20 expansion tables) are skipped
--      cleanly and never raise.
--   3. SURGICAL audit triggers — immutability triggers are added ONLY to the 4
--      deliberate append-only audit logs. The app legitimately UPDATEs other
--      tables (e.g. tool_call_attempt); adding a trigger there would brick it.
--
-- Rollback (manual): per-table `DROP POLICY … ; ALTER TABLE … DISABLE ROW LEVEL
-- SECURITY;` and `DROP TRIGGER audit_immutable_* … ; DROP FUNCTION
-- prevent_audit_modification();`.
-- ============================================================================


-- ============================================================================
-- SECTION A — Base user-scoped RLS
-- (from 20260218_row_level_security, made idempotent + existence-guarded)
--
-- chat_sessions / llm_request_logs / code_sessions → user_id isolation.
-- chat_messages → session-scoped (join through chat_sessions).
-- Each table also gets an admin_bypass policy (app.current_user_id = '__system__').
-- ============================================================================

-- (A.1) Direct user_id tables: chat_sessions (public), llm_request_logs (admin),
--       code_sessions (public, absent in OSS — guarded).
DO $$
DECLARE
    t record;
    base_tables CURSOR FOR
        SELECT schemaname, tablename
        FROM (
            VALUES
                ('public', 'chat_sessions'),
                ('admin',  'llm_request_logs'),
                ('public', 'code_sessions')
        ) AS t(schemaname, tablename);
BEGIN
    FOR t IN base_tables LOOP
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
                EXECUTE format(
                    'CREATE POLICY %I ON %I.%I USING (user_id = current_setting(''app.current_user_id'', true)::text) WITH CHECK (user_id = current_setting(''app.current_user_id'', true)::text)',
                    t.tablename || '_user_isolation', t.schemaname, t.tablename
                );
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = t.schemaname AND tablename = t.tablename
                  AND policyname = t.tablename || '_admin_bypass'
            ) THEN
                EXECUTE format(
                    'CREATE POLICY %I ON %I.%I USING (current_setting(''app.current_user_id'', true) = ''__system__'')',
                    t.tablename || '_admin_bypass', t.schemaname, t.tablename
                );
            END IF;
        END IF;
    END LOOP;
END
$$;

-- (A.2) Session-scoped: chat_messages (public) — join through chat_sessions.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'chat_messages'
    ) THEN
        ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.chat_messages FORCE ROW LEVEL SECURITY;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'chat_messages'
              AND policyname = 'chat_messages_user_isolation'
        ) THEN
            CREATE POLICY chat_messages_user_isolation ON public.chat_messages
                USING (session_id IN (
                    SELECT id FROM public.chat_sessions
                    WHERE user_id = current_setting('app.current_user_id', true)::text
                ))
                WITH CHECK (session_id IN (
                    SELECT id FROM public.chat_sessions
                    WHERE user_id = current_setting('app.current_user_id', true)::text
                ));
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'chat_messages'
              AND policyname = 'chat_messages_admin_bypass'
        ) THEN
            CREATE POLICY chat_messages_admin_bypass ON public.chat_messages
                USING (current_setting('app.current_user_id', true) = '__system__');
        END IF;
    END IF;
END
$$;


-- ============================================================================
-- SECTION B — Expanded RLS coverage
-- (body copied VERBATIM from 20260418_rls_expansion — already idempotent +
--  IF EXISTS guarded: the ~20 user_id tables, session-scoped tables,
--  tool-result caches, the users table, and admin.data_access_audit.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Direct user_id tables (public schema)
-- ----------------------------------------------------------------------------

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
        -- Only enable/policy tables that actually exist AND carry a user_id
        -- column in this schema. The OSS schema has diverged from the upstream
        -- this list was written against (e.g. chat_metrics is session-scoped,
        -- not user-scoped, here), so the column guard keeps this clean on OSS.
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = tbl
              AND column_name = 'user_id'
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

-- ----------------------------------------------------------------------------
-- Session-scoped tables (public schema) — join through chat_sessions
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'file_attachments',
        'conversation_branches'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        -- Guard on the session_id column (not just table existence) so a
        -- diverged OSS table without session_id is skipped cleanly.
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = tbl
              AND column_name = 'session_id'
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

-- ----------------------------------------------------------------------------
-- Tool-result caches with shared-verified carve-out
-- Per-user rows follow the user_id rule; rows marked is_verified=true or
-- is_shared=true are readable across users (the org-verified shared
-- knowledge base from task #83).
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    t record;
    shared_carveout text;
    tables_cursor CURSOR FOR
        SELECT schemaname, tablename, user_col
        FROM (
            VALUES
                ('public',  'tool_result_cache',     'original_user_id'),
                ('public',  'verified_tool_results', 'user_id')
        ) AS t(schemaname, tablename, user_col);
BEGIN
    FOR t IN tables_cursor LOOP
        -- Guard on the user_col existing (not just table existence) so a
        -- diverged OSS table is skipped cleanly.
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = t.schemaname AND table_name = t.tablename
              AND column_name = t.user_col
        ) THEN
            EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
            EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', t.schemaname, t.tablename);

            IF NOT EXISTS (
                SELECT 1 FROM pg_policies
                WHERE schemaname = t.schemaname AND tablename = t.tablename
                  AND policyname = t.tablename || '_user_isolation'
            ) THEN
                -- Build the shared/verified carve-out OR-terms only for the
                -- boolean columns that actually exist on this table (OSS
                -- divergence: tool_result_cache has is_shared but not
                -- is_verified; verified_tool_results is the inverse).
                shared_carveout := '';
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = t.schemaname AND table_name = t.tablename
                      AND column_name = 'is_verified'
                ) THEN
                    shared_carveout := shared_carveout || ' OR COALESCE(is_verified, false) = true';
                END IF;
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = t.schemaname AND table_name = t.tablename
                      AND column_name = 'is_shared'
                ) THEN
                    shared_carveout := shared_carveout || ' OR COALESCE(is_shared, false) = true';
                END IF;

                -- USING allows read if: (a) owner, (b) admin context, (c) row is verified/shared
                -- WITH CHECK only permits writes to owner's rows; admin can write anywhere.
                EXECUTE format(
                    'CREATE POLICY %I ON %I.%I
                     USING (%I = current_setting(''app.current_user_id'', true)::text
                            OR current_setting(''app.current_user_id'', true) = ''__system__''%s)
                     WITH CHECK (%I = current_setting(''app.current_user_id'', true)::text
                                 OR current_setting(''app.current_user_id'', true) = ''__system__'')',
                    t.tablename || '_user_isolation',
                    t.schemaname, t.tablename,
                    t.user_col, shared_carveout, t.user_col
                );
            END IF;
        END IF;
    END LOOP;
END
$$;

-- ----------------------------------------------------------------------------
-- users table — self-read only (plus admin bypass)
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- Append-only cross-user access audit table
-- Written by DataAccessAuditService on tool invocation, RLS reject, and
-- any cross-user attempt. Readable only with admin context.
-- ----------------------------------------------------------------------------

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


-- ============================================================================
-- SECTION C — AU-9 audit immutability
-- (from 20260218_audit_immutable, made idempotent + existence-guarded)
--
-- A shared trigger function RAISEs on any UPDATE / DELETE. It is attached ONLY
-- to the 4 deliberate append-only audit logs. Do NOT extend this list to tables
-- the app legitimately mutates (e.g. tool_call_attempt) — that would brick it.
-- ============================================================================

-- Shared trigger function that blocks UPDATE and DELETE on audit tables.
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are immutable - modifications are prohibited (NIST 800-53 AU-9)';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Attach the immutability trigger to each audit table IF IT EXISTS.
-- DROP … IF EXISTS + CREATE makes this re-runnable on every boot.
DO $$
DECLARE
    t record;
    audit_tables CURSOR FOR
        SELECT schemaname, tablename, trigname
        FROM (
            VALUES
                ('admin',  'admin_audit_log',            'audit_immutable_admin_audit_log'),
                ('admin',  'user_query_audit',           'audit_immutable_user_query_audit'),
                ('public', 'credential_exchange_audit',  'audit_immutable_credential_exchange_audit'),
                ('public', 'synth_capability_audit',     'audit_immutable_synth_capability_audit')
        ) AS t(schemaname, tablename, trigname);
BEGIN
    FOR t IN audit_tables LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = t.schemaname AND table_name = t.tablename
        ) THEN
            EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I', t.trigname, t.schemaname, t.tablename);
            EXECUTE format(
                'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification()',
                t.trigname, t.schemaname, t.tablename
            );
        END IF;
    END LOOP;
END
$$;
