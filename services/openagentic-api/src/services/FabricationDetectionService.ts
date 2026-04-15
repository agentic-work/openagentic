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
 * FabricationDetectionService
 *
 * Detects when an LLM fabricates structured data (like JSON) instead of
 * actually calling available tools. This prevents deceptive responses where
 * the LLM pretends to have performed an action or retrieved data.
 *
 * Key detection patterns:
 * 1. Large JSON output with no tool calls made
 * 2. Cloud resource descriptions without cloud tool calls
 * 3. Simulated/mock data markers in response
 * 4. Response claims to have "created" or "retrieved" without tool execution
 */

import pino from 'pino';

// Fabrication detection result
export interface FabricationDetectionResult {
  isFabricated: boolean;
  confidence: number; // 0-1, higher = more confident it's fabricated
  reasons: string[];
  blockedResponse: boolean;
  suggestedAction: 'allow' | 'warn' | 'block' | 'force_tool_call';
  detectionDurationMs: number;
}

// Tool call record from the completion
export interface ToolCallRecord {
  name: string;
  arguments: string;
  wasExecuted: boolean;
}

// Detection configuration
export interface FabricationDetectionConfig {
  enabled: boolean;
  blockFabrication: boolean; // If true, block fabricated responses
  minJsonSizeForCheck: number; // Min JSON characters to trigger detection
  confidenceThreshold: number; // Threshold to flag as fabricated
  cloudKeywords: string[]; // Keywords that suggest cloud operations
  fabricationMarkers: string[]; // Words that indicate simulation/mock
  actionVerbs: string[]; // Verbs that indicate claimed actions
}

const DEFAULT_CONFIG: FabricationDetectionConfig = {
  enabled: true,
  blockFabrication: true,
  minJsonSizeForCheck: 500, // 500+ characters of JSON triggers check
  confidenceThreshold: 0.7,
  cloudKeywords: [
    'azure', 'aws', 'gcp', 'kubernetes', 'k8s',
    'application gateway', 'appgw', 'load balancer', 'elb', 'alb',
    'virtual machine', 'vm', 'ec2', 'compute',
    'storage account', 's3', 'blob', 'bucket',
    'database', 'rds', 'cosmos', 'dynamodb',
    'function', 'lambda', 'cloud function',
    'container', 'ecs', 'aci', 'gke', 'aks', 'eks',
    'network', 'vnet', 'vpc', 'subnet',
    'firewall', 'nsg', 'security group',
    'dns', 'route53', 'cloud dns',
    'iam', 'rbac', 'role', 'policy',
    'resource group', 'subscription', 'account'
  ],
  fabricationMarkers: [
    'simulated', 'simulate', 'mock', 'example', 'sample', 'hypothetical',
    'let me demonstrate', 'let me show you', 'here\'s what it would look like',
    'would look like', 'might look like', 'could look like',
    'placeholder', 'dummy', 'fake', 'test data',
    'for demonstration', 'for illustration', 'illustrative',
    'if i were to create', 'if we were to', 'imagine',
    'representative', 'typical example', 'generic'
  ],
  actionVerbs: [
    'created', 'deployed', 'provisioned', 'configured', 'set up',
    'retrieved', 'fetched', 'got', 'obtained', 'pulled',
    'modified', 'updated', 'changed', 'altered',
    'deleted', 'removed', 'destroyed', 'terminated',
    'executed', 'ran', 'performed', 'completed'
  ]
};

export class FabricationDetectionService {
  private log: pino.Logger;
  private config: FabricationDetectionConfig;

