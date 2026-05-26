/**
 * Workspace Storage Service - Cloud-First Architecture
 *
 * This service manages user workspaces with CLOUD STORAGE as the PRIMARY storage.
 * Local filesystem is only a working cache.
 *
 * IMPORTANT: Workspaces are USER-BASED, not session-based!
 * Each user has ONE persistent workspace that survives across sessions.
 * The sessionId is used only for tracking active PTY/CLI processes.
 *
 * Architecture:
 * ┌─────────────────────┐         ┌─────────────────────────────┐
 * │   Cloud Storage     │ ◄─────► │   Local Cache               │
 * │   (PRIMARY)         │  sync   │   (working copy)            │
 * │   MinIO/S3/Azure/GCS│         │   /workspaces/{userId}/...  │
 * └─────────────────────┘         └─────────────────────────────┘
 *
 * Workspace Lifecycle:
 * 1. Session Start:
 *    - Check if user workspace exists in cloud
 *    - If exists: download to local cache (resume work)
 *    - If not: create in cloud, then create local
 *
 * 2. During Session:
 *    - File watcher detects local changes
 *    - Changes synced to cloud in real-time (debounced)
 *
 * 3. Session End:
 *    - Final sync to cloud
 *    - Local cache persists for fast resume
 *
 * 4. Manager Restart:
 *    - User's workspace is preserved in cloud
 *    - New session resumes with same files
 *
 * Storage Path Structure:
 * Cloud: workspaces/{userId}/files/...
 * Cloud: workspaces/{userId}/metadata.json
 * Local: /workspaces/{userId}/...
 */

import { watch, FSWatcher } from 'chokidar';
import { readFile, writeFile, stat, mkdir, rm, readdir, unlink } from 'fs/promises';
import { join, relative, dirname, basename } from 'path';
import { existsSync } from 'fs';
import {
  getStorageProvider,
  initializeCloudStorage,
  ICloudStorageProvider,
  StorageObject,
} from './cloudStorageProvider';

// ============================================================================
// Types
// ============================================================================

export type FileChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface FileChangeEvent {
  type: FileChangeType;
  path: string;       // Relative path within workspace
  fullPath: string;   // Absolute path on disk
  sessionId: string;
  userId: string;
  timestamp: number;
  size?: number;
  syncedToCloud: boolean;
}

export interface WorkspaceMetadata {
  userId: string;
  sessionId: string;
  createdAt: string;
  lastModified: string;
  fileCount: number;
  totalSize: number;
  model?: string;
  status: 'active' | 'stopped' | 'archived';
}

export interface SyncConfig {
  debounceMs: number;
  ignorePatterns: string[];
  maxFileSizeBytes: number;
  syncOnChange: boolean;        // Real-time sync enabled
  cleanLocalOnStop: boolean;    // Delete local cache on session stop
  downloadOnStart: boolean;     // Download from cloud on session start
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: SyncConfig = {
  debounceMs: 500,
  ignorePatterns: [
    '**/node_modules/**',
    '**/.git/**',
    '**/__pycache__/**',
    '**/.cache/**',
    '**/dist/**',
    '**/build/**',
    '**/*.log',
    '**/.DS_Store',
    '**/Thumbs.db',
    '**/.openagentic/**',  // Ignore openagentic internal files
  ],
  maxFileSizeBytes: 50 * 1024 * 1024, // 50MB
  syncOnChange: true,
  cleanLocalOnStop: false,  // Keep local for faster resume
  downloadOnStart: true,
};

// ============================================================================
// Workspace Storage Service
// ============================================================================

interface PendingSync {
  path: string;
  fullPath: string;
  type: FileChangeType;
  timer: NodeJS.Timeout;
}

interface ActiveWorkspace {
  userId: string;
  sessionId: string;
  localPath: string;
  cloudPrefix: string;
  watcher: FSWatcher | null;
  pendingSyncs: Map<string, PendingSync>;
  metadata: WorkspaceMetadata;
}

export class WorkspaceStorageService {
  private workspaces: Map<string, ActiveWorkspace> = new Map();  // sessionId -> workspace
  private config: SyncConfig;
  private provider: ICloudStorageProvider | null = null;
  private eventCallback?: (event: FileChangeEvent) => void;
  private localBasePath: string;

