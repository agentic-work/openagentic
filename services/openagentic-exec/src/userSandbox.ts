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
 * User Sandbox Management for Exec Daemon
 *
 * Creates isolated Linux users for each session to provide
 * process-level isolation and prevent access to other users' data.
 *
 * Users are named based on their login email (sanitized for Linux):
 *   john.doe@company.com -> john-doe
 *   admin@openagentics.io -> admin
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, chownSync, readdirSync, copyFileSync } from 'fs';
import { join, basename } from 'path';
import { config } from './config';
import { loggers } from './logger.js';

// Template notebooks location (copied during Docker build)
const NOTEBOOKS_TEMPLATE_DIR = '/var/lib/openagentic/notebooks';

// Track allocated UIDs to prevent collisions
const allocatedUids = new Set<number>();

// Track username -> UID mapping for reuse (same user should get same UID)
const usernameToUid = new Map<string, number>();

/**
 * Sanitize email to create a valid Linux username
 * - Extract local part (before @)
 * - Replace dots and special chars with hyphens
 * - Lowercase everything
 * - Max 32 chars for Linux
 *
 * Examples:
 *   john.doe@company.com -> john-doe
 *   John_Smith@example.org -> john-smith
 *   admin@openagentics.io -> admin
 */
export function sanitizeEmailToUsername(email: string): string {
  // Extract local part (before @)
  const localPart = email.split('@')[0] || email;

  // Sanitize: lowercase, replace special chars with hyphen
  let username = localPart
    .toLowerCase()
    .replace(/[._+]/g, '-')      // dots, underscores, plus -> hyphen
    .replace(/[^a-z0-9-]/g, '')  // remove any other special chars
    .replace(/-+/g, '-')         // collapse multiple hyphens
    .replace(/^-|-$/g, '');      // trim leading/trailing hyphens

  // Ensure it starts with a letter (Linux requirement)
  if (!/^[a-z]/.test(username)) {
    username = 'u' + username;
  }

  // Max 32 chars for Linux username
  return username.slice(0, 32);
}

/**
 * Initialize sandbox system - clean up stale users from previous runs
 * and populate allocatedUids with existing sandbox users
 */
export async function initSandboxSystem(): Promise<void> {
  loggers.sandbox.info('Initializing sandbox system...');

  try {
    // Find all existing sandbox users in our UID range
    // We now use actual usernames (not aw_ prefix), but we clean up both old and new style
    const passwdOutput = execSync('getent passwd', { encoding: 'utf-8' });
    const sandboxUsers: { username: string; uid: number }[] = [];

    for (const line of passwdOutput.split('\n')) {
      const parts = line.split(':');
      if (parts.length >= 3) {
        const username = parts[0];
        const uid = parseInt(parts[2], 10);
        // Check if UID is in our sandbox range
        if (!isNaN(uid) && uid >= config.sandboxUidMin && uid < config.sandboxUidMax) {
          sandboxUsers.push({ username, uid });
          // Track existing users for reuse
          usernameToUid.set(username, uid);
          allocatedUids.add(uid);
        }
      }
    }

    if (sandboxUsers.length > 0) {
      loggers.sandbox.info({ count: sandboxUsers.length, uidMin: config.sandboxUidMin, uidMax: config.sandboxUidMax }, 'Found existing sandbox users');
      // Note: We don't clean up users anymore since pods are permanent per user
      // Users persist across sessions for the same user
    }

    loggers.sandbox.info('Sandbox system initialized');
  } catch (error) {
    loggers.sandbox.error({ err: error }, 'Failed to initialize sandbox system');
    // Non-fatal - continue without cleanup
  }
}

export interface SandboxUser {
  username: string;
  uid: number;
  gid: number;
  homeDir: string;
}

export interface CreateSandboxUserOptions {
  /** User's email address (used to generate Linux username) */
  userEmail: string;
  /** Workspace path for the user */
  workspacePath: string;
  /** Optional: session ID for fallback if email not provided */
  sessionId?: string;
}

/**
 * Create a sandboxed Linux user for a session
 *
 * Username is derived from the user's email address:
 *   john.doe@company.com -> john-doe
 *   admin@openagentics.io -> admin
 *
 * The same user always gets the same username and UID (reused across sessions)
 */
