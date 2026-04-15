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

// Global type augmentations and compatibility fixes
// Note: We don't redefine JSX namespace as React already provides it

// Extend existing window interface if needed
declare global {
  // Build-time platform version baked in by vite.config.ts `define`
  const __APP_VERSION__: string;

  interface Window {
    // Add any custom window properties here if needed
  }
}

// The lucide-react package already has type definitions
// We don't need to declare them here as they conflict

export {};