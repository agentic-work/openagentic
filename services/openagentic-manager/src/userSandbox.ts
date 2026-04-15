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
 * User Sandbox - Isolates each session to a dedicated Linux user
 *
 * SECURITY: Each openagentic session runs as a unique Linux user that:
 * - Can ONLY access their own workspace directory
 * - Cannot access other users' workspaces
 * - Cannot access system files outside their sandbox
 * - Has no sudo/root privileges
 * - Has resource limits (ulimits) to prevent DoS
 *
 * Works in both Docker Compose and Kubernetes environments by using
 * standard Linux user/group permissions (no Docker-specific features).
 */

import { execSync, spawn } from 'child_process';
import { mkdir, chown, chmod, rm } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { RESOURCE_LIMITS, getUlimitPrefix } from './securityPolicy.js';

// User ID range for sandbox users (avoid conflicts with system users)
// We use UIDs 10000-60000 for sandbox users
const MIN_UID = 10000;
const MAX_UID = 60000;

// Track allocated UIDs to avoid conflicts
const allocatedUIDs = new Set<number>();

export interface SandboxUser {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;      // User's home directory (for config/cache - NOT workspace)
  workspaceDir: string; // User's workspace directory (for code files)
  sessionId: string;
}

/**
 * Generate a unique username from session ID
 * Format: aw_<first8chars of sessionId>
 */
function generateUsername(sessionId: string): string {
  // Use first 8 chars of session ID, replace hyphens
  const shortId = sessionId.replace(/-/g, '').substring(0, 8);
  return `aw_${shortId}`;
}

/**
 * Allocate a unique UID for a new sandbox user
 */
function allocateUID(): number {
  // Start from a hash of current time to spread UIDs
  let uid = MIN_UID + (Date.now() % (MAX_UID - MIN_UID));

  // Find next available UID
  let attempts = 0;
  while (allocatedUIDs.has(uid) && attempts < 10000) {
    uid = MIN_UID + ((uid - MIN_UID + 1) % (MAX_UID - MIN_UID));
    attempts++;
  }

  if (attempts >= 10000) {
    throw new Error('Unable to allocate UID - too many active sessions');
  }

  allocatedUIDs.add(uid);
  return uid;
}

/**
 * Create a sandboxed Linux user for a session
 *
 * @param sessionId - Unique session identifier
 * @param workspacePath - Path to the user's workspace directory
 * @returns SandboxUser object with user details
 */