export async function createSandboxUser(options: CreateSandboxUserOptions): Promise<SandboxUser> {
  const { userEmail, workspacePath, sessionId } = options;

  // Generate username from email (or fallback to session ID)
  let username: string;
  if (userEmail) {
    username = sanitizeEmailToUsername(userEmail);
  } else if (sessionId) {
    // Fallback for backwards compatibility
    username = `aw_${sessionId.slice(0, 8)}`;
  } else {
    throw new Error('Either userEmail or sessionId must be provided');
  }

  // Check if user already exists and reuse their UID
  let uid: number;
  let gid: number;

  if (usernameToUid.has(username)) {
    // Reuse existing UID for this user
    uid = usernameToUid.get(username)!;
    gid = uid;
    loggers.sandbox.info({ uid, username }, 'Reusing UID for existing user');
  } else {
    // Find an available UID
    uid = config.sandboxUidMin;
    while (allocatedUids.has(uid) && uid < config.sandboxUidMax) {
      uid++;
    }

    if (uid >= config.sandboxUidMax) {
      throw new Error('No available UIDs for sandbox user');
    }

    allocatedUids.add(uid);
    usernameToUid.set(username, uid);
    gid = uid; // Use same value for GID
  }

  try {
    // Check if user already exists in the system
    try {
      execSync(`id ${username}`, { stdio: 'pipe' });
      loggers.sandbox.info({ username }, 'User already exists, reusing');
    } catch {
      // User doesn't exist, create it
      loggers.sandbox.info({ username, uid, userEmail }, 'Creating user');

      // Create group first
      try {
        execSync(`groupadd -g ${gid} ${username}`, { stdio: 'pipe' });
      } catch {
        // Group might already exist
      }

      // Create user with bash shell and specific home directory
      // Note: No extra groups needed - brew was removed, uv runs without elevated perms
      execSync(
        `useradd -u ${uid} -g ${gid} -d "${workspacePath}" -s /bin/bash -M ${username}`,
        { stdio: 'pipe' }
      );
    }

    // Ensure workspace directory exists and is owned by sandbox user
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }
    chownSync(workspacePath, uid, gid);

    // Create XDG directories to isolate config/cache from workspace
    // Create config directories for CLI tools
    const xdgDirs = [
      join(workspacePath, '.config'),
      join(workspacePath, '.cache'),
      join(workspacePath, '.local'),
      join(workspacePath, '.local', 'bin'),  // pip --user installs go here
      join(workspacePath, '.openagentic'),    // Required by openagentic CLI
    ];

    for (const dir of xdgDirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      chownSync(dir, uid, gid);
    }

    const { writeFileSync, chmodSync } = await import('fs');

    // Create .bashrc with Homebrew-first PATH
    const bashrcPath = join(workspacePath, '.bashrc');
    const bashrcContent = `# OpenAgentic User Environment
# Auto-generated by openagentic-exec

# Homebrew (primary package manager - install anything: brew install go python kubectl etc.)
eval "\$(/home/linuxbrew/.linuxbrew/bin/brew shellenv 2>/dev/null)" || true

# System + runtime tools
export PATH="/opt/tools/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"

# User-installed tools (Rust/Cargo, Python, Node.js, Go)
export PATH="\$HOME/.cargo/bin:\$HOME/.local/bin:\$HOME/.npm-global/bin:\$HOME/go/bin:\$PATH"

# pip: default to --user installs (no root needed)
export PIP_USER=1
export PYTHONUSERBASE="\$HOME/.local"

# Prompt
export PS1="\\[\\033[01;32m\\]\\u@openagentic\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ "

# Aliases
alias ll='ls -la'
alias la='ls -A'
alias l='ls -CF'
`;

    writeFileSync(bashrcPath, bashrcContent);
    chownSync(bashrcPath, uid, gid);

    // Also create .profile to source .bashrc for login shells
    const profilePath = join(workspacePath, '.profile');
    const profileContent = `# Source .bashrc for interactive shells
if [ -f "\$HOME/.bashrc" ]; then
    . "\$HOME/.bashrc"
fi
`;
    writeFileSync(profilePath, profileContent);
    chownSync(profilePath, uid, gid);

    // Create .npmrc so `npm install -g` writes to user's home, not /usr/local
    const npmrcPath = join(workspacePath, '.npmrc');
    const npmrcContent = `prefix=\${HOME}/.npm-global
cache=\${HOME}/.npm
`;
    writeFileSync(npmrcPath, npmrcContent);
    chownSync(npmrcPath, uid, gid);

    // Create the npm-global directory
    const npmGlobalDir = join(workspacePath, '.npm-global');
    try { mkdirSync(npmGlobalDir, { recursive: true }); chownSync(npmGlobalDir, uid, gid); } catch {}

    // Create .claude/settings.json with onboarding bypass + platform hooks.
    // ALWAYS overwrite — hooks config must be current for each session.
    const claudeDir = join(workspacePath, '.claude');
    try {
      mkdirSync(claudeDir, { recursive: true });
      chownSync(claudeDir, uid, gid);
      const settingsPath = join(claudeDir, 'settings.json');

      // Platform hooks: POST structured events back to exec daemon on tool use.
      // The exec daemon forwards these to the code manager → UI sideband WebSocket.
      // This enables platform React components (file explorer, status bar, activity tree)
      // to react to CLI activity without parsing ANSI PTY output.
      const sid = sessionId || 'unknown';
      const hookBase = `http://localhost:3060/hooks`;
      const settings: Record<string, any> = {
        hasCompletedOnboarding: true,
        theme: 'dark',
        verbose: true,
        autoCompact: true,     // Auto-compact context when approaching limits — users never manually compact
        hooks: {
          PreToolUse: [{
            type: 'command' as const,
            command: `curl -sf -m 2 -X POST ${hookBase}/tool-start -H 'Content-Type:application/json' -d '{"session":"${sid}","tool":"'$TOOL_NAME'"}' 2>/dev/null || true`,
            timeout: 3,
          }],
          PostToolUse: [{
            type: 'command' as const,
            command: `curl -sf -m 2 -X POST ${hookBase}/tool-end -H 'Content-Type:application/json' -d '{"session":"${sid}","tool":"'$TOOL_NAME'","exit":"'$EXIT_CODE'"}' 2>/dev/null || true`,
            timeout: 3,
          }],
        },
      };

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      chownSync(settingsPath, uid, gid);
      loggers.sandbox.info({ settingsPath, sessionId: sid }, 'Created openagentic settings with platform hooks');
    } catch (err) {
      loggers.sandbox.warn({ err }, 'Failed to create .claude/settings.json');
    }

    // Write managed enterprise config for openagentic CLI marketplace lockdown.
    // These files at /etc/openagentic/ are read by the CLI at startup and enforce:
    // - strictKnownMarketplaces: [] (no user marketplaces allowed)
    // - blockedMarketplaces: wildcard block
    // - strictPluginOnlyCustomization: true (no custom skills/hooks/MCP outside plugins)
    // - allowManagedMcpServersOnly: true (only admin-approved MCP servers)
    // The config is fetched by ptyManager from the API before sandbox creation.
    if ((options as any).managedSettings || (options as any).managedMcp) {
      try {
        const managedDir = '/etc/openagentic';
        mkdirSync(managedDir, { recursive: true });

        if ((options as any).managedSettings) {
          const msPath = join(managedDir, 'managed-settings.json');
          writeFileSync(msPath, JSON.stringify((options as any).managedSettings, null, 2));
          chmodSync(msPath, 0o644);
        }

        if ((options as any).managedMcp) {
          const mcpPath = join(managedDir, 'managed-mcp.json');
          writeFileSync(mcpPath, JSON.stringify((options as any).managedMcp, null, 2));
          chmodSync(mcpPath, 0o644);
        }

        loggers.sandbox.info('Wrote /etc/openagentic/ managed config (marketplace locked)');
      } catch (err) {
        loggers.sandbox.warn({ err }, 'Failed to write managed enterprise config');
      }
    }

    // Copy tutorial notebooks to user's workspace (if template dir exists)
    const notebooksDir = join(workspacePath, 'notebooks');
    if (existsSync(NOTEBOOKS_TEMPLATE_DIR) && !existsSync(notebooksDir)) {
      try {
        mkdirSync(notebooksDir, { recursive: true });
        chownSync(notebooksDir, uid, gid);

        // Copy all .ipynb files from template
        const templateFiles = readdirSync(NOTEBOOKS_TEMPLATE_DIR);
        for (const file of templateFiles) {
          if (file.endsWith('.ipynb')) {
            const srcPath = join(NOTEBOOKS_TEMPLATE_DIR, file);
            const destPath = join(notebooksDir, file);
            copyFileSync(srcPath, destPath);
            chownSync(destPath, uid, gid);
          }
        }
        loggers.sandbox.info({ count: templateFiles.filter(f => f.endsWith('.ipynb')).length, notebooksDir }, 'Copied tutorial notebooks');
      } catch (error) {
        loggers.sandbox.warn({ err: error }, 'Failed to copy notebooks');
        // Non-fatal - continue without notebooks
      }
    }

    // Copy OPENAGENTIC.md and README.md templates to workspace root (if not already present)
    const TEMPLATES_DIR = '/app/templates';
    const templateFiles = [
      { src: 'OPENAGENTIC.md', dest: 'OPENAGENTIC.md' },
      { src: 'README.md', dest: 'README.md' },
    ];

    for (const { src, dest } of templateFiles) {
      const srcPath = join(TEMPLATES_DIR, src);
      const destPath = join(workspacePath, dest);

      // Only copy if source exists and destination doesn't
      if (existsSync(srcPath) && !existsSync(destPath)) {
        try {
          copyFileSync(srcPath, destPath);
          chownSync(destPath, uid, gid);
          loggers.sandbox.info({ file: dest }, 'Created template file in workspace');
        } catch (error) {
          loggers.sandbox.warn({ src, err: error }, 'Failed to copy template file');
          // Non-fatal - continue without template
        }
      }
    }

    // Create projects directory if it doesn't exist
    const projectsDir = join(workspacePath, 'projects');
    if (!existsSync(projectsDir)) {
      try {
        mkdirSync(projectsDir, { recursive: true });
        chownSync(projectsDir, uid, gid);
        loggers.sandbox.info('Created projects directory');
      } catch (error) {
        loggers.sandbox.warn({ err: error }, 'Failed to create projects dir');
      }
    }

    loggers.sandbox.info({ username, workspacePath }, 'User ready with workspace');

    return {
      username,
      uid,
      gid,
      homeDir: workspacePath,
    };
  } catch (error) {
    // Don't delete UID from tracking - user might exist in system
    throw error;
  }
}

