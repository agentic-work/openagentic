/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Maintenance mode control
// This file can be modified to enable/disable maintenance mode
if (typeof MAINTENANCE_MODE !== 'undefined' && MAINTENANCE_MODE === true) {
  localStorage.setItem('maintenance_mode', 'true');
} else if (typeof MAINTENANCE_MODE !== 'undefined' && MAINTENANCE_MODE === false) {
  localStorage.removeItem('maintenance_mode');
}