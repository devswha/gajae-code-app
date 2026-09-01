import { useCallback, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  ErrorBoundary as ReactErrorBoundary,
  type FallbackProps,
} from 'react-error-boundary';

type ErrorFallbackProps = FallbackProps & { showDetails: boolean; componentStack: string | null };
type ErrorBoundaryProps = { children: ReactNode; showDetails?: boolean; onRetry?: () => void; resetKeys?: unknown[] };

const describeError = (failure: unknown) => failure instanceof Error
  ? `${failure.name}: ${failure.message}`
  : String(failure);

function ErrorFallback(props: ErrorFallbackProps) {
  const { componentStack, error, resetErrorBoundary, showDetails } = props;
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
                {describeError(error)}
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
  onRetry,
  resetKeys,
}: ErrorBoundaryProps) {
  const [stack, setStack] = useState<string | null>(null);

  const captureFailure = useCallback((failure: Error, details: ErrorInfo) => {
    console.error('ErrorBoundary caught an error:', failure, details);
    setStack(details.componentStack ?? null);
  }, []);

  const resetFailure = useCallback(() => {
    setStack(null);
    onRetry?.();
  }, [onRetry]);

  const fallback = useCallback(
    (fallbackProps: FallbackProps) => (
      <ErrorFallback
        {...fallbackProps}
        showDetails={showDetails}
        componentStack={stack}
      />
    ),
    [showDetails, stack]
  );

  return (
    <ReactErrorBoundary
      fallbackRender={fallback}
      onError={captureFailure}
      onReset={resetFailure}
      resetKeys={resetKeys}
    >
      {children}
    </ReactErrorBoundary>
  );
}

export default ErrorBoundary;
