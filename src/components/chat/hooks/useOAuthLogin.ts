import { useCallback, useEffect, useRef, useState } from 'react';

import { useWebSocket } from '../../../contexts/WebSocketContext';
import { openExternalUrl, safeExternalUrl } from '../../../utils/externalLink';

type UnknownRecord = Record<string, unknown>;

type OAuthLoginPhase =
  | 'starting'
  | 'awaiting_browser'
  | 'awaiting_input'
  | 'persisting'
  | 'refreshing'
  | 'completed'
  | 'cancelled'
  | 'timed_out'
  | 'failed';

export type OAuthProvider = {
  id: string;
  name: string;
  available: boolean;
  authenticated: boolean;
};

export type OAuthAttempt = {
  attemptId: string;
  providerId: string;
  phase: OAuthLoginPhase;
  authorizationUrl?: string;
  instruction?: string;
  errorCode?: string;
  expiresAt?: number;
  valueKind?: 'manual_code' | 'password' | 'prompt';
  password?: true;
};

export type OAuthLoginFailure = {
  code: string;
  message: string;
};

const MAX_TEXT_LENGTH = 4_096;
const MAX_IDENTIFIER_LENGTH = 256;
const terminalPhases = new Set<OAuthLoginPhase>(['completed', 'cancelled', 'timed_out', 'failed']);
const phaseNames = new Set<OAuthLoginPhase>([
  'starting',
  'awaiting_browser',
  'awaiting_input',
  'persisting',
  'refreshing',
  'completed',
  'cancelled',
  'timed_out',
  'failed',
]);

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;

const readString = (value: unknown, maxLength = MAX_TEXT_LENGTH): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
    ? value
    : null;

const normalizedName = (value: unknown): string | null => {
  const name = readString(value, MAX_IDENTIFIER_LENGTH);
  return name ? name.toLowerCase().replace(/[._-]/g, '') : null;
};

const isSafeProviderId = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);

const parseProvider = (value: unknown): OAuthProvider | null => {
  const record = asRecord(value);
  const id = readString(record?.id, MAX_IDENTIFIER_LENGTH);
  const name = readString(record?.name, MAX_IDENTIFIER_LENGTH);
  if (!id || !name || !isSafeProviderId(id)) {
    return null;
  }

  return {
    id,
    name,
    available: record?.available === true,
    authenticated: record?.authenticated === true,
  };
};

const parseProviders = (value: unknown): OAuthProvider[] | null => {
  const array = Array.isArray(value)
    ? value
    : Array.isArray(asRecord(value)?.providers)
      ? asRecord(value)?.providers as unknown[]
      : null;
  if (!array) {
    return null;
  }

  const providers = array
    .map(parseProvider)
    .filter((provider): provider is OAuthProvider => provider !== null);
  const seen = new Set<string>();
  return providers.filter((provider) => {
    if (seen.has(provider.id)) {
      return false;
    }
    seen.add(provider.id);
    return true;
  });
};

const parseAttempt = (value: unknown): OAuthAttempt | null => {
  const record = asRecord(value);
  const attemptId = readString(record?.attemptId, MAX_IDENTIFIER_LENGTH);
  const providerId = readString(record?.providerId, MAX_IDENTIFIER_LENGTH);
  const phase = readString(record?.phase, 64) as OAuthLoginPhase | null;
  if (!attemptId || !providerId || !phase || !isSafeProviderId(attemptId) || !isSafeProviderId(providerId) || !phaseNames.has(phase)) {
    return null;
  }

  const authorizationUrl = safeOAuthAuthorizationUrl(record?.authorizationUrl) || undefined;
  const instruction = readString(record?.instruction) || undefined;
  const errorCode = readString(record?.errorCode, MAX_IDENTIFIER_LENGTH) || undefined;
  const valueKind = record?.valueKind;

  return {
    attemptId,
    providerId,
    phase,
    ...(authorizationUrl ? { authorizationUrl } : {}),
    ...(instruction ? { instruction } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(typeof record?.expiresAt === 'number' && Number.isFinite(record.expiresAt) ? { expiresAt: record.expiresAt } : {}),
    ...(valueKind === 'manual_code' || valueKind === 'password' || valueKind === 'prompt' ? { valueKind } : {}),
    ...(record?.password === true ? { password: true as const } : {}),
  };
};

const resultCandidates = (frame: UnknownRecord): unknown[] => {
  const candidates: unknown[] = [frame];
  const addRecordFields = (value: unknown) => {
    const record = asRecord(value);
    if (!record) {
      return;
    }
    candidates.push(record);
    if (record.payload !== undefined) candidates.push(record.payload);
    if (record.data !== undefined) candidates.push(record.data);
    if (record.result !== undefined) candidates.push(record.result);
  };

  addRecordFields(frame.payload);
  addRecordFields(frame.data);
  addRecordFields(frame.result);
  return candidates;
};

const responseFailure = (candidates: unknown[]): OAuthLoginFailure | null => {
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (record?.ok !== false) {
      continue;
    }
    const code = readString(asRecord(record.error)?.code, MAX_IDENTIFIER_LENGTH) || 'oauth_failed';
    return safeFailure(code);
  }
  return null;
};

