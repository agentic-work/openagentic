import { resolve, relative, join } from 'path';
import { readdir, readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocSection, DocItem } from '../types';

export interface ChatPipelineArchConfig {
  rootDir: string;
}

type Layer = 'layer1' | 'layer2' | 'layer3' | 'other';

const LAYER_MAP: Record<string, Layer> = {
  // Layer 1 — session facts, input prep
  'buildUserMessageContent.ts': 'layer1',
  'extractAttachmentText.ts': 'layer1',
  'builders.ts': 'layer1',
  'parseInlineComposePatterns.ts': 'layer1',
  // Layer 2 — T1 catalog
  'toolRegistry.ts': 'layer2',
  'toolOrchestration.ts': 'layer2',
  // Layer 3 — chatLoop, streaming, dispatch
  'chatLoop.ts': 'layer3',
  'runChat.ts': 'layer3',
  'streamProvider.ts': 'layer3',
  'dispatchTool.ts': 'layer3',
  'dispatchChatToolCall.ts': 'layer3',
  'types.ts': 'layer3',
};

function leadingDoc(src: string): string {
  const block = src.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (block) {
    const lines = block[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter(Boolean);
    return lines.slice(0, 2).join(' ');
  }
  const lines = src.split('\n');
  const out: string[] = [];
  for (const l of lines) {
    const m = l.match(/^\s*\/\/\s?(.*)/);
    if (m) out.push(m[1]);
    else if (out.length > 0) break;
  }
  return out.slice(0, 2).join(' ');
}

export function chatPipelineArch(config: ChatPipelineArchConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const dirAbs = resolve(basePath, config.rootDir);
    const entries = await readdir(dirAbs);
    const tsFiles = entries.filter((e) => e.endsWith('.ts') && !e.endsWith('.test.ts'));

    const layerItems: Record<Layer, DocItem[]> = {
      layer1: [],
      layer2: [],
      layer3: [],
      other: [],
    };
    const sourceFiles: string[] = [];

    for (const file of tsFiles.sort()) {
      const abs = join(dirAbs, file);
      const src = await readFile(abs, 'utf-8');
      const rel = relative(basePath, abs);
      sourceFiles.push(rel);

      const layer = LAYER_MAP[file] ?? 'other';
      const desc = leadingDoc(src) || `${file} — chat pipeline module`;
      layerItems[layer].push({
        id: file.replace(/\.ts$/, ''),
        name: file,
        description: desc,
        type: 'pipeline-module',
        sourceFile: rel,
      });
    }

    const labels: Record<Layer, { title: string; desc: string }> = {
      layer1: {
        title: 'Layer 1 — Session Facts',
        desc: 'Input prep: user message assembly, attachments, JWT, builders, inline-compose patterns',
      },
      layer2: {
        title: 'Layer 2 — T1 Tool Catalog',
        desc: 'Canonical primitive registry + tool orchestration',
      },
      layer3: {
        title: 'Layer 3 — chatLoop',
        desc: 'Multi-turn loop, streaming, dispatch, types',
      },
      other: {
        title: 'Other Modules',
        desc: 'Other pipeline modules not yet classified',
      },
    };

    const sections: DocSection[] = [];
    for (const key of ['layer1', 'layer2', 'layer3', 'other'] as const) {
      if (layerItems[key].length === 0) continue;
      sections.push({
        id: key,
        title: labels[key].title,
        description: labels[key].desc,
        adminOnly: false,
        items: layerItems[key],
      });
    }

    return {
      domain: 'chat-pipeline',
      title: 'Chat Pipeline',
      description:
        'Three-layer chat pipeline architecture (chatmode rip 2026-05-10): Layer-1 session facts, Layer-2 T1 catalog, Layer-3 chatLoop.',
      icon: 'flow',
      category: 'core',
      generatedAt: new Date().toISOString(),
      sourceFiles,
      sections,
    };
  };
}
