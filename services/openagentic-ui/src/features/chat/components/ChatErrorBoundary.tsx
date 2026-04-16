/**
 * Error Boundary for Chat Container
 * Catches and displays errors in the chat interface
 * Provides fallback UI and error reporting
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from '@/shared/icons';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ChatErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ChatContainer Error:', error);
    console.error('Error Info:', errorInfo);
    
    this.setState({
      error,
      errorInfo
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-primary">
          <div className="max-w-md w-full mx-4">
            <div className="bg-secondary rounded-lg shadow-lg p-6 border border-error/20">
              <div className="flex items-center mb-4">
                <AlertTriangle className="w-6 h-6 text-error mr-3" />
                <h2 className="text-xl font-semibold text-primary">
                  Chat Error
                </h2>
              </div>

              <p className="text-secondary mb-4">
                Something went wrong with the chat interface. This error has been logged.
              </p>

              <div className="flex space-x-3">
                <button
                  onClick={this.handleRetry}
                  className="flex items-center px-4 py-2 bg-info hover:bg-info/90 theme-text-inverse rounded-md transition-colors"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </button>

                <button
                  onClick={() => window.location.reload()}
                  className="flex items-center px-4 py-2 bg-tertiary hover:bg-tertiary/80 text-primary rounded-md transition-colors"
                >
                  Reload Page
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ChatErrorBoundary;