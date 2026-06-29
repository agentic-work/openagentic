import { describe, it, expect } from 'vitest';
import {
  accessibleWelcomeRoutes,
  buildGreeting,
  WELCOME_ROUTES,
} from '../welcomeRoutes';
import type { UserPermissions } from '@/hooks/useUserPermissions';

const base: UserPermissions = {
  userId: 'u1',
  isAdmin: false,
  allowedLlmProviders: [],
  deniedLlmProviders: [],
  allowedMcpServers: [],
  deniedMcpServers: [],
  workflowsEnabled: false,
  dailyTokenLimit: null,
  monthlyTokenLimit: null,
  dailyRequestLimit: null,
  monthlyRequestLimit: null,
  canUseImageGeneration: true,
  canUseCodeExecution: true,
  canUseWebSearch: true,
  canUseFileUpload: true,
  canUseMemory: true,
  canUseRag: true,
  mcpPanelEnabled: true,
  source: 'default',
};

describe('welcomeRoutes access gating', () => {
  it('NEVER surfaces Admin to a non-admin', () => {
    const ids = accessibleWelcomeRoutes(base).map((r) => r.id);
    expect(ids).not.toContain('admin');
  });

  it('surfaces Admin only when isAdmin', () => {
    const ids = accessibleWelcomeRoutes({ ...base, isAdmin: true }).map((r) => r.id);
    expect(ids).toContain('admin');
  });

  it('hides Flows for a non-admin without the workflows grant', () => {
    const ids = accessibleWelcomeRoutes(base).map((r) => r.id);
    expect(ids).not.toContain('flows');
  });

  it('shows Flows when workflowsEnabled OR admin', () => {
    expect(accessibleWelcomeRoutes({ ...base, workflowsEnabled: true }).map((r) => r.id)).toContain('flows');
    expect(accessibleWelcomeRoutes({ ...base, isAdmin: true }).map((r) => r.id)).toContain('flows');
  });

  it('hides Tools when the MCP panel grant is off', () => {
    const ids = accessibleWelcomeRoutes({ ...base, mcpPanelEnabled: false }).map((r) => r.id);
    expect(ids).not.toContain('tools');
  });

  it('always offers Chat and Docs', () => {
    const ids = accessibleWelcomeRoutes(base).map((r) => r.id);
    expect(ids).toContain('chat');
    expect(ids).toContain('docs');
  });

  it('declares exactly the five routes', () => {
    expect(WELCOME_ROUTES.map((r) => r.id).sort()).toEqual(
      ['admin', 'chat', 'docs', 'flows', 'tools'],
    );
  });
});

describe('buildGreeting', () => {
  it('lists only accessible destinations (no admin for a non-admin)', () => {
    const routes = accessibleWelcomeRoutes(base);
    const g = buildGreeting({ displayName: 'Trent', routes });
    expect(g).toContain('Welcome back, Trent.');
    expect(g).not.toContain('**Admin**');
    expect(g).toContain('**Docs**');
  });

  it('includes Admin in the greeting for an admin user', () => {
    const routes = accessibleWelcomeRoutes({ ...base, isAdmin: true });
    const g = buildGreeting({ displayName: null, routes });
    expect(g).toContain('Welcome to OpenAgentic.');
    expect(g).toContain('**Admin**');
  });

  it('does not list Chat as a destination (we are already in chat)', () => {
    const routes = accessibleWelcomeRoutes(base);
    const g = buildGreeting({ displayName: null, routes });
    expect(g).not.toContain('**Chat**');
  });
});
