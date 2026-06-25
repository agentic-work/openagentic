

-- NIST 800-53 AC-4: Row-Level Security for multi-tenant data isolation
-- Ensures users can only access their own data even if application-level checks are bypassed.
-- Uses PostgreSQL session variable app.current_user_id set per-request by the API middleware.

-- ============================================================================
-- chat_sessions: users can only see their own sessions
-- ============================================================================
ALTER TABLE public."chat_sessions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_sessions_user_isolation ON public."chat_sessions"
  USING ("user_id" = current_setting('app.current_user_id', true)::text)
  WITH CHECK ("user_id" = current_setting('app.current_user_id', true)::text);

-- FORCE RLS even for table owners (defense-in-depth)
ALTER TABLE public."chat_sessions" FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- chat_messages: users can only see messages in their own sessions
-- ============================================================================
ALTER TABLE public."chat_messages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_messages_user_isolation ON public."chat_messages"
  USING ("session_id" IN (
    SELECT id FROM public."chat_sessions"
    WHERE "user_id" = current_setting('app.current_user_id', true)::text
  ))
  WITH CHECK ("session_id" IN (
    SELECT id FROM public."chat_sessions"
    WHERE "user_id" = current_setting('app.current_user_id', true)::text
  ));

ALTER TABLE public."chat_messages" FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- llm_request_logs: users can only see their own request logs
-- ============================================================================
ALTER TABLE admin."llm_request_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY llm_request_logs_user_isolation ON admin."llm_request_logs"
  USING ("user_id" = current_setting('app.current_user_id', true)::text)
  WITH CHECK ("user_id" = current_setting('app.current_user_id', true)::text);

ALTER TABLE admin."llm_request_logs" FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- code_sessions: users can only see their own code sessions
-- ============================================================================
ALTER TABLE public."code_sessions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY code_sessions_user_isolation ON public."code_sessions"
  USING ("user_id" = current_setting('app.current_user_id', true)::text)
  WITH CHECK ("user_id" = current_setting('app.current_user_id', true)::text);

ALTER TABLE public."code_sessions" FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- Bypass policy for the application's database role
-- When app.current_user_id is NOT set (empty string or null from current_setting
-- with missing_ok=true), the USING clause evaluates to false, effectively blocking
-- access. The API middleware sets this variable for every authenticated request.
-- For migrations and background jobs, the superuser role bypasses RLS by default.
-- ============================================================================

-- Create a bypass policy for admin operations (e.g., background jobs, migrations)
-- These policies allow access when the session variable indicates admin/system context
CREATE POLICY chat_sessions_admin_bypass ON public."chat_sessions"
  USING (current_setting('app.current_user_id', true) = '__system__');

CREATE POLICY chat_messages_admin_bypass ON public."chat_messages"
  USING (current_setting('app.current_user_id', true) = '__system__');

CREATE POLICY llm_request_logs_admin_bypass ON admin."llm_request_logs"
  USING (current_setting('app.current_user_id', true) = '__system__');

CREATE POLICY code_sessions_admin_bypass ON public."code_sessions"
  USING (current_setting('app.current_user_id', true) = '__system__');
