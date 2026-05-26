/**
 * Tests for buildMetadataStripEnv — guards the contract that the
 * openagentic-exec pod spec receives the env vars the daemon needs
 * to echo a live cwd + budget cap back through system/init.
 *
 * The metadata strip is dead glass without these — without
 * OPENAGENTIC_CWD the child runs at /app and the strip shows
 * /app forever; without OPENAGENTIC_BUDGET_CAP_USD the daemon
 * omits budget_cap_usd and the strip falls through to em-dash.
 */

import { describe, it, expect } from 'vitest';

import { buildMetadataStripEnv } from '../metadataStripEnv';

describe('buildMetadataStripEnv — OPENAGENTIC_CWD', () => {
  it('emits OPENAGENTIC_CWD pointing at the per-user PVC mount', () => {
    const env = buildMetadataStripEnv({ workspacePath: '/workspaces/u-9abc' });
    expect(env).toContainEqual({
      name: 'OPENAGENTIC_CWD',
      value: '/workspaces/u-9abc',
    });
  });

  it('does NOT emit OPENAGENTIC_CWD when workspacePath is empty', () => {
    const env = buildMetadataStripEnv({ workspacePath: '' });
    expect(env.find((e) => e.name === 'OPENAGENTIC_CWD')).toBeUndefined();
  });

  it('NEVER emits the misleading /app fallback', () => {
    // Smoke test: even with weird inputs we don't fabricate a
    // container-WORKDIR fallback. Empty input yields no var; we
    // never substitute /app.
    const env = buildMetadataStripEnv({ workspacePath: '' });
    expect(env.find((e) => e.value === '/app')).toBeUndefined();
  });
});

describe('buildMetadataStripEnv — OPENAGENTIC_BUDGET_CAP_USD', () => {
  it('passes a numeric helm-default cap straight through', () => {
    const env = buildMetadataStripEnv({
      workspacePath: '/workspaces/u',
      codemodeDefaultBudgetCapUsd: '25',
    });
    expect(env).toContainEqual({
      name: 'OPENAGENTIC_BUDGET_CAP_USD',
      value: '25',
    });
  });

  it('passes "unlimited" / "null" through verbatim — daemon translates', () => {
    const env = buildMetadataStripEnv({
      workspacePath: '/workspaces/u',
      codemodeDefaultBudgetCapUsd: 'unlimited',
    });
    expect(env).toContainEqual({
      name: 'OPENAGENTIC_BUDGET_CAP_USD',
      value: 'unlimited',
    });
  });

  it('OMITS the env var when the platform default is unset / empty', () => {
    const env = buildMetadataStripEnv({ workspacePath: '/workspaces/u' });
    expect(env.find((e) => e.name === 'OPENAGENTIC_BUDGET_CAP_USD')).toBeUndefined();
  });

  it('OMITS the env var when the platform default is whitespace', () => {
    const env = buildMetadataStripEnv({
      workspacePath: '/workspaces/u',
      codemodeDefaultBudgetCapUsd: '   ',
    });
    expect(env.find((e) => e.name === 'OPENAGENTIC_BUDGET_CAP_USD')).toBeUndefined();
  });

  it('NEVER fabricates a hardcoded $5 cap when the platform default is unset', () => {
    const env = buildMetadataStripEnv({ workspacePath: '/workspaces/u' });
    expect(env.find((e) => e.value === '5')).toBeUndefined();
  });
});

describe('buildMetadataStripEnv — OPENAGENTIC_BOOT_MODEL (Cycle 2 of model-switch redesign)', () => {
  // Spec: docs/superpowers/specs/2026-04-25-codemode-model-switch-redesign.md
  //
  // The boot model is a helm-time decision: the openagentic daemon initializes
  // its in-memory currentModel from this env at startup, and after that ONLY
  // the /model slash command can change it. /v1/messages on the api validates
  // the caller's body.model against the Registry — so the daemon MUST send
  // *some* model on every turn, and that model originates here at boot.

  it('emits OPENAGENTIC_BOOT_MODEL when the helm value is set', () => {
    const env = buildMetadataStripEnv({
      workspacePath: '/workspaces/u',
      bootModel: 'us.anthropic.claude-sonnet-4-6',
    });
    expect(env).toContainEqual({
      name: 'OPENAGENTIC_BOOT_MODEL',
      value: 'us.anthropic.claude-sonnet-4-6',
    });
  });

  it('passes any model id through verbatim (Bedrock / Vertex / AIF / Ollama all opaque to cm)', () => {
    const cases = [
      'gemini-2.5-flash',
      'gpt-5.3-codex',
      'gpt-oss:20b',
      'us.anthropic.claude-sonnet-4-6',
    ];
    for (const m of cases) {
      const env = buildMetadataStripEnv({ workspacePath: '/workspaces/u', bootModel: m });
      expect(env).toContainEqual({ name: 'OPENAGENTIC_BOOT_MODEL', value: m });
    }
  });

  it('OMITS the env var when bootModel is unset — fail-fast at daemon, no silent default', () => {
    const env = buildMetadataStripEnv({ workspacePath: '/workspaces/u' });
    expect(env.find((e) => e.name === 'OPENAGENTIC_BOOT_MODEL')).toBeUndefined();
  });

  it('OMITS the env var when bootModel is empty string', () => {
    const env = buildMetadataStripEnv({ workspacePath: '/workspaces/u', bootModel: '' });
    expect(env.find((e) => e.name === 'OPENAGENTIC_BOOT_MODEL')).toBeUndefined();
  });

  it('OMITS the env var when bootModel is whitespace', () => {
    const env = buildMetadataStripEnv({ workspacePath: '/workspaces/u', bootModel: '   ' });
    expect(env.find((e) => e.name === 'OPENAGENTIC_BOOT_MODEL')).toBeUndefined();
  });

  it('trims surrounding whitespace before emitting (helm yaml multiline trail)', () => {
    const env = buildMetadataStripEnv({
      workspacePath: '/workspaces/u',
      bootModel: '  gpt-oss:20b  ',
    });
    expect(env).toContainEqual({ name: 'OPENAGENTIC_BOOT_MODEL', value: 'gpt-oss:20b' });
  });
});
