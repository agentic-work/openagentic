/**
 * WorkspaceSyncService - Real-time MinIO workspace synchronization
 *
 * Provides bidirectional sync between local workspace directories and MinIO storage.
 * Features:
 * - File watcher for detecting local changes
 * - Debounced uploads to MinIO
 * - File change event broadcasting via WebSocket
 * - Support for file patterns (ignore node_modules, .git, etc.)
 */

import { watch, FSWatcher } from 'chokidar';
import { readFile, writeFile, stat, mkdir, unlink, readdir } from 'fs/promises';
import { join, relative, dirname, basename } from 'path';
import { saveWorkspaceFile, getWorkspaceFile, getSession, initializeStorage } from './storageClient';

// File change event types
export type FileChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface FileChangeEvent {
  type: FileChangeType;
  path: string;       // Relative path within workspace
  fullPath: string;   // Absolute path on disk
  sessionId: string;
  userId: string;
  timestamp: number;
  size?: number;      // File size in bytes (for add/change)
}

// Sync configuration
export interface SyncConfig {
  debounceMs: number;           // Debounce time for file changes (default: 500ms)
  ignorePatterns: string[];     // Glob patterns to ignore
  maxFileSizeBytes: number;     // Max file size to sync (default: 10MB)
  syncInterval?: number;        // Optional interval for full sync (ms)
}

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
  ],
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
};

// Pending sync operations (debounced)
interface PendingSync {
  path: string;
  fullPath: string;
  type: FileChangeType;
  timer: NodeJS.Timeout;
}

/**
 * WorkspaceSyncService
 * Manages real-time synchronization between local workspace and MinIO
 */
export class WorkspaceSyncService {
  private watchers: Map<string, FSWatcher> = new Map();       // sessionId -> watcher
  private pendingSyncs: Map<string, PendingSync> = new Map(); // fullPath -> pending sync
  private config: SyncConfig;
  private eventCallback?: (event: FileChangeEvent) => void;

  constructor(config?: Partial<SyncConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set callback for file change events (used for WebSocket broadcasting)
   */
  onFileChange(callback: (event: FileChangeEvent) => void): void {
    this.eventCallback = callback;
  }

  /**
   * Start watching a workspace directory for a session
   */
  async startWatching(
    sessionId: string,
    userId: string,
    workspacePath: string
  ): Promise<void> {
    // Stop existing watcher if any
    await this.stopWatching(sessionId);

    console.log(`[WorkspaceSync] Starting watcher for session ${sessionId}: ${workspacePath}`);

    // Create watcher with ignore patterns
    const watcher = watch(workspacePath, {
      ignored: this.config.ignorePatterns,
      persistent: true,
      ignoreInitial: true,     // Don't emit events for existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 300, // Wait for file to be stable
        pollInterval: 100,
      },
      depth: 10,               // Max depth to watch
    });

    // Handle file events
    watcher.on('add', (fullPath) => this.handleChange('add', sessionId, userId, workspacePath, fullPath));
    watcher.on('change', (fullPath) => this.handleChange('change', sessionId, userId, workspacePath, fullPath));
    watcher.on('unlink', (fullPath) => this.handleChange('unlink', sessionId, userId, workspacePath, fullPath));
    watcher.on('addDir', (fullPath) => this.handleChange('addDir', sessionId, userId, workspacePath, fullPath));
    watcher.on('unlinkDir', (fullPath) => this.handleChange('unlinkDir', sessionId, userId, workspacePath, fullPath));

    watcher.on('error', (error) => {
      console.error(`[WorkspaceSync] Watcher error for session ${sessionId}:`, error);
    });

    watcher.on('ready', () => {
      console.log(`[WorkspaceSync] Watcher ready for session ${sessionId}`);
    });

    this.watchers.set(sessionId, watcher);
  }

  /**
   * Stop watching a workspace directory
   */
  async stopWatching(sessionId: string): Promise<void> {
    const watcher = this.watchers.get(sessionId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(sessionId);
      console.log(`[WorkspaceSync] Stopped watcher for session ${sessionId}`);
    }

    // Clear any pending syncs for this session
    for (const [key, pending] of this.pendingSyncs) {
      if (key.includes(sessionId)) {
        clearTimeout(pending.timer);
        this.pendingSyncs.delete(key);
      }
    }
  }

  /**
   * Handle file change with debouncing
   */
  private handleChange(
    type: FileChangeType,
    sessionId: string,
    userId: string,
    workspacePath: string,
    fullPath: string
  ): void {
    const relativePath = relative(workspacePath, fullPath);
    const key = `${sessionId}:${fullPath}`;

    // Cancel existing pending sync for this file
    const existing = this.pendingSyncs.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    // Create new debounced sync
    const timer = setTimeout(async () => {
      this.pendingSyncs.delete(key);
      await this.syncFile(type, sessionId, userId, workspacePath, fullPath, relativePath);
    }, this.config.debounceMs);

    this.pendingSyncs.set(key, {
      path: relativePath,
      fullPath,
      type,
      timer,
    });
  }

