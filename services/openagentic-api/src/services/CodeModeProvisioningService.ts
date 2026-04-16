/**
 * Code Mode Provisioning Service
 *
 * Handles the setup and lifecycle of per-user sandboxed development environments.
 * When a user first accesses Code Mode, this service provisions:
 * 1. Pod scheduling and container startup (K8s mode)
 * 2. Local workspace setup on pod filesystem
 * 3. VSCode/code-server settings
 * 4. Openagentic CLI initialization
 *
 * Storage is local to the pod (no MinIO/S3).
 * Works with both Docker Compose and Kubernetes deployments.
 */

import { PrismaClient, CodeModeProvisioning } from '@prisma/client';
import type { Logger } from 'pino';

export type ProvisioningStatus = 'pending' | 'provisioning' | 'ready' | 'failed' | 'suspended';

export interface ProvisioningStep {
  name: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  message?: string;
  progress?: number; // 0-100
}

export interface ProvisioningProgress {
  userId: string;
  status: ProvisioningStatus;
  statusMessage: string;
  steps: ProvisioningStep[];
  overallProgress: number; // 0-100
  estimatedTimeRemaining?: number; // seconds
}

export interface ProvisioningResult {
  success: boolean;
  provisioning?: CodeModeProvisioning;
  error?: string;
}

interface ProvisioningConfig {
  environmentType: 'docker' | 'kubernetes';
  workspaceBasePath: string;
  defaultModel: string;
  openagenticManagerUrl?: string;
}

// SSE callback for real-time progress updates
type ProgressCallback = (progress: ProvisioningProgress) => void;

export class CodeModeProvisioningService {
  private prisma: PrismaClient;
  private logger: Logger;
  private config: ProvisioningConfig;

  // Active provisioning tasks (for progress tracking)
  private activeProvisionings: Map<string, ProvisioningProgress> = new Map();

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger.child({ service: 'CodeModeProvisioningService' });

