import { execa } from 'execa';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface K8sProbe {
  kubeconfigPath: string;
  kubectlVersion: string | null;
  helmVersion: string | null;
  context: string | null;
  reachable: boolean;
  serverVersion: string | null;
  nodeCount: number | null;
  namespaceExists: boolean;
  existingRelease: { name: string; revision: number; status: string } | null;
}

const EXEC_TIMEOUT_MS = 8_000;

function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') return join(homedir(), p.slice(1));
  return p;
}

export function findKubeconfig(): string | null {
  const env = process.env.KUBECONFIG?.trim();
  if (env) return env;
  const def = join(homedir(), '.kube', 'config');
  if (existsSync(def)) return def;
  return null;
}

export function validateKubeconfigPath(p: string): { ok: true; path: string } | { ok: false; reason: string } {
  const expanded = expandTilde(p.trim());
  if (!expanded) return { ok: false, reason: 'path is empty' };
  if (!existsSync(expanded)) return { ok: false, reason: `not found: ${expanded}` };
  try {
    if (!statSync(expanded).isFile()) return { ok: false, reason: `${expanded} is not a regular file` };
  } catch (err) {
    return { ok: false, reason: `cannot read ${expanded}` };
  }
  return { ok: true, path: expanded };
}

async function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const r = await execa(cmd, args, { timeout: EXEC_TIMEOUT_MS, env, reject: false });
    return { ok: r.exitCode === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch (err) {
    return { ok: false, stdout: '', stderr: String(err) };
  }
}

export async function probeCluster(kubeconfigPath: string): Promise<K8sProbe> {
  const env = { ...process.env, KUBECONFIG: kubeconfigPath };

  const result: K8sProbe = {
    kubeconfigPath,
    kubectlVersion: null,
    helmVersion: null,
    context: null,
    reachable: false,
    serverVersion: null,
    nodeCount: null,
    namespaceExists: false,
    existingRelease: null,
  };

  // kubectl version (client)
  const kcVer = await run('kubectl', ['version', '--client=true', '--output=json'], env);
  if (kcVer.ok) {
    try {
      const parsed = JSON.parse(kcVer.stdout);
      result.kubectlVersion = parsed?.clientVersion?.gitVersion || null;
    } catch {
      result.kubectlVersion = null;
    }
  }

  // helm version
  const hVer = await run('helm', ['version', '--template={{.Version}}'], env);
  if (hVer.ok) result.helmVersion = hVer.stdout.trim();

  // If either is missing, bail — rest of probe requires them.
  if (!result.kubectlVersion || !result.helmVersion) return result;

  // current context
  const ctx = await run('kubectl', ['config', 'current-context'], env);
  if (ctx.ok) result.context = ctx.stdout.trim();
  if (!result.context) return result;

  // server version (reachability)
  const srvVer = await run('kubectl', ['version', '--output=json'], env);
  if (srvVer.ok) {
    try {
      const parsed = JSON.parse(srvVer.stdout);
      result.serverVersion = parsed?.serverVersion?.gitVersion || null;
      result.reachable = !!result.serverVersion;
    } catch {
      result.reachable = false;
    }
  }
  if (!result.reachable) return result;

  // node count
  const nodes = await run('kubectl', ['get', 'nodes', '-o', 'name'], env);
  if (nodes.ok) result.nodeCount = nodes.stdout.split('\n').filter(Boolean).length;

  // namespace check
  const ns = await run('kubectl', ['get', 'namespace', 'openagentic', '-o', 'name'], env);
  result.namespaceExists = ns.ok && ns.stdout.trim().length > 0;

  // existing helm release
  const rel = await run('helm', ['list', '-n', 'openagentic', '-o', 'json'], env);
  if (rel.ok) {
    try {
      const parsed = JSON.parse(rel.stdout);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const openag = parsed.find((r: { name: string }) => r.name === 'openagentic') ?? parsed[0];
        if (openag) {
          result.existingRelease = {
            name: openag.name,
            revision: Number(openag.revision) || 0,
            status: openag.status || 'unknown',
          };
        }
      }
    } catch {
      // ignore parse failure; leave existingRelease null
    }
  }

  return result;
}
