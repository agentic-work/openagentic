-- Router-tuning functionality fix (2026-05-24): per-model
-- function-calling-accuracy becomes a first-class column instead of an
-- optional key buried in the untyped `capabilities` JSON blob.
--
-- Root cause it fixes: SmartModelRouter.createProfileFromDiscovery read FCA
-- only from capabilities JSON (defaulting to 0 when absent). Every live
-- registry row had an empty blob, so all models scored FCA=0, failed every
-- RouterTuning FCA floor, and the router could never select on capability
-- or route DOWN to a cheap model. The RouterTuningLab showed "no enabled
-- models with FCA + cost".
--
-- Nullable, no default: NULL means "not yet seeded/set". The boot-time
-- backfill seeds it from the ModelCapabilityRegistry benchmark table where
-- NULL; admins can override via the Add/Edit-Model UI.
ALTER TABLE "admin"."model_role_assignments"
  ADD COLUMN "function_calling_accuracy" DOUBLE PRECISION;
