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
