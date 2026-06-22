/**
 * scanMissingSecrets
 *
 * Walks every node in a workflow definition, finds `{{secret:NAME}}`
 * references anywhere in the node's `data` blob (including nested objects
 * and arrays), and returns the unique set of names that are NOT in the
 * provided list of known secret names.
 *
 * Powers the MissingSecretsWizard — when the user clicks Run on a flow
 * that references credentials they haven't created yet, this gives the
 * UI the list of names to ask about.
 *
 * Names are matched case-sensitively and whitespace inside the braces
 * is trimmed (so `{{secret: FOO }}` resolves to `FOO`).
 */

const SECRET_PATTERN = /\{\{secret:([^}]+)\}\}/g;

export interface MissingSecret {
  name: string;
  nodeIds: string[];
}

export function scanMissingSecrets(
  nodes: Array<{ id: string; data?: unknown; type?: string }>,
  knownSecretNames: string[],
): MissingSecret[] {
  const known = new Set(knownSecretNames);
  // Map<secretName, ordered list of nodeIds that reference it>
  const found = new Map<string, string[]>();

  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const blob = JSON.stringify(node.data ?? {});
    SECRET_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SECRET_PATTERN.exec(blob)) !== null) {
      const raw = m[1];
      const name = (raw || '').trim();
      if (!name) continue;
      if (known.has(name)) continue;
      const list = found.get(name);
      if (list) {
        if (!list.includes(node.id)) list.push(node.id);
      } else {
        found.set(name, [node.id]);
      }
    }
  }

  return Array.from(found.entries()).map(([name, nodeIds]) => ({ name, nodeIds }));
}
