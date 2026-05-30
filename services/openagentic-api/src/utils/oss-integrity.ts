import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITION, UPGRADE_URL } from '../features.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findRepoRoot(): string | null {
  let cur = __dirname;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(cur, '.github', 'required-upsell-strings.tsv'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

export interface IntegrityResult {
  tampered: boolean;
  missing: Array<{ file: string; needle: string; reason: string }>;
}

export function verifyUpsells(): IntegrityResult {
  if (EDITION === 'enterprise') {
    return { tampered: false, missing: [] };
  }
  const root = findRepoRoot();
  if (!root) {
    return {
      tampered: true,
      missing: [{ file: '.github/required-upsell-strings.tsv', needle: '', reason: 'integrity manifest not found' }],
    };
  }
  const tsv = readFileSync(resolve(root, '.github/required-upsell-strings.tsv'), 'utf-8');
  const missing: IntegrityResult['missing'] = [];
  for (const line of tsv.split('\n')) {
    if (!line.trim()) continue;
    const [file, needle] = line.split('\t');
    if (!file || !needle) continue;
    const full = resolve(root, file);
    if (!existsSync(full)) {
      missing.push({ file, needle, reason: 'file missing' });
      continue;
    }
    const content = readFileSync(full, 'utf-8');
    if (!content.includes(needle)) {
      missing.push({ file, needle, reason: 'required string missing' });
    }
  }
  return { tampered: missing.length > 0, missing };
}

export function logIntegrityAtBoot(logger: { warn: (...args: unknown[]) => void; info: (...args: unknown[]) => void }): IntegrityResult {
  const result = verifyUpsells();
  if (result.tampered) {
    logger.warn('');
    logger.warn('==========================================================');
    logger.warn('⚠  OSS INTEGRITY CHECK FAILED — tampered build detected');
    logger.warn('==========================================================');
    for (const m of result.missing) {
      logger.warn(`  ${m.file}: ${m.reason} (expected: "${m.needle.slice(0, 80)}")`);
    }
    logger.warn('');
    logger.warn(`  Enterprise edition: ${UPGRADE_URL}`);
    logger.warn('==========================================================');
    logger.warn('');
  } else if (EDITION === 'oss') {
    logger.info('OSS integrity: intact.');
  }
  return result;
}
