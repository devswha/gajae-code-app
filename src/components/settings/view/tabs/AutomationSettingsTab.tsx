import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAppShellStore } from '../../../../stores/useAppShellStore';
import { builtinBrowserFailure, hasBuiltinBrowserBridge, openBuiltinBrowser } from '../../../../utils/builtinBrowser';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';

type Status = {
  supported: boolean;
  platform: string;
  architecture: string;
  capabilities?: { browser: boolean; computer: boolean };
  browser: { error?: string };
  cua: { installed: boolean; version?: string; daemon: string; accessibility?: boolean; screenRecording?: boolean; error?: string };
};

type Grants = {
  always: { origins: string[]; applications: string[] };
};

/** Mirrors `GJC_BROWSER_BACKENDS` in server/gjc-browser-backend.ts; the server rejects anything else. */
const BROWSER_BACKENDS = ['builtin', 'aside', 'ego'] as const;
type BrowserBackend = typeof BROWSER_BACKENDS[number];

const selectClass = 'touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary';

function isBrowserBackend(value: unknown): value is BrowserBackend {
  return typeof value === 'string' && (BROWSER_BACKENDS as readonly string[]).includes(value);
}

export default function AutomationSettingsTab() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<Status | null>(null);
  const [grants, setGrants] = useState<Grants | null>(null);
  const [loading, setLoading] = useState(true);
  const [browserBackend, setBrowserBackend] = useState<BrowserBackend | null>(null);
  const [browserBackendError, setBrowserBackendError] = useState<string | null>(null);
  const [builtinBrowserStatus, setBuiltinBrowserStatus] = useState<string | null>(null);
  const selectedSessionId = useAppShellStore((state) => state.selectedSession?.id);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statusResponse, grantsResponse, backendResponse] = await Promise.all([
        fetch('/api/automation/status'),
        fetch('/api/automation/grants'),
        fetch('/api/automation/browser-backend'),
      ]);
      if (statusResponse.ok) setStatus(await statusResponse.json() as Status);
      if (grantsResponse.ok) setGrants(await grantsResponse.json() as Grants);
      if (backendResponse.ok) {
        const { backend } = await backendResponse.json() as { backend: unknown };
        if (isBrowserBackend(backend)) setBrowserBackend(backend);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const changeBrowserBackend = async (backend: BrowserBackend) => {
    setBrowserBackendError(null);
    const response = await fetch('/api/automation/browser-backend', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend }),
    });
    if (!response.ok) {
      setBrowserBackendError(t('automation.browserBackend.saveFailed'));
      return;
    }
    const saved = await response.json() as { backend: unknown };
    if (isBrowserBackend(saved.backend)) setBrowserBackend(saved.backend);
  };

  useEffect(() => {
    void refresh().catch(() => setLoading(false));
  }, [refresh]);

  const revoke = async (kind: 'origin' | 'application', value: string) => {
    const response = await fetch('/api/automation/grants', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, value, scope: 'always' }),
    });
    if (response.ok) setGrants(await response.json() as Grants);
  };

  const statusValue = (value: boolean | undefined) => value === true
    ? t('automation.granted')
    : value === false
      ? t('automation.missing')
      : t('automation.unknown');

  const allGrants = [
    ...(grants?.always.origins ?? []).map((value) => ({ kind: 'origin' as const, value })),
    ...(grants?.always.applications ?? []).map((value) => ({ kind: 'application' as const, value })),
  ];

  return (
    <div className="space-y-6">
      <SettingsSection title={t('automation.browserBackend.title')} description={t('automation.browserBackend.description')}>
        <SettingsCard>
          <SettingsRow label={t('automation.browserBackend.label')} description={t(`automation.browserBackend.${browserBackend ?? 'builtin'}Description`)}>
            <select
              aria-label={t('automation.browserBackend.label')}
              value={browserBackend ?? 'builtin'}
              disabled={browserBackend === null}
              onChange={(event) => { if (isBrowserBackend(event.target.value)) void changeBrowserBackend(event.target.value); }}
              className={`${selectClass} sm:w-48`}
            >
              <option value="builtin">{t('automation.browserBackend.builtin')}</option>
              <option value="aside">{t('automation.browserBackend.aside')}</option>
              <option value="ego">{t('automation.browserBackend.ego')}</option>
            </select>
          </SettingsRow>
          {browserBackend === 'aside' ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">{t('automation.browserBackend.asideNote')}</p>
          ) : null}
          {browserBackend === 'ego' ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">{t('automation.browserBackend.egoNote')}</p>
          ) : null}
          {browserBackendError ? (
            <p className="px-4 pb-4 text-xs text-destructive" role="alert">{browserBackendError}</p>
          ) : null}
        </SettingsCard>

      </SettingsSection>

      {hasBuiltinBrowserBridge() ? (
        <SettingsSection title={t('automation.builtinBrowser.title')} description={t('automation.builtinBrowser.description')}>
          <SettingsCard>
            <SettingsRow label={t('automation.builtinBrowser.label')} description={t('automation.builtinBrowser.note')}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={status?.capabilities?.browser !== true}
                  className="rounded-lg border border-input px-3 py-2 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    setBuiltinBrowserStatus(null);
                    void openBuiltinBrowser(selectedSessionId ?? 'manual').then(
                      () => setBuiltinBrowserStatus(t('automation.builtinBrowser.opened')),
                      (error) => setBuiltinBrowserStatus(t(`automation.builtinBrowser.errors.${builtinBrowserFailure(error)}`)),
                    );
                  }}
                >
                  {t('automation.builtinBrowser.open')}
                </button>
              </div>
            </SettingsRow>
            {builtinBrowserStatus ? (
              <p className="px-4 pb-4 text-xs text-muted-foreground" role="status">{builtinBrowserStatus}</p>
            ) : null}
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <SettingsSection title={t('automation.title')} description={t('automation.description')}>
        <SettingsCard divided>
          <div className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-medium text-foreground">CUA Driver</p>
              <p className="mt-1 text-xs text-muted-foreground">{status?.cua.installed ? `${status.cua.version ?? ''} · ${status.cua.daemon}` : t('automation.notInstalled')}</p>
            </div>
            <a href="https://cua.ai/docs/how-to-guides/driver/install" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              {t('automation.installGuide')} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="grid gap-2 p-4 text-xs text-muted-foreground sm:grid-cols-2">
            <span>{t('automation.accessibility')}: {statusValue(status?.cua.accessibility)}</span>
            <span>{t('automation.screenRecording')}: {statusValue(status?.cua.screenRecording)}</span>
          </div>
        </SettingsCard>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-foreground hover:bg-muted disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> {t('automation.refresh')}
        </button>
      </SettingsSection>

      <SettingsSection title={t('automation.grants')} description={t('automation.grantsDescription')}>
        <SettingsCard>
          {allGrants.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" />{t('automation.noGrants')}</div>
          ) : allGrants.map((grant) => (
            <div key={`${grant.kind}:${grant.value}`} className="flex items-center justify-between gap-3 border-b border-border p-3 last:border-b-0">
              <div className="min-w-0"><p className="truncate text-sm text-foreground">{grant.value}</p><p className="text-xs text-muted-foreground">{t(`automation.${grant.kind}`)}</p></div>
              <button type="button" onClick={() => void revoke(grant.kind, grant.value)} aria-label={t('automation.revoke')} className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
