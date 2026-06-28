-- Runs once on first-boot of the postgres volume.
-- Prisma schema uses pgvector's `halfvec` type for embeddings, so the
-- extension must exist before `prisma db push` tries to create those tables.
CREATE EXTENSION IF NOT EXISTS vector;
