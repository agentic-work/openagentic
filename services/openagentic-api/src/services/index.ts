/**
 * Services barrel export
 */

import MilvusVectorService from './MilvusVectorService.js';

// Create singleton instance
const milvus = new MilvusVectorService();

export { milvus };
export { MilvusVectorService };