/**
 * Developer API Documentation View
 *
 * Embeds Swagger UI for API documentation within the Admin Portal
 * Fetches OpenAPI spec from /api/openapi.json and renders interactive docs
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
// Basic UI icons from lucide
import {
  Book, ExternalLink, Copy, Check, Code, File, Search,
  ChevronDown, ChevronRight, Tag, Terminal
} from '@/shared/icons';
// Custom badass OpenAgentic icons
import { RefreshCw, Loader2, AlertCircle, Server, Lock } from '../Shared/AdminIcons';
import { apiRequest } from '@/utils/api';

interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
    contact?: { name?: string; email?: string };
    license?: { name: string; url?: string };
  };
  servers?: Array<{ url: string; description: string }>;
  tags?: Array<{ name: string; description: string }>;
  paths: Record<string, Record<string, PathOperation>>;
  components?: {
    schemas?: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
}

interface PathOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: any;
  }>;
  requestBody?: {
    content?: Record<string, { schema?: any }>;
    required?: boolean;
    description?: string;
  };
  responses?: Record<string, {
    description?: string;
    content?: Record<string, { schema?: any }>;
  }>;
  security?: Array<Record<string, string[]>>;
}

interface DeveloperAPIViewProps {
  theme: string;
}

// Method color mapping
const methodColors: Record<string, { bg: string; text: string }> = {
  get: { bg: 'bg-primary-500/20', text: 'text-primary-500' },
  post: { bg: 'bg-success-500/20', text: 'ap-text-success' },
  put: { bg: 'bg-warning-500/20', text: 'ap-text-warning' },
  patch: { bg: 'bg-warning-500/20', text: 'ap-text-warning' },
  delete: { bg: 'bg-error-500/20', text: 'ap-text-error' },
};

export const DeveloperAPIView: React.FC<DeveloperAPIViewProps> = ({ theme }) => {
  const [spec, setSpec] = useState<OpenAPISpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
  const [selectedEndpoint, setSelectedEndpoint] = useState<{ path: string; method: string } | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'endpoints' | 'schemas' | 'raw'>('endpoints');
  const [activeTab, setActiveTab] = useState<'overview' | 'quickstart' | 'endpoints' | 'schemas' | 'auth' | 'sdk' | 'openagentic'>('overview');

  // Load OpenAPI spec
  const loadSpec = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiRequest('/openapi.json');

      if (!response.ok) {
        throw new Error(`Failed to load API spec: ${response.status}`);
      }

      const data = await response.json();
      setSpec(data);
    } catch (err: any) {
      console.error('Failed to load OpenAPI spec:', err);
      setError(err.message || 'Failed to load API documentation');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSpec();
  }, [loadSpec]);

  // Toggle path expansion
  const togglePath = (pathKey: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  };

  // Toggle tag expansion
  const toggleTag = (tag: string) => {
    setExpandedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  // Copy path to clipboard
  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Group endpoints by tag
  const getEndpointsByTag = () => {
    if (!spec?.paths) return {};

    const byTag: Record<string, Array<{ path: string; method: string; operation: PathOperation }>> = {};

    try {
      Object.entries(spec.paths).forEach(([path, methods]) => {
        // Skip if methods is not an object (e.g., $ref, null, undefined)
        if (!methods || typeof methods !== 'object') return;

        Object.entries(methods).forEach(([method, operation]) => {
          // Skip non-HTTP methods and non-object operations
          if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method.toLowerCase())) return;
          if (typeof operation !== 'object' || operation === null) return;

          const tags = (operation as PathOperation).tags || ['Untagged'];
          tags.forEach(tag => {
            if (!byTag[tag]) byTag[tag] = [];
            byTag[tag].push({ path, method, operation: operation as PathOperation });
          });
        });
      });
    } catch (err) {
      console.error('[DeveloperAPIView] Error parsing paths:', err);
    }

    return byTag;
  };

  // Filter endpoints by search
  const filterEndpoints = (endpoints: ReturnType<typeof getEndpointsByTag>) => {
    if (!searchQuery) return endpoints;

    const query = searchQuery.toLowerCase();
    const filtered: typeof endpoints = {};

    Object.entries(endpoints).forEach(([tag, ops]) => {
      const matchingOps = ops.filter(({ path, method, operation }) =>
        path.toLowerCase().includes(query) ||
        method.toLowerCase().includes(query) ||
        operation.summary?.toLowerCase().includes(query) ||
        operation.description?.toLowerCase().includes(query)
      );
      if (matchingOps.length > 0) {
        filtered[tag] = matchingOps;
      }
    });

    return filtered;
  };

  // Open Swagger UI in new tab
  const openSwaggerUI = () => {
    window.open('/api/swagger', '_blank');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--color-accent)' }} />
        <span className="ml-3" style={{ color: 'var(--color-textSecondary)' }}>Loading API documentation...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <AlertCircle className="w-12 h-12 mb-4" style={{ color: 'var(--color-error)' }} />
        <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
          Failed to Load API Documentation
        </h3>
        <p className="text-center mb-4" style={{ color: 'var(--color-textSecondary)' }}>{error}</p>
        <button
          onClick={loadSpec}
          className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors"
          style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!spec) return null;

  const endpointsByTag = getEndpointsByTag();
  const filteredEndpoints = filterEndpoints(endpointsByTag);
  const totalEndpoints = Object.values(spec.paths || {}).reduce(
    (sum, methods) => {
      if (!methods || typeof methods !== 'object') return sum;
      // Only count actual HTTP methods
      const httpMethods = Object.keys(methods).filter(m =>
        ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(m.toLowerCase())
      );
      return sum + httpMethods.length;
    },
    0
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <Book className="w-6 h-6" style={{ color: 'var(--color-accent)' }} />
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              {spec.info.title}
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>
              Version {spec.info.version} • {totalEndpoints} endpoints
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openSwaggerUI}
            className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:bg-primary-500/20"
            style={{ color: 'var(--color-info)' }}
            title="Open full Swagger UI in new tab"
          >
            <ExternalLink className="w-4 h-4" />
            <span className="text-sm">Full Swagger UI</span>
          </button>
          <button
            onClick={loadSpec}
            className="p-2 rounded-lg transition-colors hover:bg-[color-mix(in_srgb,var(--color-fg)_10%,transparent)]"
            style={{ color: 'var(--color-text)' }}
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center gap-1 px-6 py-2 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {(['overview', 'quickstart', 'endpoints', 'schemas', 'auth', 'sdk', 'openagentic'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-primary-500/20 text-primary-500' : 'hover:bg-[color-mix(in_srgb,var(--color-fg)_5%,transparent)]'
            }`}
            style={{ color: activeTab === tab ? 'var(--color-info)' : 'var(--color-textSecondary)' }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'overview' && (
          <div className="space-y-6 max-w-4xl">
            {/* Description */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                About This API
              </h3>
              <div
                className="prose prose-invert max-w-none text-sm whitespace-pre-wrap"
                style={{ color: 'var(--color-textSecondary)' }}
              >
                {spec.info.description}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div
                className="p-4 rounded-lg text-center"
                style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
              >
                <Server className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-info)' }} />
                <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
                  {totalEndpoints}
                </div>
                <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>Endpoints</div>
              </div>
              <div
                className="p-4 rounded-lg text-center"
                style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
              >
                <Tag className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-success)' }} />
                <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
                  {(spec.tags || []).length}
                </div>
                <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>Tags</div>
              </div>
              <div
                className="p-4 rounded-lg text-center"
                style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
              >
                <Code className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-warning)' }} />
                <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
                  {Object.keys(spec.components?.schemas || {}).length}
                </div>
                <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>Schemas</div>
              </div>
              <div
                className="p-4 rounded-lg text-center"
                style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
              >
                <Lock className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--color-accent)' }} />
                <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
                  {Object.keys(spec.components?.securitySchemes || {}).length}
                </div>
                <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>Auth Methods</div>
              </div>
            </div>

            {/* Tags */}
            {spec.tags && spec.tags.length > 0 && (
              <div
                className="p-6 rounded-lg"
                style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
              >
                <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                  API Categories
                </h3>
                <div className="grid gap-3">
                  {spec.tags.map(tag => (
                    <div
                      key={tag.name}
                      className="flex items-start gap-3 p-3 rounded-lg"
                      style={{ backgroundColor: 'var(--color-surface)' }}
                    >
                      <Tag className="w-5 h-5 mt-0.5" style={{ color: 'var(--color-accent)' }} />
                      <div>
                        <div className="font-medium" style={{ color: 'var(--color-text)' }}>
                          {tag.name}
                        </div>
                        {tag.description && (
                          <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                            {tag.description}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'endpoints' && (
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5"
                style={{ color: 'var(--color-textSecondary)' }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search endpoints..."
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-transparent border outline-none"
                style={{
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              />
            </div>

            {/* Endpoints by tag */}
            {Object.entries(filteredEndpoints).map(([tag, endpoints]) => (
              <div key={tag} className="rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}>
                <button
                  onClick={() => toggleTag(tag)}
                  className="w-full flex items-center justify-between p-4 hover:bg-[color-mix(in_srgb,var(--color-fg)_5%,transparent)] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {expandedTags.has(tag) ? (
                      <ChevronDown className="w-5 h-5" style={{ color: 'var(--color-textSecondary)' }} />
                    ) : (
                      <ChevronRight className="w-5 h-5" style={{ color: 'var(--color-textSecondary)' }} />
                    )}
                    <Tag className="w-5 h-5" style={{ color: 'var(--color-accent)' }} />
                    <span className="font-medium" style={{ color: 'var(--color-text)' }}>{tag}</span>
                    <span
                      className="px-2 py-0.5 rounded-full text-xs"
                      style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-textSecondary)' }}
                    >
                      {endpoints.length}
                    </span>
                  </div>
                </button>

                {expandedTags.has(tag) && (
                  <div className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    {endpoints.map(({ path, method, operation }) => {
                      const pathKey = `${method}-${path}`;
                      const colors = methodColors[method] || methodColors.get;
                      const isExpanded = expandedPaths.has(pathKey);

                      return (
                        <div key={pathKey} className="border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                          <button
                            onClick={() => togglePath(pathKey)}
                            className="w-full flex items-center gap-3 p-4 hover:bg-[color-mix(in_srgb,var(--color-fg)_5%,transparent)] transition-colors text-left"
                          >
                            <span
                              className={`px-2 py-1 rounded text-xs font-mono font-bold uppercase ${colors.bg} ${colors.text}`}
                            >
                              {method}
                            </span>
                            <code className="flex-1 font-mono text-sm" style={{ color: 'var(--color-text)' }}>
                              {path}
                            </code>
                            {operation.summary && (
                              <span className="text-sm truncate max-w-xs" style={{ color: 'var(--color-textSecondary)' }}>
                                {operation.summary}
                              </span>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); copyPath(path); }}
                              className="p-1 rounded hover:bg-[color-mix(in_srgb,var(--color-fg)_10%,transparent)]"
                              title="Copy path"
                            >
                              {copiedPath === path ? (
                                <Check className="w-4 h-4 ap-text-success" />
                              ) : (
                                <Copy className="w-4 h-4" style={{ color: 'var(--color-textSecondary)' }} />
                              )}
                            </button>
                          </button>

                          {isExpanded && (
                            <div className="px-4 pb-4 space-y-4" style={{ backgroundColor: 'var(--color-surface)' }}>
                              {operation.description && (
                                <p className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                                  {operation.description}
                                </p>
                              )}

                              {/* Parameters */}
                              {operation.parameters && operation.parameters.length > 0 && (
                                <div>
                                  <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                                    Parameters
                                  </h4>
                                  <div className="space-y-2">
                                    {operation.parameters.map((param, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-start gap-3 p-2 rounded"
                                        style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
                                      >
                                        <code className="text-sm font-mono" style={{ color: 'var(--color-info)' }}>
                                          {param.name}
                                        </code>
                                        <span
                                          className="px-2 py-0.5 rounded text-xs"
                                          style={{ backgroundColor: 'var(--color-border)', color: 'var(--color-textSecondary)' }}
                                        >
                                          {param.in}
                                        </span>
                                        {param.required && (
                                          <span className="text-xs ap-text-error">required</span>
                                        )}
                                        {param.description && (
                                          <span className="text-sm flex-1" style={{ color: 'var(--color-textSecondary)' }}>
                                            {param.description}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Request Body */}
                              {operation.requestBody && (
                                <div>
                                  <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                                    Request Body
                                    {operation.requestBody.required && (
                                      <span className="ml-2 text-xs ap-text-error">required</span>
                                    )}
                                  </h4>
                                  {operation.requestBody.description && (
                                    <p className="text-sm mb-2" style={{ color: 'var(--color-textSecondary)' }}>
                                      {operation.requestBody.description}
                                    </p>
                                  )}
                                  {operation.requestBody.content?.['application/json']?.schema && (
                                    <pre
                                      className="p-3 rounded text-xs overflow-auto"
                                      style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }}
                                    >
                                      {JSON.stringify(operation.requestBody.content['application/json'].schema, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              )}

                              {/* Responses */}
                              {operation.responses && (
                                <div>
                                  <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                                    Responses
                                  </h4>
                                  <div className="space-y-2">
                                    {Object.entries(operation.responses).map(([code, response]) => (
                                      <div
                                        key={code}
                                        className="p-2 rounded"
                                        style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
                                      >
                                        <div className="flex items-center gap-2 mb-1">
                                          <span
                                            className={`px-2 py-0.5 rounded text-xs font-mono ${
                                              code.startsWith('2') ? 'bg-success-500/20 ap-text-success' :
                                              code.startsWith('4') ? 'bg-warning-500/20 ap-text-warning' :
                                              code.startsWith('5') ? 'bg-error-500/20 ap-text-error' :
                                              'bg-surface-secondary/20 text-text-secondary'
                                            }`}
                                          >
                                            {code}
                                          </span>
                                          <span className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                                            {response.description}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {Object.keys(filteredEndpoints).length === 0 && (
              <div className="text-center py-12">
                <Search className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--color-textSecondary)' }} />
                <p style={{ color: 'var(--color-textSecondary)' }}>
                  No endpoints found matching "{searchQuery}"
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'schemas' && (
          <div className="space-y-4">
            {spec.components?.schemas && Object.entries(spec.components.schemas).map(([name, schema]) => (
              <div
                key={name}
                className="rounded-lg overflow-hidden"
                style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
              >
                <div className="flex items-center gap-3 p-4">
                  <File className="w-5 h-5" style={{ color: 'var(--color-accent)' }} />
                  <span className="font-mono font-medium" style={{ color: 'var(--color-text)' }}>
                    {name}
                  </span>
                </div>
                <pre
                  className="p-4 text-xs overflow-auto border-t"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)'
                  }}
                >
                  {JSON.stringify(schema, null, 2)}
                </pre>
              </div>
            ))}

            {(!spec.components?.schemas || Object.keys(spec.components.schemas).length === 0) && (
              <div className="text-center py-12">
                <Code className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--color-textSecondary)' }} />
                <p style={{ color: 'var(--color-textSecondary)' }}>No schemas defined</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'auth' && (
          <div className="space-y-6 max-w-2xl">
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                Authentication Methods
              </h3>

              {spec.components?.securitySchemes ? (
                <div className="space-y-4">
                  {Object.entries(spec.components.securitySchemes).map(([name, scheme]: [string, any]) => (
                    <div
                      key={name}
                      className="p-4 rounded-lg"
                      style={{ backgroundColor: 'var(--color-surface)' }}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <Lock className="w-5 h-5" style={{ color: 'var(--color-accent)' }} />
                        <span className="font-mono font-medium" style={{ color: 'var(--color-text)' }}>
                          {name}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded text-xs"
                          style={{ backgroundColor: 'var(--color-border)', color: 'var(--color-textSecondary)' }}
                        >
                          {scheme.type}
                        </span>
                      </div>
                      {scheme.description && (
                        <p className="text-sm mb-2" style={{ color: 'var(--color-textSecondary)' }}>
                          {scheme.description}
                        </p>
                      )}
                      {scheme.type === 'http' && (
                        <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                          <strong>Scheme:</strong> {scheme.scheme}
                          {scheme.bearerFormat && (
                            <span className="ml-2">({scheme.bearerFormat})</span>
                          )}
                        </div>
                      )}
                      {scheme.type === 'apiKey' && (
                        <div className="text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                          <strong>Header:</strong> {scheme.name} (in {scheme.in})
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--color-textSecondary)' }}>No security schemes defined</p>
              )}
            </div>

            {/* Example usage */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                Example Request
              </h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4" style={{ color: 'var(--color-textSecondary)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    Using Bearer Token
                  </span>
                </div>
                <pre
                  className="p-4 rounded text-xs overflow-auto"
                  style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                >
{`curl -X GET \\
  'https://your-domain/api/chat/conversations' \\
  -H 'Authorization: Bearer YOUR_TOKEN' \\
  -H 'Content-Type: application/json'`}
                </pre>

                <div className="flex items-center gap-2 mt-4">
                  <Terminal className="w-4 h-4" style={{ color: 'var(--color-textSecondary)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    Using API Key
                  </span>
                </div>
                <pre
                  className="p-4 rounded text-xs overflow-auto"
                  style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                >
{`curl -X GET \\
  'https://your-domain/api/chat/conversations' \\
  -H 'X-API-Key: YOUR_API_KEY' \\
  -H 'Content-Type: application/json'`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'quickstart' && (
          <div className="space-y-6 max-w-4xl">
            {/* Quick Start Introduction */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                🚀 Quick Start Guide
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--color-textSecondary)' }}>
                The OpenAgentic API uses API keys for authentication. Include your API key in the <code className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface)' }}>x-api-key</code> header for all requests.
              </p>
              <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
                <code className="text-sm" style={{ color: 'var(--color-success)' }}>
                  x-api-key: oa_your_api_key_here
                </code>
              </div>
            </div>

            {/* Chat Session Examples */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Terminal className="w-5 h-5" /> Chat Sessions
              </h3>

              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>1. Create a Chat Session & Send Message</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl -N 'http://localhost:8000/api/chat/stream' \\
  -X POST \\
  -H 'Content-Type: application/json' \\
  -H 'x-api-key: YOUR_API_KEY' \\
  -d '{
    "message": "Hello, what can you help me with?",
    "sessionId": "my-session-001"
  }'

# Response: Server-Sent Events (SSE) stream
# event: stream_start
# event: completion_start
# event: content_delta
# data: {"content":"Hello! I can help..."}
# event: done`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>2. Get Session History</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl 'http://localhost:8000/api/chat/sessions/my-session-001/messages' \\
  -H 'x-api-key: YOUR_API_KEY'

# Response:
{
  "messages": [
    {"id": "msg1", "role": "user", "content": "Hello..."},
    {"id": "msg2", "role": "assistant", "content": "I can help..."}
  ]
}`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>3. Get Available Models</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl 'http://localhost:8000/api/models' \\
  -H 'x-api-key: YOUR_API_KEY'

# Response:
{
  "models": [
    {"id": "gemini-3-pro-preview", "provider": "google-vertex"},
    {"id": "gpt-5.2-chat", "provider": "azure-openai"}
  ],
  "defaultModel": "gemini-3-pro-preview"
}`}
                  </pre>
                </div>
              </div>
            </div>

            {/* MCP Tools Examples */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Server className="w-5 h-5" /> MCP Tools
              </h3>

              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>1. List Available MCP Servers</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl 'http://localhost:8000/api/admin/mcp/servers' \\
  -H 'x-api-key: YOUR_API_KEY'

# Response: Array of MCP server configurations`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>2. List Available Tools</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl 'http://localhost:8000/api/admin/mcp/tools-list' \\
  -H 'x-api-key: YOUR_API_KEY'

# Response:
{
  "tools": [
    {
      "server": "openagentic_admin",
      "name": "admin_system_postgres_health_check",
      "description": "Check PostgreSQL health",
      "inputSchema": {...}
    }
  ]
}`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>3. Execute MCP Tool</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl -X POST 'http://localhost:8000/api/mcp/call' \\
  -H 'Content-Type: application/json' \\
  -H 'x-api-key: YOUR_API_KEY' \\
  -d '{
    "serverName": "openagentic_admin",
    "toolName": "admin_system_postgres_health_check",
    "arguments": {}
  }'`}
                  </pre>
                </div>
              </div>
            </div>

            {/* LLM Providers Examples */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Code className="w-5 h-5" /> LLM Providers
              </h3>

              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>1. List LLM Providers</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl 'http://localhost:8000/api/admin/llm-providers' \\
  -H 'x-api-key: YOUR_API_KEY'

# Response:
{
  "providers": [
    {"name": "vertex-ai", "priority": 1, "enabled": true},
    {"name": "azure-openai", "priority": 2, "enabled": true}
  ]
}`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>2. Create LLM Provider</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl -X POST 'http://localhost:8000/api/admin/llm-providers' \\
  -H 'Content-Type: application/json' \\
  -H 'x-api-key: YOUR_API_KEY' \\
  -d '{
    "name": "my-openai",
    "displayName": "My OpenAI Instance",
    "providerType": "openai",
    "authConfig": {
      "apiKey": "sk-..."
    },
    "providerConfig": {
      "baseUrl": "https://api.openai.com/v1",
      "model": "gpt-4"
    }
  }'`}
                  </pre>
                </div>
              </div>
            </div>

            {/* Admin Examples */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Lock className="w-5 h-5" /> Admin Operations
              </h3>

              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>1. Get Audit Logs</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl 'http://localhost:8000/api/admin/audit-logs?limit=10' \\
  -H 'x-api-key: YOUR_API_KEY'`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>2. Check System Health</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl 'http://localhost:8000/health'

# Response: {"status": "ok", "timestamp": "2025-12-18T..."}`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>3. Get MCP Health Status</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl 'http://localhost:8000/api/admin/mcp/health' \\
  -H 'x-api-key: YOUR_API_KEY'

# Response: Status of all MCP servers`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sdk' && (
          <div className="space-y-6 max-w-4xl">
            {/* SDK Overview */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                📦 OpenAgentic SDK
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--color-textSecondary)' }}>
                The OpenAgentic SDK provides a simple way to integrate with the OpenAgentic API from your applications.
              </p>
            </div>

            {/* JavaScript/TypeScript SDK */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Code className="w-5 h-5" /> JavaScript / TypeScript
              </h3>

              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Installation</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`npm install @openagentic/sdk
# or
yarn add @openagentic/sdk`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Basic Usage</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`import { OpenAgenticClient } from '@openagentic/sdk';

// Initialize the client
const client = new OpenAgenticClient({
  apiKey: 'oa_your_api_key',
  baseUrl: 'https://<your-deploy-host>'
});

// Send a chat message
const response = await client.chat.send({
  sessionId: 'my-session',
  message: 'Hello, how can you help me?'
});

// Stream responses
for await (const chunk of client.chat.stream({
  sessionId: 'my-session',
  message: 'Write a poem about AI'
})) {
  console.log(chunk.content);
}`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Execute MCP Tools</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`// List available tools
const tools = await client.mcp.listTools();

// Execute a tool
const result = await client.mcp.execute({
  serverName: 'openagentic_admin',
  toolName: 'admin_system_postgres_health_check',
  arguments: {}
});`}
                  </pre>
                </div>
              </div>
            </div>

            {/* Python SDK */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Code className="w-5 h-5" /> Python
              </h3>

              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Installation</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`pip install openagentic`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Basic Usage</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`from openagentic import OpenAgenticClient

# Initialize the client
client = OpenAgenticClient(
    api_key="oa_your_api_key",
    base_url="https://<your-deploy-host>"
)

# Send a chat message
response = client.chat.send(
    session_id="my-session",
    message="Hello, how can you help me?"
)

# Stream responses
for chunk in client.chat.stream(
    session_id="my-session",
    message="Write a poem about AI"
):
    print(chunk.content, end="")

# Execute MCP tool
result = client.mcp.execute(
    server_name="openagentic_admin",
    tool_name="admin_system_postgres_health_check",
    arguments={}
)`}
                  </pre>
                </div>
              </div>
            </div>

            {/* REST API Direct */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Terminal className="w-5 h-5" /> Direct REST API
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--color-textSecondary)' }}>
                You can also call the API directly using any HTTP client. See the Quick Start tab for curl examples.
              </p>

              <div>
                <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Headers Required</h4>
                <pre
                  className="p-4 rounded text-xs overflow-auto"
                  style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                >
{`Content-Type: application/json
x-api-key: oa_your_api_key_here`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'openagentic' && (
          <div className="space-y-6 max-w-4xl">
            {/* OpenAgentic Overview */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                🖥️ OpenAgentic - Code Execution Environment
              </h3>
              <p className="text-sm mb-4" style={{ color: 'var(--color-textSecondary)' }}>
                OpenAgentic provides secure, isolated code execution environments for each user. It supports Python, JavaScript, and shell scripts with persistent workspaces.
              </p>
            </div>

            {/* Architecture */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Server className="w-5 h-5" /> Architecture
              </h3>
              <div className="space-y-3 text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                <p><strong>Components:</strong></p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>OpenAgentic Manager</strong> - Orchestrates code sessions and file management</li>
                  <li><strong>User Workspaces</strong> - Isolated /workspaces/{'{userId}'} directories</li>
                  <li><strong>MCP Integration</strong> - Execute code via openagentic_openagentic MCP server</li>
                </ul>
              </div>
            </div>

            {/* Execute Code via MCP */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Code className="w-5 h-5" /> Execute Code via MCP
              </h3>

              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Run Python Code</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl -X POST 'http://localhost:8000/api/mcp/call' \\
  -H 'Content-Type: application/json' \\
  -H 'x-api-key: YOUR_API_KEY' \\
  -d '{
    "serverName": "openagentic_openagentic",
    "toolName": "execute_code",
    "arguments": {
      "code": "import pandas as pd\\nprint(pd.__version__)",
      "language": "python",
      "user_id": "your-user-id"
    }
  }'`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Write File to Workspace</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl -X POST 'http://localhost:8000/api/mcp/call' \\
  -H 'Content-Type: application/json' \\
  -H 'x-api-key: YOUR_API_KEY' \\
  -d '{
    "serverName": "openagentic_openagentic",
    "toolName": "write_file",
    "arguments": {
      "filepath": "my_script.py",
      "content": "print('"'"'Hello from OpenAgentic!'"'"')",
      "user_id": "your-user-id"
    }
  }'`}
                  </pre>
                </div>

                <div>
                  <h4 className="font-medium mb-2" style={{ color: 'var(--color-text)' }}>Read File from Workspace</h4>
                  <pre
                    className="p-4 rounded text-xs overflow-auto"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
{`curl -X POST 'http://localhost:8000/api/mcp/call' \\
  -H 'Content-Type: application/json' \\
  -H 'x-api-key: YOUR_API_KEY' \\
  -d '{
    "serverName": "openagentic_openagentic",
    "toolName": "read_file",
    "arguments": {
      "filepath": "my_script.py",
      "user_id": "your-user-id"
    }
  }'`}
                  </pre>
                </div>
              </div>
            </div>

            {/* Available Languages */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                Supported Languages
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 rounded text-center" style={{ backgroundColor: 'var(--color-surface)' }}>
                  <div className="text-2xl mb-1">🐍</div>
                  <div className="font-medium" style={{ color: 'var(--color-text)' }}>Python</div>
                  <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>3.11+</div>
                </div>
                <div className="p-3 rounded text-center" style={{ backgroundColor: 'var(--color-surface)' }}>
                  <div className="text-2xl mb-1">📜</div>
                  <div className="font-medium" style={{ color: 'var(--color-text)' }}>JavaScript</div>
                  <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>Node.js 20+</div>
                </div>
                <div className="p-3 rounded text-center" style={{ backgroundColor: 'var(--color-surface)' }}>
                  <div className="text-2xl mb-1">🔷</div>
                  <div className="font-medium" style={{ color: 'var(--color-text)' }}>TypeScript</div>
                  <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>tsx runtime</div>
                </div>
                <div className="p-3 rounded text-center" style={{ backgroundColor: 'var(--color-surface)' }}>
                  <div className="text-2xl mb-1">🐚</div>
                  <div className="font-medium" style={{ color: 'var(--color-text)' }}>Shell</div>
                  <div className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>bash</div>
                </div>
              </div>
            </div>

            {/* Pre-installed Packages */}
            <div
              className="p-6 rounded-lg"
              style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
            >
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
                Pre-installed Python Packages
              </h3>
              <div className="flex flex-wrap gap-2">
                {['pandas', 'numpy', 'matplotlib', 'seaborn', 'scikit-learn', 'requests', 'beautifulsoup4', 'pillow', 'openpyxl', 'python-docx', 'pdfplumber'].map(pkg => (
                  <span
                    key={pkg}
                    className="px-3 py-1 rounded-full text-sm"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  >
                    {pkg}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
