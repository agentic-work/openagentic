import { describe, it, expect } from 'vitest';
import { requireFieldNonEmpty } from '../../invariants/requireFieldNonEmpty';
import type { DocManifest } from '../../types';

function manifestWithItems(items: Array<Record<string, string>>): DocManifest {
  return {
    domain: 'test',
    title: 'Test',
    description: '',
    icon: '',
    category: '',
    generatedAt: '',
    sourceFiles: [],
    sections: [
      {
        id: 's1',
        title: 'S1',
        description: '',
        adminOnly: false,
        items: items.map((p, i) => ({
          id: `item-${i}`,
          name: p.name ?? '',
          description: p.description ?? '',
          type: p.type,
        })),
      },
    ],
  };
}

describe('requireFieldNonEmpty', () => {
  it('passes when every item has non-empty field', async () => {
    const inv = requireFieldNonEmpty('description');
    const result = await inv(
      manifestWithItems([{ description: 'a' }, { description: 'b' }]),
      '/tmp',
    );
    expect(result.ok).toBe(true);
  });

  it('fails when one item has empty field, listing the offender', async () => {
    const inv = requireFieldNonEmpty('description');
    const m = manifestWithItems([
      { name: 'good', description: 'a' },
      { name: 'bad', description: '' },
    ]);
    const result = await inv(m, '/tmp');
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['item-1']);
  });

  it('treats whitespace-only as empty', async () => {
    const inv = requireFieldNonEmpty('description');
    const result = await inv(
      manifestWithItems([{ description: '   ' }, { description: 'ok' }]),
      '/tmp',
    );
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['item-0']);
  });
});
