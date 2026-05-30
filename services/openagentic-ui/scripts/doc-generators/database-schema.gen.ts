/**
 * Database Schema Documentation Generator
 *
 * Parses services/openagentic-api/prisma/schema.prisma to extract:
 * - All Prisma model definitions
 * - Fields with types and modifiers
 * - Relations between models
 *
 * This parses Prisma schema syntax, not TypeScript.
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, relativePath, getLineNumber, regexMatchAll } from './utils.js';
import { resolve } from 'path';

interface PrismaField {
  name: string;
  type: string;
  isOptional: boolean;
  isArray: boolean;
  defaultValue?: string;
  isRelation: boolean;
  comment?: string;
}

function parseModelBlock(body: string): PrismaField[] {
  const fields: PrismaField[] = [];
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, comments-only, and @@directives
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

    // Match field definitions: name Type? @modifiers // comment
    const fieldMatch = trimmed.match(
      /^(\w+)\s+([\w.]+)(\[\])?\??(\s+@[^\n]*?)?\s*(?:\/\/\s*(.+))?$/
    );
    if (!fieldMatch) continue;

    const name = fieldMatch[1];
    const rawType = fieldMatch[2];
    const isArray = !!fieldMatch[3];
    const modifiers = fieldMatch[4]?.trim() || '';
    const comment = fieldMatch[5]?.trim();

    // Check if optional (? after type or after [])
    const isOptional = trimmed.includes(`${rawType}?`) || trimmed.includes(`${rawType}[]?`);

    // Check for @default(...)
    const defaultMatch = modifiers.match(/@default\(([^)]+)\)/);
    const defaultValue = defaultMatch ? defaultMatch[1] : undefined;

    // Check if this is a relation (type starts uppercase and has @relation or is a model reference)
    const isRelation = /^[A-Z]/.test(rawType) && !['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt', 'Bytes'].includes(rawType);

    fields.push({
      name,
      type: rawType + (isArray ? '[]' : '') + (isOptional ? '?' : ''),
      isOptional,
      isArray,
      defaultValue,
      isRelation,
      comment,
    });
  }

  return fields;
}

export async function generateDatabaseSchema(basePath: string): Promise<DocManifest | null> {
  const filePath = resolve(basePath, 'services', 'openagentic-api', 'prisma', 'schema.prisma');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // Extract all model blocks
  const modelPattern = /model (\w+)\s*\{([\s\S]*?)\n\}/g;
  const models: Array<{ name: string; fields: PrismaField[]; line: number; schema?: string; tableName?: string }> = [];

  for (const match of regexMatchAll(content, modelPattern)) {
    const modelName = match[1];
    const body = match[2];
    const fields = parseModelBlock(body);
    const line = getLineNumber(content, match.index);

    // Extract @@schema directive
    const schemaMatch = body.match(/@@schema\("(\w+)"\)/);
    const schema = schemaMatch ? schemaMatch[1] : 'public';

    // Extract @@map directive (table name)
    const mapMatch = body.match(/@@map\("(\w+)"\)/);
    const tableName = mapMatch ? mapMatch[1] : undefined;

    models.push({ name: modelName, fields, line, schema, tableName });
  }

  // Group models by schema
  const schemaGroups = new Map<string, typeof models>();
  for (const model of models) {
    const key = model.schema || 'public';
    if (!schemaGroups.has(key)) schemaGroups.set(key, []);
    schemaGroups.get(key)!.push(model);
  }

  // Overview section
  const totalFields = models.reduce((sum, m) => sum + m.fields.length, 0);
  const totalRelations = models.reduce((sum, m) => sum + m.fields.filter(f => f.isRelation).length, 0);

  sections.push({
    id: 'schema-overview',
    title: 'Schema Overview',
    description: `${models.length} models with ${totalFields} fields and ${totalRelations} relations across ${schemaGroups.size} schema(s).`,
    adminOnly: false,
    items: models.map(m => ({
      id: `model-${m.name}`,
      name: m.name,
      description: `${m.fields.length} fields, ${m.fields.filter(f => f.isRelation).length} relations${m.tableName ? ` (table: ${m.tableName})` : ''}`,
      type: 'prisma-model',
      properties: {
        schema: m.schema,
        tableName: m.tableName,
        fieldCount: m.fields.length,
        relationCount: m.fields.filter(f => f.isRelation).length,
      },
      sourceLine: m.line,
      sourceFile: sourceFiles[0],
    })),
  });

  // Per-schema sections with field details
  for (const [schema, schemaModels] of schemaGroups) {
    const items: DocItem[] = [];
    for (const model of schemaModels) {
      // Add model header
      items.push({
        id: `detail-${model.name}`,
        name: model.name,
        description: `${model.fields.length} fields${model.tableName ? `, maps to "${model.tableName}"` : ''}`,
        type: 'model-detail',
        properties: {
          fields: model.fields.map(f => ({
            name: f.name,
            type: f.type,
            optional: f.isOptional,
            array: f.isArray,
            default: f.defaultValue,
            relation: f.isRelation,
            comment: f.comment,
          })),
        },
        sourceLine: model.line,
        sourceFile: sourceFiles[0],
      });
    }

    sections.push({
      id: `schema-${schema}`,
      title: `${schema.charAt(0).toUpperCase() + schema.slice(1)} Schema Models`,
      description: `${schemaModels.length} models in the "${schema}" database schema.`,
      adminOnly: schema === 'admin',
      items,
    });
  }

  return {
    domain: 'database-schema',
    title: 'Database Schema',
    description: `Prisma schema with ${models.length} models, ${totalFields} fields, and ${totalRelations} relations.`,
    icon: 'infra',
    category: 'infrastructure',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
