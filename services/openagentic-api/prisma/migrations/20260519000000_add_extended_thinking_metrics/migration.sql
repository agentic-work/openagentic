-- Task B.1 (2026-05-19): Extended Thinking Metrics table
-- Tracks per-turn extended thinking requested vs delivered, thinking token
-- counts, and durations. Admin surface: /api/admin/analytics/extended-thinking

-- CreateTable
CREATE TABLE "admin"."extended_thinking_metrics" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "session_id" TEXT,
    "message_id" TEXT,
    "provider_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requested" BOOLEAN NOT NULL,
    "delivered" BOOLEAN NOT NULL,
    "thinking_tokens" INTEGER,
    "thinking_duration_ms" INTEGER,
    "total_output_tokens" INTEGER,
    "total_turn_ms" INTEGER,

    CONSTRAINT "extended_thinking_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "extended_thinking_metrics_message_id_key" ON "admin"."extended_thinking_metrics"("message_id");

-- CreateIndex
CREATE INDEX "extended_thinking_metrics_created_at_idx" ON "admin"."extended_thinking_metrics"("created_at");

-- CreateIndex
CREATE INDEX "extended_thinking_metrics_user_id_created_at_idx" ON "admin"."extended_thinking_metrics"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "extended_thinking_metrics_model_created_at_idx" ON "admin"."extended_thinking_metrics"("model", "created_at");
