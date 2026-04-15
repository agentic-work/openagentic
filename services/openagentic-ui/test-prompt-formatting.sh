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


echo "Testing new prompt formatting..."

# Test with a simple query
RESPONSE=$(curl -s -X POST http://localhost:8000/api/chat/completion \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-token-admin" \
  -d '{
    "sessionId": "test-session-prompt-check",
    "message": "List the top 3 Azure services for data storage and briefly explain each one.",
    "userId": "40037806-f729-4813-9561-72982a12031f"
  }')

echo "Response received:"
echo "$RESPONSE" | jq -r '.message // .error // .'

# Count bullet points in response
BULLET_COUNT=$(echo "$RESPONSE" | grep -o "\-" | wc -l)
echo ""
echo "Bullet point count: $BULLET_COUNT"

if [ $BULLET_COUNT -gt 10 ]; then
  echo "❌ FAIL: Too many bullet points detected ($BULLET_COUNT)"
  exit 1
else
  echo "✅ PASS: Reasonable bullet point usage ($BULLET_COUNT)"
  exit 0
fi
