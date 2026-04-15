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

-- Add credential expiry tracking to LLM providers
-- Date: 2026-02-18
-- Bolt: 03c - Credential Expiry Tracking
-- Allows tracking when provider auth_config credentials expire for key rotation alerts

ALTER TABLE "admin"."llm_providers" ADD COLUMN "credentials_expires_at" TIMESTAMP(3);
