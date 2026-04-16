-- Copyright (c) 2024-2026 OpenAgentic LLC. All rights reserved.
-- Proprietary and confidential. Unauthorized copying prohibited.

-- Cleanup script to remove synthesis instruction messages that were incorrectly saved
-- Run this against the OpenAgentic PostgreSQL database

-- First, let's see how many messages match (DRY RUN)
SELECT id, role, LEFT(content, 100) as content_preview, "createdAt"
FROM "ChatMessage"
WHERE role = 'user'
  AND (
    content ILIKE '%synthesize all the tool results%'
    OR content ILIKE '%Do NOT request any more tools%'
    OR content ILIKE '%provide a comprehensive final response%'
    OR (content ILIKE '%You have executed%' AND content ILIKE '%tools%')
  )
ORDER BY "createdAt" DESC
LIMIT 20;

-- Count total matches
SELECT COUNT(*) as synthesis_messages_to_delete
FROM "ChatMessage"
WHERE role = 'user'
  AND (
    content ILIKE '%synthesize all the tool results%'
    OR content ILIKE '%Do NOT request any more tools%'
    OR content ILIKE '%provide a comprehensive final response%'
    OR (content ILIKE '%You have executed%' AND content ILIKE '%tools%')
  );

-- UNCOMMENT BELOW TO ACTUALLY DELETE (after verifying the SELECT above)
-- DELETE FROM "ChatMessage"
-- WHERE role = 'user'
--   AND (
--     content ILIKE '%synthesize all the tool results%'
--     OR content ILIKE '%Do NOT request any more tools%'
--     OR content ILIKE '%provide a comprehensive final response%'
--     OR (content ILIKE '%You have executed%' AND content ILIKE '%tools%')
--   );

-- Also clean up any repetitive garbage content (finalized results spam)
SELECT id, role, LEFT(content, 100) as content_preview, LENGTH(content) as content_length, "createdAt"
FROM "ChatMessage"
WHERE (
  content ILIKE '%finalized results. finalized results%'
  OR content ILIKE '%synthesize. synthesize. synthesize%'
  OR content ILIKE '%apologize. apologize%'
  OR (LENGTH(content) > 5000 AND content ~ '(\w+\.\s*){50,}')
)
ORDER BY "createdAt" DESC
LIMIT 20;

-- UNCOMMENT TO DELETE repetitive garbage
-- DELETE FROM "ChatMessage"
-- WHERE (
--   content ILIKE '%finalized results. finalized results%'
--   OR content ILIKE '%synthesize. synthesize. synthesize%'
--   OR content ILIKE '%apologize. apologize%'
-- );
