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

-- FedRAMP AU-9: Prevent modifications to audit log records
-- Audit records must be immutable once written to satisfy AU-9 (Protection of Audit Information)

-- Shared trigger function that blocks UPDATE and DELETE on audit tables
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are immutable - modifications are prohibited (FedRAMP AU-9)';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 1. admin_audit_log (admin schema) - Admin action audit trail
CREATE TRIGGER audit_immutable_admin_audit_log
  BEFORE UPDATE OR DELETE ON admin."admin_audit_log"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- 2. user_query_audit (admin schema) - User query/tool call audit trail
CREATE TRIGGER audit_immutable_user_query_audit
  BEFORE UPDATE OR DELETE ON admin."user_query_audit"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- 3. credential_exchange_audit (public schema) - Credential exchange audit trail
-- This table is created via raw SQL in credentials.ts, not Prisma schema.
-- Use IF EXISTS to avoid failure if the table hasn't been created yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credential_exchange_audit') THEN
    EXECUTE 'CREATE TRIGGER audit_immutable_credential_exchange_audit
      BEFORE UPDATE OR DELETE ON "credential_exchange_audit"
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification()';
  END IF;
END $$;

-- 4. synth_capability_audit (public schema) - Synth capability access audit trail
CREATE TRIGGER audit_immutable_synth_capability_audit
  BEFORE UPDATE OR DELETE ON public."synth_capability_audit"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
