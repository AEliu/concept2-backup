import React, { Component, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // Could send error to logging service here
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-[#f3f3f1] flex items-center justify-center p-8">
          <div className="bg-white border border-black p-8 max-w-md">
            <h1 className="font-serif text-2xl mb-4 text-black">Something went wrong</h1>
            <p className="font-mono text-xs text-gray-600 mb-4 uppercase tracking-wider">
              An unexpected error occurred
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-black text-white px-4 py-2 font-mono text-xs uppercase tracking-wider hover:bg-gray-800 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
