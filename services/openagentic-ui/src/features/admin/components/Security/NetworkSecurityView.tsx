import React, { useState, useEffect } from 'react';
import {
  Eye, EyeOff, Search, Settings
} from '@/shared/icons';
import {
  Shield, Server, AlertTriangle, CheckCircle, XCircle, Lock
} from '../Shared/AdminIcons';
import { apiRequestJson } from '@/utils/api';
import { PageHeader } from '../../primitives-v2';

interface ServiceStatus {
  service: string;
  displayName: string;
  component: string;
  critical: boolean;
  policyEnabled: boolean;
  policyName: string | null;
  ingressRules: number;
  egressRules: number;
  createdAt: string | null;
}

interface NetworkPolicy {
  name: string;
  createdAt: string;
  policyTypes: string[];
  ingressRuleCount: number;
  egressRuleCount: number;
}

interface ProtectedConnection {
  from: string;
  to: string;
  reason: string;
}

interface NetworkSecurityViewProps {
  theme: string;
}

const NetworkSecurityView: React.FC<NetworkSecurityViewProps> = ({ theme }) => {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [policies, setPolicies] = useState<NetworkPolicy[]>([]);
  const [protectedConns, setProtectedConns] = useState<ProtectedConnection[]>([]);
  const [k8sServices, setK8sServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'policies' | 'services' | 'safety'>('overview');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusData, policiesData, protectedData, servicesData] = await Promise.all([
        apiRequestJson('/admin/network/status').catch(() => ({ available: false, services: [] })),
        apiRequestJson('/admin/network/policies').catch(() => ({ policies: [] })),
        apiRequestJson('/admin/network/protected').catch(() => ({ connections: [] })),
        apiRequestJson('/admin/network/services').catch(() => ({ services: [] }))
      ]);

      setAvailable(statusData.available ?? false);
      setServices(statusData.services || []);
      setPolicies(policiesData.policies || []);
      setProtectedConns(protectedData.connections || []);
      setK8sServices(servicesData.services || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load network data');
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePolicy = async (service: string, enable: boolean) => {
    try {
      await apiRequestJson(`/admin/network/policies/${service}/toggle`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: enable })
      });
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle policy');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          crumbs={['Admin', 'Security', 'Network']}
          title="Network Security"
          explainer="Manage Kubernetes NetworkPolicies to control inter-service communication and egress."
        />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
        </div>
      </div>
    );
  }

  const enabledPolicies = services.filter(s => s.policyEnabled).length;
  const disabledPolicies = services.length - enabledPolicies;
  const criticalServices = services.filter(s => s.critical);

  const filteredServices = services.filter(s =>
    !searchTerm || s.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.service.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={['Admin', 'Security', 'Network']}
        title="Network Security"
        explainer="Manage Kubernetes NetworkPolicies to control inter-service communication and egress."
        actions={[
          { label: 'Refresh', onClick: () => { void fetchAll(); } },
        ]}
      />

      {error && (
        <div className="glass-card border-error/50 bg-error-500/10 p-4 rounded-lg flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 ap-text-error" />
          <span className="ap-text-error">{error}</span>
        </div>
      )}

      {!available && (
        <div className="glass-card p-8 text-center">
          <Shield className="h-16 w-16 mx-auto mb-4 text-text-secondary opacity-50" />
          <h3 className="text-xl font-semibold text-text-primary mb-2">K8s API Not Available</h3>
          <p className="text-text-secondary max-w-md mx-auto">
            The API server is not running inside a Kubernetes cluster, or the NetworkPolicy RBAC is not enabled.
            Enable it in Helm values: <code className="bg-surface-secondary px-2 py-0.5 rounded text-xs">networkAdmin.enabled: true</code>
          </p>
        </div>
      )}

      {available && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-text-primary">{services.length}</div>
              <div className="text-sm text-text-secondary">Total Services</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold ap-text-success">{enabledPolicies}</div>
              <div className="text-sm text-text-secondary">Policies Active</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold ap-text-warning">{disabledPolicies}</div>
              <div className="text-sm text-text-secondary">Policies Disabled</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-primary-500">{protectedConns.length}</div>
              <div className="text-sm text-text-secondary">Protected Connections</div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex bg-surface-secondary rounded-lg p-1 w-fit">
            {(['overview', 'policies', 'services', 'safety'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                  activeTab === tab ? 'ap-btn-primary' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {tab === 'overview' ? 'Service Overview' : tab === 'policies' ? 'Active Policies' : tab === 'services' ? 'K8s Services' : 'Safety Dashboard'}
              </button>
            ))}
          </div>

          {/* Service Overview Grid */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Search className="h-4 w-4 text-text-secondary" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Filter services..."
                  className="px-3 py-2 border border-border rounded-lg bg-surface-primary text-text-primary text-sm"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredServices.map(svc => (
                  <div key={svc.service} className={`glass-card p-4 border-l-4 ${
                    svc.policyEnabled ? 'border-l-success-500' : 'border-l-warning-500'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Server className="h-4 w-4 text-text-secondary" />
                        <span className="font-medium text-text-primary">{svc.displayName}</span>
                        {svc.critical && (
                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-error-500/20 ap-text-error">CRITICAL</span>
                        )}
                      </div>
                      <button
                        onClick={() => handleTogglePolicy(svc.service, !svc.policyEnabled)}
                        className={`p-1.5 rounded-lg transition-colors ${
                          svc.policyEnabled
                            ? 'bg-success-500/10 ap-text-success hover:bg-success-500/20'
                            : 'bg-surface-secondary text-text-secondary hover:bg-warning-500/10'
                        }`}
                        title={svc.policyEnabled ? 'Disable NetworkPolicy' : 'Enable NetworkPolicy'}
                      >
                        {svc.policyEnabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                    </div>

                    <div className="text-xs text-text-secondary space-y-1">
                      <div className="flex justify-between">
                        <span>Status:</span>
                        <span className={svc.policyEnabled ? 'ap-text-success' : 'ap-text-warning'}>
                          {svc.policyEnabled ? 'Policy Active' : 'No Policy'}
                        </span>
                      </div>
                      {svc.policyEnabled && (
                        <>
                          <div className="flex justify-between">
                            <span>Ingress Rules:</span>
                            <span className="text-text-primary">{svc.ingressRules}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Egress Rules:</span>
                            <span className="text-text-primary">{svc.egressRules}</span>
                          </div>
                        </>
                      )}
                      <div className="text-xs text-text-secondary mt-1 font-mono">{svc.component}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Policies */}
          {activeTab === 'policies' && (
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Active NetworkPolicies</h3>
              {policies.length === 0 ? (
                <div className="text-center py-8 text-text-secondary">
                  No NetworkPolicies are currently active in the namespace.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 text-text-secondary font-medium">Name</th>
                        <th className="text-left py-2 px-3 text-text-secondary font-medium">Types</th>
                        <th className="text-left py-2 px-3 text-text-secondary font-medium">Ingress</th>
                        <th className="text-left py-2 px-3 text-text-secondary font-medium">Egress</th>
                        <th className="text-left py-2 px-3 text-text-secondary font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {policies.map((p: any) => (
                        <tr key={p.name} className="border-b border-border/50">
                          <td className="py-2 px-3 text-text-primary font-mono text-xs">{p.name}</td>
                          <td className="py-2 px-3 text-text-secondary text-xs">
                            {(p.policyTypes || []).join(', ')}
                          </td>
                          <td className="py-2 px-3 text-text-primary">{p.ingressRuleCount}</td>
                          <td className="py-2 px-3 text-text-primary">{p.egressRuleCount}</td>
                          <td className="py-2 px-3 text-text-secondary text-xs">
                            {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* K8s Services */}
          {activeTab === 'services' && (
            <div className="glass-card p-6">
              <h3 className="text-lg font-semibold text-text-primary mb-4">
                Kubernetes Services ({k8sServices.length})
              </h3>
              {k8sServices.length === 0 ? (
                <div className="text-center py-8 text-text-secondary">
                  No services found. K8s API may not be available.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 text-text-secondary font-medium">Service</th>
                        <th className="text-left py-2 px-3 text-text-secondary font-medium">Type</th>
                        <th className="text-left py-2 px-3 text-text-secondary font-medium">Ports</th>
                        <th className="text-left py-2 px-3 text-text-secondary font-medium">Ready</th>
                      </tr>
                    </thead>
                    <tbody>
                      {k8sServices.map((svc: any) => (
                        <tr key={svc.name} className="border-b border-border/50">
                          <td className="py-2 px-3 text-text-primary font-mono text-xs">{svc.name}</td>
                          <td className="py-2 px-3 text-text-secondary text-xs">{svc.type}</td>
                          <td className="py-2 px-3 text-text-secondary text-xs">
                            {(svc.ports || []).map((p: any) => `${p.port}/${p.protocol}`).join(', ')}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`text-xs ${svc.readyReplicas > 0 ? 'ap-text-success' : 'ap-text-error'}`}>
                              {svc.readyReplicas}/{svc.replicas}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Safety Dashboard */}
          {activeTab === 'safety' && (
            <div className="space-y-4">
              {/* Protected Connections */}
              <div className="glass-card p-6">
                <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <Lock className="h-5 w-5" />
                  Protected Connections
                </h3>
                <p className="text-sm text-text-secondary mb-4">
                  These connections are critical for platform operation and cannot be blocked via the admin console.
                </p>
                <div className="space-y-2">
                  {protectedConns.map((conn, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 border border-border rounded-lg bg-surface-secondary/30">
                      <Lock className="h-4 w-4 ap-text-warning flex-shrink-0" />
                      <div className="flex items-center gap-2 flex-1">
                        <span className="font-mono text-sm text-text-primary px-2 py-0.5 bg-surface-secondary rounded">{conn.from}</span>
                        <span className="text-text-secondary">→</span>
                        <span className="font-mono text-sm text-text-primary px-2 py-0.5 bg-surface-secondary rounded">{conn.to}</span>
                      </div>
                      <span className="text-xs text-text-secondary">{conn.reason}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Critical Service Status */}
              <div className="glass-card p-6">
                <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Critical Services
                </h3>
                <div className="space-y-2">
                  {criticalServices.map(svc => (
                    <div key={svc.service} className="flex items-center justify-between p-3 border border-border rounded-lg">
                      <div className="flex items-center gap-3">
                        {svc.policyEnabled ? (
                          <CheckCircle className="h-5 w-5 ap-text-success" />
                        ) : (
                          <XCircle className="h-5 w-5 ap-text-warning" />
                        )}
                        <div>
                          <span className="font-medium text-text-primary">{svc.displayName}</span>
                          <span className="text-xs text-text-secondary ml-2">{svc.component}</span>
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        svc.policyEnabled ? 'bg-success-500/20 ap-text-success' : 'bg-warning-500/20 ap-text-warning'
                      }`}>
                        {svc.policyEnabled ? 'Protected' : 'Unprotected'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default NetworkSecurityView;
