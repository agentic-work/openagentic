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
 * Helm Chart Templates Documentation Generator
 *
 * Scans helm/openagentic/templates/ for all YAML template files.
 * Extracts Kubernetes resource definitions grouped by subdirectory:
 * - Deployments, Services, ConfigMaps, NetworkPolicies
 * - Ingress/HTTPRoute, CronJobs/Jobs
 * - ServiceAccounts, Secrets, PVCs, and other resource types
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, helmPath, relativePath, regexMatchAll, getLineNumber, findFiles } from './utils.js';
import { basename, dirname, relative } from 'path';

interface K8sResource {
  kind: string;
  name: string;
  file: string;
  line: number;
  properties: Record<string, unknown>;
}

function extractResources(content: string, relPath: string): K8sResource[] {
  const resources: K8sResource[] = [];

  // Split on YAML document separators to handle multi-resource files
  const documents = content.split(/^---\s*$/m);

  for (const doc of documents) {
    const kindMatch = doc.match(/kind:\s*(\S+)/);
    if (!kindMatch) continue;

    const kind = kindMatch[1];
    const line = getLineNumber(content, content.indexOf(doc) + (kindMatch.index || 0));

    // Extract name (often a Helm template expression)
    const nameMatch = doc.match(/metadata:\s*\n\s+name:\s*(.+)/);
    const rawName = nameMatch ? nameMatch[1].trim() : 'unknown';
    // Simplify Helm template names
    const name = rawName
      .replace(/\{\{\s*include\s+"[^"]*\.fullname"\s+\.\s*\}\}/g, '{{ .fullname }}')
      .replace(/\{\{-?\s*/g, '{{ ')
      .replace(/\s*-?\}\}/g, ' }}');

    const props: Record<string, unknown> = { kind };

    // Kind-specific extraction
    switch (kind) {
      case 'Deployment':
      case 'StatefulSet':
      case 'DaemonSet': {
        // Extract container images
        const images: string[] = [];
        const imagePattern = /image:\s*(.+)/g;
        for (const im of regexMatchAll(doc, imagePattern)) {
          images.push(im[1].trim().replace(/["']/g, ''));
        }
        if (images.length > 0) props.images = images;

        // Extract replicas
        const replicaMatch = doc.match(/replicas:\s*(.+)/);
        if (replicaMatch) props.replicas = replicaMatch[1].trim();
        break;
      }

      case 'Service': {
        // Extract ports
        const ports: Array<{ port: string; targetPort: string; name?: string }> = [];
        const portBlockPattern = /- port:\s*(\S+)[\s\S]*?targetPort:\s*(\S+)(?:[\s\S]*?name:\s*(\S+))?/g;
        for (const pm of regexMatchAll(doc, portBlockPattern)) {
          ports.push({
            port: pm[1],
            targetPort: pm[2],
            name: pm[3] || undefined,
          });
        }
        if (ports.length > 0) props.ports = ports;

        // Extract service type
        const typeMatch = doc.match(/type:\s*(\S+)/);
        if (typeMatch) props.serviceType = typeMatch[1];
        break;
      }

      case 'ConfigMap': {
        // Extract data keys
        const dataMatch = doc.match(/data:\s*\n((?:\s+\S.*\n)*)/);
        if (dataMatch) {
          const keys = [...dataMatch[1].matchAll(/^\s+(\S+?):/gm)].map(m => m[1]);
          if (keys.length > 0) props.dataKeys = keys;
        }
        break;
      }

      case 'NetworkPolicy': {
        // Extract podSelector
        const selectorMatch = doc.match(/podSelector:\s*\n\s+matchLabels:\s*\n((?:\s+\S.*\n)*)/);
        if (selectorMatch) {
          const labels: Record<string, string> = {};
          for (const lm of selectorMatch[1].matchAll(/^\s+(\S+):\s*(.+)/gm)) {
            labels[lm[1]] = lm[2].trim();
          }
          props.podSelector = labels;
        }
        break;
      }

      case 'Ingress':
      case 'HTTPRoute': {
        // Extract hosts
        const hosts: string[] = [];
        const hostPattern = /host:\s*(.+)/g;
        for (const hm of regexMatchAll(doc, hostPattern)) {
          hosts.push(hm[1].trim());
        }
        if (hosts.length > 0) props.hosts = hosts;
        break;
      }

      case 'CronJob': {
        const scheduleMatch = doc.match(/schedule:\s*["']?([^"'\n]+)["']?/);
        if (scheduleMatch) props.schedule = scheduleMatch[1].trim();
        break;
      }

      case 'PersistentVolumeClaim': {
        const storageMatch = doc.match(/storage:\s*(\S+)/);
        if (storageMatch) props.storage = storageMatch[1];
        break;
      }
    }

    resources.push({ kind, name, file: relPath, line, properties: props });
  }

  return resources;
}

function subdirDisplayName(subdir: string): string {
  if (subdir === '.') return 'Root Templates';
  return subdir
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function resourceTypeLabel(kind: string): string {
  const labels: Record<string, string> = {
    Deployment: 'deployment',
    Service: 'service',
    ConfigMap: 'configmap',
    Secret: 'secret',
    NetworkPolicy: 'network-policy',
    Ingress: 'ingress',
    HTTPRoute: 'httproute',
    CronJob: 'cronjob',
    Job: 'job',
    StatefulSet: 'statefulset',
    DaemonSet: 'daemonset',
    ServiceAccount: 'service-account',
    PersistentVolumeClaim: 'pvc',
    HorizontalPodAutoscaler: 'hpa',
    PodDisruptionBudget: 'pdb',
    Role: 'role',
    RoleBinding: 'role-binding',
    ClusterRole: 'cluster-role',
    ClusterRoleBinding: 'cluster-role-binding',
  };
  return labels[kind] || kind.toLowerCase();
}

export async function generateHelmTemplates(basePath: string): Promise<DocManifest | null> {
  const templatesDir = helmPath(basePath, 'templates');
  const yamlFiles = await findFiles(templatesDir, /\.yaml$/);

  if (yamlFiles.length === 0) return null;

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];

  // Group resources by subdirectory
  const subdirResources = new Map<string, K8sResource[]>();

  for (const filePath of yamlFiles.sort()) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;

    const relPath = relativePath(filePath, basePath);
    sourceFiles.push(relPath);

    // Determine subdirectory relative to templates/
    const relToTemplates = relative(templatesDir, filePath);
    const parts = relToTemplates.split('/');
    const subdir = parts.length > 1 ? parts[0] : '.';

    const resources = extractResources(content, relPath);
    if (resources.length === 0) continue;

    const existing = subdirResources.get(subdir) || [];
    existing.push(...resources);
    subdirResources.set(subdir, existing);
  }

  // Sort subdirectories: root first, then alphabetical
  const sortedSubdirs = [...subdirResources.keys()].sort((a, b) => {
    if (a === '.') return -1;
    if (b === '.') return 1;
    return a.localeCompare(b);
  });

  let totalResources = 0;

  for (const subdir of sortedSubdirs) {
    const resources = subdirResources.get(subdir)!;
    totalResources += resources.length;

    // Count by kind
    const kindCounts = new Map<string, number>();
    for (const r of resources) {
      kindCounts.set(r.kind, (kindCounts.get(r.kind) || 0) + 1);
    }
    const kindSummary = [...kindCounts.entries()]
      .map(([k, c]) => `${c} ${k}${c > 1 ? 's' : ''}`)
      .join(', ');

    sections.push({
      id: `helm-${subdir === '.' ? 'root' : subdir}`,
      title: subdirDisplayName(subdir),
      description: `${resources.length} Kubernetes resources: ${kindSummary}.`,
      adminOnly: true,
      items: resources.map(r => ({
        id: `helm-${subdir === '.' ? 'root' : subdir}-${resourceTypeLabel(r.kind)}-${r.name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 60)}`,
        name: `${r.kind}: ${r.name}`,
        description: describeResource(r),
        type: resourceTypeLabel(r.kind),
        properties: r.properties,
        sourceFile: r.file,
        sourceLine: r.line,
      })),
    });
  }

  return {
    domain: 'helm-templates',
    title: 'Helm Chart Templates',
    description: `${totalResources} Kubernetes resources across ${sortedSubdirs.length} template groups in the OpenAgentic Helm chart.`,
    icon: 'infra',
    category: 'infrastructure',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}

function describeResource(r: K8sResource): string {
  const parts: string[] = [];

  switch (r.kind) {
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet': {
      const images = r.properties.images as string[] | undefined;
      if (images && images.length > 0) parts.push(`Image: ${images[0]}`);
      if (r.properties.replicas) parts.push(`Replicas: ${r.properties.replicas}`);
      break;
    }
    case 'Service': {
      const ports = r.properties.ports as Array<{ port: string }> | undefined;
      if (ports) parts.push(`Ports: ${ports.map(p => p.port).join(', ')}`);
      if (r.properties.serviceType) parts.push(`Type: ${r.properties.serviceType}`);
      break;
    }
    case 'ConfigMap': {
      const keys = r.properties.dataKeys as string[] | undefined;
      if (keys) parts.push(`Keys: ${keys.join(', ')}`);
      break;
    }
    case 'NetworkPolicy': {
      const sel = r.properties.podSelector as Record<string, string> | undefined;
      if (sel) parts.push(`Selector: ${Object.entries(sel).map(([k, v]) => `${k}=${v}`).join(', ')}`);
      break;
    }
    case 'CronJob':
      if (r.properties.schedule) parts.push(`Schedule: ${r.properties.schedule}`);
      break;
    case 'PersistentVolumeClaim':
      if (r.properties.storage) parts.push(`Storage: ${r.properties.storage}`);
      break;
    case 'Ingress':
    case 'HTTPRoute': {
      const hosts = r.properties.hosts as string[] | undefined;
      if (hosts) parts.push(`Hosts: ${hosts.join(', ')}`);
      break;
    }
  }

  return parts.length > 0 ? parts.join(' | ') : `${r.kind} resource`;
}
