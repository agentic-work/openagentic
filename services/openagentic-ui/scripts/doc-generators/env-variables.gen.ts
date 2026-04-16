/**
 * Environment Variables Documentation Generator
 *
 * Parses two sources:
 * 1. helm/openagentic/values.yaml - top-level keys and nested structure
 * 2. services/openagentic-api/src/config/secrets.config.ts - secret names from SecretsConfig interface
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import {
  readFileIfExists,
  helmPath,
  svcPath,
  relativePath,
  getLineNumber,
  regexMatchAll,
} from './utils.js';

export async function generateEnvVariables(basePath: string): Promise<DocManifest | null> {
  const valuesPath = helmPath(basePath, 'values.yaml');
  const secretsPath = svcPath(basePath, 'openagentic-api', 'src', 'config', 'secrets.config.ts');

  const valuesContent = await readFileIfExists(valuesPath);
  const secretsContent = await readFileIfExists(secretsPath);

  if (!valuesContent && !secretsContent) return null;

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];

  // --- Section 1: Helm Values Top-Level Keys ---
  if (valuesContent) {
    sourceFiles.push(relativePath(valuesPath, basePath));
    const topLevelItems: DocItem[] = [];

    // Parse top-level YAML keys (lines that start with a word, not indented)
    const lines = valuesContent.split('\n');
    let currentComment = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Accumulate section comments
      if (line.startsWith('# ===')) {
        // Look for the next non-separator comment line
        const nextLine = lines[i + 1]?.trim();
        if (nextLine && nextLine.startsWith('#') && !nextLine.startsWith('# ===')) {
          currentComment = nextLine.replace(/^#\s*/, '');
        }
        continue;
      }

      // Match top-level key (not indented, starts with word char, has colon)
      const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
      if (keyMatch) {
        const key = keyMatch[1];
        const inlineValue = keyMatch[2].trim();

        // Count nested keys for this section
        let nestedCount = 0;
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].match(/^\w/) || lines[j].match(/^# ===/)) break;
          if (lines[j].match(/^\s+\w[\w-]*:/)) nestedCount++;
        }

        const description = currentComment || (inlineValue ? `Value: ${inlineValue}` : `Configuration section with ${nestedCount} nested keys`);

        topLevelItems.push({
          id: `helm-${key}`,
          name: key,
          description,
          type: 'helm-value',
          properties: {
            inlineValue: inlineValue || undefined,
            nestedKeys: nestedCount,
          },
          sourceLine: i + 1,
          sourceFile: sourceFiles[0],
        });
        currentComment = '';
      }
    }

    sections.push({
      id: 'helm-values',
      title: 'Helm Values Configuration',
      description: `${topLevelItems.length} top-level configuration sections in values.yaml.`,
      adminOnly: true,
      items: topLevelItems,
    });
  }

  // --- Section 2: Secrets Config Interface ---
  if (secretsContent) {
    const relSecretsPath = relativePath(secretsPath, basePath);
    if (!sourceFiles.includes(relSecretsPath)) sourceFiles.push(relSecretsPath);

    const secretItems: DocItem[] = [];

    // Parse the SecretsConfig interface with nested sections
    const interfaceBlock = secretsContent.match(/export interface SecretsConfig\s*\{([\s\S]*?)\n\}/);
    if (interfaceBlock) {
      const body = interfaceBlock[1];

      // Match section-level comments and nested blocks
      const sectionPattern = /\/\/\s*(.+)\n\s*(\w+):\s*\{([\s\S]*?)\};/g;
      for (const match of regexMatchAll(body, sectionPattern)) {
        const sectionLabel = match[1].trim();
        const sectionName = match[2];
        const sectionBody = match[3];

        // Extract fields in this section
        const fieldPattern = /(\w+)(\?)?:\s*(\w+);/g;
        for (const fm of regexMatchAll(sectionBody, fieldPattern)) {
          secretItems.push({
            id: `secret-${sectionName}-${fm[1]}`,
            name: `${sectionName}.${fm[1]}`,
            description: `${sectionLabel} - ${fm[3]} ${fm[2] ? '(optional)' : '(required)'}`,
            type: 'secret',
            properties: {
              section: sectionName,
              tsType: fm[3],
              optional: !!fm[2],
            },
            sourceLine: getLineNumber(secretsContent, match.index),
            sourceFile: relSecretsPath,
          });
        }
      }
    }

    sections.push({
      id: 'secrets-config',
      title: 'Application Secrets',
      description: `${secretItems.length} secrets defined in SecretsConfig, organized by service area.`,
      adminOnly: true,
      items: secretItems,
    });
  }

  return {
    domain: 'env-variables',
    title: 'Environment & Secrets',
    description: 'Helm values configuration and application secret definitions.',
    icon: 'infra',
    category: 'infrastructure',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
