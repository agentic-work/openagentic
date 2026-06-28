/**
 * ArtifactsSection - inline accordion body for the Flows sidebar.
 * Renders the real artifacts list (workflow-generated outputs persisted
 * via persistArtifact) by delegating to the shared section-body renderer.
 */

import React from 'react';
import { renderSectionBody } from './SidebarSectionModal';

export const ArtifactsSection: React.FC = () => (
  <>{renderSectionBody({ section: 'artifacts' })}</>
);
