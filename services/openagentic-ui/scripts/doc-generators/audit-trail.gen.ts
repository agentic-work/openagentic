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
 * Audit Trail Documentation Generator
 *
 * Parses AuditLogger.ts to extract:
 * - AuditLogEntry interface fields
 * - Query types for audit log retrieval
 * - Hash chaining mechanism for tamper detection
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, getLineNumber, regexMatchAll } from './utils.js';

export async function generateAuditTrail(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-api', 'src', 'services', 'AuditLogger.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: AuditLogEntry Interface ---
  const entryFields: DocItem[] = [];
  const entryBlock = content.match(/export interface AuditLogEntry\s*\{([\s\S]*?)\n\}/);
  if (entryBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;\n]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(entryBlock[1], fieldPattern)) {
      entryFields.push({
        id: `entry-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || `${match[3].trim()} field`,
        type: 'interface-field',
        properties: {
          type: match[3].trim(),
          optional: !!match[2],
        },
        sourceLine: getLineNumber(content, match.index + (entryBlock.index || 0)),
        sourceFile: sourceFiles[0],
      });
    }
  }

  sections.push({
    id: 'audit-log-entry',
    title: 'Audit Log Entry Schema',
    description: `Each audit event is recorded as an AuditLogEntry with ${entryFields.length} fields.`,
    adminOnly: true,
    items: entryFields,
  });

  // --- Section 2: Query Types ---
  const queryItems: DocItem[] = [];

  // Look for AuditQueryParams or similar query interfaces
  const queryBlockPattern = /export (?:interface|type) (Audit\w*Query\w*|AuditFilter\w*)\s*(?:=\s*([^;]+);|\{([\s\S]*?)\n\})/g;
  for (const match of regexMatchAll(content, queryBlockPattern)) {
    const typeName = match[1];
    const typeBody = match[3] || match[2] || '';

    if (match[3]) {
      // Interface — extract fields
      const fieldPattern = /(\w+)(\?)?:\s*([^;\n]+);/g;
      const fields: string[] = [];
      for (const fm of regexMatchAll(typeBody, fieldPattern)) {
        fields.push(`${fm[1]}${fm[2] || ''}: ${fm[3].trim()}`);
      }
      queryItems.push({
        id: `query-${typeName}`,
        name: typeName,
        description: `Query interface with ${fields.length} parameters`,
        type: 'query-type',
        properties: { fields },
        sourceLine: getLineNumber(content, match.index),
        sourceFile: sourceFiles[0],
      });
    } else {
      queryItems.push({
        id: `query-${typeName}`,
        name: typeName,
        description: typeBody.trim(),
        type: 'query-type',
        sourceLine: getLineNumber(content, match.index),
        sourceFile: sourceFiles[0],
      });
    }
  }

  sections.push({
    id: 'query-types',
    title: 'Audit Query Types',
    description: 'Types used for querying and filtering audit log entries.',
    adminOnly: true,
    items: queryItems,
  });

  // --- Section 3: Hash Chaining ---
  const hashItems: DocItem[] = [];

  // Look for hash-related methods/functions
  const hashPattern = /(?:async\s+)?(?:private\s+)?(\w*[Hh]ash\w*)\s*\(/g;
  const seenHashes = new Set<string>();
  for (const match of regexMatchAll(content, hashPattern)) {
    const name = match[1];
    if (seenHashes.has(name)) continue;
    seenHashes.add(name);

    // Try to get a nearby comment
    const lineNum = getLineNumber(content, match.index);
    const lines = content.split('\n');
    const commentLine = lines[lineNum - 2]?.trim() || '';
    const desc = commentLine.startsWith('//')
      ? commentLine.replace(/^\/\/\s*/, '')
      : commentLine.startsWith('*')
        ? commentLine.replace(/^\*\s*/, '')
        : `Hash chain method: ${name}`;

    hashItems.push({
      id: `hash-${name}`,
      name,
      description: desc,
      type: 'hash-method',
      sourceLine: lineNum,
      sourceFile: sourceFiles[0],
    });
  }

  // Also look for HMAC / SHA references
  const cryptoPattern = /createH(?:mac|ash)\(\s*['"](\w+)['"]/g;
  const algorithms = new Set<string>();
  for (const match of regexMatchAll(content, cryptoPattern)) {
    algorithms.add(match[1]);
  }
  if (algorithms.size > 0) {
    hashItems.push({
      id: 'hash-algorithms',
      name: 'Hash Algorithms',
      description: `Uses: ${[...algorithms].join(', ')}`,
      type: 'crypto-info',
      properties: { algorithms: [...algorithms] },
    });
  }

  sections.push({
    id: 'hash-chaining',
    title: 'Hash Chain Integrity',
    description: 'Audit logs use cryptographic hash chaining to detect tampering. Each entry includes a hash of the previous entry.',
    adminOnly: true,
    items: hashItems,
  });

  return {
    domain: 'audit-trail',
    title: 'Audit Trail',
    description: `Immutable audit logging with ${entryFields.length} entry fields, query types, and hash-chain tamper detection.`,
    icon: 'shield',
    category: 'security',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
