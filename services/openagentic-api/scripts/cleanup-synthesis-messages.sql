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
