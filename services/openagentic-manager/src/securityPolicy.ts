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
 * Security Policy for Openagentic Sessions
 *
 * This module defines and enforces security restrictions for sandbox users.
 *
 * THREAT MODEL:
 * - Users (via LLM) can execute arbitrary commands
 * - We cannot trust ANY user input
 * - Assume the LLM can be jailbroken
 *
 * DEFENSE LAYERS:
 * 1. Linux user isolation (sandbox users)
 * 2. Resource limits (ulimits)
 * 3. Filesystem restrictions (read-only mounts, restricted paths)
 * 4. Network restrictions (optional, via iptables/nftables)
 * 5. Command blocklist (last resort, easily bypassed)
 */

import { execSync } from 'child_process';

/**
 * Resource limits for sandbox processes
 * These are applied via ulimit when spawning processes
 */
export const RESOURCE_LIMITS = {
  // Max processes per user (prevents fork bombs)
  // Note: Node.js + CLI + tool execution needs at least 200-300 processes
  NPROC: 512,
  // Max open files per process
  NOFILE: 1024,
  // Max file size in bytes (1GB)
  FSIZE: 1024 * 1024 * 1024,
  // Max virtual memory in bytes - DISABLED (unlimited)
  // Node.js WebAssembly (llhttp) requires significant virtual address space
  // Virtual memory != physical RAM - it includes shared libs, mapped files, etc.
  // Using 'unlimited' is safe; physical memory limits come from cgroups/container limits
  AS: 0, // 0 = unlimited (required for Node.js WebAssembly)
  // Max CPU time in seconds (prevents infinite loops hogging CPU)
  CPU: 3600, // 1 hour
  // Max data segment size - DISABLED (unlimited)
  // Node.js heap is managed by V8, not the data segment limit
  DATA: 0, // 0 = unlimited (required for Node.js)
  // Max stack size (8MB)
  STACK: 8 * 1024 * 1024,
  // Max core dump size (0 = disabled)
  CORE: 0,
  // Max pending signals
  SIGPENDING: 100,
  // Max message queue bytes
  MSGQUEUE: 819200,
  // Max nice priority (cannot increase priority)
  NICE: 0,
  // Max real-time priority (0 = no RT scheduling)
  RTPRIO: 0,
};

/**
 * Paths that sandbox users should NOT be able to read
 * These are sensitive system files
 */
export const RESTRICTED_READ_PATHS = [
  '/etc/shadow',
  '/etc/gshadow',
  '/etc/sudoers',
  '/etc/sudoers.d',
  '/root',
  '/proc/*/environ', // Other process env vars (contains secrets)
  '/proc/*/fd',
  '/proc/*/maps',
  '/var/log',
  '/var/lib/code-server', // Other sessions' data (except own)
];

/**
 * Paths that sandbox users should NOT be able to write to
 */
export const RESTRICTED_WRITE_PATHS = [
  '/',
  '/bin',
  '/sbin',
  '/usr',
  '/etc',
  '/var',
  '/opt',
  '/root',
  '/proc',
  '/sys',
  '/dev',
  '/boot',
  '/lib',
  '/lib64',
];

/**
 * Commands that are COMPLETELY blocked (cannot be bypassed easily)
 * These are checked before execution
 */
export const BLOCKED_COMMANDS = [
  // System administration
  'mount',
  'umount',
  'fdisk',
  'mkfs',
  'fsck',
  'parted',
  'lvm',
  'mdadm',
  // User/group management
  'useradd',
  'userdel',
  'usermod',
  'groupadd',
  'groupdel',
  'groupmod',
  'passwd',
  'chpasswd',
  // Permission escalation
  'sudo',
  'su',
  'doas',
  'pkexec',
  // System control
  'systemctl',
  'service',
  'init',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  // Kernel/module
  'insmod',
  'rmmod',
  'modprobe',
  'sysctl',
  // Container escape attempts
  'docker',
  'podman',
  'kubectl',
  'crictl',
  'containerd',
  'runc',
  // Network configuration
  'iptables',
  'ip6tables',
  'nftables',
  'firewall-cmd',
  'ufw',
  'ifconfig',
  'ip',
  'route',
  'brctl',
  // Dangerous utilities
  'nc',      // Netcat - can create reverse shells
  'ncat',
  'netcat',
  'nmap',    // Network scanning
  'tcpdump', // Packet capture
  'wireshark',
  'tshark',
  'strace',  // Can trace other processes
  'ltrace',
  'ptrace',
  'gdb',     // Debugger - can attach to processes
  'lldb',
  // Cron (persistence)
  'crontab',
  'at',
  'batch',
];