/**
 * Delete a sandboxed user
 */
export async function deleteSandboxUser(username: string): Promise<void> {
  try {
    // Get UID before deleting
    const uidOutput = execSync(`id -u ${username}`, { stdio: 'pipe' }).toString().trim();
    const uid = parseInt(uidOutput);

    // Kill any processes owned by this user (SIGTERM first, then SIGKILL)
    try {
      execSync(`pkill -u ${username}`, { stdio: 'pipe' });
    } catch {
      // No processes to kill
    }

    // Wait for processes to die, then force-kill any survivors
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      execSync(`pkill -9 -u ${username}`, { stdio: 'pipe' });
    } catch {
      // No processes remaining
    }
    await new Promise(resolve => setTimeout(resolve, 500));

    // Delete user
    execSync(`userdel ${username}`, { stdio: 'pipe' });

    // Delete group
    try {
      execSync(`groupdel ${username}`, { stdio: 'pipe' });
    } catch {
      // Group might not exist or be in use
    }

    // Release UID
    allocatedUids.delete(uid);

    loggers.sandbox.info({ username }, 'Deleted user');
  } catch (error) {
    loggers.sandbox.warn({ username, err: error }, 'Failed to delete user');
  }
}

/**
 * Build a command that runs as the sandbox user with resource limits
 *
 * IMPORTANT: Uses `su -s /bin/bash` instead of `su -l` because:
 * - `su -l` creates a login session that detaches the terminal from child processes
 * - This causes the CLI's stdout to not be connected to the PTY
 * - Without PTY connection, no output is captured by node-pty
 *
 * The `-s /bin/bash` flag explicitly uses bash without the login shell behavior.
 * We source .bashrc manually to get the user's environment.
 */
