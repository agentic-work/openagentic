/**
 * Authentication Documentation Generator
 *
 * Parses tokenValidator.ts to extract:
 * - AUTH_PROVIDER options (azure-ad, google, hybrid, etc.)
 * - Token types (local, azure-ad, google, api-key)
 * - UnifiedTokenResult interface
 * - Authentication flow methods
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, regexMatchAll, getLineNumber } from './utils.js';

export async function generateAuthentication(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-api', 'src', 'auth', 'tokenValidator.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: Auth Providers ---
  const providerItems: DocItem[] = [];

  // Extract AUTH_PROVIDER default
  const defaultProviderMatch = content.match(/AUTH_PROVIDER\s*=\s*process\.env\.AUTH_PROVIDER\s*\|\|\s*'([^']+)'/);
  const defaultProvider = defaultProviderMatch?.[1] || 'azure-ad';

  // Extract Azure AD provider list
  const azureListMatch = content.match(/\[([^\]]*)\]\.includes\(AUTH_PROVIDER\)\s*\?\s*new AzureADAuthService/);
  if (azureListMatch) {
    const providers = azureListMatch[1].match(/'([^']+)'/g);
    if (providers) {
      for (const p of providers) {
        const name = p.replace(/'/g, '');
        providerItems.push({
          id: `auth-provider-azure-${name}`,
          name,
          description: `Enables Azure AD authentication (AUTH_PROVIDER=${name})`,
          type: 'auth-provider',
          properties: { enablesAzureAD: true, isDefault: name === defaultProvider },
        });
      }
    }
  }

  // Extract Google provider list
  const googleListMatch = content.match(/\[([^\]]*)\]\.includes\(AUTH_PROVIDER\)\s*\?\s*getGoogleAuthService/);
  if (googleListMatch) {
    const providers = googleListMatch[1].match(/'([^']+)'/g);
    if (providers) {
      for (const p of providers) {
        const name = p.replace(/'/g, '');
        // Only add if not already present
        if (!providerItems.find(item => item.name === name)) {
          providerItems.push({
            id: `auth-provider-google-${name}`,
            name,
            description: `Enables Google authentication (AUTH_PROVIDER=${name})`,
            type: 'auth-provider',
            properties: { enablesGoogle: true, isDefault: name === defaultProvider },
          });
        } else {
          // Update existing entry
          const existing = providerItems.find(item => item.name === name);
          if (existing) {
            existing.properties = { ...existing.properties, enablesGoogle: true };
            existing.description = `Enables both Azure AD and Google authentication (AUTH_PROVIDER=${name})`;
          }
        }
      }
    }
  }

  sections.push({
    id: 'auth-providers',
    title: 'Authentication Providers',
    description: `Supported AUTH_PROVIDER values that control which identity providers are active. Default: "${defaultProvider}".`,
    adminOnly: false,
    items: providerItems,
  });

  // --- Section 2: Token Types ---
  const tokenTypes: DocItem[] = [];
  const tokenTypeMatch = content.match(/tokenType\?:\s*([^;]+);/);
  if (tokenTypeMatch) {
    const types = tokenTypeMatch[1].match(/'([^']+)'/g);
    if (types) {
      const descriptions: Record<string, string> = {
        'local': 'Platform-issued JWT with userId claim',
        'azure-ad': 'Microsoft Azure AD token with tid and oid claims',
        'google': 'Google token with accounts.google.com issuer',
        'api-key': 'API key with awc_ prefix (awc_ followed by 64 hex chars)',
      };
      for (const t of types) {
        const typeName = t.replace(/'/g, '');
        tokenTypes.push({
          id: `token-${typeName}`,
          name: typeName,
          description: descriptions[typeName] || `Token type: ${typeName}`,
          type: 'token-type',
        });
      }
    }
  }

  sections.push({
    id: 'token-types',
    title: 'Token Types',
    description: 'The unified token validator detects and validates multiple token formats.',
    adminOnly: false,
    items: tokenTypes,
  });

  // --- Section 3: UnifiedTokenResult Interface ---
  const resultFields: DocItem[] = [];
  const resultBlock = content.match(/export interface UnifiedTokenResult\s*\{([\s\S]*?)\}/);
  if (resultBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(resultBlock[1], fieldPattern)) {
      resultFields.push({
        id: `result-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || `${match[3].trim()} field`,
        type: 'interface-field',
        properties: { type: match[3].trim(), optional: !!match[2] },
      });
    }
  }

  sections.push({
    id: 'token-result',
    title: 'Token Validation Result',
    description: 'The UnifiedTokenResult interface returned by validateAnyToken().',
    adminOnly: false,
    items: resultFields,
  });

  // --- Section 4: Exported Functions ---
  const exportedFns: DocItem[] = [];
  const fnPattern = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  for (const match of regexMatchAll(content, fnPattern)) {
    exportedFns.push({
      id: `fn-${match[1]}`,
      name: match[1],
      description: `Exported auth function`,
      type: 'function',
      properties: { signature: `${match[1]}(${match[2].substring(0, 80)})` },
      sourceLine: getLineNumber(content, match.index),
      sourceFile: sourceFiles[0],
    });
  }

  // Also get exported const functions
  const constFnPattern = /export\s+const\s+(\w+)\s*=\s*\(/g;
  for (const match of regexMatchAll(content, constFnPattern)) {
    exportedFns.push({
      id: `fn-${match[1]}`,
      name: match[1],
      description: `Exported auth helper`,
      type: 'function',
      sourceLine: getLineNumber(content, match.index),
      sourceFile: sourceFiles[0],
    });
  }

  sections.push({
    id: 'auth-functions',
    title: 'Auth Functions',
    description: 'Exported functions from the unified token validator.',
    adminOnly: false,
    items: exportedFns,
  });

  return {
    domain: 'authentication',
    title: 'Authentication',
    description: `Unified token validation supporting ${tokenTypes.length} token types across ${providerItems.length} auth provider configurations.`,
    icon: 'shield',
    category: 'core',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
