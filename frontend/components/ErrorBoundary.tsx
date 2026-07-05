'use client';

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">
            Something went wrong
          </h2>
          <p className="text-gray-400 text-sm mb-6 max-w-md text-center">
            An unexpected error occurred. Please try refreshing the page.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-spotify-green hover:bg-spotify-green-light text-black font-semibold transition-all active:scale-[0.97]"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          {this.state.error && (
            <details className="mt-4 max-w-md">
              <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 transition-colors">
                Error details
              </summary>
              <pre className="mt-2 text-xs text-gray-500 bg-white/[0.03] rounded-lg p-3 overflow-auto max-h-32 border border-white/[0.06]">
                {this.state.error.message}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
