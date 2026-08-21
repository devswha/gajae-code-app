import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, PointerEvent, WheelEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  ExternalLink,
  LoaderCircle,
  MonitorDown,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

type BrowserTab = {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

type BrowserState = {
  sessionId: string;
  activeTabId: string | null;
  tabs: BrowserTab[];
};

type AutomationStatus = {
  supported: boolean;
  browser: { state: 'idle' | 'starting' | 'ready' | 'error'; installed: boolean; buildId: string; error?: string };
  cua: { installed: boolean; version?: string; daemon: string; accessibility?: boolean; screenRecording?: boolean };
};

type BrowserPanelProps = {
  sessionId: string;
};

const COMMON_LOCAL_URLS = ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:4173', 'http://localhost:8000'];

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function socketUrl(sessionId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/browser?sessionId=${encodeURIComponent(sessionId)}`;
}

export default function BrowserPanel({ sessionId }: BrowserPanelProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [state, setState] = useState<BrowserState | null>(null);
  const [address, setAddress] = useState('http://localhost:5173');
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'offline'>('offline');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [localUrls, setLocalUrls] = useState(COMMON_LOCAL_URLS);
  const frameRef = useRef<HTMLImageElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pointerFrameRef = useRef<number | null>(null);

  const activeTab = useMemo(
    () => state?.tabs.find((tab) => tab.id === state.activeTabId) ?? null,
    [state],
  );

  useEffect(() => {
    if (activeTab?.url && activeTab.url !== 'about:blank') setAddress(activeTab.url);
  }, [activeTab?.url]);

  const loadStatus = useCallback(async () => {
    try {
      const next = await jsonRequest<AutomationStatus>('/api/automation/status');
      setStatus(next);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('workspace.browser.error'));
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
    void jsonRequest<{ urls: string[] }>('/api/automation/local-sites')
      .then((result) => {
        if (result.urls.length > 0) setLocalUrls(result.urls);
      })
      .catch(() => {});
  }, [loadStatus]);

  useEffect(() => {
    let disposed = false;
    setState(null);
    setError(null);
    setDownloadProgress(null);
    const websocket = new WebSocket(socketUrl(sessionId));
    websocket.binaryType = 'arraybuffer';
    socketRef.current = websocket;
    setConnection('connecting');
    websocket.onopen = () => !disposed && setConnection('live');
    websocket.onclose = () => !disposed && setConnection('offline');
    websocket.onerror = () => !disposed && setConnection('offline');
    websocket.onmessage = (event) => {
      if (disposed) return;
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data) as { type: string; payload?: Record<string, unknown>; message?: string };
        if (message.type === 'state' && message.payload) setState(message.payload as unknown as BrowserState);
        if (message.type === 'error') setError(message.message ?? t('workspace.browser.error'));
        if (message.type === 'download.progress' && message.payload) {
          const downloaded = Number(message.payload.downloadedBytes ?? 0);
          const total = Number(message.payload.totalBytes ?? 0);
          setDownloadProgress(total > 0 ? Math.round((downloaded / total) * 100) : null);
        }
        return;
      }
      const packet = event.data as ArrayBuffer;
      const view = new DataView(packet);
      if (view.byteLength < 4) return;
      const headerLength = view.getUint32(0);
      if (headerLength <= 0 || headerLength + 4 > view.byteLength) return;
      const header = JSON.parse(new TextDecoder().decode(packet.slice(4, 4 + headerLength))) as { mimeType?: string };
      const nextUrl = URL.createObjectURL(new Blob([packet.slice(4 + headerLength)], { type: header.mimeType ?? 'image/jpeg' }));
      setFrameUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return nextUrl;
      });
    };
    return () => {
      disposed = true;
      websocket.close();
      socketRef.current = null;
      if (pointerFrameRef.current !== null) cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = null;
      setFrameUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
    };
  }, [sessionId, t]);

  const open = useCallback(async (url: string, allowDownload = false) => {
    setBusy(true);
    setError(null);
    try {
      const next = await jsonRequest<BrowserState>(`/api/automation/browser/${encodeURIComponent(sessionId)}/open`, {
        method: 'POST',
        body: JSON.stringify({ url, allowDownload }),
      });
      setState(next);
      await loadStatus();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('workspace.browser.error'));
    } finally {
      setBusy(false);
      setDownloadProgress(null);
    }
  }, [loadStatus, sessionId, t]);

  const command = useCallback(async (commandValue: Record<string, unknown>) => {
    setError(null);
    try {
      const next = await jsonRequest<BrowserState>(`/api/automation/browser/${encodeURIComponent(sessionId)}/command`, {
        method: 'POST',
        body: JSON.stringify({ command: commandValue }),
      });
      if (next?.tabs) setState(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('workspace.browser.error'));
    }
  }, [sessionId, t]);

  const sendInput = useCallback((input: Record<string, unknown>) => {
    void jsonRequest(`/api/automation/browser/${encodeURIComponent(sessionId)}/input`, {
      method: 'POST',
      body: JSON.stringify({ input }),
    }).catch((nextError) => setError(nextError instanceof Error ? nextError.message : t('workspace.browser.error')));
  }, [sessionId, t]);

  const framePoint = useCallback((event: PointerEvent<HTMLImageElement> | WheelEvent<HTMLImageElement>) => {
    const image = frameRef.current;
    if (!image) return null;
    const bounds = image.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !image.naturalWidth || !image.naturalHeight) return null;
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * image.naturalWidth,
      y: ((event.clientY - bounds.top) / bounds.height) * image.naturalHeight,
    };
  }, []);

  const navigate = (event: FormEvent) => {
    event.preventDefault();
    if (activeTab) void command({ action: 'navigate', url: address });
    else void open(address, false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) {
      event.preventDefault();
      sendInput({ kind: 'key', event: 'down', key: event.key, code: event.code, modifiers: (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0) });
      return;
    }
    event.preventDefault();
    sendInput({ kind: 'text', text: event.key });
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) return;
    event.preventDefault();
    sendInput({
      kind: 'key',
      event: 'up',
      key: event.key,
      code: event.code,
      modifiers: (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0),
    });
  };

  const stop = async () => {
    setBusy(true);
    try {
      await jsonRequest(`/api/automation/browser/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      setState(null);
      setFrameUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('workspace.browser.error'));
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-6 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        {t('workspace.browser.connecting')}
      </div>
    );
  }

  if (!status.supported) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {t('workspace.browser.unsupported')}
      </div>
    );
  }

  if (!status.browser.installed && !state) {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <div className="max-w-sm rounded-xl border border-border/70 bg-muted/20 p-5 text-center">
          <MonitorDown className="mx-auto h-8 w-8 text-muted-foreground" />
          <h3 className="mt-3 text-sm font-medium text-foreground">{t('workspace.browser.installTitle')}</h3>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{t('workspace.browser.installDescription')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void open(address, true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {busy && downloadProgress === null
              ? t('workspace.browser.preparing')
              : downloadProgress === null
                ? t('workspace.browser.download')
                : t('workspace.browser.downloading', { progress: downloadProgress })}
          </button>
          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/10">
      <div className="flex items-center gap-1 border-b border-border/60 p-1.5">
        <button type="button" disabled={!activeTab?.canGoBack} onClick={() => void command({ action: 'back' })} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label={t('workspace.browser.back')}><ArrowLeft className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={!activeTab?.canGoForward} onClick={() => void command({ action: 'forward' })} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label={t('workspace.browser.forward')}><ArrowRight className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={!state} onClick={() => void command({ action: 'reload' })} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label={t('workspace.browser.reload')}><RefreshCw className={`h-3.5 w-3.5 ${activeTab?.loading ? 'animate-spin' : ''}`} /></button>
        <form onSubmit={navigate} className="min-w-0 flex-1">
          <input value={address} onChange={(event) => setAddress(event.target.value)} aria-label={t('workspace.browser.address')} className="h-7 w-full rounded-md border border-border/70 bg-background px-2 text-xs text-foreground outline-none focus:border-primary" />
        </form>
        <span title={t(`workspace.browser.connection.${connection}`)} aria-label={t(`workspace.browser.connection.${connection}`)} className={`h-2 w-2 rounded-full ${connection === 'live' ? 'bg-primary' : connection === 'connecting' ? 'bg-foreground/50' : 'bg-muted-foreground/40'}`} />
        <button type="button" disabled={!activeTab} onClick={() => activeTab && window.open(activeTab.url, '_blank', 'noopener,noreferrer')} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30" aria-label={t('workspace.browser.external')}><ExternalLink className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={!state || busy} onClick={() => void stop()} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30" aria-label={t('workspace.browser.stop')}><Square className="h-3.5 w-3.5" /></button>
      </div>

      {state && state.tabs.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border/60 px-1.5 py-1">
          {state.tabs.map((tab) => (
            <div key={tab.id} className={`flex min-w-0 max-w-48 items-center rounded ${tab.id === state.activeTabId ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}>
              <button type="button" onClick={() => void command({ action: 'selectTab', tabId: tab.id })} className="min-w-0 flex-1 truncate px-2 py-1 text-left text-[11px]">
                {tab.title || (tab.url === 'about:blank' ? t('workspace.browser.newTab') : new URL(tab.url).hostname)}
              </button>
              <button type="button" onClick={() => void command({ action: 'closeTab', tabId: tab.id })} className="mr-0.5 rounded p-0.5 hover:bg-background/70" aria-label={t('workspace.browser.closeTab')}>
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => void command({ action: 'newTab' })} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t('workspace.browser.newTab')}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className="relative flex min-h-0 flex-1 items-start justify-start overflow-auto bg-black/90 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        {frameUrl ? (
          <img
            ref={frameRef}
            src={frameUrl}
            alt={t('workspace.browser.preview')}
            draggable={false}
            onPointerMove={(event) => {
              if (pointerFrameRef.current !== null) return;
              const { clientX, clientY } = event;
              pointerFrameRef.current = requestAnimationFrame(() => {
                pointerFrameRef.current = null;
                const image = frameRef.current;
                if (!image) return;
                const bounds = image.getBoundingClientRect();
                if (!bounds.width || !bounds.height || !image.naturalWidth || !image.naturalHeight) return;
                sendInput({
                  kind: 'mouse',
                  event: 'move',
                  x: ((clientX - bounds.left) / bounds.width) * image.naturalWidth,
                  y: ((clientY - bounds.top) / bounds.height) * image.naturalHeight,
                });
              });
            }}
            onPointerDown={(event) => {
              const point = framePoint(event);
              if (!point) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              sendInput({ kind: 'mouse', event: 'down', ...point, button: event.button === 2 ? 'right' : 'left' });
            }}
            onPointerUp={(event) => {
              const point = framePoint(event);
              if (point) sendInput({ kind: 'mouse', event: 'up', ...point, button: event.button === 2 ? 'right' : 'left' });
            }}
            onWheel={(event) => {
              const point = framePoint(event);
              if (!point) return;
              event.preventDefault();
              sendInput({ kind: 'wheel', ...point, deltaX: event.deltaX, deltaY: event.deltaY });
            }}
            onContextMenu={(event) => event.preventDefault()}
            className="h-auto w-full select-none object-contain object-top"
          />
        ) : (
          <div className="m-auto p-6 text-center text-xs text-white/60">
            <RotateCcw className="mx-auto mb-2 h-5 w-5" />
            <p>{t('workspace.browser.empty')}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {localUrls.map((url) => <button key={url} type="button" onClick={() => { setAddress(url); void open(url, false); }} className="rounded border border-white/15 px-2 py-1 hover:bg-white/10">{url.replace('http://', '')}</button>)}
            </div>
          </div>
        )}
      </div>
      {error && <div className="border-t border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">{error}</div>}
      {status?.cua && (
        <div className="flex items-center justify-between border-t border-border/60 px-2.5 py-1 text-[10px] text-muted-foreground">
          <span>{t('workspace.browser.cua')}</span>
          <span>{status.cua.installed ? `${status.cua.version ?? 'Installed'} · ${status.cua.daemon}` : t('workspace.browser.cuaMissing')}</span>
        </div>
      )}
    </div>
  );
}
