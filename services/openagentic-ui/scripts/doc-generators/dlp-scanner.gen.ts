/**
 * DLP Scanner Documentation Generator
 *
 * Parses DLPScannerService.ts to extract:
 * - All 55 DLP rules from buildDefaultRules()
 * - DLP types: Severity, Action, Category, ScanPoint
 * - Tool exemption schema
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, getLineNumber, regexMatchAll } from './utils.js';

export async function generateDlpScanner(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-api', 'src', 'services', 'DLPScannerService.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: DLP Types ---
  const typeItems: DocItem[] = [];

  // Extract type aliases
  const typePatterns = [
    { name: 'DLPSeverity', pattern: /export type DLPSeverity\s*=\s*(.+);/ },
    { name: 'DLPAction', pattern: /export type DLPAction\s*=\s*(.+);/ },
    { name: 'DLPCategory', pattern: /export type DLPCategory\s*=\s*(.+);/ },
    { name: 'DLPScanPoint', pattern: /export type DLPScanPoint\s*=\s*(.+);/ },
  ];

  for (const { name, pattern } of typePatterns) {
    const match = content.match(pattern);
    if (match) {
      const values = match[1].split('|').map(v => v.trim().replace(/'/g, ''));
      typeItems.push({
        id: `type-${name}`,
        name,
        description: `Union type: ${values.join(', ')}`,
        type: 'type-alias',
        properties: { values },
      });
    }
  }

  sections.push({
    id: 'dlp-types',
    title: 'DLP Types',
    description: 'Core type definitions for the DLP scanning system.',
    adminOnly: false,
    items: typeItems,
  });

  // --- Section 2: Severity-to-Action Mapping ---
  sections.push({
    id: 'severity-actions',
    title: 'Severity-to-Action Mapping',
    description: 'How DLP severity levels map to enforcement actions.',
    adminOnly: false,
    items: [
      { id: 'action-low', name: 'low', description: 'Action: allow — flagged but not blocked', type: 'severity-mapping' },
      { id: 'action-medium', name: 'medium', description: 'Action: redact — sensitive data is masked before forwarding', type: 'severity-mapping' },
      { id: 'action-high', name: 'high', description: 'Action: block — request is rejected entirely', type: 'severity-mapping' },
      { id: 'action-critical', name: 'critical', description: 'Action: block — request is rejected and an alert is raised', type: 'severity-mapping' },
    ],
  });

  // --- Section 3-7: Rules by Category ---
  // Parse all r(...) calls from buildDefaultRules
  const rulePattern = /r\(\s*'(\w+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*\/.*?\/\w*\s*,\s*'(\w+)'/g;
  const allRules: Array<{ category: string; name: string; description: string; severity: string; line: number }> = [];

  for (const match of regexMatchAll(content, rulePattern)) {
    allRules.push({
      category: match[1],
      name: match[2],
      description: match[3],
      severity: match[4],
      line: getLineNumber(content, match.index),
    });
  }

  // Group by category
  const categories = ['credential', 'pii', 'infrastructure', 'compliance', 'injection'];
  const categoryLabels: Record<string, string> = {
    credential: 'Credential Detection Rules',
    pii: 'PII Detection Rules',
    infrastructure: 'Infrastructure Security Rules',
    compliance: 'Compliance Rules',
    injection: 'Injection Detection Rules',
  };
  const categoryDescriptions: Record<string, string> = {
    credential: 'Detects API keys, tokens, passwords, private keys, and other credentials in data flowing through tool execution.',
    pii: 'Detects personally identifiable information: SSNs, credit cards, email addresses, phone numbers, passport numbers, and more.',
    infrastructure: 'Detects internal infrastructure details: private IPs, Kubernetes secrets, SSH connections, Terraform state.',
    compliance: 'Detects data subject to regulatory compliance: HIPAA medical records, PCI card data, FERPA student records, CUI markings.',
    injection: 'Detects prompt injection attempts: system prompt overrides, role confusion, hidden instructions, exfiltration attempts.',
  };

  for (const cat of categories) {
    const catRules = allRules.filter(r => r.category === cat);
    sections.push({
      id: `rules-${cat}`,
      title: categoryLabels[cat] || cat,
      description: `${categoryDescriptions[cat] || ''} (${catRules.length} rules)`,
      adminOnly: true,
      items: catRules.map(r => ({
        id: `rule-${r.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: r.name,
        description: r.description,
        type: 'dlp-rule',
        properties: { severity: r.severity, category: r.category },
        sourceLine: r.line,
        sourceFile: sourceFiles[0],
      })),
    });
  }

  // --- Section 8: Scan Points ---
  sections.push({
    id: 'scan-points',
    title: 'Scan Points',
    description: 'DLP scanning is applied at multiple points in the data flow.',
    adminOnly: false,
    items: [
      { id: 'sp-tool-input', name: 'tool_input', description: 'Scans data sent to MCP tools before execution', type: 'scan-point' },
      { id: 'sp-tool-result', name: 'tool_result', description: 'Scans data returned from MCP tools after execution', type: 'scan-point' },
      { id: 'sp-llm-output', name: 'llm_output', description: 'Scans LLM-generated text before sending to user', type: 'scan-point' },
      { id: 'sp-user-input', name: 'user_input', description: 'Scans user messages for accidental credential exposure', type: 'scan-point' },
      { id: 'sp-workflow', name: 'workflow_data', description: 'Scans data flowing between workflow nodes', type: 'scan-point' },
    ],
  });

  // --- Section 9: Tool Exemptions Schema ---
  const exemptionFields: DocItem[] = [];
  const exemptionBlock = content.match(/export interface DLPToolExemption\s*\{([\s\S]*?)\}/);
  if (exemptionBlock) {
    const fieldPattern = /(\w+):\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(exemptionBlock[1], fieldPattern)) {
      exemptionFields.push({
        id: `exemption-${match[1]}`,
        name: match[1],
        description: match[3]?.trim() || match[2].trim(),
        type: 'interface-field',
        properties: { type: match[2].trim() },
      });
    }
  }

  sections.push({
    id: 'tool-exemptions',
    title: 'Tool Exemptions',
    description: 'Tools can be exempted from specific DLP rule categories at specific scan points.',
    adminOnly: true,
    items: exemptionFields,
  });

  return {
    domain: 'dlp-scanner',
    title: 'DLP Scanner',
    description: `Data Loss Prevention scanner with ${allRules.length} detection rules across ${categories.length} categories, scanning at ${5} points in the data flow.`,
    icon: 'shield',
    category: 'security',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
