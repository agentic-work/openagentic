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
 * Lottie Admin Icons
 *
 * Creates React icon components backed by Lottie animations.
 * Each component matches the admin sidebar icon interface: { size, className, color, style }.
 * Drop-in replacements for the SVG icons in AdminIcons.tsx.
 */

import React from 'react';
import { LottieIcon } from '../components/LottieIcon';
import { getAdminAnimation } from './adminAnimations';
import type { LottieAnimationData } from './lottieBuilder';

interface IconProps {
  size?: number;
  className?: string;
  color?: string;
  style?: React.CSSProperties;
}

/**
 * Factory: creates a React icon component from a Lottie animation
 */
function createLottieIconComponent(
  animation: LottieAnimationData,
  displayName: string
): React.FC<IconProps> {
  const Component: React.FC<IconProps> = ({ size = 16, className, style }) => (
    <LottieIcon
      animationData={animation}
      size={size}
      className={className}
      style={style}
      loop
      speed={0.7}
    />
  );
  Component.displayName = displayName;
  return Component;
}

// ─── Child Item Icons (replacements for SVG icons in sidebar) ─────────

export const LottieUsersIcon = createLottieIconComponent(
  getAdminAnimation('users'), 'LottieUsersIcon'
);

export const LottieCogIcon = createLottieIconComponent(
  getAdminAnimation('cog'), 'LottieCogIcon'
);

export const LottieChartIcon = createLottieIconComponent(
  getAdminAnimation('chart'), 'LottieChartIcon'
);

export const LottieShieldIcon = createLottieIconComponent(
  getAdminAnimation('shield'), 'LottieShieldIcon'
);

export const LottieLockIcon = createLottieIconComponent(
  getAdminAnimation('lock'), 'LottieLockIcon'
);

export const LottieKeyIcon = createLottieIconComponent(
  getAdminAnimation('key'), 'LottieKeyIcon'
);

export const LottieDatabaseIcon = createLottieIconComponent(
  getAdminAnimation('database'), 'LottieDatabaseIcon'
);

export const LottieTerminalIcon = createLottieIconComponent(
  getAdminAnimation('terminal'), 'LottieTerminalIcon'
);

export const LottieNetworkIcon = createLottieIconComponent(
  getAdminAnimation('network'), 'LottieNetworkIcon'
);

export const LottieFolderIcon = createLottieIconComponent(
  getAdminAnimation('folder'), 'LottieFolderIcon'
);

export const LottieCubeIcon = createLottieIconComponent(
  getAdminAnimation('cube'), 'LottieCubeIcon'
);

export const LottieLogsIcon = createLottieIconComponent(
  getAdminAnimation('logs'), 'LottieLogsIcon'
);

export const LottieGridIcon = createLottieIconComponent(
  getAdminAnimation('grid'), 'LottieGridIcon'
);

export const LottiePromptIcon = createLottieIconComponent(
  getAdminAnimation('prompt'), 'LottiePromptIcon'
);

export const LottieTemplateIcon = createLottieIconComponent(
  getAdminAnimation('template'), 'LottieTemplateIcon'
);

export const LottieTrendingIcon = createLottieIconComponent(
  getAdminAnimation('trending'), 'LottieTrendingIcon'
);

export const LottieZapIcon = createLottieIconComponent(
  getAdminAnimation('zap'), 'LottieZapIcon'
);

export const LottieActivityIcon = createLottieIconComponent(
  getAdminAnimation('activity'), 'LottieActivityIcon'
);

export const LottieClockIcon = createLottieIconComponent(
  getAdminAnimation('clock'), 'LottieClockIcon'
);

// ─── Additional admin icons from AdminIcon.tsx (Nerd Font → Lottie) ──

export const LottieSparkleIcon = createLottieIconComponent(
  getAdminAnimation('prompt'), 'LottieSparkleIcon'
);

export const LottieServerRackIcon = createLottieIconComponent(
  getAdminAnimation('cube'), 'LottieServerRackIcon'
);

export const LottieToolsIcon = createLottieIconComponent(
  getAdminAnimation('settings'), 'LottieToolsIcon'
);

export const LottieAnalyticsIcon = createLottieIconComponent(
  getAdminAnimation('analytics'), 'LottieAnalyticsIcon'
);

// ─── Unique child item icons (no more duplicates) ────────────────────

export const LottieRobotIcon = createLottieIconComponent(
  getAdminAnimation('robot'), 'LottieRobotIcon'
);

export const LottieCrewIcon = createLottieIconComponent(
  getAdminAnimation('crew'), 'LottieCrewIcon'
);

export const LottieTestTubeIcon = createLottieIconComponent(
  getAdminAnimation('testtube'), 'LottieTestTubeIcon'
);

export const LottieRocketIcon = createLottieIconComponent(
  getAdminAnimation('rocket'), 'LottieRocketIcon'
);

export const LottieGlobeIcon = createLottieIconComponent(
  getAdminAnimation('globe'), 'LottieGlobeIcon'
);

export const LottieHandIcon = createLottieIconComponent(
  getAdminAnimation('hand'), 'LottieHandIcon'
);

