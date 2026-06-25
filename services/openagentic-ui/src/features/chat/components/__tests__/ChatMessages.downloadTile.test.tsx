/**
 * AC-D2 — ChatMessages threads `artifactEmitsByMessageId` into a strip
 * of <DownloadTile /> renders. Source-grep wire test.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const MSG = join(__dirname, '..', 'ChatMessages.tsx');
const CON = join(__dirname, '..', 'ChatContainer.tsx');

describe('ChatMessages download-tile wire (AC-D2)', () => {
  it('imports DownloadTile from ./v2/DownloadTile', () => {
    const src = readFileSync(MSG, 'utf8');
    expect(src).toMatch(/from ['"]\.\/v2\/DownloadTile['"]/);
  });

  it('declares the artifactEmitsByMessageId prop on ChatMessagesProps', () => {
    const src = readFileSync(MSG, 'utf8');
    expect(src).toMatch(/artifactEmitsByMessageId\??\s*:\s*Record<string,\s*[^>]*ArtifactEmit\[\]>/);
  });

  it('destructures artifactEmitsByMessageId in the function body', () => {
    const src = readFileSync(MSG, 'utf8');
    expect(src).toMatch(/artifactEmitsByMessageId,/);
  });

  it('renders <DownloadTile artifact={...} /> per entry', () => {
    const src = readFileSync(MSG, 'utf8');
    expect(src).toMatch(/<DownloadTile[\s\S]*?artifact=/);
  });
});

describe('ChatContainer download-tile wire (AC-D2)', () => {
  it('destructures artifactEmitsByMessageId from useChatStream', () => {
    const src = readFileSync(CON, 'utf8');
    expect(src).toMatch(/artifactEmitsByMessageId,/);
  });

  it('forwards artifactEmitsByMessageId into <ChatMessages />', () => {
    const src = readFileSync(CON, 'utf8');
    expect(src).toMatch(/artifactEmitsByMessageId=\{artifactEmitsByMessageId\}/);
  });
});
