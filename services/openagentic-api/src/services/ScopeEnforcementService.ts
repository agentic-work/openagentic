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
 * Scope Enforcement Service
 *
 * Tracks off-topic warnings for non-admin users and handles account lockouts.
 * Non-admin users are restricted to cloud/infrastructure/computing topics only.
 * After 3 warnings, the 4th violation locks their account.
 */

import { prisma } from '../utils/prisma.js';

export interface ScopeViolationResult {
  isLocked: boolean;
  warningCount: number;
  message: string;
  shouldBlock: boolean;
}

export interface UserScopeStatus {
  userId: string;
  warningCount: number;
  isLocked: boolean;
  lockedAt: Date | null;
  lockedReason: string | null;
}

// Topics that are allowed for non-admin users
const ALLOWED_TOPIC_KEYWORDS = [
  // Cloud platforms
  'azure', 'aws', 'gcp', 'google cloud', 'cloud', 'multi-cloud',
  // Infrastructure
  'vm', 'virtual machine', 'container', 'docker', 'kubernetes', 'k8s',
  'networking', 'storage', 'server', 'infrastructure', 'iaas', 'paas', 'saas',
  // DevOps
  'devops', 'ci/cd', 'cicd', 'pipeline', 'deployment', 'terraform', 'ansible',
  'monitoring', 'logging', 'prometheus', 'grafana', 'elk', 'splunk',
  // Databases
  'database', 'sql', 'nosql', 'postgres', 'mysql', 'mongodb', 'redis', 'cosmos',
  // Security
  'security', 'iam', 'rbac', 'authentication', 'authorization', 'secrets',
  'compliance', 'audit', 'encryption', 'certificate', 'ssl', 'tls',
  // Development
  'api', 'microservice', 'serverless', 'lambda', 'function', 'code',
  'programming', 'development', 'debug', 'error', 'bug', 'fix',
  // General tech
  'linux', 'windows', 'bash', 'powershell', 'script', 'automation',
  'performance', 'optimization', 'scaling', 'load balancer',
  // Common work terms
  'resource', 'subscription', 'tenant', 'project', 'environment', 'production',
  'staging', 'development', 'config', 'configuration', 'setting',
];

// Topics that indicate off-scope requests
const PROHIBITED_TOPIC_KEYWORDS = [
  // Entertainment
  'movie', 'film', 'game', 'gaming', 'sport', 'music', 'song', 'celebrity',
  'netflix', 'youtube', 'tiktok', 'instagram', 'facebook', 'twitter',
  // Personal
  'recipe', 'cook', 'food', 'restaurant', 'travel', 'vacation', 'hotel',
  'relationship', 'dating', 'health', 'diet', 'exercise', 'fitness',
  // General knowledge
  'history', 'geography', 'trivia', 'quiz', 'weather', 'news',
  // Non-work finance
  'stock', 'crypto', 'bitcoin', 'investment', 'gambling', 'lottery', 'bet',
  // Creative
  'story', 'poem', 'joke', 'riddle', 'essay', 'fiction',
  // Shopping
  'buy', 'shop', 'deal', 'discount', 'amazon', 'ebay',
];

/**
 * Analyze if a user message is within scope for non-admin users
 */
export function analyzeMessageScope(message: string): { isInScope: boolean; confidence: number; reason: string } {
  const lowerMessage = message.toLowerCase();

  // Count matches for allowed and prohibited keywords
  let allowedMatches = 0;
  let prohibitedMatches = 0;
  const foundAllowed: string[] = [];
  const foundProhibited: string[] = [];

  for (const keyword of ALLOWED_TOPIC_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      allowedMatches++;
      foundAllowed.push(keyword);
    }
  }

  for (const keyword of PROHIBITED_TOPIC_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      prohibitedMatches++;
      foundProhibited.push(keyword);
    }
  }

  // Decision logic
  // If message contains more allowed keywords than prohibited, it's likely in scope
  // If message contains ONLY prohibited keywords, it's definitely out of scope
  // If message contains no keywords from either list, be lenient (could be generic tech question)

  if (prohibitedMatches > 0 && allowedMatches === 0) {
    return {
      isInScope: false,
      confidence: Math.min(0.9, 0.5 + (prohibitedMatches * 0.1)),
      reason: `Off-topic keywords detected: ${foundProhibited.slice(0, 3).join(', ')}`
    };
  }

  if (allowedMatches > 0 && prohibitedMatches === 0) {
    return {
      isInScope: true,
      confidence: Math.min(0.95, 0.6 + (allowedMatches * 0.1)),
      reason: `Work-related keywords found: ${foundAllowed.slice(0, 3).join(', ')}`
    };
  }

  if (allowedMatches > prohibitedMatches) {
    return {
      isInScope: true,
      confidence: 0.7,
      reason: `Mixed content, but more work-related keywords (${allowedMatches} vs ${prohibitedMatches})`
    };
  }

  if (prohibitedMatches > allowedMatches && prohibitedMatches >= 2) {
    return {
      isInScope: false,
      confidence: 0.75,
      reason: `Mixed content with more off-topic keywords (${prohibitedMatches} vs ${allowedMatches})`
    };
  }

  // Default: be lenient if unclear
  return {
    isInScope: true,
    confidence: 0.5,
    reason: 'No clear indicators; allowing as potentially work-related'
  };
}