const safeFailure = (code: string): OAuthLoginFailure => {
  switch (code) {
    case 'oauth_provider_not_found':
      return { code, message: 'That sign-in provider is not available.' };
    case 'oauth_provider_unavailable':
    case 'oauth_unavailable':
      return { code, message: 'Sign-in is not available for that provider right now.' };
    case 'oauth_attempt_active':
      return { code, message: 'Another sign-in attempt is already in progress.' };
    case 'oauth_attempt_not_found':
    case 'oauth_attempt_not_active':
      return { code, message: 'That sign-in attempt is no longer active. Start again to continue.' };
    case 'oauth_attempt_not_owner':
      return { code, message: 'This sign-in attempt belongs to another app connection.' };
    case 'oauth_input_not_requested':
      return { code, message: 'A sign-in value is not requested yet. Follow the current sign-in step.' };
    case 'oauth_submit_too_large':
      return { code, message: 'That sign-in value is too long. Check the value and try again.' };
    case 'invalid_payload':
      return { code, message: 'The sign-in request could not be sent. Try again.' };
    case 'oauth_disconnected':
      return { code, message: 'Connection lost. Reconnect before continuing sign-in.' };
    case 'oauth_model_refresh_failed':
      return { code, message: 'Sign-in was saved, but available models could not be refreshed.' };
    default:
      return { code: 'oauth_failed', message: 'Sign-in could not be completed. Try again.' };
  }
};
export { parseAttempt as parseOAuthAttempt, parseProvider as parseOAuthProvider, safeFailure as oauthFailureForCode };


const isOAuthFrame = (names: Array<string | null>): boolean => names.some((name) =>
  Boolean(name?.startsWith('oauth')) || name === 'providerauthupdated',
);

const isTerminalAttempt = (attempt: OAuthAttempt | null): boolean =>
  Boolean(attempt && terminalPhases.has(attempt.phase));

/**
 * Validates the only authorization URL protocol the app may open or expose.
 */
export function safeOAuthAuthorizationUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) {
    return null;
  }
  return safeExternalUrl(value);
}

/**
 * Opens a validated authorization URL in the person's browser: through the
 * sidecar inside the desktop shell (the webview is a loopback origin with no
 * Tauri IPC and no working window.open), a new tab elsewhere.
 */
export function openOAuthAuthorizationUrl(value: unknown): Promise<boolean> {
  return openExternalUrl(safeOAuthAuthorizationUrl(value));
}

