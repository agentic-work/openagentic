#!/bin/bash
# Copyright 2026 Gnomus.ai
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.


echo "=== Testing Natural Prompt Formatting ==="
echo ""

# Simple streaming test to check response format
RESPONSE=$(curl -s -X POST http://localhost:8000/api/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token-admin" \
  -d '{
    "sessionId": "test-'$(date +%s)'",
    "message": "What are the main Azure compute services?",
    "userId": "40037806-f729-4813-9561-72982a12031f"
  }' | head -100)

echo "First 100 lines of response:"
echo "$RESPONSE"
echo ""

# Count markdown bullet points (lines starting with "- ")
BULLET_LINES=$(echo "$RESPONSE" | grep -c "^- ")
echo "Lines starting with markdown bullets: $BULLET_LINES"

# Count numbered lists (lines starting with "1. ", "2. ", etc)
NUMBERED_LINES=$(echo "$RESPONSE" | grep -cE "^[0-9]+\. ")
echo "Lines starting with numbered lists: $NUMBERED_LINES"

TOTAL_LIST_LINES=$((BULLET_LINES + NUMBERED_LINES))
echo "Total list-formatted lines: $TOTAL_LIST_LINES"

if [ $TOTAL_LIST_LINES -gt 15 ]; then
  echo ""
  echo "❌ CONCERN: Many list-formatted lines detected"
else
  echo ""
  echo "✅ GOOD: Reasonable formatting"
fi
