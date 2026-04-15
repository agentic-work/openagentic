/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Deployment Documentation Generator
 *
 * Parses helm/openagentic/values.yaml to extract:
 * - Service definitions (image, replicas, ports)
 * - Autoscaling configuration
 * - Resource limits
 * - Ingress configuration
 * - Pod security and disruption budgets
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, helmPath, relativePath } from './utils.js';

interface ServiceDef {
  name: string;
  enabled?: string;
  image?: string;
  tag?: string;
  replicas?: string;
  port?: string;
  serviceType?: string;
  line: number;
  autoscaling: Record<string, string>;
  pdb: Record<string, string>;
  networkPolicy: boolean;
}

export async function generateDeployment(basePath: string): Promise<DocManifest | null> {
  const filePath = helmPath(basePath, 'values.yaml');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];
  const lines = content.split('\n');

  // --- Parse service blocks ---
  // Services are top-level keys that have image: sub-keys
  const services: ServiceDef[] = [];

  // Known service keys in values.yaml
  const serviceKeys = [
    'api', 'ui', 'mcpProxy', 'graph',
    'ollama', 'ollamaCode', 'ollama2', 'redis', 'milvus', 'minio',
  ];

  for (const key of serviceKeys) {
    // Find the top-level key
    const keyPattern = new RegExp(`^${key}:\\s*$`, 'm');
    const keyMatch = content.match(keyPattern);
    if (!keyMatch) continue;

    const startIdx = keyMatch.index!;
    const startLine = content.substring(0, startIdx).split('\n').length;

    // Extract the block until next top-level key or section comment
    const blockEndPattern = /\n[a-zA-Z]/;
    const rest = content.substring(startIdx + keyMatch[0].length);
    const blockEndMatch = rest.match(blockEndPattern);
    const block = blockEndMatch ? rest.substring(0, blockEndMatch.index!) : rest;

    const svc: ServiceDef = {
      name: key,
      line: startLine,
      autoscaling: {},
      pdb: {},
      networkPolicy: false,
    };

    // Extract enabled
    const enabledMatch = block.match(/\n\s+enabled:\s*(\S+)/);
    if (enabledMatch) svc.enabled = enabledMatch[1];

    // Extract image
    const repoMatch = block.match(/\n\s+repository:\s*"?([^"\n]+)"?/);
    if (repoMatch) svc.image = repoMatch[1];

    const tagMatch = block.match(/\n\s+tag:\s*"?([^"\n]+)"?/);
    if (tagMatch) svc.tag = tagMatch[1];

    // Extract replicas
    const replicasMatch = block.match(/\n\s+replicas:\s*(\d+)/);
    if (replicasMatch) svc.replicas = replicasMatch[1];

    // Extract port
    const portMatch = block.match(/\n\s+port:\s*(\d+)/);
    if (portMatch) svc.port = portMatch[1];

    // Extract service type
    const typeMatch = block.match(/\n\s+type:\s*(\S+)/);
    if (typeMatch) svc.serviceType = typeMatch[1];

    // Autoscaling block
    const autoBlock = block.match(/autoscaling:\s*\n((?:\s+\S.*\n)*)/);
    if (autoBlock) {
      const asLines = autoBlock[1].split('\n');
      for (const l of asLines) {
        const kvMatch = l.trim().match(/^(\w[\w-]*):\s*(.+)/);
        if (kvMatch) svc.autoscaling[kvMatch[1]] = kvMatch[2].trim();
      }
    }

    // PDB
    const pdbBlock = block.match(/podDisruptionBudget:\s*\n((?:\s+\S.*\n)*)/);
    if (pdbBlock) {
      const pdbLines = pdbBlock[1].split('\n');
      for (const l of pdbLines) {
        const kvMatch = l.trim().match(/^(\w[\w-]*):\s*(.+)/);
        if (kvMatch) svc.pdb[kvMatch[1]] = kvMatch[2].trim();
      }
    }

    // Network policy
    const npMatch = block.match(/networkPolicy:\s*\n\s+enabled:\s*(\S+)/);
    if (npMatch) svc.networkPolicy = npMatch[1] === 'true';

    services.push(svc);
  }

  // --- Section 1: Service Definitions ---
  sections.push({
    id: 'service-definitions',
    title: 'Service Definitions',
    description: `${services.length} services configured in the Helm chart.`,
    adminOnly: true,
    items: services.map(svc => ({
      id: `svc-${svc.name}`,
      name: svc.name,
      description: [
        svc.image ? `Image: ${svc.image}:${svc.tag || 'latest'}` : 'No image (external dependency)',
        svc.replicas ? `Replicas: ${svc.replicas}` : null,
        svc.port ? `Port: ${svc.port}` : null,
        svc.enabled !== undefined ? `Enabled: ${svc.enabled}` : null,
      ].filter(Boolean).join(' | '),
      type: 'service',
      properties: {
        enabled: svc.enabled,
        image: svc.image,
        tag: svc.tag,
        replicas: svc.replicas ? Number(svc.replicas) : undefined,
        port: svc.port ? Number(svc.port) : undefined,
        serviceType: svc.serviceType,
      },
      sourceLine: svc.line,
      sourceFile: sourceFiles[0],
    })),
  });

  // --- Section 2: Autoscaling ---
  const autoscaledServices = services.filter(s => Object.keys(s.autoscaling).length > 0);
  sections.push({
    id: 'autoscaling',
    title: 'Autoscaling Configuration',
    description: `${autoscaledServices.length} services have autoscaling configuration.`,
    adminOnly: true,
    items: autoscaledServices.map(svc => ({
      id: `autoscale-${svc.name}`,
      name: svc.name,
      description: `Enabled: ${svc.autoscaling.enabled || 'false'}, Min: ${svc.autoscaling.minReplicas || 'N/A'}, Max: ${svc.autoscaling.maxReplicas || 'N/A'}`,
      type: 'autoscaling',
      properties: svc.autoscaling,
    })),
  });

  // --- Section 3: Ingress ---
  const ingressItems: DocItem[] = [];
  const ingressBlock = content.match(/^ingress:\s*\n((?:\s+.*\n)*)/m);
  if (ingressBlock) {
    const ingressLines = ingressBlock[1].split('\n');
    for (const line of ingressLines) {
      const kvMatch = line.trim().match(/^(\w[\w-]*):\s*(.+)/);
      if (kvMatch) {
        ingressItems.push({
          id: `ingress-${kvMatch[1]}`,
          name: kvMatch[1],
          description: kvMatch[2].trim(),
          type: 'ingress-config',
        });
      }
    }
  }

  sections.push({
    id: 'ingress',
    title: 'Ingress Configuration',
    description: 'HTTP ingress configuration for external access.',
    adminOnly: true,
    items: ingressItems,
  });

  // --- Section 4: Pod Disruption Budgets ---
  const pdbServices = services.filter(s => Object.keys(s.pdb).length > 0);
  sections.push({
    id: 'pod-disruption-budgets',
    title: 'Pod Disruption Budgets',
    description: `${pdbServices.length} services have PodDisruptionBudget configuration.`,
    adminOnly: true,
    items: pdbServices.map(svc => ({
      id: `pdb-${svc.name}`,
      name: svc.name,
      description: `Enabled: ${svc.pdb.enabled || 'false'}, MaxUnavailable: ${svc.pdb.maxUnavailable || 'N/A'}`,
      type: 'pdb',
      properties: svc.pdb,
    })),
  });

  return {
    domain: 'deployment',
    title: 'Deployment Configuration',
    description: `Helm chart with ${services.length} services, autoscaling, ingress, and pod disruption budgets.`,
    icon: 'infra',
    category: 'infrastructure',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