export function useOAuthLogin() {
  const { sendMessage, subscribe, isConnected } = useWebSocket();
  const [isOpen, setIsOpen] = useState(false);
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [attempt, setAttempt] = useState<OAuthAttempt | null>(null);
  const [failure, setFailure] = useState<OAuthLoginFailure | null>(null);
  const pendingProviderIdRef = useRef<string | null>(null);
  const openedAuthorizationRef = useRef<string | null>(null);
  const activeAttemptRef = useRef<OAuthAttempt | null>(null);
  const sendMessageRef = useRef(sendMessage);
  const hasConnectedRef = useRef(false);
  const isOpenRef = useRef(false);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  useEffect(() => {
    activeAttemptRef.current = attempt;
  }, [attempt]);

  const requestStatus = useCallback(() => {
    sendMessage({ type: 'oauth.status' });
  }, [sendMessage]);

  const requestProviders = useCallback(() => {
    if (!isConnected) {
      setIsLoadingProviders(false);
      setFailure(safeFailure('oauth_disconnected'));
      return;
    }
    setIsLoadingProviders(true);
    sendMessage({ type: 'oauth.providers' });
    requestStatus();
  }, [isConnected, requestStatus, sendMessage]);

  const startProviderFromList = useCallback((providerId: string, providerList: OAuthProvider[]) => {
    if (!isConnected) {
      setIsStarting(false);
      setFailure(safeFailure('oauth_disconnected'));
      return;
    }
    const provider = providerList.find((candidate) => candidate.id === providerId);
    if (!provider) {
      setIsStarting(false);
      setFailure(safeFailure('oauth_provider_not_found'));
      return;
    }
    if (!provider.available) {
      setIsStarting(false);
      setFailure(safeFailure('oauth_provider_unavailable'));
      return;
    }

    setFailure(null);
    setAttempt(null);
    setIsStarting(true);
    openedAuthorizationRef.current = null;
    sendMessage({ type: 'oauth.start', providerId: provider.id });
  }, [isConnected, sendMessage]);

  const startProvider = useCallback((providerId: string) => {
    pendingProviderIdRef.current = null;
    startProviderFromList(providerId, providers);
  }, [providers, startProviderFromList]);

  const openLogin = useCallback((providerId?: string) => {
    const requestedProviderId = typeof providerId === 'string' ? providerId.trim() : '';
    pendingProviderIdRef.current = requestedProviderId || null;
    openedAuthorizationRef.current = null;
    setFailure(null);
    setAttempt(null);
    setIsStarting(false);
    setIsOpen(true);
    isOpenRef.current = true;
    requestProviders();
  }, [requestProviders]);

  const applyAttempt = useCallback((nextAttempt: OAuthAttempt) => {
    if (!isOpenRef.current) {
      // oauth.phase events are broadcast to every connected client. A tab whose
      // dialog is closed must simply ignore them: cancelling here would kill
      // attempts owned by another tab or device the moment they start. The
      // owning tab already cancels its own attempt on dialog close and unmount,
      // and the server times abandoned attempts out.
      return;
    }

    activeAttemptRef.current = nextAttempt;
    setAttempt(nextAttempt);
    setIsStarting(false);
    if (nextAttempt.phase === 'failed' || nextAttempt.phase === 'timed_out') {
      setFailure(safeFailure(nextAttempt.errorCode || 'oauth_failed'));
    } else if (nextAttempt.phase !== 'cancelled') {
      setFailure(null);
    }
  }, []);

  const consumeFrame = useCallback((event: unknown) => {
    const frame = asRecord(event);
    if (!frame) {
      return;
    }

    const names = [normalizedName(frame.kind), normalizedName(frame.type), normalizedName(frame.method)];
    if (!isOAuthFrame(names)) {
      return;
    }

    const candidates = resultCandidates(frame);
    const failureResult = responseFailure(candidates);
    if (failureResult) {
      setIsLoadingProviders(false);
      setIsStarting(false);
      setFailure(failureResult);
      return;
    }

    const isProviderUpdate = names.includes('oauthproviders') || names.includes('oauthprovidersupdated') || names.includes('oauthstatus') || names.includes('oauthresponse');
    for (const candidate of candidates) {
      const parsedProviders = parseProviders(candidate);
      if (!parsedProviders) {
        continue;
      }
      setProviders(parsedProviders);
      setIsLoadingProviders(false);
      if (pendingProviderIdRef.current) {
        const providerId = pendingProviderIdRef.current;
        pendingProviderIdRef.current = null;
        startProviderFromList(providerId, parsedProviders);
      }
      break;
    }

    if (names.includes('providerauthupdated')) {
      for (const candidate of candidates) {
        const provider = parseProvider(candidate);
        if (!provider) {
          continue;
        }
        setProviders((current) => current.map((entry) => entry.id === provider.id ? provider : entry));
        break;
      }
    }

    if (names.includes('oauthphase') || names.includes('oauthstart') || names.includes('oauthsubmit') || names.includes('oauthstatus') || names.includes('oauthresponse') || isProviderUpdate) {
      for (const candidate of candidates) {
        const parsedAttempt = parseAttempt(candidate)
          || parseAttempt(asRecord(candidate)?.attempt)
          || parseAttempt(asRecord(candidate)?.activeAttempt);
        if (!parsedAttempt) {
          continue;
        }
        applyAttempt(parsedAttempt);
        break;
      }
    }
  }, [applyAttempt, startProviderFromList]);

  useEffect(() => subscribe(consumeFrame), [consumeFrame, subscribe]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    if (hasConnectedRef.current) {
      requestStatus();
    }
    hasConnectedRef.current = true;
  }, [isConnected, requestStatus]);

  useEffect(() => {
    const authorizationUrl = attempt?.authorizationUrl;
    // Callback-server flows race the localhost listener against manual paste,
    // so the phase can land on awaiting_input before this effect runs; the
    // browser must still open in that case.
    const phaseWantsBrowser = attempt?.phase === 'awaiting_browser' || attempt?.phase === 'awaiting_input';
    if (!isOpen || !authorizationUrl || !phaseWantsBrowser || openedAuthorizationRef.current === authorizationUrl) {
      return;
    }
    openedAuthorizationRef.current = authorizationUrl;
    void openOAuthAuthorizationUrl(authorizationUrl);
  }, [attempt?.authorizationUrl, attempt?.phase, isOpen]);

  useEffect(() => () => {
    const activeAttempt = activeAttemptRef.current;
    if (activeAttempt && !isTerminalAttempt(activeAttempt)) {
      sendMessageRef.current({ type: 'oauth.cancel', attemptId: activeAttempt.attemptId });
    }
  }, []);

  const submitValue = useCallback((value: string) => {
    const activeAttempt = activeAttemptRef.current;
    if (!activeAttempt || activeAttempt.phase !== 'awaiting_input') {
      setFailure(safeFailure('oauth_input_not_requested'));
      return;
    }
    if (!isConnected) {
      setIsStarting(false);
      setFailure(safeFailure('oauth_disconnected'));
      return;
    }

    setFailure(null);
    setIsStarting(true);
    sendMessage({ type: 'oauth.submit', attemptId: activeAttempt.attemptId, value });
  }, [isConnected, sendMessage]);

  const cancelLogin = useCallback(() => {
    const activeAttempt = activeAttemptRef.current;
    pendingProviderIdRef.current = null;
    isOpenRef.current = false;
    setIsOpen(false);
    setIsLoadingProviders(false);
    setIsStarting(false);
    setFailure(null);
    setAttempt(null);
    activeAttemptRef.current = null;
    if (activeAttempt && !isTerminalAttempt(activeAttempt)) {
      sendMessage({ type: 'oauth.cancel', attemptId: activeAttempt.attemptId });
    }
  }, [sendMessage]);

  const closeLogin = useCallback(() => {
    if (isTerminalAttempt(activeAttemptRef.current) || !activeAttemptRef.current) {
      pendingProviderIdRef.current = null;
      isOpenRef.current = false;
      setIsOpen(false);
      setFailure(null);
      setAttempt(null);
      activeAttemptRef.current = null;
      return;
    }
    cancelLogin();
  }, [cancelLogin]);

  const retry = useCallback(() => {
    const providerId = activeAttemptRef.current?.providerId;
    if (providerId) {
      startProvider(providerId);
      return;
    }
    requestProviders();
  }, [requestProviders, startProvider]);

  return {
    isOpen,
    providers,
    isLoadingProviders,
    isStarting,
    attempt,
    failure,
    openLogin,
    startProvider,
    submitValue,
    cancelLogin,
    closeLogin,
    retry,
  };
}
