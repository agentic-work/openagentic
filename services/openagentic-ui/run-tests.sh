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

export BASE_URL="https://ai.openagentics.io"
export ADMIN_EMAIL="admin@openagentics.io"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:?ADMIN_PASSWORD env var required}"

mkdir -p e2e/screenshots
npx playwright test e2e/comprehensive-features.spec.ts --project=chromium --reporter=list