export function buildSandboxedCommand(username: string, command: string): string {
  // Resource limits via ulimit
  const limits = [
    'ulimit -u 512',      // Max processes
    'ulimit -n 1024',     // Max open files
    'ulimit -f 2097152',  // Max file size (1GB in 512-byte blocks)
    'ulimit -t 3600',     // Max CPU time (1 hour)
    'ulimit -s 8192',     // Max stack size (8MB in KB)
    'ulimit -c 0',        // No core dumps
  ].join(' && ');

  // su resets env — whitelist critical vars so CLI can authenticate with the platform API
  const whitelistEnvVars = [
    'OPENAGENTIC_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL',
    'OPENAGENTIC_API_ENDPOINT', 'OPENAGENTIC_API_KEY', 'OPENAGENTIC_MODEL',
    'OPENAGENTIC_THEME',
    'OPENAGENTIC_PROXY_URL', 'GITHUB_TOKEN', 'GH_TOKEN',
    'HOME', 'PATH', 'TERM', 'LANG', 'HOMEBREW_PREFIX', 'HOMEBREW_CELLAR',
    'HOMEBREW_REPOSITORY', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
  ];
  const whitelistFlag = whitelistEnvVars.map(v => `--whitelist-environment=${v}`).join(' ');

  // Source the user's .bashrc for PATH and env setup, then run command
  // Use `su -s /bin/bash` with --whitelist-environment to preserve API auth env vars
  const escapedCommand = command.replace(/'/g, "'\\''");
  return `su -s /bin/bash ${whitelistFlag} ${username} -c 'source ~/.bashrc 2>/dev/null; ${limits} && ${escapedCommand}'`;
}

/**
 * Get environment variables for sandbox user
 */
export function getSandboxEnv(user: SandboxUser, apiKey?: string, apiEndpoint?: string, model?: string): Record<string, string> {
  // Build PATH - Homebrew first (user-installed tools take priority)
  const BREW_PREFIX = '/home/linuxbrew/.linuxbrew';
  const pathComponents = [
    `${BREW_PREFIX}/bin`,                       // Homebrew binaries (go, python, kubectl, etc.)
    `${BREW_PREFIX}/sbin`,                      // Homebrew sbin
    join(user.homeDir, '.local', 'bin'),       // User's pip --user packages
    join(user.homeDir, '.cargo', 'bin'),       // User's Rust tools
    join(user.homeDir, 'go', 'bin'),           // User's Go tools
    join(user.homeDir, '.npm-global', 'bin'),  // User's npm global packages
    '/opt/tools/bin',                           // Runtime tools (kubectl, helm, aws, etc.)
    '/usr/local/bin',                           // System tools
    '/usr/bin',
    '/bin',
  ];

  const env: Record<string, string> = {
    HOME: user.homeDir,
    USER: user.username,
    LOGNAME: user.username,
    XDG_CONFIG_HOME: join(user.homeDir, '.config'),
    XDG_CACHE_HOME: join(user.homeDir, '.cache'),
    XDG_DATA_HOME: join(user.homeDir, '.local', 'share'),
    PATH: pathComponents.join(':'),
    TERM: 'xterm-256color',
    LANG: 'en_US.UTF-8',
    // Homebrew environment
    HOMEBREW_PREFIX: BREW_PREFIX,
    HOMEBREW_CELLAR: `${BREW_PREFIX}/Cellar`,
    HOMEBREW_REPOSITORY: `${BREW_PREFIX}/Homebrew`,
  };

  // Add API key, endpoint, and model if provided (for platform LLM access)
  // OpenAgentic v2 reads OPENAGENTIC_API_KEY for auth and ANTHROPIC_BASE_URL for the API endpoint
  if (apiKey) {
    env.OPENAGENTIC_API_KEY = apiKey;
    env.ANTHROPIC_API_KEY = apiKey; // Fallback for Anthropic SDK compatibility
  }
  if (apiEndpoint) {
    env.OPENAGENTIC_API_ENDPOINT = apiEndpoint;
    env.ANTHROPIC_BASE_URL = `${apiEndpoint}/api/openagentic`; // CLI reads this for API calls
  }
  if (model) {
    env.OPENAGENTIC_MODEL = model;
  }

  // GitHub token for git operations (clone, push, gh CLI, etc.)
  if (process.env.GITHUB_TOKEN) {
    env.GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    env.GH_TOKEN = process.env.GITHUB_TOKEN;
  }

  // Agent proxy URL for subagent delegation (openagentic-proxy service)
  env.OPENAGENTIC_PROXY_URL = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-openagentic-proxy:3300';

  // Plugin lockdown is handled by /etc/openagentic/managed-settings.json (written per session).
  // That file restricts which marketplaces/plugins/MCP servers are allowed via policy fields.
  // We do NOT set OPENAGENTIC_MANAGED_MODE=true — that would block ALL network plugin fetching,
  // preventing the CLI from downloading the official plugins on first start.
  // Instead, the managed-settings.json policy lets the CLI fetch from the official marketplace
  // while blocking users from adding unauthorized sources.

  return env;
}