  /**
   * Sync a single file to MinIO
   */
  private async syncFile(
    type: FileChangeType,
    sessionId: string,
    userId: string,
    workspacePath: string,
    fullPath: string,
    relativePath: string
  ): Promise<void> {
    try {
      let size: number | undefined;

      if (type === 'add' || type === 'change') {
        // Check file size
        const stats = await stat(fullPath);
        size = stats.size;

        if (stats.size > this.config.maxFileSizeBytes) {
          console.log(`[WorkspaceSync] Skipping large file: ${relativePath} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
          return;
        }

        // Read file content
        const content = await readFile(fullPath);

        // Upload to MinIO
        await saveWorkspaceFile(userId, sessionId, relativePath, content);

        console.log(`[WorkspaceSync] Synced ${type}: ${relativePath}`);
      } else if (type === 'unlink') {
        // For deletions, we could mark the file as deleted in MinIO
        // For now, just log it (MinIO cleanup would require additional logic)
        console.log(`[WorkspaceSync] File deleted locally: ${relativePath}`);
      }

      // Emit event
      if (this.eventCallback) {
        const event: FileChangeEvent = {
          type,
          path: relativePath,
          fullPath,
          sessionId,
          userId,
          timestamp: Date.now(),
          size,
        };
        this.eventCallback(event);
      }
    } catch (error: any) {
      console.error(`[WorkspaceSync] Failed to sync ${type} ${relativePath}:`, error.message);
    }
  }

  /**
   * Perform a full sync from local workspace to MinIO
   */
  async fullSync(
    sessionId: string,
    userId: string,
    workspacePath: string
  ): Promise<{ synced: number; skipped: number; errors: number }> {
    console.log(`[WorkspaceSync] Starting full sync for session ${sessionId}`);

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    const scanDir = async (dir: string): Promise<void> => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          const relativePath = relative(workspacePath, fullPath);

          // Check if path matches ignore patterns
          if (this.shouldIgnore(relativePath)) {
            skipped++;
            continue;
          }

          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.isFile()) {
            try {
              const stats = await stat(fullPath);

              if (stats.size > this.config.maxFileSizeBytes) {
                skipped++;
                continue;
              }

              const content = await readFile(fullPath);
              await saveWorkspaceFile(userId, sessionId, relativePath, content);
              synced++;
            } catch (err) {
              errors++;
              console.error(`[WorkspaceSync] Failed to sync ${relativePath}:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`[WorkspaceSync] Failed to scan directory ${dir}:`, err);
      }
    };

    await scanDir(workspacePath);

    console.log(`[WorkspaceSync] Full sync complete: ${synced} synced, ${skipped} skipped, ${errors} errors`);
    return { synced, skipped, errors };
  }

  /**
   * Restore workspace from MinIO to local directory
   */
  async restoreFromMinIO(
    sessionId: string,
    userId: string,
    workspacePath: string,
    files: string[]
  ): Promise<{ restored: number; errors: number }> {
    console.log(`[WorkspaceSync] Restoring ${files.length} files to ${workspacePath}`);

    let restored = 0;
    let errors = 0;

    for (const filePath of files) {
      try {
        const content = await getWorkspaceFile(userId, sessionId, filePath);
        if (content !== null) {
          const fullPath = join(workspacePath, filePath);
          const dir = dirname(fullPath);

          // Ensure directory exists
          await mkdir(dir, { recursive: true });

          // Write file
          await writeFile(fullPath, content, 'utf-8');
          restored++;
        }
      } catch (err) {
        errors++;
        console.error(`[WorkspaceSync] Failed to restore ${filePath}:`, err);
      }
    }

    console.log(`[WorkspaceSync] Restore complete: ${restored} restored, ${errors} errors`);
    return { restored, errors };
  }

  /**
   * Check if path should be ignored based on patterns
   */
  private shouldIgnore(relativePath: string): boolean {
    // Simple pattern matching for common ignore patterns
    const ignoreNames = ['node_modules', '.git', '__pycache__', '.cache', 'dist', 'build'];
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
   * Get sync status for all active sessions
   */
  getSyncStatus(): Map<string, { watching: boolean; pendingCount: number }> {
    const status = new Map();

    for (const [sessionId, watcher] of this.watchers) {
      let pendingCount = 0;
      for (const [key] of this.pendingSyncs) {
        if (key.startsWith(`${sessionId}:`)) {
          pendingCount++;
        }
      }

      status.set(sessionId, {
        watching: true,
        pendingCount,
      });
    }

    return status;
  }

  /**
   * Stop all watchers and cleanup
   */
  async shutdown(): Promise<void> {
    console.log('[WorkspaceSync] Shutting down...');

    // Clear all pending syncs
    for (const [, pending] of this.pendingSyncs) {
      clearTimeout(pending.timer);
    }
    this.pendingSyncs.clear();

    // Close all watchers
    for (const [sessionId] of this.watchers) {
      await this.stopWatching(sessionId);
    }

    console.log('[WorkspaceSync] Shutdown complete');
  }
}

// Singleton instance
export const workspaceSyncService = new WorkspaceSyncService();
