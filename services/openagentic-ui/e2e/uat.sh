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

# UAT Interactive Driver wrapper
# Usage: ./e2e/uat.sh <command> [args...]
# Example: ./e2e/uat.sh login
#          ./e2e/uat.sh sendwait "List all Azure subscriptions"
#          ./e2e/uat.sh screenshot

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LD_LIBRARY_PATH="/home/trent/.local/lib/playwright-deps:${LD_LIBRARY_PATH:-}"
export HEADLESS="${HEADLESS:-true}"

exec npx tsx "$SCRIPT_DIR/e2e/interactive-driver.ts" "$@"
