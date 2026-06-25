/**
 * Server-Sent Events (SSE) utility for chat streaming
 * Replaces WebSocket with a simpler, more reliable approach
 */

export interface SSEMessage {
  event: string;
  data: any;
}

export class SSEClient {
  private eventSource: EventSource | null = null;
  private listeners: Map<string, ((data: any) => void)[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  constructor(
    private url: string,
    private token?: string
  ) {}

  connect() {
    // For SSE, we don't maintain a persistent connection
    // Each request creates a new EventSource
    // console.log('SSE client initialized for:', this.url);
  }

  async sendMessage(sessionId: string, message: string, files?: any[]) {
    const response = await fetch(`${this.url}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token && { 'Authorization': `Bearer ${this.token}` })
      },
      body: JSON.stringify({ sessionId, message, files })
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }

    // Create EventSource from response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('No response body');
    }

    // Process SSE stream
    let buffer = '';
    let currentEvent = '';
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      // Process complete events in buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.substring(7).trim();
          continue;
        }
        
        if (line.startsWith('data: ')) {
          const data = line.substring(6);
          try {
            const parsed = JSON.parse(data);
            // Use the event name from the SSE stream
            this.handleMessage({ ...parsed, event: currentEvent || this.guessEventType(parsed) });
          } catch (e) {
            console.error('Failed to parse SSE data:', e);
          }
          currentEvent = ''; // Reset after processing
        }
      }
    }
  }

  private handleMessage(message: any) {
    // Extract event type from message
    const event = message.event || this.guessEventType(message);
    const listeners = this.listeners.get(event) || [];
    
    for (const listener of listeners) {
      try {
        listener(message);
      } catch (error) {
        console.error('SSE listener error:', error);
      }
    }
  }

  private guessEventType(message: any): string {
    if (message.type) return message.type;
    if (message.content) return 'stream';
    if (message.step) return 'cot_step';
    if (message.tokenUsage) return 'done';
    if (message.error) return 'error';
    return 'unknown';
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: (data: any) => void) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.listeners.clear();
  }
}