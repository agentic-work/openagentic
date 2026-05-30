/**
 * Utility to validate Azure access tokens
 */

export interface TokenValidationResult {
  isValid: boolean;
  issues: string[];
  decoded?: any;
  expiresAt?: Date;
  audience?: string;
  scopes?: string[];
}

/**
 * Validates an Azure access token for use with Azure MCP
 */
export function validateAzureToken(token: string): TokenValidationResult {
  const issues: string[] = [];
  
  // Check for empty token
  if (!token || token.trim() === '') {
    return {
      isValid: false,
      issues: ['Token is empty or undefined']
    };
  }
  
  // Check for Bearer prefix (should not be included)
  if (token.startsWith('Bearer ')) {
    issues.push('Token contains "Bearer " prefix - Azure MCP expects raw JWT only');
    token = token.substring(7); // Remove for further validation
  }
  
  // Check for extra whitespace
  if (token !== token.trim()) {
    issues.push('Token contains leading or trailing whitespace');
    token = token.trim();
  }
  
  // Validate JWT structure
  const parts = token.split('.');
  if (parts.length !== 3) {
    return {
      isValid: false,
      issues: [...issues, `Invalid JWT structure - expected 3 parts, got ${parts.length}`]
    };
  }
  
  try {
    // Decode the payload
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    
    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = new Date(payload.exp * 1000);
    
    if (payload.exp && payload.exp < now) {
      issues.push(`Token expired at ${expiresAt.toISOString()}`);
    }
    
    // Check not before
    if (payload.nbf && payload.nbf > now) {
      issues.push(`Token not valid until ${new Date(payload.nbf * 1000).toISOString()}`);
    }
    
    // Check audience
    const audience = payload.aud;
    const validAudiences = [
      'https://management.azure.com/',
      'https://management.azure.com',
      'https://management.core.windows.net/',
      'https://management.core.windows.net'
    ];
    
    if (!audience) {
      issues.push('Token missing audience claim');
    } else if (!validAudiences.includes(audience)) {
      issues.push(`Invalid audience: ${audience} - expected https://management.azure.com/`);
    }
    
    // Check scopes
    const scopes = payload.scp ? payload.scp.split(' ') : [];
    if (scopes.length === 0 && !payload.roles) {
      issues.push('Token has no scopes or roles');
    }
    
    // Check issuer
    if (!payload.iss || !payload.iss.includes('sts.windows.net')) {
      issues.push(`Invalid issuer: ${payload.iss}`);
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      decoded: payload,
      expiresAt,
      audience,
      scopes
    };
    
  } catch (error) {
    return {
      isValid: false,
      issues: [...issues, `Failed to decode token: ${error.message}`]
    };
  }
}

/**
 * Logs token validation details
 */
export function logTokenValidation(logger: any, userId: string, token: string): boolean {
  const validation = validateAzureToken(token);
  
  if (validation.isValid) {
    logger.info({
      userId,
      audience: validation.audience,
      expiresAt: validation.expiresAt,
      scopes: validation.scopes,
      timeUntilExpiry: validation.expiresAt ? 
        Math.floor((validation.expiresAt.getTime() - Date.now()) / 1000 / 60) : 0
    }, 'Azure token validation passed');
    return true;
  } else {
    logger.warn({
      userId,
      issues: validation.issues,
      audience: validation.audience,
      expiresAt: validation.expiresAt
    }, 'Azure token validation failed');
    return false;
  }
}