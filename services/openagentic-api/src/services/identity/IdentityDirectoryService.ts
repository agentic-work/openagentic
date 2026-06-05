/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  OpenAgentic Enterprise — Runtime Identity Directory (SSO) registry
 *  Copyright © Agenticwork™ LLC. All rights reserved.
 *
 *  ENTERPRISE SOFTWARE — licensed ONLY under the OpenAgentic Enterprise License
 *  (/ee/LICENSE), NOT the repository's Apache-2.0 license. A paid Agenticwork LLC
 *  subscription is required to use this in production. Reading the source grants no
 *  license. Using, selling, hosting as a service, redistributing, or modifying it
 *  without a subscription — or removing the license gate — is a breach of
 *  /ee/LICENSE §4 and an infringement of Agenticwork's copyright.
 *  Licensing: licensing@agenticwork.io
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
/**
 * Identity Directory Service — runtime SSO directory registry + atomic-swap manager.
 *
 * The 1:1 structural analogue of services/llm-providers/ProviderManager for the
 * SSO identity-directory registry. It holds a keyed Map of live auth-strategy
 * instances (one per enabled `identity_directories` row) and hot-reloads them
 * from the database without an API restart, mirroring
 * ProviderManager.reloadProviders()'s ATOMIC-SWAP-of-keyed-Map (the #74 fix):
 * a fresh map is built fully in a temporary, then swapped in a single
 * assignment, so no request ever observes an empty registry — the old map keeps
 * serving until the new one is ready.
 *
 * ARCHITECTURE: Database is the SINGLE SOURCE OF TRUTH. IdentityDirectoryConfigService
 * loads + decrypts the enabled rows; this service constructs a per-directory
 * strategy instance from the FULL decrypted config (so the env fallback inside
 * AzureADAuthService / GoogleAuthService never fires for a DB-driven directory —
 * the constructor receives every field explicitly).
 *
 * HOT RELOAD: subscribes to the SAME Redis pub/sub channel ProviderManager uses
 * for cross-replica invalidation semantics, so an admin CRUD write on any API
 * replica reloads the directory registry on all of them. The dedicated
 * directory channel is published by the admin CRUD route (Phase C task 7); the
 * provider channel is reused as a belt-and-braces wakeup.
 *
 * SECURITY: clientSecret is decrypted by IdentityDirectoryConfigService (it is a
 * member of CredentialEncryptionService.SENSITIVE_FIELDS) — no crypto here.
 */

import type { Logger } from 'pino';
import { AzureADAuthService } from '../../auth/azureADAuth.js';
import { GoogleAuthService } from '../../auth/googleAuth.js';
import {
  IdentityDirectoryConfigService,
  type DirectoryConfig,
} from './IdentityDirectoryConfigService.js';

/**
 * Redis pub/sub channel for directory registry invalidation. Distinct from
 * ProviderManager's `provider:reload`; the admin identity-directories CRUD
 * route (Phase C) publishes here on every write so all replicas hot-reload.
 */
export const DIRECTORY_RELOAD_CHANNEL = 'identity:directory:reload';

/**
 * A live, redacted view of a directory for the public `/api/auth/directories`
 * endpoint + admin list. NEVER carries clientSecret/clientId/tenant — those
 * stay server-side. `hasSecret` mirrors the redaction flag the provider route
 * returns instead of the secret itself.
 */
export interface RedactedDirectory {
  id: string;
  name: string;
  displayName: string;
  type: string;
  enabled: boolean;
  priority: number;
  status: string;
  hasSecret: boolean;
}

/**
 * The minimal surface every per-directory strategy instance must expose so the
 * login/callback routes (Phase C task 8) can drive any IdP type uniformly.
 * AzureADAuthService + GoogleAuthService already satisfy a superset of this; the
 * generic-OIDC strategy (task 6) mirrors it.
 */
export interface DirectoryStrategyInstance {
  getConfig?: () => unknown;
  // Azure: async getAuthUrl(state?) ; Google: generateAuthUrl(state?)
  getAuthUrl?: (state?: string) => string | Promise<string>;
  generateAuthUrl?: (state?: string) => string | Promise<string>;
  [key: string]: any;
}

