/**
 * Synth Documentation Generator
 *
 * Parses SynthService.ts to extract:
 * - SynthConfig interface fields (visibility, model, execution, rate limits, approval, capabilities)
 * - SynthRequest and SynthResult interfaces
 * - Synthesis flow and approval workflow
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, regexMatchAll, getLineNumber } from './utils.js';

export async function generateSynthTools(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-api', 'src', 'services', 'SynthService.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: SynthConfig Interface (grouped by section comments) ---
  const configBlock = content.match(/export interface SynthConfig\s*\{([\s\S]*?)\n\}/);
  if (configBlock) {
    const configBody = configBlock[1];

    // Split by section headers (// ===...=== lines followed by // SECTION_NAME)
    const sectionPattern = /\/\/\s*={3,}\s*\n\s*\/\/\s*([A-Z &]+)\s*\n\s*\/\/\s*={3,}([\s\S]*?)(?=\/\/\s*={3,}|$)/g;
    let sectionIndex = 0;

    for (const match of regexMatchAll(configBody, sectionPattern)) {
      const sectionTitle = match[1].trim();
      const sectionBody = match[2];
      const sectionId = sectionTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      sectionIndex++;

      const fieldItems: DocItem[] = [];
      // Extract fields with JSDoc comments
      const fieldPattern = /(?:\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?(\w+)(\?)?:\s*([^;]+);/g;
      for (const fm of regexMatchAll(sectionBody, fieldPattern)) {
        const jsdoc = fm[1]?.replace(/\s*\*\s*/g, ' ').trim() || '';
        const fieldName = fm[2];
        const fieldType = fm[4].trim();
        fieldItems.push({
          id: `config-${fieldName}`,
          name: fieldName,
          description: jsdoc || `${fieldType} setting`,
          type: 'config-field',
          properties: { type: fieldType, optional: !!fm[3] },
        });
      }

      if (fieldItems.length > 0) {
        sections.push({
          id: `synth-config-${sectionId}`,
          title: `Synth Config: ${sectionTitle.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')}`,
          description: `SynthConfig fields for ${sectionTitle.toLowerCase()}.`,
          adminOnly: true,
          items: fieldItems,
        });
      }
    }
  }

  // --- Section 2: SynthRequest Interface ---
  const requestFields: DocItem[] = [];
  const requestBlock = content.match(/export interface SynthRequest\s*\{([\s\S]*?)\n\}/);
  if (requestBlock) {
    const fieldPattern = /(?:\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?(\w+)(\?)?:\s*([^;{]+(?:\{[\s\S]*?\})?);/g;
    for (const match of regexMatchAll(requestBlock[1], fieldPattern)) {
      const jsdoc = match[1]?.replace(/\s*\*\s*/g, ' ').trim() || '';
      requestFields.push({
        id: `request-${match[2]}`,
        name: match[2],
        description: jsdoc || `${match[4].trim().substring(0, 80)}`,
        type: 'interface-field',
        properties: { type: match[4].trim().substring(0, 80), optional: !!match[3] },
      });
    }
  }

  if (requestFields.length > 0) {
    sections.push({
      id: 'synth-request',
      title: 'Synth Request',
      description: 'The SynthRequest interface for triggering tool synthesis.',
      adminOnly: false,
      items: requestFields,
    });
  }

  // --- Section 3: SynthResult Interface ---
  const resultFields: DocItem[] = [];
  const resultBlock = content.match(/export interface SynthResult\s*\{([\s\S]*?)\n\}/);
  if (resultBlock) {
    const fieldPattern = /(?:\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?(\w+)(\?)?:\s*([^;{]+(?:\{[\s\S]*?\})?);/g;
    for (const match of regexMatchAll(resultBlock[1], fieldPattern)) {
      const jsdoc = match[1]?.replace(/\s*\*\s*/g, ' ').trim() || '';
      resultFields.push({
        id: `result-${match[2]}`,
        name: match[2],
        description: jsdoc || `${match[4].trim().substring(0, 80)}`,
        type: 'interface-field',
        properties: { type: match[4].trim().substring(0, 80), optional: !!match[3] },
      });
    }
  }

  if (resultFields.length > 0) {
    sections.push({
      id: 'synth-result',
      title: 'Synth Result',
      description: 'The SynthResult interface returned after synthesis and optional execution.',
      adminOnly: false,
      items: resultFields,
    });
  }

  // --- Section 4: Risk Levels ---
  const riskLevels: DocItem[] = [];
  const riskMatch = content.match(/riskLevel:\s*([^;]+);/);
  if (riskMatch) {
    const levels = riskMatch[1].match(/'([^']+)'/g);
    if (levels) {
      const riskDescriptions: Record<string, string> = {
        'low': 'Read-only data processing, no side effects',
        'medium': 'Writes to local resources, limited scope',
        'high': 'Network access, cloud API calls, credential usage',
        'critical': 'Destructive operations, privilege escalation risk',
      };
      for (const l of levels) {
        const level = l.replace(/'/g, '');
        riskLevels.push({
          id: `risk-${level}`,
          name: level,
          description: riskDescriptions[level] || `Risk level: ${level}`,
          type: 'risk-level',
        });
      }
    }
  }

  if (riskLevels.length > 0) {
    sections.push({
      id: 'risk-levels',
      title: 'Risk Levels',
      description: 'Synthesized tools are classified by risk level, which determines the approval workflow.',
      adminOnly: false,
      items: riskLevels,
    });
  }

  // --- Section 5: Credential Sources ---
  const credItems: DocItem[] = [];
  const credMatch = content.match(/credentialSource\?:\s*([^;]+);/);
  if (credMatch) {
    const sources = credMatch[1].match(/'([^']+)'/g);
    if (sources) {
      const credDescriptions: Record<string, string> = {
        'sso_only': 'Use only SSO-derived credentials (Azure AD, Google)',
        'linked_accounts': 'Use credentials from linked cloud accounts',
        'none': 'No credential injection — synthesized tools run without cloud access',
      };
      for (const s of sources) {
        const source = s.replace(/'/g, '');
        credItems.push({
          id: `cred-${source}`,
          name: source,
          description: credDescriptions[source] || `Credential source: ${source}`,
          type: 'credential-source',
        });
      }
    }
  }

  if (credItems.length > 0) {
    sections.push({
      id: 'credential-sources',
      title: 'Credential Sources',
      description: 'How synthesized tools obtain cloud credentials for execution.',
      adminOnly: true,
      items: credItems,
    });
  }

  return {
    domain: 'synth-tools',
    title: 'Synth',
    description: 'Dynamic tool synthesis framework: natural language intent to synthesized tool with human-in-the-loop approval, risk classification, and user credential injection.',
    icon: 'tool',
    category: 'tools',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
