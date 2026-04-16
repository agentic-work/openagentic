/**
 * Smart Tool Router
 *
 * Analyzes user query and routes to relevant tool categories
 * to minimize token usage by only loading 15-20 relevant tools
 */

export interface ToolCategory {
  keywords: string[];
  toolPatterns: RegExp[];
  priority: number;
}

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // Core Azure Management (always include)
  core: {
    keywords: ['subscription', 'tenant', 'account', 'resource group', 'rg'],
    toolPatterns: [
      /subscription.*list/i,
      /group.*list/i,
      /group.*create/i,
      /resource.*list/i
    ],
    priority: 100
  },

  // Virtual Machines & Compute
  compute: {
    keywords: ['vm', 'virtual machine', 'compute', 'scale set', 'vmss', 'instance'],
    toolPatterns: [
      /vm.*create/i,
      /vm.*list/i,
      /vm.*delete/i,
      /vm.*start/i,
      /vm.*stop/i,
      /compute/i,
      /vmss/i
    ],
    priority: 90
  },

  // Storage
  storage: {
    keywords: ['storage', 'blob', 'file share', 'disk', 'managed disk'],
    toolPatterns: [
      /storage.*account/i,
      /blob/i,
      /disk/i,
      /fileshare/i
    ],
    priority: 80
  },

  // Networking
  networking: {
    keywords: ['vnet', 'network', 'subnet', 'nsg', 'security group', 'firewall', 'vpn', 'gateway'],
    toolPatterns: [
      /network/i,
      /vnet/i,
      /subnet/i,
      /nsg/i,
      /firewall/i,
      /gateway/i
    ],
    priority: 80
  },

  // Databases
  database: {
    keywords: ['sql', 'database', 'cosmos', 'postgresql', 'mysql', 'mariadb'],
    toolPatterns: [
      /sql/i,
      /database/i,
      /cosmos/i,
      /postgresql/i,
      /mysql/i
    ],
    priority: 80
  },

  // Web & App Services
  webapps: {
    keywords: ['webapp', 'app service', 'function', 'logic app', 'api management'],
    toolPatterns: [
      /webapp/i,
      /functionapp/i,
      /logicapp/i,
      /apim/i
    ],
    priority: 70
  },

  // Containers & Kubernetes
  containers: {
    keywords: ['aks', 'kubernetes', 'container', 'docker', 'acr', 'registry'],
    toolPatterns: [
      /aks/i,
      /kubernetes/i,
      /acr/i,
      /container/i,
      /registry/i
    ],
    priority: 70
  },

  // Security & Identity
  security: {
    keywords: ['keyvault', 'key vault', 'secret', 'certificate', 'rbac', 'role', 'identity', 'managed identity'],
    toolPatterns: [
      /keyvault/i,
      /secret/i,
      /certificate/i,
      /role.*assignment/i,
      /identity/i
    ],
    priority: 70
  },

  // Monitoring & Diagnostics
  monitoring: {
    keywords: ['monitor', 'log analytics', 'alert', 'metric', 'diagnostic', 'application insights'],
    toolPatterns: [
      /monitor/i,
      /log.*analytics/i,
      /alert/i,
      /metric/i,
      /diagnostic/i,
      /insights/i
    ],
    priority: 60
  },

  // AI & ML
  ai: {
    keywords: ['openai', 'cognitive', 'ml', 'machine learning', 'ai', 'foundry'],
    toolPatterns: [
      /openai/i,
      /cognitive/i,
      /foundry/i,
      /ml/i
    ],
    priority: 50
  }
};

/**
 * Analyze query and determine which tool categories are relevant
 */
export function detectToolCategories(query: string): string[] {
  const queryLower = query.toLowerCase();
  const matchedCategories: { category: string; score: number }[] = [];

  for (const [category, config] of Object.entries(TOOL_CATEGORIES)) {
    let score = 0;

    // Check keyword matches
    for (const keyword of config.keywords) {
      if (queryLower.includes(keyword.toLowerCase())) {
        score += 10;
      }
    }

    // Boost score by priority
    score += config.priority / 10;

    if (score > 0) {
      matchedCategories.push({ category, score });
    }
  }

  // Always include core category
  if (!matchedCategories.find(c => c.category === 'core')) {
    matchedCategories.push({ category: 'core', score: 100 });
  }

  // Sort by score and return top 3 categories
  return matchedCategories
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(c => c.category);
}

/**
 * Filter tools based on selected categories
 */
export function filterToolsByCategories(
  tools: any[],
  categories: string[],
  maxTools: number = 20
): any[] {
  const categoryConfigs = categories.map(cat => TOOL_CATEGORIES[cat]).filter(Boolean);

  const scoredTools = tools.map(tool => {
    const toolName = tool?.function?.name || '';
    let score = 0;

    for (const config of categoryConfigs) {
      // Check if tool matches any pattern in this category
      for (const pattern of config.toolPatterns) {
        if (pattern.test(toolName)) {
          score += config.priority;
          break;
        }
      }
    }

    return { tool, score };
  });

  // Sort by score and return top N tools
  return scoredTools
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTools)
    .map(st => st.tool);
}

/**
 * Main entry point: Smart tool selection
 */
export function selectRelevantTools(
  query: string,
  allTools: any[],
  maxTools: number = 20
): { tools: any[]; categories: string[]; droppedCount: number } {
  // Detect relevant categories
  const categories = detectToolCategories(query);

  // Filter tools by categories
  const selectedTools = filterToolsByCategories(allTools, categories, maxTools);

  return {
    tools: selectedTools,
    categories,
    droppedCount: allTools.length - selectedTools.length
  };
}
