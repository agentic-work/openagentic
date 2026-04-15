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
 * Azure MCP User Service
 * Handles user-scoped Azure MCP operations with SSO tokens
 *
 * @deprecated DEAD CODE — never imported anywhere as of 2026-04-07.
 * Verified via grep: no consumers exist outside this file. Kept for reference
 * but should be deleted in a follow-up cleanup pass. The OBO flow it implemented
 * is now handled inside `tool-execution.helper.ts` (synth path) and the
 * `openagentic-proxy → mcp-proxy → openagentic_azure` chain (direct MCP path).
 *
 * SECURITY NOTE: this file used `require('@azure/msal-node')` which is
 * broken under ESM (the package is "type":"module"). The OBO call therefore
 * always threw ReferenceError, hit the catch, and silently fell back to a
 * shared service principal — running EVERY user's Azure MCP requests under
 * the same service identity instead of OBO. The ESM `import` at the top of
 * the file fixes the runtime if this code is ever revived.
 */

import { spawn } from 'child_process';
import * as msal from '@azure/msal-node';

export class AzureMCPUserService {
  /**
   * Start Azure MCP with user's SSO token
   * The token comes from the user's SSO login and is exchanged for Azure Management access
   */
  async startUserScopedAzureMCP(userToken: string, userEmail: string, userGroups: string[]) {
    // Exchange SSO token for Azure Management token
    const azureManagementToken = await this.exchangeToken(userToken, userGroups);
    
    // Start Azure MCP with user's token
    const mcpProcess = spawn('node', ['/app/mcps/builtin/azure-user-scoped-mcp.js'], {
      env: {
        ...process.env,
        // Pass the Azure Management token that Azure MCP can use
        USER_AZURE_TOKEN: azureManagementToken,
        // This will be used as AZURE_ACCESS_TOKEN inside the wrapper
        AZURE_ACCESS_TOKEN: azureManagementToken,
        USER_EMAIL: userEmail,
        USER_AD_GROUPS: userGroups.join(','),
        // Clear service principal credentials to ensure user token is used
        AZURE_CLIENT_ID: '',
        AZURE_CLIENT_SECRET: '',
        // Keep tenant and subscription
        AZURE_TENANT_ID: process.env.AZURE_TENANT_ID,
        AZURE_SUBSCRIPTION_ID: process.env.AZURE_SUBSCRIPTION_ID
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    console.log(`[AzureMCPUser] Started Azure MCP for user ${userEmail} with groups ${userGroups}`);
    
    return mcpProcess;
  }

  /**
   * Exchange SSO token for Azure Management token using MSAL
   */
  private async exchangeToken(ssoToken: string, userGroups: string[]): Promise<string> {
    // Note: msal is now imported at the top of the file via static ESM import.
    // The previous `require('@azure/msal-node')` was broken under ESM.
    const msalConfig = {
      auth: {
        clientId: process.env.AAD_CLIENT_ID,
        clientSecret: process.env.AZURE_CLIENT_SECRET, 
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`
      }
    };

    const cca = new msal.ConfidentialClientApplication(msalConfig);
    
    // On-Behalf-Of flow to get Azure Management token
    const oboRequest = {
      oboAssertion: ssoToken,
      scopes: ['https://management.azure.com/.default']
    };

    try {
      const response = await cca.acquireTokenOnBehalfOf(oboRequest);
      console.log('[AzureMCPUser] Successfully exchanged SSO token for Azure Management token');
      return response.accessToken;
    } catch (error) {
      console.error('[AzureMCPUser] Token exchange failed:', error);
      
      // Fallback: If OBO fails, try using service principal based on user's group
      const adminGroups = process.env.AZURE_ADMIN_GROUPS?.split(',').map(g => g.trim()) || [];
      const isAdmin = adminGroups.some(group => userGroups.includes(group));

      if (isAdmin) {
        console.log('[AzureMCPUser] Falling back to admin service principal');
        return this.getServicePrincipalToken('admin');
      } else {
        console.log('[AzureMCPUser] Falling back to read-only service principal');
        return this.getServicePrincipalToken('readonly');
      }
    }
  }

  /**
   * Get service principal token as fallback
   */
  private async getServicePrincipalToken(level: 'admin' | 'readonly'): Promise<string> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const clientId = level === 'admin' 
      ? process.env.ADMIN_AZURE_MCP_SP_CLIENT_ID 
      : process.env.RO_AZURE_MCP_SP_CLIENT_ID;
    const clientSecret = level === 'admin'
      ? process.env.ADMIN_AZURE_MCP_SP_CLIENT_SECRET
      : process.env.RO_AZURE_MCP_SP_CLIENT_SECRET;
    
    const cmd = `az login --service-principal -u ${clientId} -p "${clientSecret}" --tenant ${process.env.AZURE_TENANT_ID} >/dev/null 2>&1 && az account get-access-token --resource https://management.azure.com/ --query accessToken -o tsv`;
    
    const { stdout } = await execAsync(cmd);
    return stdout.trim();
  }
}