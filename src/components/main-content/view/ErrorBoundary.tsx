import { useCallback, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  ErrorBoundary as ReactErrorBoundary,
  type FallbackProps,
} from 'react-error-boundary';

type ErrorFallbackProps = FallbackProps & {
  showDetails: boolean;
  componentStack: string | null;
};

type ErrorBoundaryProps = {
  children: ReactNode;
  showDetails?: boolean;
  onRetry?: () => void;
  resetKeys?: unknown[];
};

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

function ErrorFallback({
  error,
  resetErrorBoundary,
  showDetails,
  componentStack,
}: ErrorFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-6">
        <div className="mb-4 flex items-center">
          <div className="shrink-0">
            <svg className="h-5 w-5 text-destructive" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h3 className="ml-3 text-sm font-medium text-destructive">Something went wrong</h3>
        </div>
        <div className="text-sm text-destructive">
          <p className="mb-2">An error occurred while loading the chat interface.</p>
          {showDetails && (
            <details className="mt-4">
              <summary className="cursor-pointer font-mono text-xs">Error Details</summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-destructive/10 p-2 text-xs">
                {formatError(error)}
                {componentStack}
              </pre>
            </details>
          )}
        </div>
        <div className="mt-4">
          <button
            onClick={resetErrorBoundary}
            className="rounded bg-destructive px-4 py-2 text-sm text-destructive-foreground hover:bg-destructive/90 focus:ring-2 focus:ring-ring focus:outline-hidden"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorBoundary({
  children,
  showDetails = false,
  onRetry = undefined,
  resetKeys = undefined,
}: ErrorBoundaryProps) {
  const [componentStack, setComponentStack] = useState<string | null>(null);

  const handleError = useCallback((error: Error, errorInfo: ErrorInfo) => {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // Keep component stack for optional debug rendering in fallback UI.
    setComponentStack(errorInfo?.componentStack ?? null);
  }, []);

  const handleReset = useCallback(() => {
    setComponentStack(null);
    onRetry?.();
  }, [onRetry]);

  const renderFallback = useCallback(
    ({ error, resetErrorBoundary }: FallbackProps) => (
      <ErrorFallback
        error={error}
        resetErrorBoundary={resetErrorBoundary}
        showDetails={showDetails}
        componentStack={componentStack}
      />
    ),
    [showDetails, componentStack]
  );

  return (
    <ReactErrorBoundary
      fallbackRender={renderFallback}
      onError={handleError}
      onReset={handleReset}
      resetKeys={resetKeys}
    >
      {children}
    </ReactErrorBoundary>
  );
}

export default ErrorBoundary;