export const LottieChainIcon = createLottieIconComponent(
  getAdminAnimation('chain'), 'LottieChainIcon'
);

export const LottieMergeIcon = createLottieIconComponent(
  getAdminAnimation('merge'), 'LottieMergeIcon'
);

export const LottieLoopIcon = createLottieIconComponent(
  getAdminAnimation('loop'), 'LottieLoopIcon'
);

export const LottieBranchIcon = createLottieIconComponent(
  getAdminAnimation('branch'), 'LottieBranchIcon'
);

export const LottieTargetIcon = createLottieIconComponent(
  getAdminAnimation('target'), 'LottieTargetIcon'
);

export const LottiePlayExecIcon = createLottieIconComponent(
  getAdminAnimation('playExec'), 'LottiePlayExecIcon'
);

export const LottieFeedbackIcon = createLottieIconComponent(
  getAdminAnimation('feedback'), 'LottieFeedbackIcon'
);

export const LottieCostCoinIcon = createLottieIconComponent(
  getAdminAnimation('costCoin'), 'LottieCostCoinIcon'
);

export const LottieContextWinIcon = createLottieIconComponent(
  getAdminAnimation('contextWin'), 'LottieContextWinIcon'
);

export const LottieAuthAccessIcon = createLottieIconComponent(
  getAdminAnimation('authAccess'), 'LottieAuthAccessIcon'
);

export const LottieRateLimitIcon = createLottieIconComponent(
  getAdminAnimation('rateLimit'), 'LottieRateLimitIcon'
);

export const LottieEmbeddingsIcon = createLottieIconComponent(
  getAdminAnimation('embeddings'), 'LottieEmbeddingsIcon'
);

export const LottiePerformanceIcon = createLottieIconComponent(
  getAdminAnimation('performance'), 'LottiePerformanceIcon'
);

export const LottiePipelineIcon = createLottieIconComponent(
  getAdminAnimation('pipeConfig'), 'LottiePipelineIcon'
);

export const LottieOllamaIcon = createLottieIconComponent(
  getAdminAnimation('ollama'), 'LottieOllamaIcon'
);

export const LottieMultiModelIcon = createLottieIconComponent(
  getAdminAnimation('multiModel'), 'LottieMultiModelIcon'
);

export const LottieTieredFCIcon = createLottieIconComponent(
  getAdminAnimation('tieredFC'), 'LottieTieredFCIcon'
);

export const LottieK8sIcon = createLottieIconComponent(
  getAdminAnimation('k8sConfig'), 'LottieK8sIcon'
);

export const LottieFwMgmtIcon = createLottieIconComponent(
  getAdminAnimation('fwMgmt'), 'LottieFwMgmtIcon'
);

export const LottieAgenticLoopIcon = createLottieIconComponent(
  getAdminAnimation('agenticLoop'), 'LottieAgenticLoopIcon'
);

export const LottieFlowExecIcon = createLottieIconComponent(
  getAdminAnimation('flowExec'), 'LottieFlowExecIcon'
);

export const LottieSynthConfigIcon = createLottieIconComponent(
  getAdminAnimation('synthConfig'), 'LottieSynthConfigIcon'
);

export const LottieSynthApprovalIcon = createLottieIconComponent(
  getAdminAnimation('synthApproval'), 'LottieSynthApprovalIcon'
);

export const LottieSynthStatsIcon = createLottieIconComponent(
  getAdminAnimation('synthStats'), 'LottieSynthStatsIcon'
);

export const LottieWfAdminIcon = createLottieIconComponent(
  getAdminAnimation('wfAdmin'), 'LottieWfAdminIcon'
);

export const LottieWfManagerIcon = createLottieIconComponent(
  getAdminAnimation('wfManager'), 'LottieWfManagerIcon'
);

export const LottieWfUsersIcon = createLottieIconComponent(
  getAdminAnimation('wfUsers'), 'LottieWfUsersIcon'
);

export const LottieWfSettingsIcon = createLottieIconComponent(
  getAdminAnimation('wfSettings'), 'LottieWfSettingsIcon'
);

// ─── Deduplicated admin child icons ─────────────────────────────────

export const LottieCodeSettingsIcon = createLottieIconComponent(
  getAdminAnimation('codeSettings'), 'LottieCodeSettingsIcon'
);
export const LottieSkillsIcon = createLottieIconComponent(
  getAdminAnimation('skills'), 'LottieSkillsIcon'
);
export const LottieAuditLogIcon = createLottieIconComponent(
  getAdminAnimation('auditLog'), 'LottieAuditLogIcon'
);
export const LottieUserPermIcon = createLottieIconComponent(
  getAdminAnimation('userPerm'), 'LottieUserPermIcon'
);
export const LottieApiTokenIcon = createLottieIconComponent(
  getAdminAnimation('apiToken'), 'LottieApiTokenIcon'
);
export const LottieSysPerformanceIcon = createLottieIconComponent(
  getAdminAnimation('sysPerf'), 'LottieSysPerformanceIcon'
);
export const LottieMonitorLogsIcon = createLottieIconComponent(
  getAdminAnimation('monitorLogs'), 'LottieMonitorLogsIcon'
);
