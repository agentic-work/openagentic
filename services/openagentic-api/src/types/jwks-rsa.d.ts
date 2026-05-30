declare module 'jwks-rsa' {
  export interface Options {
    jwksUri: string;
    cache?: boolean;
    rateLimit?: boolean;
    jwksRequestsPerMinute?: number;
    cacheMaxEntries?: number;
    cacheMaxAge?: number;
  }

  export interface SigningKey {
    kid: string;
    alg: string;
    getPublicKey(): string;
    rsaPublicKey?: string;
    publicKey?: string;
  }

  export type SigningKeyCallback = (err: Error | null, key?: SigningKey) => void;

  export interface JwksClient {
    getSigningKeys(callback?: (err: Error | null, keys: SigningKey[]) => void): Promise<SigningKey[]>;
    getSigningKey(kid: string, callback?: SigningKeyCallback): Promise<SigningKey>;
  }

  export function jwksClient(options: Options): JwksClient;

  export class JwksError extends Error {
    constructor(message: string);
  }

  export class SigningKeyNotFoundError extends JwksError {
    constructor(message: string);
  }
}