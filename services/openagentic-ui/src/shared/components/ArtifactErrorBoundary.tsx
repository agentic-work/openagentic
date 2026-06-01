import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ArtifactErrorBoundaryProps {
  children: ReactNode;
  fallbackContent?: string;
}

interface ArtifactErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ArtifactErrorBoundary extends Component<
  ArtifactErrorBoundaryProps,
  ArtifactErrorBoundaryState
> {
  constructor(props: ArtifactErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ArtifactErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ArtifactErrorBoundary] Render failed:', {
      error: error.message,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="border border-error/30 bg-[var(--color-error)]/10 rounded-lg p-4 my-2">
          <p className="text-sm text-error font-medium">Failed to render content</p>
          <p className="text-xs text-fg-subtle mt-1">{this.state.error?.message}</p>
          {this.props.fallbackContent && (
            <pre className="mt-2 text-xs text-fg-muted overflow-auto max-h-48 whitespace-pre-wrap break-all">
              {this.props.fallbackContent}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export default ArtifactErrorBoundary;
export { ArtifactErrorBoundary };