/**
 * Patterns that indicate potentially malicious commands
 * These are regex patterns checked against the full command
 */
export const DANGEROUS_PATTERNS = [
  // Destructive file operations on system paths
  /\brm\s+(-[rf]+\s+)*\//,              // rm / rm -rf /
  /\bfind\s+\/\s+.*-delete/,            // find / -delete
  /\bshred\s+/,                         // Secure delete

  // Reverse shells
  /\bbash\s+-i\s+>&?\s*\/dev\/tcp/,     // Bash reverse shell
  /\bpython.*socket.*connect/,           // Python reverse shell
  /\bnc\s+.*-e\s+\/bin/,                // Netcat shell
  /\bperl.*socket.*exec/,               // Perl reverse shell

  // Download and execute
  /\b(wget|curl|fetch).*\|\s*(ba)?sh/,  // Pipe to shell
  /\b(wget|curl|fetch).*>\s*\S+\s*;\s*(ba)?sh/, // Download then execute
  /\bpython.*urllib.*exec/,             // Python download+exec

  // Fork bombs and resource exhaustion
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/,   // Classic fork bomb
  /\bwhile\s+true\s*;\s*do.*done/,      // Infinite loop
  /\byes\s*\|/,                         // yes | command (resource exhaustion)

  // Writing to system paths
  />\s*\/etc\//,                        // Redirect to /etc
  />\s*\/bin\//,
  />\s*\/usr\//,
  />\s*\/var\//,
  />\s*\/dev\//,

  // Modifying permissions dangerously
  /\bchmod\s+[0-7]*[4-7][0-7]*\s+\//,   // setuid on system files
  /\bchmod\s+[0-7]*s/,                  // setuid/setgid
  /\bchown\s+root/,                     // Changing owner to root

  // Process manipulation
  /\bkill\s+-9\s+-1/,                   // Kill all processes
  /\bkillall\s+-9/,
  /\bpkill\s+/,

  // Environment/credential theft
  /\bcat\s+.*\.env\b.*\|\s*(curl|wget|nc)/, // Exfiltrate env files
  /\benv\b.*\|\s*(curl|wget|nc)/,       // Exfiltrate environment
  /\/proc\/\d+\/environ/,               // Read other process env

  // Mining
  /\bxmrig\b/,
  /\bminerd\b/,
  /\bcpuminer\b/,
  /stratum\+tcp/,                       // Mining pool connections
];

/**
 * Apply resource limits to a process
 * Call this before exec() to limit the spawned process
 *
 * Note: Virtual memory (AS) and data segment (DATA) limits are disabled
 * because Node.js WebAssembly requires significant virtual address space.
 * Physical memory limits should come from container resource limits (cgroups).
 */
export function getUlimitPrefix(): string {
  const limits = [
    `ulimit -u ${RESOURCE_LIMITS.NPROC}`,      // max processes
    `ulimit -n ${RESOURCE_LIMITS.NOFILE}`,    // max open files
    `ulimit -f ${Math.floor(RESOURCE_LIMITS.FSIZE / 512)}`, // max file size (in 512-byte blocks)
    // Virtual memory limit disabled - Node.js WebAssembly needs unlimited virtual address space
    // `ulimit -v unlimited` would work but we just skip it since default is unlimited
    `ulimit -t ${RESOURCE_LIMITS.CPU}`,        // CPU time
    // Data segment limit disabled - Node.js V8 manages its own heap
    `ulimit -s ${Math.floor(RESOURCE_LIMITS.STACK / 1024)}`, // stack size (in KB)
    `ulimit -c ${RESOURCE_LIMITS.CORE}`,       // core dump size
  ];
  return limits.join(' && ') + ' && ';
}

/**
 * Check if a command is allowed to run
 * Returns { allowed: boolean, reason?: string }
 */
export function checkCommand(command: string): { allowed: boolean; reason?: string } {
  const normalizedCmd = command.toLowerCase().trim();

  // Check blocked commands (exact match at word boundary)
  for (const blocked of BLOCKED_COMMANDS) {
    const regex = new RegExp(`\\b${blocked}\\b`, 'i');
    if (regex.test(normalizedCmd)) {
      return {
        allowed: false,
        reason: `Command '${blocked}' is blocked for security reasons`
      };
    }
  }

  // Check dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason: `Command matches dangerous pattern: ${pattern.source.slice(0, 50)}...`
      };
    }
  }

  return { allowed: true };
}

