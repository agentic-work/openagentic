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
 * MetricsService - Enhanced metrics tracking for OpenAgentic sessions
 *
 * Tracks:
 * - CPU and memory usage (via pidusage)
 * - Network I/O (bytes sent/received)
 * - Disk I/O (read/write operations)
 * - Token usage (input/output tokens per session)
 * - Storage usage (workspace file sizes)
 */

import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import pidusage from 'pidusage';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Enhanced process metrics
export interface EnhancedProcessMetrics {
  cpu: number;           // CPU usage percentage
  memory: number;        // Memory usage in bytes
  memoryMB: number;      // Memory usage in MB
  elapsed: number;       // Process elapsed time in ms

  // Network I/O
  networkRx: number;     // Bytes received
  networkTx: number;     // Bytes sent

  // Disk I/O
  diskReadBytes: number;
  diskWriteBytes: number;
  diskReadOps: number;
  diskWriteOps: number;
}

// Token usage tracking
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;  // USD
}

// Storage usage
export interface StorageUsage {
  totalBytes: number;
  fileCount: number;
  largestFile: { path: string; size: number } | null;
}

// Session metrics (aggregated)
export interface SessionMetrics {
  sessionId: string;
  userId: string;
  processMetrics: EnhancedProcessMetrics | null;
  tokenUsage: TokenUsage;
  storageUsage: StorageUsage | null;
  lastUpdated: Date;
}

// System-wide metrics
export interface SystemMetrics {
  totalSessions: number;
  activeSessions: number;
  totalCpu: number;
  totalMemoryMB: number;
  totalNetworkRx: number;
  totalNetworkTx: number;
  totalDiskRead: number;
  totalDiskWrite: number;
  totalTokens: number;
  totalStorageBytes: number;
}

/**
 * MetricsService
 * Collects and aggregates metrics for all CodeMode sessions
 */
export class MetricsService {
  // Token usage per session
  private tokenUsage: Map<string, TokenUsage> = new Map();

  // Network I/O baseline per process (for delta calculation)
  private networkBaseline: Map<number, { rx: number; tx: number }> = new Map();

  // Disk I/O baseline per process
  private diskBaseline: Map<number, { read: number; write: number; readOps: number; writeOps: number }> = new Map();

  constructor() {
    // Initialize with empty state
  }

  /**
   * Get enhanced process metrics for a PID
   */
  async getProcessMetrics(pid: number): Promise<EnhancedProcessMetrics | null> {
    try {
      // Get basic CPU/memory metrics
      const stats = await pidusage(pid);

      // Get network I/O (Linux-specific via /proc)
      const networkIO = await this.getNetworkIO(pid);

      // Get disk I/O
      const diskIO = await this.getDiskIO(pid);

      return {
        cpu: Math.round(stats.cpu * 100) / 100,
        memory: stats.memory,
        memoryMB: Math.round(stats.memory / (1024 * 1024) * 100) / 100,
        elapsed: stats.elapsed,
        networkRx: networkIO.rx,
        networkTx: networkIO.tx,
        diskReadBytes: diskIO.readBytes,
        diskWriteBytes: diskIO.writeBytes,
        diskReadOps: diskIO.readOps,
        diskWriteOps: diskIO.writeOps,
      };
    } catch (err) {
      // Process may have exited
      return null;
    }
  }

  /**
   * Get network I/O for a process (Linux /proc/net approach)
   */
  private async getNetworkIO(pid: number): Promise<{ rx: number; tx: number }> {
    try {
      // Try to read from /proc/{pid}/net/dev
      const { stdout } = await execAsync(`cat /proc/${pid}/net/dev 2>/dev/null || cat /proc/net/dev`);

      let totalRx = 0;
      let totalTx = 0;

      const lines = stdout.split('\n');
      for (const line of lines) {
        // Skip header lines
        if (line.includes('|') || line.trim() === '') continue;

        const parts = line.trim().split(/\s+/);
        if (parts.length >= 10) {
          // Format: interface: rx_bytes ... tx_bytes ...
          const rxBytes = parseInt(parts[1], 10) || 0;
          const txBytes = parseInt(parts[9], 10) || 0;

          // Skip loopback
          if (!parts[0].includes('lo')) {
            totalRx += rxBytes;
            totalTx += txBytes;
          }
        }
      }

      // Calculate delta from baseline
      const baseline = this.networkBaseline.get(pid);
      if (!baseline) {
        this.networkBaseline.set(pid, { rx: totalRx, tx: totalTx });
        return { rx: 0, tx: 0 };
      }

      const deltaRx = totalRx - baseline.rx;
      const deltaTx = totalTx - baseline.tx;

      return { rx: Math.max(0, deltaRx), tx: Math.max(0, deltaTx) };
    } catch {
      return { rx: 0, tx: 0 };
    }
  }

  /**
   * Get disk I/O for a process (Linux /proc approach)
   */
  private async getDiskIO(pid: number): Promise<{
    readBytes: number;
    writeBytes: number;
    readOps: number;
    writeOps: number;
  }> {
    try {
      const { stdout } = await execAsync(`cat /proc/${pid}/io 2>/dev/null || echo ""`);

      let readBytes = 0;
      let writeBytes = 0;
      let readOps = 0;
      let writeOps = 0;

      const lines = stdout.split('\n');
      for (const line of lines) {
        const [key, value] = line.split(':').map(s => s.trim());
        switch (key) {
          case 'read_bytes':
            readBytes = parseInt(value, 10) || 0;
            break;
          case 'write_bytes':
            writeBytes = parseInt(value, 10) || 0;
            break;
          case 'syscr':
            readOps = parseInt(value, 10) || 0;
            break;
          case 'syscw':
            writeOps = parseInt(value, 10) || 0;
            break;
        }
      }

      // Calculate delta from baseline
      const baseline = this.diskBaseline.get(pid);
      if (!baseline) {
        this.diskBaseline.set(pid, { read: readBytes, write: writeBytes, readOps, writeOps });
        return { readBytes: 0, writeBytes: 0, readOps: 0, writeOps: 0 };
      }

      return {
        readBytes: Math.max(0, readBytes - baseline.read),
        writeBytes: Math.max(0, writeBytes - baseline.write),
        readOps: Math.max(0, readOps - baseline.readOps),
        writeOps: Math.max(0, writeOps - baseline.writeOps),
      };
    } catch {
      return { readBytes: 0, writeBytes: 0, readOps: 0, writeOps: 0 };
    }
  }

