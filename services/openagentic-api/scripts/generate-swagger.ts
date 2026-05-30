#!/usr/bin/env tsx
/**
 * Generate OpenAPI/Swagger Specification
 *
 * This script generates a static openapi.json file from the Fastify server's
 * Swagger configuration. Run this script to update the API documentation.
 *
 * Usage:
 *   pnpm tsx scripts/generate-swagger.ts
 *   npm run generate-swagger (if added to package.json)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import { swaggerOptions } from '../src/config/swagger.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function generateSwagger() {
  console.log('Generating OpenAPI specification...');

  // Create a temporary Fastify instance
  const fastify = Fastify({
    logger: false
  });

  try {
    // Register Swagger
    await fastify.register(swagger, swaggerOptions);

    // Register a dummy route to ensure swagger is initialized
    fastify.get('/health', {
      schema: {
        tags: ['Health'],
        summary: 'Health check',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' }
            }
          }
        }
      }
    }, async () => {
      return { status: 'ok' };
    });

    // Initialize the server (this compiles the schemas)
    await fastify.ready();

    // Get the OpenAPI spec
    const spec = fastify.swagger();

    // Ensure output directory exists
    const outputDir = join(__dirname, '..', 'docs');
    mkdirSync(outputDir, { recursive: true });

    // Write to file
    const outputPath = join(outputDir, 'openapi.json');
    writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');

    console.log(`✅ OpenAPI specification generated successfully!`);
    console.log(`   Location: ${outputPath}`);
    console.log(`   API Title: ${spec.info?.title || 'N/A'}`);
    console.log(`   API Version: ${spec.info?.version || 'N/A'}`);
    console.log(`   Paths: ${Object.keys(spec.paths || {}).length}`);
    console.log(`   Schemas: ${Object.keys(spec.components?.schemas || {}).length}`);

    // Also write a YAML version for convenience
    const yaml = convertToYAML(spec);
    const yamlPath = join(outputDir, 'openapi.yaml');
    writeFileSync(yamlPath, yaml, 'utf-8');
    console.log(`   YAML version: ${yamlPath}`);

  } catch (error) {
    console.error('❌ Error generating OpenAPI specification:', error);
    process.exit(1);
  } finally {
    await fastify.close();
  }
}

/**
 * Simple JSON to YAML converter
 * For production use, consider using a library like 'js-yaml'
 */
function convertToYAML(obj: any, indent = 0): string {
  const spaces = '  '.repeat(indent);
  let yaml = '';

  if (obj === null) {
    return 'null';
  }

  if (typeof obj !== 'object') {
    if (typeof obj === 'string') {
      // Escape strings with special characters
      if (obj.includes('\n') || obj.includes(':') || obj.includes('#')) {
        return `|\n${spaces}  ${obj.split('\n').join(`\n${spaces}  `)}`;
      }
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return '[]';
    }
    yaml += '\n';
    obj.forEach(item => {
      yaml += `${spaces}- ${convertToYAML(item, indent + 1).trim()}\n`;
    });
    return yaml.trimEnd();
  }

  // Object
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return '{}';
  }

  yaml += '\n';
  keys.forEach(key => {
    const value = obj[key];
    const formattedValue = convertToYAML(value, indent + 1);

    if (formattedValue.startsWith('\n')) {
      yaml += `${spaces}${key}:${formattedValue}`;
    } else {
      yaml += `${spaces}${key}: ${formattedValue}\n`;
    }
  });

  return yaml.trimEnd();
}

// Run the generator
generateSwagger().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
