import fs from 'node:fs';
import crypto from 'node:crypto';
import { ENV_FILE, ENV_EXAMPLE } from './paths.ts';

export type EnvMap = Record<string, string>;

/** Placeholder in .env.example that the wizard replaces with a cryptographically
 *  random secret at install time. Sonar flags literal dev passwords; this keeps
 *  .env.example free of any real credential. */
const INSTALL_PLACEHOLDER = 'REPLACE_ME_AT_INSTALL_TIME';
const randomSecret = (bytes = 24): string => crypto.randomBytes(bytes).toString('base64url');

export function readExample(): EnvMap {
  if (!fs.existsSync(ENV_EXAMPLE)) return {};
  return parse(fs.readFileSync(ENV_EXAMPLE, 'utf8'));
}

export function readCurrent(): EnvMap {
  if (!fs.existsSync(ENV_FILE)) return {};
  return parse(fs.readFileSync(ENV_FILE, 'utf8'));
}

/** Secrets docker-compose.yml requires via ${VAR:?} — the stack will not start
 *  without them. We GUARANTEE each is present (carry an existing value forward,
 *  else generate one), independent of whether .env.example was found/complete, so
 *  a wizard install can never produce a .env missing a required secret. */
const REQUIRED_SECRETS = [
  'POSTGRES_PASSWORD', 'JWT_SECRET', 'SIGNING_SECRET',
  'INTERNAL_API_KEY', 'FRONTEND_SECRET', 'INTERNAL_SERVICE_SECRET',
];

export function writeEnv(values: EnvMap): void {
  const example = fs.existsSync(ENV_EXAMPLE) ? fs.readFileSync(ENV_EXAMPLE, 'utf8') : '';
  // Any existing .env keys we want to preserve across a wizard re-run (e.g.
  // the random POSTGRES_PASSWORD written on first install).
  const existing = readCurrent();
  // Guarantee every required secret is set BEFORE we render — without this a
  // missing/incomplete .env.example (e.g. under npx, before the OPENAGENTIC_HOME
  // fix) left required secrets unset and broke `docker compose up`.
  values = { ...values };
  for (const k of REQUIRED_SECRETS) {
    if (!(k in values)) {
      values[k] = existing[k] && existing[k] !== INSTALL_PLACEHOLDER ? existing[k] : randomSecret(32);
    }
  }
  // Start from the example (preserves comments), then overlay values.
  const lines = example.split('\n').map((line) => {
    const m = /^(\s*)([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (m) {
      const key = m[2];
      const exampleValue = m[3];
      if (key in values) return `${m[1]}${key}=${values[key]}`;
      // Replace install placeholders with a random secret — or carry
      // the existing .env value forward if we've already generated one.
      if (exampleValue.trim() === INSTALL_PLACEHOLDER) {
        return `${m[1]}${key}=${existing[key] && existing[key] !== INSTALL_PLACEHOLDER ? existing[key] : randomSecret()}`;
      }
    }
    return line;
  });
  // Append any keys not already represented in the example.
  const covered = new Set(example.split('\n').flatMap((l) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(l);
    return m ? [m[1]] : [];
  }));
  const extra = Object.entries(values).filter(([k]) => !covered.has(k));
  if (extra.length > 0) {
    lines.push('', '# ─── Added by setup wizard ──────────────────────────────');
    for (const [k, v] of extra) lines.push(`${k}=${v}`);
  }
  fs.writeFileSync(ENV_FILE, lines.join('\n'), 'utf8');
}

function parse(content: string): EnvMap {
  const out: EnvMap = {};
  for (const line of content.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}
