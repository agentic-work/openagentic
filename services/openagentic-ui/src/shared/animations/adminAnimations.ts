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
 * Admin Console Lottie Animations
 *
 * Maps admin sidebar icon names to programmatically-generated Lottie animation data.
 * Uses factory functions from lottieBuilder.ts to create each animation.
 */

import type { LottieAnimationData } from './lottieBuilder';
import {
  createUsersGroup,
  createRotatingGear,
  createBarChart,
  createShieldCheck,
  createLock,
  createDatabase,
  createCodeBrackets,
  createNeuralNetwork,
  createTarget,
  createSparkle,
  createFlowingArrows,
  createLightningBolt,
  createPulsingRing,
  createHourglass,
  createPulsingDot,
  createFolder,
  createServerIcon,
  createLogsList,
  createGrid,
  createRobot,
  createCrew,
  createTestTube,
  createRocket,
  createGlobe,
  createHandRaise,
  createChainLinks,
  createMergeArrows,
  createLoopArrows,
  createBranchingPath,
} from './lottieBuilder';

/**
 * Record mapping admin icon names to their Lottie animation data.
 * Keys correspond to sidebar item icon identifiers used in the admin console.
 */
export const adminAnimations: Record<string, LottieAnimationData> = {
  // Core icons
  users:       createUsersGroup('#8b5cf6'),
  cog:         createRotatingGear('#6b7280'),
  settings:    createRotatingGear('#6b7280'),
  chart:       createBarChart('#3b82f6'),
  analytics:   createBarChart('#3b82f6'),
  shield:      createShieldCheck('#ef4444', '#ffffff'),
  security:    createShieldCheck('#ef4444', '#ffffff'),
  lock:        createLock('#f59e0b'),
  key:         createLock('#a855f6'),
  database:    createDatabase('#10b981'),
  terminal:    createCodeBrackets('#10b981'),
  network:     createNeuralNetwork('#3b82f6', '#6366f1'),
  folder:      createFolder('#f97316'),
  cube:        createServerIcon('#7c3aed'),
  logs:        createLogsList('#6b7280'),
  grid:        createGrid('#3b82f6'),
  prompt:      createSparkle('#8b5cf6'),
  template:    createFlowingArrows('#06b6d4'),
  trending:    createBarChart('#10b981'),
  zap:         createLightningBolt('#f59e0b'),
  activity:    createPulsingRing('#ef4444'),
  clock:       createHourglass('#6b7280'),

  // Agent & Framework icons
  robot:       createRobot('#8b5cf6'),
  crew:        createCrew('#f59e0b'),
  testtube:    createTestTube('#ec4899'),
  rocket:      createRocket('#f97316'),
  globe:       createGlobe('#06b6d4'),
  hand:        createHandRaise('#10b981'),
  chain:       createChainLinks('#6366f1'),
  merge:       createMergeArrows('#3b82f6'),
  loop:        createLoopArrows('#a855f6'),
  branch:      createBranchingPath('#10b981', '#3b82f6', '#ef4444'),
  target:      createTarget('#ef4444'),

  // Unique admin child icons (differentiated colors)
  playExec:    createPulsingRing('#10b981'),      // green pulsing for executions
  feedback:    createTarget('#f59e0b'),            // amber target for feedback
  costCoin:    createSparkle('#f59e0b'),           // amber sparkle for costs
  contextWin:  createBranchingPath('#6366f1', '#3b82f6', '#8b5cf6'),
  authAccess:  createShieldCheck('#6366f1', '#ffffff'),  // indigo shield for auth
  rateLimit:   createHourglass('#ef4444'),         // red hourglass for rate limits
  embeddings:  createNeuralNetwork('#ec4899', '#8b5cf6'), // pink neural for embeddings
  performance: createRocket('#3b82f6'),            // blue rocket for performance
  pipeConfig:  createFlowingArrows('#f97316'),     // orange arrows for pipeline
  ollama:      createGlobe('#10b981'),             // green globe for ollama
  multiModel:  createMergeArrows('#8b5cf6'),       // purple merge for multi-model
  tieredFC:    createBranchingPath('#f59e0b', '#10b981', '#ef4444'),
  k8sConfig:   createChainLinks('#3b82f6'),        // blue chains for k8s
  fwMgmt:      createLoopArrows('#f97316'),        // orange loops for framework mgmt
  agenticLoop: createLoopArrows('#8b5cf6'),        // purple loops for agents
  flowExec:    createFlowingArrows('#10b981'),     // green arrows for executions
  synthConfig: createTestTube('#ec4899'),           // pink test tube for synth config
  synthApproval: createHandRaise('#f59e0b'),       // amber hand for approvals
  synthStats:  createBarChart('#ec4899'),           // pink chart for synth stats
  wfAdmin:     createGrid('#f97316'),              // orange grid for workflow admin
  wfManager:   createFolder('#3b82f6'),            // blue folder for workflow mgr
  wfUsers:     createUsersGroup('#10b981'),         // green users for workflow users
  wfSettings:  createRotatingGear('#f97316'),       // orange gear for workflow settings

  // Deduplicated admin child icons (unique per sidebar item)
  codeSettings: createRotatingGear('#10b981'),     // green gear for code mode settings
  skills:       createTarget('#7c3aed'),            // violet target for skills marketplace
  auditLog:     createLogsList('#ef4444'),           // red logs for audit trail
  userPerm:     createUsersGroup('#6366f1'),         // indigo users for user permissions
  apiToken:     createSparkle('#ef4444'),            // red sparkle for API tokens
  sysPerf:      createRocket('#ef4444'),             // red rocket for system performance
  monitorLogs:  createCodeBrackets('#6b7280'),       // gray brackets for monitoring logs
};

/**
 * Retrieve the Lottie animation data for a given admin icon name.
 * Falls back to a generic pulsing dot animation when the name is not found.
 *
 * @param name - The admin icon identifier (e.g. 'users', 'shield', 'database')
 * @returns The corresponding LottieAnimationData
 */
export function getAdminAnimation(name: string): LottieAnimationData {
  return adminAnimations[name] ?? createPulsingDot('#6b7280');
}
