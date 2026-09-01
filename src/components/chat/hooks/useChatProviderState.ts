import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type {
  LLMProvider,
  Project,
  ProjectSession,
  ProviderModelsCacheInfo,
  ProviderModelsDefinition,
} from '../../../types/app';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';

const GJC_PROVIDER: LLMProvider = 'gjc';
const DEFAULT_GJC_MODEL = 'default';
const DEFAULT_PERMISSION_MODE: PermissionMode = 'default';

interface UseChatProviderStateArgs { selectedSession: ProjectSession | null; selectedProject: Project | null; }
type ProviderModelsApiResponse = { success?: boolean; data?: { models?: ProviderModelsDefinition; cache?: ProviderModelsCacheInfo; }; };
type ChangeActiveModelApiResponse = { success?: boolean; data?: { supported?: boolean; changed?: boolean; model?: string | null; }; };

const savedModel = () => localStorage.getItem('gjc-model') || DEFAULT_GJC_MODEL;

function activeModelPath(sessionId: string) {
  return `/api/providers/gjc/sessions/${encodeURIComponent(sessionId)}/active-model`;
}

export function useChatProviderState({ selectedSession, selectedProject: _selectedProject }: UseChatProviderStateArgs) {
  const [gjcModel, setGjcModelState] = useState(savedModel);
  const [sessionPinnedModel, setSessionPinnedModel] = useState<string | null>(null);
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [providerModelCatalog, setProviderModelCatalog] = useState<Partial<Record<LLMProvider, ProviderModelsDefinition>>>({});
  const [providerModelCacheCatalog, setProviderModelCacheCatalog] = useState<Partial<Record<LLMProvider, ProviderModelsCacheInfo>>>({});
  const [providerModelsLoading, setProviderModelsLoading] = useState(true);
  const [providerModelsRefreshing, setProviderModelsRefreshing] = useState(false);
  const latestModelsRequest = useRef(0);

  const setGjcModel = useCallback((nextModel: string) => {
    localStorage.setItem('gjc-model', nextModel);
    setGjcModelState(nextModel);
  }, []);

  useEffect(() => {
    const sessionId = selectedSession?.id?.trim();
    const sessionProvider = selectedSession?.__provider ?? selectedSession?.provider;
    if (!sessionId || (sessionProvider && sessionProvider !== GJC_PROVIDER)) return undefined;

    let disposed = false;
    setSessionPinnedModel(null);

    const loadSessionChoice = async () => {
      try {
        const response = await authenticatedFetch(activeModelPath(sessionId));
        if (disposed || !response.ok) return;

        const result = (await response.json()) as ChangeActiveModelApiResponse;
        if (disposed || !result.success) return;

        const pin = result.data?.supported && result.data.changed
          ? result.data.model?.trim() || ''
          : '';
        setSessionPinnedModel(pin || null);
        setGjcModelState(pin || savedModel());
      } catch {
        // The server remains authoritative when this display-only request fails.
      }
    };

    void loadSessionChoice();
    return () => { disposed = true; };
  }, [selectedSession?.id, selectedSession?.__provider, selectedSession?.provider]);

  const loadProviderModels = useCallback(async (bypassCache = false) => {
    const requestNumber = latestModelsRequest.current + 1;
    latestModelsRequest.current = requestNumber;
    if (bypassCache) setProviderModelsRefreshing(true);
    else setProviderModelsLoading(true);

    try {
      const url = bypassCache
        ? '/api/providers/gjc/models?bypassCache=true'
        : '/api/providers/gjc/models';
      const response = await authenticatedFetch(url);
      const result = (await response.json()) as ProviderModelsApiResponse;
      const definition = result.data?.models;
      const cache = result.data?.cache;
      if (latestModelsRequest.current !== requestNumber || !result.success || !definition || !cache) return;

      setProviderModelCatalog({ gjc: definition });
      setProviderModelCacheCatalog({ gjc: cache });
      setGjcModelState((current) => {
        const stored = localStorage.getItem('gjc-model');
        const options = definition.OPTIONS;
        const selected = options.some(({ value }) => value === stored)
          ? stored!
          : options.some(({ value }) => value === current)
            ? current
            : definition.DEFAULT;
        if (stored !== selected) localStorage.setItem('gjc-model', selected);
        return selected;
      });
    } catch (error) {
      console.error('Error loading GJC models:', error);
    } finally {
      if (latestModelsRequest.current === requestNumber) {
        setProviderModelsLoading(false);
        setProviderModelsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadProviderModels();
  }, [loadProviderModels]);

  const hardRefreshProviderModels = useCallback(() => loadProviderModels(true), [loadProviderModels]);
  const selectProviderModel = useCallback(async (targetProvider: LLMProvider, model: string, sessionId?: string | null) => {
    if (targetProvider !== GJC_PROVIDER) throw new Error('Only GJC models can be selected.');

    const targetSession = typeof sessionId === 'string' ? sessionId.trim() : '';
    const mustChangeDefault = !targetSession
      || (selectedSession?.id === targetSession && selectedSession.__provider !== GJC_PROVIDER);
    if (mustChangeDefault) {
      setGjcModel(model);
      return { scope: 'default' as const, changed: false, model };
    }

    const response = await authenticatedFetch(activeModelPath(targetSession), {
      method: 'POST',
      body: JSON.stringify({ model }),
    });
    const result = (await response.json()) as ChangeActiveModelApiResponse;
    if (!response.ok || !result.success || !result.data?.supported) {
      throw new Error('Unable to change the active GJC model for this session.');
    }

    const activeModel = result.data.model || model;
    setGjcModel(model);
    setSessionPinnedModel(activeModel);
    return { scope: 'session' as const, changed: result.data.changed === true, model: activeModel };
  }, [selectedSession, setGjcModel]);

  return {
    provider: GJC_PROVIDER,
    gjcModel,
    sessionPinnedModel,
    setGjcModel,
    permissionMode: DEFAULT_PERMISSION_MODE,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    providerModelCatalog,
    providerModelCacheCatalog,
    providerModelsLoading,
    providerModelsRefreshing,
    hardRefreshProviderModels,
    selectProviderModel,
  };
}