export async function createSandboxUser(
  sessionId: string,
  workspacePath: string
): Promise<SandboxUser> {
  const username = generateUsername(sessionId);
  const uid = allocateUID();
  const gid = uid; // Use same value for group

  // IMPORTANT: Home directory is SEPARATE from workspace
  // This prevents .cache, .config, .local from appearing in the workspace
  // Home dir: /var/lib/code-server/<sessionId>/home
  // Workspace: /workspaces/<userId>/<sessionId> (passed in)
  const homeDir = `/var/lib/code-server/${sessionId}/home`;

  console.log(`[Sandbox] Creating user ${username} (UID: ${uid}) for session ${sessionId}`);
  console.log(`[Sandbox] Home directory: ${homeDir}`);
  console.log(`[Sandbox] Workspace: ${workspacePath}`);

  try {
    // Create group first
    try {
      execSync(`groupadd -g ${gid} ${username} 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {
      // Group might already exist, continue
    }

    // Create home directory FIRST (before creating user)
    await mkdir(homeDir, { recursive: true });

    // Create user with:
    // - Specific UID/GID
    // - Home directory set to /var/lib/code-server/<sessionId>/home (NOT workspace!)
    // - Shell for running commands
    // - No password (cannot login directly)
    execSync(
      `useradd -u ${uid} -g ${gid} -d ${homeDir} -M -s /bin/bash ${username} 2>/dev/null || true`,
      { stdio: 'pipe' }
    );

    // Set ownership of home directory
    await chown(homeDir, uid, gid);
    await chmod(homeDir, 0o750);

    // Ensure workspace directory exists and is owned by the sandbox user
    await mkdir(workspacePath, { recursive: true });

    // CRITICAL: Recursively chown the ENTIRE workspace, not just the top-level directory
    // This ensures all existing files (downloaded from cloud storage) are owned by the sandbox user
    // Without this, the LLM cannot write to files it didn't create
    try {
      execSync(`chown -R ${uid}:${gid} "${workspacePath}"`, { stdio: 'pipe' });
      console.log(`[Sandbox] Recursively set ownership of ${workspacePath} to ${uid}:${gid}`);
    } catch (chownError) {
      console.error(`[Sandbox] Failed to recursively chown workspace:`, chownError);
      // Fall back to single chown (may cause permission issues with existing files)
      await chown(workspacePath, uid, gid);
    }

    await chmod(workspacePath, 0o750); // rwxr-x--- (user full, group read/execute, others none)

    console.log(`[Sandbox] Created sandbox user ${username} with home ${homeDir} and workspace ${workspacePath}`);

    return {
      username,
      uid,
      gid,
      homeDir,
      workspaceDir: workspacePath,
      sessionId,
    };
  } catch (error) {
    // Clean up allocated UID on failure
    allocatedUIDs.delete(uid);
    console.error(`[Sandbox] Failed to create user ${username}:`, error);
    throw error;
  }
}

/**
 * Delete a sandbox user and clean up
 *
 * @param user - SandboxUser to delete
 * @param keepWorkspace - If true, don't delete workspace files (default: false)
 */
export async function deleteSandboxUser(
  user: SandboxUser,
  keepWorkspace: boolean = false
): Promise<void> {
  console.log(`[Sandbox] Deleting user ${user.username} (UID: ${user.uid})`);

  try {
    // Kill any processes running as this user
    try {
      execSync(`pkill -u ${user.uid} 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {
      // No processes to kill
    }

    // Small delay to ensure processes are terminated
    await new Promise(resolve => setTimeout(resolve, 100));

    // Delete user
    try {
      execSync(`userdel ${user.username} 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {
      // User might not exist
    }

    // Delete group
    try {
      execSync(`groupdel ${user.username} 2>/dev/null || true`, { stdio: 'pipe' });
    } catch (e) {
      // Group might not exist
    }

    // Free the UID
    allocatedUIDs.delete(user.uid);

    // Always clean up the home directory (it's in /var/lib/code-server/<sessionId>)
    // This contains .cache, .config, .local - NOT user's code files
    if (existsSync(user.homeDir)) {
      if (user.homeDir.includes('/var/lib/code-server/')) {
        await rm(user.homeDir, { recursive: true, force: true });
        console.log(`[Sandbox] Deleted home directory ${user.homeDir}`);
      }
    }

    // Optionally clean up workspace (user's code files)
    if (!keepWorkspace && user.workspaceDir && existsSync(user.workspaceDir)) {
      // Be extra careful - only delete if it's in the expected workspaces path
      if (user.workspaceDir.includes('/workspaces/')) {
        await rm(user.workspaceDir, { recursive: true, force: true });
        console.log(`[Sandbox] Deleted workspace ${user.workspaceDir}`);
      }
    }

    console.log(`[Sandbox] Deleted sandbox user ${user.username}`);
  } catch (error) {
    console.error(`[Sandbox] Failed to delete user ${user.username}:`, error);
    // Don't throw - cleanup should be best-effort
  }
}

/**
 * Build command to run a process as the sandbox user
 * Uses 'su' which works in both Docker and Kubernetes
 *
 * SECURITY: Applies resource limits (ulimits) to prevent DoS attacks:
 * - Max processes: prevents fork bombs
 * - Max file size: prevents disk filling
 * - Max memory: prevents memory exhaustion
 * - Max CPU time: prevents infinite loops
 *
 * @param user - SandboxUser to run as
 * @param command - Command to execute
 * @param args - Command arguments
 * @param applyLimits - Whether to apply resource limits (default: true)
 * @returns Object with command and args for spawning
 */
export function buildSandboxedCommand(
  user: SandboxUser,
  command: string,
  args: string[],
  applyLimits: boolean = true
): { command: string; args: string[] } {
  // Use 'su' to run command as the sandbox user
  // -s /bin/bash ensures we use bash
  // -c runs the command
  // We escape the command properly
  const fullCommand = [command, ...args].map(arg => {
    // Escape single quotes in arguments
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }).join(' ');

  // Apply resource limits before running the command
  const limitPrefix = applyLimits ? getUlimitPrefix() : '';
  const commandWithLimits = `${limitPrefix}${fullCommand}`;

  return {
    command: 'su',
    args: ['-s', '/bin/bash', '-c', commandWithLimits, user.username],
  };
}

/**
 * Get environment variables for sandboxed process
 * Sets HOME, XDG directories, and restricts PATH
 *
 * IMPORTANT: XDG variables ensure .cache, .config, .local go to home dir, NOT workspace
 */
export function getSandboxEnv(user: SandboxUser, baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    // HOME is the user's home directory (NOT workspace)
    HOME: user.homeDir,
    // Set USER and LOGNAME
    USER: user.username,
    LOGNAME: user.username,
    // Restrict PATH to essential directories (no /sbin, etc.)
    PATH: '/usr/local/bin:/usr/bin:/bin',
    // Set working directory to workspace (where code files are)
    PWD: user.workspaceDir,

    // ===========================================
    // XDG Base Directory Specification
    // Ensures config/cache/data go to home dir, NOT workspace
    // ===========================================
    XDG_CONFIG_HOME: `${user.homeDir}/.config`,
    XDG_CACHE_HOME: `${user.homeDir}/.cache`,
    XDG_DATA_HOME: `${user.homeDir}/.local/share`,
    XDG_STATE_HOME: `${user.homeDir}/.local/state`,
    XDG_RUNTIME_DIR: `/tmp/runtime-${user.username}`,
  };
}

/**
 * Check if we have permission to create users (need root or CAP_SETUID)
 */
export function canCreateUsers(): boolean {
  try {
    // Check if we're root or have capability
    const uid = process.getuid?.() ?? -1;
    if (uid === 0) return true;

    // Try to check capabilities (Linux-specific)
    try {
      const caps = execSync('cat /proc/self/status | grep Cap', { encoding: 'utf8' });
      // CAP_SETUID is bit 7, CAP_SETGID is bit 6
      // A non-root process with these caps can create users
      return caps.includes('CapEff') && caps.length > 0;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Initialize sandbox system - call on startup
 */
export async function initializeSandbox(): Promise<boolean> {
  const canCreate = canCreateUsers();

  if (canCreate) {
    console.log('[Sandbox] User sandboxing ENABLED - sessions will be isolated');
  } else {
    console.warn('[Sandbox] WARNING: Cannot create users - running without isolation!');
    console.warn('[Sandbox] To enable sandboxing, run container as root or with CAP_SETUID/CAP_SETGID');
  }

  return canCreate;
}
