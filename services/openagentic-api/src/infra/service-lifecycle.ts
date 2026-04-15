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
 * Service Lifecycle Manager
 *
 * Provides ordered startup (dependency-aware) and reverse-order graceful
 * shutdown for all platform services (Redis, Milvus, providers, etc.).
 *
 * Usage:
 *   const lifecycle = new ServiceLifecycle(logger);
 *   lifecycle.register('redis', redisService, { priority: 10 });
 *   lifecycle.register('milvus', milvusService, { priority: 20, dependsOn: ['redis'] });
 *   lifecycle.register('providerManager', providerMgr, { priority: 30 });
 *   await lifecycle.startAll();
 *   // ... on shutdown:
 *   await lifecycle.stopAll();
 */

import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// ManagedService interface
// ---------------------------------------------------------------------------

export interface ManagedService {
  /** Human-readable name (set automatically from registration key) */
  readonly name?: string;
  /** Start the service. Throw on failure. */
  start(): Promise<void>;
  /** Gracefully stop the service. Should be idempotent. */
  stop(): Promise<void>;
  /** Optional health check — returns true if healthy */
  healthCheck?(): Promise<boolean>;
}

export interface ServiceRegistration {
  /** Lower priority = starts first, stops last */
  priority: number;
  /** Names of services that must be started before this one */
  dependsOn?: string[];
  /** Timeout for start in ms (default 30s) */
  startTimeoutMs?: number;
  /** Timeout for stop in ms (default 10s) */
  stopTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

type ServiceState = 'registered' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

interface ServiceEntry {
  name: string;
  service: ManagedService;
  registration: Required<ServiceRegistration>;
  state: ServiceState;
  startedAt?: number;
  error?: Error;
}

// ---------------------------------------------------------------------------
// ServiceLifecycle
// ---------------------------------------------------------------------------

export class ServiceLifecycle {
  private services = new Map<string, ServiceEntry>();
  private logger: Logger;
  private started = false;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'ServiceLifecycle' });
  }

  /**
   * Register a service for lifecycle management.
   */
  register(name: string, service: ManagedService, opts: ServiceRegistration): void {
    if (this.services.has(name)) {
      this.logger.warn({ name }, 'Service already registered — replacing');
    }
    this.services.set(name, {
      name,
      service,
      registration: {
        priority: opts.priority,
        dependsOn: opts.dependsOn ?? [],
        startTimeoutMs: opts.startTimeoutMs ?? 30_000,
        stopTimeoutMs: opts.stopTimeoutMs ?? 10_000,
      },
      state: 'registered',
    });
  }

  /**
   * Start all registered services in dependency + priority order.
   */
  async startAll(): Promise<void> {
    const ordered = this.topologicalSort();
    this.logger.info(
      { order: ordered.map(e => e.name) },
      'Starting services in order',
    );

    for (const entry of ordered) {
      // Verify dependencies are running
      for (const dep of entry.registration.dependsOn) {
        const depEntry = this.services.get(dep);
        if (!depEntry || depEntry.state !== 'running') {
          entry.state = 'failed';
          entry.error = new Error(`Dependency "${dep}" is not running`);
          this.logger.error({ service: entry.name, dependency: dep }, 'Dependency not running — skipping service');
          continue;
        }
      }

      entry.state = 'starting';
      this.logger.info({ service: entry.name }, 'Starting service');

      try {
        await withTimeout(
          entry.service.start(),
          entry.registration.startTimeoutMs,
          `Service "${entry.name}" start timed out after ${entry.registration.startTimeoutMs}ms`,
        );
        entry.state = 'running';
        entry.startedAt = Date.now();
        this.logger.info({ service: entry.name }, 'Service started');
      } catch (error) {
        entry.state = 'failed';
        entry.error = error instanceof Error ? error : new Error(String(error));
        this.logger.error(
          { service: entry.name, error: entry.error.message },
          'Service failed to start',
        );
        // Continue starting other services — let them decide via dependency checks
      }
    }
    this.started = true;
  }

  /**
   * Stop all running services in reverse startup order.
   */
  async stopAll(): Promise<void> {
    const ordered = this.topologicalSort().reverse();
    this.logger.info(
      { order: ordered.map(e => e.name) },
      'Stopping services in reverse order',
    );

    for (const entry of ordered) {
      if (entry.state !== 'running') continue;

      entry.state = 'stopping';
      this.logger.info({ service: entry.name }, 'Stopping service');

      try {
        await withTimeout(
          entry.service.stop(),
          entry.registration.stopTimeoutMs,
          `Service "${entry.name}" stop timed out after ${entry.registration.stopTimeoutMs}ms`,
        );
        entry.state = 'stopped';
        this.logger.info({ service: entry.name }, 'Service stopped');
      } catch (error) {
        entry.state = 'failed';
        this.logger.error(
          { service: entry.name, error: (error as Error).message },
          'Service failed to stop gracefully',
        );
      }
    }
    this.started = false;
  }

  /**
   * Run health checks on all running services.
   */
  async healthCheckAll(): Promise<Record<string, { healthy: boolean; state: ServiceState; uptimeMs?: number }>> {
    const results: Record<string, { healthy: boolean; state: ServiceState; uptimeMs?: number }> = {};

    for (const [name, entry] of this.services) {
      let healthy = entry.state === 'running';
      if (healthy && entry.service.healthCheck) {
        try {
          healthy = await entry.service.healthCheck();
        } catch {
          healthy = false;
        }
      }
      results[name] = {
        healthy,
        state: entry.state,
        uptimeMs: entry.startedAt ? Date.now() - entry.startedAt : undefined,
      };
    }

    return results;
  }

  /**
   * Get current state of a specific service.
   */
  getState(name: string): ServiceState | undefined {
    return this.services.get(name)?.state;
  }

  /**
   * Check if all services are running.
   */
  isHealthy(): boolean {
    for (const entry of this.services.values()) {
      if (entry.state !== 'running') return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Topological sort by dependencies + priority
  // -------------------------------------------------------------------------

  private topologicalSort(): ServiceEntry[] {
    const entries = Array.from(this.services.values());
    const visited = new Set<string>();
    const result: ServiceEntry[] = [];

    const visit = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);
      const entry = this.services.get(name);
      if (!entry) return;
      for (const dep of entry.registration.dependsOn) {
        visit(dep);
      }
      result.push(entry);
    };

    // Sort by priority first, then topological order handles dependencies
    const byPriority = [...entries].sort(
      (a, b) => a.registration.priority - b.registration.priority,
    );

    for (const entry of byPriority) {
      visit(entry.name);
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ---------------------------------------------------------------------------
// Adapter: Wrap any object with start/stop into ManagedService
// ---------------------------------------------------------------------------

export function wrapAsManagedService(
  name: string,
  obj: {
    initialize?: () => Promise<void>;
    start?: () => Promise<void>;
    connect?: () => Promise<void>;
    close?: () => Promise<void>;
    stop?: () => Promise<void>;
    disconnect?: () => Promise<void>;
    shutdown?: () => Promise<void>;
    healthCheck?: () => Promise<boolean>;
    isReady?: () => boolean;
  },
): ManagedService {
  return {
    name,
    async start() {
      if (obj.initialize) await obj.initialize();
      else if (obj.start) await obj.start();
      else if (obj.connect) await obj.connect();
    },
    async stop() {
      if (obj.close) await obj.close();
      else if (obj.stop) await obj.stop();
      else if (obj.disconnect) await obj.disconnect();
      else if (obj.shutdown) await obj.shutdown();
    },
    async healthCheck() {
      if (obj.healthCheck) return obj.healthCheck();
      if (obj.isReady) return obj.isReady();
      return true;
    },
  };
}
