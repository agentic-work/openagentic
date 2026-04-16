import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from '@/shared/icons';
import { loggers } from '@/utils/logger';

interface Props {
  children: ReactNode;
  onRetry?: () => void;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorType: 'sse' | 'connection' | 'timeout' | 'general';
}

class SSEErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorType: 'general' 
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    let errorType: State['errorType'] = 'general';
    
    // Classify error types for better user messaging
    if (error.message.includes('SSE') || error.message.includes('EventSource')) {
      errorType = 'sse';
    } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      errorType = 'timeout';
    } else if (error.message.includes('connection') || error.message.includes('network')) {
      errorType = 'connection';
    }

    return { 
      hasError: true, 
      error,
      errorType 
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[SSEErrorBoundary] Stream error caught:', {
      error: error.message,
      stack: error.stack,
      errorInfo,
      timestamp: new Date().toISOString()
    });

    // Report to monitoring service if available
    if (window.gtag) {
      window.gtag('event', 'exception', {
        description: `SSE Error: ${error.message}`,
        fatal: false
      });
    }
  }

  handleRetry = () => {
    // Simply reset error state and notify parent - no retry logic (handled by API)
    this.setState({ 
      hasError: false, 
      error: null, 
      errorType: 'general' 
    });
    
    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  getErrorMessage(): { title: string; description: string } {
    switch (this.state.errorType) {
      case 'sse':
        return {
          title: 'Stream Connection Failed',
          description: 'Unable to establish a real-time connection with the server. This may be due to network issues or server maintenance.'
        };
      case 'timeout':
        return {
          title: 'Request Timed Out',
          description: 'The server took too long to respond. This might happen with complex requests or during high server load.'
        };
      case 'connection':
        return {
          title: 'Connection Error',
          description: 'Lost connection to the server. Please check your internet connection and try again.'
        };
      default:
        return {
          title: 'Chat Error',
          description: 'An unexpected error occurred while processing your message. Please try again.'
        };
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { title, description } = this.getErrorMessage();

      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-6 bg-error/10 border-primary rounded-lg mx-4">
          <AlertTriangle className="w-12 h-12 text-error mb-3" />
          <h3 className="text-lg font-semibold text-error mb-2">
            {title}
          </h3>
          <p className="text-error/80 text-center text-sm mb-4 max-w-md">
            {description}
          </p>
          
          <div className="flex gap-3">
            <button
              onClick={this.handleRetry}
              
              className="flex items-center gap-2 px-4 py-2 bg-error hover:bg-error/80 rounded-md text-sm font-medium transition-colors"
              style={{ color: 'var(--color-text)' }}
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>

            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-secondary hover:bg-tertiary text-primary rounded-md text-sm font-medium transition-colors"
            >
              Reload Page
            </button>
          </div>

          <details className="mt-4 text-xs text-error max-w-md">
            <summary className="cursor-pointer hover:text-error/80">
              Technical Details
            </summary>
            <pre className="mt-2 p-3 bg-error/10 rounded text-xs overflow-auto max-h-32">
              {this.state.error?.stack || this.state.error?.message}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

export default SSEErrorBoundary;