/**
 * Check if a file path is allowed for reading
 */
export function canReadPath(path: string, userWorkspace: string, userHome: string): boolean {
  const normalizedPath = path.replace(/\/+/g, '/');

  // Always allow reading from own workspace and home
  if (normalizedPath.startsWith(userWorkspace) || normalizedPath.startsWith(userHome)) {
    return true;
  }

  // Check restricted paths
  for (const restricted of RESTRICTED_READ_PATHS) {
    if (restricted.includes('*')) {
      // Glob pattern - convert to regex
      const regexPattern = restricted.replace(/\*/g, '[^/]+');
      if (new RegExp(`^${regexPattern}`).test(normalizedPath)) {
        return false;
      }
    } else if (normalizedPath.startsWith(restricted)) {
      return false;
    }
  }

  // Allow reading most system files (they're already protected by Linux permissions)
  return true;
}

/**
 * Check if a file path is allowed for writing
 */
export function canWritePath(path: string, userWorkspace: string, userHome: string): boolean {
  const normalizedPath = path.replace(/\/+/g, '/');

  // Only allow writing to own workspace and home
  if (normalizedPath.startsWith(userWorkspace) || normalizedPath.startsWith(userHome)) {
    return true;
  }

  // Allow writing to /tmp (needed for many tools)
  if (normalizedPath.startsWith('/tmp/')) {
    return true;
  }

  // Block everything else
  return false;
}

/**
 * Setup network restrictions for a user (requires root)
 * Uses iptables to restrict outbound connections
 *
 * OPTIONAL: Only enable if you want to restrict network access
 */
export function setupNetworkRestrictions(uid: number, allowedHosts: string[] = []): void {
  try {
    // Drop all outbound by default for this UID
    execSync(`iptables -A OUTPUT -m owner --uid-owner ${uid} -j DROP`, { stdio: 'pipe' });

    // Allow localhost
    execSync(`iptables -I OUTPUT -m owner --uid-owner ${uid} -d 127.0.0.1 -j ACCEPT`, { stdio: 'pipe' });

    // Allow specific hosts if provided
    for (const host of allowedHosts) {
      execSync(`iptables -I OUTPUT -m owner --uid-owner ${uid} -d ${host} -j ACCEPT`, { stdio: 'pipe' });
    }

    console.log(`[Security] Network restrictions applied for UID ${uid}`);
  } catch (err) {
    console.warn(`[Security] Failed to apply network restrictions (iptables not available?):`, err);
  }
}

/**
 * Remove network restrictions for a user
 */
export function removeNetworkRestrictions(uid: number): void {
  try {
    // Remove all rules for this UID
    execSync(`iptables -D OUTPUT -m owner --uid-owner ${uid} -j DROP 2>/dev/null || true`, { stdio: 'pipe' });
    execSync(`iptables -D OUTPUT -m owner --uid-owner ${uid} -d 127.0.0.1 -j ACCEPT 2>/dev/null || true`, { stdio: 'pipe' });
  } catch {
    // Ignore errors - rules might not exist
  }
}

/**
 * Security configuration that can be adjusted per-deployment
 */
export interface SecurityConfig {
  // Enable resource limits (ulimits)
  enableResourceLimits: boolean;
  // Enable network restrictions (requires iptables)
  enableNetworkRestrictions: boolean;
  // Hosts allowed for network access (if network restrictions enabled)
  allowedNetworkHosts: string[];
  // Enable command blocklist checking
  enableCommandBlocklist: boolean;
  // Max workspace size in bytes
  maxWorkspaceSize: number;
  // Max single file size in bytes
  maxFileSize: number;
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enableResourceLimits: true,
  enableNetworkRestrictions: false, // Disabled by default - requires iptables
  allowedNetworkHosts: [
    '127.0.0.1',
    'localhost',
    // Add GitHub, npm, PyPI, etc. if needed
  ],
  enableCommandBlocklist: true,
  maxWorkspaceSize: 5 * 1024 * 1024 * 1024, // 5GB
  maxFileSize: 100 * 1024 * 1024, // 100MB
};

/**
 * Print security status for debugging
 */
export function printSecurityStatus(): void {
  console.log('=== OPENAGENTIC SECURITY STATUS ===');
  console.log('Resource Limits:', RESOURCE_LIMITS);
  console.log('Blocked Commands:', BLOCKED_COMMANDS.length);
  console.log('Dangerous Patterns:', DANGEROUS_PATTERNS.length);
  console.log('================================');
}
