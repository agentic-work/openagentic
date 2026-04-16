/**
 * Workflow Node Animations
 *
 * Maps each of the 21 workflow node types to a unique Lottie animation.
 * Each animation is generated programmatically via lottieBuilder.
 */

import {
  createLightningBolt,
  createNeuralNetwork,
  createRobot,
  createRocket,
  createSparkle,
  createTarget,
  createRotatingGear,
  createCodeBrackets,
  createSnake,
  createGlobe,
  createBranchingPath,
  createLoopArrows,
  createHourglass,
  createFlowingArrows,
  createMergeArrows,
  createShieldCheck,
  createHandRaise,
  createTestTube,
  createPulsingRing,
  type LottieAnimationData,
} from './lottieBuilder';

// ─── Node Type → Animation Map ──────────────────────────────────────
// Colors match the category colors from nodeConfigs.ts

// Icon shapes use WHITE so they're visible on the colored background circle
const W = '#ffffff';

export const workflowNodeAnimations: Record<string, LottieAnimationData> = {
  // Triggers
  trigger: createLightningBolt(W),

  // AI / LLM
  llm_completion: createNeuralNetwork(W, '#e0e0e0'),
  a2a: createRobot(W),
  agent_spawn: createRocket(W),
  openagentic_llm: createSparkle(W),
  multi_agent: createTarget(W),

  // Actions
  mcp_tool: createRotatingGear(W),
  code: createCodeBrackets(W),
  openagentic: createSnake(W),
  http_request: createGlobe(W),

  // Logic
  condition: createBranchingPath(W, '#c8ffc8', '#ffc8c8'),
  loop: createLoopArrows(W),
  wait: createHourglass(W),

  // Data
  transform: createFlowingArrows(W),
  merge: createMergeArrows(W),

  // Approval
  approval: createShieldCheck(W, '#e0e0e0'),
  human_approval: createHandRaise(W),

  // Agents
  synth: createTestTube(W),
  synth_synthesize: createTestTube(W),
  oat: createTestTube(W),
  oat_synthesize: createTestTube(W),
  agent_single: createRobot(W),
  agent_pool: createTarget(W),
  agent_supervisor: createNeuralNetwork(W, '#e0e0e0'),

  // Cloud AI providers
  bedrock: createSparkle(W),
  vertex: createSparkle(W),
  azure_ai: createSparkle(W),
  openagentic_chat: createNeuralNetwork(W, '#e0e0e0'),

  // Data
  data_query: createGlobe(W),
  reasoning: createNeuralNetwork(W, '#e0e0e0'),
};

// Default animation for unknown types
export const defaultNodeAnimation = createPulsingRing('#607d8b');

/**
 * Get the Lottie animation data for a workflow node type
 */
export function getNodeAnimation(nodeType: string): LottieAnimationData {
  return workflowNodeAnimations[nodeType] || defaultNodeAnimation;
}
