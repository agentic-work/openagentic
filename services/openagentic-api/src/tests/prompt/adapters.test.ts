import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../services/prompt/adapters/ClaudeAdapter.js';
import { GeminiAdapter } from '../../services/prompt/adapters/GeminiAdapter.js';
import { OpenAIAdapter } from '../../services/prompt/adapters/OpenAIAdapter.js';
import { LocalAdapter } from '../../services/prompt/adapters/LocalAdapter.js';
import { ModelAdapterFactory } from '../../services/prompt/adapters/ModelAdapterFactory.js';
import type { PromptModule, ModelCapabilities } from '../../services/prompt/types.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const defaultCaps: ModelCapabilities = {
  thinking: false,
  tools: true,
  vision: false,
  longContext: false,
  audio: false,
  video: false,
  documents: false,
  streaming: true,
  imageGen: false,
  audioGen: false,
  videoGen: false,
  embedding: false,
  codeExecution: false,
  grounding: false,
};

const thinkingCaps: ModelCapabilities = { ...defaultCaps, thinking: true };
const groundingCaps: ModelCapabilities = { ...defaultCaps, grounding: true };

const makeModule = (overrides: Partial<PromptModule> = {}): PromptModule => ({
  id: 'uuid-1',
  name: 'identity',
  category: 'core',
  content: 'You are OpenAgentic, an enterprise AI assistant.',
  description: 'Platform identity',
  priority: 100,
  tokenCost: 13,
  enabled: true,
  injection: { alwaysInject: true },  version: 1,
  ...overrides,
});

const threeModules: PromptModule[] = [
  makeModule({ id: 'uuid-1', name: 'identity', category: 'core', priority: 100 }),
  makeModule({
    id: 'uuid-2',
    name: 'safety',
    category: 'core',
    priority: 98,
    content: 'Never fabricate data.',  }),
  makeModule({
    id: 'uuid-3',
    name: 'azure-ops',
    category: 'domain',
    priority: 70,
    content: 'Azure tool routing: use azure_arm_execute.',  }),
];

// ── ClaudeAdapter ────────────────────────────────────────────────────────────

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter();

  it('family is "claude"', () => {
    expect(adapter.family).toBe('claude');
  });

  it('output contains XML module tags', () => {
    const result = adapter.transform(threeModules, defaultCaps);
    expect(result).toContain('<module name="identity">');
    expect(result).toContain('<module name="safety">');
    expect(result).toContain('<module name="azure-ops">');
  });

  it('output contains closing XML tags', () => {
    const result = adapter.transform(threeModules, defaultCaps);
    expect(result).toContain('</module>');
  });

  // Post-neutralization: the adapter contributes zero prose. Identity prefix
  // ("You are OpenAgentic…") now comes from the `identity-default` /
  // `identity-admin` seeded modules; thinking/reasoning guidance from the
  // `thinking-guidance` capability-gated module. See
  // docs/architecture/composable-prompt-neutralization.md.
  it('adapter does NOT inject vendor identity prefix', () => {
    const result = adapter.transform(threeModules, defaultCaps);
    expect(result).not.toMatch(/You are Claude/);
  });

  it('adapter does NOT inject its own thinking prose', () => {
    const result = adapter.transform(threeModules, thinkingCaps);
    // If the only content is the XML-wrapped modules, the raw words
    // "reason"/"think" only appear when the modules themselves mention them.
    // The fixture modules deliberately don't, so the adapter-added line is gone.
    const lines = result.split('\n');
    const hasAdapterThinkingLine = lines.some(
      (l) => l.trim().startsWith('Reason step by step'),
    );
    expect(hasAdapterThinkingLine).toBe(false);
  });

  it('generates XML tags for modules without claude variant', () => {
    const mod = makeModule({ });
    const result = adapter.transform([mod], defaultCaps);
    expect(result).toContain('<module name="identity">');
  });
});

// ── GeminiAdapter ────────────────────────────────────────────────────────────

describe('GeminiAdapter', () => {
  const adapter = new GeminiAdapter();

  it('family is "gemini"', () => {
    expect(adapter.family).toBe('gemini');
  });

  it('output contains "##" markdown headers', () => {
    const result = adapter.transform(threeModules, defaultCaps);
    expect(result).toContain('##');
  });

  it('output does NOT contain XML tags', () => {
    const result = adapter.transform(threeModules, defaultCaps);
    expect(result).not.toContain('<module');
    expect(result).not.toContain('</module>');
  });

  it('includes grounding section when grounding capability set', () => {
    const result = adapter.transform(threeModules, groundingCaps);
    expect(result).toContain('## Search Grounding');
  });

  it('does NOT include grounding section without capability', () => {
    const result = adapter.transform(threeModules, defaultCaps);
    expect(result).not.toContain('## Search Grounding');
  });

  it('includes thinking section when thinking capability set', () => {
    const result = adapter.transform(threeModules, thinkingCaps);
    expect(result).toContain('## Thinking');
  });
});

// ── OpenAIAdapter ────────────────────────────────────────────────────────────

