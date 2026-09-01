import { AlertCircle } from 'lucide-react';

type ErrorBannerProps = { message: string };

const ErrorBanner = ({ message }: ErrorBannerProps) => (
  <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-4">
    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
    <p className="text-sm text-destructive">{message}</p>
  </div>
);

export default ErrorBanner;
