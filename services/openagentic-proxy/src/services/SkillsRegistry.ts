import axios from 'axios';
import { logger } from '../utils/logger';

export interface Skill {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  type: string;
  definition: any;
  source: string;
  requiredTools: string[];
  tags: string[];
}

/**
 * SkillsRegistry — backed by the API's PostgreSQL storage.
 * Loads skills from GET /api/admin/agents/skills on startup,
 * writes new skills via POST /api/admin/agents/skills,
 * and keeps an in-memory cache for fast reads.
 */
export class SkillsRegistry {
  private skills: Map<string, Skill> = new Map();
  private apiUrl: string;
  private apiKey: string;
  private internalSecret: string;
  private loaded = false;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl;
    this.apiKey = process.env.OPENAGENTIC_PROXY_API_KEY
      || process.env.FLOWISE_INTERNAL_API_KEY
      || '';
    // Preferred: service-to-service auth via INTERNAL_SERVICE_SECRET.
    // api's unifiedAuthHook accepts x-request-from + x-internal-secret.
    this.internalSecret = process.env.INTERNAL_SERVICE_SECRET || '';
  }

  /** Load skills from the API on startup */
  async loadFromAPI(): Promise<void> {
    try {
      const headers = this.buildHeaders();
      const response = await axios.get(`${this.apiUrl}/api/admin/agents/skills`, {
        headers,
        timeout: 10000,
      });
      const skills = response.data?.skills || [];
      this.skills.clear();
      for (const s of skills) {
        const skill = this.mapFromAPI(s);
        this.skills.set(skill.id, skill);
      }
      this.loaded = true;
      logger.info({ count: this.skills.size }, 'Skills loaded from API');
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to load skills from API — starting with empty registry');
      this.loaded = true; // Don't retry on every request
    }
  }

  /** Register a new skill, persisting to the API */
  async register(skill: Skill): Promise<Skill> {
    // Persist to API
    try {
      const headers = this.buildHeaders();
      const response = await axios.post(`${this.apiUrl}/api/admin/agents/skills`, {
        name: skill.name,
        displayName: skill.displayName,
        description: skill.description,
        type: skill.type,
        definition: skill.definition,
        source: skill.source,
        requiredTools: skill.requiredTools,
        tags: skill.tags,
      }, { headers, timeout: 10000 });

      const persisted = this.mapFromAPI(response.data);
      this.skills.set(persisted.id, persisted);
      logger.info({ skillId: persisted.id, name: persisted.name }, 'Skill registered and persisted');
      return persisted;
    } catch (error: any) {
      // Fallback: store in memory only
      logger.warn({ error: error.message, name: skill.name }, 'Failed to persist skill to API, storing in memory only');
      this.skills.set(skill.id, skill);
      return skill;
    }
  }

  /** Delete a skill */
  async delete(id: string): Promise<boolean> {
    try {
      const headers = this.buildHeaders();
      await axios.delete(`${this.apiUrl}/api/admin/agents/skills/${id}`, {
        headers, timeout: 10000,
      });
      this.skills.delete(id);
      return true;
    } catch (error: any) {
      logger.warn({ error: error.message, id }, 'Failed to delete skill from API');
      this.skills.delete(id); // Remove from cache anyway
      return false;
    }
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  list(filters?: { type?: string; source?: string; tags?: string[] }): Skill[] {
    let results = Array.from(this.skills.values());
    if (filters?.type) results = results.filter(s => s.type === filters.type);
    if (filters?.source) results = results.filter(s => s.source === filters.source);
    if (filters?.tags?.length) {
      results = results.filter(s => filters.tags!.some(t => s.tags.includes(t)));
    }
    return results;
  }

  resolveForAgent(skillIds: string[]): string {
    const injections: string[] = [];
    for (const id of skillIds) {
      const skill = this.skills.get(id);
      if (!skill) continue;

      if (skill.type === 'prompt_injection') {
        injections.push(typeof skill.definition === 'string' ? skill.definition : JSON.stringify(skill.definition));
      } else if (skill.type === 'tool_bundle') {
        injections.push(`Available tools for this skill (${skill.name}): ${(skill.definition?.tools || []).join(', ')}`);
      }
    }
    return injections.join('\n\n');
  }

  search(query: string): Skill[] {
    const q = query.toLowerCase();
    return Array.from(this.skills.values()).filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.displayName.toLowerCase().includes(q) ||
      s.description?.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Prefer service-to-service auth (works without any user token)
    if (this.internalSecret) {
      headers['x-request-from'] = 'openagentic-proxy';
      headers['x-internal-secret'] = this.internalSecret;
      return headers;
    }
    // Fallback to user API key if internal secret isn't configured.
    // User API keys use the "oa_" prefix (oa_<base64url>); system/inter-service
    // tokens use "oa_sys_". Route user keys via X-API-Key, everything else
    // (system tokens, bearer JWTs) via Authorization: Bearer.
    if (this.apiKey.startsWith('oa_') && !this.apiKey.startsWith('oa_sys_')) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private mapFromAPI(raw: any): Skill {
    return {
      id: raw.id,
      name: raw.name,
      displayName: raw.display_name || raw.displayName || raw.name,
      description: raw.description,
      type: raw.type,
      definition: raw.definition,
      source: raw.source || 'custom',
      requiredTools: raw.required_tools || raw.requiredTools || [],
      tags: raw.tags || [],
    };
  }
}
