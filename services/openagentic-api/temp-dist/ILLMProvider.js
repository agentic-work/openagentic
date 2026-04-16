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
