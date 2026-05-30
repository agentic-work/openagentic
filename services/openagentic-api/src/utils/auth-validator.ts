/**
 * Azure AD JWT Token Validator - FIXED VERSION
 * 
 * Validates JWT tokens from Azure AD using jwks-rsa library
 * Fixes the "invalid signature" error by properly handling Azure AD tokens
 */

import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
const { jwksClient } = jwksRsa as any;

interface TokenPayload {
  oid: string;
  email?: string;
  preferred_username?: string;
  groups?: string[];
  aud?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  appid?: string;
  azp?: string;
  tid?: string;
  ver?: string;
}

// Create JWKS client for Azure AD with proper caching
const createJwksClient = (tenantId: string) => {
  // Support both v1.0 and v2.0 Azure AD endpoints
  const jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  
  return jwksClient({
    jwksUri,
    cache: true,
    cacheMaxAge: 86400000, // 24 hours
    rateLimit: true,
    jwksRequestsPerMinute: 10
  });
};

/**
 * Validate Azure AD JWT token
 */
export async function validateAzureADToken(token: string): Promise<TokenPayload> {
  // Use consistent environment variables - prioritize AZURE_* over AAD_*
  const tenantId = process.env.AZURE_TENANT_ID || process.env.AAD_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID || process.env.AAD_CLIENT_ID;
  
  if (!tenantId || !clientId) {
    console.error('❌ Azure AD configuration missing:', { tenantId: !!tenantId, clientId: !!clientId });
    throw new Error('Azure AD configuration missing');
  }

  console.log('🔍 Validating token with config:', { tenantId, clientId });

  try {
    // Create JWKS client
    const client = createJwksClient(tenantId);
    
    // Function to get signing key
    const getKey = (header: any, callback: any) => {
      client.getSigningKey(header.kid, (err, key) => {
        if (err) {
          console.error('❌ Error fetching signing key:', err.message);
          callback(err);
        } else {
          const signingKey = key?.getPublicKey();
          callback(null, signingKey);
        }
      });
    };

    // Decode token to check its format first
    const decoded = jwt.decode(token, { complete: true }) as any;
    if (!decoded) {
      throw new Error('Invalid token format');
    }

    console.log('📋 Token details:', {
      algorithm: decoded.header.alg,
      keyId: decoded.header.kid,
      issuer: decoded.payload.iss,
      audience: decoded.payload.aud,
      version: decoded.payload.ver,
      tenantId: decoded.payload.tid,
      appId: decoded.payload.appid || decoded.payload.azp
    });

    // Determine valid issuers based on token version
    const tokenVersion = decoded.payload.ver;
    const validIssuers = tokenVersion === '2.0' 
      ? [
          `https://login.microsoftonline.com/${tenantId}/v2.0`,
          `${process.env.AZURE_AD_AUTHORITY || process.env.AAD_AUTHORITY}/v2.0`
        ].filter(Boolean)
      : [
          `https://sts.windows.net/${tenantId}/`,
          `https://login.microsoftonline.com/${tenantId}/`
        ];

    // Azure AD tokens can have different audience formats
    const validAudiences = [
      clientId,  // Application ID
      `api://${clientId}`,  // API URI format
      `spn:${clientId}`,  // Service principal format
      `api://openagentic`,  // Custom API identifier
      process.env.VITE_AZURE_AD_API_SCOPE?.replace('/.default', ''), // API scope without /.default
      '00000003-0000-0000-c000-000000000000'  // Microsoft Graph
    ].filter(Boolean);

    console.log('🔐 Attempting validation with:', {
      issuers: validIssuers,
      audiences: validAudiences
    });

    let verifiedPayload: any = null;
    let lastError: Error | null = null;

    // Try each combination of issuer and audience
    for (const issuer of validIssuers) {
      for (const audience of validAudiences) {
        try {
          verifiedPayload = await new Promise<any>((resolve, reject) => {
            jwt.verify(token, getKey, {
              audience,
              issuer,
              algorithms: ['RS256'],
              ignoreExpiration: false // Enforce expiration check
            }, (err, decodedToken) => {
              if (err) {
                reject(err);
              } else {
                console.log('✅ Token verified successfully with:', { issuer, audience });
                resolve(decodedToken);
              }
            });
          });

          // If we got here, verification succeeded
          break;
        } catch (err) {
          lastError = err as Error;
          // Continue trying other combinations
        }
      }
      if (verifiedPayload) break;
    }

    if (!verifiedPayload) {
      console.error('❌ Token validation failed after trying all combinations');
      throw new Error(`Token validation failed: ${lastError?.message || 'invalid signature'}`);
    }

    // Extract user information
    const payload: TokenPayload = {
      oid: verifiedPayload.oid || verifiedPayload.sub,
      email: verifiedPayload.email || verifiedPayload.preferred_username || verifiedPayload.upn,
      preferred_username: verifiedPayload.preferred_username || verifiedPayload.upn,
      groups: verifiedPayload.groups || [],
      aud: verifiedPayload.aud,
      iss: verifiedPayload.iss,
      exp: verifiedPayload.exp,
      nbf: verifiedPayload.nbf,
      appid: verifiedPayload.appid,
      azp: verifiedPayload.azp,
      tid: verifiedPayload.tid,
      ver: verifiedPayload.ver
    };

    console.log('✅ Token validation successful for user:', payload.email || payload.oid);
    return payload;
    
  } catch (error) {
    console.error('❌ Token validation error:', error);
    
    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message.includes('expired')) {
        throw new Error('Token has expired');
      }
      if (error.message.includes('audience')) {
        throw new Error('Invalid token audience');
      }
      if (error.message.includes('issuer')) {
        throw new Error('Invalid token issuer');
      }
      if (error.message.includes('signature')) {
        throw new Error('Token validation failed: invalid signature');
      }
    }
    
    throw new Error(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Check if user is in authorized groups
 */
export function isUserAuthorized(groups: string[] = [], requiredGroups: string[] = []): boolean {
  if (requiredGroups.length === 0) {
    // No groups required - all authenticated users allowed
    return true;
  }
  
  // Check if user is in any of the required groups
  return requiredGroups.some(group => groups.includes(group));
}

/**
 * Get authorized groups from environment
 */
export function getAuthorizedGroups(): { userGroups: string[], adminGroups: string[] } {
  // Prioritize AZURE_* variables over AAD_* for consistency
  const userGroups = (process.env.AZURE_AD_AUTHORIZED_GROUPS || process.env.AAD_AUTHORIZED_USER_GROUPS || '')
    .split(',')
    .map(g => g.trim())
    .filter(Boolean);
    
  const adminGroups = (process.env.AZURE_AD_ADMIN_GROUP || process.env.AAD_AUTHORIZED_ADMIN_GROUPS || '')
    .split(',')
    .map(g => g.trim())
    .filter(Boolean);
    
  return { userGroups, adminGroups };
}
