/**
 * LLMProviderManagement — routed entry.
 *
 * Wraps the decomposed implementation under ./LLMProviderManagement/ with
 * the universal admin PageHeader so this page wears the same chrome as
 * every other admin surface. Implementation details (CRUD, panels, modals)
 * live in the subfolder and are not touched here.
 */
import React from 'react';
import { PageHeader } from '../../primitives-v2';
import { LLMProviderManagement as LLMProviderManagementInner } from './LLMProviderManagement/index';

interface LLMProviderManagementProps {
  theme: string;
}

export const LLMProviderManagement: React.FC<LLMProviderManagementProps> = (props) => (
  <div className="space-y-5">
    <PageHeader
      crumbs={['Admin', 'LLM', 'Providers']}
      title="Providers"
      explainer="Configure LLM providers, rotate credentials, and inspect health and metrics across the registered fleet."
    />
    <LLMProviderManagementInner {...props} />
  </div>
);

export default LLMProviderManagement;
