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

/**
 * Workflow Templates — DEPRECATED
 * Templates now come exclusively from the API (GET /api/workflows/templates).
 * This file only exports the WorkflowTemplateItem type for backward compatibility.
 */

import type { WorkflowDefinition } from '../types/workflow.types';

export interface WorkflowTemplateItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  definition: WorkflowDefinition;
}

// Templates are now API-seeded only — no frontend-hardcoded templates
export const workflowTemplates: WorkflowTemplateItem[] = [];
