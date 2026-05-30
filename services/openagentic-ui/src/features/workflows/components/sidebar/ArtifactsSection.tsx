/**
 * ArtifactsSection - OSS edition shows the enterprise upsell LockScreen.
 * The persistArtifact runtime call in the execution engine is unaffected;
 * only the management UI panel is gated here.
 */

import React from 'react';
import { LockScreen } from '@/features/admin/Upsell';

export const ArtifactsSection: React.FC = () => (
  <LockScreen
    feature="Artifacts"
    description="Browse and search workflow-generated artifacts. Artifacts are saved automatically when a flow node calls persistArtifact."
  />
);
