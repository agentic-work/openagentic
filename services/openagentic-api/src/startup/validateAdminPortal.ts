/**
 * Admin Portal SOT Validation
 * 
 * Validates that the admin portal is properly configured as the source of truth.
 * This runs at startup to ensure the system fails fast if misconfigured.
 */

import { prisma } from '../utils/prisma.js';
import { pino } from 'pino';

const logger = pino({ name: 'startup-validation' });

export interface AdminPortalHealth {
  defaultPromptExists: boolean;
  globalAssignmentExists: boolean;
  activePromptCount: number;
  status: 'healthy' | 'unhealthy' | 'error';
  errors: string[];
}

/**
 * Validate that admin portal is properly configured as SOT
 */
export async function validateAdminPortalConfiguration(): Promise<void> {
  logger.info('🔍 Validating admin portal SOT configuration...');
  
  const health = await getAdminPortalHealth();
  
  if (health.status === 'error') {
    logger.error({ errors: health.errors }, '❌ Admin portal validation failed with errors');
    throw new Error(`FATAL STARTUP ERROR: Admin portal validation failed: ${health.errors.join(', ')}`);
  }
  
  if (health.status === 'unhealthy') {
    logger.error({ health }, '❌ Admin portal is not properly configured');
    throw new Error('FATAL STARTUP ERROR: Admin portal is not configured as source of truth. Initialize with proper prompt templates.');
  }
  
  logger.info({ 
    activePromptCount: health.activePromptCount,
    defaultPromptExists: health.defaultPromptExists,
    globalAssignmentExists: health.globalAssignmentExists
  }, '✅ Admin portal SOT validation passed');
}

/**
 * Get detailed health status of admin portal configuration
 */
export async function getAdminPortalHealth(): Promise<AdminPortalHealth> {
  const health: AdminPortalHealth = {
    defaultPromptExists: false,
    globalAssignmentExists: false,
    activePromptCount: 0,
    status: 'unhealthy',
    errors: []
  };
  
  try {
    // Check if default prompt template exists
    const defaultPrompt = await prisma.promptTemplate.findFirst({
      where: { 
        is_default: true, 
        is_active: true 
      }
    });
    health.defaultPromptExists = !!defaultPrompt;
    
    if (!health.defaultPromptExists) {
      health.errors.push('No default prompt template found');
    }
    
    // Check if global assignment exists - either __all_users__ or admin user assignment
    let globalAssignment = await prisma.userPromptAssignment.findFirst({
      where: { user_id: '__all_users__' }
    });
    
    // If __all_users__ assignment doesn't exist (due to FK constraint), check admin user
    if (!globalAssignment) {
      const adminEmail = process.env.ADMIN_USER_EMAIL || process.env.LOCAL_ADMIN_EMAIL;
      if (adminEmail) {
        const adminUser = await prisma.user.findUnique({
          where: { email: adminEmail }
        });
        
        if (adminUser) {
          globalAssignment = await prisma.userPromptAssignment.findFirst({
            where: { user_id: adminUser.id }
          });
        }
      }
    }
    
    health.globalAssignmentExists = !!globalAssignment;
    
    if (!health.globalAssignmentExists) {
      health.errors.push('No global prompt assignment found (neither __all_users__ nor admin user)');
    }
    
    // Count active prompts
    health.activePromptCount = await prisma.promptTemplate.count({
      where: { is_active: true }
    });
    
    if (health.activePromptCount === 0) {
      health.errors.push('No active prompt templates found');
    }
    
    // Determine overall health status
    health.status = (health.defaultPromptExists && health.globalAssignmentExists && health.activePromptCount > 0) 
      ? 'healthy' 
      : 'unhealthy';
      
  } catch (error) {
    health.status = 'error';
    health.errors.push(`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    logger.error({ error }, 'Failed to check admin portal health');
  }
  
  return health;
}

/**
 * Validate specific error codes from prompt service
 */
export function isPromptConfigurationError(error: any): boolean {
  const configErrors = [
    'PROMPT_NOT_CONFIGURED',
    'DEFAULT_PROMPT_NOT_CONFIGURED', 
    'PROMPT_SYSTEM_FAILURE'
  ];
  
  return configErrors.some(code => error?.message?.includes(code));
}

/**
 * Get user-friendly error message for configuration errors
 */
export function getConfigurationErrorMessage(error: any): string {
  if (error?.message?.includes('PROMPT_NOT_CONFIGURED')) {
    return 'System configuration error: No prompt templates found in admin portal. Please contact your administrator to initialize the system.';
  }
  
  if (error?.message?.includes('DEFAULT_PROMPT_NOT_CONFIGURED')) {
    return 'System configuration error: No default prompt template configured. Please contact your administrator.';
  }
  
  if (error?.message?.includes('PROMPT_SYSTEM_FAILURE')) {
    return 'System configuration error: Prompt system is misconfigured. Please contact your administrator.';
  }
  
  return 'System configuration error. Please contact your administrator.';
}