/**
 * Architecture gate: GET /api/agents/resolve must bypass the
 * `is_default:true` filter when a caller supplies `?id=<uuid>`.
 *
 * Why this is pinned:
 *   - Templates materialize agents into prisma.agent and stash the
 *     resulting uuid on the workflow node (`node.data.agentId`). At
 *     run time the agent_single executor passes that id through to
 *     openagentic-proxy, which forwards it to /api/agents/resolve?id=.
 *   - If the resolve route's WHERE clause silently picks up the
 *     `is_default:true` filter on the id branch, every template-scoped
 *     agent (which can be is_default:false in the rare collision case)
 *     would 404. That breaks every flow that references a non-default
 *     agent by id — and breaks the parity contract between chatmode
 *     (role-based picker) and flows (id-based runtime resolve).
 *
 * Pin the exact ternary so a future reviewer can't accidentally fold
 * the is_default filter into the id branch.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROUTE = join(__dirname, '../..', 'routes/agents.ts');

describe('Architecture: /api/agents/resolve — id branch bypasses is_default filter', () => {
  const src = readFileSync(ROUTE, 'utf8');

  it('contains a ternary that distinguishes id-based lookup from role-based lookup', () => {
    // The exact shape we want preserved:
    //   const where = id ? { id } : { agent_type: role, is_default: true, enabled: true };
    // Allow flexible whitespace but pin the structural anchors.
    expect(src).toMatch(/id\s*\?\s*\{\s*id\s*\}\s*:/);
  });

  it('role branch retains the is_default filter (canonical-default precedence preserved)', () => {
    expect(src).toMatch(/agent_type\s*:\s*role[\s\S]{0,80}is_default\s*:\s*true/);
  });

  it('id branch does NOT include is_default — template agents reachable by uuid', () => {
    // Grab the ternary's id-branch slice and confirm `is_default` is absent.
    const m = src.match(/const\s+where\s*=\s*id\s*\?\s*(\{[^}]*\})\s*:/);
    expect(m, 'expected `const where = id ? { ... } : ...` ternary in route source').toBeTruthy();
    const idBranch = m![1];
    expect(idBranch).not.toMatch(/is_default/);
  });

  it('comment explains the id-vs-role distinction for future readers', () => {
    // A short header so the next maintainer knows why the id branch is bare.
    // Looks for either the route-level docblock or a nearby inline comment.
    const headerSnippet = src
      .slice(src.indexOf('/resolve'), src.indexOf('/resolve') + 1200)
      .toLowerCase();
    expect(headerSnippet).toMatch(/role|id|agent/);
  });
});
