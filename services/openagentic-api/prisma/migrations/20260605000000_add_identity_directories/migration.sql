-- Identity Directories — runtime, DB-driven SSO identity providers.
-- 1:1 analogue of admin.llm_providers: env seeds the first row on boot, then the
-- DB is the SINGLE SOURCE OF TRUTH (hot-reloaded via atomic-swap, no API restart).
-- clientSecret lives inside auth_config and is encrypted by
-- CredentialEncryptionService ('clientSecret' is in SENSITIVE_FIELDS).
-- Date: 2026-06-05

CREATE SCHEMA IF NOT EXISTS "admin";

-- CreateTable
CREATE TABLE "admin"."identity_directories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "auth_config" JSONB NOT NULL DEFAULT '{}',
    "tenant_id" TEXT,
    "authority" TEXT,
    "issuer" TEXT,
    "redirect_uri" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discovery" JSONB,
    "group_claim" TEXT DEFAULT 'groups',
    "authorized_groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "admin_groups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "group_role_mappings" JSONB NOT NULL DEFAULT '{}',
    "external_admin_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allow_all_authenticated" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "identity_directories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identity_directories_name_key" ON "admin"."identity_directories"("name");

-- CreateIndex
CREATE INDEX "identity_directories_type_idx" ON "admin"."identity_directories"("type");

-- CreateIndex
CREATE INDEX "identity_directories_enabled_idx" ON "admin"."identity_directories"("enabled");

-- CreateIndex
CREATE INDEX "identity_directories_priority_idx" ON "admin"."identity_directories"("priority");

-- AddForeignKey
ALTER TABLE "admin"."identity_directories" ADD CONSTRAINT "identity_directories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin"."identity_directories" ADD CONSTRAINT "identity_directories_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
