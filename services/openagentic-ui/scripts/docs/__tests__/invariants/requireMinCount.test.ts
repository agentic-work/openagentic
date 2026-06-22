import { describe, it, expect } from 'vitest';
import { requireMinCount } from '../../invariants/requireMinCount';
import type { DocManifest } from '../../types';

function manifestWith(itemCount: number): DocManifest {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `item-${i}`,
    name: `Item ${i}`,
    description: 'desc',
  }));
  return {
    domain: 'test',
    title: 'Test',
    description: '',
    icon: '',
    category: '',
    generatedAt: '',
    sourceFiles: [],
    sections: [{ id: 's1', title: 'S1', description: '', adminOnly: false, items }],
  };
}

describe('requireMinCount', () => {
  it('passes when total item count meets threshold', async () => {
    const invariant = requireMinCount(3);
    const result = await invariant(manifestWith(5), '/tmp');
    expect(result.ok).toBe(true);
  });

  it('fails when total item count is below threshold', async () => {
    const invariant = requireMinCount(10);
    const result = await invariant(manifestWith(3), '/tmp');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('3');
    expect(result.message).toContain('10');
  });

  it('counts items across all sections', async () => {
    const invariant = requireMinCount(5);
    const m = manifestWith(2);
    m.sections.push({
      id: 's2',
      title: 'S2',
      description: '',
      adminOnly: false,
      items: [
        { id: 'x', name: 'x', description: 'd' },
        { id: 'y', name: 'y', description: 'd' },
        { id: 'z', name: 'z', description: 'd' },
      ],
    });
    const result = await invariant(m, '/tmp');
    expect(result.ok).toBe(true);
  });
});