/**
 * Get user's current scope enforcement status
 */
export async function getUserScopeStatus(userId: string): Promise<UserScopeStatus | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        scope_warning_count: true,
        is_locked: true,
        locked_at: true,
        locked_reason: true,
      }
    });

    if (!user) return null;

    return {
      userId: user.id,
      warningCount: user.scope_warning_count,
      isLocked: user.is_locked,
      lockedAt: user.locked_at,
      lockedReason: user.locked_reason,
    };
  } catch (error) {
    console.error('[ScopeEnforcementService] Error getting user status:', error);
    return null;
  }
}

/**
 * Record a scope violation and increment warning counter
 * Returns the result of the violation including whether the account is now locked
 */
export async function recordScopeViolation(userId: string, violationReason: string): Promise<ScopeViolationResult> {
  try {
    // Get current warning count
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        scope_warning_count: true,
        is_locked: true,
      }
    });

    if (!user) {
      return {
        isLocked: false,
        warningCount: 0,
        message: 'User not found',
        shouldBlock: false,
      };
    }

    // If already locked, don't increment further
    if (user.is_locked) {
      return {
        isLocked: true,
        warningCount: user.scope_warning_count,
        message: '🔒 **ACCOUNT LOCKED** — Your account has been locked due to repeated policy violations. Please contact your administrator to restore access.',
        shouldBlock: true,
      };
    }

    const newWarningCount = user.scope_warning_count + 1;

    // Check if this is the 4th violation (lockout threshold)
    if (newWarningCount >= 4) {
      // Lock the account
      await prisma.user.update({
        where: { id: userId },
        data: {
          scope_warning_count: newWarningCount,
          is_locked: true,
          locked_at: new Date(),
          locked_reason: `Scope violation: ${violationReason}`,
        }
      });

      console.log(`[ScopeEnforcementService] Account locked for user ${userId} after ${newWarningCount} violations`);

      return {
        isLocked: true,
        warningCount: newWarningCount,
        message: '🔒 **ACCOUNT LOCKED** — Your account has been locked due to repeated policy violations. Please contact your administrator to restore access.',
        shouldBlock: true,
      };
    }

    // Increment warning count
    await prisma.user.update({
      where: { id: userId },
      data: {
        scope_warning_count: newWarningCount,
      }
    });

    console.log(`[ScopeEnforcementService] Warning ${newWarningCount}/3 for user ${userId}: ${violationReason}`);

    // Return appropriate warning message
    const warningMessages: Record<number, string> = {
      1: `⚠️ **Off-topic request detected.** I'm designed to help with cloud and infrastructure topics only. Please rephrase your question to focus on technical/work-related matters. *This is warning 1 of 3.*`,
      2: `⚠️ **Second off-topic request.** This assistant is strictly for cloud/infrastructure work. Continued off-topic requests may result in account restrictions. *Warning 2 of 3.*`,
      3: `🔴 **Final warning.** Your next off-topic request will result in automatic account lockout. An administrator will need to re-enable your access. Please only ask work-related technical questions. *Warning 3 of 3.*`,
    };

    return {
      isLocked: false,
      warningCount: newWarningCount,
      message: warningMessages[newWarningCount] || warningMessages[3],
      shouldBlock: false,
    };

  } catch (error) {
    console.error('[ScopeEnforcementService] Error recording violation:', error);
    return {
      isLocked: false,
      warningCount: 0,
      message: 'Error processing request',
      shouldBlock: false,
    };
  }
}

/**
 * Reset warning count for a user (admin action)
 */
export async function resetUserWarnings(userId: string): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        scope_warning_count: 0,
      }
    });

    console.log(`[ScopeEnforcementService] Warnings reset for user ${userId}`);
    return true;
  } catch (error) {
    console.error('[ScopeEnforcementService] Error resetting warnings:', error);
    return false;
  }
}

/**
 * Unlock a user account (admin action)
 */
export async function unlockUserAccount(userId: string): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        is_locked: false,
        locked_at: null,
        locked_reason: null,
        scope_warning_count: 0, // Also reset warnings on unlock
      }
    });

    console.log(`[ScopeEnforcementService] Account unlocked for user ${userId}`);
    return true;
  } catch (error) {
    console.error('[ScopeEnforcementService] Error unlocking account:', error);
    return false;
  }
}

/**
 * Check if a user is locked and should be blocked from chat
 */
export async function isUserLocked(userId: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { is_locked: true }
    });

    return user?.is_locked || false;
  } catch (error) {
    console.error('[ScopeEnforcementService] Error checking lock status:', error);
    return false;
  }
}

export default {
  analyzeMessageScope,
  getUserScopeStatus,
  recordScopeViolation,
  resetUserWarnings,
  unlockUserAccount,
  isUserLocked,
};
