/**
 * Docs domain manifest — the single source of truth for WHAT gets generated.
 *
 * Each DomainConfig wires an extractor (scan source → DocManifest) to a set of
 * invariants (assert the manifest tracks source). `generate.ts` iterates this
 * list and FAILS HARD if any extractor throws or any invariant fails, so docs
 * that drift from the current release cannot ship.
 *
 * Everything here is deterministic + offline: extractors read files from
 * AGENTIC_ROOT (the repo root); nothing requires a running stack.
 *
 * The volatile per-release FACTS (MCP servers + tools, Flow templates, node
 * types, deployed services, API routes, T1 primitives, feature availability)
 * are derived here. Conceptual prose stays hand-written in the docs pages; the
 * sync-guard test (no-removed-features.test.ts) pins those pages' hardcoded
 * counts/lists to these generated manifests.
 */

import type { DomainConfig } from './types';

import { mcpTools } from './extractors/mcpTools';
import { flowTemplates } from './extractors/flowTemplates';
import { workflowNodes } from './extractors/workflowNodes';
import { composeServices } from './extractors/composeServices';
import { routeDecorators } from './extractors/routeDecorators';
import { t1Registry } from './extractors/t1Registry';
import { tsConstExport } from './extractors/tsConstExport';
import { helmChart } from './extractors/helmChart';

import {
  requireMinCount,
  requireFieldNonEmpty,
  requireAllDirsMatching,
  requireAllExportsFrom,
  requireFileSetMatches,
  requireNoneMatching,
} from './invariants';

/** Node `type` ids for REMOVED Code-Mode / sandbox features. Never surface these. */
export const REMOVED_NODE_TYPES = [
  'code',
  'agenticode',
  'openagentic',
  'k8s_sandbox_run',
];

/**
 * Substring patterns that must never appear as a generated id (any domain).
 *
 * Scope note: this guards the SOURCE-SCANNED generator output only. Hand-written
 * prose pages (src/features/docs/pages/*.tsx) are NOT generated here — they are
 * guarded separately by the docs sync-guard test (no-removed-features.test.ts),
 * which scans every docs page for the same Code-Mode / sandbox-exec phrasings.
 */
export const REMOVED_FEATURE_PATTERNS: Array<string | RegExp> = [
  /code[-_]?mode/i,
  /codemode/i,
  /sandbox[-_]?exec/i,
  /k8s[-_]?sandbox/i,
  'sandbox-security',
];

const T1_REGISTRY_PATH =
  'services/openagentic-api/src/routes/chat/pipeline/chat/toolRegistry.ts';

export const DOMAINS: DomainConfig[] = [
  // ── MCP servers + tools (14 oap-*-mcp dirs) ──────────────────────────────
  {
    domain: 'mcp-servers',
    title: 'MCP Servers',
    description: 'Model Context Protocol servers and their tools',
    icon: 'tool',
    category: 'tools',
    extractor: mcpTools({ rootGlob: 'services/mcps/oap-*-mcp' }),
    invariants: [
      requireAllDirsMatching('services/mcps/oap-*-mcp', { idFrom: 'dirname' }),
      requireMinCount(14),
      requireFieldNonEmpty('description'),
      requireNoneMatching(REMOVED_FEATURE_PATTERNS),
    ],
  },

  // ── Flow templates (seed/*.json) ─────────────────────────────────────────
  {
    domain: 'flow-templates',
    title: 'Flow Templates',
    description: 'Pre-built Flow templates seeded into the workflow engine',
    icon: 'flow',
    category: 'workflows',
    extractor: flowTemplates({
      dir: 'services/openagentic-workflows/seed/templates',
    }),
    invariants: [
      requireFileSetMatches(
        'services/openagentic-workflows/seed/templates/*.json',
      ),
      requireMinCount(4),
      requireFieldNonEmpty('description'),
    ],
  },

  // ── Workflow node types (registry register() list minus deny) ────────────
  {
    domain: 'node-types',
    title: 'Workflow Node Types',
    description: 'Registered Flow canvas node types',
    icon: 'flow',
    category: 'workflows',
    extractor: workflowNodes({
      registryPath: 'services/shared/workflow-engine/src/nodes/registry.ts',
      schemaDir: 'services/shared/workflow-engine/src/nodes',
      deny: REMOVED_NODE_TYPES,
    }),
    invariants: [
      requireMinCount(50),
      requireFieldNonEmpty('description'),
      requireNoneMatching([
        ...REMOVED_NODE_TYPES.map((t) => new RegExp(`^${t}$`)),
        ...REMOVED_FEATURE_PATTERNS,
      ]),
    ],
  },

  // ── Deployed services (docker-compose.yml) ───────────────────────────────
  {
    domain: 'deployed-services',
    title: 'Deployed Services',
    description: 'Services deployed by the compose stack',
    icon: 'infra',
    category: 'infrastructure',
    extractor: composeServices({ path: 'docker-compose.yml' }),
    invariants: [
      requireMinCount(10),
      requireFieldNonEmpty('description'),
      requireNoneMatching([
        /^code$/,
        /^codemode$/,
        /^exec$/,
        /sandbox/i,
        ...REMOVED_FEATURE_PATTERNS,
      ]),
    ],
  },

  // ── Helm templates (graceful if chart absent) ────────────────────────────
  {
    domain: 'helm-templates',
    title: 'Helm Templates',
    description: 'Kubernetes templates in the platform Helm chart',
    icon: 'infra',
    category: 'infrastructure',
    extractor: helmChart({
      domain: 'helm-templates',
      title: 'Helm Templates',
      description: 'Kubernetes templates in the platform Helm chart',
      icon: 'infra',
      category: 'infrastructure',
      chartPath: 'helm/openagentic',
    }),
    invariants: [],
  },

  // ── API routes (route registration) ──────────────────────────────────────
  {
    domain: 'api-routes',
    title: 'API Routes',
    description: 'HTTP routes registered across the API',
    icon: 'route',
    category: 'core',
    extractor: routeDecorators({
      rootDir: 'services/openagentic-api/src/routes',
    }),
    invariants: [
      requireMinCount(20),
      requireFieldNonEmpty('description'),
      requireNoneMatching([/\/api\/code\b/i, /code[-_]?mode/i]),
    ],
  },

  // ── T1 primitives (chat tool registry) ───────────────────────────────────
  {
    domain: 't1-tools',
    title: 'T1 Primitives',
    description:
      'Canonical agentic primitives — the Layer-2 chatmode catalog shipped every chat turn.',
    icon: 'brain',
    category: 'core',
    extractor: t1Registry({
      path: T1_REGISTRY_PATH,
      exportName: 'getAllBaseTools',
    }),
    invariants: [
      requireAllExportsFrom(T1_REGISTRY_PATH, 'getAllBaseTools'),
      requireFieldNonEmpty('description'),
    ],
  },

  // ── Feature availability (UI featureFlags) ───────────────────────────────
  {
    domain: 'feature-flags',
    title: 'Feature Availability',
    description: 'Build-time feature flags that determine what ships in the UI.',
    icon: 'shield',
    category: 'core',
    extractor: tsConstExport({
      domain: 'feature-flags',
      title: 'Feature Availability',
      description:
        'Build-time feature flags that determine what ships in the UI.',
      icon: 'shield',
      category: 'core',
      path: 'services/openagentic-ui/src/config/featureFlags.ts',
      exportName: 'featureFlags',
      objectExport: true,
    }),
    invariants: [
      requireMinCount(3),
      requireFieldNonEmpty('description'),
      requireNoneMatching(REMOVED_FEATURE_PATTERNS),
    ],
  },
];
