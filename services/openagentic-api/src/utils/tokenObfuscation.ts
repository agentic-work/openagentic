/**
 * Token Obfuscation Utilities
 * 
 * Provides secure token obfuscation for logging, debugging, and audit trails.
 * Ensures sensitive authentication tokens are safely masked in logs while
 * maintaining partial visibility for troubleshooting purposes.
 * 
 */

/**
 * Utility to obfuscate tokens for logging/debugging
 * @param token - The token to obfuscate
 * @returns Obfuscated token string
 */
export function obfuscateToken(token: string | undefined): string {
  if (!token) return '';
  
  // For JWT tokens, keep the header part and obfuscate the rest
  const parts = token.split('.');
  if (parts.length === 3) {
    // JWT format: header.payload.signature
    return `${parts[0]}.***obfuscated***.***obfuscated***`;
  }
  
  // For other tokens, show first 8 and last 4 characters
  if (token.length > 12) {
    return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`;
  }
  
  // For short tokens, just show ***
  return '***obfuscated***';
}

/**
 * Obfuscates sensitive data in URL parameters
 * @param url - URL string that may contain sensitive parameters
 * @returns URL with obfuscated sensitive parameters
 */
export function obfuscateUrlParams(url: string): string {
  const sensitiveParams = ['token', 'apiKey', 'frontendKey', 'access_token', 'refresh_token'];
  
  let obfuscatedUrl = url;
  
  sensitiveParams.forEach(param => {
    const regex = new RegExp(`([?&]${param}=)[^&]*`, 'gi');
    obfuscatedUrl = obfuscatedUrl.replace(regex, `$1***obfuscated***`);
  });
  
  return obfuscatedUrl;
}

/**
 * Obfuscates sensitive headers in request objects
 * @param headers - Headers object that may contain sensitive information
 * @returns Headers object with obfuscated sensitive values
 */
export function obfuscateHeaders(headers: Record<string, any>): Record<string, any> {
  const sensitiveHeaders = ['authorization', 'x-api-key', 'x-openagentic-frontend', 'x-signature'];
  
  const obfuscated = { ...headers };
  
  sensitiveHeaders.forEach(header => {
    Object.keys(obfuscated).forEach(key => {
      if (key.toLowerCase() === header.toLowerCase()) {
        const value = obfuscated[key];
        if (typeof value === 'string') {
          if (value.toLowerCase().startsWith('bearer ')) {
            obfuscated[key] = `Bearer ${obfuscateToken(value.substring(7))}`;
          } else {
            obfuscated[key] = obfuscateToken(value);
          }
        }
      }
    });
  });
  
  return obfuscated;
}

/**
 * Creates a logging-safe object with obfuscated sensitive data
 * @param obj - Object that may contain sensitive data
 * @returns Object with obfuscated sensitive values
 */
export function createLoggingSafeObject(obj: any): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(createLoggingSafeObject);
  }
  
  const safe: any = {};
  
  Object.keys(obj).forEach(key => {
    const lowerKey = key.toLowerCase();
    const value = obj[key];
    
    // Check if this key contains sensitive data
    const sensitiveKeys = ['token', 'password', 'secret', 'key', 'authorization', 'signature'];
    const isSensitive = sensitiveKeys.some(sensitiveKey => lowerKey.includes(sensitiveKey));
    
    if (isSensitive && typeof value === 'string') {
      safe[key] = obfuscateToken(value);
    } else if (lowerKey === 'url' && typeof value === 'string') {
      safe[key] = obfuscateUrlParams(value);
    } else if (lowerKey === 'headers' && typeof value === 'object') {
      safe[key] = obfuscateHeaders(value);
    } else if (typeof value === 'object') {
      safe[key] = createLoggingSafeObject(value);
    } else {
      safe[key] = value;
    }
  });
  
  return safe;
}