  constructor(localBasePath: string, config?: Partial<SyncConfig>) {
    this.localBasePath = localBasePath;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the service and cloud storage provider
   */
  async initialize(): Promise<void> {
    this.provider = await initializeCloudStorage();
    console.log(`[WorkspaceStorage] Initialized with ${this.provider.providerType} provider`);
  }

  /**
   * Set callback for file change events
   */
  onFileChange(callback: (event: FileChangeEvent) => void): void {
    this.eventCallback = callback;
  }

  /**
   * Get the cloud storage prefix for a workspace
   * NOTE: Workspaces are USER-based, not session-based.
   * Each user has ONE persistent workspace that survives across sessions.
   * The sessionId is only used for tracking but NOT for workspace path.
   */
  private getCloudPrefix(userId: string, _sessionId?: string): string {
    // User-based workspace - NOT session-based
    return `workspaces/${userId}/`;
  }

  /**
   * Get the local path for a workspace
   * NOTE: Workspaces are USER-based, not session-based.
   */
  private getLocalPath(userId: string, _sessionId?: string): string {
    // User-based workspace - NOT session-based
    return join(this.localBasePath, userId);
  }

  /**
   * Initialize a workspace - creates in cloud first, then local cache
   *
   * This is the main entry point for session creation.
   * Cloud storage is the source of truth.
   */
  async initializeWorkspace(
    userId: string,
    sessionId: string,
    model?: string
  ): Promise<{ localPath: string; isNew: boolean; filesDownloaded: number }> {
    if (!this.provider) {
      throw new Error('WorkspaceStorageService not initialized');
    }

    // User-based workspace (session ID is only for tracking active PTY process)
    const cloudPrefix = this.getCloudPrefix(userId);
    const localPath = this.getLocalPath(userId);

    console.log(`[WorkspaceStorage] Initializing user workspace for ${userId} (session: ${sessionId})`);

    // Check if workspace exists in cloud
    const metadataKey = `${cloudPrefix}metadata.json`;
    const existsInCloud = await this.provider.fileExists(metadataKey);

    let isNew = false;
    let filesDownloaded = 0;

    if (existsInCloud && this.config.downloadOnStart) {
      // Download existing workspace from cloud
      console.log(`[WorkspaceStorage] Downloading existing workspace from cloud`);
      filesDownloaded = await this.downloadWorkspace(userId, sessionId);
    } else {
      // Create new workspace
      isNew = true;
      console.log(`[WorkspaceStorage] Creating new workspace`);

      // Create local directory
      await mkdir(localPath, { recursive: true });

      // Create metadata in cloud
      const metadata: WorkspaceMetadata = {
        userId,
        sessionId,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        fileCount: 0,
        totalSize: 0,
        model,
        status: 'active',
      };

      await this.provider.uploadFile(
        metadataKey,
        JSON.stringify(metadata, null, 2),
        'application/json'
      );
    }

    // Create active workspace tracking
    const workspace: ActiveWorkspace = {
      userId,
      sessionId,
      localPath,
      cloudPrefix,
      watcher: null,
      pendingSyncs: new Map(),
      metadata: {
        userId,
        sessionId,
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        fileCount: 0,
        totalSize: 0,
        model,
        status: 'active',
      },
    };

    this.workspaces.set(sessionId, workspace);

    // Start file watcher for real-time sync
    if (this.config.syncOnChange) {
      await this.startWatcher(sessionId);
    }

    console.log(`[WorkspaceStorage] Workspace ready at ${localPath} (new=${isNew}, downloaded=${filesDownloaded})`);

    return { localPath, isNew, filesDownloaded };
  }

  /**
   * Download workspace from cloud to local cache
   */
  async downloadWorkspace(userId: string, _sessionId?: string): Promise<number> {
    if (!this.provider) {
      throw new Error('WorkspaceStorageService not initialized');
    }

    // User-based workspace path (sessionId is ignored)
    const cloudPrefix = `${this.getCloudPrefix(userId)}files/`;
    const localPath = this.getLocalPath(userId);

    // Ensure local directory exists
    await mkdir(localPath, { recursive: true });

    // Download all files from cloud
    const downloaded = await this.provider.downloadDirectory(cloudPrefix, localPath);

    console.log(`[WorkspaceStorage] Downloaded ${downloaded} files to ${localPath}`);
    return downloaded;
  }

  /**
   * Upload entire workspace to cloud
   */
  async uploadWorkspace(sessionId: string): Promise<number> {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace || !this.provider) {
      throw new Error(`Workspace not found: ${sessionId}`);
    }

    const cloudPrefix = `${workspace.cloudPrefix}files/`;
    const localPath = workspace.localPath;

    // Check if local path exists
    if (!existsSync(localPath)) {
      console.log(`[WorkspaceStorage] Local path does not exist: ${localPath}`);
      return 0;
    }

    // Upload all files to cloud
    const uploaded = await this.uploadLocalDirectory(localPath, cloudPrefix);

    // Update metadata
    await this.updateMetadata(sessionId);

    console.log(`[WorkspaceStorage] Uploaded ${uploaded} files to cloud`);
    return uploaded;
  }

