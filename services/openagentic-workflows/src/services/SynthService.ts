/**
 * SynthService for workflow service.
 * Routes synthesis requests to the openagentic-api artifact-functions endpoint.
 */

import axios from 'axios';

const API_URL = process.env.API_URL || 'http://openagentic-api:8000';
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET;

export class SynthService {
  private static instance: SynthService | null = null;
  private logger: any;

  static getInstance(logger?: any): SynthService {
    if (!SynthService.instance) {
      SynthService.instance = new SynthService(logger);
    }
    return SynthService.instance;
  }

  constructor(logger?: any) {
    this.logger = logger;
  }

  async synthesize(request: {
    intent: string;
    userId: string;
    userEmail?: string;
    capabilities?: string[];
    dryRun?: boolean;
    sessionId?: string;
    credentials?: any;
    authToken?: string;
  }): Promise<any> {
    const startTime = Date.now();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (INTERNAL_SERVICE_SECRET) {
        headers['X-Internal-Secret'] = INTERNAL_SERVICE_SECRET;
        headers['X-Request-From'] = 'internal';
      }
      // Also pass auth token if available (for routes that require user auth)
      if (request.authToken) {
        headers['Authorization'] = request.authToken.startsWith('Bearer ')
          ? request.authToken : `Bearer ${request.authToken}`;
      }

      const response = await axios.post(
        `${API_URL}/api/synth/synthesize`,
        {
          intent: request.intent,
          capabilities: request.capabilities || ['data'],
          userId: request.userId,
          dryRun: request.dryRun || false,
          sessionId: request.sessionId || 'workflow',
        },
        {
          headers,
          timeout: 60000,
          validateStatus: () => true,
        }
      );

      const totalTimeMs = Date.now() - startTime;

      if (response.status >= 400) {
        return {
          success: false,
          error: response.data?.error || `Synthesis request failed with status ${response.status}`,
          metrics: { synthesisTimeMs: totalTimeMs, executionTimeMs: 0, totalTimeMs, costUsd: 0 },
        };
      }

      const data = response.data;
      return {
        success: true,
        result: data.result || data.output || data,
        tool: {
          explanation: data.explanation || data.description || request.intent,
          riskLevel: data.riskLevel || 'low',
          capabilitiesUsed: data.capabilitiesUsed || request.capabilities || [],
        },
        metrics: {
          synthesisTimeMs: data.synthesisTimeMs || totalTimeMs,
          executionTimeMs: data.executionTimeMs || 0,
          totalTimeMs,
          costUsd: data.costUsd || 0,
        },
        existingToolsSuggested: data.existingToolsSuggested || [],
      };
    } catch (error: any) {
      const totalTimeMs = Date.now() - startTime;
      this.logger?.error?.({ error: error.message }, '[SynthService] Synthesis failed');
      return {
        success: false,
        error: error.message || 'Tool synthesis failed',
        metrics: { synthesisTimeMs: totalTimeMs, executionTimeMs: 0, totalTimeMs, costUsd: 0 },
      };
    }
  }

  async executeSynth(...args: any[]): Promise<any> {
    return this.synthesize(args[0]);
  }
}
