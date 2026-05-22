import { loggers } from '../utils/logger.js';
import type { BootstrapStep } from './types.js';

/**
 * #605 — Milvus collection-size boot probe.
 *
 * Runs AFTER 07-mcp-index + 08-tool-cache so the probe sees the
 * post-indexing state. Reports mcp_tools + agents row counts and
 * compares against thresholds.
 *
 * `MILVUS_BOOT_GATE_REQUIRED=true` makes the step critical (throws on
 * miss → pod won't go ready). Default false: log warn + continue. This
 * matches the existing TOOL_INDEX_VERIFY_REQUIRED escape hatch (see
 * `08-tool-cache.ts:63`) for fresh-install / dev environments where
 * collections may be small or empty during initial boot.
 */
export const INIT_MILVUS_COLLECTION_PROBE: BootstrapStep = {
  name: 'milvus-collection-probe',
  critical: false,
  async run({ ctx }) {
    const required = process.env.MILVUS_BOOT_GATE_REQUIRED === 'true';
    loggers.services.info({ required }, '🔄 [#605] Probing Milvus collection sizes...');

    let MilvusClient: any;
    try {
      ({ MilvusClient } = await import('@zilliz/milvus2-sdk-node'));
    } catch (e: any) {
      loggers.services.warn(
        { error: e?.message },
        '⚠️ [#605] @zilliz/milvus2-sdk-node not loadable — skipping probe',
      );
      return;
    }

    const milvusAddress =
      process.env.MILVUS_ADDRESS ||
      `${process.env.MILVUS_HOST || 'milvus'}:${process.env.MILVUS_PORT || '19530'}`;
    const client = new MilvusClient({ address: milvusAddress });

    const { probeMilvusCollections } = await import(
      '../services/startup-helpers/probeMilvusCollections.js'
    );

    const result = await probeMilvusCollections(async (name) => {
      return client.getCollectionStatistics({ collection_name: name });
    });

    if (result.ok) {
      loggers.services.info(
        {
          mcpToolsCount: result.mcpToolsCount,
          mcpAgentsCount: result.mcpAgentsCount,
        },
        '✅ [#605] Milvus collections are populated above thresholds',
      );
      // Surface to AppContext so /health endpoints can read it.
      (ctx as any).milvusCollectionProbe = {
        ok: true,
        mcpToolsCount: result.mcpToolsCount,
        mcpAgentsCount: result.mcpAgentsCount,
        errors: [],
        checkedAt: new Date().toISOString(),
      };
      return;
    }

    const summary = {
      mcpToolsCount: result.mcpToolsCount,
      mcpAgentsCount: result.mcpAgentsCount,
      errors: result.errors,
    };
    (ctx as any).milvusCollectionProbe = {
      ok: false,
      ...summary,
      checkedAt: new Date().toISOString(),
    };

    if (required) {
      loggers.services.fatal(
        summary,
        '🚨 [#605] FATAL: Milvus collections below threshold + MILVUS_BOOT_GATE_REQUIRED=true',
      );
      throw new Error(
        `[#605] Milvus boot gate failed: ${result.errors.join('; ')}`,
      );
    }

    loggers.services.warn(
      summary,
      '⚠️ [#605] Milvus collections below threshold — continuing (set MILVUS_BOOT_GATE_REQUIRED=true to hard-fail)',
    );
  },
};
