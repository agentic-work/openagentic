/**
 * Shared utilities for doc generators
 */

import { readFile, access } from 'fs/promises';
import { constants } from 'fs';
import { resolve, relative } from 'path';

/** Read a file, returning null if it doesn't exist */
export async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    await access(filePath, constants.R_OK);
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Convert an absolute path to a relative path from the repo root */
export function relativePath(absolutePath: string, repoRoot: string): string {
  return relative(repoRoot, absolutePath);
}

/** Extract all regex matches with a specific capture group */
export function regexExtractAll(content: string, pattern: RegExp, groupIndex: number = 0): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  while ((match = globalPattern.exec(content)) !== null) {
    if (match[groupIndex] !== undefined) {
      results.push(match[groupIndex]);
    }
  }
  return results;
}

/** Extract all regex matches as full match objects */
export function regexMatchAll(content: string, pattern: RegExp): RegExpExecArray[] {
  const results: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  while ((match = globalPattern.exec(content)) !== null) {
    results.push(match);
  }
  return results;
}

/** Get line number for a character index in a string */
export function getLineNumber(content: string, charIndex: number): number {
  return content.substring(0, charIndex).split('\n').length;
}

/** Make a kebab-case ID from a string */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/** Resolve a path relative to the services directory */
export function svcPath(basePath: string, ...parts: string[]): string {
  return resolve(basePath, 'services', ...parts);
}

/** Resolve a path relative to the helm directory */
export function helmPath(basePath: string, ...parts: string[]): string {
  return resolve(basePath, 'helm', 'openagentic', ...parts);
}

/** Read multiple files, skipping any that don't exist */
export async function readFiles(paths: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  await Promise.all(
    paths.map(async (p) => {
      const content = await readFileIfExists(p);
      if (content) results.set(p, content);
    })
  );
  return results;
}

/** Find files matching a pattern in a directory (skips node_modules) */
export async function findFiles(dir: string, pattern: RegExp): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  const { join } = await import('path');
  const results: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const parentPath = entry.parentPath || entry.path || dir;
        if (parentPath.includes('node_modules')) continue;
        const fullPath = join(parentPath, entry.name);
        if (pattern.test(fullPath)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return results;
}

/**
 * Resolve a path relative to a companion project.
 *
 * Resolution order:
 *   1. If `DOCS_COMPANION_ROOT` env var is set, use `<DOCS_COMPANION_ROOT>/<project>/...`.
 *      Used by Docker/CI builds that check out companion repos into a named
 *      directory (e.g. `/companions`) rather than relying on sibling layout.
 *   2. Otherwise fall back to `<basePath>/../<project>/...` — the developer-box
 *      layout where the companions are cloned side-by-side with this repo.
 */
export function companionPath(basePath: string, project: string, ...parts: string[]): string {
  const envRoot = process.env.DOCS_COMPANION_ROOT;
  if (envRoot) {
    return resolve(envRoot, project, ...parts);
  }
  return resolve(basePath, '..', project, ...parts);
}

// ---------------------------------------------------------------------------
// Shared Python source parsing helpers
// ---------------------------------------------------------------------------

export interface ParsedPyClass {
  name: string;
  bases: string;
  docstring: string;
  methods: string[];
  line: number;
}

export interface ParsedPyRoute {
  method: string;
  path: string;
  funcName: string;
  docstring: string;
  line: number;
}

export interface ParsedPyFunction {
  name: string;
  docstring: string;
  params: string;
  isAsync: boolean;
  line: number;
}

/** Parse Python class definitions with docstrings and public method names */
export function parsePyClasses(content: string): ParsedPyClass[] {
  const classes: ParsedPyClass[] = [];
  const pattern = /^class\s+(\w+)(?:\(([^)]*)\))?:\s*\n(?:\s+"""([\s\S]*?)""")?/gm;

  for (const match of regexMatchAll(content, pattern)) {
    const classStart = match.index + match[0].length;
    const nextClass = content.indexOf('\nclass ', classStart);
    const classBlock = content.substring(classStart, nextClass > -1 ? nextClass : undefined);
    const methods: string[] = [];
    const methodPattern = /^\s+(?:async\s+)?def\s+(\w+)/gm;
    for (const mm of regexMatchAll(classBlock, methodPattern)) {
      if (!mm[1].startsWith('_') || mm[1] === '__init__') methods.push(mm[1]);
    }

    classes.push({
      name: match[1],
      bases: match[2]?.trim() || '',
      docstring: match[3]?.trim().split('\n')[0] || '',
      methods,
      line: getLineNumber(content, match.index),
    });
  }

  return classes;
}

/** Parse FastAPI/Flask route decorator patterns */
export function parsePyRoutes(content: string): ParsedPyRoute[] {
  const routes: ParsedPyRoute[] = [];
  const pattern = /@(?:app|router)\.(get|post|put|delete|patch|websocket)\(\s*["']([^"']+)["'][^)]*\)\s*\n(?:async\s+)?def\s+(\w+)\([^)]*\)[\s\S]*?(?:"""([\s\S]*?)"""|(?=\n(?:@|def |class |async def )))/g;

  for (const match of regexMatchAll(content, pattern)) {
    routes.push({
      method: match[1].toUpperCase(),
      path: match[2],
      funcName: match[3],
      docstring: match[4]?.trim().split('\n')[0] || match[3].replaceAll('_', ' '),
      line: getLineNumber(content, match.index),
    });
  }

  return routes;
}

/** Parse top-level Python function definitions */
export function parsePyFunctions(content: string): ParsedPyFunction[] {
  const functions: ParsedPyFunction[] = [];
  const pattern = /^(async\s+)?def\s+(\w+)\(([^)]*)\)[\s\S]*?(?:"""([\s\S]*?)"""|(?=\n(?:@|def |class |async def )))/gm;

  for (const match of regexMatchAll(content, pattern)) {
    if (match[2].startsWith('_')) continue;
    functions.push({
      name: match[2],
      docstring: match[4]?.trim().split('\n')[0] || match[2].replaceAll('_', ' '),
      params: match[3].trim(),
      isAsync: !!match[1],
      line: getLineNumber(content, match.index),
    });
  }

  return functions;
}
