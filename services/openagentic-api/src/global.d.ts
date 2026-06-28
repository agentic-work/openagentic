/// <reference types="node" />

// Global type augmentations
// Most Fastify types are handled in types/fastify-augmentation.d.ts

declare global {
  interface Response {
    json<T = any>(): Promise<T>;
  }

  type HeadersInit = Record<string, string> | Array<[string, string]>;
}

// Ensure this file is treated as a module
export {};