  /**
   * Upload a local directory to cloud (respecting ignore patterns)
   */
  private async uploadLocalDirectory(localPath: string, cloudPrefix: string): Promise<number> {
    if (!this.provider) return 0;

    let uploaded = 0;

    const uploadRecursive = async (dir: string, prefix: string): Promise<void> => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const localFilePath = join(dir, entry.name);
          const relativePath = relative(localPath, localFilePath);

          // Check if should ignore
          if (this.shouldIgnore(relativePath)) {
            continue;
          }

          const cloudKey = `${prefix}${entry.name}`;

          if (entry.isDirectory()) {
            await uploadRecursive(localFilePath, `${cloudKey}/`);
          } else if (entry.isFile()) {
            try {
              const stats = await stat(localFilePath);
              if (stats.size > this.config.maxFileSizeBytes) {
                console.log(`[WorkspaceStorage] Skipping large file: ${relativePath}`);
                continue;
              }

              const content = await readFile(localFilePath);
              await this.provider!.uploadFile(cloudKey, content);
              uploaded++;
            } catch (err) {
              console.error(`[WorkspaceStorage] Failed to upload ${relativePath}:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`[WorkspaceStorage] Failed to scan directory ${dir}:`, err);
      }
    };

    await uploadRecursive(localPath, cloudPrefix);
    return uploaded;
  }

  /**
   * Start file watcher for a workspace
   */
  private async startWatcher(sessionId: string): Promise<void> {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) return;

    // Stop existing watcher if any
    if (workspace.watcher) {
      await workspace.watcher.close();
    }

    console.log(`[WorkspaceStorage] Starting watcher for ${sessionId}: ${workspace.localPath}`);

    const watcher = watch(workspace.localPath, {
      ignored: this.config.ignorePatterns,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
      depth: 10,
    });

    watcher.on('add', (fullPath) => this.handleFileChange('add', sessionId, fullPath));
    watcher.on('change', (fullPath) => this.handleFileChange('change', sessionId, fullPath));
    watcher.on('unlink', (fullPath) => this.handleFileChange('unlink', sessionId, fullPath));
    watcher.on('addDir', (fullPath) => this.handleFileChange('addDir', sessionId, fullPath));
    watcher.on('unlinkDir', (fullPath) => this.handleFileChange('unlinkDir', sessionId, fullPath));

    watcher.on('error', (error) => {
      console.error(`[WorkspaceStorage] Watcher error for ${sessionId}:`, error);
    });

    workspace.watcher = watcher;
  }

  /**
   * Handle file change with debouncing
   */
  private handleFileChange(type: FileChangeType, sessionId: string, fullPath: string): void {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) return;

    const relativePath = relative(workspace.localPath, fullPath);

    // Check if should ignore
    if (this.shouldIgnore(relativePath)) {
      return;
    }

    // Cancel existing pending sync
    const key = fullPath;
    const existing = workspace.pendingSyncs.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    // Create debounced sync
    const timer = setTimeout(async () => {
      workspace.pendingSyncs.delete(key);
      await this.syncFileToCloud(sessionId, fullPath, relativePath, type);
    }, this.config.debounceMs);

    workspace.pendingSyncs.set(key, {
      path: relativePath,
      fullPath,
      type,
      timer,
    });
  }

  /**
   * Sync a single file to cloud
   */
  private async syncFileToCloud(
    sessionId: string,
    fullPath: string,
    relativePath: string,
    type: FileChangeType
  ): Promise<void> {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace || !this.provider) return;

    const cloudKey = `${workspace.cloudPrefix}files/${relativePath}`;
    let size: number | undefined;
    let syncedToCloud = false;

    try {
      if (type === 'add' || type === 'change') {
        const stats = await stat(fullPath);
        size = stats.size;

        if (stats.size > this.config.maxFileSizeBytes) {
          console.log(`[WorkspaceStorage] Skipping large file: ${relativePath}`);
          return;
        }

        const content = await readFile(fullPath);
        await this.provider.uploadFile(cloudKey, content);
        syncedToCloud = true;

        console.log(`[WorkspaceStorage] Synced ${type}: ${relativePath}`);
      } else if (type === 'unlink') {
        await this.provider.deleteFile(cloudKey);
        syncedToCloud = true;
        console.log(`[WorkspaceStorage] Deleted from cloud: ${relativePath}`);
      }

      // Emit event
      if (this.eventCallback) {
        this.eventCallback({
          type,
          path: relativePath,
          fullPath,
          sessionId,
          userId: workspace.userId,
          timestamp: Date.now(),
          size,
          syncedToCloud,
        });
      }
    } catch (error: any) {
      console.error(`[WorkspaceStorage] Failed to sync ${relativePath}:`, error.message);
    }
  }

  /**
   * Update workspace metadata in cloud
   */
  private async updateMetadata(sessionId: string): Promise<void> {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace || !this.provider) return;

    // Get file stats
    let fileCount = 0;
    let totalSize = 0;

    try {
      const listResult = await this.provider.listFiles(`${workspace.cloudPrefix}files/`);
      fileCount = listResult.objects.length;
      totalSize = listResult.objects.reduce((sum, obj) => sum + obj.size, 0);
    } catch {
      // Ignore errors
    }

    const metadata: WorkspaceMetadata = {
      ...workspace.metadata,
      lastModified: new Date().toISOString(),
      fileCount,
      totalSize,
    };

    const metadataKey = `${workspace.cloudPrefix}metadata.json`;
    await this.provider.uploadFile(metadataKey, JSON.stringify(metadata, null, 2), 'application/json');
    workspace.metadata = metadata;
  }

  /**
   * Stop workspace - flush syncs, optionally clean local cache
   */
  async stopWorkspace(sessionId: string): Promise<void> {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) return;

    console.log(`[WorkspaceStorage] Stopping workspace ${sessionId}`);

    // Stop watcher
    if (workspace.watcher) {
      await workspace.watcher.close();
    }

    // Clear pending syncs
    for (const pending of workspace.pendingSyncs.values()) {
      clearTimeout(pending.timer);
    }
    workspace.pendingSyncs.clear();

    // Final sync to cloud
    if (this.provider) {
      try {
        await this.uploadWorkspace(sessionId);
      } catch (err) {
        console.error(`[WorkspaceStorage] Failed final sync for ${sessionId}:`, err);
      }

      // Update metadata status
      workspace.metadata.status = 'stopped';
      const metadataKey = `${workspace.cloudPrefix}metadata.json`;
      await this.provider.uploadFile(
        metadataKey,
        JSON.stringify(workspace.metadata, null, 2),
        'application/json'
      );
    }

    // Clean local cache if configured
    if (this.config.cleanLocalOnStop && existsSync(workspace.localPath)) {
      try {
        await rm(workspace.localPath, { recursive: true, force: true });
        console.log(`[WorkspaceStorage] Cleaned local cache: ${workspace.localPath}`);
      } catch (err) {
        console.error(`[WorkspaceStorage] Failed to clean local cache:`, err);
      }
    }

    this.workspaces.delete(sessionId);
    console.log(`[WorkspaceStorage] Workspace ${sessionId} stopped`);
  }

  /**
   * Delete workspace from cloud and local
   * NOTE: This deletes the entire user workspace!
   */
  async deleteWorkspace(userId: string, sessionId?: string): Promise<void> {
    // Stop if active
    if (sessionId) {
      await this.stopWorkspace(sessionId);
    }

    // User-based workspace path
    const cloudPrefix = this.getCloudPrefix(userId);
    const localPath = this.getLocalPath(userId);

    // Delete from cloud
    if (this.provider) {
      const deleted = await this.provider.deleteDirectory(cloudPrefix);
      console.log(`[WorkspaceStorage] Deleted ${deleted} files from cloud`);
    }

    // Delete local
    if (existsSync(localPath)) {
      await rm(localPath, { recursive: true, force: true });
      console.log(`[WorkspaceStorage] Deleted local directory: ${localPath}`);
    }
  }

  /**
   * List all workspaces for a user from cloud
   * NOTE: With user-based workspaces, each user has exactly ONE workspace.
   * This returns a single-element array if the workspace exists.
   */
  async listUserWorkspaces(userId: string): Promise<WorkspaceMetadata[]> {
    if (!this.provider) {
      throw new Error('WorkspaceStorageService not initialized');
    }

    // User-based workspace - just get the single workspace metadata
    const metadata = await this.getWorkspaceMetadata(userId);

    if (metadata) {
      return [metadata];
    }

    return [];
  }

  /**
   * Get workspace metadata
   */
  async getWorkspaceMetadata(userId: string, _sessionId?: string): Promise<WorkspaceMetadata | null> {
    if (!this.provider) return null;

    // User-based workspace path
    const metadataKey = `${this.getCloudPrefix(userId)}metadata.json`;
    try {
      const content = await this.provider.downloadFile(metadataKey);
      return JSON.parse(content.toString('utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Check if path should be ignored
   */
  private shouldIgnore(relativePath: string): boolean {
    const ignoreNames = ['node_modules', '.git', '__pycache__', '.cache', 'dist', 'build', '.openagentic'];
    const pathParts = relativePath.split('/');

    for (const part of pathParts) {
      if (ignoreNames.includes(part)) {
        return true;
      }
    }

    const fileName = basename(relativePath);
    if (fileName.endsWith('.log') || fileName === '.DS_Store' || fileName === 'Thumbs.db') {
      return true;
    }

    return false;
  }

  /**
   * Get sync status for active workspaces
   */
  getSyncStatus(): Map<string, { watching: boolean; pendingCount: number; cloudPrefix: string }> {
    const status = new Map();

    for (const [sessionId, workspace] of this.workspaces) {
      status.set(sessionId, {
        watching: workspace.watcher !== null,
        pendingCount: workspace.pendingSyncs.size,
        cloudPrefix: workspace.cloudPrefix,
      });
    }

    return status;
  }

  /**
   * Force sync a workspace to cloud
   */
  async forceSyncToCloud(sessionId: string): Promise<number> {
    return await this.uploadWorkspace(sessionId);
  }

  /**
   * Force sync a workspace from cloud
   */
  async forceSyncFromCloud(sessionId: string): Promise<number> {
    const workspace = this.workspaces.get(sessionId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${sessionId}`);
    }

    return await this.downloadWorkspace(workspace.userId, sessionId);
  }

  /**
   * Shutdown - stop all workspaces
   */
  async shutdown(): Promise<void> {
    console.log('[WorkspaceStorage] Shutting down...');

    for (const sessionId of this.workspaces.keys()) {
      await this.stopWorkspace(sessionId);
    }

    console.log('[WorkspaceStorage] Shutdown complete');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let workspaceServiceInstance: WorkspaceStorageService | null = null;

/**
 * Get or create the workspace storage service singleton
 */
export function getWorkspaceStorageService(localBasePath?: string): WorkspaceStorageService {
  if (!workspaceServiceInstance) {
    const basePath = localBasePath || process.env.WORKSPACES_PATH || '/workspaces';
    workspaceServiceInstance = new WorkspaceStorageService(basePath);
  }
  return workspaceServiceInstance;
}

/**
 * Initialize the workspace storage service
 */
export async function initializeWorkspaceStorage(localBasePath?: string): Promise<WorkspaceStorageService> {
  const service = getWorkspaceStorageService(localBasePath);
  await service.initialize();
  return service;
}
