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

/**
 * ArtifactErrorBoundary - Catches rendering failures in artifact/content blocks
 *
 * Prevents a single bad artifact (bad HTML, unsupported format, malformed code)
 * from breaking the entire message or chat stream. Shows a graceful fallback
 * with the raw content when available.
 *
 * @copyright 2026 Gnomus.ai
 */

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
        <div className="border border-red-800/30 bg-red-950/20 rounded-lg p-4 my-2">
          <p className="text-sm text-red-400 font-medium">Failed to render content</p>
          <p className="text-xs text-zinc-500 mt-1">{this.state.error?.message}</p>
          {this.props.fallbackContent && (
            <pre className="mt-2 text-xs text-zinc-400 overflow-auto max-h-48 whitespace-pre-wrap break-all">
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
