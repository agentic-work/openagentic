-- Copyright (c) 2024-2026 OpenAgentic LLC. All rights reserved.
-- Proprietary and confidential. Unauthorized copying prohibited.

-- Add credential expiry tracking to LLM providers
-- Date: 2026-02-18
-- Bolt: 03c - Credential Expiry Tracking
-- Allows tracking when provider auth_config credentials expire for key rotation alerts

ALTER TABLE "admin"."llm_providers" ADD COLUMN "credentials_expires_at" TIMESTAMP(3);