  /**
   * Record token usage for a session
   */
  recordTokenUsage(sessionId: string, inputTokens: number, outputTokens: number, model?: string): void {
    const existing = this.tokenUsage.get(sessionId) || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };

    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.totalTokens += inputTokens + outputTokens;
    existing.estimatedCost += this.estimateCost(inputTokens, outputTokens, model);

    this.tokenUsage.set(sessionId, existing);
  }

  /**
   * Estimate cost based on tokens and model
   */
  private estimateCost(inputTokens: number, outputTokens: number, model?: string): number {
    // Price per 1M tokens (approximate)
    const prices: Record<string, { input: number; output: number }> = {
      'claude-3-opus': { input: 15.0, output: 75.0 },
      'claude-3-sonnet': { input: 3.0, output: 15.0 },
      'claude-3-haiku': { input: 0.25, output: 1.25 },
      'claude-3.5-sonnet': { input: 3.0, output: 15.0 },
      'gpt-4': { input: 30.0, output: 60.0 },
      'gpt-4-turbo': { input: 10.0, output: 30.0 },
      'gpt-4o': { input: 2.5, output: 10.0 },
      'gpt-4o-mini': { input: 0.15, output: 0.60 },
      'gemini-pro': { input: 0.5, output: 1.5 },
      'default': { input: 1.0, output: 3.0 },
    };

    // Find matching price
    let price = prices.default;
    if (model) {
      for (const [key, p] of Object.entries(prices)) {
        if (model.toLowerCase().includes(key)) {
          price = p;
          break;
        }
      }
    }

    return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  }

  /**
   * Get token usage for a session
   */
  getTokenUsage(sessionId: string): TokenUsage {
    return this.tokenUsage.get(sessionId) || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
  }

  /**
   * Get storage usage for a workspace directory
   */
  async getStorageUsage(workspacePath: string): Promise<StorageUsage | null> {
    try {
      let totalBytes = 0;
      let fileCount = 0;
      let largestFile: { path: string; size: number } | null = null;

      const scanDir = async (dir: string): Promise<void> => {
        try {
          const entries = await readdir(dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = join(dir, entry.name);

            if (entry.isDirectory()) {
              // Skip node_modules, .git, etc.
              if (!['node_modules', '.git', '__pycache__', '.cache'].includes(entry.name)) {
                await scanDir(fullPath);
              }
            } else if (entry.isFile()) {
              try {
                const stats = await stat(fullPath);
                totalBytes += stats.size;
                fileCount++;

                if (!largestFile || stats.size > largestFile.size) {
                  largestFile = {
                    path: fullPath.replace(workspacePath, ''),
                    size: stats.size,
                  };
                }
              } catch {
                // Skip inaccessible files
              }
            }
          }
        } catch {
          // Skip inaccessible directories
        }
      };

      await scanDir(workspacePath);

      return { totalBytes, fileCount, largestFile };
    } catch {
      return null;
    }
  }

  /**
   * Clear metrics for a session (when session ends)
   */
  clearSession(sessionId: string, pid?: number): void {
    this.tokenUsage.delete(sessionId);
    if (pid) {
      this.networkBaseline.delete(pid);
      this.diskBaseline.delete(pid);
    }
  }

  /**
   * Get aggregated system metrics across all sessions
   */
  async getSystemMetrics(
    sessions: Array<{ id: string; userId: string; pid?: number; workspacePath?: string }>
  ): Promise<SystemMetrics> {
    const metrics: SystemMetrics = {
      totalSessions: sessions.length,
      activeSessions: 0,
      totalCpu: 0,
      totalMemoryMB: 0,
      totalNetworkRx: 0,
      totalNetworkTx: 0,
      totalDiskRead: 0,
      totalDiskWrite: 0,
      totalTokens: 0,
      totalStorageBytes: 0,
    };

    for (const session of sessions) {
      // Get process metrics
      if (session.pid) {
        const processMetrics = await this.getProcessMetrics(session.pid);
        if (processMetrics) {
          metrics.activeSessions++;
          metrics.totalCpu += processMetrics.cpu;
          metrics.totalMemoryMB += processMetrics.memoryMB;
          metrics.totalNetworkRx += processMetrics.networkRx;
          metrics.totalNetworkTx += processMetrics.networkTx;
          metrics.totalDiskRead += processMetrics.diskReadBytes;
          metrics.totalDiskWrite += processMetrics.diskWriteBytes;
        }
      }

      // Get token usage
      const tokens = this.getTokenUsage(session.id);
      metrics.totalTokens += tokens.totalTokens;

      // Get storage usage
      if (session.workspacePath) {
        const storage = await this.getStorageUsage(session.workspacePath);
        if (storage) {
          metrics.totalStorageBytes += storage.totalBytes;
        }
      }
    }

    return metrics;
  }
}

// Singleton instance
export const metricsService = new MetricsService();
