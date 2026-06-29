/**
 * artifactRegistry — unit tests.
 *
 * Lock the id-based supersession semantics so a regression to "stack
 * everything" is caught before it ships.
 */

import { describe, it, expect } from 'vitest';
import {
  markSupersededArtifacts,
  filterActiveArtifacts,
  type ArtifactBlock,
} from '../artifactRegistry';

function block(id: string, artifactId?: string): ArtifactBlock {
  return { id, artifactId };
}

describe('markSupersededArtifacts', () => {
  it('marks nothing when no blocks share an artifactId', () => {
    const input = [block('b1', 'dash'), block('b2', 'report'), block('b3')];
    const out = markSupersededArtifacts(input);
    expect(out.every((b) => !b.isSupersededArtifact)).toBe(true);
  });

  it('marks the earlier artifact as superseded when the id repeats', () => {
    const input = [block('b1', 'dash'), block('b2', 'other'), block('b3', 'dash')];
    const out = markSupersededArtifacts(input);
    expect(out[0].isSupersededArtifact).toBe(true);
    expect(out[0].supersededBy).toBe('b3');
    expect(out[1].isSupersededArtifact).toBe(false); // different id
    expect(out[2].isSupersededArtifact).toBe(false); // the new version
  });

  it('keeps only the LAST when three blocks share an artifactId', () => {
    const input = [
      block('b1', 'dash'),
      block('b2', 'dash'),
      block('b3', 'dash'),
    ];
    const out = markSupersededArtifacts(input);
    expect(out[0].isSupersededArtifact).toBe(true);
    expect(out[1].isSupersededArtifact).toBe(true);
    expect(out[2].isSupersededArtifact).toBe(false);
    expect(out[0].supersededBy).toBe('b3');
    expect(out[1].supersededBy).toBe('b3');
  });

  it('blocks without artifactId are always active', () => {
    const input = [block('b1'), block('b2', 'dash'), block('b3'), block('b4', 'dash')];
    const out = markSupersededArtifacts(input);
    expect(out.filter((b) => b.id === 'b1')[0].isSupersededArtifact).toBe(false);
    expect(out.filter((b) => b.id === 'b3')[0].isSupersededArtifact).toBe(false);
  });

  it('does not mutate the input array', () => {
    const input = [block('b1', 'dash'), block('b2', 'dash')];
    const originalCopy = JSON.parse(JSON.stringify(input));
    markSupersededArtifacts(input);
    expect(input).toEqual(originalCopy);
  });

  it('preserves block order in the output', () => {
    const input = [block('b1', 'a'), block('b2', 'b'), block('b3', 'a')];
    const out = markSupersededArtifacts(input);
    expect(out.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('filterActiveArtifacts', () => {
  it('drops superseded blocks entirely', () => {
    const input = [
      block('b1', 'dash'),
      block('b2', 'other'),
      block('b3', 'dash'), // supersedes b1
    ];
    const out = filterActiveArtifacts(input);
    expect(out.map((b) => b.id)).toEqual(['b2', 'b3']);
  });

  it('returns the full list when no supersession applies', () => {
    const input = [block('b1', 'a'), block('b2', 'b'), block('b3')];
    const out = filterActiveArtifacts(input);
    expect(out).toHaveLength(3);
  });
});
