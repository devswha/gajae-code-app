import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clipboard, ExternalLink, KeyRound, Loader2, ShieldCheck, X } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '../../shared/view/ui';

import {
  openOAuthAuthorizationUrl,
  safeOAuthAuthorizationUrl,
  type OAuthAttempt,
  type OAuthLoginFailure,
  type OAuthProvider,
} from './hooks/useOAuthLogin';

type OAuthLoginDialogProps = {
  open: boolean;
  providers: OAuthProvider[];
  isLoadingProviders: boolean;
  isStarting: boolean;
  attempt: OAuthAttempt | null;
  failure: OAuthLoginFailure | null;
  onSelectProvider: (providerId: string) => void;
  onSubmitValue: (value: string) => void;
  onDismiss: () => void;
  onRetry: () => void;
};

const terminalPhases = new Set<OAuthAttempt['phase']>(['completed', 'cancelled', 'timed_out', 'failed']);
export const shouldDisplayOAuthAuthorizationLink = (attempt: OAuthAttempt | null): boolean =>
  Boolean(
    attempt?.authorizationUrl
    && (attempt.phase === 'awaiting_browser' || attempt.phase === 'awaiting_input'),
  );

const phaseLabel = (phase: OAuthAttempt['phase']) => {
  switch (phase) {
    case 'starting':
      return 'Starting sign-in…';
    case 'persisting':
      return 'Saving sign-in…';
    case 'refreshing':
      return 'Refreshing available models…';
    case 'awaiting_browser':
      return 'Continue in your browser.';
    case 'awaiting_input':
      return 'Enter the value from your sign-in flow.';
    case 'completed':
      return 'Sign-in complete.';
    case 'cancelled':
      return 'Sign-in cancelled.';
    case 'timed_out':
      return 'Sign-in timed out.';
    case 'failed':
      return 'Sign-in could not be completed.';
  }
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to a temporary, non-persistent text field below.
  }

  try {
    const temporaryInput = document.createElement('textarea');
    temporaryInput.value = text;
    temporaryInput.setAttribute('readonly', '');
    temporaryInput.style.position = 'fixed';
    temporaryInput.style.opacity = '0';
    document.body.appendChild(temporaryInput);
    temporaryInput.select();
    const copied = document.execCommand('copy');
    temporaryInput.remove();
    return copied;
  } catch {
    return false;
  }
};

