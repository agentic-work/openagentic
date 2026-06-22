/**
 * Service Discovery Configuration
 * 
 * Centralized configuration for all service endpoints.
 * Uses environment variables with consistent naming pattern.
 * Works with both Docker Compose (dev) and Kubernetes (prod).
 * 
 * Pattern: <SERVICE>_HOST and <SERVICE>_PORT
 * Docker Compose: Uses container names
 * Kubernetes: Uses Service names
 */

export interface ServiceEndpoint {
  host: string;
  port: number;
  url: string;
  healthEndpoint?: string;
  password?: string;
}

export class ServiceDiscovery {
  private static instance: ServiceDiscovery;
  
  // Core services
  readonly postgres: ServiceEndpoint;
  readonly redis: ServiceEndpoint;
  readonly milvus: ServiceEndpoint;
  readonly mcp: ServiceEndpoint;
  readonly vault: ServiceEndpoint;
  
  // Monitoring services
  readonly prometheus: ServiceEndpoint;
  readonly grafana: ServiceEndpoint;
  readonly loki: ServiceEndpoint;
  readonly mimir: ServiceEndpoint;
  
  // Application services
  readonly api: ServiceEndpoint;
  readonly ui: ServiceEndpoint;
  readonly docs: ServiceEndpoint;
  
  private constructor() {
    // Core services
    this.postgres = this.createEndpoint('POSTGRES', 5432, '/');
    this.redis = this.createRedisEndpoint();
    this.milvus = this.createEndpoint('MILVUS', 19530, '/v1/vector/collections');
    this.mcp = this.createEndpoint('MCP_ORCHESTRATOR', 3001, '/health', 'MCP_ORCHESTRATOR_URL');
    this.vault = this.createEndpoint('VAULT', 8200, '/v1/sys/health');
    
    // Monitoring services
    this.prometheus = this.createEndpoint('PROMETHEUS', 9090, '/-/healthy');
    this.grafana = this.createEndpoint('GRAFANA', 3000, '/api/health');
    this.loki = this.createEndpoint('LOKI', 3100, '/ready');
    this.mimir = this.createEndpoint('MIMIR', 9009, '/ready');
    
    // Application services
    this.api = this.createEndpoint('API', 8000, '/health');
    this.ui = this.createEndpoint('UI', 80, '/');
    this.docs = this.createEndpoint('DOCS', 8080, '/');
  }
  
  private createEndpoint(
    serviceName: string, 
    defaultPort: number, 
    healthPath: string = '/health',
    urlEnvOverride?: string
  ): ServiceEndpoint {
    // Check for full URL override first (e.g., MCP_ORCHESTRATOR_URL)
    if (urlEnvOverride && process.env[urlEnvOverride]) {
      const url = process.env[urlEnvOverride];
      const urlParts = new URL(url);
      return {
        host: urlParts.hostname,
        port: Number.parseInt(urlParts.port) || defaultPort,
        url: url,
        healthEndpoint: `${url}${healthPath}`
      };
    }
    
    // Standard pattern: <SERVICE>_HOST and <SERVICE>_PORT
    const host = process.env[`${serviceName}_HOST`] || this.getDefaultHost(serviceName);
    const port = Number.parseInt(process.env[`${serviceName}_PORT`] || '') || defaultPort;
    const protocol = this.requiresHttps(serviceName) ? 'https' : 'http';
    
    return {
      host,
      port,
      url: `${protocol}://${host}:${port}`,
      healthEndpoint: `${protocol}://${host}:${port}${healthPath}`
    };
  }
  
  private createRedisEndpoint(): ServiceEndpoint {
    const host = process.env.REDIS_HOST || this.getDefaultHost('REDIS');
    const port = Number.parseInt(process.env.REDIS_PORT || '') || 6379;
    const password = process.env.REDIS_PASSWORD || '';

    // Build URL with or without password
    const authPart = password ? `:${password}@` : '';
    const url = `redis://${authPart}${host}:${port}`;

    return {
      host,
      port,
      url,
      password: password || undefined
    };
  }

  private getDefaultHost(serviceName: string): string {
    // For Docker Compose, use the service names from docker-compose.yml
    const dockerDefaults: Record<string, string> = {
      'POSTGRES': 'postgres',
      'REDIS': 'redis',
      'MILVUS': 'milvus-standalone',
      'MCP_ORCHESTRATOR': 'mcp-orchestrator',
      'VAULT': 'vault',
      'PROMETHEUS': 'prometheus',
      'GRAFANA': 'grafana',
      'LOKI': 'loki',
      'MIMIR': 'mimir',
      'API': 'openagentic-api',
      'UI': 'openagentic-ui',
      'DOCS': 'openagentic-docs'
    };

    return dockerDefaults[serviceName] || 'localhost';
  }
  
  private requiresHttps(serviceName: string): boolean {
    // Services that require HTTPS
    return ['VAULT'].includes(serviceName) && process.env.NODE_ENV === 'production';
  }
  
  public static getInstance(): ServiceDiscovery {
    if (!ServiceDiscovery.instance) {
      ServiceDiscovery.instance = new ServiceDiscovery();
    }
    return ServiceDiscovery.instance;
  }
  
  /**
   * Get service configuration for healthchecks
   */
  public getHealthcheckEndpoints(): Array<{name: string, endpoint: ServiceEndpoint}> {
    return [
      { name: 'PostgreSQL', endpoint: this.postgres },
      { name: 'Redis', endpoint: this.redis },
      { name: 'Milvus', endpoint: this.milvus },
      { name: 'MCP Orchestrator', endpoint: this.mcp },
    ].filter(s => s.endpoint.healthEndpoint);
  }
  
  /**
   * Log all discovered services (for debugging)
   */
  public logConfiguration(): void {
    console.log('Service Discovery Configuration:');
    console.log('================================');
    const services = [
      { name: 'PostgreSQL', ...this.postgres },
      { name: 'Redis', ...this.redis },
      { name: 'Milvus', ...this.milvus },
      { name: 'MCP Orchestrator', ...this.mcp },
      { name: 'Vault', ...this.vault },
      { name: 'Prometheus', ...this.prometheus },
      { name: 'Grafana', ...this.grafana },
      { name: 'Loki', ...this.loki },
      { name: 'Mimir', ...this.mimir },
      { name: 'API', ...this.api },
      { name: 'UI', ...this.ui },
      { name: 'Docs', ...this.docs },
    ];

    services.forEach(service => {
      console.log(`${service.name}: ${service.url}`);
    });
  }
}

// Export singleton instance
export const serviceDiscovery = ServiceDiscovery.getInstance();