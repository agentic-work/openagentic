"use strict";
/**
 * Azure OpenAI Provider
 *
 * Implements ILLMProvider for Azure OpenAI with proper 2025 SDK patterns
 * Supports both Entra ID (recommended) and API key authentication
 *
 * SDK: openai@4.x with Azure OpenAI v1 API (August 2025+)
 * Auth: @azure/identity for Entra ID
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureOpenAIProvider = void 0;
const openai_1 = require("openai");
const identity_1 = require("@azure/identity");
const ILLMProvider_js_1 = require("./ILLMProvider.js");
class AzureOpenAIProvider extends ILLMProvider_js_1.BaseLLMProvider {
    constructor(logger) {
        super(logger, 'Azure OpenAI');
        this.name = 'Azure OpenAI';
        this.type = 'azure-openai';
    }
    async initialize(config) {
        try {
            const { endpoint, tenantId, clientId, clientSecret, apiKey, deployment, apiVersion = '2024-10-21' // Latest GA version as of 2025
             } = config;
            if (!endpoint || !deployment) {
                throw new Error('Azure OpenAI configuration missing. Required: endpoint, deployment');
            }
            this.endpoint = endpoint;
            this.deployment = deployment;
            this.apiVersion = apiVersion;
            // Ensure endpoint ends with slash
            const normalizedEndpoint = this.endpoint.endsWith('/') ? this.endpoint : `${this.endpoint}/`;
            // Choose authentication method: Entra ID (preferred) or API Key
            if (tenantId && clientId && clientSecret) {
                // Entra ID (Service Principal) authentication using 2025 best practices
                // Use getBearerTokenProvider for automatic token refresh
                this.credential = new identity_1.ClientSecretCredential(tenantId, clientId, clientSecret);
                const azureADTokenProvider = (0, identity_1.getBearerTokenProvider)(this.credential, 'https://cognitiveservices.azure.com/.default');
                // Create AzureOpenAI client with token provider
                // IMPORTANT: Temporarily remove AZURE_OPENAI_API_KEY from env to prevent SDK from auto-loading it
                // The SDK throws an error if both apiKey and azureADTokenProvider are provided
                const savedApiKey = process.env.AZURE_OPENAI_API_KEY;
                delete process.env.AZURE_OPENAI_API_KEY;
                try {
                    this.client = new openai_1.AzureOpenAI({
                        azureADTokenProvider, // Token provider auto-refreshes
                        deployment: this.deployment,
                        apiVersion: this.apiVersion,
                        endpoint: normalizedEndpoint
                    });
                }
                finally {
                    // Restore the API key for other services (like EmbeddingService) that need it
                    if (savedApiKey) {
                        process.env.AZURE_OPENAI_API_KEY = savedApiKey;
                    }
                }
                this.logger.info({
                    authType: 'entra-id',
                    endpoint: normalizedEndpoint,
                    deployment: this.deployment,
                    apiVersion: this.apiVersion,
                    baseURL: `${normalizedEndpoint}openai/v1/`
                }, 'Azure OpenAI provider initialized with Entra ID (2025 SDK pattern)');
            }
            else if (apiKey) {
                // API Key authentication (not recommended for production)
                this.client = new openai_1.AzureOpenAI({
                    apiKey: apiKey,
                    deployment: this.deployment,
                    apiVersion: this.apiVersion,
                    endpoint: normalizedEndpoint
                });
                this.logger.info({
                    authType: 'api-key',
                    endpoint: normalizedEndpoint,
                    deployment: this.deployment,
                    apiVersion: this.apiVersion,
                    baseURL: `${normalizedEndpoint}openai/v1/`
                }, 'Azure OpenAI provider initialized with API key (2025 SDK pattern)');
            }
            else {
                throw new Error('Azure OpenAI authentication missing. Provide either (tenantId, clientId, clientSecret) for Entra ID or (apiKey) for API key authentication');
            }
            // Initialize separate embedding client if different endpoint is configured
            await this.initializeEmbeddingClient();
            this.initialized = true;
        }
        catch (error) {
            this.logger.error({ error }, 'Failed to initialize Azure OpenAI provider');
            throw error;
        }
    }
    /**
     * Initialize a separate embedding client if AZURE_OPENAI_EMBEDDING_ENDPOINT is configured differently
     */
    async initializeEmbeddingClient() {
        try {
            const embeddingEndpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT;
            // If no separate embedding endpoint or same as main endpoint, use main client
            if (!embeddingEndpoint || embeddingEndpoint === this.endpoint) {
                this.embeddingClient = this.client;
                this.logger.info('Using main client for embeddings');
                return;
            }
            this.logger.info({
                mainEndpoint: this.endpoint,
                embeddingEndpoint,
                usingDirectEmbedding: true
            }, 'Initializing separate embedding client for direct Azure OpenAI access');
            // Check if embeddingEndpoint is a full URL (includes /embeddings)
            const isFullUrl = embeddingEndpoint.includes('/embeddings');
            if (isFullUrl) {
                // For full URLs, use baseURL directly (never both baseURL and endpoint)
                const baseURL = embeddingEndpoint.split('?')[0]; // Remove query params
                if (this.credential) {
                    // Use Entra ID authentication for embedding client with full URL
                    // Temporarily remove API key from env to prevent SDK conflicts
                    const savedApiKey = process.env.AZURE_OPENAI_API_KEY;
                    delete process.env.AZURE_OPENAI_API_KEY;
                    try {
                        this.embeddingClient = new openai_1.AzureOpenAI({
                            azureADTokenProvider: (0, identity_1.getBearerTokenProvider)(this.credential, 'https://cognitiveservices.azure.com/.default'),
                            apiVersion: this.apiVersion,
                            baseURL: baseURL // Use ONLY baseURL, never endpoint when using direct URLs
                        });
                    }
                    finally {
                        // Restore API key for other services
                        if (savedApiKey) {
                            process.env.AZURE_OPENAI_API_KEY = savedApiKey;
                        }
                    }
                }
                else {
                    // Use API key if available
                    const apiKey = process.env.AZURE_OPENAI_EMBEDDING_API_KEY || process.env.AZURE_OPENAI_API_KEY;
                    if (!apiKey) {
                        this.logger.warn('No API key available for embedding client, using main client');
                        this.embeddingClient = this.client;
                        return;
                    }
                    this.embeddingClient = new openai_1.AzureOpenAI({
                        apiKey,
                        apiVersion: this.apiVersion,
                        baseURL: baseURL // Use ONLY baseURL, never endpoint when using direct URLs
                    });
                }
            }
            else {
                // Legacy behavior for base endpoints
                const normalizedEmbeddingEndpoint = embeddingEndpoint.endsWith('/') ? embeddingEndpoint : `${embeddingEndpoint}/`;
                if (this.credential) {
                    // Use Entra ID authentication for embedding client
                    // Temporarily remove API key from env to prevent SDK conflicts
                    const savedApiKey = process.env.AZURE_OPENAI_API_KEY;
                    delete process.env.AZURE_OPENAI_API_KEY;
                    try {
                        this.embeddingClient = new openai_1.AzureOpenAI({
                            azureADTokenProvider: (0, identity_1.getBearerTokenProvider)(this.credential, 'https://cognitiveservices.azure.com/.default'),
                            apiVersion: this.apiVersion,
                            endpoint: normalizedEmbeddingEndpoint
                            // Do not set baseURL when using endpoint
                        });
                    }
                    finally {
                        // Restore API key for other services
                        if (savedApiKey) {
                            process.env.AZURE_OPENAI_API_KEY = savedApiKey;
                        }
                    }
                    this.logger.info({
                        embeddingEndpoint: normalizedEmbeddingEndpoint,
                        authType: 'entra-id'
                    }, 'Embedding client initialized with Entra ID');
                }
                else {
                    // Use API key if available
                    const apiKey = process.env.AZURE_OPENAI_EMBEDDING_API_KEY || process.env.AZURE_OPENAI_API_KEY;
                    if (!apiKey) {
                        this.logger.warn('No API key available for embedding client, using main client');
                        this.embeddingClient = this.client;
                        return;
                    }
                    this.embeddingClient = new openai_1.AzureOpenAI({
                        apiKey,
                        apiVersion: this.apiVersion,
                        endpoint: normalizedEmbeddingEndpoint
                        // Do not set baseURL when using endpoint
                    });
                    this.logger.info({
                        embeddingEndpoint: normalizedEmbeddingEndpoint,
                        authType: 'api-key'
                    }, 'Embedding client initialized with API key');
                }
            }
            this.logger.info({
                embeddingEndpoint,
                isFullUrl,
                usingDirectEndpoint: isFullUrl
            }, 'Azure OpenAI embedding client configured');
        }
        catch (error) {
            this.logger.error({ error }, 'Failed to initialize embedding client, falling back to main client');
            this.embeddingClient = this.client;
        }
    }
    async createCompletion(request) {
        if (!this.initialized || !this.client) {
            throw new Error('Azure OpenAI provider not initialized');
        }
        const startTime = Date.now();
        try {
            // Note: Token refresh is automatic with getBearerTokenProvider (2025 SDK pattern)
            // No manual refresh needed
            // Prepare parameters (model/deployment handled via baseURL)
            const params = {
                model: this.deployment, // For Azure v1 API
                messages: request.messages,
                stream: request.stream !== false
            };
            // Add optional parameters only if provided
            if (request.temperature !== undefined)
                params.temperature = request.temperature;
            if (request.max_tokens !== undefined)
                params.max_completion_tokens = request.max_tokens;
            if (request.top_p !== undefined)
                params.top_p = request.top_p;
            if (request.frequency_penalty !== undefined)
                params.frequency_penalty = request.frequency_penalty;
            if (request.presence_penalty !== undefined)
                params.presence_penalty = request.presence_penalty;
            if (request.user)
                params.user = request.user;
            // Add tools if provided
            if (request.tools && request.tools.length > 0) {
                params.tools = request.tools;
                params.tool_choice = request.tool_choice || 'auto';
            }
            // Add response format if provided
            if (request.response_format) {
                params.response_format = request.response_format;
            }
            // Make request
            const response = await this.client.chat.completions.create(params);
            const latency = Date.now() - startTime;
            // Track metrics for non-streaming
            if (request.stream === false && 'usage' in response) {
                const tokens = response.usage?.total_tokens || 0;
                const cost = this.calculateCost(tokens);
                this.trackSuccess(latency, tokens, cost);
                this.logger.info({
                    model: this.deployment,
                    usage: response.usage,
                    latency
                }, 'Azure OpenAI completion successful');
            }
            return response;
        }
        catch (error) {
            this.trackFailure();
            this.logger.error({
                error: error instanceof Error ? error.message : error,
                endpoint: this.endpoint,
                deployment: this.deployment
            }, 'Azure OpenAI completion failed');
            throw error;
        }
    }
    async listModels() {
        return [{
                id: this.deployment || 'model-router',
                name: this.deployment || 'model-router',
                provider: 'azure-openai'
            }];
    }
    async getHealth() {
        try {
            if (!this.client) {
                return {
                    status: 'not_initialized',
                    provider: this.name,
                    error: 'Provider not initialized',
                    lastChecked: new Date()
                };
            }
            // Test with a simple model list call
            await this.listModels();
            return {
                status: 'healthy',
                provider: this.name,
                endpoint: this.endpoint,
                lastChecked: new Date()
            };
        }
        catch (error) {
            return {
                status: 'unhealthy',
                provider: this.name,
                endpoint: this.endpoint,
                error: error instanceof Error ? error.message : 'Unknown error',
                lastChecked: new Date()
            };
        }
    }
    /**
     * Note: Token refresh is automatic with getBearerTokenProvider (2025 SDK pattern)
     * Manual refresh methods are deprecated and no longer needed
     */
    /**
     * Generate text embeddings using Azure OpenAI embedding model
     */
    async embedText(text) {
        if (!this.embeddingClient) {
            throw new Error('Azure OpenAI embedding client not initialized');
        }
        try {
            const input = Array.isArray(text) ? text : [text];
            // Use the embedding deployment from environment or fallback
            const embeddingModel = process.env.DEFAULT_EMBEDDING_DEPLOYMENT || process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-large';
            this.logger.info({
                model: embeddingModel,
                inputTexts: input.length,
                usingDirectClient: this.embeddingClient !== this.client,
                embeddingEndpoint: process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT
            }, 'Generating Azure OpenAI embeddings with dedicated client');
            const response = await this.embeddingClient.embeddings.create({
                input,
                model: embeddingModel
            });
            const embeddings = response.data.map(item => item.embedding);
            this.logger.info({
                model: embeddingModel,
                inputTexts: input.length,
                dimensions: embeddings[0]?.length,
                usingDirectClient: this.embeddingClient !== this.client
            }, 'Azure OpenAI embeddings generated successfully');
            return Array.isArray(text) ? embeddings : embeddings[0];
        }
        catch (error) {
            this.logger.error({
                error: error instanceof Error ? error.message : error,
                endpoint: this.endpoint
            }, 'Azure OpenAI embedding generation failed');
            throw error;
        }
    }
    /**
     * Calculate cost based on tokens
     * TODO: Implement proper pricing based on model
     */
    calculateCost(tokens) {
        // Placeholder - implement actual pricing
        return tokens * 0.00001;
    }
}
exports.AzureOpenAIProvider = AzureOpenAIProvider;
