/**
 * Phase 3.5 source-regression test — memory-ai-domain routes extraction.
 *
 * Asserts that after Phase 3.5:
 *  1. server.ts does NOT dynamic-import userMemoryRoutes from routes/user-memory.js
 *  2. server.ts does NOT dynamic-import promptTemplateRoutes from routes/prompt-templates.js
 *  3. server.ts does NOT dynamic-import registerPromptComposeRoutes from routes/internal/prompt-compose.js
 *  4. server.ts does NOT dynamic-import memoryVectorPlugin from routes/memory-vector/index.js
 *  5. server.ts does NOT dynamic-import advancedPromptingPlugin from routes/advanced-prompting/index.js
 *  6. server.ts does NOT dynamic-import adminPromptingRoutes from routes/admin-prompting.js
 *  7. server.ts does NOT dynamic-import adminTechniqueRoutes from routes/admin-techniques.js
 *  8. server.ts does NOT dynamic-import promptModuleRoutes from routes/admin/prompt-modules.js
 *  9. server.ts does NOT dynamic-import sharedKBRoutes from routes/admin/shared-kb.js
 * 10. server.ts does NOT dynamic-import SynthService/registerAdminSynthRoutes/registerSynthRoutes
 * 11. server.ts DOES contain `register(memoryAIRoutesPlugin` (call site, not bare symbol —
 *     per Phase 3.1 lesson #1: assert the call site).
 * 12. server.ts DOES import memoryAIRoutesPlugin from plugins/memory-ai.plugin.js
 *
 * Run from any CWD; all paths resolved relative to this file's __dirname.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// __dirname = services/openagentic-api/src/__tests__
const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = join(REPO_ROOT, 'services/openagentic-api/src');

const serverTs = readFileSync(join(API_SRC, 'server.ts'), 'utf-8');

describe('Phase 3.5 — memory-ai domain dynamic imports removed from server.ts', () => {
  it('server.ts does NOT dynamic-import userMemoryRoutes (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/user-memory.js'");
    expect(serverTs).not.toContain('routes/user-memory.js"');
    expect(serverTs).not.toContain("'./routes/user-memory'");
    expect(serverTs).not.toContain('"./routes/user-memory"');
    expect(serverTs).not.toMatch(/const\s*\{\s*userMemoryRoutes\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import promptTemplateRoutes (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/prompt-templates.js'");
    expect(serverTs).not.toContain('routes/prompt-templates.js"');
    expect(serverTs).not.toContain("'./routes/prompt-templates'");
    expect(serverTs).not.toContain('"./routes/prompt-templates"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*promptTemplateRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import registerPromptComposeRoutes (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/internal/prompt-compose.js'");
    expect(serverTs).not.toContain('routes/internal/prompt-compose.js"');
    expect(serverTs).not.toContain("'./routes/internal/prompt-compose'");
    expect(serverTs).not.toContain('"./routes/internal/prompt-compose"');
    expect(serverTs).not.toMatch(/const\s*\{\s*registerPromptComposeRoutes\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import memoryVectorPlugin (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("memory-vector/index.js'");
    expect(serverTs).not.toContain('memory-vector/index.js"');
    expect(serverTs).not.toContain("'./routes/memory-vector/index'");
    expect(serverTs).not.toContain('"./routes/memory-vector/index"');
    expect(serverTs).not.toMatch(/const\s*\{\s*memoryVectorPlugin\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import advancedPromptingPlugin (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("advanced-prompting/index.js'");
    expect(serverTs).not.toContain('advanced-prompting/index.js"');
    expect(serverTs).not.toContain("'./routes/advanced-prompting/index'");
    expect(serverTs).not.toContain('"./routes/advanced-prompting/index"');
    expect(serverTs).not.toMatch(/const\s*\{\s*advancedPromptingPlugin\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import adminPromptingRoutes (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-prompting.js'");
    expect(serverTs).not.toContain('routes/admin-prompting.js"');
    expect(serverTs).not.toContain("'./routes/admin-prompting'");
    expect(serverTs).not.toContain('"./routes/admin-prompting"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminPromptingRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import adminTechniqueRoutes (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-techniques.js'");
    expect(serverTs).not.toContain('routes/admin-techniques.js"');
    expect(serverTs).not.toContain("'./routes/admin-techniques'");
    expect(serverTs).not.toContain('"./routes/admin-techniques"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*adminTechniqueRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import promptModuleRoutes (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin/prompt-modules.js'");
    expect(serverTs).not.toContain('routes/admin/prompt-modules.js"');
    expect(serverTs).not.toContain("'./routes/admin/prompt-modules'");
    expect(serverTs).not.toContain('"./routes/admin/prompt-modules"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*promptModuleRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import sharedKBRoutes (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin/shared-kb.js'");
    expect(serverTs).not.toContain('routes/admin/shared-kb.js"');
    expect(serverTs).not.toContain("'./routes/admin/shared-kb'");
    expect(serverTs).not.toContain('"./routes/admin/shared-kb"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*sharedKBRoutes\s*\}/);
  });

  it('server.ts does NOT dynamic-import SynthService (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("services/SynthService.js'");
    expect(serverTs).not.toContain('services/SynthService.js"');
    expect(serverTs).not.toContain("'./services/SynthService'");
    expect(serverTs).not.toContain('"./services/SynthService"');
    expect(serverTs).not.toMatch(/const\s*\{\s*SynthService\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import registerAdminSynthRoutes (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-synth.js'");
    expect(serverTs).not.toContain('routes/admin-synth.js"');
    expect(serverTs).not.toContain("'./routes/admin-synth'");
    expect(serverTs).not.toContain('"./routes/admin-synth"');
    expect(serverTs).not.toMatch(/const\s*\{\s*registerAdminSynthRoutes\s*\}\s*=/);
  });

  it('server.ts does NOT dynamic-import registerSynthRoutes (moved to memory-ai.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/synth.js'");
    expect(serverTs).not.toContain('routes/synth.js"');
    expect(serverTs).not.toContain("'./routes/synth'");
    expect(serverTs).not.toContain('"./routes/synth"');
    expect(serverTs).not.toMatch(/const\s*\{\s*registerSynthRoutes\s*\}\s*=/);
  });
});

describe('Phase 3.5 — memoryAIRoutesPlugin is registered in server.ts', () => {
  it('server.ts DOES contain register(memoryAIRoutesPlugin (the call site, not just symbol)', () => {
    // Lock the actual register call site per Phase 3.1 lesson #1:
    // a bare-symbol assertion passes against a comment and gives false positives.
    expect(serverTs).toContain('register(memoryAIRoutesPlugin');
  });

  it('server.ts DOES import memoryAIRoutesPlugin from plugins/memory-ai.plugin.js', () => {
    expect(serverTs).toContain('memory-ai.plugin');
  });
});
