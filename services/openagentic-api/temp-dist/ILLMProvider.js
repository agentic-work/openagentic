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

"use strict";
/**
 * LLM Provider Interface
 *
 * Defines the contract for all LLM providers (Azure OpenAI, AWS Bedrock, Google Vertex AI)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseLLMProvider = void 0;
/**
 * Base LLM Provider abstract class
 */
class BaseLLMProvider {
    constructor(providerLogger, providerName) {
        this.providerLogger = providerLogger;
        this.initialized = false;
        this.logger = providerLogger;
        this.metrics = {
            provider: providerName,
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageLatency: 0,
            totalTokens: 0,
            totalCost: 0
        };
    }
    isInitialized() {
        return this.initialized;
    }
    getMetrics() {
        return { ...this.metrics };
    }
    resetMetrics() {
        this.metrics = {
            provider: this.name,
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageLatency: 0,
            totalTokens: 0,
            totalCost: 0
        };
        this.logger.info({ provider: this.name }, 'Metrics reset');
    }
    /**
     * Track a successful request
     */
    trackSuccess(latency, tokens, cost) {
        this.metrics.totalRequests++;
        this.metrics.successfulRequests++;
        this.metrics.totalTokens += tokens;
        this.metrics.totalCost += cost;
        this.metrics.lastUsed = new Date();
        // Update average latency
        const totalLatency = this.metrics.averageLatency * (this.metrics.successfulRequests - 1) + latency;
        this.metrics.averageLatency = totalLatency / this.metrics.successfulRequests;
    }
    /**
     * Track a failed request
     */
    trackFailure() {
        this.metrics.totalRequests++;
        this.metrics.failedRequests++;
    }
}
exports.BaseLLMProvider = BaseLLMProvider;
