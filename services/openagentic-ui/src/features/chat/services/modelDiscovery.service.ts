export interface VisionModelConfig {
  id: string;
  name: string;
  endpoint: string;
  capabilities: string[];
}

export interface ImageAnalysisResult {
  description: string;
  objects: string[];
  text: string;
  confidence: number;
}

export class ModelDiscoveryService {
  private static instance: ModelDiscoveryService;
  
  static getInstance(): ModelDiscoveryService {
    if (!ModelDiscoveryService.instance) {
      ModelDiscoveryService.instance = new ModelDiscoveryService();
    }
    return ModelDiscoveryService.instance;
  }
  
  /**
   * Discover vision models via MCPO service (pure frontend - no business logic)
   * All model discovery business logic now handled by MCPO
   */
  async discoverVisionModels(): Promise<VisionModelConfig[]> {
    try {
      const token = await this.getAuthToken();
      
      // Call MCPO model discovery service instead of handling business logic in UI
      const response = await fetch('/api/models/vision', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Model discovery failed: ${response.status}`);
      }
      
      const data = await response.json();
      return data.models || [];
    } catch (error) {
      console.error('Failed to discover vision models via MCPO:', error);
      return [];
    }
  }
  
  /**
   * Simple token retrieval for pure frontend
   * Complex authentication business logic moved to MCPO
   */
  private async getAuthToken(): Promise<string> {
    // Try localStorage first
    const token = localStorage.getItem('auth_token');
    if (token) {
      return token;
    }
    
    // Try to get from auth context if available
    try {
      const { useAuth } = await import('@/app/providers/AuthContext');
      // Note: This would need to be called from within a component context
      // For now, fallback to basic token retrieval
      throw new Error('Auth context not available in service');
    } catch {
      // Basic fallback - in production, this should use proper auth flow
      throw new Error('Authentication token not available');
    }
  }
  
  /**
   * Route model selection via MCPO service (pure frontend)
   * Model routing business logic handled by MCPO
   */
  async routeModel(task: string, requirements?: string[], hasImages?: boolean): Promise<VisionModelConfig | null> {
    try {
      const token = await this.getAuthToken();
      
      const response = await fetch('/api/models/route', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ task, requirements, hasImages })
      });
      
      if (!response.ok) {
        throw new Error(`Model routing failed: ${response.status}`);
      }
      
      const data = await response.json();
      return data.recommendedModel || null;
    } catch (error) {
      console.error('Failed to route model via MCPO:', error);
      return null;
    }
  }
  
  /**
   * Analyze image via MCPO service (pure frontend)
   * Image analysis business logic handled by MCPO
   */
  async analyzeImage(imageUrl: string, modelId?: string, prompt?: string): Promise<ImageAnalysisResult | null> {
    try {
      const token = await this.getAuthToken();
      
      const response = await fetch('/api/models/analyze-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ imageUrl, modelId, prompt })
      });
      
      if (!response.ok) {
        throw new Error(`Image analysis failed: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Failed to analyze image via MCPO:', error);
      return null;
    }
  }
}

// Simple utility function for file conversion (pure frontend - no business logic)
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const base64Data = base64.split(',')[1] || base64;
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};