describe('OpenAIAdapter', () => {
  const adapter = new OpenAIAdapter();

  it('family is "openai"', () => {
    expect(adapter.family).toBe('openai');
  });

  it('output is numbered rules format', () => {
    const result = adapter.transform(threeModules, defaultCaps);
    expect(result).toMatch(/^1\./m);
    expect(result).toMatch(/^2\./m);
    expect(result).toMatch(/^3\./m);
  });

  it('output does NOT contain XML tags', () => {
    const result = adapter.transform(threeModules, defaultCaps);
    expect(result).not.toContain('<module');
  });

  it('output does NOT contain markdown headers', () => {
    const result = adapter.transform(threeModules, defaultCaps);
    expect(result).not.toMatch(/^##/m);
  });

  it('thinking mode only includes core modules', () => {
    const result = adapter.transform(threeModules, thinkingCaps);
    // Should only include core modules (identity + safety), not domain (azure-ops)
    const lines = result.split('\n').filter(Boolean);
    expect(lines.length).toBe(2); // 2 core modules
  });
});

// ── LocalAdapter ─────────────────────────────────────────────────────────────

describe('LocalAdapter', () => {
  const adapter = new LocalAdapter();

  it('family is "local"', () => {
    expect(adapter.family).toBe('local');
  });

  it('output is under 1000 tokens (~3500 chars)', () => {
    // Create many modules to test truncation
    const manyModules: PromptModule[] = Array.from({ length: 20 }, (_, i) =>
      makeModule({
        id: `uuid-${i}`,
        name: `module-${i}`,
        category: i < 10 ? 'core' : 'domain',
        priority: 100 - i,
        content: 'A'.repeat(200), // 200 chars each      }),
    );

    const result = adapter.transform(manyModules, defaultCaps);
    // ~3500 chars = 1000 tokens
    expect(result.length).toBeLessThanOrEqual(3600); // allow small margin
  });

  it('uses local variant for conciseness', () => {
    const result = adapter.transform(threeModules, defaultCaps);
    // Local variants are the short versions
    expect(result).toContain('You are OpenAgentic enterprise AI.');
  });

  it('output does NOT contain XML tags or markdown headers', () => {
    const result = adapter.transform(threeModules, defaultCaps);
    expect(result).not.toContain('<module');
    expect(result).not.toMatch(/^##/m);
  });

  it('includes at most 1 domain module', () => {
    const domainHeavy: PromptModule[] = [
      makeModule({ id: 'c1', name: 'identity', category: 'core', priority: 100 }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeModule({
          id: `d${i}`,
          name: `domain-${i}`,
          category: 'domain',
          priority: 70 - i,
          content: `Domain module ${i} content.`,        }),
      ),
    ];

    const result = adapter.transform(domainHeavy, defaultCaps);
    // Count "Domain N." occurrences — should be at most 1
    const domainMatches = (result.match(/Domain \d+\./g) || []).length;
    expect(domainMatches).toBeLessThanOrEqual(1);
  });
});

// ── ModelAdapterFactory ───────────────────────────────────────────────────────

describe('ModelAdapterFactory', () => {
  describe('detectFamily()', () => {
    const cases: Array<[string, string]> = [
      ['claude-sonnet-4-6', 'claude'],
      ['claude-opus-4-6', 'claude'],
      ['us.anthropic.claude-sonnet-4-6', 'claude'],
      ['gemini-2.5-pro', 'gemini'],
      ['gemini-1.5-flash', 'gemini'],
      ['gpt-4o', 'openai'],
      ['gpt-4-turbo', 'openai'],
      ['gpt-3.5-turbo', 'openai'],
      ['o1-preview', 'openai'],
      ['o3-mini', 'openai'],
      ['gpt-oss', 'local'],
      ['llama-3-70b', 'local'],
      ['mistral-7b', 'local'],
      ['mixtral-8x7b', 'local'],
      ['qwen3-vl', 'local'],
      ['deepseek-r1', 'local'],
      ['unknown-model-xyz', 'openai'],    // default fallback
      ['some-random-string', 'openai'],  // default fallback
    ];

    it.each(cases)('detectFamily("%s") → "%s"', (modelId, expected) => {
      expect(ModelAdapterFactory.detectFamily(modelId)).toBe(expected);
    });
  });

  describe('getAdapter()', () => {
    it('uses dbFamily when provided and valid', () => {
      const adapter = ModelAdapterFactory.getAdapter('gpt-4o', 'claude');
      expect(adapter.family).toBe('claude');
    });

    it('falls back to pattern detection when dbFamily is null', () => {
      const adapter = ModelAdapterFactory.getAdapter('gemini-2.5-pro', null);
      expect(adapter.family).toBe('gemini');
    });

    it('falls back to pattern detection when dbFamily is undefined', () => {
      const adapter = ModelAdapterFactory.getAdapter('claude-sonnet-4-6');
      expect(adapter.family).toBe('claude');
    });

    it('returns openai adapter for unknown model with no dbFamily', () => {
      const adapter = ModelAdapterFactory.getAdapter('unknown-proprietary-v2');
      expect(adapter.family).toBe('openai');
    });
  });

  describe('same 3 modules → each adapter produces different format', () => {
    it('produces distinct outputs per adapter', () => {
      const claude = new ClaudeAdapter().transform(threeModules, defaultCaps);
      const gemini = new GeminiAdapter().transform(threeModules, defaultCaps);
      const openai = new OpenAIAdapter().transform(threeModules, defaultCaps);
      const local = new LocalAdapter().transform(threeModules, defaultCaps);

      expect(claude).not.toBe(gemini);
      expect(claude).not.toBe(openai);
      expect(claude).not.toBe(local);
      expect(gemini).not.toBe(openai);
      expect(gemini).not.toBe(local);
      expect(openai).not.toBe(local);
    });

    it('claude output has XML, gemini has ##, openai has numbered, local is shortest', () => {
      const claude = new ClaudeAdapter().transform(threeModules, defaultCaps);
      const gemini = new GeminiAdapter().transform(threeModules, defaultCaps);
      const openai = new OpenAIAdapter().transform(threeModules, defaultCaps);
      const local = new LocalAdapter().transform(threeModules, defaultCaps);

      expect(claude).toContain('<module');
      expect(gemini).toContain('##');
      expect(openai).toMatch(/^1\./m);
      expect(local.length).toBeLessThan(claude.length);
    });
  });
});
