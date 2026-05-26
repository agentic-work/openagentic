import { describe, it, expect } from 'vitest';
import { reduce, createInitialState, INITIAL_STATE } from '../streamReducer';

describe('streamReducer — activePicker initial state', () => {
  it('starts with activePicker === null', () => {
    expect(INITIAL_STATE.activePicker).toBeNull();
    expect(createInitialState().activePicker).toBeNull();
  });
});

describe('streamReducer — open_picker / close_picker', () => {
  it('open_picker:skills sets activePicker to "skills"', () => {
    const state = createInitialState();
    const next = reduce(state, { type: 'open_picker', picker: 'skills' });
    expect(next.activePicker).toBe('skills');
  });

  it('open_picker:mcp / open_picker:plugins / open_picker:model / open_picker:agents set the matching value', () => {
    const a = reduce(createInitialState(), { type: 'open_picker', picker: 'mcp' });
    expect(a.activePicker).toBe('mcp');
    const b = reduce(createInitialState(), { type: 'open_picker', picker: 'plugins' });
    expect(b.activePicker).toBe('plugins');
    const c = reduce(createInitialState(), { type: 'open_picker', picker: 'model' });
    expect(c.activePicker).toBe('model');
    const d = reduce(createInitialState(), { type: 'open_picker', picker: 'agents' });
    expect(d.activePicker).toBe('agents');
  });

  it('close_picker resets activePicker to null', () => {
    const opened = reduce(createInitialState(), {
      type: 'open_picker',
      picker: 'skills',
    });
    const closed = reduce(opened, { type: 'close_picker' });
    expect(closed.activePicker).toBeNull();
  });

  it('open_picker / close_picker do not mutate any other state slice', () => {
    const state = {
      ...createInitialState(),
      messages: [{ id: 'u1', role: 'user' as const, text: 'hi', createdAt: 1 }],
      error: 'previous error',
      contextTokens: 4200,
    };
    const opened = reduce(state, { type: 'open_picker', picker: 'skills' });
    expect(opened.messages).toBe(state.messages);
    expect(opened.error).toBe('previous error');
    expect(opened.contextTokens).toBe(4200);
    expect(opened.activePicker).toBe('skills');

    const closed = reduce(opened, { type: 'close_picker' });
    expect(closed.messages).toBe(state.messages);
    expect(closed.error).toBe('previous error');
    expect(closed.contextTokens).toBe(4200);
    expect(closed.activePicker).toBeNull();
  });

  it('opening a different picker while one is open replaces the value', () => {
    const skills = reduce(createInitialState(), {
      type: 'open_picker',
      picker: 'skills',
    });
    const mcp = reduce(skills, { type: 'open_picker', picker: 'mcp' });
    expect(mcp.activePicker).toBe('mcp');
  });

  it('close_picker on already-null state is a no-op (returns unchanged state reference)', () => {
    const state = createInitialState();
    const next = reduce(state, { type: 'close_picker' });
    expect(next).toBe(state);
  });
});
