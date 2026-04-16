/**
 * Chat Pipeline Documentation Generator
 *
 * Parses ChatPipeline.ts and individual stage files to extract:
 * - Pipeline stages with names, priorities, and descriptions
 * - Pipeline configuration options
 * - Stage ordering and dependencies
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, regexMatchAll, getLineNumber, findFiles } from './utils.js';

export async function generateChatPipeline(basePath: string): Promise<DocManifest | null> {
  const pipelinePath = svcPath(basePath, 'openagentic-api', 'src', 'routes', 'chat', 'pipeline', 'ChatPipeline.ts');
  const content = await readFileIfExists(pipelinePath);
  if (!content) return null;

  const sourceFiles = [relativePath(pipelinePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: Pipeline Stages (from imports and constructor) ---
  const stageItems: DocItem[] = [];

  // Extract stage instantiations from the constructor
  // Pattern: new XxxStage(...)
  const stageInstPattern = /new (\w+Stage)\(/g;
  const seenStages = new Set<string>();
  for (const match of regexMatchAll(content, stageInstPattern)) {
    const className = match[1];
    if (seenStages.has(className)) continue;
    seenStages.add(className);

    // Try to find the import to get the file name
    const importPattern = new RegExp(`import\\s*\\{\\s*${className}\\s*\\}\\s*from\\s*['\"]\\.\\/([^'\"]+)['\"]`);
    const importMatch = content.match(importPattern);
    const stageFile = importMatch ? importMatch[1].replace(/\\.js$/, '.ts') : '';

    // Derive a readable name from class
    const readableName = className.replace(/Stage$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');

    stageItems.push({
      id: `stage-${className}`,
      name: readableName,
      description: `Pipeline stage: ${readableName}`,
      type: 'pipeline-stage',
      properties: {
        className,
        sourceFile: stageFile,
      },
      sourceLine: getLineNumber(content, match.index),
      sourceFile: sourceFiles[0],
    });
  }

  // Now scan stage files for name and priority
  const stageDir = svcPath(basePath, 'openagentic-api', 'src', 'routes', 'chat', 'pipeline');
  const stageFiles = await findFiles(stageDir, /\.stage\.ts$/);

  for (const sf of stageFiles) {
    const stageContent = await readFileIfExists(sf);
    if (!stageContent) continue;

    const relPath = relativePath(sf, basePath);
    if (!sourceFiles.includes(relPath)) sourceFiles.push(relPath);

    const nameMatch = stageContent.match(/readonly\s+name\s*=\s*'([^']+)'/);
    const priorityMatch = stageContent.match(/readonly\s+priority\s*=\s*(\d+)/);

    if (nameMatch) {
      // Update existing stage item or add new one
      const existing = stageItems.find(s =>
        relPath.includes((s.properties?.sourceFile as string) || '___none___')
      );
      if (existing) {
        existing.properties = {
          ...existing.properties,
          stageName: nameMatch[1],
          priority: priorityMatch ? parseInt(priorityMatch[1], 10) : undefined,
        };
        existing.description = `Pipeline stage "${nameMatch[1]}" (priority: ${priorityMatch?.[1] || 'N/A'})`;
      } else {
        stageItems.push({
          id: `stage-${nameMatch[1]}`,
          name: nameMatch[1],
          description: `Pipeline stage "${nameMatch[1]}" (priority: ${priorityMatch?.[1] || 'N/A'})`,
          type: 'pipeline-stage',
          properties: {
            stageName: nameMatch[1],
            priority: priorityMatch ? parseInt(priorityMatch[1], 10) : undefined,
            sourceFile: relPath,
          },
          sourceFile: relPath,
        });
      }
    }
  }

  sections.push({
    id: 'pipeline-stages',
    title: 'Pipeline Stages',
    description: `The chat pipeline processes messages through ${stageItems.length} sequential stages, from authentication to response streaming.`,
    adminOnly: false,
    items: stageItems,
  });

  // --- Section 2: Pipeline Configuration ---
  const configItems: DocItem[] = [];

  // Extract PipelineConfig-related fields from buildConfig or defaults
  const configPattern = /enable(\w+)\s*[?:]/g;
  const seenConfigs = new Set<string>();
  for (const match of regexMatchAll(content, configPattern)) {
    const configName = match[1];
    if (seenConfigs.has(configName)) continue;
    seenConfigs.add(configName);
    configItems.push({
      id: `config-enable${configName}`,
      name: `enable${configName}`,
      description: `Toggle to enable/disable the ${configName} stage`,
      type: 'config-flag',
    });
  }

  // Extract feature flags from env checks
  const envFlagPattern = /process\.env\.(\w+)\s*===?\s*['"]([^'"]+)['"]/g;
  for (const match of regexMatchAll(content, envFlagPattern)) {
    const envVar = match[1];
    if (seenConfigs.has(envVar)) continue;
    seenConfigs.add(envVar);
    configItems.push({
      id: `env-${envVar}`,
      name: envVar,
      description: `Environment variable controlling pipeline behavior (checked against "${match[2]}")`,
      type: 'env-flag',
      properties: { expectedValue: match[2] },
    });
  }

  sections.push({
    id: 'pipeline-config',
    title: 'Pipeline Configuration',
    description: 'Configuration flags and environment variables controlling pipeline behavior.',
    adminOnly: true,
    items: configItems,
  });

  // --- Section 3: Stage Ordering ---
  // Extract the ordered list from the file header comment
  const headerComment = content.match(/\/\*\*([\s\S]*?)\*\//);
  const stageOrder: DocItem[] = [];
  if (headerComment) {
    const orderPattern = /\d+\.\s*(\w[\w\s]+?)(?:\s*-\s*(.+))?$/gm;
    for (const match of regexMatchAll(headerComment[1], orderPattern)) {
      stageOrder.push({
        id: `order-${match[1].trim().toLowerCase().replace(/\s+/g, '-')}`,
        name: match[1].trim(),
        description: match[2]?.trim() || match[1].trim(),
        type: 'stage-order',
      });
    }
  }

  if (stageOrder.length > 0) {
    sections.push({
      id: 'stage-ordering',
      title: 'Stage Execution Order',
      description: 'The documented order in which pipeline stages execute for each chat message.',
      adminOnly: false,
      items: stageOrder,
    });
  }

  return {
    domain: 'chat-pipeline',
    title: 'Chat Pipeline',
    description: `Chat message processing pipeline with ${stageItems.length} stages handling authentication, validation, prompt engineering, MCP tools, completion, and response streaming.`,
    icon: 'brain',
    category: 'core',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
