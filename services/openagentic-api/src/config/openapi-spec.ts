/**
 * OpenAPI static spec generation helper.
 *
 * Writes the compiled OpenAPI spec to a configurable path so the file is
 * always written to a writable location.  The container filesystem at
 * /app/docs is read-only (EACCES), so we default to /tmp/openapi.json.
 *
 * Configuration:
 *   OPENAPI_STATIC_PATH  — full path to the output file
 *                          default: /tmp/openapi.json
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { Logger } from 'pino';

/**
 * Generate and write the static OpenAPI spec.
 *
 * @param server  Fastify server instance (must be ready so .swagger() works)
 * @param logger  Pino logger
 */
export async function generateOpenAPISpec(server: { swagger(): any }, logger: Logger): Promise<void> {
  try {
    const spec = server.swagger();
    const outputPath = process.env.OPENAPI_STATIC_PATH || '/tmp/openapi.json';
    const outputDir = dirname(outputPath);
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');
    logger.info({ path: outputPath, paths: Object.keys(spec.paths || {}).length }, 'OpenAPI spec generated');
  } catch (error) {
    logger.debug({ err: error }, 'Failed to generate static OpenAPI spec - will be available at /api/swagger/json');
  }
}