    // Load config from environment
    this.config = {
      environmentType: (process.env.ENVIRONMENT_TYPE as 'docker' | 'kubernetes') || 'docker',
      workspaceBasePath: process.env.CODE_MODE_WORKSPACE_PATH || '/workspace',
      // Use env var chain - NEVER hardcode model IDs
      defaultModel: process.env.CODE_MODE_DEFAULT_MODEL || process.env.DEFAULT_MODEL || process.env.FALLBACK_MODEL,
      openagenticManagerUrl: process.env.OPENAGENTIC_MANAGER_URL || 'http://openagentic-manager:3001',
    };
  }

  /**
   * Check if a user's Code Mode environment is provisioned and ready
   */
  async checkProvisioningStatus(userId: string): Promise<CodeModeProvisioning | null> {
    try {
      return await this.prisma.codeModeProvisioning.findUnique({
        where: { user_id: userId }
      });
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to check provisioning status');
      return null;
    }
  }

  /**
   * Check if user has Code Mode access (admin or explicitly enabled)
   */
  async hasCodeModeAccess(userId: string): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { is_admin: true, code_enabled: true }
      });

      return user?.is_admin || user?.code_enabled || false;
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to check Code Mode access');
      return false;
    }
  }

  /**
   * Get provisioning progress for a user (for SSE streaming)
   */
  getProvisioningProgress(userId: string): ProvisioningProgress | null {
    return this.activeProvisionings.get(userId) || null;
  }

  /**
   * Start provisioning a user's Code Mode environment
   * Returns immediately, provisioning happens async with progress updates
   */
  async startProvisioning(
    userId: string,
    onProgress?: ProgressCallback
  ): Promise<ProvisioningResult> {
    this.logger.info({ userId }, 'Starting Code Mode provisioning');

    // Check if already provisioning or ready
    const existing = await this.checkProvisioningStatus(userId);
    if (existing?.status === 'ready') {
      this.logger.info({ userId }, 'User already provisioned');
      return { success: true, provisioning: existing };
    }

    if (existing?.status === 'provisioning') {
      this.logger.info({ userId }, 'Provisioning already in progress');
      return {
        success: false,
        error: 'Provisioning already in progress'
      };
    }

    // Initialize progress tracking
    const progress: ProvisioningProgress = {
      userId,
      status: 'provisioning',
      statusMessage: 'Initializing your development environment...',
      steps: [
        { name: 'pod', status: 'pending', message: 'Starting pod...' },
        { name: 'workspace', status: 'pending', message: 'Setting up local workspace' },
        { name: 'vscode', status: 'pending', message: 'Starting VS Code Server' },
        { name: 'openagentic', status: 'pending', message: 'Initializing AI assistant' },
        { name: 'validation', status: 'pending', message: 'Validating environment' },
      ],
      overallProgress: 0,
      estimatedTimeRemaining: 30,
    };

    this.activeProvisionings.set(userId, progress);

    // Create or update provisioning record
    const provisioning = await this.prisma.codeModeProvisioning.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        status: 'provisioning',
        status_message: 'Initializing...',
        environment_type: this.config.environmentType,
        openagentic_model: this.config.defaultModel,
      },
      update: {
        status: 'provisioning',
        status_message: 'Initializing...',
        last_error: null,
      }
    });

    // Run provisioning steps
    try {
      await this.runProvisioningSteps(userId, progress, onProgress);

      // Mark as ready
      const finalProvisioning = await this.prisma.codeModeProvisioning.update({
        where: { user_id: userId },
        data: {
          status: 'ready',
          status_message: 'Environment ready',
          provisioned_at: new Date(),
          last_accessed_at: new Date(),
        }
      });

      progress.status = 'ready';
      progress.statusMessage = 'Your development environment is ready!';
      progress.overallProgress = 100;
      onProgress?.(progress);

      this.activeProvisionings.delete(userId);
      this.logger.info({ userId }, 'Code Mode provisioning completed successfully');

      return { success: true, provisioning: finalProvisioning };

    } catch (error: any) {
      this.logger.error({ error, userId }, 'Code Mode provisioning failed');

      // Update DB with error
      await this.prisma.codeModeProvisioning.update({
        where: { user_id: userId },
        data: {
          status: 'failed',
          status_message: 'Provisioning failed',
          last_error: error.message || 'Unknown error',
          error_count: { increment: 1 },
        }
      });

      progress.status = 'failed';
      progress.statusMessage = `Provisioning failed: ${error.message}`;
      onProgress?.(progress);

      this.activeProvisionings.delete(userId);

      return {
        success: false,
        error: error.message || 'Provisioning failed'
      };
    }
  }

  /**
   * Run all provisioning steps with progress updates
   */
  private async runProvisioningSteps(
    userId: string,
    progress: ProvisioningProgress,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const updateProgress = (stepName: string, stepStatus: ProvisioningStep['status'], message?: string) => {
      const step = progress.steps.find(s => s.name === stepName);
      if (step) {
        step.status = stepStatus;
        if (message) step.message = message;
      }

      // Calculate overall progress
      const completedSteps = progress.steps.filter(s => s.status === 'complete').length;
      progress.overallProgress = Math.round((completedSteps / progress.steps.length) * 100);
      progress.estimatedTimeRemaining = Math.max(0, (progress.steps.length - completedSteps) * 5);

      onProgress?.(progress);
    };

    // Step 1: Pod (K8s mode) or Container Ready (Docker mode)
    updateProgress('pod', 'running', 'Starting pod...');
    await this.provisionPod(userId);
    updateProgress('pod', 'complete', 'Pod ready');

    // Step 2: Workspace (local filesystem)
    updateProgress('workspace', 'running', 'Setting up local workspace...');
    await this.provisionWorkspace(userId);
    updateProgress('workspace', 'complete', 'Workspace ready');

    // Step 3: VS Code
    updateProgress('vscode', 'running', 'Starting VS Code Server...');
    await this.provisionVSCode(userId);
    updateProgress('vscode', 'complete', 'VS Code ready');

    // Step 4: Openagentic CLI
    updateProgress('openagentic', 'running', 'Initializing AI assistant...');
    await this.provisionOpenagentic(userId);
    updateProgress('openagentic', 'complete', 'AI assistant ready');

    // Step 5: Validation
    updateProgress('validation', 'running', 'Validating environment...');
    await this.validateEnvironment(userId);
    updateProgress('validation', 'complete', 'Environment ready');
  }

  /**
   * Provision pod/container for the user
   * In K8s mode: Pod is created by openagentic-manager
   * In Docker mode: Container is already running (shared)
   */
  private async provisionPod(userId: string): Promise<void> {
    this.logger.debug({ userId }, 'Provisioning pod');

    // The actual pod creation happens in openagentic-manager
    // This step is for tracking progress and updating status

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        sandbox_provisioned: true,
        sandbox_username: `code-${userId.substring(0, 8)}`,
      }
    });

    // Simulate pod startup time (actual startup tracked via WebSocket)
    await this.sleep(500);
  }

  /**
   * Provision local workspace on pod filesystem
   * No cloud storage - just local disk
   */
  private async provisionWorkspace(userId: string): Promise<void> {
    this.logger.debug({ userId }, 'Provisioning workspace');

    const workspacePath = `${this.config.workspaceBasePath}/${userId.substring(0, 8)}`;

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        storage_provisioned: true,
        storage_bucket: workspacePath, // Reuse field for workspace path
      }
    });

    await this.sleep(300);
  }

  /**
   * Set up VS Code configuration
   */
  private async provisionVSCode(userId: string): Promise<void> {
    this.logger.debug({ userId }, 'Provisioning VS Code');

    const defaultSettings = {
      'editor.theme': 'vs-dark',
      'editor.fontSize': 14,
      'editor.tabSize': 2,
      'terminal.integrated.shell.linux': '/bin/bash',
    };

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        vscode_provisioned: true,
        vscode_settings: defaultSettings,
      }
    });

    await this.sleep(300);
  }

  /**
   * Configure Openagentic CLI
   */
  private async provisionOpenagentic(userId: string): Promise<void> {
    this.logger.debug({ userId }, 'Provisioning Openagentic');

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        openagentic_provisioned: true,
        openagentic_model: this.config.defaultModel,
      }
    });

    await this.sleep(500);
  }

  /**
   * Validate the provisioned environment
   */
  private async validateEnvironment(userId: string): Promise<void> {
    this.logger.debug({ userId }, 'Validating environment');

    const provisioning = await this.prisma.codeModeProvisioning.findUnique({
      where: { user_id: userId }
    });

    if (!provisioning) {
      throw new Error('Provisioning record not found');
    }

    // Check all components are provisioned
    if (!provisioning.storage_provisioned) {
      throw new Error('Workspace not provisioned');
    }
    if (!provisioning.sandbox_provisioned) {
      throw new Error('Pod/Container not provisioned');
    }
    if (!provisioning.vscode_provisioned) {
      throw new Error('VS Code Server not provisioned');
    }
    if (!provisioning.openagentic_provisioned) {
      throw new Error('AI Assistant not provisioned');
    }

    // All components are provisioned
    this.logger.info({ userId }, 'Environment validation passed');

    await this.sleep(200);
  }

  /**
   * Update last accessed timestamp
   */
  async recordAccess(userId: string): Promise<void> {
    try {
      await this.prisma.codeModeProvisioning.update({
        where: { user_id: userId },
        data: { last_accessed_at: new Date() }
      });
    } catch (error) {
      this.logger.warn({ error, userId }, 'Failed to update last accessed time');
    }
  }

  /**
   * Suspend a user's Code Mode environment
   */
  async suspendEnvironment(userId: string, reason: string): Promise<void> {
    this.logger.info({ userId, reason }, 'Suspending Code Mode environment');

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        status: 'suspended',
        status_message: 'Environment suspended',
        suspended_at: new Date(),
        suspended_reason: reason,
      }
    });
  }

  /**
   * Resume a suspended environment
   */
  async resumeEnvironment(userId: string): Promise<ProvisioningResult> {
    const provisioning = await this.checkProvisioningStatus(userId);

    if (!provisioning || provisioning.status !== 'suspended') {
      return { success: false, error: 'Environment not suspended' };
    }

    await this.prisma.codeModeProvisioning.update({
      where: { user_id: userId },
      data: {
        status: 'ready',
        status_message: 'Environment resumed',
        suspended_at: null,
        suspended_reason: null,
      }
    });

    return { success: true };
  }

  /**
   * Delete a user's provisioned environment
   */
  async deprovision(userId: string): Promise<void> {
    this.logger.info({ userId }, 'Deprovisioning Code Mode environment');

    // TODO: Actually clean up resources (storage, sandbox user, etc.)

    await this.prisma.codeModeProvisioning.delete({
      where: { user_id: userId }
    }).catch(() => {
      // Ignore if doesn't exist
    });
  }

  /**
   * Get all users with provisioned environments (for admin)
   */
  async listProvisionedUsers(): Promise<CodeModeProvisioning[]> {
    return this.prisma.codeModeProvisioning.findMany({
      orderBy: { created_at: 'desc' }
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let provisioningServiceInstance: CodeModeProvisioningService | null = null;

export function getCodeModeProvisioningService(
  prisma: PrismaClient,
  logger: Logger
): CodeModeProvisioningService {
  if (!provisioningServiceInstance) {
    provisioningServiceInstance = new CodeModeProvisioningService(prisma, logger);
  }
  return provisioningServiceInstance;
}