function OAuthLoginDialog({
  open,
  providers,
  isLoadingProviders,
  isStarting,
  attempt,
  failure,
  onSelectProvider,
  onSubmitValue,
  onDismiss,
  onRetry,
}: OAuthLoginDialogProps) {
  const [value, setValue] = useState('');
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const valueRef = useRef('');
  const isTerminal = Boolean(attempt && terminalPhases.has(attempt.phase));
  const isBusy = isStarting || Boolean(attempt && !isTerminal && attempt.phase !== 'awaiting_browser' && attempt.phase !== 'awaiting_input');
  const authorizationUrl = safeOAuthAuthorizationUrl(attempt?.authorizationUrl);
  const passwordInput = attempt?.password === true || attempt?.valueKind === 'password';
  const showAuthorizationLink = shouldDisplayOAuthAuthorizationLink(attempt);
  const showProviderPicker = !attempt || (isTerminal && attempt.phase !== 'completed');

  const clearValue = useCallback(() => {
    valueRef.current = '';
    setValue('');
  }, []);

  useEffect(() => {
    if (!open) {
      clearValue();
      setCopyStatus(null);
    }
  }, [clearValue, open]);

  useEffect(() => {
    clearValue();
    setCopyStatus(null);
  }, [attempt?.attemptId, attempt?.phase, clearValue]);

  useEffect(() => () => {
    valueRef.current = '';
  }, []);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedValue = valueRef.current;
    clearValue();
    if (!submittedValue.trim()) {
      return;
    }
    onSubmitValue(submittedValue);
  }, [clearValue, onSubmitValue]);

  const handleCopy = useCallback(async () => {
    if (!authorizationUrl) {
      return;
    }
    setCopyStatus(await copyText(authorizationUrl)
      ? 'Authorization link copied.'
      : 'Copy is unavailable. Select the link below and copy it manually.');
  }, [authorizationUrl]);

  const handleOpenAuthorizationUrl = useCallback(async () => {
    if (!authorizationUrl) {
      return;
    }
    if (!(await openOAuthAuthorizationUrl(authorizationUrl))) {
      setCopyStatus('The secure browser link could not be opened. Use the link below.');
    }
  }, [authorizationUrl]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onDismiss()}>
      <DialogContent
        aria-labelledby="oauth-login-dialog-title"
        className="w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-2xl border-border/80 bg-popover p-0 shadow-2xl"
      >
        <DialogTitle id="oauth-login-dialog-title">Sign in to a provider</DialogTitle>
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
              Sign in to a provider
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Credentials stay in the provider sign-in flow and are not added to chat.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDismiss}
            aria-label="Cancel sign-in"
            title="Cancel sign-in"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="max-h-[min(65dvh,34rem)] space-y-4 overflow-y-auto px-5 py-5">
          {failure && (
            <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              {failure.message}
            </div>
          )}

          {attempt?.phase === 'completed' && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600 dark:text-emerald-300" aria-hidden />
              <p className="mt-2 font-medium text-foreground">Sign-in complete</p>
              <p className="mt-1 text-sm text-muted-foreground">{attempt.instruction || 'Your provider is ready to use.'}</p>
            </div>
          )}

          {attempt && !isTerminal && attempt.phase !== 'awaiting_browser' && attempt.phase !== 'awaiting_input' && (
            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/25 px-4 py-4 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
              {attempt.instruction || phaseLabel(attempt.phase)}
            </div>
          )}

          {attempt?.phase === 'awaiting_browser' && (
            <section className="space-y-3" aria-label="Browser authorization">
              <div className="rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-foreground">
                <p className="font-medium">{phaseLabel(attempt.phase)}</p>
                <p className="mt-1 text-muted-foreground">{attempt.instruction || 'Complete sign-in in the secure browser window, then return here.'}</p>
              </div>
              {!authorizationUrl && (
                <p className="text-sm text-muted-foreground">Waiting for a secure authorization link…</p>
              )}
            </section>
          )}

          {showAuthorizationLink && authorizationUrl && (
            <section className="space-y-3" aria-label="Provider sign-in link">
              <div className="flex gap-2">
                <Button type="button" className="flex-1" onClick={handleOpenAuthorizationUrl}>
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                  Open sign-in link
                </Button>
                <Button type="button" variant="outline" onClick={handleCopy} aria-label="Copy sign-in link">
                  <Clipboard className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <Input
                value={authorizationUrl}
                readOnly
                aria-label="Provider sign-in link"
                onFocus={(event) => event.currentTarget.select()}
                className="text-xs"
              />
              <a
                onClick={(event) => {
                  event.preventDefault();
                  void handleOpenAuthorizationUrl();
                }}
                href={authorizationUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="block break-all text-xs text-primary underline underline-offset-4"
              >
                {authorizationUrl}
              </a>
              {copyStatus && <p className="text-xs text-muted-foreground" role="status">{copyStatus}</p>}
            </section>
          )}

          {attempt?.phase === 'awaiting_input' && (
            <form className="space-y-3" onSubmit={handleSubmit}>
              <div className="rounded-xl border border-border/70 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                {attempt.instruction || phaseLabel(attempt.phase)}
              </div>
              <label htmlFor="oauth-login-value" className="text-sm font-medium text-foreground">
                {passwordInput ? 'Password or secret value' : 'Authorization code or sign-in value'}
              </label>
              <Input
                id="oauth-login-value"
                value={value}
                type={passwordInput ? 'password' : 'text'}
                autoComplete={passwordInput ? 'off' : 'one-time-code'}
                onChange={(event) => {
                  valueRef.current = event.target.value;
                  setValue(event.target.value);
                }}
                aria-label={passwordInput ? 'Password or secret value' : 'Authorization code or sign-in value'}
                placeholder={passwordInput ? 'Enter value' : 'Paste the authorization code'}
              />
              <Button type="submit" className="w-full" disabled={!value.trim()}>
                <KeyRound className="mr-2 h-4 w-4" aria-hidden />
                Continue securely
              </Button>
            </form>
          )}

          {showProviderPicker && (
            <section aria-label="Sign-in providers">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-foreground">Choose a provider</h3>
                {isLoadingProviders && <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Loading providers" />}
              </div>
              {!isLoadingProviders && providers.length === 0 && (
                <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  No sign-in providers are available right now.
                </p>
              )}
              <div className="space-y-2">
                {providers.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    disabled={!provider.available || isBusy}
                    onClick={() => onSelectProvider(provider.id)}
                    className="flex w-full items-center justify-between rounded-xl border border-border/70 bg-background px-3 py-3 text-left transition-colors hover:border-primary/35 hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`Sign in with ${provider.name}${provider.authenticated ? ', already signed in' : ''}`}
                  >
                    <span>
                      <span className="block text-sm font-medium text-foreground">{provider.name}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {!provider.available ? 'Unavailable' : provider.authenticated ? 'Already signed in' : 'Sign in'}
                      </span>
                    </span>
                    {provider.authenticated && <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" aria-label="Already signed in" />}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border/70 bg-muted/15 px-5 py-3">
          {failure && (
            <Button type="button" variant="outline" onClick={onRetry} disabled={isLoadingProviders || isBusy}>
              Try again
            </Button>
          )}
          <Button type="button" variant={attempt?.phase === 'completed' ? 'default' : 'outline'} onClick={onDismiss}>
            {attempt?.phase === 'completed' ? 'Done' : 'Cancel'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default OAuthLoginDialog;
