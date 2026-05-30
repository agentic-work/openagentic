import { describe, it, expect } from 'vitest';
import { normalizeAddModelCapabilities } from '../addModelCapabilities.js';

describe('normalizeAddModelCapabilities', () => {
  describe('happy path defaults', () => {
    it('fills tools=true when chat=true and tools missing (prevents CapabilityGate auto-upgrade)', () => {
      const c = normalizeAddModelCapabilities({
        chat: true, vision: true, streaming: true, embeddings: false, imageGeneration: false,
      });
      // This is the exact shape the UI sent for Sonnet 4.5 that triggered the
      // 2026-04-21 incident. After normalization tools should be true.
      expect(c.tools).toBe(true);
      expect(c.chat).toBe(true);
      expect(c.streaming).toBe(true);
      expect(c.vision).toBe(true);
    });

    it('empty payload defaults to chat+tools+streaming true, rest false', () => {
      const c = normalizeAddModelCapabilities({});
      expect(c).toEqual({
        chat: true, vision: false, tools: true, streaming: true,
        embeddings: false, imageGeneration: false,
      });
    });

    it('null input yields defaults', () => {
      expect(normalizeAddModelCapabilities(null)).toEqual({
        chat: true, vision: false, tools: true, streaming: true,
        embeddings: false, imageGeneration: false,
      });
    });
  });

  describe('explicit disables are respected', () => {
    it('admin can set tools=false explicitly', () => {
      const c = normalizeAddModelCapabilities({ chat: true, tools: false });
      expect(c.tools).toBe(false);
    });

    it('admin can set streaming=false explicitly', () => {
      const c = normalizeAddModelCapabilities({ chat: true, streaming: false });
      expect(c.streaming).toBe(false);
    });
  });

  describe('embedding-only / image-only shapes', () => {
    it('embedding-only model gets chat=false, tools=false', () => {
      const c = normalizeAddModelCapabilities({ chat: false, embeddings: true });
      expect(c.chat).toBe(false);
      expect(c.embeddings).toBe(true);
      expect(c.tools).toBe(false);
      expect(c.streaming).toBe(false);
    });

    it('image-gen-only model gets chat=false, tools=false (imageGen alias also accepted)', () => {
      const c = normalizeAddModelCapabilities({ chat: false, imageGen: true } as any);
      expect(c.chat).toBe(false);
      expect(c.imageGeneration).toBe(true);
      expect(c.tools).toBe(false);
    });
  });

  describe('thinking capability pass-through', () => {
    it('preserves thinking when provided', () => {
      const c = normalizeAddModelCapabilities({ chat: true, thinking: true });
      expect(c.thinking).toBe(true);
    });

    it('does NOT set thinking when absent', () => {
      const c = normalizeAddModelCapabilities({ chat: true });
      expect(c.thinking).toBeUndefined();
    });
  });

  describe('regression: Sonnet 4.5 exact payload from 2026-04-21 incident', () => {
    it('reproduces the incident payload — normalized now includes tools:true', () => {
      const incident = {
        chat: true, vision: true, streaming: true,
        embeddings: false, imageGeneration: false,
      };
      const c = normalizeAddModelCapabilities(incident);
      expect(c.tools).toBe(true); // this is the fix
    });
  });
});