  constructor(config: Partial<FabricationDetectionConfig> = {}) {
    this.log = pino({ name: 'FabricationDetectionService' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main detection method - analyzes an LLM response for potential fabrication
   */
  async detectFabrication(
    responseText: string,
    availableTools: { name: string; description?: string }[],
    toolCallsMade: ToolCallRecord[],
    userQuery: string
  ): Promise<FabricationDetectionResult> {
    const startTime = Date.now();

    if (!this.config.enabled) {
      return {
        isFabricated: false,
        confidence: 0,
        reasons: [],
        blockedResponse: false,
        suggestedAction: 'allow',
        detectionDurationMs: Date.now() - startTime
      };
    }

    const reasons: string[] = [];
    let totalScore = 0;
    let maxScore = 0;

    // Detection 1: Large JSON without tool calls
    const jsonScore = this.detectLargeJsonWithoutToolCalls(responseText, toolCallsMade);
    if (jsonScore.score > 0) {
      reasons.push(...jsonScore.reasons);
      totalScore += jsonScore.score;
    }
    maxScore += jsonScore.maxScore;

    // Detection 2: Cloud keywords with no cloud tool calls
    const cloudScore = this.detectCloudOperationsWithoutTools(
      responseText,
      userQuery,
      availableTools,
      toolCallsMade
    );
    if (cloudScore.score > 0) {
      reasons.push(...cloudScore.reasons);
      totalScore += cloudScore.score;
    }
    maxScore += cloudScore.maxScore;

    // Detection 3: Fabrication markers in response
    const markerScore = this.detectFabricationMarkers(responseText);
    if (markerScore.score > 0) {
      reasons.push(...markerScore.reasons);
      totalScore += markerScore.score;
    }
    maxScore += markerScore.maxScore;

    // Detection 4: Action verbs claiming work done without tool execution
    const actionScore = this.detectClaimedActionsWithoutTools(responseText, toolCallsMade);
    if (actionScore.score > 0) {
      reasons.push(...actionScore.reasons);
      totalScore += actionScore.score;
    }
    maxScore += actionScore.maxScore;

    // Detection 5: Resource IDs that look generated (not from tool output)
    const resourceIdScore = this.detectFakeResourceIds(responseText, toolCallsMade);
    if (resourceIdScore.score > 0) {
      reasons.push(...resourceIdScore.reasons);
      totalScore += resourceIdScore.score;
    }
    maxScore += resourceIdScore.maxScore;

    // Calculate confidence
    const confidence = maxScore > 0 ? totalScore / maxScore : 0;
    const isFabricated = confidence >= this.config.confidenceThreshold;

    // Determine action
    let suggestedAction: FabricationDetectionResult['suggestedAction'] = 'allow';
    if (isFabricated) {
      if (this.config.blockFabrication) {
        suggestedAction = 'block';
      } else if (confidence >= 0.9) {
        suggestedAction = 'force_tool_call';
      } else {
        suggestedAction = 'warn';
      }
    }

    const result: FabricationDetectionResult = {
      isFabricated,
      confidence,
      reasons,
      blockedResponse: isFabricated && this.config.blockFabrication,
      suggestedAction,
      detectionDurationMs: Date.now() - startTime
    };

    if (isFabricated) {
      this.log.warn({
        confidence,
        reasons,
        suggestedAction,
        responsePreview: responseText.substring(0, 200),
        toolsAvailable: availableTools.length,
        toolsCalled: toolCallsMade.length
      }, '[FABRICATION] ⚠️ Potential fabricated response detected');
    }

    return result;
  }

  /**
   * Detection 1: Large JSON blocks without corresponding tool calls
   */
  private detectLargeJsonWithoutToolCalls(
    responseText: string,
    toolCallsMade: ToolCallRecord[]
  ): { score: number; maxScore: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;
    const maxScore = 3;

    // Find JSON blocks in response
    const jsonBlocks = this.extractJsonBlocks(responseText);
    const largeJsonBlocks = jsonBlocks.filter(
      json => json.length >= this.config.minJsonSizeForCheck
    );

    if (largeJsonBlocks.length > 0) {
      // Check if any tools were called that could have produced this JSON
      const executedTools = toolCallsMade.filter(t => t.wasExecuted);

      if (executedTools.length === 0) {
        score += 2;
        reasons.push(
          `Found ${largeJsonBlocks.length} large JSON block(s) (${largeJsonBlocks.reduce((a, b) => a + b.length, 0)} chars total) but no tools were executed`
        );
      }

      // Check for suspiciously large JSON (likely fabricated resource lists)
      const veryLargeBlocks = largeJsonBlocks.filter(json => json.length > 5000);
      if (veryLargeBlocks.length > 0) {
        score += 1;
        reasons.push(
          `Very large JSON blocks (${veryLargeBlocks.map(j => j.length).join(', ')} chars) - likely fabricated data`
        );
      }
    }

    return { score, maxScore, reasons };
  }

  /**
   * Detection 2: Cloud operation context with no cloud tool calls
   */
  private detectCloudOperationsWithoutTools(
    responseText: string,
    userQuery: string,
    availableTools: { name: string; description?: string }[],
    toolCallsMade: ToolCallRecord[]
  ): { score: number; maxScore: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;
    const maxScore = 3;

    const combinedText = (userQuery + ' ' + responseText).toLowerCase();

    // Check for cloud keywords
    const foundCloudKeywords = this.config.cloudKeywords.filter(
      keyword => combinedText.includes(keyword.toLowerCase())
    );

    if (foundCloudKeywords.length > 0) {
      // Check if relevant cloud tools exist
      const cloudTools = availableTools.filter(tool => {
        const toolText = (tool.name + ' ' + (tool.description || '')).toLowerCase();
        return this.config.cloudKeywords.some(kw => toolText.includes(kw.toLowerCase())) ||
               toolText.includes('azure') || toolText.includes('aws') || toolText.includes('gcp');
      });

      if (cloudTools.length > 0) {
        // Tools exist - check if they were called
        const cloudToolsCalled = toolCallsMade.filter(tc =>
          cloudTools.some(ct => ct.name === tc.name)
        );

        if (cloudToolsCalled.length === 0) {
          score += 2;
          reasons.push(
            `Cloud operations discussed (${foundCloudKeywords.slice(0, 3).join(', ')}...) ` +
            `but ${cloudTools.length} available cloud tool(s) were not called`
          );
        }

        // Extra penalty if response contains resource configurations
        if (this.containsResourceConfig(responseText)) {
          score += 1;
          reasons.push('Response contains resource configuration data without tool execution');
        }
      }
    }

    return { score, maxScore, reasons };
  }

  /**
   * Detection 3: Explicit fabrication markers in the text
   */
  private detectFabricationMarkers(
    responseText: string
  ): { score: number; maxScore: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;
    const maxScore = 2;

    const lowerText = responseText.toLowerCase();
    const foundMarkers = this.config.fabricationMarkers.filter(
      marker => lowerText.includes(marker.toLowerCase())
    );

    if (foundMarkers.length > 0) {
      score += Math.min(foundMarkers.length * 0.5, maxScore);
      reasons.push(
        `Fabrication markers found: "${foundMarkers.slice(0, 3).join('", "')}"`
      );
    }

    return { score, maxScore, reasons };
  }

  /**
   * Detection 4: Claims of completed actions without tool execution
   */
  private detectClaimedActionsWithoutTools(
    responseText: string,
    toolCallsMade: ToolCallRecord[]
  ): { score: number; maxScore: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;
    const maxScore = 2;

    // Only flag if no tools were executed
    const executedTools = toolCallsMade.filter(t => t.wasExecuted);
    if (executedTools.length > 0) {
      return { score: 0, maxScore, reasons: [] };
    }

    const lowerText = responseText.toLowerCase();

    // Pattern: "I have [action verb]" or "I've [action verb]" or "I [action verb]"
    const claimPatterns = [
      /i have (created|deployed|configured|retrieved|fetched|executed|completed|set up)/gi,
      /i've (created|deployed|configured|retrieved|fetched|executed|completed|set up)/gi,
      /successfully (created|deployed|configured|retrieved|fetched|executed|completed)/gi,
      /here('s| is) the (data|resource|configuration|result) (i|that was) (created|retrieved|fetched)/gi
    ];

    let claimCount = 0;
    for (const pattern of claimPatterns) {
      const matches = responseText.match(pattern);
      if (matches) {
        claimCount += matches.length;
      }
    }

    if (claimCount > 0) {
      score += Math.min(claimCount * 0.5, maxScore);
      reasons.push(
        `${claimCount} claim(s) of completed actions but no tools were executed`
      );
    }

    return { score, maxScore, reasons };
  }

  /**
   * Detection 5: Fake resource IDs (UUIDs, ARNs, etc. not from tool output)
   */
  private detectFakeResourceIds(
    responseText: string,
    toolCallsMade: ToolCallRecord[]
  ): { score: number; maxScore: number; reasons: string[] } {
    const reasons: string[] = [];
    let score = 0;
    const maxScore = 2;

    // Only check if no tools were executed
    const executedTools = toolCallsMade.filter(t => t.wasExecuted);
    if (executedTools.length > 0) {
      return { score: 0, maxScore, reasons: [] };
    }

    // Look for resource ID patterns
    const resourceIdPatterns = [
      // Azure resource IDs
      /\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\//gi,
      // AWS ARNs
      /arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:/gi,
      // GCP resource paths
      /projects\/[a-z0-9-]+\/[a-z]+\//gi,
      // Generic UUIDs (high count suggests fabrication)
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
    ];

    let totalMatches = 0;
    for (const pattern of resourceIdPatterns) {
      const matches = responseText.match(pattern);
      if (matches) {
        totalMatches += matches.length;
      }
    }

    // Many resource IDs without tool calls is suspicious
    if (totalMatches >= 5) {
      score += 1;
      reasons.push(
        `${totalMatches} resource IDs found but no tools executed to retrieve them`
      );
    }
    if (totalMatches >= 20) {
      score += 1;
      reasons.push('High volume of resource IDs suggests fabricated data');
    }

    return { score, maxScore, reasons };
  }

  /**
   * Extract JSON blocks from text
   */
  private extractJsonBlocks(text: string): string[] {
    const blocks: string[] = [];

    // Find ```json blocks
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const content = match[1].trim();
      if (content.startsWith('{') || content.startsWith('[')) {
        blocks.push(content);
      }
    }

    // Find standalone JSON objects/arrays (not in code blocks)
    // This is a simplified heuristic
    const jsonObjectRegex = /\{[\s\S]*?\n\}/g;
    const jsonArrayRegex = /\[[\s\S]*?\n\]/g;

    const textWithoutCodeBlocks = text.replace(codeBlockRegex, '');

    const objectMatches: string[] = textWithoutCodeBlocks.match(jsonObjectRegex) || [];
    const arrayMatches: string[] = textWithoutCodeBlocks.match(jsonArrayRegex) || [];

    blocks.push(...objectMatches.filter(m => m.length > 50));
    blocks.push(...arrayMatches.filter(m => m.length > 50));

    return blocks;
  }

  /**
   * Check if text contains resource configuration patterns
   */
  private containsResourceConfig(text: string): boolean {
    const configPatterns = [
      /"name":\s*"/,
      /"id":\s*"/,
      /"type":\s*"/,
      /"properties":\s*\{/,
      /"sku":\s*\{/,
      /"configuration":\s*\{/,
      /"settings":\s*\{/,
      /"frontendIPConfigurations"/,
      /"backendAddressPools"/,
      /"httpListeners"/,
      /"requestRoutingRules"/
    ];

    return configPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Generate a user-friendly message explaining why a response was blocked
   */
  generateBlockedMessage(result: FabricationDetectionResult): string {
    return `I apologize, but I cannot provide a fabricated response. ` +
      `My response was blocked because: ${result.reasons.slice(0, 2).join('; ')}. ` +
      `To actually perform this task, I need to call the appropriate tools. ` +
      `Would you like me to execute the real operation using the available tools?`;
  }
}

// Singleton instance
let instance: FabricationDetectionService | null = null;

export function getFabricationDetectionService(
  config?: Partial<FabricationDetectionConfig>
): FabricationDetectionService {
  if (!instance) {
    instance = new FabricationDetectionService(config);
  }
  return instance;
}

export default getFabricationDetectionService;
