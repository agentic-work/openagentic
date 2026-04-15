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