/**
 * One entry in the keyed registry Map (the analogue of ProviderManager's
 * `Map<string, ILLMProvider>` value, carrying the source row alongside the
 * live instance so callers can read group/role config without a DB hop).
 */
export interface DirectoryEntry {
  type: string;
  instance: DirectoryStrategyInstance;
  /** The decrypted DirectoryConfig the instance was built from. */
  config: DirectoryConfig;
}

/** Asserted endpoints on a well-formed OIDC discovery document. */
export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  [key: string]: any;
}

const DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class IdentityDirectoryService {
  private logger: Logger;

  /** The live keyed registry: directoryId → { type, instance, row/config }. */
  private directories: Map<string, DirectoryEntry> = new Map();

  private initialized = false;
  private reloading = false;
  private lastReloadTime = 0;
  private reloadSubscribed = false;

  /** In-process discovery cache (authority/issuer base → { doc, fetchedAt }). */
  private discoveryCache: Map<string, { doc: OidcDiscovery; fetchedAt: number }> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Initialize the registry from the database. Builds the first keyed map and
   * subscribes to the Redis invalidate channel. Idempotent — a second call is
   * a no-op (matching ProviderManager.initialize()).
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('[IdentityDirectoryService] already initialized');
      return;
    }

    this.logger.info('[IdentityDirectoryService] Initializing identity directory registry...');

    await this.buildAndSwap();

    // Live cross-replica invalidation — admin CRUD publishes to
    // DIRECTORY_RELOAD_CHANNEL; this replica then reloads. Best-effort:
    // single-replica mode is fine if Redis is unavailable.
    await this.subscribeDirectoryReload();

    this.initialized = true;
    this.lastReloadTime = Date.now();
    this.logger.info(
      {
        directoriesLoaded: this.directories.size,
        directories: Array.from(this.directories.keys()),
      },
      '[IdentityDirectoryService] initialized (database is source of truth)',
    );
  }

  /**
   * Reload directories from the database with an ATOMIC SWAP.
   *
   * Clone of ProviderManager.reloadProviders() (#74 fix): build the new keyed
   * map in a temporary, fully construct every per-directory instance (and, for
   * generic-OIDC, fetch+validate discovery), THEN swap in a single assignment.
   * The old map keeps serving traffic until the new one is ready — no empty
   * window where a login request would see zero directories.
   */
  async reload(): Promise<void> {
    if (this.reloading) {
      this.logger.debug('[IdentityDirectoryService] Already reloading, skipping duplicate request');
      return;
    }
    this.reloading = true;
    this.logger.info('[IdentityDirectoryService] Reloading directories from database (source of truth)...');
    try {
      await this.buildAndSwap();
      this.lastReloadTime = Date.now();
      this.logger.info(
        {
          directoriesLoaded: this.directories.size,
          directories: Array.from(this.directories.keys()),
        },
        '[IdentityDirectoryService] Directories reloaded successfully (atomic swap)',
      );
    } catch (error) {
      this.logger.error({ error }, '[IdentityDirectoryService] Failed to reload directories');
      throw error;
    } finally {
      this.reloading = false;
    }
  }

  /**
   * Build a fresh keyed map from the DB, then swap it in atomically. Shared by
   * initialize() and reload() so the construction path is identical.
   */
  private async buildAndSwap(): Promise<void> {
    const configService = new IdentityDirectoryConfigService(this.logger);
    const configs = await configService.loadDirectories();

    // Build into a TEMPORARY map. Never touch the live `this.directories`
    // until the new one is fully populated (the #74 atomic-swap contract).
    const newMap = new Map<string, DirectoryEntry>();

    // Already priority-asc from the loader; sort defensively in case the
    // loader contract changes.
    const sorted = [...configs].sort((a, b) => a.priority - b.priority);

    for (const cfg of sorted) {
      if (!cfg.enabled) {
        this.logger.info({ directory: cfg.name }, '[IdentityDirectoryService] Directory disabled, skipping');
        continue;
      }
      try {
        const instance = await this.buildInstance(cfg);
        newMap.set(cfg.id, { type: cfg.type, instance, config: cfg });
        this.logger.info(
          { directory: cfg.name, type: cfg.type, id: cfg.id },
          '[IdentityDirectoryService] Directory instance built successfully',
        );
      } catch (error) {
        // One bad directory must not sink the whole registry — log and skip,
        // mirroring ProviderManager's per-provider try/catch in the swap loop.
        this.logger.error(
          {
            directory: cfg.name,
            id: cfg.id,
            error: error instanceof Error ? error.message : error,
          },
          '[IdentityDirectoryService] Failed to build directory instance during reload',
        );
      }
    }

    // ATOMIC SWAP — single assignment, no empty window. The old map served
    // every request up to this line; the new one serves every request after.
    this.directories = newMap;
  }

  /**
   * Construct the per-directory strategy instance from the FULL decrypted
   * config. Passing every field explicitly means the env fallbacks inside
   * AzureADAuthService / GoogleAuthService never fire for a DB-driven
   * directory — the row wins (the "DB is SoT" guarantee at the instance level).
   */
  private async buildInstance(cfg: DirectoryConfig): Promise<DirectoryStrategyInstance> {
    const redirectUri = cfg.redirectUri || this.deriveRedirectUri(cfg.id);

    switch (cfg.type) {
      case 'azure-ad': {
        const authority =
          cfg.authority ||
          (cfg.tenantId ? `https://login.microsoftonline.com/${cfg.tenantId}` : undefined);
        return new AzureADAuthService(
          {
            tenantId: cfg.tenantId,
            clientId: cfg.clientId,
            clientSecret: cfg.clientSecret,
            authority,
            redirectUri,
            // [] → let the strategy's type default apply
            scopes: cfg.scopes.length > 0 ? cfg.scopes : undefined,
            // FULL DB config so validateToken resolves groups→roles from THIS
            // row (no process.env leak). `directoryId` flags the instance as
            // DB-driven, switching validateToken to the mapGroupsToRoles path.
            directoryId: cfg.id,
            authorizedGroups: cfg.authorizedGroups,
            adminGroups: cfg.adminGroups,
            groupRoleMappings: cfg.groupRoleMappings,
            externalAdminEmails: cfg.externalAdminEmails,
            allowAllAuthenticated: cfg.allowAllAuthenticated,
          },
          this.logger,
        );
      }

      case 'google-oidc':
      case 'google': {
        return new GoogleAuthService(
          {
            clientId: cfg.clientId,
            clientSecret: cfg.clientSecret,
            redirectUri,
            allowedDomains: cfg.allowedDomains,
            // FULL DB config so isAdmin resolves via mapGroupsToRoles from THIS
            // row (no process.env leak). `directoryId` flags the instance as
            // DB-driven.
            directoryId: cfg.id,
            adminGroups: cfg.adminGroups,
            groupRoleMappings: cfg.groupRoleMappings,
            externalAdminEmails: cfg.externalAdminEmails,
            allowAllAuthenticated: cfg.allowAllAuthenticated,
          },
          this.logger,
        );
      }

      case 'generic-oidc': {
        // generic-OIDC requires a validated discovery document. Fetch + assert
        // the endpoints (cached), then construct the strategy from the
        // discovery doc + the row's clientId/clientSecret/issuer.
        const discoveryBase = cfg.issuer || cfg.authority;
        if (!discoveryBase) {
          throw new Error(
            `generic-oidc directory "${cfg.name}" has no issuer/authority to discover from`,
          );
        }
        const discovery = await this.validateOidcDiscovery(discoveryBase);

        // GenericOidcStrategy (Phase B task 6) is loaded lazily so this service
        // compiles + runs even before that file lands. Until then a
        // generic-oidc row degrades to "not constructed" with a clear log
        // rather than crashing the whole registry build.
        const strategy = await this.tryBuildGenericOidc(cfg, redirectUri, discovery);
        if (!strategy) {
          throw new Error(
            `generic-oidc strategy unavailable (GenericOidcStrategy not yet wired); ` +
              `directory "${cfg.name}" discovery validated but no instance built`,
          );
        }
        return strategy;
      }

      default:
        throw new Error(`Unknown identity directory type: ${cfg.type}`);
    }
  }

  /**
   * Lazily build the generic-OIDC strategy. Returns null (rather than throwing
   * a module-resolution error) when genericOidcAuth.ts is not present yet, so
   * the rest of the registry still loads. Once task 6 lands this resolves to a
   * real GenericOidcStrategy instance.
   */
  private async tryBuildGenericOidc(
    cfg: DirectoryConfig,
    redirectUri: string,
    discovery: OidcDiscovery,
  ): Promise<DirectoryStrategyInstance | null> {
    try {
      const mod: any = await import('../../auth/genericOidcAuth.js').catch(() => null);
      const Strategy = mod?.GenericOidcStrategy;
      if (!Strategy) {
        this.logger.warn(
          { directory: cfg.name },
          '[IdentityDirectoryService] GenericOidcStrategy not available yet — generic-oidc directory not constructed',
        );
        return null;
      }
      return new Strategy(
        {
          clientId: cfg.clientId,
          clientSecret: cfg.clientSecret,
          issuer: cfg.issuer || cfg.authority,
          redirectUri,
          scopes: cfg.scopes,
          groupClaim: cfg.groupClaim,
          discovery,
        },
        this.logger,
      ) as DirectoryStrategyInstance;
    } catch (error) {
      this.logger.warn(
        { directory: cfg.name, error: error instanceof Error ? error.message : error },
        '[IdentityDirectoryService] Failed to build GenericOidcStrategy',
      );
      return null;
    }
  }

  /**
   * Derive the callback URL when the row does not override it:
   *   ${PUBLIC_BASE_URL || FRONTEND_URL}/api/auth/sso/:id/callback
   * Mirrors the per-directory callback the admin "callback-url" endpoint
   * (Phase C task 7) returns for registration.
   */
  private deriveRedirectUri(directoryId: string): string {
    const base = (process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    return `${base}/api/auth/sso/${directoryId}/callback`;
  }

  /**
   * Get a single directory entry by id (the live instance + its config).
   * Used by the login/callback routes to drive that directory's IdP handshake.
   */
  getDirectory(id: string): DirectoryEntry | undefined {
    return this.directories.get(id);
  }

  /** Whether any enabled directory is loaded (the `ssoActive` signal source). */
  hasDirectories(): boolean {
    return this.directories.size > 0;
  }

  /** Number of loaded directories. */
  size(): number {
    return this.directories.size;
  }

  /**
   * Public, REDACTED list of enabled directories in login-button order.
   * NEVER returns clientId/clientSecret/tenant — only what the login page +
   * admin list need. `hasSecret` is the redaction flag (mirrors the provider
   * route returning `hasSecret: true` instead of the secret).
   */
  listEnabled(): RedactedDirectory[] {
    return Array.from(this.directories.values())
      .sort((a, b) => a.config.priority - b.config.priority)
      .map((entry) => ({
        id: entry.config.id,
        name: entry.config.name,
        displayName: entry.config.displayName,
        type: entry.type,
        enabled: entry.config.enabled,
        priority: entry.config.priority,
        status: entry.config.status,
        hasSecret: Boolean(entry.config.clientSecret),
      }));
  }

  /**
   * Fetch + validate an OIDC discovery document from `<base>/.well-known/openid-configuration`.
   *
   * Asserts the mandatory endpoints (issuer / authorization_endpoint /
   * token_endpoint / jwks_uri). Result is cached in-process for
   * DISCOVERY_CACHE_TTL_MS keyed by the normalized base, so repeated reloads
   * and the admin "Test" probe do not re-hammer the IdP. Throws on a missing
   * doc or a missing required endpoint — callers surface that as a directory
   * validation error.
   *
   * @param authorityOrIssuer Azure `authority` or generic-oidc `issuer` base.
   */
  async validateOidcDiscovery(authorityOrIssuer: string): Promise<OidcDiscovery> {
    const base = (authorityOrIssuer || '').replace(/\/+$/, '');
    if (!base) {
      throw new Error('validateOidcDiscovery: empty authority/issuer');
    }

    const cached = this.discoveryCache.get(base);
    if (cached && Date.now() - cached.fetchedAt < DISCOVERY_CACHE_TTL_MS) {
      return cached.doc;
    }

    const discoveryUrl = `${base}/.well-known/openid-configuration`;
    let res: Response;
    try {
      res = await fetch(discoveryUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      throw new Error(
        `OIDC discovery fetch failed for ${discoveryUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (!res.ok) {
      throw new Error(`OIDC discovery returned HTTP ${res.status} for ${discoveryUrl}`);
    }

    let doc: any;
    try {
      doc = await res.json();
    } catch (err) {
      throw new Error(
        `OIDC discovery returned invalid JSON for ${discoveryUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const required: Array<keyof OidcDiscovery> = [
      'issuer',
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri',
    ];
    const missing = required.filter((k) => !doc || typeof doc[k] !== 'string' || !doc[k]);
    if (missing.length > 0) {
      throw new Error(
        `OIDC discovery doc from ${discoveryUrl} is missing required endpoint(s): ${missing.join(', ')}`,
      );
    }

    const validated = doc as OidcDiscovery;
    this.discoveryCache.set(base, { doc: validated, fetchedAt: Date.now() });
    return validated;
  }

  /**
   * Subscribe to the directory-reload Redis channel so a CRUD write on one
   * replica reloads all. Best-effort — single-replica mode (no Redis) is fine.
   * Mirrors ProviderManager.subscribeProviderReload's own-broadcast guard.
   */
  private async subscribeDirectoryReload(): Promise<void> {
    if (this.reloadSubscribed) return;
    this.reloadSubscribed = true;
    try {
      const { getRedisClient } = await import('../../utils/redis-client.js');
      const redis = getRedisClient();
      const hostname = process.env.HOSTNAME || 'unknown';
      await redis.subscribe(DIRECTORY_RELOAD_CHANNEL, async (message: string) => {
        try {
          const data = JSON.parse(message);
          if (data && data.source === hostname) return; // Ignore own broadcasts
          this.logger.info(
            { from: data?.source },
            '[IdentityDirectoryService] Received directory:reload from peer, reloading...',
          );
          await this.reload();
        } catch {
          // Ignore malformed messages
        }
      });
      this.logger.info(
        { channel: DIRECTORY_RELOAD_CHANNEL },
        '[IdentityDirectoryService] Subscribed to directory reload channel',
      );
    } catch (err: any) {
      this.logger.warn(
        { error: err?.message },
        '[IdentityDirectoryService] Failed to subscribe to directory reload — single-replica mode',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton + cross-replica invalidation broadcast
// (mirrors ProviderManager's getProviderManager / invalidateAllModelCaches /
//  subscribeProviderReload module functions).
// ---------------------------------------------------------------------------

let _identityDirectoryServiceInstance: IdentityDirectoryService | null = null;

/** Set the process-wide IdentityDirectoryService singleton (called at boot). */
export function setIdentityDirectoryService(instance: IdentityDirectoryService): void {
  _identityDirectoryServiceInstance = instance;
}

/** Get the process-wide IdentityDirectoryService singleton (null before boot). */
export function getIdentityDirectoryService(): IdentityDirectoryService | null {
  return _identityDirectoryServiceInstance;
}

/**
 * Reload the directory registry on this replica AND broadcast to peers.
 * Called by the admin identity-directories CRUD route after any write so the
 * change takes effect instantly across the platform (the analogue of
 * invalidateAllModelCaches for directories).
 */
export async function invalidateIdentityDirectories(
  logger?: Logger,
  broadcast = true,
): Promise<void> {
  const svc = getIdentityDirectoryService();
  if (svc) {
    await svc.reload();
    logger?.info?.('[IdentityDirectoryService] Registry reloaded after CRUD write');
  }

  if (broadcast) {
    try {
      const { getRedisClient } = await import('../../utils/redis-client.js');
      const redis = getRedisClient();
      await redis.publish(
        DIRECTORY_RELOAD_CHANNEL,
        JSON.stringify({ ts: Date.now(), source: process.env.HOSTNAME || 'unknown' }),
      );
      logger?.info?.('[IdentityDirectoryService] Broadcast directory:reload to other replicas');
    } catch {
      // Redis not available — single-replica mode is fine
    }
  }
}
