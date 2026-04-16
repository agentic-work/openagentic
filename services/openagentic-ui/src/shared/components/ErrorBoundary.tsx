import React, { Component, ReactNode } from 'react';
import { AlertTriangle } from '@/shared/icons';
import { loggers } from '@/utils/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    loggers.ui.error('ErrorBoundary caught an error:', { error: error.message, stack: error.stack, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
          <AlertTriangle className="w-16 h-16 text-error mb-4" />
          <h2 className="text-xl font-semibold mb-2 text-primary">Something went wrong</h2>
          <p className="text-secondary text-center mb-4">
            We encountered an error while rendering this component.
          </p>
          <details className="text-sm text-muted">
            <summary className="cursor-pointer hover:text-secondary">
              Error details
            </summary>
            <pre className="mt-2 p-4 bg-tertiary rounded overflow-auto max-w-lg">
              {this.state.error?.stack}
            </pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            
            className="mt-4 px-4 py-2 bg-info rounded hover:bg-info/80 transition-colors"
            style={{ color: 'var(--color-text)' }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
