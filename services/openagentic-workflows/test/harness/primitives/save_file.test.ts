/**
 * save_file node — persists content to the artifact store.
 *
 * Wraps ctx.persistArtifact (same hook webhook_response uses with
 * persistAsArtifact:true). The harness stubs the hook via the runFlow
 * options bridge to capture writes deterministically.
 */

import { describe, it, expect } from 'vitest';
import { runFlow } from '../runFlow.js';

interface SaveFileOutput {
  artifactId: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
  filename: string;
  title: string;
}

describe('save_file node', () => {
  it('persists a string payload and returns artifactId + url + sizeBytes', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'save',
            type: 'save_file',
            data: {
              content: '<h1>Hello {{trigger.name}}</h1>',
              filename: 'greeting-{{trigger.name}}.html',
              title: 'Greeting for {{trigger.name}}',
              tags: ['greeting', 'demo'],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'save' }],
      },
      input: { name: 'trent' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.save as SaveFileOutput;
    expect(out.artifactId).toBeTruthy();
    expect(out.url).toMatch(/^\/api\/artifacts\/[^/]+\/download$/);
    expect(out.filename).toBe('greeting-trent.html');
    expect(out.mimeType).toBe('text/html');
    expect(out.title).toBe('Greeting for trent');
    expect(out.sizeBytes).toBe(Buffer.byteLength('<h1>Hello trent</h1>', 'utf8'));
  });

  it('auto-derives MIME from filename extension', async () => {
    const cases: Array<[string, string]> = [
      ['data.json', 'application/json'],
      ['rows.csv', 'text/csv'],
      ['notes.md', 'text/markdown'],
      ['log.txt', 'text/plain'],
      ['icon.svg', 'image/svg+xml'],
      ['unknown.weirdext', 'text/plain'],
    ];
    for (const [filename, expectedMime] of cases) {
      const result = await runFlow({
        flow: {
          nodes: [
            { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
            {
              id: 'save',
              type: 'save_file',
              data: { content: 'x', filename },
            },
          ],
          edges: [{ id: 'e1', source: 'trigger', target: 'save' }],
        },
        input: {},
      });
      const out = result.outputs.save as SaveFileOutput;
      expect(out.mimeType).toBe(expectedMime);
    }
  });

  it('explicit mimeType overrides extension auto-derivation', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'save',
            type: 'save_file',
            data: {
              content: 'x',
              filename: 'data.txt',
              mimeType: 'application/x-custom',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'save' }],
      },
      input: {},
    });
    expect((result.outputs.save as SaveFileOutput).mimeType).toBe('application/x-custom');
  });

  it('JSON.stringifies non-string content (objects, arrays)', async () => {
    const obj = { foo: 'bar', count: 42, nested: { a: [1, 2, 3] } };
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'save',
            type: 'save_file',
            data: { content: obj, filename: 'obj.json' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'save' }],
      },
      input: {},
    });
    expect(result.status).toBe('completed');
    const out = result.outputs.save as SaveFileOutput;
    expect(out.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(obj, null, 2), 'utf8'));
    expect(out.mimeType).toBe('application/json');
  });

  it('fails-CLOSED when content is missing', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'save',
            type: 'save_file',
            data: { filename: 'empty.txt' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'save' }],
      },
      input: {},
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message ?? '').toMatch(/content|required/i);
  });

  it('fails-CLOSED when filename is missing', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'save',
            type: 'save_file',
            data: { content: 'hello' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'save' }],
      },
      input: {},
    });
    expect(result.status).toBe('failed');
    expect(result.error?.message ?? '').toMatch(/filename|required/i);
  });
});
