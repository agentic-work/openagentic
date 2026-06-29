-- Drop Code Mode tables and columns. Code Mode is removed from the OSS edition;
-- the code-execution service, UI, API routes, and Prisma models that backed it
-- have all been deleted. This migration removes the now-orphaned schema.
--
-- Safe on fresh installs (IF EXISTS guards every drop) and on upgrades (CASCADE
-- removes any FK references from already-removed parent tables).

-- Parent tables (have FKs from CodeExecution / WorkspaceSnapshot)
DROP TABLE IF EXISTS "public"."code_sessions" CASCADE;

-- AWCode (legacy code-mode session backend)
DROP TABLE IF EXISTS "public"."awcode_messages" CASCADE;
DROP TABLE IF EXISTS "public"."awcode_sessions" CASCADE;

-- Per-user provisioning state for code-mode containers
DROP TABLE IF EXISTS "public"."code_mode_provisioning" CASCADE;

-- Storage backend config (admin schema)
DROP TABLE IF EXISTS "admin"."code_storage_backends" CASCADE;
DROP TABLE IF EXISTS "public"."code_storage_backends" CASCADE;

-- Execution / snapshot child tables (in case CASCADE didn't already remove them)
DROP TABLE IF EXISTS "public"."code_executions" CASCADE;
DROP TABLE IF EXISTS "public"."workspace_snapshots" CASCADE;

-- Per-user feature-access columns on user permission tables.
-- Wrapped in DO blocks so we don't fail on fresh DBs without these columns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'admin' AND column_name IN ('can_use_awcode', 'code_mode_cli')
  ) THEN
    EXECUTE 'ALTER TABLE "admin"."user_permissions" DROP COLUMN IF EXISTS "can_use_awcode"';
    EXECUTE 'ALTER TABLE "admin"."user_permissions" DROP COLUMN IF EXISTS "code_mode_cli"';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'can_use_awcode'
  ) THEN
    EXECUTE 'ALTER TABLE "public"."user_permissions" DROP COLUMN IF EXISTS "can_use_awcode"';
    EXECUTE 'ALTER TABLE "public"."user_permissions" DROP COLUMN IF EXISTS "code_mode_cli"';
  END IF;
EXCEPTION WHEN undefined_table THEN
  -- Tables may not exist on fresh installs; that's fine.
  NULL;
END $$;
